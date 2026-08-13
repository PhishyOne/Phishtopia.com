import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
    CATALOG_REQUEST_ORCHESTRATION_VERSION,
    createCatalogRequestOrchestrator,
    StoreCalcCatalogRequestError
} from "../src/storecalc/catalog/requestService.js";
import { calculateStoreCalcOrder } from "../src/storecalc/calculation/core.js";
import { buildSyntheticCatalogContent } from "./fixtures/storecalc-catalog-content-fixture.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const HASH = buildSyntheticCatalogContent().contentHash;
const INPUT = Object.freeze({
    facilityId: 11,
    programId: 22,
    templateId: 33,
    audienceKey: "general_population",
    contextDate: "2026-08-13"
});
const CAPABILITIES = Object.freeze([
    "constraints.order_aggregate.v1",
    "money.minor_units.v1",
    "quantity.bounded_integer.v1",
    "spending_buckets.parallel_pretax.v1",
    "tax.single_treatment.line_rounding.v1"
]);

function buildResolution(overrides = {}) {
    return {
        state: "resolved",
        resolverVersion: "storecalc.catalog-resolution.v1",
        context: { ...INPUT },
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
            requiredCapabilities: [...CAPABILITIES],
            contentSchemaVersion: "storecalc.catalog-content.v1",
            canonicalizationVersion: "storecalc.canonical-json.v1",
            hashAlgorithm: "sha256",
            contentHash: HASH
        },
        ...overrides
    };
}

function buildHarness({ resolution = buildResolution(), loadResult } = {}) {
    const calls = [];
    const catalog = buildSyntheticCatalogContent();
    const orchestrate = createCatalogRequestOrchestrator({
        async resolvePublicCatalogVersion(pool, input) {
            calls.push({ dependency: "resolve", pool, input });
            return resolution;
        },
        async loadSealedCatalogVersionContent(pool, request) {
            calls.push({ dependency: "load", pool, request });
            return (
                loadResult ?? {
                    versionId: 66,
                    templateId: 33,
                    contentHash: catalog.contentHash,
                    catalog
                }
            );
        }
    });
    return { calls, catalog, orchestrate };
}

async function expectRequestError(action, code, path = undefined) {
    await assert.rejects(action, error => {
        assert.ok(error instanceof StoreCalcCatalogRequestError);
        assert.equal(error.code, code);
        if (path !== undefined) assert.equal(error.path, path);
        return true;
    });
}

test("StoreCalc orchestrates exact resolution, load, and sealed projection", async () => {
    const { calls, orchestrate } = buildHarness();
    const pool = {};

    const result = await orchestrate(pool, INPUT);

    assert.deepEqual(
        calls.map(call => call.dependency),
        ["resolve", "load"]
    );
    assert.equal(calls[0].pool, pool);
    assert.equal(calls[0].input, INPUT);
    assert.equal(calls[1].pool, pool);
    assert.deepEqual(calls[1].request, {
        versionId: 66,
        templateId: 33,
        contentHash: HASH
    });
    assert.ok(Object.isFrozen(calls[1].request));
    assert.equal(result.state, "resolved");
    assert.equal(
        result.orchestrationVersion,
        CATALOG_REQUEST_ORCHESTRATION_VERSION
    );
    assert.equal(result.resolverVersion, "storecalc.catalog-resolution.v1");
    assert.equal(
        result.projectionVersion,
        "storecalc.catalog-configuration-projection.v1"
    );
    assert.deepEqual(result.context, INPUT);
    assert.equal(result.lineage.versionId, 66);
    assert.equal(result.catalog.contentHash, HASH);
    assert.match(result.configuration.configurationKey, /^sc\.[a-f0-9]{61}$/);
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.context));
    assert.ok(Object.isFrozen(result.assignmentInterval));
    assert.ok(Object.isFrozen(result.applicabilityInterval));
    assert.ok(Object.isFrozen(result.lineage));
    assert.ok(Object.isFrozen(result.catalog));
    assert.ok(Object.isFrozen(result.catalog.requiredCapabilities));
    assert.ok(Object.isFrozen(result.configuration));

    const calculated = calculateStoreCalcOrder({
        configuration: result.configuration,
        contextDate: INPUT.contextDate,
        quantities: [{ itemKey: "sample_soup", quantity: "1" }],
        availableFundsMinor: "500",
        supportedCapabilities: [...result.configuration.requiredCapabilities]
    });
    assert.equal(calculated.configurationHash, result.configuration.contentHash);
});

test("StoreCalc derives a deterministic key from exact lineage and catalog hash", async () => {
    const first = await buildHarness().orchestrate({}, INPUT);
    const repeated = await buildHarness().orchestrate({}, { ...INPUT });
    const laterContext = { ...INPUT, contextDate: "2026-08-14" };
    const sameLineageLater = buildResolution({ context: laterContext });
    const later = await buildHarness({ resolution: sameLineageLater }).orchestrate(
        {},
        laterContext
    );
    const changedResolution = buildResolution({
        lineage: {
            ...buildResolution().lineage,
            assignmentId: 45
        }
    });
    const changed = await buildHarness({
        resolution: changedResolution
    }).orchestrate({}, INPUT);
    const publicationLineage = {
        ...buildResolution().lineage,
        selectionMode: "publication",
        exactVersionId: null,
        publicationId: 77,
        publicationIsCurrent: true
    };
    const currentPublication = await buildHarness({
        resolution: buildResolution({ lineage: publicationLineage })
    }).orchestrate({}, INPUT);
    const historicalPublication = await buildHarness({
        resolution: buildResolution({
            lineage: { ...publicationLineage, publicationIsCurrent: false }
        })
    }).orchestrate({}, INPUT);

    assert.equal(
        first.configuration.configurationKey,
        repeated.configuration.configurationKey
    );
    assert.equal(
        first.configuration.configurationKey,
        later.configuration.configurationKey
    );
    assert.notEqual(
        first.configuration.configurationKey,
        changed.configuration.configurationKey
    );
    assert.equal(
        currentPublication.configuration.configurationKey,
        historicalPublication.configuration.configurationKey
    );
});

