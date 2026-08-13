import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    CATALOG_PUBLICATION_TRANSITION_VERSION,
    publishCatalogVersion,
    StoreCalcCatalogPublicationError
} from "../src/storecalc/catalog/publicationService.js";

const TEMPLATE_ID = 7;
const VERSION_ID = 42;
const SUBJECT_ID = 9;
const STARTED_AT = "2026-08-13T22:15:30.123456Z";

function marker(sql) {
    return /\/\* storecalc:catalog-publish:([a-z-]+) \*\//.exec(sql)?.[1] ??
        null;
}

function input(overrides = {}) {
    return {
        templateId: TEMPLATE_ID,
        versionId: VERSION_ID,
        expectedCurrentPublicationId: null,
        actorSubjectId: SUBJECT_ID,
        reasonCode: "reviewed_publication",
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
                version_id: VERSION_ID,
                template_id: TEMPLATE_ID,
                content_state: "sealed",
                sealed_at: new Date("2026-08-01T00:00:00Z"),
                template_status: "active",
                program_status: "active",
                current_publication_id: null,
                current_version_id: null,
                current_lifecycle_generation: null,
                ...overrides
            }
        ]
    };
}

function inserted(id = 71) {
    return {
        rows: [
            {
                id,
                template_id: TEMPLATE_ID,
                version_id: VERSION_ID,
                started_at: STARTED_AT,
                lifecycle_generation: 1
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
        assert.ok(error instanceof StoreCalcCatalogPublicationError);
        assert.equal(error.code, code);
        if (path !== undefined) assert.equal(error.path, path);
        return true;
    });
}

test("publishes the first exact sealed version in one bounded transaction", async () => {
    const { pool, calls } = buildPool();
    const result = await publishCatalogVersion(pool, input());

    assert.equal(result.transitionVersion, CATALOG_PUBLICATION_TRANSITION_VERSION);
    assert.equal(result.replacedPublicationId, null);
    assert.deepEqual(result.publication, {
        id: 71,
        templateId: TEMPLATE_ID,
        versionId: VERSION_ID,
        startedAt: STARTED_AT,
        lifecycleGeneration: 1
    });
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.publication));
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
    assert.deepEqual(calls.find(call => call.name === "state").params, [
        VERSION_ID,
        TEMPLATE_ID
    ]);
});

test("replaces only the exact expected current publication", async () => {
    const currentPublicationId = 70;
    const { pool, calls } = buildPool({
        responses: {
            state: state({
                current_publication_id: currentPublicationId,
                current_version_id: 41,
                current_lifecycle_generation: 1
            }),
            close: {
                rows: [
                    { id: currentPublicationId, lifecycle_generation: 2 }
                ]
            }
        }
    });

    const result = await publishCatalogVersion(
        pool,
        input({ expectedCurrentPublicationId: currentPublicationId })
    );
    assert.equal(result.replacedPublicationId, currentPublicationId);
    assert.deepEqual(calls.find(call => call.name === "close").params, [
        currentPublicationId,
        TEMPLATE_ID,
        SUBJECT_ID,
        "reviewed_publication",
        1
    ]);
    assert.ok(
        calls.findIndex(call => call.name === "close") <
            calls.findIndex(call => call.name === "insert")
    );
});

test("rejects stale expected-current lineage before either write", async () => {
    const { pool, calls } = buildPool({
        responses: {
            state: state({
                current_publication_id: 70,
                current_version_id: 41,
                current_lifecycle_generation: 1
            })
        }
    });
    await expectCode(
        () => publishCatalogVersion(pool, input()),
        "CURRENT_PUBLICATION_CHANGED",
        "$.expectedCurrentPublicationId"
    );
    assert.equal(calls.some(call => call.name === "close"), false);
    assert.equal(calls.some(call => call.name === "insert"), false);
    assert.ok(calls.some(call => call.name === "ROLLBACK"));
});

test("rejects publishing the version that is already current", async () => {
    const { pool } = buildPool({
        responses: {
            state: state({
                current_publication_id: 70,
                current_version_id: VERSION_ID,
                current_lifecycle_generation: 1
            })
        }
    });
    await expectCode(
        () =>
            publishCatalogVersion(
                pool,
                input({ expectedCurrentPublicationId: 70 })
            ),
        "VERSION_ALREADY_CURRENT",
        "$.versionId"
    );
});

test("rejects draft versions, inactive parents, and schema drift", async () => {
    for (const [response, code] of [
        [state({ content_state: "draft", sealed_at: null }), "VERSION_NOT_SEALED"],
        [state({ template_status: "archived" }), "PUBLICATION_PARENT_INACTIVE"]
    ]) {
        const { pool } = buildPool({ responses: { state: response } });
        await expectCode(() => publishCatalogVersion(pool, input()), code);
    }
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
        () => publishCatalogVersion(pool, input()),
        "SCHEMA_CAPABILITY_UNSUPPORTED"
    );
});

test("requires one exact bounded owner transition input", async () => {
    const { pool } = buildPool();
    for (const invalid of [
        null,
        { ...input(), extra: true },
        { ...input(), templateId: 0 },
        { ...input(), versionId: 2_147_483_648 },
        { ...input(), expectedCurrentPublicationId: undefined },
        { ...input(), actorSubjectId: "9" },
        { ...input(), reasonCode: "Not Valid" },
        { ...input(), reasonCode: `a${"b".repeat(64)}` }
    ]) {
        await expectCode(
            () => publishCatalogVersion(pool, invalid),
            "PUBLICATION_INPUT_INVALID"
        );
    }
});

test("rolls back a failed write and preserves the original error", async () => {
    const databaseError = new Error("insert failed");
    const { pool, calls } = buildPool({ failures: { insert: databaseError } });
    await assert.rejects(() => publishCatalogVersion(pool, input()), databaseError);
    assert.deepEqual(
        calls.slice(-2).map(call => call.name),
        ["ROLLBACK", "release"]
    );
    assert.equal(calls.at(-1).error, undefined);
});

test("destroys a connection when rollback leaves transaction state uncertain", async () => {
    const { pool, calls } = buildPool({
        failures: {
            insert: new Error("insert failed"),
            ROLLBACK: new Error("rollback failed")
        }
    });
    await expectCode(
        () => publishCatalogVersion(pool, input()),
        "TRANSACTION_ROLLBACK_FAILED",
        "$.database"
    );
    const release = calls.at(-1);
    assert.equal(release.name, "release");
    assert.ok(release.error instanceof Error);
});

test("contains no route, environment, network, or runtime activation dependency", () => {
    const source = readFileSync(
        new URL("../src/storecalc/catalog/publicationService.js", import.meta.url),
        "utf8"
    );
    assert.doesNotMatch(
        source,
        /(?:from|import\s*\()\s*["'](?:express|node:(?:http|https|net)|\.\.\/\.\.\/routes|\.\.\/\.\.\/controllers)/
    );
    assert.doesNotMatch(source, /process\.env|fetch\s*\(|app\.(?:get|post|use)\s*\(/);
});

test("pins the shared migration lock and reviewed topology lock order", () => {
    const source = readFileSync(
        new URL("../src/storecalc/catalog/publicationService.js", import.meta.url),
        "utf8"
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
