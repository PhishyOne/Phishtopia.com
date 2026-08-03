import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
    CALCULATION_BOUNDS,
    CALCULATION_CONTRACT_VERSION,
    calculateStoreCalcOrder,
    canonicalizeStoreCalcValue,
    ENGINE_VERSION,
    sealResolvedConfiguration,
    StoreCalcCalculationError,
    SUPPORTED_CALCULATION_CAPABILITIES,
    verifyResolvedConfiguration
} from "../src/storecalc/calculation/core.js";
import {
    buildCalculationInput,
    buildSyntheticConfiguration,
    buildSyntheticV2Configuration
} from "./fixtures/storecalc-calculation-fixtures.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const coreSource = readFileSync(
    path.join(ROOT, "src", "storecalc", "calculation", "core.js"),
    "utf8"
);
const implementationNotes = readFileSync(
    path.join(ROOT, "src", "storecalc", "calculation", "README.md"),
    "utf8"
);

function expectCalculationError(action, code, pathPattern = /^\$/) {
    assert.throws(action, error => {
        assert.ok(error instanceof StoreCalcCalculationError);
        assert.equal(error.code, code);
        assert.equal(error.message, code);
        assert.match(error.path, pathPattern);
        return true;
    });
}

function mutableContent(configuration) {
    const content = structuredClone(configuration);
    delete content.contentHash;
    return content;
}

function calculate(
    configuration = buildSyntheticConfiguration(),
    overrides = {}
) {
    return calculateStoreCalcOrder(
        buildCalculationInput(configuration, overrides)
    );
}

function validationCodes(result) {
    return result.validations.map(validation => validation.code);
}

function bucket(result, key) {
    return result.spendingBuckets.find(entry => entry.bucketKey === key);
}

function constraint(result, key) {
    return result.constraints.find(entry => entry.constraintKey === key);
}

function line(result, key) {
    return result.lines.find(entry => entry.itemKey === key);
}

test("StoreCalc seals one deterministic versioned configuration", () => {
    const configuration = buildSyntheticConfiguration();

    assert.equal(
        configuration.contentHash,
        "e8e7c03cf507bfe6509ddb67452ea78ef1461e04f86a4ced2a98dadaceea701a"
    );
    assert.equal(configuration.calculationContractVersion, CALCULATION_CONTRACT_VERSION);
    assert.deepEqual(
        configuration.requiredCapabilities,
        [...SUPPORTED_CALCULATION_CAPABILITIES].sort()
    );
    assert.equal(Object.isFrozen(configuration), true);
    assert.equal(Object.isFrozen(configuration.items), true);
    assert.equal(Object.isFrozen(configuration.items[0]), true);
    const verified = verifyResolvedConfiguration(configuration);
    assert.notEqual(verified, configuration);
    assert.deepEqual(verified, configuration);

    const reordered = mutableContent(configuration);
    reordered.requiredCapabilities.reverse();
    reordered.items.reverse();
    reordered.spendingBuckets.reverse();
    reordered.constraints.reverse();
    for (const item of reordered.items) {
        item.bucketMemberships.reverse();
        item.warnings.reverse();
    }
    const resealed = sealResolvedConfiguration(reordered);
    assert.equal(resealed.contentHash, configuration.contentHash);
    assert.deepEqual(resealed, configuration);
});

test("StoreCalc golden calculation is exact, JSON-safe, and hash-stable", () => {
    const configuration = buildSyntheticConfiguration();
    const result = calculate(configuration);

    assert.equal(result.engineVersion, ENGINE_VERSION);
    assert.equal(result.configurationHash, configuration.contentHash);
    assert.equal(result.calculationState, "complete");
    assert.equal(result.complianceState, "passes_known_rules");
    assert.equal(
        result.resultHash,
        "f5bddb968cd133c276b2eb2deaa2c10762f140c613259ba9c9d18378f080cec5"
    );
    assert.deepEqual(
        result.requiredCapabilities,
        configuration.requiredCapabilities
    );
    assert.deepEqual(result.totals, {
        listedPriceTotalState: "known",
        listedPriceTotalMinor: "675",
        itemSubtotalState: "known",
        itemSubtotalMinor: "662",
        taxState: "known",
        taxMinor: "26",
        finalTotalState: "known",
        finalTotalMinor: "688",
        totalScope: "items_and_supported_tax_only",
        facilityFeeState: "unsupported",
        facilityFeeMinor: null
    });
    assert.deepEqual(
        result.lines.map(entry => ({
            itemKey: entry.itemKey,
            quantity: entry.quantity,
            listed: entry.listedPriceTotalMinor,
            subtotal: entry.itemSubtotalMinor,
            tax: entry.taxMinor,
            total: entry.lineTotalMinor
        })),
        [
            {
                itemKey: "sample-soup",
                quantity: "2",
                listed: "180",
                subtotal: "180",
                tax: "13",
                total: "193"
            },
            {
                itemKey: "sample-drink",
                quantity: "1",
                listed: "195",
                subtotal: "182",
                tax: "13",
                total: "195"
            },
            {
                itemKey: "sample-soap",
                quantity: "1",
                listed: "300",
                subtotal: "300",
                tax: null,
                total: "300"
            }
        ]
    );
    assert.deepEqual(
        result.spendingBuckets.map(entry => [
            entry.bucketKey,
            entry.amountMinor,
            entry.resultState
        ]),
        [
            ["main", "362", "within_limit"],
            ["food", "180", "within_limit"],
            ["beverage", "182", "unlimited"],
            ["hygiene", "300", "unlimited"]
        ]
    );
    assert.deepEqual(
        result.constraints.map(entry => [
            entry.constraintKey,
            entry.actualValue,
            entry.resultState
        ]),
        [
            ["maximum-distinct-lines", "3", "passes"],
            ["maximum-total-quantity", "4", "passes"]
        ]
    );
    assert.deepEqual(result.availableFunds, {
        state: "known",
        availableFundsMinor: "700",
        remainingState: "known",
        remainingMinor: "12",
        resultState: "within_funds"
    });
    assert.deepEqual(result.validations, []);
    assert.equal(Object.isFrozen(result), true);
    assert.doesNotThrow(() => JSON.stringify(result));
    assert.doesNotMatch(JSON.stringify(result), /\d+n\b/);
});

