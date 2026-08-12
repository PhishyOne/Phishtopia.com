import {
    RESOLVED_CONFIGURATION_SCHEMA_VERSION,
    sealResolvedConfiguration,
    SUPPORTED_CALCULATION_CAPABILITIES
} from "../calculation/core.js";
import { verifyCatalogVersionContent } from "./content.js";

export const CATALOG_CONFIGURATION_PROJECTION_VERSION =
    "storecalc.catalog-configuration-projection.v1";

const ENGINE_CAPABILITIES = new Set(SUPPORTED_CALCULATION_CAPABILITIES);
export class StoreCalcCatalogProjectionError extends Error {
    constructor(code, path = "$", options = undefined) {
        super(code, options);
        this.name = "StoreCalcCatalogProjectionError";
        this.code = code;
        this.path = path;
    }
}

function fail(code, path = "$", cause = undefined) {
    const options = cause === undefined ? undefined : { cause };
    throw new StoreCalcCatalogProjectionError(code, path, options);
}

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function configurationKeyFrom(value) {
    if (
        !isPlainObject(value) ||
        Object.keys(value).length !== 1 ||
        !Object.hasOwn(value, "configurationKey")
    ) {
        fail("PROJECTION_INPUT_INVALID", "$.projection");
    }
    return value.configurationKey;
}

function verifyCatalog(value) {
    try {
        return verifyCatalogVersionContent(value);
    } catch (error) {
        fail("CATALOG_CONTENT_INVALID", "$.catalog", error);
    }
}

function assertSupportedCapabilities(catalog) {
    const unsupported = catalog.requiredCapabilities.find(
        capability => !ENGINE_CAPABILITIES.has(capability)
    );
    if (unsupported !== undefined) {
        fail(
            "CATALOG_CAPABILITY_UNSUPPORTED",
            "$.catalog.requiredCapabilities"
        );
    }
}

function appendToIndex(index, key, value) {
    const values = index.get(key);
    if (values === undefined) index.set(key, [value]);
    else values.push(value);
}

function buildProjectionIndex(catalog) {
    const index = {
        itemMemberships: new Map(),
        itemWarnings: new Map(),
        itemTaxRules: new Map(),
        categoryTaxRules: new Map(),
        templateTaxRules: [],
        templateWarnings: []
    };
    for (const membership of catalog.bucketMemberships) {
        appendToIndex(index.itemMemberships, membership.itemKey, membership);
    }
    for (const warning of catalog.warnings) {
        if (warning.scopeType === "template") {
            index.templateWarnings.push(warning);
        } else {
            appendToIndex(index.itemWarnings, warning.itemKey, warning);
        }
    }
    for (const rule of catalog.taxRules) {
        if (rule.scopeType === "template") {
            index.templateTaxRules.push(rule);
        } else if (rule.scopeType === "category") {
            appendToIndex(index.categoryTaxRules, rule.categoryKey, rule);
        } else {
            appendToIndex(index.itemTaxRules, rule.itemKey, rule);
        }
    }
    return index;
}

function applicableTaxRules(index, item) {
    const itemRules = index.itemTaxRules.get(item.itemKey);
    if (itemRules !== undefined && itemRules.length > 0) return itemRules;
    if (item.categoryKey !== null) {
        const categoryRules = index.categoryTaxRules.get(item.categoryKey);
        if (categoryRules !== undefined && categoryRules.length > 0) {
            return categoryRules;
        }
    }
    return index.templateTaxRules;
}

function resolveTaxTreatment(index, item) {
    const rules = applicableTaxRules(index, item);
    if (rules.length === 0) {
        fail(
            "CATALOG_TAX_TREATMENT_MISSING",
            `$.catalog.items.${item.itemKey}`
        );
    }

    const maximumPriority = Math.max(...rules.map(rule => rule.priority));
    const winners = rules.filter(rule => rule.priority === maximumPriority);
    if (winners.length !== 1) {
        fail(
            "CATALOG_TAX_TREATMENT_AMBIGUOUS",
            `$.catalog.items.${item.itemKey}`
        );
    }

    const winner = winners[0];
    return {
        state: winner.treatmentState,
        ratePpm: winner.ratePpm,
        priceIncludesTax: winner.priceIncludesTax,
        roundingMode: winner.roundingMode,
        roundingScope: winner.roundingScope
    };
}

function projectWarning(warning) {
    return {
        warningCode: warning.warningCode,
        severity: warning.severity,
        messageKey: warning.messageKey
    };
}

function projectItem(index, item) {
    return {
        itemKey: item.itemKey,
        displayName: item.displayName,
        sortOrder: item.sortOrder,
        priceState: item.priceState,
        priceMinor: item.priceMinor,
        minimumSelectedQuantity: item.minimumSelectedQuantity,
        maximumOrderQuantity: item.maximumOrderQuantity,
        quantityStep: item.quantityStep,
        availabilityState: item.availabilityState,
        taxTreatment: resolveTaxTreatment(index, item),
        bucketMemberships: (index.itemMemberships.get(item.itemKey) ?? [])
            .map(membership => ({
                bucketKey: membership.bucketKey,
                membershipType: membership.membershipType,
                primaryDisplay: membership.primaryDisplay
            })),
        warnings: (index.itemWarnings.get(item.itemKey) ?? [])
            .map(projectWarning)
    };
}

function projectBucket(bucket) {
    return {
        bucketKey: bucket.bucketKey,
        displayName: bucket.displayName,
        sortOrder: bucket.sortOrder,
        limitState: bucket.limitState,
        limitMinor: bucket.limitMinor
    };
}

function projectConstraint(constraint) {
    return {
        constraintKey: constraint.constraintKey,
        displayName: constraint.displayName,
        sortOrder: constraint.priority,
        measureType: constraint.measureType,
        comparator: constraint.comparator,
        valueState: constraint.valueState,
        limitValue: constraint.limitValue,
        unitCode: constraint.unitCode
    };
}

export function projectCatalogVersionContent(catalogContent, options) {
    const configurationKey = configurationKeyFrom(options);
    const catalog = verifyCatalog(catalogContent);
    assertSupportedCapabilities(catalog);
    const index = buildProjectionIndex(catalog);

    try {
        return sealResolvedConfiguration({
            resolvedSchemaVersion: RESOLVED_CONFIGURATION_SCHEMA_VERSION,
            calculationContractVersion: catalog.calculationContractVersion,
            contentSchemaVersion: catalog.contentSchemaVersion,
            canonicalizationVersion: catalog.canonicalizationVersion,
            hashAlgorithm: catalog.hashAlgorithm,
            configurationKey,
            currencyCode: catalog.currencyCode,
            currencyExponent: catalog.currencyExponent,
            requiredCapabilities: [...catalog.requiredCapabilities],
            items: catalog.items.map(item => projectItem(index, item)),
            spendingBuckets: catalog.spendingBuckets.map(projectBucket),
            constraints: catalog.constraints.map(projectConstraint),
            warnings: index.templateWarnings.map(projectWarning)
        });
    } catch (error) {
        if (error instanceof StoreCalcCatalogProjectionError) throw error;
        fail("RESOLVED_CONFIGURATION_INVALID", "$.configuration", error);
    }
}
