import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { CALCULATION_BOUNDS } from "../src/storecalc/calculation/core.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PACKAGE_PATH = path.join(ROOT, "migrations", "storecalc", "0007_buckets");

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

test("StoreCalc spending-bucket manifest is exact and traceable", () => {
  assert.equal(manifest.formatVersion, 1);
  assert.equal(manifest.migrationKey, "0007_buckets");
  assert.equal(manifest.baseMigrationKey, "0006_version_content");
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
    "SC-CAT-005",
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

test("StoreCalc spending-bucket package hashes match the manifest", () => {
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

test("StoreCalc spending-bucket SQL is transactional, bounded, and closed", () => {
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
    ["version_spending_buckets", "version_item_bucket_memberships"],
  );
  assert.doesNotMatch(upSql, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(
    upSql,
    /CREATE TABLE storecalc\.(?:version_tax_rules|version_constraints|version_warnings|version_source_evidence|template_publications)/,
  );
  assert.doesNotMatch(
    verifySql,
    /^\s*(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|GRANT|REVOKE|TRUNCATE)\s/im,
  );
  assert.match(downSql, /storecalc_spending_buckets_rollback_not_empty/);
  assert.match(downSql, /storecalc_spending_buckets_rollback_sequence_used/);
  assert.match(
    downSql,
    /DROP TABLE storecalc\.version_item_bucket_memberships;/,
  );
  assert.match(downSql, /DROP TABLE storecalc\.version_spending_buckets;/);
  assert.doesNotMatch(downSql, /DROP SCHEMA storecalc/);
});

test("StoreCalc bucket writes serialize with sealing before row checks", () => {
  const firstTable = upSql.indexOf(
    "CREATE TABLE storecalc.version_spending_buckets",
  );
  const bucketStatement = upSql.indexOf(
    "CREATE TRIGGER version_spending_buckets_version_topology_lock_trigger",
  );
  const bucketRow = upSql.indexOf(
    "CREATE TRIGGER version_spending_buckets_content_mutability_trigger",
  );
  const membershipStatement = upSql.indexOf(
    "CREATE TRIGGER version_item_bucket_memberships_version_topology_lock_trigger",
  );
  const membershipRow = upSql.indexOf(
    "CREATE TRIGGER version_item_bucket_memberships_content_mutability_trigger",
  );
  assert.ok(firstTable >= 0);
  assert.ok(bucketStatement > firstTable);
  assert.ok(bucketRow > bucketStatement);
  assert.ok(membershipStatement > bucketRow);
  assert.ok(membershipRow > membershipStatement);

  for (const trigger of [
    "version_spending_buckets_version_topology_lock_trigger",
    "version_item_bucket_memberships_version_topology_lock_trigger",
  ]) {
    assert.match(
      upSql,
      new RegExp(
        `${trigger}[\\s\\S]*FOR EACH STATEMENT[\\s\\S]*lock_template_version_topology`,
      ),
    );
  }
  for (const trigger of [
    "version_spending_buckets_content_mutability_trigger",
    "version_item_bucket_memberships_content_mutability_trigger",
  ]) {
    assert.match(
      upSql,
      new RegExp(
        `${trigger}[\\s\\S]*FOR EACH ROW[\\s\\S]*assert_version_content_mutable`,
      ),
    );
  }
  assert.doesNotMatch(upSql, /CREATE FUNCTION storecalc\./);
});

test("StoreCalc bucket membership lineage and display hints are exact", () => {
  assert.match(
    upSql,
    /FOREIGN KEY \(version_item_id, version_id\)[\s\S]*REFERENCES storecalc\.version_items\(id, version_id\)/,
  );
  assert.match(
    upSql,
    /FOREIGN KEY \(spending_bucket_id, version_id\)[\s\S]*REFERENCES storecalc\.version_spending_buckets\(id, version_id\)/,
  );
  assert.match(upSql, /UNIQUE \(id, version_id\)/);
  assert.match(upSql, /UNIQUE \(version_id, stable_key\)/);
  assert.match(
    upSql,
    /version_spending_buckets_primary_display_key[\s\S]*\(version_id\)[\s\S]*WHERE is_primary_display/,
  );
  assert.match(
    upSql,
    /version_item_bucket_memberships_primary_display_key[\s\S]*\(version_item_id\)[\s\S]*WHERE primary_display/,
  );
  assert.match(upSql, /PRIMARY KEY \(version_item_id, spending_bucket_id\)/);
});

test("StoreCalc spending-bucket states match calculation bounds", () => {
  assert.deepEqual(manifest.expectedDefinitions.vocabulary, {
    limitStates: [
      "known",
      "unlimited",
      "not_applicable",
      "unknown",
      "unsupported",
    ],
    membershipTypes: ["counts_toward", "excluded", "informational_only"],
    measureCurrencyCodes: ["USD"],
    moneyMinimumMinor: "0",
    moneyMaximumMinor: CALCULATION_BOUNDS.maxMoneyMinor,
    sortOrderMinimum: 0,
    sortOrderMaximum: 1_000_000,
  });
  assert.match(
    upSql,
    /limit_state IN \([\s\S]*'known'[\s\S]*'unlimited'[\s\S]*'not_applicable'[\s\S]*'unknown'[\s\S]*'unsupported'/,
  );
  assert.match(upSql, /limit_state = 'known'[\s\S]*limit_minor >= 0/);
  assert.match(
    upSql,
    /limit_state IN \([\s\S]*'unlimited'[\s\S]*'unsupported'[\s\S]*limit_minor IS NULL/,
  );
  assert.match(
    upSql,
    /membership_type IN \([\s\S]*'counts_toward'[\s\S]*'excluded'[\s\S]*'informational_only'/,
  );
  assert.match(upSql, /measure_currency_code = 'USD'/);
  assert.match(upSql, /sort_order BETWEEN 0 AND 1000000/);
});

test("StoreCalc spending buckets remain inaccessible and unavailable", () => {
  assert.deepEqual(manifest.expectedDefinitions.capability, {
    key: "anonymous.calculation",
    schemaVersion: 4,
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
  assert.match(upSql, /SET schema_version = 4/);
  assert.doesNotMatch(upSql, /SET\s+is_available\s*=\s*true/i);
  assert.equal(manifest.productionExecution.allowed, false);
  assert.match(packageReadme, /not authorized for production execution/i);
  assert.match(packageReadme, /creates no data rows/i);
});

test("StoreCalc spending-bucket verifier preserves exact inheritance", () => {
  assert.match(upSql, /<> 107/);
  assert.match(upSql, /3:f:0006_version_content/);
  assert.match(verifySql, /<> 119/);
  assert.match(verifySql, /4:f:0007_buckets/);
  assert.doesNotMatch(verifySql, /<> 107/);
  assert.doesNotMatch(verifySql, /3:f:0006_version_content/);
  assert.match(downSql, /<> 119/);
  assert.match(downSql, /<> 107/);
  assert.ok(
    downSql.indexOf("DROP TABLE storecalc.version_spending_buckets") <
      downSql.lastIndexOf("<> 107"),
  );
});