test("StoreCalc reports overlapping limits and private-funds overage independently", () => {
    const result = calculate(buildSyntheticConfiguration(), {
        quantities: [
            { itemKey: "sample-soup", quantity: "4" },
            { itemKey: "sample-drink", quantity: "2" },
            { itemKey: "sample-soap", quantity: "1" }
        ],
        availableFundsMinor: "800"
    });

    assert.equal(result.calculationState, "complete");
    assert.equal(result.complianceState, "violations");
    assert.deepEqual(result.totals, {
        listedPriceTotalState: "known",
        listedPriceTotalMinor: "1050",
        itemSubtotalState: "known",
        itemSubtotalMinor: "1024",
        taxState: "known",
        taxMinor: "51",
        finalTotalState: "known",
        finalTotalMinor: "1075",
        totalScope: "items_and_supported_tax_only",
        facilityFeeState: "unsupported",
        facilityFeeMinor: null
    });
    assert.equal(bucket(result, "main").amountMinor, "724");
    assert.equal(bucket(result, "main").resultState, "over_limit");
    assert.equal(bucket(result, "food").amountMinor, "360");
    assert.equal(bucket(result, "food").resultState, "over_limit");
    assert.equal(result.availableFunds.remainingMinor, "-275");
    assert.equal(result.availableFunds.resultState, "over_limit");
    assert.deepEqual(validationCodes(result), [
        "bucket_limit_exceeded",
        "bucket_limit_exceeded",
        "personal_funds_exceeded"
    ]);
    assert.deepEqual(
        result.validations.map(entry => entry.severity),
        ["over_limit", "over_limit", "over_limit"]
    );
});

test("StoreCalc applies explicit line tax rounding and inclusive-tax extraction", () => {
    for (const [roundingMode, expectedTax] of [
        ["half_up", "1"],
        ["floor", "0"],
        ["ceiling", "1"]
    ]) {
        const configuration = buildSyntheticConfiguration(content => {
            const soup = content.items.find(
                item => item.itemKey === "sample-soup"
            );
            soup.priceMinor = "1";
            soup.taxTreatment.ratePpm = "500000";
            soup.taxTreatment.roundingMode = roundingMode;
            content.spendingBuckets.forEach(entry => {
                entry.limitState = "unlimited";
                entry.limitMinor = null;
            });
        });
        const result = calculate(configuration, {
            quantities: [{ itemKey: "sample-soup", quantity: "1" }],
            availableFundsMinor: null
        });
        assert.equal(line(result, "sample-soup").taxMinor, expectedTax);
    }

    const inclusive = calculate(buildSyntheticConfiguration(), {
        quantities: [{ itemKey: "sample-drink", quantity: "1" }],
        availableFundsMinor: null
    });
    assert.equal(line(inclusive, "sample-drink").listedPriceTotalMinor, "195");
    assert.equal(line(inclusive, "sample-drink").itemSubtotalMinor, "182");
    assert.equal(line(inclusive, "sample-drink").taxMinor, "13");
    assert.equal(line(inclusive, "sample-drink").lineTotalMinor, "195");
});

test("StoreCalc preserves zero, not-provided, not-applicable, and unsupported states", () => {
    const result = calculate(buildSyntheticConfiguration(), {
        quantities: [],
        availableFundsMinor: null
    });

    assert.equal(result.calculationState, "complete");
    assert.equal(result.complianceState, "passes_known_rules");
    assert.equal(result.totals.listedPriceTotalMinor, "0");
    assert.equal(result.totals.itemSubtotalMinor, "0");
    assert.equal(result.totals.taxState, "not_applicable");
    assert.equal(result.totals.taxMinor, null);
    assert.equal(result.totals.finalTotalMinor, "0");
    assert.equal(result.totals.facilityFeeState, "unsupported");
    assert.equal(result.totals.facilityFeeMinor, null);
    assert.equal(result.availableFunds.state, "not_provided");
    assert.equal(result.availableFunds.remainingState, "not_applicable");
});

