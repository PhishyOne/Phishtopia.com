import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
    CATALOG_RESOLVER_VERSION,
    resolvePublicCatalogVersion,
    StoreCalcCatalogResolutionError
} from "../src/storecalc/catalog/resolutionService.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const HASH = "a".repeat(64);
const INPUT = Object.freeze({
    facilityId: 11,
    programId: 22,
    templateId: 33,
    audienceKey: "general_population",
    contextDate: "2026-08-12"
});
const CAPABILITIES = Object.freeze([
    "constraints.order_aggregate.v1",
    "money.minor_units.v1",
    "quantity.bounded_integer.v1",
    "spending_buckets.parallel_pretax.v1",
    "tax.single_treatment.line_rounding.v1"
]);

function buildRow(overrides = {}) {
    return {
        schema_version: 9,
        is_available: false,
        verified_at: null,
        migration_key: "0012_catalog_publication_applicability",
        assignment_id: 44,
        facility_id: 11,
        program_id: 22,
        audience_key: "general_population",
        applicability_id: 55,
        template_id: 33,
        selection_mode: "exact_version",
        exact_version_id: 66,
        publication_id: null,
        publication_version_id: null,
        publication_is_current: null,
        version_id: 66,
        version_number: 3,
        currency_code: "USD",
        currency_exponent: 2,
        source_effective_date: "2026-08-01",
        source_published_date: "2026-07-29",
        calculation_contract_version: "storecalc.calculation.v1",
        required_capabilities: [...CAPABILITIES],
        content_schema_version: "storecalc.catalog-content.v1",
        canonicalization_version: "storecalc.canonical-json.v1",
        hash_algorithm: "sha256",
        content_hash: HASH,
        assignment_valid_from: "2026-01-01",
        assignment_valid_through: null,
        applicability_valid_from: "2026-08-01",
        applicability_valid_through: "2026-12-31",
        ...overrides
    };
}

function buildPool(rows = [buildRow()], options = {}) {
    return {
        calls: [],
        async query(sql, parameters) {
            this.calls.push({ sql, parameters });
            if (options.failure) throw options.failure;
            return options.result ?? { rows };
        }
    };
}

async function expectResolutionError(action, code, path = undefined) {
    await assert.rejects(action, error => {
        assert.ok(error instanceof StoreCalcCatalogResolutionError);
        assert.equal(error.code, code);
        if (path !== undefined) assert.equal(error.path, path);
        return true;
    });
}

test("StoreCalc resolves one exact public facility/date catalog lineage", async () => {
    const pool = buildPool();

    const result = await resolvePublicCatalogVersion(pool, INPUT);

    assert.deepEqual(pool.calls[0].parameters, [
        11,
        22,
        33,
        "general_population",
        "2026-08-12"
    ]);
    assert.equal(result.state, "resolved");
    assert.equal(result.resolverVersion, CATALOG_RESOLVER_VERSION);
    assert.deepEqual(result.context, INPUT);
    assert.deepEqual(result.lineage, {
        assignmentId: 44,
        applicabilityId: 55,
        selectionMode: "exact_version",
        exactVersionId: 66,
        publicationId: null,
        publicationIsCurrent: null,
        versionId: 66,
        facilityId: 11,
        programId: 22,
        templateId: 33,
        audienceKey: "general_population"
    });
    assert.deepEqual(result.assignmentInterval, {
        validFrom: "2026-01-01",
        validThrough: null
    });
    assert.deepEqual(result.applicabilityInterval, {
        validFrom: "2026-08-01",
        validThrough: "2026-12-31"
    });
    assert.equal(result.catalog.versionId, 66);
    assert.equal(result.catalog.contentHash, HASH);
    assert.deepEqual(result.catalog.requiredCapabilities, CAPABILITIES);
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.context));
    assert.ok(Object.isFrozen(result.lineage));
    assert.ok(Object.isFrozen(result.catalog));
    assert.ok(Object.isFrozen(result.catalog.requiredCapabilities));
});

test("StoreCalc resolves publication applicability to its exact historical version", async () => {
    const pool = buildPool([
        buildRow({
            selection_mode: "publication",
            exact_version_id: null,
            publication_id: 77,
            publication_version_id: 66,
            publication_is_current: false
        })
    ]);

    const result = await resolvePublicCatalogVersion(pool, INPUT);

    assert.equal(result.state, "resolved");
    assert.equal(result.lineage.selectionMode, "publication");
    assert.equal(result.lineage.publicationId, 77);
    assert.equal(result.lineage.publicationIsCurrent, false);
    assert.equal(result.lineage.versionId, 66);
});

test("StoreCalc returns unavailable without guessing when no candidate applies", async () => {
    const pool = buildPool([
        buildRow({
            assignment_id: null,
            applicability_id: null,
            selection_mode: null,
            exact_version_id: null,
            publication_id: null,
            publication_version_id: null,
            publication_is_current: null,
            version_id: null
        })
    ]);

    const result = await resolvePublicCatalogVersion(pool, INPUT);

    assert.deepEqual(result, {
        state: "unavailable",
        resolverVersion: CATALOG_RESOLVER_VERSION,
        context: INPUT
    });
    assert.ok(Object.isFrozen(result));
});

