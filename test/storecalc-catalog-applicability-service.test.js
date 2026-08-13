import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    CATALOG_APPLICABILITY_TRANSITION_VERSION,
    StoreCalcCatalogApplicabilityError,
    transitionCatalogApplicability
} from "../src/storecalc/catalog/applicabilityService.js";

const ASSIGNMENT_ID = 11;
const PROGRAM_ID = 12;
const FACILITY_ID = 13;
const TEMPLATE_ID = 14;
const VERSION_ID = 21;
const SUBJECT_ID = 9;
const RECORDED_AT = "2026-08-13T23:15:30.123456Z";

function marker(sql) {
    return /\/\* storecalc:catalog-applicability:([a-z-]+) \*\//.exec(sql)?.[1] ??
        null;
}

function input(overrides = {}) {
    return {
        assignmentId: ASSIGNMENT_ID,
        programId: PROGRAM_ID,
        facilityId: FACILITY_ID,
        templateId: TEMPLATE_ID,
        selection: { mode: "exact_version", targetId: VERSION_ID },
        validFrom: "2026-01-01",
        validThrough: "2026-12-31",
        applicabilityState: "supported",
        replacesApplicabilityId: null,
        actorSubjectId: SUBJECT_ID,
        reasonCode: "reviewed_applicability",
        ...overrides
    };
}

function capability() {
    return {
        rows: [
            {
                schema_version: 9,
                is_available: false,
                verified_at: null,
                migration_key: "0012_catalog_publication_applicability"
            }
        ]
    };
}

function state(overrides = {}) {
    return {
        rows: [
            {
                assignment_id: ASSIGNMENT_ID,
                program_id: PROGRAM_ID,
                facility_id: FACILITY_ID,
                assignment_state: "supported",
                retired_at: null,
                assignment_valid_from: "2026-01-01",
                assignment_valid_through: "2026-12-31",
                program_status: "active",
                facility_status: "active",
                template_id: TEMPLATE_ID,
                template_status: "active",
                selected_version_id: VERSION_ID,
                selected_version_state: "sealed",
                selected_publication_id: null,
                replacement_id: null,
                replacement_assignment_id: null,
                replacement_program_id: null,
                replacement_facility_id: null,
                replacement_template_id: null,
                replacement_selection_mode: null,
                replacement_exact_version_id: null,
                replacement_publication_id: null,
                replacement_valid_from: null,
                replacement_valid_through: null,
                replacement_applicability_state: null,
                replacement_ended_at: null,
                replacement_lifecycle_generation: null,
                ...overrides
            }
        ]
    };
}

function replacementState(overrides = {}) {
    return state({
        replacement_id: 31,
        replacement_assignment_id: ASSIGNMENT_ID,
        replacement_program_id: PROGRAM_ID,
        replacement_facility_id: FACILITY_ID,
        replacement_template_id: TEMPLATE_ID,
        replacement_selection_mode: "exact_version",
        replacement_exact_version_id: 20,
        replacement_publication_id: null,
        replacement_valid_from: "2026-01-01",
        replacement_valid_through: "2026-06-30",
        replacement_applicability_state: "supported",
        replacement_ended_at: null,
        replacement_lifecycle_generation: 1,
        ...overrides
    });
}

function inserted(overrides = {}) {
    return {
        rows: [
            {
                id: 32,
                assignment_id: ASSIGNMENT_ID,
                program_id: PROGRAM_ID,
                facility_id: FACILITY_ID,
                template_id: TEMPLATE_ID,
                selection_mode: "exact_version",
                exact_version_id: VERSION_ID,
                publication_id: null,
                valid_from: "2026-01-01",
                valid_through: "2026-12-31",
                applicability_state: "supported",
                recorded_at: RECORDED_AT,
                lifecycle_generation: 1,
                ...overrides
            }
        ]
    };
}

function buildPool({ responses = {}, failures = {} } = {}) {
    const calls = [];
    const client = {
        async query(sql, params) {
            const name = marker(sql) ?? sql;
            calls.push({ name, params });
            if (Object.hasOwn(failures, name)) throw failures[name];
            if (Object.hasOwn(responses, name)) return responses[name];
            if (name === "capability") return capability();
            if (name === "state") return state();
            if (name === "insert") return inserted();
            return { rows: [] };
        },
        release(error) {
            calls.push({ name: "release", error });
        }
    };
    return {
        pool: { async connect() { return client; } },
        calls
    };
}