test("StoreCalc keeps known zero distinct across prices, limits, tax, and funds", () => {
    const configuration = buildSyntheticConfiguration(content => {
        const soup = content.items.find(item => item.itemKey === "sample-soup");
        soup.priceMinor = "0";
        for (const bucketEntry of content.spendingBuckets) {
            if (["main", "food"].includes(bucketEntry.bucketKey)) {
                bucketEntry.limitMinor = "0";
            }
        }
    });
    const result = calculate(configuration, {
        quantities: [{ itemKey: "sample-soup", quantity: "1" }],
        availableFundsMinor: "0"
    });

    assert.equal(result.calculationState, "complete");
    assert.equal(result.totals.itemSubtotalState, "known");
    assert.equal(result.totals.itemSubtotalMinor, "0");
    assert.equal(result.totals.taxState, "known");
    assert.equal(result.totals.taxMinor, "0");
    assert.equal(result.totals.finalTotalMinor, "0");
    assert.equal(bucket(result, "main").limitMinor, "0");
    assert.equal(bucket(result, "main").resultState, "within_limit");
    assert.equal(result.availableFunds.availableFundsMinor, "0");
    assert.equal(result.availableFunds.remainingMinor, "0");
    assert.equal(result.availableFunds.resultState, "within_funds");
});

test("StoreCalc rejects impossible quantities and unavailable items without hiding totals", () => {
    const excessive = calculate(buildSyntheticConfiguration(), {
        quantities: [{ itemKey: "sample-soup", quantity: "5" }],
        availableFundsMinor: null
    });
    assert.equal(excessive.calculationState, "invalid");
    assert.equal(excessive.complianceState, "violations");
    assert.ok(validationCodes(excessive).includes("quantity_above_maximum"));
    assert.equal(excessive.totals.finalTotalState, "known");

    const minimumConfiguration = buildSyntheticConfiguration(content => {
        const soup = content.items.find(item => item.itemKey === "sample-soup");
        soup.minimumSelectedQuantity = "2";
    });
    const belowMinimum = calculate(minimumConfiguration, {
        quantities: [{ itemKey: "sample-soup", quantity: "1" }],
        availableFundsMinor: null
    });
    assert.ok(validationCodes(belowMinimum).includes("quantity_below_minimum"));

    const steppedConfiguration = buildSyntheticConfiguration(content => {
        const soup = content.items.find(item => item.itemKey === "sample-soup");
        soup.quantityStep = "2";
    });
    const stepped = calculate(steppedConfiguration, {
        quantities: [{ itemKey: "sample-soup", quantity: "2" }],
        availableFundsMinor: null
    });
    assert.ok(validationCodes(stepped).includes("quantity_step_mismatch"));

    const unavailableConfiguration = buildSyntheticConfiguration(content => {
        content.items.find(
            item => item.itemKey === "sample-soup"
        ).availabilityState = "unavailable";
    });
    const unavailable = calculate(unavailableConfiguration, {
        quantities: [{ itemKey: "sample-soup", quantity: "1" }],
        availableFundsMinor: null
    });
    assert.ok(validationCodes(unavailable).includes("item_unavailable"));
    assert.equal(unavailable.calculationState, "invalid");
});

test("StoreCalc carries selected warnings and uncertain availability honestly", () => {
    const configuration = buildSyntheticConfiguration(content => {
        const soup = content.items.find(item => item.itemKey === "sample-soup");
        soup.availabilityState = "unknown";
        soup.warnings.push({
            warningCode: "verify_sample_availability",
            severity: "warning",
            messageKey: "storecalc.notice.verify_sample_availability"
        });
        content.items
            .find(item => item.itemKey === "sample-soap")
            .warnings.push({
                warningCode: "unselected_item_notice",
                severity: "warning",
                messageKey: "storecalc.notice.unselected_item_notice"
            });
    });
    const result = calculate(configuration, {
        quantities: [{ itemKey: "sample-soup", quantity: "1" }],
        availableFundsMinor: null
    });

    assert.equal(result.calculationState, "incomplete");
    assert.equal(result.complianceState, "unknown");
    assert.ok(
        validationCodes(result).includes("item_availability_unknown")
    );
    assert.deepEqual(
        result.warnings.map(warning => [
            warning.warningCode,
            warning.targetType,
            warning.targetKey
        ]),
        [
            ["verify_sample_availability", "item", "sample-soup"],
            [
                "synthetic_fixture_only",
                "configuration",
                "synthetic-general-store-v1"
            ]
        ]
    );
});

