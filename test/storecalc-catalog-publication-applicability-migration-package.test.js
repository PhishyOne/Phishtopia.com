import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PACKAGE_PATH = path.join(
  ROOT,
  "migrations",
  "storecalc",
  "0012_catalog_publication_applicability",
);

function read(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

const manifest = JSON.parse(
  readFileSync(path.join(PACKAGE_PATH, "manifest.json"), "utf8"),
);
const upSql = readFileSync(path.join(PACKAGE_PATH, "up.sql"), "utf8");
const verifySql = readFileSync(path.join(PACKAGE_PATH, "verify.sql"), "utf8");
const downSql = readFileSync(path.join(PACKAGE_PATH, "down.sql"), "utf8");
const packageReadme = readFileSync(
  path.join(PACKAGE_PATH, "README.md"),
  "utf8",
);
const implementationContract = read(
  "docs/storecalc-implementation-contract.md",
);
const databaseAcceptance = read(
  "test-db/storecalc-catalog-publication-applicability.test.js",
);

test("StoreCalc catalog-publication manifest is exact and traceable", () => {
  assert.equal(manifest.formatVersion, 1);
  assert.equal(
    manifest.migrationKey,
    "0012_catalog_publication_applicability",
  );
  assert.equal(manifest.baseMigrationKey, "0011_source_evidence");
  assert.equal(manifest.advisoryLockKey, "7356507374803211041");
  assert.deepEqual(manifest.timeouts, { lock: "3s", statement: "30s" });

  for (const requirement of manifest.contractRequirements) {
    assert.match(
      implementationContract,
      new RegExp(`### ${requirement.replaceAll("-", "\\-")}:`),
      `${requirement} is absent from the authoritative contract`,
    );
  }
});

test("StoreCalc catalog-publication package hashes match the manifest", () => {
  const sortedFiles = [...manifest.files].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  const bundleLines = [];

  for (const file of sortedFiles) {
    const actualHash = sha256(read(file.path));
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.equal(actualHash, file.sha256, `${file.path} checksum changed`);
    bundleLines.push(`${actualHash}  ${file.path}\n`);
  }

  assert.equal(sha256(bundleLines.join("")), manifest.bundleSha256);
});

test("StoreCalc catalog-publication SQL is transactional, bounded, and closed", () => {
  for (const [name, sql] of [
    ["up", upSql],
    ["verify", verifySql],
    ["down", downSql],
  ]) {
    assert.match(sql, /^BEGIN;\n/);
    assert.match(sql, /\nCOMMIT;\n$/);
    assert.equal((sql.match(/\bCOMMIT;/g) ?? []).length, 1, name);
    assert.match(sql, /SET LOCAL lock_timeout = '3s';/);
    assert.match(sql, /SET LOCAL statement_timeout = '30s';/);
    assert.match(sql, /pg_advisory_xact_lock\(7356507374803211041\)/);
    assert.doesNotMatch(sql, /CREATE EXTENSION|DROP SCHEMA|CASCADE/i);
  }

  for (const table of [
    "template_publications",
    "assignment_template_applicability",
  ]) {
    assert.equal(
      (upSql.match(new RegExp(`CREATE TABLE storecalc\\.${table} \\(`, "g")) ?? [])
        .length,
      1,
    );
    assert.doesNotMatch(verifySql, new RegExp(`CREATE TABLE storecalc\\.${table}`));
  }
  assert.match(downSql, /storecalc_catalog_publication_rollback_not_empty/);
  assert.match(downSql, /storecalc_catalog_publication_rollback_sequence_used/);
  assert.doesNotMatch(downSql, /DROP TABLE(?! storecalc\.(?:assignment_template_applicability|template_publications);)/);
});

test("publication and applicability lineage is explicit and sealed-only", () => {
  assert.match(
    upSql,
    /FOREIGN KEY \(version_id, template_id\)[\s\S]*REFERENCES storecalc\.template_versions\(id, template_id\)/,
  );
  assert.match(
    upSql,
    /FOREIGN KEY \(assignment_id, program_id, facility_id\)[\s\S]*REFERENCES storecalc\.program_facility_assignments\(id, program_id, facility_id\)/,
  );
  assert.match(
    upSql,
    /FOREIGN KEY \(template_id, program_id\)[\s\S]*REFERENCES storecalc\.templates\(id, program_id\)/,
  );
  assert.match(
    upSql,
    /FOREIGN KEY \(publication_id, template_id\)[\s\S]*REFERENCES storecalc\.template_publications\(id, template_id\)/,
  );
  assert.match(upSql, /version_state <> 'sealed'/);
  assert.match(upSql, /selected_version_state <> 'sealed'/);
  assert.match(upSql, /assignment_state <> 'supported'/);
  assert.match(upSql, /template_status <> 'active'/);
});

test("selection mode is exactly one version or publication", () => {
  assert.deepEqual(manifest.expectedDefinitions.vocabulary.selectionModes, [
    "exact_version",
    "publication",
  ]);
  assert.match(
    upSql,
    /selection_mode = 'exact_version'[\s\S]*exact_version_id IS NOT NULL[\s\S]*publication_id IS NULL/,
  );
  assert.match(
    upSql,
    /selection_mode = 'publication'[\s\S]*exact_version_id IS NULL[\s\S]*publication_id IS NOT NULL/,
  );
  assert.match(upSql, /applicability_selection_target_check/);
  assert.match(
    upSql,
    /CONSTRAINT assignment_template_applicability_pkey\s+PRIMARY KEY \(id\)/,
  );
  for (const sql of [upSql, verifySql, downSql]) {
    assert.match(
      sql,
      /assignment_template_applicability_pkey:CREATE UNIQUE INDEX assignment_template_applicability_pkey/,
    );
  }
});

test("cross-topology mutations use one reviewed lock order", () => {
  assert.deepEqual(manifest.expectedDefinitions.vocabulary.lockOrder, [
    "template_versions",
    "program_facility_assignments",
    "template_publications",
    "assignment_template_applicability",
  ]);

  const functionStart = upSql.indexOf(
    "CREATE FUNCTION storecalc.lock_catalog_resolution_topology()",
  );
  const functionEnd = upSql.indexOf(
    "$storecalc_catalog_resolution_lock_function$;",
    functionStart,
  );
  const lockBody = upSql.slice(functionStart, functionEnd);
  const lockPositions = manifest.expectedDefinitions.vocabulary.lockOrder.map(
    (relation) => lockBody.indexOf(`LOCK TABLE storecalc.${relation}`),
  );
  assert.ok(lockPositions.every((position) => position > 0));
  assert.deepEqual([...lockPositions].sort((a, b) => a - b), lockPositions);
  assert.match(
    upSql,
    /program_facility_assignments_catalog_resolution_lock_trigger[\s\S]*BEFORE INSERT OR UPDATE OR DELETE[\s\S]*lock_catalog_resolution_topology/,
  );
  assert.match(packageReadme, /existing sealing service already starts with/i);
});

test("intervals serialize and closure preserves original history", () => {
  assert.match(upSql, /tstzrange\([\s\S]*\) && tstzrange/);
  assert.match(upSql, /daterange\([\s\S]*\) && daterange/);
  assert.match(upSql, /USING ERRCODE = '23P01'/);
  assert.match(upSql, /template_publications_open_key/);
  assert.match(upSql, /OLD\.ended_at IS NOT NULL/);
  assert.match(upSql, /NEW\.lifecycle_generation IS DISTINCT FROM OLD\.lifecycle_generation \+ 1/);
  assert.match(upSql, /NEW\.ended_at < transaction_timestamp\(\)/);
  assert.match(upSql, /delete_forbidden/);
  assert.match(packageReadme, /only update is one attributable, non-backdated close/i);
});

test("runtime roles remain ungranted and the capability remains closed", () => {
  assert.deepEqual(manifest.expectedDefinitions.capability, {
    key: "anonymous.calculation",
    schemaVersion: 9,
    available: false,
    verified: false,
  });
  assert.deepEqual(manifest.expectedDefinitions.runtimeGrants.web, [
    "SCHEMA USAGE",
    "schema_capabilities SELECT",
  ]);
  assert.deepEqual(manifest.expectedDefinitions.runtimeGrants.worker, [
    "SCHEMA USAGE",
    "schema_capabilities SELECT",
  ]);
  assert.deepEqual(manifest.expectedDefinitions.runtimeGrants.public, []);
  assert.match(upSql, /SET schema_version = 9/);
  assert.doesNotMatch(upSql, /SET\s+is_available\s*=\s*true/i);
  assert.equal(manifest.productionExecution.allowed, false);
  assert.match(packageReadme, /not authorized for production execution/i);
  assert.match(packageReadme, /creates no rows/i);
});

test("the verifier advances exact inherited inventory without blessing drift", () => {
  assert.match(upSql, /\) <> 155/);
  assert.match(upSql, /3:anonymous\.calculation:8:f:0011_source_evidence/);
  assert.match(upSql, /\) <> 169/);
  assert.match(upSql, /\) <> 46/);
  assert.match(upSql, /\) <> 19/);
  assert.doesNotMatch(verifySql, /\) <> 155\b/);
  assert.match(
    verifySql,
    /3:anonymous\.calculation:9:f:0012_catalog_publication_applicability/,
  );
  assert.match(verifySql, /constraint_definition_mismatch/);
  assert.match(verifySql, /foreign_key_mismatch/);
  assert.match(verifySql, /function_or_trigger_mismatch/);
  assert.match(verifySql, /table_grant_mismatch/);
});

test("PostgreSQL acceptance covers lineage, overlap, locks, grants, and rollback", () => {
  for (const marker of [
    "publication lineage rejects cross-template versions",
    "selection null patterns fail closed",
    "publication switches serialize",
    "applicability switches serialize",
    "assignment mutations enter the shared lock order",
    "web and worker roles cannot read publication state",
    "rollback rejects used identity sequences",
  ]) {
    assert.ok(databaseAcceptance.includes(marker), marker);
  }
  assert.match(databaseAcceptance, /server_version_num\) >= 170000/);
  assert.match(databaseAcceptance, /catalogPublicationVerifySql/);
  assert.match(databaseAcceptance, /catalogPublicationDownSql/);
});

test("resolver, runtime, real data, and production remain deferred", () => {
  for (const deferral of [
    "publication and applicability transition services",
    "deterministic facility-date resolver",
    "scoped profiles and composition",
    "calculation and order integration",
    "real publication and applicability rows",
    "runtime catalog grants and routes",
    "production migration execution",
  ]) {
    assert.ok(manifest.deferred.includes(deferral), deferral);
  }
  assert.doesNotMatch(
    upSql,
    /INSERT INTO storecalc\.(?:template_publications|assignment_template_applicability)/,
  );
});