async function expectCode(action, code, path) {
    await assert.rejects(action, error => {
        assert.ok(error instanceof StoreCalcCatalogApplicabilityError);
        assert.equal(error.code, code);
        if (path !== undefined) assert.equal(error.path, path);
        return true;
    });
}

test("creates one exact applicability interval in a bounded transaction", async () => {
    const { pool, calls } = buildPool();
    const result = await transitionCatalogApplicability(pool, input());

    assert.equal(
        result.transitionVersion,
        CATALOG_APPLICABILITY_TRANSITION_VERSION
    );
    assert.equal(result.replacedApplicabilityId, null);
    assert.deepEqual(result.applicability, {
        id: 32,
        assignmentId: ASSIGNMENT_ID,
        programId: PROGRAM_ID,
        facilityId: FACILITY_ID,
        templateId: TEMPLATE_ID,
        selection: { mode: "exact_version", targetId: VERSION_ID },
        validFrom: "2026-01-01",
        validThrough: "2026-12-31",
        applicabilityState: "supported",
        recordedAt: RECORDED_AT,
        lifecycleGeneration: 1
    });
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.applicability));
    assert.ok(Object.isFrozen(result.applicability.selection));
    assert.deepEqual(
        calls.map(call => call.name),
        [
            "BEGIN ISOLATION LEVEL READ COMMITTED",
            "timeouts",
            "migration-lock",
            "topology-lock",
            "capability",
            "state",
            "insert",
            "COMMIT",
            "release"
        ]
    );
});

test("corrects only the exact open row and preserves it as closed history", async () => {
    const { pool, calls } = buildPool({
        responses: {
            state: replacementState(),
            close: { rows: [{ id: 31, lifecycle_generation: 2 }] }
        }
    });
    const result = await transitionCatalogApplicability(
        pool,
        input({ replacesApplicabilityId: 31 })
    );
    assert.equal(result.replacedApplicabilityId, 31);
    assert.deepEqual(calls.find(call => call.name === "close").params, [
        31,
        ASSIGNMENT_ID,
        TEMPLATE_ID,
        SUBJECT_ID,
        "reviewed_applicability",
        1
    ]);
    assert.ok(
        calls.findIndex(call => call.name === "close") <
            calls.findIndex(call => call.name === "insert")
    );
});

test("supports exact historical publication selection without switching it", async () => {
    const publicationInput = input({
        selection: { mode: "publication", targetId: 40 }
    });
    const { pool, calls } = buildPool({
        responses: {
            state: state({
                selected_version_id: VERSION_ID,
                selected_publication_id: 40
            }),
            insert: inserted({
                selection_mode: "publication",
                exact_version_id: null,
                publication_id: 40
            })
        }
    });
    const result = await transitionCatalogApplicability(pool, publicationInput);
    assert.deepEqual(result.applicability.selection, {
        mode: "publication",
        targetId: 40
    });
    assert.deepEqual(calls.find(call => call.name === "state").params.slice(4, 7), [
        "publication",
        40,
        null
    ]);
});

test("rejects stale, closed, cross-lineage, and unchanged replacements", async () => {
    for (const [response, code] of [
        [state(), "CURRENT_APPLICABILITY_CHANGED"],
        [replacementState({ replacement_ended_at: new Date() }), "CURRENT_APPLICABILITY_CHANGED"],
        [replacementState({ replacement_assignment_id: 99 }), "CURRENT_APPLICABILITY_CHANGED"],
        [
            replacementState({
                replacement_exact_version_id: VERSION_ID,
                replacement_valid_through: "2026-12-31"
            }),
            "APPLICABILITY_UNCHANGED"
        ]
    ]) {
        const { pool } = buildPool({ responses: { state: response } });
        await expectCode(
            () =>
                transitionCatalogApplicability(
                    pool,
                    input({ replacesApplicabilityId: 31 })
                ),
            code
        );
    }
});

