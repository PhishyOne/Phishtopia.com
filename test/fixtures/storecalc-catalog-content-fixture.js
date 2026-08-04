import { sealCatalogVersionContent } from "../../src/storecalc/catalog/content.js";
import {
    SUPPORTED_CALCULATION_CAPABILITIES
} from "../../src/storecalc/calculation/core.js";

const SYNTHETIC_CONTENT = {
    contentSchemaVersion: "storecalc.catalog-content.v1",
    canonicalizationVersion: "storecalc.canonical-json.v1",
    calculationContractVersion: "storecalc.calculation.v1",
    hashAlgorithm: "sha256",
    currencyCode: "USD",
    currencyExponent: 2,
    sourceEffectiveDate: "2026-08-01",
    sourcePublishedDate: "2026-07-15",
    requiredCapabilities: [...SUPPORTED_CALCULATION_CAPABILITIES],
    categories: [
        {
            categoryKey: "food",
            displayName: "Synthetic food",
            description: "Synthetic fixture category only.",
            sortOrder: 10,
            active: true
        },
        {
            categoryKey: "hygiene",
            displayName: "Synthetic hygiene",
            description: null,
            sortOrder: 20,
            active: true
        }
    ],
    items: [
        {
            itemKey: "sample_soup",
            categoryKey: "food",
            sku: "SYN-SOUP",
            displayName: "Sample soup",
            description: "Synthetic fixture item only.",
            unitLabel: "can",
            priceState: "known",
            priceMinor: "90",
            minimumSelectedQuantity: "1",
            maximumOrderQuantity: "4",
            quantityStep: "1",
            availabilityState: "available",
            sortOrder: 10
        },
        {
            itemKey: "sample_soap",
            categoryKey: "hygiene",
            sku: null,
            displayName: "Sample soap",
            description: null,
            unitLabel: "bar",
            priceState: "unknown",
            priceMinor: null,
            minimumSelectedQuantity: "1",
            maximumOrderQuantity: "6",
            quantityStep: "1",
            availabilityState: "unknown",
            sortOrder: 20
        }
    ],
    spendingBuckets: [
        {
            bucketKey: "main",
            displayName: "Main spending limit",
            limitState: "known",
            limitMinor: "600",
            measureCurrencyCode: "USD",
            isPrimaryDisplay: true,
            sortOrder: 10
        },
        {
            bucketKey: "food",
            displayName: "Food limit",
            limitState: "known",
            limitMinor: "200",
            measureCurrencyCode: "USD",
            isPrimaryDisplay: false,
            sortOrder: 20
        }
    ],
    bucketMemberships: [
        {
            itemKey: "sample_soup",
            bucketKey: "main",
            membershipType: "counts_toward",
            primaryDisplay: true
        },
        {
            itemKey: "sample_soup",
            bucketKey: "food",
            membershipType: "counts_toward",
            primaryDisplay: false
        },
        {
            itemKey: "sample_soap",
            bucketKey: "main",
            membershipType: "excluded",
            primaryDisplay: false
        }
    ],
    taxRules: [
        {
            scopeType: "template",
            categoryKey: null,
            itemKey: null,
            treatmentState: "known",
            ratePpm: "70000",
            priceIncludesTax: false,
            roundingMode: "half_up",
            roundingScope: "line",
            priority: 10
        },
        {
            scopeType: "item",
            categoryKey: null,
            itemKey: "sample_soap",
            treatmentState: "not_applicable",
            ratePpm: null,
            priceIncludesTax: null,
            roundingMode: null,
            roundingScope: null,
            priority: 20
        }
    ],
    constraints: [
        {
            constraintKey: "maximum_distinct_lines",
            displayName: "Maximum distinct lines",
            constraintType: "order_aggregate",
            measureType: "distinct_line_count",
            comparator: "less_than_or_equal",
            valueState: "known",
            limitValue: "3",
            unitCode: "count",
            scopeType: "order",
            compositionBehavior: "all_must_pass",
            priority: 10
        }
    ],
    warnings: [
        {
            warningCode: "synthetic_fixture_only",
            severity: "informational",
            scopeType: "template",
            categoryKey: null,
            itemKey: null,
            messageKey: "storecalc.notice.synthetic_fixture_only",
            boundedDetails: {}
        },
        {
            warningCode: "price_unknown",
            severity: "warning",
            scopeType: "item",
            categoryKey: null,
            itemKey: "sample_soap",
            messageKey: "storecalc.warning.price_unknown",
            boundedDetails: {}
        }
    ],
    sourceEvidence: [
        {
            evidenceFingerprint: "1".repeat(64),
            relationshipType: "supports_catalog",
            sourceGroupFingerprint: "2".repeat(64)
        }
    ]
};

export function buildSyntheticCatalogContent(mutator = () => {}) {
    const content = structuredClone(SYNTHETIC_CONTENT);
    mutator(content);
    return sealCatalogVersionContent(content);
}

export function buildUnsealedSyntheticCatalogContent(mutator = () => {}) {
    const content = structuredClone(SYNTHETIC_CONTENT);
    mutator(content);
    return content;
}
