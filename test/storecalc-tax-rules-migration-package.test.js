import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { CALCULATION_BOUNDS } from "../src/storecalc/calculation/core.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PACKAGE_PATH = path.join(
  ROOT,
  "migrations",
  "storecalc",
  "0008_tax_rules",
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

test("StoreCalc tax-rule manifest is exact and traceable", () => {
  assert.equal(manifest.formatVersion, 1);
  assert.equal(manifest.migrationKey, "0008_tax_rules");
  assert.equal(manifest.baseMigrationKey, "0007_buckets");
  assert.equal(manifest.advisoryLockKey, "7356507374803211041");
  assert.deepEqual(manifest.timeouts, {
    lock: "3s",
    statement: "30s",
  });

  assert.deepEqual(manifest.contractRequirements, [
    "SC-DAT-001",
    "SC-DAT-002",
    "SC-DAT-003",
    "SC-DAT-004",
    "SC-DAT-005",
    "SC-DAT-006",
    "SC-DAT-007",
    "SC-DB-001",
    "SC-DB-002",
    "SC-DB-003",
    "SC-DB-004",
    "SC-CAT-006",
    "SC-CAL-001",
    "SC-CAL-004",
    "SC-SEC-001",
    "SC-STM-001",
    "SC-STM-002",
    "SC-STM-003",
    "SC-OPS-001",
    "SC-OPS-002",
    "SC-OPS-003",
    "SC-OPS-004",
    "SC-DEF-002",
  ]);

  for (const requirement of manifest.contractRequirements) {
    assert.match(
      implementationContract,
      new RegExp(`### ${requirement.replaceAll("-", "\\-")}:`),
      `${requirement} is absent from the authoritative contract`,
    );
  }
});

test("StoreCalc tax-rule package hashes match the manifest", () => {
  const sortedFiles = [...manifest.files].sort((left, right) => {
    if (left.path < right.path) return -1;
    if (left.path > right.path) return 1;
    return 0;
  });
  const bundleLines = [];

  for (const file of sortedFiles) {
    const actualHash = sha256(read(file.path));
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.equal(actualHash, file.sha256, `${file.path} checksum changed`);
    bundleLines.push(`${actualHash}  ${file.path}\n`);
  }

  assert.equal(sha256(bundleLines.join("")), manifest.bundleSha256);
});

test("StoreCalc tax-rule SQL is transactional, bounded, and closed", () => {
  for (const [name, sql] of [
    ["up", upSql],
    ["verify", verifySql],
    ["down", downSql],
  ]) {
    assert.match(sql, /^BEGIN;\n/);
    assert.match(sql, /\nCOMMIT;\n$/);
    assert.equal((sql.match(/\bCOMMIT;/g) ?? []).length, 1);
    assert.match(sql, /SET LOCAL lock_timeout = '3s';/);
    assert.match(sql, /SET LOCAL statement_timeout = '30s';/);
    assert.match(sql, /pg_advisory_xact_lock\(7356507374803211041\)/);
    assert.doesNotMatch(
      sql,
      /\bCASCADE\b/i,
      `${name} uses destructive cascade`,
    );
    assert.doesNotMatch(sql, /\bCREATE\s+EXTENSION\b/i);
    assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP)\s+ROLE\b/i);
    assert.doesNotMatch(sql, /^\\/m, `${name} depends on psql meta-commands`);
    assert.doesNotMatch(sql, /__[_A-Z0-9]+__/);
  }

  assert.deepEqual(
    [...upSql.matchAll(/CREATE TABLE storecalc\.([a-z_]+)/g)].map(
      (match) => match[1],
    ),
    ["version_tax_rules"],
  );
  assert.doesNotMatch(upSql, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(
    upSql,
    /CREATE TABLE storecalc\.(?:version_constraints|version_warnings|version_source_evidence|template_publications)/,
  );
  assert.doesNotMatch(
    verifySql,
    /^\s*(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|GRANT|REVOKE|TRUNCATE)\s/im,
  );
  assert.match(downSql, /storecalc_tax_rules_rollback_not_empty/);
  assert.match(downSql, /storecalc_tax_rules_rollback_sequence_used/);
  assert.match(downSql, /DROP TABLE storecalc\.version_tax_rules;/);
  assert.doesNotMatch(downSql, /DROP SCHEMA storecalc/);
});

