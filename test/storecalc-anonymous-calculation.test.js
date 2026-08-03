import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { once } from "node:events";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { gzipSync } from "node:zlib";

import express from "express";

import { createApp } from "../src/app.js";
import {
    createPublicCalculationCatalogRegistry,
    MAX_PUBLIC_CALCULATION_CATALOGS,
    StoreCalcCatalogRegistryError
} from "../src/storecalc/anonymous/catalogRegistry.js";
import { publicCalculationCatalogRegistry } from "../src/storecalc/anonymous/publicRegistry.js";
import {
    ANONYMOUS_CALCULATION_BODY_LIMIT,
    ANONYMOUS_CALCULATION_RATE_LIMIT,
    ANONYMOUS_CALCULATION_ROUTE_PATH,
    createAnonymousCalculationRouter
} from "../src/storecalc/anonymous/router.js";
import {
    anonymousCalculationErrorBody,
    ANONYMOUS_CALCULATION_REQUEST_SCHEMA_VERSION,
    ANONYMOUS_CALCULATION_RESPONSE_SCHEMA_VERSION,
    createAnonymousCalculationService,
    StoreCalcAnonymousCalculationError
} from "../src/storecalc/anonymous/service.js";
import {
    buildSyntheticConfiguration,
    buildSyntheticV2Configuration
} from "./fixtures/storecalc-calculation-fixtures.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ANONYMOUS_SOURCE_PATHS = [
    "src/storecalc/anonymous/catalogRegistry.js",
    "src/storecalc/anonymous/publicRegistry.js",
    "src/storecalc/anonymous/router.js",
    "src/storecalc/anonymous/service.js"
];
const anonymousSource = ANONYMOUS_SOURCE_PATHS.map(relativePath =>
    readFileSync(path.join(ROOT, relativePath), "utf8")
).join("\n");
const productionRegistrySource = readFileSync(
    path.join(ROOT, "src", "storecalc", "anonymous", "publicRegistry.js"),
    "utf8"
);
const productionRouteSource = readFileSync(
    path.join(ROOT, "src", "routes", "storecalc.routes.js"),
    "utf8"
);
const boundaryNotes = readFileSync(
    path.join(ROOT, "src", "storecalc", "anonymous", "README.md"),
    "utf8"
);

function buildCatalogEntry(
    configuration = buildSyntheticConfiguration(),
    overrides = {}
) {
    return {
        facilitySelectionKey: "synthetic-facility",
        templateSelectionKey: "synthetic-template",
        audienceKey: "general-population",
        effectiveFrom: "2026-01-01",
        effectiveThrough: null,
        configuration,
        ...overrides
    };
}

function buildRegistry(entries = [buildCatalogEntry()]) {
    return createPublicCalculationCatalogRegistry(entries);
}

function buildRequest(
    configuration = buildSyntheticConfiguration(),
    overrides = {}
) {
    return {
        requestSchemaVersion:
            ANONYMOUS_CALCULATION_REQUEST_SCHEMA_VERSION,
        facilitySelectionKey: "synthetic-facility",
        templateSelectionKey: "synthetic-template",
        audienceKey: "general-population",
        configurationHash: configuration.contentHash,
        contextDate: "2026-08-03",
        quantities: [
            { itemKey: "sample-soup", quantity: "2" },
            { itemKey: "sample-drink", quantity: "1" },
            { itemKey: "sample-soap", quantity: "1" }
        ],
        availableFundsMinor: "700",
        ...overrides
    };
}

function expectRegistryError(action, code) {
    assert.throws(action, error => {
        assert.ok(error instanceof StoreCalcCatalogRegistryError);
        assert.equal(error.code, code);
        assert.equal(error.message, code);
        assert.match(error.path, /^\$/);
        return true;
    });
}

function expectBoundaryError(action, code, status) {
    assert.throws(action, error => {
        assert.ok(error instanceof StoreCalcAnonymousCalculationError);
        assert.equal(error.code, code);
        assert.equal(error.message, code);
        assert.equal(error.status, status);
        return true;
    });
}

