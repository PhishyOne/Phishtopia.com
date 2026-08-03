import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
    CALCULATION_CONTRACT_VERSION,
    CANONICALIZATION_VERSION,
    CATALOG_CONTENT_SCHEMA_VERSION,
    HASH_ALGORITHM,
    SUPPORTED_CALCULATION_CAPABILITIES,
    SUPPORTED_CURRENCY_EXPONENTS
} from "../src/storecalc/calculation/core.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PACKAGE_PATH = path.join(
    ROOT,
    "migrations",
    "storecalc",
    "0005_template_versions"
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

test("StoreCalc template version manifest is exact and traceable", () => {
    assert.equal(manifest.formatVersion, 1);
    assert.equal(manifest.migrationKey, "0005_template_versions");
    assert.equal(manifest.baseMigrationKey, "0004_template_identity");
    assert.equal(manifest.advisoryLockKey, "7356507374803211041");
    assert.deepEqual(manifest.timeouts, {
        lock: "3s",
        statement: "30s"
    });

    assert.deepEqual(manifest.contractRequirements, [
        "SC-DAT-001",
        "SC-DAT-003",
        "SC-DAT-004",
        "SC-DAT-006",
        "SC-DB-001",
        "SC-DB-002",
        "SC-DB-003",
        "SC-DB-004",
        "SC-CAT-003",
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

test("StoreCalc template version package hashes match the immutable manifest", () => {
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

test("StoreCalc template version SQL is transactional, bounded, and closed", () => {
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
        ["template_versions"]
    );
    assert.doesNotMatch(upSql, /\bINSERT\s+INTO\b/i);
    assert.doesNotMatch(
        upSql,
        /CREATE TABLE storecalc\.(?:version_categories|version_items|version_prices|version_rules|version_evidence|template_publications|template_applicability)/
    );
    assert.doesNotMatch(
        verifySql,
        /^\s*(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|GRANT|REVOKE|TRUNCATE)\s/im
    );
    assert.match(downSql, /storecalc_template_version_rollback_not_empty/);
    assert.match(downSql, /storecalc_template_version_rollback_sequence_used/);
    assert.match(downSql, /DROP TABLE storecalc\.template_versions;/);
    assert.doesNotMatch(downSql, /DROP SCHEMA storecalc/);
});

test("StoreCalc template version locks establish a single topology order", () => {
    const topologyFunction = upSql.indexOf(
        "CREATE FUNCTION storecalc.lock_template_version_topology()"
    );
    const coherenceFunction = upSql.indexOf(
        "CREATE FUNCTION storecalc.assert_template_version_coherent()"
    );
    const statementTrigger = upSql.indexOf(
        "CREATE TRIGGER template_versions_topology_lock_trigger"
    );
    const rowTrigger = upSql.indexOf(
        "CREATE TRIGGER template_versions_coherence_trigger"
    );
    const parentTrigger = upSql.indexOf(
        "CREATE TRIGGER templates_version_topology_lock_trigger"
    );
    assert.ok(topologyFunction >= 0);
    assert.ok(coherenceFunction > topologyFunction);
    assert.ok(statementTrigger > coherenceFunction);
    assert.ok(rowTrigger > statementTrigger);
    assert.ok(parentTrigger > rowTrigger);

    assert.match(
        upSql,
        /CREATE FUNCTION storecalc\.lock_template_version_topology\(\)[\s\S]*LOCK TABLE storecalc\.template_versions IN SHARE ROW EXCLUSIVE MODE/
    );
    for (const trigger of [
        "template_versions_topology_lock_trigger",
        "templates_version_topology_lock_trigger"
    ]) {
        assert.match(upSql, new RegExp(`${trigger}[\\s\\S]*FOR EACH STATEMENT`));
    }
    assert.doesNotMatch(
        functionBody(upSql, "storecalc_template_version_coherence_function"),
        /LOCK TABLE/
    );
});

test("StoreCalc version headers preserve immutable sealed ancestry", () => {
    for (const guard of [
        "storecalc_template_version_lineage_immutable",
        "storecalc_template_version_must_start_draft",
        "storecalc_sealed_template_version_immutable",
        "storecalc_sealed_template_version_delete_forbidden",
        "storecalc_template_version_template_closed",
        "storecalc_template_version_capabilities_not_canonical",
        "storecalc_template_version_capability_duplicate",
        "storecalc_template_version_self_ancestry",
        "storecalc_template_version_base_missing",
        "storecalc_template_version_base_not_sealed"
    ]) {
        assert.match(upSql, new RegExp(guard));
    }

    assert.match(upSql, /UNIQUE \(template_id, version_number\)/);
    assert.match(
        upSql,
        /FOREIGN KEY \(based_on_version_id, template_id\)[\s\S]*REFERENCES storecalc\.template_versions\(id, template_id\)/
    );
    assert.match(upSql, /content_state IN \('draft', 'sealed'\)/);
    assert.match(upSql, /content_hash ~ '\^\[a-f0-9\]\{64\}\$'/);
    assert.match(upSql, /OLD\.content_state = 'sealed' AND NEW IS DISTINCT FROM OLD/);
});

test("StoreCalc version vocabulary is identical to the shipped engine", () => {
    assert.deepEqual(manifest.expectedDefinitions.vocabulary, {
        calculationContractVersion: CALCULATION_CONTRACT_VERSION,
        contentSchemaVersion: CATALOG_CONTENT_SCHEMA_VERSION,
        canonicalizationVersion: CANONICALIZATION_VERSION,
        hashAlgorithm: HASH_ALGORITHM,
        currencies: SUPPORTED_CURRENCY_EXPONENTS,
        requiredCapabilities: SUPPORTED_CALCULATION_CAPABILITIES
    });

    for (const value of [
        CALCULATION_CONTRACT_VERSION,
        CATALOG_CONTENT_SCHEMA_VERSION,
        CANONICALIZATION_VERSION,
        HASH_ALGORITHM,
        ...SUPPORTED_CALCULATION_CAPABILITIES
    ]) {
        assert.match(upSql, new RegExp(value.replaceAll(".", "\\.")));
    }
    assert.match(upSql, /currency_code = 'USD' AND currency_exponent = 2/);
});

test("StoreCalc template versions stay inaccessible and unavailable", () => {
    assert.deepEqual(manifest.expectedDefinitions.capability, {
        key: "anonymous.calculation",
        schemaVersion: 2,
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
    assert.match(upSql, /SET schema_version = 2/);
    assert.doesNotMatch(upSql, /SET\s+is_available\s*=\s*true/i);
    assert.equal(manifest.productionExecution.allowed, false);
    assert.match(packageReadme, /not authorized for production execution/i);
    assert.match(packageReadme, /creates no version category/i);
});

test("StoreCalc template version function hashes are reproducible", () => {
    const tagsByFunction = {
        "lock_template_version_topology()":
            "storecalc_template_version_topology_function",
        "assert_template_version_coherent()":
            "storecalc_template_version_coherence_function"
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