test("StoreCalc never treats unknown or unsupported values as zero", () => {
    const unknownPriceConfiguration = buildSyntheticConfiguration(content => {
        const soup = content.items.find(item => item.itemKey === "sample-soup");
        soup.priceState = "unknown";
        soup.priceMinor = null;
    });
    const unknownPrice = calculate(unknownPriceConfiguration, {
        quantities: [{ itemKey: "sample-soup", quantity: "1" }],
        availableFundsMinor: "100"
    });
    assert.equal(unknownPrice.calculationState, "invalid");
    assert.equal(unknownPrice.totals.finalTotalState, "unknown");
    assert.equal(unknownPrice.totals.finalTotalMinor, null);
    assert.equal(unknownPrice.availableFunds.remainingState, "unknown");
    assert.ok(validationCodes(unknownPrice).includes("item_price_unknown"));

    const unsupportedPriceConfiguration = buildSyntheticConfiguration(
        content => {
            const soup = content.items.find(
                item => item.itemKey === "sample-soup"
            );
            soup.priceState = "unsupported";
            soup.priceMinor = null;
        }
    );
    const unsupportedPrice = calculate(unsupportedPriceConfiguration, {
        quantities: [{ itemKey: "sample-soup", quantity: "1" }],
        availableFundsMinor: null
    });
    assert.equal(unsupportedPrice.calculationState, "invalid");
    assert.equal(unsupportedPrice.totals.finalTotalState, "unsupported");
    assert.equal(unsupportedPrice.totals.finalTotalMinor, null);
    assert.ok(
        validationCodes(unsupportedPrice).includes("item_price_unsupported")
    );

    const unknownTaxConfiguration = buildSyntheticConfiguration(content => {
        const soup = content.items.find(item => item.itemKey === "sample-soup");
        soup.taxTreatment = {
            state: "unknown",
            ratePpm: null,
            priceIncludesTax: null,
            roundingMode: null,
            roundingScope: null
        };
    });
    const unknownTax = calculate(unknownTaxConfiguration, {
        quantities: [{ itemKey: "sample-soup", quantity: "1" }],
        availableFundsMinor: null
    });
    assert.equal(unknownTax.calculationState, "incomplete");
    assert.equal(unknownTax.complianceState, "unknown");
    assert.equal(unknownTax.totals.listedPriceTotalMinor, "90");
    assert.equal(unknownTax.totals.itemSubtotalMinor, null);
    assert.equal(unknownTax.totals.finalTotalMinor, null);
    assert.ok(validationCodes(unknownTax).includes("item_tax_unknown"));

    const unsupportedTaxConfiguration = buildSyntheticConfiguration(content => {
        const soup = content.items.find(item => item.itemKey === "sample-soup");
        soup.taxTreatment = {
            state: "unsupported",
            ratePpm: null,
            priceIncludesTax: null,
            roundingMode: null,
            roundingScope: null
        };
    });
    const unsupportedTax = calculate(unsupportedTaxConfiguration, {
        quantities: [{ itemKey: "sample-soup", quantity: "1" }],
        availableFundsMinor: null
    });
    assert.equal(unsupportedTax.calculationState, "invalid");
    assert.equal(unsupportedTax.totals.finalTotalState, "unsupported");
    assert.ok(validationCodes(unsupportedTax).includes("item_tax_unsupported"));

    const unknownLimitConfiguration = buildSyntheticConfiguration(content => {
        const main = content.spendingBuckets.find(
            entry => entry.bucketKey === "main"
        );
        main.limitState = "unknown";
        main.limitMinor = null;
    });
    const unknownLimit = calculate(unknownLimitConfiguration, {
        quantities: [{ itemKey: "sample-soup", quantity: "1" }],
        availableFundsMinor: null
    });
    assert.equal(bucket(unknownLimit, "main").resultState, "unknown");
    assert.equal(unknownLimit.calculationState, "incomplete");
    assert.equal(unknownLimit.complianceState, "unknown");
});

test("StoreCalc preserves every aggregate-constraint value state", () => {
    for (const [valueState, resultState, validationCode] of [
        ["unlimited", "unlimited", null],
        ["not_applicable", "not_applicable", null],
        ["unknown", "unknown", "aggregate_constraint_unknown"],
        ["unsupported", "unsupported", "aggregate_constraint_unsupported"]
    ]) {
        const configuration = buildSyntheticConfiguration(content => {
            const target = content.constraints.find(
                entry => entry.constraintKey === "maximum-total-quantity"
            );
            target.valueState = valueState;
            target.limitValue = null;
        });
        const result = calculate(configuration, {
            quantities: [{ itemKey: "sample-soup", quantity: "1" }],
            availableFundsMinor: null
        });
        assert.equal(
            constraint(result, "maximum-total-quantity").resultState,
            resultState
        );
        if (validationCode) {
            assert.ok(validationCodes(result).includes(validationCode));
        } else {
            assert.doesNotMatch(
                validationCodes(result).join(" "),
                /aggregate_constraint_(?:unknown|unsupported)/
            );
        }
    }
});

