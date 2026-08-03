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
    "0001_schema_foundation"
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
const upSql = read("migrations/storecalc/0001_schema_foundation/up.sql");
const verifySql = read("migrations/storecalc/0001_schema_foundation/verify.sql");
const downSql = read("migrations/storecalc/0001_schema_foundation/down.sql");
const packageReadme = read(
    "migrations/storecalc/0001_schema_foundation/README.md"
);

test("StoreCalc foundation manifest is exact and traceable", () => {
    assert.equal(manifest.formatVersion, 1);
    assert.equal(manifest.migrationKey, "0001_schema_foundation");
    assert.equal(manifest.advisoryLockKey, "7356507374803211041");
    assert.deepEqual(manifest.timeouts, {
        lock: "3s",
        statement: "30s"
    });
    assert.deepEqual(manifest.contractRequirements, [
        "SC-FND-006",
        "SC-DAT-001",
        "SC-DAT-003",
        "SC-DB-001",
        "SC-OPS-001",
        "SC-OPS-003",
        "SC-OPS-004",
        "SC-DEF-002"
    ]);

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
});

test("StoreCalc foundation package hashes match the immutable manifest", () => {
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

test("StoreCalc foundation SQL is transaction-bound and narrowly scoped", () => {
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
        assert.doesNotMatch(sql, /\bIF\s+NOT\s+EXISTS\b/i, `${name} blesses unknown state`);
        assert.doesNotMatch(sql, /\bCASCADE\b/i, `${name} uses destructive cascade`);
        assert.doesNotMatch(sql, /\bCREATE\s+EXTENSION\b/i);
        assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP)\s+ROLE\b/i);
        assert.doesNotMatch(sql, /\bpublic\.users\b/i);
        assert.doesNotMatch(sql, /^\\/m, `${name} depends on psql meta-commands`);
    }

    assert.match(upSql, /CREATE SCHEMA storecalc AUTHORIZATION CURRENT_USER;/);
    assert.match(upSql, /CREATE TABLE storecalc\.schema_capabilities/);
    assert.match(upSql, /REVOKE ALL ON SCHEMA storecalc FROM PUBLIC;/);
    assert.match(upSql, /storecalc_configured_role_is_overprivileged/);
    assert.match(upSql, /storecalc_configured_roles_must_not_inherit_each_other/);
    assert.match(upSql, /storecalc_schema_already_exists/);
    assert.equal((upSql.match(/EXECUTE format\(/g) || []).length, 3);
    assert.doesNotMatch(upSql, /EXECUTE\s+[^;]*\|\|/i);

    assert.doesNotMatch(
        verifySql,
        /^\s*(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|GRANT|REVOKE|TRUNCATE)\s/im
    );
    assert.match(downSql, /storecalc_rollback_capability_state_changed/);
    assert.match(downSql, /DROP TABLE storecalc\.schema_capabilities;/);
    assert.match(downSql, /DROP SCHEMA storecalc;/);
});

test("StoreCalc product capabilities remain explicitly unavailable", () => {
    const capabilities = manifest.expectedDefinitions.capabilities;
    assert.deepEqual(capabilities["schema.foundation"], {
        id: 1,
        schemaVersion: 1,
        available: true
    });

    const productCapabilities = Object.entries(capabilities).filter(
        ([key]) => key !== "schema.foundation"
    );
    assert.equal(productCapabilities.length, 7);

    for (const [index, [key, state]] of productCapabilities.entries()) {
        assert.equal(state.id, index + 2, `${key} has unexpected identity`);
        assert.equal(state.schemaVersion, 0, `${key} has unexpected schema`);
        assert.equal(state.available, false, `${key} was enabled early`);
    }

    const capabilityFingerprints = Object.entries(capabilities).map(
        ([key, state]) =>
            `${state.id}:${key}:${state.schemaVersion}:${state.available ? "t" : "f"}:0001_schema_foundation`
    );
    for (const sql of [verifySql, downSql]) {
        for (const fingerprint of capabilityFingerprints) {
            assert.ok(
                sql.includes(`'${fingerprint}'`),
                `${fingerprint} must use PostgreSQL's canonical boolean output`
            );
        }
    }

    assert.equal(manifest.expectedDefinitions.constraints.length, 6);
    assert.equal(manifest.expectedDefinitions.indexes.length, 2);
    assert.equal(manifest.expectedDefinitions.columns.length, 7);
    assert.deepEqual(manifest.expectedDefinitions.sequence, {
        name: "storecalc.schema_capabilities_id_seq",
        start: 1,
        increment: 1,
        minimum: 1,
        maximum: 2147483647,
        cache: 1,
        cycle: false,
        lastValue: 8,
        isCalled: true
    });

    assert.equal(manifest.productionExecution.allowed, false);
    assert.match(manifest.productionExecution.reason, /SC-OPS-002/);
    assert.match(manifest.productionExecution.reason, /SC-OPS-004/);
    assert.match(packageReadme, /not authorized for production execution/i);
    assert.match(packageReadme, /Generic SQL or shell input remains forbidden/);
});
