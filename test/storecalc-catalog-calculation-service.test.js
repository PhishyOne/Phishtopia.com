import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
    CATALOG_CALCULATION_ORCHESTRATION_VERSION,
    createCatalogCalculationOrchestrator,
    StoreCalcCatalogCalculationError
} from "../src/storecalc/catalog/calculationService.js";
import { StoreCalcCalculationError } from "../src/storecalc/calculation/core.js";
import { projectCatalogVersionContent } from "../src/storecalc/catalog/configurationProjector.js";
import { buildSyntheticCatalogContent } from "./fixtures/storecalc-catalog-content-fixture.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONTEXT = Object.freeze({
    facilityId: 11,
    programId: 22,
    templateId: 33,
    audienceKey: "general_population",
    contextDate: "2026-08-14"
});
const CONFIGURATION = projectCatalogVersionContent(
    buildSyntheticCatalogContent(),
    { configurationKey: `sc.${"a".repeat(61)}` }
);

function buildRequest(overrides = {}) {
    return {
        ...CONTEXT,
        configurationHash: CONFIGURATION.contentHash,
        quantities: [{ itemKey: "sample_soup", quantity: "2" }],
        availableFundsMinor: "500",
        ...overrides
    };
}

function buildResolved(overrides = {}) {
    return {
        state: "resolved",
        orchestrationVersion: "storecalc.catalog-request-orchestration.v1",
        resolverVersion: "storecalc.catalog-resolution.v1",
        projectionVersion: "storecalc.catalog-configuration-projection.v1",
        context: { ...CONTEXT },
        assignmentInterval: {
            validFrom: "2026-01-01",
            validThrough: null
        },
        applicabilityInterval: {
            validFrom: "2026-08-01",
            validThrough: "2026-12-31"
        },
        lineage: {
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
        },
        catalog: {
            versionId: 66,
            versionNumber: 3,
            currencyCode: "USD",
            currencyExponent: 2,
            sourceEffectiveDate: "2026-08-01",
            sourcePublishedDate: "2026-07-29",
            calculationContractVersion: "storecalc.calculation.v1",
            requiredCapabilities: [...CONFIGURATION.requiredCapabilities],
            contentSchemaVersion: "storecalc.catalog-content.v1",
            canonicalizationVersion: "storecalc.canonical-json.v1",
            hashAlgorithm: "sha256",
            contentHash: buildSyntheticCatalogContent().contentHash
        },
        configuration: CONFIGURATION,
        ...overrides
    };
}

function buildHarness(result = buildResolved()) {
    const calls = [];
    const orchestrate = createCatalogCalculationOrchestrator({
        async orchestrateCatalogRequest(pool, input) {
            calls.push({ pool, input });
            return result;
        }
    });
    return { calls, orchestrate };
}

async function expectBoundaryError(action, code, path = undefined) {
    await assert.rejects(action, error => {
        assert.ok(error instanceof StoreCalcCatalogCalculationError);
        assert.equal(error.code, code);
        if (path !== undefined) assert.equal(error.path, path);
        return true;
    });
}

test("StoreCalc calculates from one exact catalog request without forwarding private order input", async () => {
    const { calls, orchestrate } = buildHarness();
    const pool = {};
    const request = buildRequest();
    const original = structuredClone(request);

    const result = await orchestrate(pool, request);

    assert.deepEqual(request, original);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].pool, pool);
    assert.deepEqual(calls[0].input, CONTEXT);
    assert.equal("configurationHash" in calls[0].input, false);
    assert.equal("quantities" in calls[0].input, false);
    assert.equal("availableFundsMinor" in calls[0].input, false);
    assert.equal(result.state, "calculated");
    assert.equal(
        result.orchestrationVersion,
        CATALOG_CALCULATION_ORCHESTRATION_VERSION
    );
    assert.equal(
        result.catalogRequestOrchestrationVersion,
        "storecalc.catalog-request-orchestration.v1"
    );
    assert.equal(result.lineage.versionId, 66);
    assert.equal(result.calculation.configurationHash, CONFIGURATION.contentHash);
    assert.equal(result.calculation.contextDate, CONTEXT.contextDate);
    assert.equal(result.calculation.lines[0].itemKey, "sample_soup");
    assert.equal(result.calculation.lines[0].quantity, "2");
    assert.equal("configuration" in result, false);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.context), true);
    assert.equal(Object.isFrozen(result.lineage), true);
    assert.equal(Object.isFrozen(result.catalog.requiredCapabilities), true);
    assert.equal(Object.isFrozen(result.calculation), true);
});

test("StoreCalc returns catalog unavailability without calculating", async () => {
    const unavailable = {
        state: "unavailable",
        orchestrationVersion: "storecalc.catalog-request-orchestration.v1",
        resolverVersion: "storecalc.catalog-resolution.v1",
        context: { ...CONTEXT }
    };
    const { calls, orchestrate } = buildHarness(unavailable);

    const result = await orchestrate({}, buildRequest());

    assert.equal(calls.length, 1);
    assert.deepEqual(result, {
        state: "unavailable",
        orchestrationVersion:
            "storecalc.catalog-calculation-orchestration.v1",
        catalogRequestOrchestrationVersion:
            "storecalc.catalog-request-orchestration.v1",
        resolverVersion: "storecalc.catalog-resolution.v1",
        context: CONTEXT
    });
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.context), true);
});