test("StoreCalc enforces capability declarations and caller availability", () => {
    const configuration = buildSyntheticConfiguration();
    const missingTax = SUPPORTED_CALCULATION_CAPABILITIES.filter(
        capability => capability !== "tax.single_treatment.line_rounding.v1"
    );
    expectCalculationError(
        () =>
            calculateStoreCalcOrder(
                buildCalculationInput(configuration, {
                    supportedCapabilities: missingTax
                })
            ),
        "CAPABILITY_NOT_AVAILABLE",
        /^\$\.supportedCapabilities$/
    );

    const profileConfiguration = buildSyntheticConfiguration(content => {
        content.requiredCapabilities.push("profiles.composition.v1");
    });
    expectCalculationError(
        () => calculate(profileConfiguration),
        "UNSUPPORTED_CAPABILITY",
        /^\$\.configuration\.requiredCapabilities$/
    );

    const missingDeclaration = mutableContent(configuration);
    missingDeclaration.requiredCapabilities =
        missingDeclaration.requiredCapabilities.filter(
            capability =>
                capability !== "tax.single_treatment.line_rounding.v1"
        );
    expectCalculationError(
        () => sealResolvedConfiguration(missingDeclaration),
        "CAPABILITY_DECLARATION_MISSING",
        /^\$\.configuration\.requiredCapabilities$/
    );

    const unknownTaxWithoutDeclaration = mutableContent(configuration);
    for (const item of unknownTaxWithoutDeclaration.items) {
        item.taxTreatment = {
            state: "not_applicable",
            ratePpm: null,
            priceIncludesTax: null,
            roundingMode: null,
            roundingScope: null
        };
    }
    unknownTaxWithoutDeclaration.items[0].taxTreatment.state = "unknown";
    unknownTaxWithoutDeclaration.requiredCapabilities =
        unknownTaxWithoutDeclaration.requiredCapabilities.filter(
            capability =>
                capability !== "tax.single_treatment.line_rounding.v1"
        );
    expectCalculationError(
        () => sealResolvedConfiguration(unknownTaxWithoutDeclaration),
        "CAPABILITY_DECLARATION_MISSING",
        /^\$\.configuration\.requiredCapabilities$/
    );
});

test("StoreCalc rejects ambiguous memberships and duplicate warnings", () => {
    const configuration = buildSyntheticConfiguration();
    const duplicateMembership = mutableContent(configuration);
    duplicateMembership.items[0].bucketMemberships.push({
        bucketKey: "main",
        membershipType: "excluded",
        primaryDisplay: false
    });
    expectCalculationError(
        () => sealResolvedConfiguration(duplicateMembership),
        "BUCKET_MEMBERSHIP_DUPLICATE",
        /^\$\.configuration\.items\[0\]\.bucketMemberships$/
    );

    const ambiguousPrimary = mutableContent(configuration);
    for (const membership of ambiguousPrimary.items[0].bucketMemberships) {
        membership.primaryDisplay = true;
    }
    expectCalculationError(
        () => sealResolvedConfiguration(ambiguousPrimary),
        "PRIMARY_BUCKET_AMBIGUOUS",
        /^\$\.configuration\.items\[0\]\.bucketMemberships$/
    );

    const duplicateConfigurationWarning = mutableContent(configuration);
    duplicateConfigurationWarning.warnings.push(
        structuredClone(duplicateConfigurationWarning.warnings[0])
    );
    expectCalculationError(
        () => sealResolvedConfiguration(duplicateConfigurationWarning),
        "WARNING_DUPLICATE",
        /^\$\.configuration\.warnings$/
    );

    const duplicateItemWarning = mutableContent(configuration);
    const warning = {
        warningCode: "synthetic_item_notice",
        severity: "warning",
        messageKey: "storecalc.notice.synthetic_item_notice"
    };
    duplicateItemWarning.items[0].warnings.push(warning, {
        ...warning
    });
    expectCalculationError(
        () => sealResolvedConfiguration(duplicateItemWarning),
        "WARNING_DUPLICATE",
        /^\$\.configuration\.items\[0\]\.warnings$/
    );

    const tooManyWarnings = mutableContent(configuration);
    tooManyWarnings.items[0].warnings = Array.from(
        { length: CALCULATION_BOUNDS.maxWarnings },
        (_, index) => ({
            warningCode: `synthetic_warning_${index}`,
            severity: "informational",
            messageKey: `storecalc.notice.synthetic_warning_${index}`
        })
    );
    expectCalculationError(
        () => sealResolvedConfiguration(tooManyWarnings),
        "WARNING_COUNT_BOUND_EXCEEDED",
        /^\$\.configuration\.warnings$/
    );
});

