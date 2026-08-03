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
    "0002_directory_lineage"
);

function read(relativePath) {
    return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function sha256(contents) {
    return createHash("sha256").update(contents).digest("hex");
}

const manifest = JSON.parse(
    readFileSync(path.join(PACKAGE_PATH, "manifest.json"), "utf8")
);
const upSql = read("migrations/storecalc/0002_directory_lineage/up.sql");
const verifySql = read(
    "migrations/storecalc/0002_directory_lineage/verify.sql"
);
const downSql = read("migrations/storecalc/0002_directory_lineage/down.sql");
const packageReadme = read(
    "migrations/storecalc/0002_directory_lineage/README.md"
);

test("StoreCalc directory manifest is exact and traceable", () => {
    assert.equal(manifest.formatVersion, 1);
    assert.equal(manifest.migrationKey, "0002_directory_lineage");
    assert.equal(manifest.baseMigrationKey, "0001_schema_foundation");
    assert.equal(manifest.advisoryLockKey, "7356507374803211041");
    assert.deepEqual(manifest.timeouts, {
        lock: "3s",
        statement: "30s"
    });

    const implementationContract = read(
        "docs/storecalc-implementation-contract.md"
    );
    for (const requirement of manifest.contractRequirements) {
        assert.match(
            implementationContract,
            new RegExp(`^### ${requirement}:`, "m"),
            `${requirement} must exist in the authoritative contract`
        );
    }

    assert.deepEqual(manifest.contractRequirements, [
        "SC-PRV-001",
        "SC-DIR-001",
        "SC-DIR-002",
        "SC-DIR-003",
        "SC-DB-001",
        "SC-DB-002",
        "SC-DB-003",
        "SC-DB-004",
        "SC-OPS-001",
        "SC-OPS-002",
        "SC-OPS-003",
        "SC-OPS-004",
        "SC-DEF-002"
    ]);
});

test("StoreCalc directory package hashes match the immutable manifest", () => {
    const sortedFiles = [...manifest.files].sort((left, right) => {
        if (left.path < right.path) return -1;
        if (left.path > right.path) return 1;
        return 0;
    });
    const bundleLines = [];

    for (const file of sortedFiles) {
        const contents = read(file.path);
        const actualHash = sha256(contents);

        assert.match(file.sha256, /^[a-f0-9]{64}$/);
        assert.equal(actualHash, file.sha256, `${file.path} checksum changed`);
        bundleLines.push(`${actualHash}  ${file.path}\n`);
    }

    assert.equal(sha256(bundleLines.join("")), manifest.bundleSha256);
});

test("StoreCalc directory SQL is transactional, bounded, and gated", () => {
    for (const [name, sql] of [
        ["up", upSql],
        ["verify", verifySql],
        ["down", downSql]
    ]) {
        assert.match(sql, /^BEGIN;\n/);
        assert.match(sql, /\nCOMMIT;\n$/);
        assert.match(sql, /SET LOCAL lock_timeout = '3s';/);
        assert.match(sql, /SET LOCAL statement_timeout = '30s';/);
        assert.match(sql, /pg_advisory_xact_lock\(7356507374803211041\)/);
        assert.doesNotMatch(
            sql,
            /\bCREATE\s+(?:SCHEMA|TABLE|INDEX|FUNCTION|TRIGGER|EXTENSION)\s+IF\s+NOT\s+EXISTS\b/i,
            `${name} blesses an unknown object definition`
        );
        assert.doesNotMatch(sql, /\bCASCADE\b/i, `${name} uses destructive cascade`);
        assert.doesNotMatch(sql, /\bCREATE\s+EXTENSION\b/i);
        assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP)\s+ROLE\b/i);
        assert.doesNotMatch(sql, /^\\/m, `${name} depends on psql meta-commands`);
    }

    assert.match(upSql, /storecalc_directory_foundation_relation_mismatch/);
    assert.match(upSql, /storecalc_directory_users_identity_mismatch/);
    assert.match(upSql, /LOCK TABLE storecalc\.jurisdictions IN SHARE ROW EXCLUSIVE MODE/);
    assert.match(upSql, /LOCK TABLE storecalc\.facilities IN SHARE ROW EXCLUSIVE MODE/);
    assert.match(upSql, /CREATE TABLE storecalc\.reviewed_timezones/);
    assert.match(upSql, /CREATE TABLE storecalc\.facilities/);
    assert.match(upSql, /REVOKE ALL ON FUNCTION/);
    assert.doesNotMatch(upSql, /INSERT INTO storecalc\.(?!schema_capabilities)/);
    assert.doesNotMatch(upSql, /CREATE TABLE storecalc\.(?:templates|orders|store_programs)/);

    assert.doesNotMatch(
        verifySql,
        /^\s*(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|GRANT|REVOKE|TRUNCATE)\s/im
    );
    assert.match(verifySql, /storecalc_directory_function_definition_mismatch/);
    assert.match(verifySql, /storecalc_directory_foreign_key_definition_mismatch/);
    assert.match(verifySql, /storecalc_directory_unexpected_grantee/);
    assert.match(verifySql, /identity_table_name text;/);
    assert.doesNotMatch(verifySql, /\n\s+table_name text;/);

    for (const sql of [verifySql, downSql]) {
        assert.match(sql, /FROM information_schema\.columns AS column_row/);
        assert.match(sql, /column_row\.table_name/);
        assert.match(sql, /column_row\.ordinal_position/);
    }

    assert.match(downSql, /storecalc_directory_rollback_not_empty/);
    assert.match(downSql, /storecalc_directory_rollback_sequence_used/);
    assert.doesNotMatch(downSql, /DROP SCHEMA storecalc/);
});

test("StoreCalc directory capability and runtime access remain closed", () => {
    assert.deepEqual(manifest.expectedDefinitions.capability, {
        key: "public.directory",
        schemaVersion: 1,
        available: false,
        verified: false
    });

    assert.match(upSql, /'2:public\.directory:0:f:0001_schema_foundation'/);
    assert.match(verifySql, /'2:public\.directory:1:f:0002_directory_lineage'/);
    assert.match(downSql, /'2:public\.directory:1:f:0002_directory_lineage'/);
    assert.doesNotMatch(upSql, /SET\s+is_available\s*=\s*true/i);

    assert.deepEqual(manifest.expectedDefinitions.runtimeGrants.web, [
        "SCHEMA USAGE",
        "schema_capabilities SELECT"
    ]);
    assert.deepEqual(manifest.expectedDefinitions.runtimeGrants.worker, [
        "SCHEMA USAGE",
        "schema_capabilities SELECT"
    ]);
    assert.deepEqual(manifest.expectedDefinitions.runtimeGrants.public, []);

    assert.equal(manifest.productionExecution.allowed, false);
    assert.match(manifest.productionExecution.reason, /SC-OPS-002/);
    assert.match(manifest.productionExecution.reason, /SC-OPS-004/);
    assert.match(packageReadme, /not authorized for production execution/i);
    assert.match(packageReadme, /creates no country, facility, alias, source/i);
    assert.match(packageReadme, /public\.directory.*remains unavailable/is);
});