function buildHttpApp(registry) {
    const app = express();
    app.disable("x-powered-by");
    app.use("/storecalc", createAnonymousCalculationRouter({ registry }));
    app.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        return res.status(503).json({ error: "unexpected_test_error" });
    });
    return app;
}

async function withServer(app, action) {
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    try {
        return await action(`http://127.0.0.1:${address.port}`);
    } finally {
        await new Promise((resolve, reject) => {
            server.close(error => (error ? reject(error) : resolve()));
        });
    }
}

async function postJson(baseUrl, body, headers = {}) {
    return fetch(
        `${baseUrl}/storecalc${ANONYMOUS_CALCULATION_ROUTE_PATH}`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...headers
            },
            body: typeof body === "string" ? body : JSON.stringify(body)
        }
    );
}

test("StoreCalc catalog registry resolves one exact effective configuration", () => {
    const versionOne = buildSyntheticConfiguration();
    const versionTwo = buildSyntheticV2Configuration();
    const registry = buildRegistry([
        buildCatalogEntry(versionTwo, {
            effectiveFrom: "2026-07-01"
        }),
        buildCatalogEntry(versionOne, {
            effectiveFrom: "2026-01-01",
            effectiveThrough: "2026-06-30"
        })
    ]);

    const first = registry.resolve({
        facilitySelectionKey: "synthetic-facility",
        templateSelectionKey: "synthetic-template",
        audienceKey: "general-population",
        contextDate: "2026-06-30"
    });
    const second = registry.resolve({
        facilitySelectionKey: "synthetic-facility",
        templateSelectionKey: "synthetic-template",
        audienceKey: "general-population",
        contextDate: "2026-07-01"
    });
    const missing = registry.resolve({
        facilitySelectionKey: "different-facility",
        templateSelectionKey: "synthetic-template",
        audienceKey: "general-population",
        contextDate: "2026-07-01"
    });

    assert.equal(first.state, "available");
    assert.equal(first.configuration.contentHash, versionOne.contentHash);
    assert.equal(second.configuration.contentHash, versionTwo.contentHash);
    assert.deepEqual(missing, { state: "unavailable" });
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Object.isFrozen(first.configuration), true);
});

test("StoreCalc catalog registry rejects unsafe publication states", () => {
    const configuration = buildSyntheticConfiguration();
    expectRegistryError(
        () =>
            buildRegistry([
                buildCatalogEntry(configuration, {
                    effectiveThrough: "2026-08-31"
                }),
                buildCatalogEntry(configuration, {
                    effectiveFrom: "2026-08-31"
                })
            ]),
        "CATALOG_INTERVAL_OVERLAP"
    );
    expectRegistryError(
        () =>
            buildRegistry([
                buildCatalogEntry(configuration, {
                    effectiveFrom: "2026-09-01",
                    effectiveThrough: "2026-08-31"
                })
            ]),
        "CATALOG_INTERVAL_INVALID"
    );

    const tampered = structuredClone(configuration);
    tampered.items[0].priceMinor = "91";
    expectRegistryError(
        () => buildRegistry([buildCatalogEntry(tampered)]),
        "CATALOG_CONFIGURATION_INVALID"
    );

    const unsupported = buildSyntheticConfiguration(content => {
        content.requiredCapabilities.push("profiles.composition.v1");
    });
    expectRegistryError(
        () => buildRegistry([buildCatalogEntry(unsupported)]),
        "CATALOG_CAPABILITY_UNSUPPORTED"
    );

    expectRegistryError(
        () =>
            createPublicCalculationCatalogRegistry(
                Array.from(
                    { length: MAX_PUBLIC_CALCULATION_CATALOGS + 1 },
                    () => buildCatalogEntry(configuration)
                )
            ),
        "CATALOG_ARRAY_BOUND_EXCEEDED"
    );
});