test("StoreCalc rejects duplicate identities and missing bucket references", () => {
    const configuration = buildSyntheticConfiguration();
    for (const [collection, duplicateCode] of [
        ["items", "ITEM_KEY_DUPLICATE"],
        ["spendingBuckets", "BUCKET_KEY_DUPLICATE"],
        ["constraints", "CONSTRAINT_KEY_DUPLICATE"]
    ]) {
        const duplicate = mutableContent(configuration);
        duplicate[collection].push(structuredClone(duplicate[collection][0]));
        expectCalculationError(
            () => sealResolvedConfiguration(duplicate),
            duplicateCode,
            new RegExp(`^\\$\\.configuration\\.${collection}$`)
        );
    }

    const missingBucket = mutableContent(configuration);
    missingBucket.items[0].bucketMemberships[0].bucketKey = "missing-bucket";
    expectCalculationError(
        () => sealResolvedConfiguration(missingBucket),
        "BUCKET_REFERENCE_MISSING",
        /^\$\.configuration\.items$/
    );
});

test("StoreCalc accepts only reviewed currency and exponent pairs", () => {
    const configuration = buildSyntheticConfiguration();
    const unsupportedCurrency = mutableContent(configuration);
    unsupportedCurrency.currencyCode = "EUR";
    expectCalculationError(
        () => sealResolvedConfiguration(unsupportedCurrency),
        "CURRENCY_CODE_UNSUPPORTED",
        /^\$\.configuration\.currencyCode$/
    );

    const mismatchedExponent = mutableContent(configuration);
    mismatchedExponent.currencyExponent = 3;
    expectCalculationError(
        () => sealResolvedConfiguration(mismatchedExponent),
        "CURRENCY_EXPONENT_MISMATCH",
        /^\$\.configuration\.currencyExponent$/
    );

    const malformedCurrency = mutableContent(configuration);
    malformedCurrency.currencyCode = "usd";
    expectCalculationError(
        () => sealResolvedConfiguration(malformedCurrency),
        "CURRENCY_CODE_INVALID",
        /^\$\.configuration\.currencyCode$/
    );

    const unboundedExponent = mutableContent(configuration);
    unboundedExponent.currencyExponent = 4;
    expectCalculationError(
        () => sealResolvedConfiguration(unboundedExponent),
        "CURRENCY_EXPONENT_UNSUPPORTED",
        /^\$\.configuration\.currencyExponent$/
    );
});

test("StoreCalc rejects incompatible versions and malformed hashes", () => {
    const configuration = buildSyntheticConfiguration();
    for (const [field, replacement, code] of [
        [
            "resolvedSchemaVersion",
            "storecalc.resolved-configuration.v2",
            "RESOLVED_SCHEMA_VERSION_UNSUPPORTED"
        ],
        [
            "calculationContractVersion",
            "storecalc.calculation.v2",
            "CALCULATION_CONTRACT_VERSION_UNSUPPORTED"
        ],
        [
            "contentSchemaVersion",
            "storecalc.catalog-content.v2",
            "CONTENT_SCHEMA_VERSION_UNSUPPORTED"
        ],
        [
            "canonicalizationVersion",
            "storecalc.canonical-json.v2",
            "CANONICALIZATION_VERSION_UNSUPPORTED"
        ],
        ["hashAlgorithm", "sha512", "HASH_ALGORITHM_UNSUPPORTED"]
    ]) {
        const incompatible = structuredClone(configuration);
        incompatible[field] = replacement;
        expectCalculationError(
            () => calculate(incompatible),
            code,
            /^\$\.configuration$/
        );
    }

    const malformedHash = structuredClone(configuration);
    malformedHash.contentHash = "not-a-sha256-digest";
    expectCalculationError(
        () => calculate(malformedHash),
        "CONTENT_HASH_INVALID",
        /^\$\.configuration\.contentHash$/
    );
});

test("StoreCalc rejects stale hashes, unknown shapes, unsafe text, and invalid dates", () => {
    const configuration = buildSyntheticConfiguration();
    const tampered = structuredClone(configuration);
    tampered.items[0].priceMinor = "91";
    expectCalculationError(
        () => calculate(tampered),
        "CONTENT_HASH_MISMATCH",
        /^\$\.configuration\.contentHash$/
    );

    const extraInput = buildCalculationInput(configuration);
    extraInput.clientTotalMinor = "1";
    expectCalculationError(
        () => calculateStoreCalcOrder(extraInput),
        "OBJECT_FIELD_UNSUPPORTED"
    );

    for (const unsafeCharacter of ["\u061c", "\u200f", "\u202e", "\u2067"]) {
        const unsafeText = mutableContent(configuration);
        unsafeText.items[0].displayName = `unsafe${unsafeCharacter}item`;
        expectCalculationError(
            () => sealResolvedConfiguration(unsafeText),
            "TEXT_INVALID",
            /^\$\.configuration\.items\[0\]\.displayName$/
        );
    }

    for (const contextDate of ["2026-02-30", "2025-02-29", "03-08-2026"]) {
        expectCalculationError(
            () => calculate(configuration, { contextDate }),
            "CONTEXT_DATE_INVALID",
            /^\$\.contextDate$/
        );
    }
    assert.doesNotThrow(() =>
        calculate(configuration, { contextDate: "2024-02-29" })
    );
});