test("StoreCalc rejects ambiguous candidates instead of choosing by age or ID", async () => {
    const pool = buildPool([
        buildRow(),
        buildRow({ assignment_id: 45, applicability_id: 56 })
    ]);

    await expectResolutionError(
        () => resolvePublicCatalogVersion(pool, INPUT),
        "CATALOG_RESOLUTION_AMBIGUOUS"
    );
});

test("StoreCalc validates the exact resolver input before querying", async () => {
    for (const value of [
        null,
        {},
        { ...INPUT, extra: true },
        { ...INPUT, facilityId: 0 },
        { ...INPUT, programId: 2_147_483_648 },
        { ...INPUT, templateId: 3.5 },
        { ...INPUT, audienceKey: "General Population" },
        { ...INPUT, contextDate: "2026-02-30" }
    ]) {
        const pool = buildPool();
        await assert.rejects(
            () => resolvePublicCatalogVersion(pool, value),
            error => error instanceof StoreCalcCatalogResolutionError
        );
        assert.equal(pool.calls.length, 0);
    }

    await expectResolutionError(
        () => resolvePublicCatalogVersion({}, INPUT),
        "DATABASE_POOL_INVALID"
    );
});

test("StoreCalc requires the exact closed 0012 capability generation", async () => {
    for (const rows of [
        [],
        [buildRow({ schema_version: 10, migration_key: "future_migration" })],
        [buildRow({ is_available: true, verified_at: new Date() })]
    ]) {
        await expectResolutionError(
            () => resolvePublicCatalogVersion(buildPool(rows), INPUT),
            "SCHEMA_CAPABILITY_UNSUPPORTED"
        );
    }
});

test("StoreCalc rejects target, type, contract, and capability drift", async () => {
    const cases = [
        [
            { exact_version_id: 67 },
            "CATALOG_LINEAGE_INVALID"
        ],
        [
            { facility_id: 12 },
            "CATALOG_LINEAGE_INVALID"
        ],
        [
            { publication_is_current: true },
            "CATALOG_LINEAGE_INVALID"
        ],
        [
            { version_number: "3" },
            "DATABASE_TYPE_DRIFT"
        ],
        [
            { content_hash: "not-a-hash" },
            "DATABASE_TYPE_DRIFT"
        ],
        [
            { currency_code: "EUR" },
            "CATALOG_CONTRACT_UNSUPPORTED"
        ],
        [
            { required_capabilities: [...CAPABILITIES].reverse() },
            "CATALOG_CAPABILITIES_NOT_CANONICAL"
        ],
        [
            { required_capabilities: ["future.unsupported.v1"] },
            "CATALOG_CAPABILITY_UNSUPPORTED"
        ],
        [
            { source_effective_date: "2026-08-13" },
            "CATALOG_NOT_YET_EFFECTIVE"
        ]
    ];

    for (const [overrides, code] of cases) {
        await expectResolutionError(
            () =>
                resolvePublicCatalogVersion(
                    buildPool([buildRow(overrides)]),
                    INPUT
                ),
            code
        );
    }
});

test("StoreCalc resolution query is bounded, public, date-exact, and unordered by preference", async () => {
    const pool = buildPool();
    await resolvePublicCatalogVersion(pool, INPUT);
    const sql = pool.calls[0].sql;

    assert.match(sql, /LIMIT 2/);
    assert.match(sql, /facility_row\.record_scope = 'public'/);
    assert.match(sql, /program_row\.record_scope = 'public'/);
    assert.match(sql, /template_row\.visibility = 'public'/);
    assert.match(sql, /assignment_row\.assignment_state = 'supported'/);
    assert.match(sql, /applicability\.applicability_state = 'supported'/);
    assert.match(sql, /assignment_row\.valid_from <= \$5::date/);
    assert.match(sql, /applicability\.valid_from <= \$5::date/);
    assert.match(sql, /version_row\.source_effective_date <= \$5::date/);
    assert.match(sql, /ORDER BY applicability\.id/);
    assert.doesNotMatch(sql, /ORDER BY[^;]*(?:started_at|recorded_at|version_number)/s);
});

test("StoreCalc propagates database failures and rejects malformed results", async () => {
    const failure = Object.assign(new Error("synthetic database failure"), {
        code: "XX000"
    });
    await assert.rejects(
        () =>
            resolvePublicCatalogVersion(
                buildPool([], { failure }),
                INPUT
            ),
        error => error === failure
    );
    await expectResolutionError(
        () =>
            resolvePublicCatalogVersion(
                buildPool([], { result: { rowCount: 1 } }),
                INPUT
            ),
        "DATABASE_RESULT_INVALID"
    );
});

test("StoreCalc catalog resolution remains outside every runtime route", () => {
    const runtimeSources = [
        "src/routes/storecalc.routes.js",
        "src/controllers/storecalc.controller.js",
        "src/storecalc/anonymous/router.js",
        "src/storecalc/anonymous/service.js"
    ].map(relativePath => readFileSync(path.join(ROOT, relativePath), "utf8"));
    for (const source of runtimeSources) {
        assert.doesNotMatch(
            source,
            /resolutionService|resolvePublicCatalogVersion/
        );
    }

    const serviceSource = readFileSync(
        path.join(ROOT, "src/storecalc/catalog/resolutionService.js"),
        "utf8"
    );
    assert.doesNotMatch(
        serviceSource,
        /\b(?:express|router|req\.|res\.|process\.env)\b/
    );
});
