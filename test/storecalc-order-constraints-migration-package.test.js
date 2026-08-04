import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  CALCULATION_BOUNDS,
  SUPPORTED_CALCULATION_CAPABILITIES,
} from "../src/storecalc/calculation/core.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PACKAGE_PATH = path.join(
  ROOT,
  "migrations",
  "storecalc",
  "0009_constraints",
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

test("StoreCalc order-constraint manifest is exact and traceable", () => {
  assert.equal(manifest.formatVersion, 1);
  assert.equal(manifest.migrationKey, "0009_constraints");
  assert.equal(manifest.baseMigrationKey, "0008_tax_rules");
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
    "SC-CAT-007",
    "SC-CAL-001",
    "SC-CAL-003",
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

test("StoreCalc order-constraint package hashes match the manifest", () => {
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

test("StoreCalc order-constraint SQL is transactional, bounded, and closed", () => {
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
    ["version_constraints"],
  );
  assert.doesNotMatch(upSql, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(upSql, /CREATE TABLE storecalc\.constraint_memberships/);
  assert.doesNotMatch(
    upSql,
    /CREATE TABLE storecalc\.(?:version_warnings|version_source_evidence|template_publications)/,
  );
  assert.doesNotMatch(
    verifySql,
    /^\s*(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|GRANT|REVOKE|TRUNCATE)\s/im,
  );
  assert.match(downSql, /storecalc_order_constraints_rollback_not_empty/);
  assert.match(downSql, /storecalc_order_constraints_rollback_sequence_used/);
  assert.match(downSql, /DROP TABLE storecalc\.version_constraints;/);
  assert.doesNotMatch(downSql, /DROP SCHEMA storecalc/);
});

test("StoreCalc constraint writes serialize with sealing before row checks", () => {
  const table = upSql.indexOf("CREATE TABLE storecalc.version_constraints");
  const statement = upSql.indexOf(
    "CREATE TRIGGER version_constraints_version_topology_lock_trigger",
  );
  const row = upSql.indexOf(
    "CREATE TRIGGER version_constraints_content_mutability_trigger",
  );
  assert.ok(table >= 0);
  assert.ok(statement > table);
  assert.ok(row > statement);
  assert.match(
    upSql,
    /version_constraints_version_topology_lock_trigger[\s\S]*FOR EACH STATEMENT[\s\S]*lock_template_version_topology/,
  );
  assert.match(
    upSql,
    /version_constraints_content_mutability_trigger[\s\S]*FOR EACH ROW[\s\S]*assert_version_content_mutable/,
  );
  assert.doesNotMatch(upSql, /CREATE FUNCTION storecalc\./);
});

test("StoreCalc V1 constraint vocabulary matches the calculation core", () => {
  assert.ok(
    SUPPORTED_CALCULATION_CAPABILITIES.includes(
      manifest.expectedDefinitions.vocabulary.capability,
    ),
  );
  assert.deepEqual(manifest.expectedDefinitions.vocabulary, {
    capability: "constraints.order_aggregate.v1",
    constraintTypes: ["order_aggregate"],
    measureTypes: ["total_quantity", "distinct_line_count"],
    comparators: ["less_than_or_equal", "greater_than_or_equal"],
    valueStates: [
      "known",
      "unlimited",
      "not_applicable",
      "unknown",
      "unsupported",
    ],
    unitCodes: ["count"],
    scopeTypes: ["order"],
    compositionBehaviors: ["all_must_pass"],
    limitMinimum: "0",
    limitMaximum: CALCULATION_BOUNDS.maxAggregateCount,
    priorityMinimum: 0,
    priorityMaximum: 1_000_000,
  });
  assert.match(
    upSql,
    /measure_type IN \('total_quantity', 'distinct_line_count'\)/,
  );
  assert.match(
    upSql,
    /comparator IN \([\s\S]*'less_than_or_equal'[\s\S]*'greater_than_or_equal'/,
  );
  assert.match(
    upSql,
    /value_state IN \([\s\S]*'known'[\s\S]*'unlimited'[\s\S]*'not_applicable'[\s\S]*'unknown'[\s\S]*'unsupported'/,
  );
  assert.match(upSql, /limit_value BETWEEN 0 AND 1000000000/);
  assert.match(
    upSql,
    /comparator <> 'greater_than_or_equal'[\s\S]*value_state <> 'unlimited'/,
  );
  assert.match(upSql, /unit_code = 'count'/);
  assert.match(upSql, /scope_type = 'order'/);
  assert.match(upSql, /composition_behavior = 'all_must_pass'/);
  assert.match(upSql, /priority BETWEEN 0 AND 1000000/);
});

test("StoreCalc constraint identity and ordering are deterministic", () => {
  assert.match(upSql, /UNIQUE \(version_id, stable_key\)/);
  assert.match(
    upSql,
    /version_constraints_version_resolution_idx[\s\S]*version_id,[\s\S]*priority,[\s\S]*stable_key,[\s\S]*id/,
  );
  assert.match(
    upSql,
    /stable_key ~ '\^\[a-z\]\[a-z0-9\]\*\(\[\._-\]\[a-z0-9\]\+\)\*\$'/,
  );
  assert.match(
    packageReadme,
    /priority is bounded and maps to the deterministic engine sort order/i,
  );
});

test("StoreCalc memberships and unsupported measures remain explicit deferrals", () => {
  assert.match(packageReadme, /constraint_memberships.*not created/is);
  assert.match(packageReadme, /money and weight measures/is);
  assert.match(packageReadme, /time-period or\s+prior-purchase rule/is);
  assert.ok(
    manifest.deferred.includes(
      "constraint memberships and scoped contribution rules",
    ),
  );
  assert.doesNotMatch(upSql, /constraint_memberships/);
  assert.doesNotMatch(upSql, /'money'|'weight'|'time_period'/);
});

test("StoreCalc order constraints remain inaccessible and unavailable", () => {
  assert.deepEqual(manifest.expectedDefinitions.capability, {
    key: "anonymous.calculation",
    schemaVersion: 6,
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
  assert.match(upSql, /SET schema_version = 6/);
  assert.doesNotMatch(upSql, /SET\s+is_available\s*=\s*true/i);
  assert.equal(manifest.productionExecution.allowed, false);
  assert.match(packageReadme, /not authorized for production execution/i);
  assert.match(packageReadme, /creates no data rows/i);
});

test("StoreCalc order-constraint verifier preserves exact inheritance", () => {
  const exactCheckNames = [
    "version_constraints_comparator_check",
    "version_constraints_comparator_state_check",
    "version_constraints_composition_behavior_check",
    "version_constraints_constraint_type_check",
    "version_constraints_display_name_check",
    "version_constraints_limit_nullability_check",
    "version_constraints_measure_type_check",
    "version_constraints_priority_check",
    "version_constraints_scope_type_check",
    "version_constraints_stable_key_check",
    "version_constraints_unit_code_check",
    "version_constraints_value_state_check",
  ];

  for (const sql of [upSql, verifySql, downSql]) {
    for (const checkName of exactCheckNames) {
      assert.ok(
        sql.includes(`${checkName}:CHECK`),
        `${checkName} lacks an exact verifier fingerprint`,
      );
    }
  }

  assert.match(upSql, /<> 127/);
  assert.match(upSql, /5:f:0008_tax_rules/);
  assert.match(upSql, /<> 133/);
  assert.match(upSql, /6:f:0009_constraints/);

  assert.match(verifySql, /<> 133/);
  assert.match(verifySql, /6:f:0009_constraints/);
  assert.doesNotMatch(verifySql, /<> 127/);
  assert.doesNotMatch(verifySql, /5:f:0008_tax_rules/);

  assert.match(downSql, /<> 133/);
  assert.match(downSql, /6:f:0009_constraints/);
  assert.match(downSql, /<> 127/);
  assert.match(downSql, /5:f:0008_tax_rules/);
});
