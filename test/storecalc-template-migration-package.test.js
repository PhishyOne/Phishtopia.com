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
    "0004_template_identity"
);

function read(relativePath) {
    return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function sha256(contents) {
    return createHash("sha256").update(contents).digest("hex");
}

function functionBody(sql, tag) {
    const marker = `$${tag}$`;
    const start = sql.indexOf(marker);
    const end = sql.indexOf(marker, start + marker.length);
    assert.notEqual(start, -1, `${tag} opening marker is missing`);
    assert.notEqual(end, -1, `${tag} closing marker is missing`);
    return sql.slice(start + marker.length, end);
}

const manifest = JSON.parse(
    readFileSync(path.join(PACKAGE_PATH, "manifest.json"), "utf8")
);
const upSql = readFileSync(path.join(PACKAGE_PATH, "up.sql"), "utf8");
const verifySql = readFileSync(path.join(PACKAGE_PATH, "verify.sql"), "utf8");
const downSql = readFileSync(path.join(PACKAGE_PATH, "down.sql"), "utf8");
const packageReadme = readFileSync(
    path.join(PACKAGE_PATH, "README.md"),
    "utf8"
);
const implementationContract = read("docs/storecalc-implementation-contract.md");

test("StoreCalc template identity manifest is exact and traceable", () => {
    assert.equal(manifest.formatVersion, 1);
    assert.equal(manifest.migrationKey, "0004_template_identity");
    assert.equal(manifest.baseMigrationKey, "0003_program_assignments");
    assert.equal(manifest.advisoryLockKey, "7356507374803211041");
    assert.deepEqual(manifest.timeouts, {
        lock: "3s",
        statement: "30s"
    });

    assert.deepEqual(manifest.contractRequirements, [
        "SC-DAT-001",
        "SC-DAT-003",
        "SC-DAT-004",
        "SC-DB-001",
        "SC-DB-002",
        "SC-DB-003",
        "SC-DB-004",
        "SC-CAT-001",
        "SC-CAT-002",
        "SC-SEC-001",
        "SC-OPS-001",
        "SC-OPS-002",
        "SC-OPS-003",
        "SC-OPS-004",
        "SC-DEF-002"
    ]);

    for (const requirement of manifest.contractRequirements) {
        assert.match(
            implementationContract,
            new RegExp(`### ${requirement.replaceAll("-", "\\-")}:`),
            `${requirement} is absent from the authoritative contract`
        );
    }
});

test("StoreCalc template identity package hashes match the immutable manifest", () => {
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

test("StoreCalc template identity SQL is transactional, bounded, and closed", () => {
    for (const [name, sql] of [
        ["up", upSql],
        ["verify", verifySql],
        ["down", downSql]
    ]) {
        assert.match(sql, /^BEGIN;\n/);
        assert.match(sql, /\nCOMMIT;\n$/);
        assert.equal((sql.match(/\bCOMMIT;/g) ?? []).length, 1);
        assert.match(sql, /SET LOCAL lock_timeout = '3s';/);
        assert.match(sql, /SET LOCAL statement_timeout = '30s';/);
        assert.match(sql, /pg_advisory_xact_lock\(7356507374803211041\)/);
        assert.doesNotMatch(sql, /\bCASCADE\b/i, `${name} uses destructive cascade`);
        assert.doesNotMatch(sql, /\bCREATE\s+EXTENSION\b/i);
        assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP)\s+ROLE\b/i);
        assert.doesNotMatch(sql, /^\\/m, `${name} depends on psql meta-commands`);
        assert.doesNotMatch(sql, /__[_A-Z0-9]+__/);
    }

    assert.deepEqual(
        [...upSql.matchAll(/CREATE TABLE storecalc\.([a-z_]+)/g)].map(
            (match) => match[1]
        ),
        ["templates", "template_categories", "template_items"]
    );
    assert.doesNotMatch(upSql, /\bINSERT\s+INTO\b/i);
    assert.doesNotMatch(
        upSql,
        /CREATE TABLE storecalc\.(?:template_versions|template_forks|catalog_identity_events|version_items|template_publications)/
    );
    assert.doesNotMatch(
        verifySql,
        /^\s*(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|GRANT|REVOKE|TRUNCATE)\s/im
    );
    assert.match(downSql, /storecalc_template_rollback_not_empty/);
    assert.match(downSql, /storecalc_template_rollback_sequence_used/);
    assert.doesNotMatch(downSql, /DROP SCHEMA storecalc/);
});

test("StoreCalc template topology locks precede parent and child row locks", () => {
    const topologyFunction = upSql.indexOf(
        "CREATE FUNCTION storecalc.lock_template_identity_topology()"
    );
    const coherenceFunction = upSql.indexOf(
        "CREATE FUNCTION storecalc.assert_template_coherent()"
    );
    const statementTrigger = upSql.indexOf(
        "CREATE TRIGGER templates_topology_lock_trigger"
    );
    const rowTrigger = upSql.indexOf("CREATE TRIGGER templates_coherence_trigger");
    assert.ok(topologyFunction >= 0);
    assert.ok(coherenceFunction > topologyFunction);
    assert.ok(statementTrigger > coherenceFunction);
    assert.ok(rowTrigger > statementTrigger);

    assert.match(
        upSql,
        /CREATE FUNCTION storecalc\.lock_template_identity_topology\(\)[\s\S]*LOCK TABLE storecalc\.templates IN SHARE ROW EXCLUSIVE MODE/
    );
    for (const trigger of [
        "templates_topology_lock_trigger",
        "store_programs_template_topology_lock_trigger",
        "template_categories_topology_lock_trigger",
        "template_items_topology_lock_trigger"
    ]) {
        assert.match(upSql, new RegExp(`${trigger}[\\s\\S]*FOR EACH STATEMENT`));
    }

    for (const tag of [
        "storecalc_template_coherence_function",
        "storecalc_program_template_lineage_function",
        "storecalc_template_stable_identity_function"
    ]) {
        assert.doesNotMatch(functionBody(upSql, tag), /LOCK TABLE/);
    }
});

test("StoreCalc template ownership and stable identity stay fail-closed", () => {
    assert.match(upSql, /storecalc_public_template_requires_public_program/);
    assert.match(upSql, /storecalc_template_private_owner_mismatch/);
    assert.match(upSql, /storecalc_template_identity_immutable/);
    assert.match(upSql, /storecalc_templated_program_lineage_immutable/);
    assert.match(upSql, /storecalc_stable_identity_immutable/);
    assert.match(upSql, /storecalc_stable_identity_retirement_immutable/);
    assert.match(upSql, /storecalc_stable_identity_template_closed/);
    assert.match(
        upSql,
        /UNIQUE \(template_id, stable_key\)/
    );

    assert.deepEqual(manifest.expectedDefinitions.capability, {
        key: "anonymous.calculation",
        schemaVersion: 1,
        available: false,
        verified: false
    });
    assert.deepEqual(manifest.expectedDefinitions.runtimeGrants.web, [
        "SCHEMA USAGE",
        "schema_capabilities SELECT"
    ]);
    assert.deepEqual(manifest.expectedDefinitions.runtimeGrants.worker, [
        "SCHEMA USAGE",
        "schema_capabilities SELECT"
    ]);
    assert.deepEqual(manifest.expectedDefinitions.runtimeGrants.public, []);
    assert.match(upSql, /SET schema_version = 1/);
    assert.doesNotMatch(upSql, /SET\s+is_available\s*=\s*true/i);
    assert.equal(manifest.productionExecution.allowed, false);
    assert.match(packageReadme, /not authorized for production execution/i);
    assert.match(packageReadme, /creates no template fork/i);
});

test("StoreCalc template function hashes are independently reproducible", () => {
    const tagsByFunction = {
        "lock_template_identity_topology()":
            "storecalc_template_topology_lock_function",
        "assert_template_coherent()": "storecalc_template_coherence_function",
        "protect_program_template_lineage()":
            "storecalc_program_template_lineage_function",
        "protect_template_stable_identity()":
            "storecalc_template_stable_identity_function"
    };

    for (const [functionName, tag] of Object.entries(tagsByFunction)) {
        const actualHash = createHash("md5")
            .update(functionBody(upSql, tag))
            .digest("hex");
        assert.equal(
            actualHash,
            manifest.expectedDefinitions.functions[functionName],
            `${functionName} body hash changed`
        );
    }
});
