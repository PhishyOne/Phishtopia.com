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
    "0006_version_content"
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

test("StoreCalc version content manifest is exact and traceable", () => {
    assert.equal(manifest.formatVersion, 1);
    assert.equal(manifest.migrationKey, "0006_version_content");
    assert.equal(manifest.baseMigrationKey, "0005_template_versions");
    assert.equal(manifest.advisoryLockKey, "7356507374803211041");
    assert.deepEqual(manifest.timeouts, {
        lock: "3s",
        statement: "30s"
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
        "SC-CAT-004",
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

test("StoreCalc version content package hashes match the manifest", () => {
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

test("StoreCalc version content SQL is transactional, bounded, and closed", () => {
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
        ["version_categories", "version_items"]
    );
    assert.doesNotMatch(upSql, /\bINSERT\s+INTO\b/i);
    assert.doesNotMatch(
        upSql,
        /CREATE TABLE storecalc\.(?:version_spending_buckets|version_tax_rules|version_constraints|version_warnings|version_source_evidence|template_publications)/
    );
    assert.doesNotMatch(
        verifySql,
        /^\s*(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|GRANT|REVOKE|TRUNCATE)\s/im
    );
    assert.match(downSql, /storecalc_version_content_rollback_not_empty/);
    assert.match(downSql, /storecalc_version_content_rollback_sequence_used/);
    assert.match(downSql, /DROP TABLE storecalc\.version_items;/);
    assert.match(downSql, /DROP TABLE storecalc\.version_categories;/);
    assert.doesNotMatch(downSql, /DROP SCHEMA storecalc/);
});

test("StoreCalc child writes serialize with sealing before row checks", () => {
    const functionIndex = upSql.indexOf(
        "CREATE FUNCTION storecalc.assert_version_content_mutable()"
    );
    const categoryStatement = upSql.indexOf(
        "CREATE TRIGGER version_categories_version_topology_lock_trigger"
    );
    const categoryRow = upSql.indexOf(
        "CREATE TRIGGER version_categories_content_mutability_trigger"
    );
    const itemStatement = upSql.indexOf(
        "CREATE TRIGGER version_items_version_topology_lock_trigger"
    );
    const itemRow = upSql.indexOf(
        "CREATE TRIGGER version_items_content_mutability_trigger"
    );
    assert.ok(functionIndex >= 0);
    assert.ok(categoryStatement > functionIndex);
    assert.ok(categoryRow > categoryStatement);
    assert.ok(itemStatement > categoryRow);
    assert.ok(itemRow > itemStatement);

    for (const trigger of [
        "version_categories_version_topology_lock_trigger",
        "version_items_version_topology_lock_trigger"
    ]) {
        assert.match(
            upSql,
            new RegExp(
                `${trigger}[\\s\\S]*FOR EACH STATEMENT[\\s\\S]*lock_template_version_topology`
            )
        );
    }
    assert.doesNotMatch(
        functionBody(upSql, "storecalc_version_content_mutability_function"),
        /LOCK TABLE/
    );
});

test("StoreCalc category and item lineage is composite and restrictive", () => {
    for (const relationship of [
        /FOREIGN KEY \(version_id, template_id\)[\s\S]*REFERENCES storecalc\.template_versions\(id, template_id\)/,
        /FOREIGN KEY \(category_id, template_id\)[\s\S]*REFERENCES storecalc\.template_categories\(id, template_id\)/,
        /FOREIGN KEY \(item_id, template_id\)[\s\S]*REFERENCES storecalc\.template_items\(id, template_id\)/,
        /FOREIGN KEY \(category_version_id, version_id\)[\s\S]*REFERENCES storecalc\.version_categories\(id, version_id\)/
    ]) {
        assert.match(upSql, relationship);
    }
    assert.match(upSql, /UNIQUE \(version_id, category_id\)/);
    assert.match(upSql, /UNIQUE \(version_id, item_id\)/);
    assert.match(upSql, /storecalc_sealed_version_content_immutable/);
    assert.match(upSql, /storecalc_version_content_template_closed/);
    assert.match(upSql, /FOR KEY SHARE OF version_row, template_row/);
});

test("StoreCalc version item states match calculation bounds", () => {
    assert.deepEqual(manifest.expectedDefinitions.vocabulary, {
        priceStates: ["known", "unknown", "unsupported"],
        availabilityStates: ["available", "unavailable", "unknown"],
        moneyMinimumMinor: "0",
        moneyMaximumMinor: CALCULATION_BOUNDS.maxMoneyMinor,
        quantityMinimum: "1",
        quantityMaximum: CALCULATION_BOUNDS.maxQuantity,
        sortOrderMinimum: 0,
        sortOrderMaximum: 1_000_000
    });
    assert.match(upSql, /price_state IN \('known', 'unknown', 'unsupported'\)/);
    assert.match(
        upSql,
        /availability_state IN \('available', 'unavailable', 'unknown'\)/
    );
    assert.match(upSql, /price_state = 'known'[\s\S]*price_minor >= 0/);
    assert.match(
        upSql,
        /price_state IN \('unknown', 'unsupported'\)[\s\S]*price_minor IS NULL/
    );
    assert.match(upSql, /maximum_order_quantity >= minimum_selected_quantity/);
    assert.match(upSql, /quantity_step BETWEEN 1 AND 1000000/);
    assert.match(upSql, /sort_order BETWEEN 0 AND 1000000/);
});

test("StoreCalc version content remains inaccessible and unavailable", () => {
    assert.deepEqual(manifest.expectedDefinitions.capability, {
        key: "anonymous.calculation",
        schemaVersion: 3,
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
    assert.match(upSql, /SET schema_version = 3/);
    assert.doesNotMatch(upSql, /SET\s+is_available\s*=\s*true/i);
    assert.equal(manifest.productionExecution.allowed, false);
    assert.match(packageReadme, /not authorized for production execution/i);
    assert.match(packageReadme, /creates no data rows/i);
});

test("StoreCalc version content function hash is reproducible", () => {
    const actualHash = createHash("md5")
        .update(
            functionBody(
                upSql,
                "storecalc_version_content_mutability_function"
            )
        )
        .digest("hex");
    assert.equal(
        actualHash,
        manifest.expectedDefinitions.functions[
            "assert_version_content_mutable()"
        ]
    );
});