test("StoreCalc tax writes serialize with sealing before row checks", () => {
  const table = upSql.indexOf("CREATE TABLE storecalc.version_tax_rules");
  const statement = upSql.indexOf(
    "CREATE TRIGGER version_tax_rules_version_topology_lock_trigger",
  );
  const row = upSql.indexOf(
    "CREATE TRIGGER version_tax_rules_content_mutability_trigger",
  );
  assert.ok(table >= 0);
  assert.ok(statement > table);
  assert.ok(row > statement);
  assert.match(
    upSql,
    /version_tax_rules_version_topology_lock_trigger[\s\S]*FOR EACH STATEMENT[\s\S]*lock_template_version_topology/,
  );
  assert.match(
    upSql,
    /version_tax_rules_content_mutability_trigger[\s\S]*FOR EACH ROW[\s\S]*assert_version_content_mutable/,
  );
  assert.doesNotMatch(upSql, /CREATE FUNCTION storecalc\./);
});

test("StoreCalc tax scopes and priorities are lineage-safe and unambiguous", () => {
  assert.match(
    upSql,
    /FOREIGN KEY \(category_version_id, version_id\)[\s\S]*REFERENCES storecalc\.version_categories\(id, version_id\)/,
  );
  assert.match(
    upSql,
    /FOREIGN KEY \(item_version_id, version_id\)[\s\S]*REFERENCES storecalc\.version_items\(id, version_id\)/,
  );
  assert.match(
    upSql,
    /scope_type = 'template'[\s\S]*category_version_id IS NULL[\s\S]*item_version_id IS NULL/,
  );
  assert.match(
    upSql,
    /scope_type = 'category'[\s\S]*category_version_id IS NOT NULL[\s\S]*item_version_id IS NULL/,
  );
  assert.match(
    upSql,
    /scope_type = 'item'[\s\S]*category_version_id IS NULL[\s\S]*item_version_id IS NOT NULL/,
  );
  for (const index of [
    "version_tax_rules_template_priority_key",
    "version_tax_rules_category_priority_key",
    "version_tax_rules_item_priority_key",
  ]) {
    assert.match(upSql, new RegExp(`CREATE UNIQUE INDEX ${index}`));
  }
});

test("StoreCalc tax states match calculation bounds", () => {
  assert.deepEqual(manifest.expectedDefinitions.vocabulary, {
    scopeTypes: ["template", "category", "item"],
    treatmentStates: ["known", "not_applicable", "unknown", "unsupported"],
    roundingModes: ["half_up", "floor", "ceiling"],
    roundingScopes: ["line"],
    rateMinimumPpm: "0",
    rateMaximumPpm: CALCULATION_BOUNDS.maxTaxRatePpm,
    priorityMinimum: 0,
    priorityMaximum: 1_000_000,
  });
  assert.match(
    upSql,
    /treatment_state IN \([\s\S]*'known'[\s\S]*'not_applicable'[\s\S]*'unknown'[\s\S]*'unsupported'/,
  );
  assert.match(
    upSql,
    /treatment_state = 'known'[\s\S]*rate_ppm IS NOT NULL[\s\S]*rounding_scope IS NOT NULL/,
  );
  assert.match(
    upSql,
    /treatment_state <> 'known'[\s\S]*rate_ppm IS NULL[\s\S]*rounding_scope IS NULL/,
  );
  assert.match(upSql, /rate_ppm BETWEEN 0 AND 1000000/);
  assert.match(upSql, /rounding_mode IN \('half_up', 'floor', 'ceiling'\)/);
  assert.match(upSql, /rounding_scope = 'line'/);
  assert.match(upSql, /priority BETWEEN 0 AND 1000000/);
});

test("StoreCalc tax rules remain inaccessible and unavailable", () => {
  assert.deepEqual(manifest.expectedDefinitions.capability, {
    key: "anonymous.calculation",
    schemaVersion: 5,
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
  assert.match(upSql, /SET schema_version = 5/);
  assert.doesNotMatch(upSql, /SET\s+is_available\s*=\s*true/i);
  assert.equal(manifest.productionExecution.allowed, false);
  assert.match(packageReadme, /not authorized for production execution/i);
  assert.match(packageReadme, /creates no data rows/i);
});

test("StoreCalc tax-rule verifier preserves exact inheritance", () => {
  assert.match(upSql, /<> 119/);
  assert.match(upSql, /4:f:0007_buckets/);
  assert.match(verifySql, /<> 127/);
  assert.match(verifySql, /5:f:0008_tax_rules/);
  assert.doesNotMatch(verifySql, /<> 119/);
  assert.doesNotMatch(verifySql, /4:f:0007_buckets/);
  assert.match(downSql, /<> 127/);
  assert.match(downSql, /<> 119/);
  assert.ok(
    downSql.indexOf("DROP TABLE storecalc.version_tax_rules") <
      downSql.lastIndexOf("<> 119"),
  );
});