test("StoreCalc preserves independent unknown and unsupported bucket states", () => {
    const configuration = buildSyntheticConfiguration(content => {
        const soup = content.items.find(item => item.itemKey === "sample-soup");
        soup.taxTreatment = {
            state: "unknown",
            ratePpm: null,
            priceIncludesTax: null,
            roundingMode: null,
            roundingScope: null
        };
        const main = content.spendingBuckets.find(
            entry => entry.bucketKey === "main"
        );
        main.limitState = "unsupported";
        main.limitMinor = null;
    });
    const result = calculate(configuration, {
        quantities: [{ itemKey: "sample-soup", quantity: "1" }],
        availableFundsMinor: null
    });

    assert.equal(bucket(result, "main").amountState, "unknown");
    assert.equal(bucket(result, "main").limitState, "unsupported");
    assert.equal(bucket(result, "main").resultState, "unsupported");
    assert.ok(validationCodes(result).includes("bucket_amount_unknown"));
    assert.ok(validationCodes(result).includes("bucket_limit_unsupported"));
    assert.equal(result.calculationState, "invalid");
});

test("StoreCalc numeric boundaries fail before ambiguous arithmetic", () => {
    const configuration = buildSyntheticConfiguration();

    for (const availableFundsMinor of ["-1", "01", "1.0", ""]) {
        expectCalculationError(
            () => calculate(configuration, { availableFundsMinor }),
            "UNSIGNED_INTEGER_INVALID",
            /^\$\.availableFundsMinor$/
        );
    }
    expectCalculationError(
        () =>
            calculate(configuration, {
                quantities: [
                    {
                        itemKey: "sample-soup",
                        quantity: (BigInt(CALCULATION_BOUNDS.maxQuantity) + 1n).toString()
                    }
                ]
            }),
        "UNSIGNED_INTEGER_BOUND_EXCEEDED",
        /^\$\.quantities\[0\]\.quantity$/
    );
    expectCalculationError(
        () =>
            calculate(configuration, {
                availableFundsMinor: "9".repeat(1000)
            }),
        "UNSIGNED_INTEGER_BOUND_EXCEEDED",
        /^\$\.availableFundsMinor$/
    );

    const overflowConfiguration = buildSyntheticConfiguration(content => {
        const soup = content.items.find(item => item.itemKey === "sample-soup");
        soup.priceMinor = CALCULATION_BOUNDS.maxMoneyMinor;
        soup.maximumOrderQuantity = "2";
        soup.taxTreatment.ratePpm = "0";
        content.spendingBuckets.forEach(entry => {
            entry.limitState = "unlimited";
            entry.limitMinor = null;
        });
    });
    expectCalculationError(
        () =>
            calculate(overflowConfiguration, {
                quantities: [{ itemKey: "sample-soup", quantity: "2" }],
                availableFundsMinor: null
            }),
        "CALCULATION_OVERFLOW"
    );
});

test("StoreCalc quantities and rule arrays are order-independent", () => {
    const configuration = buildSyntheticConfiguration();
    const forward = calculate(configuration);
    const reversed = calculate(configuration, {
        quantities: [
            { itemKey: "sample-soap", quantity: "1" },
            { itemKey: "sample-drink", quantity: "1" },
            { itemKey: "sample-soup", quantity: "2" }
        ]
    });
    assert.deepEqual(reversed, forward);
    assert.equal(reversed.resultHash, forward.resultHash);
});

test("StoreCalc reproduces old versions while a new sealed version changes results", () => {
    const versionOne = buildSyntheticConfiguration();
    const versionTwo = buildSyntheticV2Configuration();
    const oldBefore = calculate(versionOne);
    const newResult = calculate(versionTwo);
    const oldAfter = calculate(versionOne);

    assert.notEqual(versionTwo.contentHash, versionOne.contentHash);
    assert.notEqual(newResult.resultHash, oldBefore.resultHash);
    assert.equal(newResult.totals.itemSubtotalMinor, "682");
    assert.equal(newResult.totals.taxMinor, "27");
    assert.equal(newResult.totals.finalTotalMinor, "709");
    assert.deepEqual(oldAfter, oldBefore);
});