test("rejects inactive lineage, out-of-assignment dates, and unsafe selection", async () => {
    for (const [response, code] of [
        [state({ assignment_state: "disputed" }), "APPLICABILITY_PARENT_INACTIVE"],
        [state({ facility_status: "closed" }), "APPLICABILITY_PARENT_INACTIVE"],
        [state({ selected_version_id: null, selected_version_state: null }), "APPLICABILITY_SELECTION_NOT_FOUND"],
        [state({ selected_version_state: "draft" }), "APPLICABILITY_VERSION_NOT_SEALED"]
    ]) {
        const { pool } = buildPool({ responses: { state: response } });
        await expectCode(() => transitionCatalogApplicability(pool, input()), code);
    }
    const { pool } = buildPool();
    await expectCode(
        () =>
            transitionCatalogApplicability(
                pool,
                input({ validFrom: null, validThrough: "2026-12-31" })
            ),
        "APPLICABILITY_INTERVAL_OUTSIDE_ASSIGNMENT"
    );
});

test("requires the exact closed 0012 capability generation", async () => {
    const { pool } = buildPool({
        responses: {
            capability: {
                rows: [
                    {
                        schema_version: 10,
                        is_available: false,
                        verified_at: null,
                        migration_key: "9999_future_schema"
                    }
                ]
            }
        }
    });
    await expectCode(
        () => transitionCatalogApplicability(pool, input()),
        "SCHEMA_CAPABILITY_UNSUPPORTED"
    );
});

test("validates the exact bounded input before opening a connection", async () => {
    const { pool } = buildPool();
    for (const invalid of [
        null,
        { ...input(), extra: true },
        { ...input(), assignmentId: 0 },
        { ...input(), selection: { mode: "newest", targetId: VERSION_ID } },
        { ...input(), selection: { mode: "exact_version", targetId: VERSION_ID, extra: true } },
        { ...input(), validFrom: "2026-02-30" },
        { ...input(), validFrom: "2027-01-01", validThrough: "2026-01-01" },
        { ...input(), applicabilityState: "unknown" },
        { ...input(), replacesApplicabilityId: undefined },
        { ...input(), actorSubjectId: "9" },
        { ...input(), reasonCode: "Not Valid" }
    ]) {
        await expectCode(
            () => transitionCatalogApplicability(pool, invalid),
            "APPLICABILITY_INPUT_INVALID"
        );
    }
});

test("rolls back failures and destroys a connection after rollback uncertainty", async () => {
    const insertError = new Error("insert failed");
    const first = buildPool({ failures: { insert: insertError } });
    await assert.rejects(
        () => transitionCatalogApplicability(first.pool, input()),
        insertError
    );
    assert.deepEqual(
        first.calls.slice(-2).map(call => call.name),
        ["ROLLBACK", "release"]
    );
    assert.equal(first.calls.at(-1).error, undefined);

    const uncertain = buildPool({
        failures: {
            insert: insertError,
            ROLLBACK: new Error("rollback failed")
        }
    });
    await expectCode(
        () => transitionCatalogApplicability(uncertain.pool, input()),
        "TRANSACTION_ROLLBACK_FAILED",
        "$.database"
    );
    assert.ok(uncertain.calls.at(-1).error instanceof Error);
});

test("stays outside routes and pins the shared topology lock order", () => {
    const source = readFileSync(
        new URL("../src/storecalc/catalog/applicabilityService.js", import.meta.url),
        "utf8"
    );
    assert.doesNotMatch(
        source,
        /(?:from|import\s*\()\s*["'](?:express|node:(?:http|https|net)|\.\.\/\.\.\/routes|\.\.\/\.\.\/controllers)/
    );
    assert.doesNotMatch(source, /process\.env|fetch\s*\(|app\.(?:get|post|use)\s*\(/);
    assert.match(
        source,
        /CASE WHEN \$5 = 'exact_version' THEN \$6::integer ELSE NULL END/
    );
    assert.match(
        source,
        /CASE WHEN \$5 = 'publication' THEN \$6::integer ELSE NULL END/
    );
    const orderedFragments = [
        "pg_advisory_xact_lock_shared(7356507374803211041)",
        "LOCK TABLE storecalc.template_versions IN SHARE ROW EXCLUSIVE MODE",
        "LOCK TABLE storecalc.program_facility_assignments IN SHARE ROW EXCLUSIVE MODE",
        "LOCK TABLE storecalc.template_publications IN SHARE ROW EXCLUSIVE MODE",
        "LOCK TABLE storecalc.assignment_template_applicability IN SHARE ROW EXCLUSIVE MODE"
    ];
    let prior = -1;
    for (const fragment of orderedFragments) {
        const current = source.indexOf(fragment);
        assert.ok(current > prior, `${fragment} is missing or out of order`);
        prior = current;
    }
});
