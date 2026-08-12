import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
    CATALOG_CONFIGURATION_PROJECTION_VERSION,
    projectCatalogVersionContent,
    StoreCalcCatalogProjectionError
} from "../src/storecalc/catalog/configurationProjector.js";
import {
    calculateStoreCalcOrder,
    verifyResolvedConfiguration
} from "../src/storecalc/calculation/core.js";
import {
    buildSyntheticCatalogContent
} from "./fixtures/storecalc-catalog-content-fixture.js";

const CONFIGURATION_KEY = "public-facility-11-template-33-version-66";
const ROOT = fileURLToPath(new URL("..", import.meta.url));

function project(catalog = buildSyntheticCatalogContent(), options = {}) {
    return projectCatalogVersionContent(catalog, {
        configurationKey: CONFIGURATION_KEY,
        ...options
    });
}

function expectProjectionError(action, code, path = undefined) {
    assert.throws(action, error => {
        assert.ok(error instanceof StoreCalcCatalogProjectionError);
        assert.equal(error.code, code);
        if (path !== undefined) assert.equal(error.path, path);
        return true;
    });
}

test("StoreCalc projects verified catalog content into one sealed calculation configuration", () => {
    const configuration = project();

    assert.equal(
        CATALOG_CONFIGURATION_PROJECTION_VERSION,
        "storecalc.catalog-configuration-projection.v1"
    );
    assert.equal(
        configuration.resolvedSchemaVersion,
        "storecalc.resolved-configuration.v1"
    );
    assert.equal(configuration.configurationKey, CONFIGURATION_KEY);
    assert.equal(configuration.currencyCode, "USD");
    assert.equal(configuration.currencyExponent, 2);
    assert.match(configuration.contentHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(verifyResolvedConfiguration(configuration), configuration);
    assert.ok(Object.isFrozen(configuration));
    assert.ok(Object.isFrozen(configuration.items));

    const soup = configuration.items.find(item => item.itemKey === "sample_soup");
    assert.deepEqual(soup.taxTreatment, {
        state: "known",
        ratePpm: "70000",
        priceIncludesTax: false,
        roundingMode: "half_up",
        roundingScope: "line"
    });
    assert.deepEqual(soup.bucketMemberships, [
        {
            bucketKey: "food",
            membershipType: "counts_toward",
            primaryDisplay: false
        },
        {
            bucketKey: "main",
            membershipType: "counts_toward",
            primaryDisplay: true
        }
    ]);
    assert.deepEqual(soup.warnings, []);

    const soap = configuration.items.find(item => item.itemKey === "sample_soap");
    assert.equal(soap.taxTreatment.state, "not_applicable");
    assert.deepEqual(soap.warnings, [
        {
            warningCode: "price_unknown",
            severity: "warning",
            messageKey: "storecalc.warning.price_unknown"
        }
    ]);
    assert.deepEqual(configuration.warnings, [
        {
            warningCode: "synthetic_fixture_only",
            severity: "informational",
            messageKey: "storecalc.notice.synthetic_fixture_only"
        }
    ]);
    assert.equal(configuration.constraints[0].sortOrder, 10);
});

test("StoreCalc resolves tax by specificity before priority and by highest same-scope priority", () => {
    const catalog = buildSyntheticCatalogContent(content => {
        content.taxRules.push(
            {
                scopeType: "category",
                categoryKey: "food",
                itemKey: null,
                treatmentState: "known",
                ratePpm: "80000",
                priceIncludesTax: false,
                roundingMode: "half_up",
                roundingScope: "line",
                priority: 900
            },
            {
                scopeType: "item",
                categoryKey: null,
                itemKey: "sample_soup",
                treatmentState: "unknown",
                ratePpm: null,
                priceIncludesTax: null,
                roundingMode: null,
                roundingScope: null,
                priority: 1
            },
            {
                scopeType: "item",
                categoryKey: null,
                itemKey: "sample_soup",
                treatmentState: "known",
                ratePpm: "90000",
                priceIncludesTax: true,
                roundingMode: "floor",
                roundingScope: "line",
                priority: 2
            }
        );
    });

    const soup = project(catalog).items.find(
        item => item.itemKey === "sample_soup"
    );
    assert.deepEqual(soup.taxTreatment, {
        state: "known",
        ratePpm: "90000",
        priceIncludesTax: true,
        roundingMode: "floor",
        roundingScope: "line"
    });
});

test("StoreCalc projection is independent of source array order", () => {
    const forward = project();
    const reversedCatalog = buildSyntheticCatalogContent(content => {
        for (const key of [
            "categories",
            "items",
            "spendingBuckets",
            "bucketMemberships",
            "taxRules",
            "constraints",
            "warnings",
            "sourceEvidence"
        ]) {
            content[key].reverse();
        }
    });
    const reversed = project(reversedCatalog);

    assert.deepEqual(reversed, forward);
    assert.equal(reversed.contentHash, forward.contentHash);
});

test("StoreCalc refuses to invent a tax-free treatment when no rule matches", () => {
    const catalog = buildSyntheticCatalogContent(content => {
        content.taxRules = content.taxRules.filter(
            rule => rule.scopeType === "item" && rule.itemKey === "sample_soap"
        );
    });

    expectProjectionError(
        () => project(catalog),
        "CATALOG_TAX_TREATMENT_MISSING",
        "$.catalog.items.sample_soup"
    );
});

test("StoreCalc rejects profile-required or otherwise unsupported catalog capabilities", () => {
    const catalog = buildSyntheticCatalogContent(content => {
        content.requiredCapabilities.push("profiles.composition.v1");
    });

    expectProjectionError(
        () => project(catalog),
        "CATALOG_CAPABILITY_UNSUPPORTED",
        "$.catalog.requiredCapabilities"
    );
});

test("StoreCalc wraps invalid catalog hashes without projecting unverified content", () => {
    const tampered = structuredClone(buildSyntheticCatalogContent());
    tampered.items[0].displayName = "Tampered after sealing";

    expectProjectionError(
        () => project(tampered),
        "CATALOG_CONTENT_INVALID",
        "$.catalog"
    );
});

test("StoreCalc requires one exact projection option shape", () => {
    const catalog = buildSyntheticCatalogContent();
    for (const options of [
        undefined,
        null,
        {},
        [],
        { configurationKey: CONFIGURATION_KEY, extra: true }
    ]) {
        expectProjectionError(
            () => projectCatalogVersionContent(catalog, options),
            "PROJECTION_INPUT_INVALID",
            "$.projection"
        );
    }
});

test("StoreCalc rejects invalid lineage configuration keys through the sealed core", () => {
    expectProjectionError(
        () => project(undefined, { configurationKey: "Not valid" }),
        "RESOLVED_CONFIGURATION_INVALID",
        "$.configuration"
    );
});

test("StoreCalc projected configuration runs through the authoritative calculation core", () => {
    const configuration = project();
    const result = calculateStoreCalcOrder({
        configuration,
        contextDate: "2026-08-12",
        quantities: [{ itemKey: "sample_soup", quantity: "2" }],
        availableFundsMinor: "500",
        supportedCapabilities: [...configuration.requiredCapabilities]
    });

    assert.equal(result.configurationHash, configuration.contentHash);
    assert.equal(result.lines[0].itemKey, "sample_soup");
    assert.equal(result.lines[0].quantity, "2");
});

test("StoreCalc projection does not mutate caller-owned input", () => {
    const catalog = structuredClone(buildSyntheticCatalogContent());
    const snapshot = structuredClone(catalog);

    projectCatalogVersionContent(catalog, {
        configurationKey: CONFIGURATION_KEY
    });

    assert.deepEqual(catalog, snapshot);
});

test("StoreCalc projection remains pure and outside every runtime route", () => {
    const projectorSource = readFileSync(
        path.join(ROOT, "src/storecalc/catalog/configurationProjector.js"),
        "utf8"
    );
    assert.doesNotMatch(
        projectorSource,
        /(?:\b(?:express|router)|\breq\.|\bres\.|\bprocess\.env|\bfetch\s*\()/
    );
    assert.doesNotMatch(
        projectorSource,
        /from ["'][^"']*(?:db|database|pool)/i
    );

    for (const relativePath of [
        "src/routes/storecalc.routes.js",
        "src/controllers/storecalc.controller.js",
        "src/storecalc/anonymous/router.js",
        "src/storecalc/anonymous/service.js",
        "src/storecalc/anonymous/publicRegistry.js"
    ]) {
        const runtimeSource = readFileSync(path.join(ROOT, relativePath), "utf8");
        assert.doesNotMatch(
            runtimeSource,
            /configurationProjector|projectCatalogVersionContent/
        );
    }
});
