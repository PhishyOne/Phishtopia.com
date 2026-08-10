import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { CATALOG_SOURCE_EVIDENCE_RELATIONSHIPS } from "../src/storecalc/catalog/content.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PACKAGE_PATH = path.join(
  ROOT,
  "migrations",
  "storecalc",
  "0011_source_evidence",
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
const databaseAcceptance = read("test-db/storecalc-source-evidence.test.js");

test("StoreCalc source-evidence manifest is exact and traceable", () => {
  assert.equal(manifest.formatVersion, 1);
  assert.equal(manifest.migrationKey, "0011_source_evidence");
  assert.equal(manifest.baseMigrationKey, "0010_warnings");
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

test("StoreCalc source-evidence package hashes match the manifest", () => {
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

test("StoreCalc source-evidence SQL is transactional, bounded, and closed", () => {
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
    "evidence",
    "evidence_groups",
    "version_source_evidence",
  ]) {
    assert.equal(
      (
        upSql.match(new RegExp(`CREATE TABLE storecalc\\.${table} \\(`, "g")) ??
        []
      ).length,
      1,
    );
    assert.doesNotMatch(
      verifySql,
      new RegExp(`CREATE TABLE storecalc\\.${table}`),
    );
  }
  assert.doesNotMatch(
    downSql,
    /DROP TABLE(?! storecalc\.(?:version_source_evidence|evidence_groups|evidence);)/,
  );
  assert.match(downSql, /storecalc_source_evidence_rollback_not_empty/);
  assert.match(downSql, /storecalc_source_evidence_rollback_sequence_used/);
});

test("StoreCalc evidence V1 is metadata-only and fingerprint-bound", () => {
  assert.deepEqual(CATALOG_SOURCE_EVIDENCE_RELATIONSHIPS, ["supports_catalog"]);
  assert.deepEqual(manifest.expectedDefinitions.vocabulary, {
    sourceTypes: ["external_citation"],
    relationshipTypes: ["supports_catalog"],
    groupingTypes: ["source_lineage"],
    metadataVisibility: ["private", "public_citation"],
    privacyStates: [
      "pending_review",
      "metadata_safe",
      "restricted",
      "withdrawn",
    ],
    redistributionStates: ["metadata_only"],
    independenceStates: ["unreviewed", "accepted", "disputed", "superseded"],
    fingerprintAlgorithm: "sha256",
  });
  assert.match(upSql, /source_type = 'external_citation'/);
  assert.match(upSql, /relationship_type = 'supports_catalog'/);
  assert.match(upSql, /grouping_type = 'source_lineage'/);
  assert.match(upSql, /normalized_fingerprint ~ '\^\[a-f0-9\]\{64\}\$'/);
  assert.match(upSql, /canonical_fingerprint ~ '\^\[a-f0-9\]\{64\}\$'/);
  assert.match(upSql, /redistribution_state = 'metadata_only'/);
  assert.doesNotMatch(
    upSql,
    /private_object_key|public_object_key|original_filename|artifact_hash|upload_id/,
  );
});

test("StoreCalc source links serialize with sealing and require eligible identities", () => {
  const topology = upSql.indexOf(
    "CREATE TRIGGER version_source_evidence_version_topology_lock_trigger",
  );
  const mutability = upSql.indexOf(
    "CREATE TRIGGER version_source_evidence_content_mutability_trigger",
  );
  const eligibility = upSql.indexOf(
    "CREATE TRIGGER version_source_evidence_eligibility_trigger",
  );
  assert.ok(topology > 0);
  assert.ok(mutability > topology);
  assert.ok(eligibility > mutability);
  assert.match(
    upSql,
    /version_source_evidence_version_topology_lock_trigger[\s\S]*lock_template_version_topology/,
  );
  assert.match(
    upSql,
    /version_source_evidence_content_mutability_trigger[\s\S]*assert_version_content_mutable/,
  );
  assert.match(
    upSql,
    /privacy_state = 'metadata_safe'[\s\S]*withdrawn_at IS NULL[\s\S]*FOR KEY SHARE/,
  );
  assert.match(
    upSql,
    /independence_state = 'accepted'[\s\S]*superseded_at IS NULL[\s\S]*FOR KEY SHARE/,
  );
  assert.match(upSql, /PRIMARY KEY \(version_id, evidence_id\)/);
});

test("StoreCalc evidence identities cannot be silently rewritten", () => {
  assert.match(
    upSql,
    /evidence_identity_immutable_trigger[\s\S]*BEFORE UPDATE OR DELETE[\s\S]*forbid_evidence_identity_mutation/,
  );
  assert.match(
    upSql,
    /evidence_groups_identity_immutable_trigger[\s\S]*BEFORE UPDATE OR DELETE[\s\S]*forbid_evidence_identity_mutation/,
  );
  assert.match(
    upSql,
    /md5\(procedure\.prosrc\) = 'ebf743b2d03208d0df7380007e9a2174'/,
  );
  assert.match(
    upSql,
    /md5\(procedure\.prosrc\) = 'e3f684e20087926812811534788ae045'/,
  );
  assert.match(
    packageReadme,
    /append-only events before enabling any state transition/i,
  );
});

test("StoreCalc source-evidence verifier fingerprints every V1 check", () => {
  const exactCheckNames = [
    "evidence_language_tag_check",
    "evidence_lifecycle_generation_check",
    "evidence_metadata_visibility_check",
    "evidence_normalized_fingerprint_check",
    "evidence_privacy_state_check",
    "evidence_redistribution_state_check",
    "evidence_source_title_check",
    "evidence_source_type_check",
    "evidence_source_url_check",
    "evidence_withdrawal_state_check",
    "evidence_groups_canonical_fingerprint_check",
    "evidence_groups_grouping_type_check",
    "evidence_groups_independence_state_check",
    "evidence_groups_supersession_state_check",
    "version_source_evidence_relationship_type_check",
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

test("StoreCalc source evidence remains inaccessible and unavailable", () => {
  assert.deepEqual(manifest.expectedDefinitions.capability, {
    key: "anonymous.calculation",
    schemaVersion: 8,
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
  assert.match(upSql, /SET schema_version = 8/);
  assert.doesNotMatch(upSql, /SET\s+is_available\s*=\s*true/i);
  assert.equal(manifest.productionExecution.allowed, false);
  assert.match(packageReadme, /not authorized for production execution/i);
  assert.match(packageReadme, /creates no\s+rows/i);
});

test("StoreCalc source-evidence verifier preserves exact inheritance", () => {
  assert.match(upSql, /<> 140/);
  assert.match(upSql, /7:f:0010_warnings/);
  assert.match(upSql, /<> 155/);
  assert.match(upSql, /8:f:0011_source_evidence/);

  assert.equal((verifySql.match(/<> 155\b/g) ?? []).length, 8);
  assert.equal((verifySql.match(/<> 41\b/g) ?? []).length, 8);
  assert.equal((verifySql.match(/<> 16\b/g) ?? []).length, 8);
  assert.equal(
    (verifySql.match(/8:f:0011_source_evidence/g) ?? []).length,
    8,
  );
  assert.doesNotMatch(verifySql, /<> (?:140|36|14)\b/);
  assert.doesNotMatch(verifySql, /7:f:0010_warnings/);
  assert.doesNotMatch(verifySql, /<> 133/);
  assert.doesNotMatch(verifySql, /6:f:0009_constraints/);

  assert.equal((downSql.match(/<> 155\b/g) ?? []).length, 8);
  assert.equal((downSql.match(/<> 41\b/g) ?? []).length, 8);
  assert.equal((downSql.match(/<> 16\b/g) ?? []).length, 8);
  assert.equal(
    (downSql.match(/8:f:0011_source_evidence/g) ?? []).length,
    8,
  );
  assert.equal((downSql.match(/<> 140\b/g) ?? []).length, 7);
  assert.equal((downSql.match(/<> 36\b/g) ?? []).length, 7);
  assert.equal((downSql.match(/<> 14\b/g) ?? []).length, 7);
  assert.equal((downSql.match(/7:f:0010_warnings/g) ?? []).length, 7);

  assert.equal(
    (
      databaseAcceptance.match(
        /"storecalc_template_postflight_relation_mismatch"/g,
      ) ?? []
    ).length,
    2,
  );
  assert.doesNotMatch(
    databaseAcceptance,
    /"storecalc_version_warnings_postflight_relation_mismatch"/,
  );
});

test("StoreCalc evidence lifecycle expansion remains explicit", () => {
  for (const deferral of [
    "private uploads and extraction",
    "public evidence artifacts and object storage",
    "append-only evidence-group and withdrawal events",
    "canonical database extraction and the sealing transaction",
    "publication, applicability, profiles, and orders",
    "real catalog rows and source claims",
    "runtime catalog grants and routes",
    "production migration execution",
  ]) {
    assert.ok(manifest.deferred.includes(deferral), deferral);
  }
});
