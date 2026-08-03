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
    "0003_program_assignments"
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

test("StoreCalc program manifest is exact and traceable", () => {
    assert.equal(manifest.formatVersion, 1);
    assert.equal(manifest.migrationKey, "0003_program_assignments");
    assert.equal(manifest.baseMigrationKey, "0002_directory_lineage");
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
        "SC-APP-001",
        "SC-APP-002",
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

test("StoreCalc program package hashes match the immutable manifest", () => {
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

test("StoreCalc program SQL is transactional, bounded, and closed", () => {
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
        assert.doesNotMatch(sql, /\bCASCADE\b/i, `${name} uses destructive cascade`);
        assert.doesNotMatch(sql, /\bCREATE\s+EXTENSION\b/i);
        assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP)\s+ROLE\b/i);
        assert.doesNotMatch(sql, /^\\/m, `${name} depends on psql meta-commands`);
        assert.doesNotMatch(sql, /__[_A-Z0-9]+__/);
    }

    assert.match(upSql, /CREATE TABLE storecalc\.store_programs/);
    assert.match(upSql, /CREATE TABLE storecalc\.program_facility_assignments/);
    assert.doesNotMatch(upSql, /\bINSERT\s+INTO\b/i);
    assert.doesNotMatch(upSql, /CREATE TABLE storecalc\.(?:templates|orders|evidence)/);
    assert.doesNotMatch(
        verifySql,
        /^\s*(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|GRANT|REVOKE|TRUNCATE)\s/im
    );
    assert.match(downSql, /storecalc_program_rollback_not_empty/);
    assert.match(downSql, /storecalc_program_rollback_sequence_used/);
    assert.doesNotMatch(downSql, /DROP SCHEMA storecalc/);
});

test("StoreCalc assignment serialization takes the table lock before row locks", () => {
    const statementTrigger = upSql.indexOf(
        "CREATE TRIGGER program_facility_assignments_topology_lock_trigger"
    );
    const rowTrigger = upSql.indexOf(
        "CREATE TRIGGER program_facility_assignments_coherent_trigger"
    );
    assert.ok(statementTrigger >= 0);
    assert.ok(rowTrigger > statementTrigger);

    assert.match(
        upSql,
        /CREATE FUNCTION storecalc\.lock_program_assignment_topology\(\)[\s\S]*LOCK TABLE storecalc\.program_facility_assignments IN SHARE ROW EXCLUSIVE MODE/
    );
    assert.match(
        upSql,
        /program_facility_assignments_topology_lock_trigger[\s\S]*FOR EACH STATEMENT/
    );
    assert.match(
        upSql,
        /store_programs_assignment_topology_lock_trigger[\s\S]*FOR EACH STATEMENT/
    );
    assert.match(
        upSql,
        /facilities_assignment_topology_lock_trigger[\s\S]*FOR EACH STATEMENT/
    );
    assert.match(
        upSql,
        /agencies_assignment_topology_lock_trigger[\s\S]*FOR EACH STATEMENT/
    );

    const assignmentBody = functionBody(
        upSql,
        "storecalc_program_assignment_function"
    );
    const programBody = functionBody(upSql, "storecalc_program_lineage_function");
    const parentBody = functionBody(
        upSql,
        "storecalc_program_parent_lineage_function"
    );
    assert.doesNotMatch(assignmentBody, /LOCK TABLE/);
    assert.doesNotMatch(programBody, /LOCK TABLE/);
    assert.doesNotMatch(parentBody, /LOCK TABLE/);
    assert.match(assignmentBody, /daterange\([\s\S]*&& daterange\(/);
});

test("StoreCalc programs are shared while evidence and runtime access stay closed", () => {
    const programsStart = upSql.indexOf(
        "CREATE TABLE storecalc.store_programs"
    );
    const assignmentsStart = upSql.indexOf(
        "CREATE TABLE storecalc.program_facility_assignments"
    );
    const programsDefinition = upSql.slice(programsStart, assignmentsStart);

    assert.doesNotMatch(programsDefinition, /\bfacility_id\b/);
    assert.match(
        upSql,
        /CONSTRAINT program_facility_assignments_evidence_deferred_check\s+CHECK \(source_evidence_id IS NULL\)/
    );
    assert.match(upSql, /storecalc_assignment_agency_country_mismatch/);
    assert.match(upSql, /storecalc_assignment_private_owner_mismatch/);
    assert.match(upSql, /storecalc_assignment_supported_interval_overlap/);
    assert.match(upSql, /storecalc_assigned_program_lineage_immutable/);
    assert.match(upSql, /storecalc_assigned_facility_lineage_immutable/);
    assert.match(upSql, /storecalc_assigned_agency_country_immutable/);

    assert.deepEqual(manifest.expectedDefinitions.capability, {
        key: "public.directory",
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
    assert.match(packageReadme, /creates no program, assignment/i);
    assert.match(packageReadme, /source_evidence_id.*constrained\s+to `NULL`/is);
});

test("StoreCalc program function hashes are independently reproducible", () => {
    const tagsByFunction = {
        "lock_program_assignment_topology()":
            "storecalc_program_topology_lock_function",
        "assert_program_assignment_coherent()":
            "storecalc_program_assignment_function",
        "protect_store_program_assignment_lineage()":
            "storecalc_program_lineage_function",
        "protect_program_assignment_parent_lineage()":
            "storecalc_program_parent_lineage_function"
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