test("StoreCalc returns unavailable without loading catalog content", async () => {
    const resolution = {
        state: "unavailable",
        resolverVersion: "storecalc.catalog-resolution.v1",
        context: { ...INPUT }
    };
    const { calls, orchestrate } = buildHarness({ resolution });

    const result = await orchestrate({}, INPUT);

    assert.deepEqual(calls.map(call => call.dependency), ["resolve"]);
    assert.deepEqual(result, {
        state: "unavailable",
        orchestrationVersion: CATALOG_REQUEST_ORCHESTRATION_VERSION,
        resolverVersion: "storecalc.catalog-resolution.v1",
        context: INPUT
    });
    assert.ok(Object.isFrozen(result));
});

test("StoreCalc rejects resolver shape, context, and lineage drift", async () => {
    const cases = [
        [
            { ...buildResolution(), extra: true },
            "DEPENDENCY_RESULT_INVALID",
            "$.resolution"
        ],
        [
            { ...buildResolution(), context: { ...INPUT, templateId: 34 } },
            "DEPENDENCY_RESULT_DRIFT",
            "$.resolution.context"
        ],
        [
            {
                ...buildResolution(),
                lineage: { ...buildResolution().lineage, facilityId: 12 }
            },
            "DEPENDENCY_RESULT_DRIFT",
            "$.resolution.lineage"
        ],
        [
            {
                ...buildResolution(),
                lineage: {
                    ...buildResolution().lineage,
                    exactVersionId: null
                }
            },
            "DEPENDENCY_RESULT_INVALID",
            "$.resolution.lineage"
        ],
        [
            {
                ...buildResolution(),
                catalog: { ...buildResolution().catalog, versionId: 67 }
            },
            "DEPENDENCY_RESULT_DRIFT",
            "$.resolution.catalog.versionId"
        ],
        [
            {
                ...buildResolution(),
                applicabilityInterval: {
                    validFrom: "2026-08-14",
                    validThrough: "2026-12-31"
                }
            },
            "DEPENDENCY_RESULT_DRIFT",
            "$.resolution.intervals"
        ]
    ];

    for (const [resolution, code, path] of cases) {
        const { orchestrate } = buildHarness({ resolution });
        await expectRequestError(() => orchestrate({}, INPUT), code, path);
    }
});

test("StoreCalc rejects loaded lineage and catalog-content drift before projection", async () => {
    const catalog = buildSyntheticCatalogContent();
    const cases = [
        { versionId: 67, templateId: 33, contentHash: HASH, catalog },
        { versionId: 66, templateId: 34, contentHash: HASH, catalog },
        { versionId: 66, templateId: 33, contentHash: "a".repeat(64), catalog },
        {
            versionId: 66,
            templateId: 33,
            contentHash: HASH,
            catalog: { ...catalog, displayName: "unexpected" }
        }
    ];

    for (const loadResult of cases) {
        const { orchestrate } = buildHarness({ loadResult });
        await assert.rejects(
            () => orchestrate({}, INPUT),
            error =>
                error instanceof StoreCalcCatalogRequestError &&
                ["DEPENDENCY_RESULT_DRIFT", "DEPENDENCY_RESULT_INVALID"].includes(
                    error.code
                )
        );
    }
});

test("StoreCalc requires an exact dependency boundary", () => {
    for (const dependencies of [
        undefined,
        null,
        {},
        {
            resolvePublicCatalogVersion() {},
            loadSealedCatalogVersionContent() {},
            extra() {}
        },
        {
            resolvePublicCatalogVersion: true,
            loadSealedCatalogVersionContent() {}
        }
    ]) {
        assert.throws(
            () => createCatalogRequestOrchestrator(dependencies),
            error => error instanceof StoreCalcCatalogRequestError
        );
    }
});

test("StoreCalc preserves dependency failures without retrying", async () => {
    const failure = Object.assign(new Error("synthetic database failure"), {
        code: "XX000"
    });
    let loadCalls = 0;
    const orchestrate = createCatalogRequestOrchestrator({
        async resolvePublicCatalogVersion() {
            throw failure;
        },
        async loadSealedCatalogVersionContent() {
            loadCalls += 1;
        }
    });

    await assert.rejects(() => orchestrate({}, INPUT), error => error === failure);
    assert.equal(loadCalls, 0);
});

test("StoreCalc request orchestration remains inactive and route-independent", () => {
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
            /requestService|orchestrateCatalogRequest/
        );
    }

    const serviceSource = readFileSync(
        path.join(ROOT, "src/storecalc/catalog/requestService.js"),
        "utf8"
    );
    assert.doesNotMatch(
        serviceSource,
        /(?:\b(?:express|router)|\breq\.|\bres\.|\bprocess\.env|\bfetch\s*\()/
    );
    assert.doesNotMatch(serviceSource, /\b(?:INSERT|UPDATE|DELETE|GRANT)\b/);
});