test("StoreCalc anonymous service calculates only the server-resolved hash", () => {
    const configuration = buildSyntheticConfiguration();
    let resolverInput;
    const registry = {
        resolve(value) {
            resolverInput = structuredClone(value);
            return { state: "available", configuration };
        }
    };
    const service = createAnonymousCalculationService({ registry });
    const request = buildRequest(configuration);
    const original = structuredClone(request);
    const result = service.calculate(request);

    assert.deepEqual(request, original);
    assert.deepEqual(resolverInput, {
        facilitySelectionKey: "synthetic-facility",
        templateSelectionKey: "synthetic-template",
        audienceKey: "general-population",
        contextDate: "2026-08-03"
    });
    assert.equal("quantities" in resolverInput, false);
    assert.equal("availableFundsMinor" in resolverInput, false);
    assert.equal(result.configurationHash, configuration.contentHash);
    assert.equal(result.totals.finalTotalMinor, "688");
    assert.equal(result.availableFunds.remainingMinor, "12");
    assert.equal(Object.isFrozen(result), true);
});

test("StoreCalc anonymous service rejects stale, missing, and malformed requests", () => {
    const configuration = buildSyntheticConfiguration();
    const service = createAnonymousCalculationService({
        registry: buildRegistry([buildCatalogEntry(configuration)])
    });

    expectBoundaryError(
        () =>
            service.calculate(
                buildRequest(configuration, {
                    configurationHash: "0".repeat(64)
                })
            ),
        "configuration_stale",
        409
    );
    expectBoundaryError(
        () =>
            service.calculate(
                buildRequest(configuration, {
                    facilitySelectionKey: "unavailable-facility"
                })
            ),
        "catalog_unavailable",
        404
    );

    for (const invalid of [
        { ...buildRequest(configuration), clientTotalMinor: "1" },
        { ...buildRequest(configuration), configuration },
        {
            ...buildRequest(configuration),
            requestSchemaVersion: "storecalc.anonymous-calculation-request.v2"
        },
        { ...buildRequest(configuration), contextDate: "2026-02-30" },
        { ...buildRequest(configuration), facilitySelectionKey: "INVALID" },
        { ...buildRequest(configuration), availableFundsMinor: 700 },
        { ...buildRequest(configuration), availableFundsMinor: "0700" },
        {
            ...buildRequest(configuration),
            quantities: [
                { itemKey: "sample-soup", quantity: "1" },
                { itemKey: "sample-soup", quantity: "2" }
            ]
        },
        {
            ...buildRequest(configuration),
            quantities: Array.from(
                { length: 1001 },
                (_, index) => ({
                    itemKey: `sample-${index}`,
                    quantity: "1"
                })
            )
        }
    ]) {
        expectBoundaryError(
            () => service.calculate(invalid),
            "invalid_request",
            400
        );
    }

    let resolverCalled = false;
    const guardedService = createAnonymousCalculationService({
        registry: {
            resolve() {
                resolverCalled = true;
                return { state: "unavailable" };
            }
        }
    });
    expectBoundaryError(
        () =>
            guardedService.calculate(
                buildRequest(configuration, {
                    availableFundsMinor: "9".repeat(1000)
                })
            ),
        "invalid_request",
        400
    );
    assert.equal(resolverCalled, false);
});

