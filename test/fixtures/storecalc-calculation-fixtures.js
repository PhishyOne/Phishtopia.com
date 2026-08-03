import {
    sealResolvedConfiguration,
    SUPPORTED_CALCULATION_CAPABILITIES
} from "../../src/storecalc/calculation/core.js";

const BASE_CONTENT = {
    resolvedSchemaVersion: "storecalc.resolved-configuration.v1",
    calculationContractVersion: "storecalc.calculation.v1",
    contentSchemaVersion: "storecalc.catalog-content.v1",
    canonicalizationVersion: "storecalc.canonical-json.v1",
    hashAlgorithm: "sha256",
    configurationKey: "synthetic-general-store-v1",
    currencyCode: "USD",
    currencyExponent: 2,
    requiredCapabilities: [...SUPPORTED_CALCULATION_CAPABILITIES],
    items: [
        {
            itemKey: "sample-soup",
            displayName: "Sample soup",
            sortOrder: 10,
            priceState: "known",
            priceMinor: "90",
            minimumSelectedQuantity: "1",
            maximumOrderQuantity: "4",
            quantityStep: "1",
            availabilityState: "available",
            taxTreatment: {
                state: "known",
                ratePpm: "70000",
                priceIncludesTax: false,
                roundingMode: "half_up",
                roundingScope: "line"
            },
            bucketMemberships: [
                {
                    bucketKey: "main",
                    membershipType: "counts_toward",
                    primaryDisplay: true
                },
                {
                    bucketKey: "food",
                    membershipType: "counts_toward",
                    primaryDisplay: false
                }
            ],
            warnings: []
        },
        {
            itemKey: "sample-drink",
            displayName: "Sample drink",
            sortOrder: 20,
            priceState: "known",
            priceMinor: "195",
            minimumSelectedQuantity: "1",
            maximumOrderQuantity: "4",
            quantityStep: "1",
            availabilityState: "available",
            taxTreatment: {
                state: "known",
                ratePpm: "70000",
                priceIncludesTax: true,
                roundingMode: "half_up",
                roundingScope: "line"
            },
            bucketMemberships: [
                {
                    bucketKey: "main",
                    membershipType: "counts_toward",
                    primaryDisplay: true
                },
                {
                    bucketKey: "beverage",
                    membershipType: "counts_toward",
                    primaryDisplay: false
                }
            ],
            warnings: []
        },
        {
            itemKey: "sample-soap",
            displayName: "Sample hygiene item",
            sortOrder: 30,
            priceState: "known",
            priceMinor: "300",
            minimumSelectedQuantity: "1",
            maximumOrderQuantity: "6",
            quantityStep: "1",
            availabilityState: "available",
            taxTreatment: {
                state: "not_applicable",
                ratePpm: null,
                priceIncludesTax: null,
                roundingMode: null,
                roundingScope: null
            },
            bucketMemberships: [
                {
                    bucketKey: "main",
                    membershipType: "excluded",
                    primaryDisplay: false
                },
                {
                    bucketKey: "hygiene",
                    membershipType: "counts_toward",
                    primaryDisplay: true
                }
            ],
            warnings: []
        }
    ],
    spendingBuckets: [
        {
            bucketKey: "main",
            displayName: "Main spending limit",
            sortOrder: 10,
            limitState: "known",
            limitMinor: "600"
        },
        {
            bucketKey: "food",
            displayName: "Food limit",
            sortOrder: 20,
            limitState: "known",
            limitMinor: "200"
        },
        {
            bucketKey: "beverage",
            displayName: "Beverage total",
            sortOrder: 30,
            limitState: "unlimited",
            limitMinor: null
        },
        {
            bucketKey: "hygiene",
            displayName: "Hygiene total",
            sortOrder: 40,
            limitState: "unlimited",
            limitMinor: null
        }
    ],
    constraints: [
        {
            constraintKey: "maximum-distinct-lines",
            displayName: "Maximum distinct lines",
            sortOrder: 10,
            measureType: "distinct_line_count",
            comparator: "less_than_or_equal",
            valueState: "known",
            limitValue: "3",
            unitCode: "count"
        },
        {
            constraintKey: "maximum-total-quantity",
            displayName: "Maximum total quantity",
            sortOrder: 20,
            measureType: "total_quantity",
            comparator: "less_than_or_equal",
            valueState: "known",
            limitValue: "8",
            unitCode: "count"
        }
    ],
    warnings: [
        {
            warningCode: "synthetic_fixture_only",
            severity: "informational",
            messageKey: "storecalc.notice.synthetic_fixture_only"
        }
    ]
};

export function buildSyntheticConfiguration(mutator = () => {}) {
    const content = structuredClone(BASE_CONTENT);
    mutator(content);
    return sealResolvedConfiguration(content);
}

export function buildSyntheticV2Configuration() {
    return buildSyntheticConfiguration(content => {
        content.configurationKey = "synthetic-general-store-v2";
        content.items.find(item => item.itemKey === "sample-soup").priceMinor =
            "100";
    });
}

export function buildCalculationInput(
    configuration,
    {
        contextDate = "2026-08-03",
        quantities = [
            { itemKey: "sample-soup", quantity: "2" },
            { itemKey: "sample-drink", quantity: "1" },
            { itemKey: "sample-soap", quantity: "1" }
        ],
        availableFundsMinor = "700",
        supportedCapabilities = [...SUPPORTED_CALCULATION_CAPABILITIES]
    } = {}
) {
    return {
        configuration,
        contextDate,
        quantities,
        availableFundsMinor,
        supportedCapabilities
    };
}