test("StoreCalc evaluates aggregate count constraints without money inference", () => {
    const result = calculate(buildSyntheticConfiguration(), {
        quantities: [
            { itemKey: "sample-soup", quantity: "4" },
            { itemKey: "sample-drink", quantity: "4" },
            { itemKey: "sample-soap", quantity: "1" }
        ],
        availableFundsMinor: null
    });
    assert.equal(
        constraint(result, "maximum-total-quantity").actualValue,
        "9"
    );
    assert.equal(
        constraint(result, "maximum-total-quantity").resultState,
        "over_limit"
    );
    assert.ok(
        validationCodes(result).includes("aggregate_constraint_failed")
    );

    const minimumLinesConfiguration = buildSyntheticConfiguration(content => {
        const lineConstraint = content.constraints.find(
            entry => entry.constraintKey === "maximum-distinct-lines"
        );
        lineConstraint.comparator = "greater_than_or_equal";
        lineConstraint.limitValue = "3";
    });
    const minimumLines = calculate(minimumLinesConfiguration, {
        quantities: [
            { itemKey: "sample-soup", quantity: "1" },
            { itemKey: "sample-drink", quantity: "1" }
        ],
        availableFundsMinor: null
    });
    assert.equal(
        constraint(minimumLines, "maximum-distinct-lines").resultState,
        "over_limit"
    );
});

test("StoreCalc arithmetic properties hold across deterministic bounded cases", () => {
    let state = 0x51f15e;
    const next = maximum => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state % maximum;
    };

    for (let index = 0; index < 250; index += 1) {
        const price = BigInt(next(1_000_000) + 1);
        const quantity = BigInt(next(500) + 1);
        const rate = BigInt(next(1_000_001));
        const roundingMode = ["half_up", "floor", "ceiling"][next(3)];
        const priceIncludesTax = next(2) === 1;
        const configuration = buildSyntheticConfiguration(content => {
            const soup = content.items.find(
                item => item.itemKey === "sample-soup"
            );
            soup.priceMinor = price.toString();
            soup.maximumOrderQuantity = "500";
            soup.taxTreatment.ratePpm = rate.toString();
            soup.taxTreatment.roundingMode = roundingMode;
            soup.taxTreatment.priceIncludesTax = priceIncludesTax;
            content.spendingBuckets.forEach(entry => {
                entry.limitState = "unlimited";
                entry.limitMinor = null;
            });
            content.constraints.forEach(entry => {
                entry.valueState = "unlimited";
                entry.limitValue = null;
            });
        });
        const result = calculate(configuration, {
            quantities: [
                { itemKey: "sample-soup", quantity: quantity.toString() }
            ],
            availableFundsMinor: null
        });

        const listed = price * quantity;
        const numerator = listed * rate;
        const denominator = priceIncludesTax
            ? 1_000_000n + rate
            : 1_000_000n;
        const quotient = numerator / denominator;
        const remainder = numerator % denominator;
        const expectedTax =
            roundingMode === "floor" || remainder === 0n
                ? quotient
                : roundingMode === "ceiling"
                  ? quotient + 1n
                  : remainder * 2n >= denominator
                    ? quotient + 1n
                    : quotient;
        const expectedSubtotal = priceIncludesTax
            ? listed - expectedTax
            : listed;
        const expectedFinal = priceIncludesTax
            ? listed
            : listed + expectedTax;
        assert.equal(
            result.totals.itemSubtotalMinor,
            expectedSubtotal.toString()
        );
        assert.equal(result.totals.taxMinor, expectedTax.toString());
        assert.equal(
            result.totals.finalTotalMinor,
            expectedFinal.toString()
        );
    }
});

test("StoreCalc errors are bounded and never echo rejected input", () => {
    const configuration = buildSyntheticConfiguration();
    const rejectedKey = "secret-looking-item-key";
    try {
        calculate(configuration, {
            quantities: [{ itemKey: rejectedKey, quantity: "1" }]
        });
        assert.fail("missing item must fail");
    } catch (error) {
        assert.ok(error instanceof StoreCalcCalculationError);
        assert.equal(error.message, "ITEM_REFERENCE_MISSING");
        assert.doesNotMatch(error.message, new RegExp(rejectedKey));
        assert.doesNotMatch(error.path, new RegExp(rejectedKey));
    }
});

test("StoreCalc canonical JSON is locale-free and strict", () => {
    assert.equal(
        canonicalizeStoreCalcValue({ z: "last", a: [2, 1], middle: null }),
        '{"a":[2,1],"middle":null,"z":"last"}'
    );
    expectCalculationError(
        () => canonicalizeStoreCalcValue({ unsafe: 1.5 }),
        "CANONICAL_NUMBER_INVALID"
    );
    expectCalculationError(
        () => canonicalizeStoreCalcValue({ unsafe: undefined }),
        "CANONICAL_VALUE_INVALID"
    );

    assert.doesNotMatch(coreSource, /localeCompare|toLocaleString|Intl\./);
    assert.doesNotMatch(coreSource, /Date\.now|new Date\s*\(/);
    assert.doesNotMatch(coreSource, /\bfetch\s*\(|XMLHttpRequest|process\.env/);
    assert.doesNotMatch(coreSource, /from ["'][^"']*(?:db|database|pool)/i);
    assert.match(implementationNotes, /does \*\*not\*\* add an endpoint/);
    assert.match(implementationNotes, /test data only/);
    assert.match(
        implementationNotes,
        /Facility fees remain\s+explicitly `unsupported`/
    );
});