test("StoreCalc anonymous service returns bounded client calculation errors", () => {
    const configuration = buildSyntheticConfiguration();
    const service = createAnonymousCalculationService({
        registry: buildRegistry([buildCatalogEntry(configuration)])
    });
    const rejectedItemKey = "private-looking-item-key";

    try {
        service.calculate(
            buildRequest(configuration, {
                quantities: [
                    { itemKey: rejectedItemKey, quantity: "1" }
                ]
            })
        );
        assert.fail("unknown item must fail");
    } catch (error) {
        assert.ok(error instanceof StoreCalcAnonymousCalculationError);
        assert.equal(error.code, "calculation_request_invalid");
        assert.equal(error.status, 422);
        assert.equal(error.calculationCode, "ITEM_REFERENCE_MISSING");
        assert.equal(error.path, "$.quantities[0]");
        const serialized = JSON.stringify(anonymousCalculationErrorBody(error));
        assert.doesNotMatch(serialized, new RegExp(rejectedItemKey));
    }

    const unavailableService = createAnonymousCalculationService({
        registry: {
            resolve() {
                return { state: "available", configuration: {} };
            }
        }
    });
    expectBoundaryError(
        () => unavailableService.calculate(buildRequest(configuration)),
        "calculation_unavailable",
        503
    );

    const ambiguousResolutionService = createAnonymousCalculationService({
        registry: {
            resolve() {
                return { state: "unavailable", configuration };
            }
        }
    });
    expectBoundaryError(
        () =>
            ambiguousResolutionService.calculate(buildRequest(configuration)),
        "calculation_unavailable",
        503
    );

    const overflowConfiguration = buildSyntheticConfiguration(content => {
        const soup = content.items.find(item => item.itemKey === "sample-soup");
        soup.priceMinor = "9223372036854775807";
        soup.maximumOrderQuantity = "2";
        soup.taxTreatment.ratePpm = "0";
        for (const bucketEntry of content.spendingBuckets) {
            bucketEntry.limitState = "unlimited";
            bucketEntry.limitMinor = null;
        }
    });
    const overflowService = createAnonymousCalculationService({
        registry: buildRegistry([buildCatalogEntry(overflowConfiguration)])
    });
    try {
        overflowService.calculate(
            buildRequest(overflowConfiguration, {
                quantities: [{ itemKey: "sample-soup", quantity: "2" }],
                availableFundsMinor: null
            })
        );
        assert.fail("overflow must fail");
    } catch (error) {
        assert.equal(error.code, "calculation_request_invalid");
        assert.equal(error.status, 422);
        assert.equal(error.calculationCode, "CALCULATION_OVERFLOW");
    }
});

test("StoreCalc anonymous HTTP boundary is exact, private, and stateless", async () => {
    const configuration = buildSyntheticConfiguration();
    await withServer(buildHttpApp(buildRegistry()), async baseUrl => {
        const response = await postJson(baseUrl, buildRequest(configuration));
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(
            response.headers.get("cache-control"),
            "private, no-store"
        );
        assert.equal(
            response.headers.get("x-robots-tag"),
            "noindex, nofollow"
        );
        assert.equal(
            response.headers.get("x-content-type-options"),
            "nosniff"
        );
        assert.equal(response.headers.get("set-cookie"), null);
        assert.equal(
            body.responseSchemaVersion,
            ANONYMOUS_CALCULATION_RESPONSE_SCHEMA_VERSION
        );
        assert.equal(body.success, true);
        assert.equal(body.result.resultHash.length, 64);
        assert.equal(body.result.totals.finalTotalMinor, "688");
        assert.equal(body.result.availableFunds.availableFundsMinor, "700");
    });
});

