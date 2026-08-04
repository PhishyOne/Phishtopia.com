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
  "0010_warnings",
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

test("StoreCalc warning manifest is exact and traceable", () => {
  assert.equal(manifest.formatVersion, 1);
  assert.equal(manifest.migrationKey, "0010_warnings");
  assert.equal(manifest.baseMigrationKey, "0009_constraints");
  assert.equal(manifest.advisoryLockKey, "7356507374803211041");
  assert.deepEqual(manifest.timeouts, {
    lock: "3s",
    statement: "30s",
  });

  for (const requirement of manifest.contractRequirements) {
    assert.match(
      implementationContract,
      new RegExp(`### ${requirement.replaceAll("-", "\\-")}:`),
      `${requirement} is absent from the authoritative contract`,
    );
  }
});

test("StoreCalc warning package hashes match the manifest", () => {
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

test("StoreCalc warning SQL is transactional, bounded, and closed", () => {
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

  assert.equal(
    (upSql.match(/CREATE TABLE storecalc\.version_warnings/g) ?? []).length,
    1,
  );
  assert.doesNotMatch(verifySql, /CREATE TABLE storecalc\.version_warnings/);
  assert.doesNotMatch(downSql, /DROP TABLE(?! storecalc\.version_warnings)/);
  assert.match(downSql, /storecalc_version_warnings_rollback_not_empty/);
  assert.match(downSql, /storecalc_version_warnings_rollback_sequence_used/);
});

test("StoreCalc V1 warning vocabulary matches the calculation core", () => {
  assert.deepEqual(manifest.expectedDefinitions.vocabulary, {
    scopeTypes: ["template", "item"],
    severities: ["warning", "informational"],
    warningCodeMaximumBytes: 64,
    messageKeyMaximumBytes: 128,
    boundedDetails: {},
  });
  assert.equal(CALCULATION_BOUNDS.maxWarnings, 1000);
  assert.match(upSql, /severity IN \('warning', 'informational'\)/);
  assert.match(upSql, /scope_type IN \('template', 'item'\)/);
  assert.match(upSql, /category_version_id IS NULL/);
  assert.match(upSql, /bounded_details = '\{\}'::jsonb/);
  assert.match(
    upSql,
    /warning_code ~ '\^\[a-z\]\[a-z0-9\]\*\(\[\._-\]\[a-z0-9\]\+\)\*\$'/,
  );
  assert.match(
    upSql,
    /message_key ~ '\^\[a-z\]\[a-z0-9\]\*\(\\\.\[a-z\]\[a-z0-9_\]\*\)\+\$'/,
  );
});

test("StoreCalc warning lineage and identity are deterministic", () => {
  assert.match(
    upSql,
    /FOREIGN KEY \(item_version_id, version_id\)[\s\S]*REFERENCES storecalc\.version_items\(id, version_id\)/,
  );
  assert.match(upSql, /UNIQUE \(id, version_id\)/);
  assert.match(
    upSql,
    /version_warnings_template_identity_idx[\s\S]*version_id,[\s\S]*warning_code,[\s\S]*severity,[\s\S]*message_key[\s\S]*WHERE scope_type = 'template'/,
  );
  assert.match(
    upSql,
    /version_warnings_item_identity_idx[\s\S]*version_id,[\s\S]*item_version_id,[\s\S]*warning_code,[\s\S]*severity,[\s\S]*message_key[\s\S]*WHERE scope_type = 'item'/,
  );
  assert.match(
    upSql,
    /version_warnings_version_resolution_idx[\s\S]*version_id,[\s\S]*scope_type,[\s\S]*item_version_id,[\s\S]*severity,[\s\S]*warning_code,[\s\S]*message_key,[\s\S]*id/,
  );
});

test("StoreCalc warning writes serialize with sealing", () => {
  const lockTrigger = upSql.indexOf(
    "CREATE TRIGGER version_warnings_version_topology_lock_trigger",
  );
  const rowTrigger = upSql.indexOf(
    "CREATE TRIGGER version_warnings_content_mutability_trigger",
  );
  assert.ok(lockTrigger > 0);
  assert.ok(rowTrigger > lockTrigger);
  assert.match(
    upSql,
    /version_warnings_version_topology_lock_trigger[\s\S]*lock_template_version_topology/,
  );
  assert.match(
    upSql,
    /version_warnings_content_mutability_trigger[\s\S]*assert_version_content_mutable/,
  );
});

test("StoreCalc warning verifier fingerprints every V1 check", () => {
  const exactCheckNames = [
    "version_warnings_bounded_details_check",
    "version_warnings_message_key_check",
    "version_warnings_scope_type_check",
    "version_warnings_severity_check",
    "version_warnings_target_check",
    "version_warnings_warning_code_check",
  ];

  for (const sql of [upSql, verifySql, downSql]) {
    for (const checkName of exactCheckNames) {
      assert.ok(
        sql.includes(`${checkName}:CHECK`),
        `${checkName} lacks an exact verifier fingerprint`,
      );
    }
  }
});

test("StoreCalc warning scope remains explicitly partial", () => {
  assert.match(packageReadme, /category_version_id.*must\s+remain null/is);
  assert.match(packageReadme, /bounded_details.*empty JSON object/is);
  assert.match(packageReadme, /source\s+evidence.*remain absent/is);
  assert.ok(
    manifest.deferred.includes(
      "category-scoped warnings and category-to-item composition",
    ),
  );
  assert.ok(
    manifest.deferred.includes(
      "sealed source evidence and append-only context evidence",
    ),
  );
});

test("StoreCalc warnings remain inaccessible and unavailable", () => {
  assert.deepEqual(manifest.expectedDefinitions.capability, {
    key: "anonymous.calculation",
    schemaVersion: 7,
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
  assert.match(upSql, /SET schema_version = 7/);
  assert.doesNotMatch(upSql, /SET\s+is_available\s*=\s*true/i);
  assert.equal(manifest.productionExecution.allowed, false);
  assert.match(packageReadme, /not authorized for production execution/i);
  assert.match(packageReadme, /creates no data rows/i);
});

test("StoreCalc warning verifier preserves exact inheritance", () => {
  assert.match(upSql, /<> 133/);
  assert.match(upSql, /6:f:0009_constraints/);
  assert.match(upSql, /<> 140/);
  assert.match(upSql, /7:f:0010_warnings/);

  assert.match(verifySql, /<> 140/);
  assert.match(verifySql, /7:f:0010_warnings/);
  assert.doesNotMatch(verifySql, /<> 133/);
  assert.doesNotMatch(verifySql, /6:f:0009_constraints/);

  assert.match(downSql, /<> 140/);
  assert.match(downSql, /7:f:0010_warnings/);
  assert.match(downSql, /<> 133/);
  assert.match(downSql, /6:f:0009_constraints/);
});