test("StoreCalc rejects a stale client configuration before calculation", async () => {
    const { orchestrate } = buildHarness();

    await expectBoundaryError(
        () =>
            orchestrate(
                {},
                buildRequest({ configurationHash: "0".repeat(64) })
            ),
        "CONFIGURATION_STALE",
        "$.configurationHash"
    );
});

test("StoreCalc validates the bounded request before catalog access", async () => {
    let calls = 0;
    const orchestrate = createCatalogCalculationOrchestrator({
        async orchestrateCatalogRequest() {
            calls += 1;
            return buildResolved();
        }
    });
    const invalidRequests = [
        { ...buildRequest(), clientTotalMinor: "1" },
        buildRequest({ facilityId: 0 }),
        buildRequest({ audienceKey: "INVALID" }),
        buildRequest({ contextDate: "2026-02-30" }),
        buildRequest({ configurationHash: "bad" }),
        buildRequest({ availableFundsMinor: 500 }),
        buildRequest({ availableFundsMinor: "0500" }),
        buildRequest({ quantities: [{ itemKey: "sample_soup", quantity: 2 }] }),
        buildRequest({
            quantities: [
                { itemKey: "sample_soup", quantity: "1" },
                { itemKey: "sample_soup", quantity: "2" }
            ]
        }),
        buildRequest({
            quantities: Array.from({ length: 1001 }, (_, index) => ({
                itemKey: `item_${index}`,
                quantity: "1"
            }))
        }),
        buildRequest({ quantities: Array(1) })
    ];

    for (const request of invalidRequests) {
        await expectBoundaryError(
            () => orchestrate({}, request),
            "REQUEST_INVALID"
        );
    }
    assert.equal(calls, 0);
});

test("StoreCalc rejects malformed or drifting catalog orchestration results", async () => {
    const cases = [
        [{ ...buildResolved(), extra: true }, "DEPENDENCY_RESULT_INVALID"],
        [
            {
                ...buildResolved(),
                context: { ...CONTEXT, facilityId: 12 }
            },
            "DEPENDENCY_RESULT_DRIFT"
        ],
        [
            {
                ...buildResolved(),
                projectionVersion:
                    "storecalc.catalog-configuration-projection.v2"
            },
            "DEPENDENCY_RESULT_INVALID"
        ],
        [
            {
                ...buildResolved(),
                configuration: {
                    ...CONFIGURATION,
                    contentHash: "0".repeat(64)
                }
            },
            "DEPENDENCY_RESULT_INVALID"
        ]
    ];

    for (const [result, code] of cases) {
        const { orchestrate } = buildHarness(result);
        await expectBoundaryError(() => orchestrate({}, buildRequest()), code);
    }
});

test("StoreCalc preserves calculation and catalog dependency failures", async () => {
    const { orchestrate } = buildHarness();
    await assert.rejects(
        () =>
            orchestrate(
                {},
                buildRequest({
                    quantities: [{ itemKey: "missing_item", quantity: "1" }]
                })
            ),
        error =>
            error instanceof StoreCalcCalculationError &&
            error.code === "ITEM_REFERENCE_MISSING"
    );

    const failure = Object.assign(new Error("synthetic database failure"), {
        code: "XX000"
    });
    const failing = createCatalogCalculationOrchestrator({
        async orchestrateCatalogRequest() {
            throw failure;
        }
    });
    await assert.rejects(
        () => failing({}, buildRequest()),
        error => error === failure
    );
});

test("StoreCalc catalog calculation orchestration remains inactive and route-independent", () => {
    const runtimeSources = [
        "src/routes/storecalc.routes.js",
        "src/controllers/storecalc.controller.js",
        "src/storecalc/anonymous/router.js",
        "src/storecalc/anonymous/service.js",
        "src/storecalc/anonymous/publicRegistry.js",
        "src/storecalc/anonymous/catalogRegistry.js"
    ].map(relativePath => readFileSync(path.join(ROOT, relativePath), "utf8"));
    for (const source of runtimeSources) {
        assert.doesNotMatch(
            source,
            /calculationService|orchestrateCatalogCalculation/
        );
    }

    const serviceSource = readFileSync(
        path.join(ROOT, "src/storecalc/catalog/calculationService.js"),
        "utf8"
    );
    assert.doesNotMatch(
        serviceSource,
        /(?:\b(?:express|router)|\breq\.|\bres\.|\bprocess\.env|\bfetch\s*\()/
    );
    assert.doesNotMatch(serviceSource, /\b(?:INSERT|UPDATE|DELETE|GRANT)\b/);
});

test("StoreCalc requires one exact catalog orchestration dependency", () => {
    for (const dependencies of [
        undefined,
        null,
        {},
        { orchestrateCatalogRequest: true },
        { orchestrateCatalogRequest() {}, extra() {} }
    ]) {
        assert.throws(
            () => createCatalogCalculationOrchestrator(dependencies),
            error => error instanceof StoreCalcCatalogCalculationError
        );
    }
});