test("StoreCalc anonymous HTTP boundary rejects unsafe transport and payloads", async () => {
    const configuration = buildSyntheticConfiguration();
    await withServer(buildHttpApp(buildRegistry()), async baseUrl => {
        const endpoint = `${baseUrl}/storecalc${ANONYMOUS_CALCULATION_ROUTE_PATH}`;
        const wrongType = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: "private-funds=700"
        });
        assert.equal(wrongType.status, 415);
        assert.equal(
            (await wrongType.json()).error.code,
            "json_content_type_required"
        );

        const malformed = await postJson(
            baseUrl,
            '{"availableFundsMinor":"private-funds-700"'
        );
        const malformedText = await malformed.text();
        assert.equal(malformed.status, 400);
        assert.match(malformedText, /"code":"invalid_json"/);
        assert.doesNotMatch(malformedText, /private-funds-700/);

        const oversized = await postJson(
            baseUrl,
            JSON.stringify({ privatePadding: "x".repeat(140 * 1024) })
        );
        assert.equal(oversized.status, 413);
        assert.equal(
            (await oversized.json()).error.code,
            "request_body_too_large"
        );

        const stale = await postJson(
            baseUrl,
            buildRequest(configuration, {
                configurationHash: "0".repeat(64)
            })
        );
        assert.equal(stale.status, 409);
        assert.deepEqual((await stale.json()).error, {
            code: "configuration_stale"
        });

        const compressed = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Encoding": "gzip"
            },
            body: gzipSync(JSON.stringify(buildRequest(configuration)))
        });
        assert.equal(compressed.status, 415);
        assert.equal(
            (await compressed.json()).error.code,
            "json_encoding_unsupported"
        );

        const wrongMethod = await fetch(endpoint);
        assert.equal(wrongMethod.status, 405);
        assert.equal(wrongMethod.headers.get("allow"), "POST");
        assert.equal(
            (await wrongMethod.json()).error.code,
            "method_not_allowed"
        );
    });
});

test("StoreCalc anonymous HTTP boundary enforces its fixed rate limit", async () => {
    const configuration = buildSyntheticConfiguration();
    await withServer(buildHttpApp(buildRegistry()), async baseUrl => {
        for (
            let attempt = 0;
            attempt < ANONYMOUS_CALCULATION_RATE_LIMIT.max;
            attempt += 1
        ) {
            const response = await postJson(
                baseUrl,
                buildRequest(configuration)
            );
            assert.equal(response.status, 200);
            await response.arrayBuffer();
        }

        const limited = await postJson(baseUrl, buildRequest(configuration));
        assert.equal(limited.status, 429);
        assert.equal((await limited.json()).error.code, "rate_limited");
        assert.equal(
            limited.headers.get("cache-control"),
            "private, no-store"
        );
    });
});

test("StoreCalc production catalog and route remain closed", async () => {
    assert.deepEqual(
        publicCalculationCatalogRegistry.resolve({
            facilitySelectionKey: "us-ga-gdc-hays-state-prison",
            templateSelectionKey: "unreviewed-template",
            audienceKey: "general-population",
            contextDate: "2026-08-03"
        }),
        { state: "unavailable" }
    );
    assert.doesNotMatch(productionRegistrySource, /synthetic-|sample-/);
    assert.doesNotMatch(
        productionRouteSource,
        /anonymousCalculation|api\/v1\/calculate|router\.post/
    );

    const app = await createApp();
    await withServer(app, async baseUrl => {
        const response = await postJson(
            baseUrl,
            buildRequest(buildSyntheticConfiguration())
        );
        assert.equal(response.status, 404);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(response.headers.get("set-cookie"), null);
    });
});

test("StoreCalc anonymous boundary stays isolated from private infrastructure", () => {
    assert.equal(ANONYMOUS_CALCULATION_BODY_LIMIT, "128kb");
    assert.equal(ANONYMOUS_CALCULATION_RATE_LIMIT.windowMs, 60_000);
    assert.equal(ANONYMOUS_CALCULATION_RATE_LIMIT.max, 30);
    assert.doesNotMatch(anonymousSource, /process\.env/);
    assert.doesNotMatch(anonymousSource, /from ["']node:(?:fs|http|https|net)/);
    assert.doesNotMatch(anonymousSource, /from ["'][^"']*(?:db|database|pool)/i);
    assert.doesNotMatch(anonymousSource, /req\.session|document\.|window\./);
    assert.doesNotMatch(anonymousSource, /console\.|appendFile|writeFile/);
    assert.doesNotMatch(anonymousSource, /\bfetch\s*\(|XMLHttpRequest/);
    assert.match(boundaryNotes, /router is deliberately not\s+mounted/);
    assert.match(boundaryNotes, /Synthetic fixtures/);
    assert.match(boundaryNotes, /no record, session state, cookie/);
});
