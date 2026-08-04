import { createHash } from "node:crypto";

import {
    CALCULATION_BOUNDS,
    CALCULATION_CONTRACT_VERSION,
    CANONICALIZATION_VERSION,
    CATALOG_CONTENT_SCHEMA_VERSION,
    canonicalizeStoreCalcValue,
    HASH_ALGORITHM,
    SUPPORTED_CURRENCY_EXPONENTS
} from "../calculation/core.js";

export const CATALOG_CONTENT_BOUNDS = Object.freeze({
    maxBucketMemberships:
        CALCULATION_BOUNDS.maxItems * CALCULATION_BOUNDS.maxBuckets,
    maxCategories: 256,
    maxSourceEvidence: 128,
    maxTaxRules: 4096,
    ...CALCULATION_BOUNDS
});

export const CATALOG_SOURCE_EVIDENCE_RELATIONSHIPS = Object.freeze([
    "supports_catalog"
]);

const MAX_AGGREGATE_COUNT = BigInt(
    CATALOG_CONTENT_BOUNDS.maxAggregateCount
);
const MAX_MONEY_MINOR = BigInt(CATALOG_CONTENT_BOUNDS.maxMoneyMinor);
const MAX_QUANTITY = BigInt(CATALOG_CONTENT_BOUNDS.maxQuantity);
const MAX_TAX_RATE_PPM = BigInt(CATALOG_CONTENT_BOUNDS.maxTaxRatePpm);
const TEXT_ENCODER = new TextEncoder();
const IDENTITY_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const RULE_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const CAPABILITY_PATTERN =
    /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*\.v[1-9][0-9]*$/;
const MESSAGE_KEY_PATTERN =
    /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+$/;
const UNSIGNED_INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const FORBIDDEN_TEXT =
    /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u206f]/u;

const SEVERITY_ORDER = Object.freeze({
    warning: 0,
    informational: 1
});

export class StoreCalcCatalogContentError extends Error {
    constructor(code, path = "$") {
        super(code);
        this.name = "StoreCalcCatalogContentError";
        this.code = code;
        this.path = path;
    }
}

function fail(code, path = "$") {
    throw new StoreCalcCatalogContentError(code, path);
}

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, keys, path) {
    if (!isPlainObject(value)) fail("OBJECT_REQUIRED", path);
    const actual = Object.keys(value);
    if (
        actual.length !== keys.length ||
        keys.some(key => !Object.hasOwn(value, key))
    ) {
        fail("OBJECT_SHAPE_INVALID", path);
    }
}

function assertArray(value, maximum, path, { minimum = 0 } = {}) {
    if (!Array.isArray(value)) fail("ARRAY_REQUIRED", path);
    if (value.length < minimum || value.length > maximum) {
        fail("ARRAY_BOUND_EXCEEDED", path);
    }
    const keys = Object.keys(value);
    if (
        keys.length !== value.length ||
        keys.some((key, index) => key !== String(index))
    ) {
        fail("ARRAY_SHAPE_INVALID", path);
    }
}

function normalizeText(
    value,
    path,
    { maximumCodePoints, maximumBytes }
) {
    if (typeof value !== "string" || !value || value !== value.trim()) {
        fail("TEXT_INVALID", path);
    }
    if (
        value.length > maximumBytes ||
        value.length > maximumCodePoints * 2
    ) {
        fail("TEXT_BOUND_EXCEEDED", path);
    }
    if (value.normalize("NFC") !== value || FORBIDDEN_TEXT.test(value)) {
        fail("TEXT_INVALID", path);
    }
    if (
        Array.from(value).length > maximumCodePoints ||
        TEXT_ENCODER.encode(value).length > maximumBytes
    ) {
        fail("TEXT_BOUND_EXCEEDED", path);
    }
    return value;
}

function normalizeNullableText(value, path, bounds) {
    return value === null ? null : normalizeText(value, path, bounds);
}

function normalizeIdentityKey(value, path) {
    const normalized = normalizeText(value, path, {
        maximumCodePoints: 64,
        maximumBytes: 64
    });
    if (!IDENTITY_KEY_PATTERN.test(normalized)) {
        fail("IDENTITY_KEY_INVALID", path);
    }
    return normalized;
}

function normalizeRuleKey(value, path) {
    const normalized = normalizeText(value, path, {
        maximumCodePoints: 64,
        maximumBytes: 64
    });
    if (!RULE_KEY_PATTERN.test(normalized)) fail("RULE_KEY_INVALID", path);
    return normalized;
}

function normalizeMessageKey(value, path) {
    const normalized = normalizeText(value, path, {
        maximumCodePoints: 128,
        maximumBytes: 128
    });
    if (!MESSAGE_KEY_PATTERN.test(normalized)) {
        fail("MESSAGE_KEY_INVALID", path);
    }
    return normalized;
}

function normalizeCapability(value, path) {
    const normalized = normalizeText(value, path, {
        maximumCodePoints: 96,
        maximumBytes: 96
    });
    if (!CAPABILITY_PATTERN.test(normalized)) {
        fail("CAPABILITY_INVALID", path);
    }
    return normalized;
}

function normalizeHash(value, path) {
    if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
        fail("HASH_INVALID", path);
    }
    return value;
}

function normalizeEnum(value, allowed, path) {
    if (typeof value !== "string" || !allowed.includes(value)) {
        fail("ENUM_VALUE_INVALID", path);
    }
    return value;
}

function normalizeBoundedInteger(value, maximum, path) {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
        fail("INTEGER_BOUND_EXCEEDED", path);
    }
    return value === 0 ? 0 : value;
}

function normalizeUnsigned(value, maximum, path, { minimum = 0n } = {}) {
    if (typeof value !== "string") fail("UNSIGNED_INTEGER_INVALID", path);
    if (value.length > maximum.toString().length) {
        fail("UNSIGNED_INTEGER_BOUND_EXCEEDED", path);
    }
    if (!UNSIGNED_INTEGER_PATTERN.test(value)) {
        fail("UNSIGNED_INTEGER_INVALID", path);
    }
    const parsed = BigInt(value);
    if (parsed < minimum || parsed > maximum) {
        fail("UNSIGNED_INTEGER_BOUND_EXCEEDED", path);
    }
    return parsed;
}

function normalizeDate(value, path) {
    if (value === null) return null;
    if (typeof value !== "string") fail("DATE_INVALID", path);
    const match = DATE_PATTERN.exec(value);
    if (!match) fail("DATE_INVALID", path);

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysByMonth = [
        31,
        leap ? 29 : 28,
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31
    ];
    if (
        year < 1 ||
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > daysByMonth[month - 1]
    ) {
        fail("DATE_INVALID", path);
    }
    return value;
}

function compareCodeUnits(left, right) {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
}

function assertUnique(values, identity, code, path) {
    const seen = new Set();
    for (const value of values) {
        const key = identity(value);
        if (seen.has(key)) fail(code, path);
        seen.add(key);
    }
}

function normalizeCategory(value, index) {
    const path = `$.catalog.categories[${index}]`;
    assertExactKeys(
        value,
        ["categoryKey", "displayName", "description", "sortOrder", "active"],
        path
    );
    if (typeof value.active !== "boolean") {
        fail("BOOLEAN_REQUIRED", `${path}.active`);
    }
    return {
        categoryKey: normalizeIdentityKey(
            value.categoryKey,
            `${path}.categoryKey`
        ),
        displayName: normalizeText(value.displayName, `${path}.displayName`, {
            maximumCodePoints: 120,
            maximumBytes: 512
        }),
        description: normalizeNullableText(
            value.description,
            `${path}.description`,
            { maximumCodePoints: 2000, maximumBytes: 8000 }
        ),
        sortOrder: normalizeBoundedInteger(
            value.sortOrder,
            1_000_000,
            `${path}.sortOrder`
        ),
        active: value.active
    };
}

function normalizeItem(value, index) {
    const path = `$.catalog.items[${index}]`;
    assertExactKeys(
        value,
        [
            "itemKey",
            "categoryKey",
            "sku",
            "displayName",
            "description",
            "unitLabel",
            "priceState",
            "priceMinor",
            "minimumSelectedQuantity",
            "maximumOrderQuantity",
            "quantityStep",
            "availabilityState",
            "sortOrder"
        ],
        path
    );

    const priceState = normalizeEnum(
        value.priceState,
        ["known", "unknown", "unsupported"],
        `${path}.priceState`
    );
    let priceMinor = null;
    if (priceState === "known") {
        priceMinor = normalizeUnsigned(
            value.priceMinor,
            MAX_MONEY_MINOR,
            `${path}.priceMinor`
        ).toString();
    } else if (value.priceMinor !== null) {
        fail("EXPLICIT_STATE_NULLABILITY_INVALID", `${path}.priceMinor`);
    }

    const minimum = normalizeUnsigned(
        value.minimumSelectedQuantity,
        MAX_QUANTITY,
        `${path}.minimumSelectedQuantity`,
        { minimum: 1n }
    );
    const maximum = normalizeUnsigned(
        value.maximumOrderQuantity,
        MAX_QUANTITY,
        `${path}.maximumOrderQuantity`,
        { minimum: 1n }
    );
    const step = normalizeUnsigned(
        value.quantityStep,
        MAX_QUANTITY,
        `${path}.quantityStep`,
        { minimum: 1n }
    );
    if (maximum < minimum) fail("QUANTITY_RULE_INVALID", path);

    return {
        itemKey: normalizeIdentityKey(value.itemKey, `${path}.itemKey`),
        categoryKey:
            value.categoryKey === null
                ? null
                : normalizeIdentityKey(
                      value.categoryKey,
                      `${path}.categoryKey`
                  ),
        sku: normalizeNullableText(value.sku, `${path}.sku`, {
            maximumCodePoints: 64,
            maximumBytes: 256
        }),
        displayName: normalizeText(value.displayName, `${path}.displayName`, {
            maximumCodePoints: 120,
            maximumBytes: 512
        }),
        description: normalizeNullableText(
            value.description,
            `${path}.description`,
            { maximumCodePoints: 2000, maximumBytes: 8000 }
        ),
        unitLabel: normalizeNullableText(value.unitLabel, `${path}.unitLabel`, {
            maximumCodePoints: 64,
            maximumBytes: 256
        }),
        priceState,
        priceMinor,
        minimumSelectedQuantity: minimum.toString(),
        maximumOrderQuantity: maximum.toString(),
        quantityStep: step.toString(),
        availabilityState: normalizeEnum(
            value.availabilityState,
            ["available", "unavailable", "unknown"],
            `${path}.availabilityState`
        ),
        sortOrder: normalizeBoundedInteger(
            value.sortOrder,
            1_000_000,
            `${path}.sortOrder`
        )
    };
}

function normalizeBucket(value, index, currencyCode) {
    const path = `$.catalog.spendingBuckets[${index}]`;
    assertExactKeys(
        value,
        [
            "bucketKey",
            "displayName",
            "limitState",
            "limitMinor",
            "measureCurrencyCode",
            "isPrimaryDisplay",
            "sortOrder"
        ],
        path
    );
    const limitState = normalizeEnum(
        value.limitState,
        ["known", "unlimited", "not_applicable", "unknown", "unsupported"],
        `${path}.limitState`
    );
    let limitMinor = null;
    if (limitState === "known") {
        limitMinor = normalizeUnsigned(
            value.limitMinor,
            MAX_MONEY_MINOR,
            `${path}.limitMinor`
        ).toString();
    } else if (value.limitMinor !== null) {
        fail("EXPLICIT_STATE_NULLABILITY_INVALID", `${path}.limitMinor`);
    }
    if (value.measureCurrencyCode !== currencyCode) {
        fail("BUCKET_CURRENCY_MISMATCH", `${path}.measureCurrencyCode`);
    }
    if (typeof value.isPrimaryDisplay !== "boolean") {
        fail("BOOLEAN_REQUIRED", `${path}.isPrimaryDisplay`);
    }
    return {
        bucketKey: normalizeIdentityKey(value.bucketKey, `${path}.bucketKey`),
        displayName: normalizeText(value.displayName, `${path}.displayName`, {
            maximumCodePoints: 120,
            maximumBytes: 512
        }),
        limitState,
        limitMinor,
        measureCurrencyCode: value.measureCurrencyCode,
        isPrimaryDisplay: value.isPrimaryDisplay,
        sortOrder: normalizeBoundedInteger(
            value.sortOrder,
            1_000_000,
            `${path}.sortOrder`
        )
    };
}

function normalizeBucketMembership(value, index) {
    const path = `$.catalog.bucketMemberships[${index}]`;
    assertExactKeys(
        value,
        ["itemKey", "bucketKey", "membershipType", "primaryDisplay"],
        path
    );
    if (typeof value.primaryDisplay !== "boolean") {
        fail("BOOLEAN_REQUIRED", `${path}.primaryDisplay`);
    }
    return {
        itemKey: normalizeIdentityKey(value.itemKey, `${path}.itemKey`),
        bucketKey: normalizeIdentityKey(value.bucketKey, `${path}.bucketKey`),
        membershipType: normalizeEnum(
            value.membershipType,
            ["counts_toward", "excluded", "informational_only"],
            `${path}.membershipType`
        ),
        primaryDisplay: value.primaryDisplay
    };
}

function normalizeTaxRule(value, index) {
    const path = `$.catalog.taxRules[${index}]`;
    assertExactKeys(
        value,
        [
            "scopeType",
            "categoryKey",
            "itemKey",
            "treatmentState",
            "ratePpm",
            "priceIncludesTax",
            "roundingMode",
            "roundingScope",
            "priority"
        ],
        path
    );
    const scopeType = normalizeEnum(
        value.scopeType,
        ["template", "category", "item"],
        `${path}.scopeType`
    );
    let categoryKey = null;
    let itemKey = null;
    if (scopeType === "template") {
        if (value.categoryKey !== null || value.itemKey !== null) {
            fail("TAX_TARGET_INVALID", path);
        }
    } else if (scopeType === "category") {
        if (value.categoryKey === null || value.itemKey !== null) {
            fail("TAX_TARGET_INVALID", path);
        }
        categoryKey = normalizeIdentityKey(
            value.categoryKey,
            `${path}.categoryKey`
        );
    } else {
        if (value.categoryKey !== null || value.itemKey === null) {
            fail("TAX_TARGET_INVALID", path);
        }
        itemKey = normalizeIdentityKey(value.itemKey, `${path}.itemKey`);
    }

    const treatmentState = normalizeEnum(
        value.treatmentState,
        ["known", "not_applicable", "unknown", "unsupported"],
        `${path}.treatmentState`
    );
    let ratePpm = null;
    let priceIncludesTax = null;
    let roundingMode = null;
    let roundingScope = null;
    if (treatmentState === "known") {
        ratePpm = normalizeUnsigned(
            value.ratePpm,
            MAX_TAX_RATE_PPM,
            `${path}.ratePpm`
        ).toString();
        if (typeof value.priceIncludesTax !== "boolean") {
            fail("BOOLEAN_REQUIRED", `${path}.priceIncludesTax`);
        }
        priceIncludesTax = value.priceIncludesTax;
        roundingMode = normalizeEnum(
            value.roundingMode,
            ["half_up", "floor", "ceiling"],
            `${path}.roundingMode`
        );
        roundingScope = normalizeEnum(
            value.roundingScope,
            ["line"],
            `${path}.roundingScope`
        );
    } else if (
        value.ratePpm !== null ||
        value.priceIncludesTax !== null ||
        value.roundingMode !== null ||
        value.roundingScope !== null
    ) {
        fail("EXPLICIT_STATE_NULLABILITY_INVALID", path);
    }

    return {
        scopeType,
        categoryKey,
        itemKey,
        treatmentState,
        ratePpm,
        priceIncludesTax,
        roundingMode,
        roundingScope,
        priority: normalizeBoundedInteger(
            value.priority,
            1_000_000,
            `${path}.priority`
        )
    };
}

function normalizeConstraint(value, index) {
    const path = `$.catalog.constraints[${index}]`;
    assertExactKeys(
        value,
        [
            "constraintKey",
            "displayName",
            "constraintType",
            "measureType",
            "comparator",
            "valueState",
            "limitValue",
            "unitCode",
            "scopeType",
            "compositionBehavior",
            "priority"
        ],
        path
    );
    const comparator = normalizeEnum(
        value.comparator,
        ["less_than_or_equal", "greater_than_or_equal"],
        `${path}.comparator`
    );
    const valueState = normalizeEnum(
        value.valueState,
        ["known", "unlimited", "not_applicable", "unknown", "unsupported"],
        `${path}.valueState`
    );
    if (comparator === "greater_than_or_equal" && valueState === "unlimited") {
        fail("CONSTRAINT_STATE_INVALID", path);
    }
    let limitValue = null;
    if (valueState === "known") {
        limitValue = normalizeUnsigned(
            value.limitValue,
            MAX_AGGREGATE_COUNT,
            `${path}.limitValue`
        ).toString();
    } else if (value.limitValue !== null) {
        fail("EXPLICIT_STATE_NULLABILITY_INVALID", `${path}.limitValue`);
    }
    return {
        constraintKey: normalizeRuleKey(
            value.constraintKey,
            `${path}.constraintKey`
        ),
        displayName: normalizeText(value.displayName, `${path}.displayName`, {
            maximumCodePoints: 120,
            maximumBytes: 512
        }),
        constraintType: normalizeEnum(
            value.constraintType,
            ["order_aggregate"],
            `${path}.constraintType`
        ),
        measureType: normalizeEnum(
            value.measureType,
            ["total_quantity", "distinct_line_count"],
            `${path}.measureType`
        ),
        comparator,
        valueState,
        limitValue,
        unitCode: normalizeEnum(value.unitCode, ["count"], `${path}.unitCode`),
        scopeType: normalizeEnum(
            value.scopeType,
            ["order"],
            `${path}.scopeType`
        ),
        compositionBehavior: normalizeEnum(
            value.compositionBehavior,
            ["all_must_pass"],
            `${path}.compositionBehavior`
        ),
        priority: normalizeBoundedInteger(
            value.priority,
            1_000_000,
            `${path}.priority`
        )
    };
}

function normalizeWarning(value, index) {
    const path = `$.catalog.warnings[${index}]`;
    assertExactKeys(
        value,
        [
            "warningCode",
            "severity",
            "scopeType",
            "categoryKey",
            "itemKey",
            "messageKey",
            "boundedDetails"
        ],
        path
    );
    const scopeType = normalizeEnum(
        value.scopeType,
        ["template", "item"],
        `${path}.scopeType`
    );
    if (value.categoryKey !== null) fail("WARNING_TARGET_INVALID", path);
    let itemKey = null;
    if (scopeType === "template") {
        if (value.itemKey !== null) fail("WARNING_TARGET_INVALID", path);
    } else {
        if (value.itemKey === null) fail("WARNING_TARGET_INVALID", path);
        itemKey = normalizeIdentityKey(value.itemKey, `${path}.itemKey`);
    }
    if (!isPlainObject(value.boundedDetails)) {
        fail("WARNING_DETAILS_INVALID", `${path}.boundedDetails`);
    }
    if (Object.keys(value.boundedDetails).length !== 0) {
        fail("WARNING_DETAILS_UNSUPPORTED", `${path}.boundedDetails`);
    }
    return {
        warningCode: normalizeRuleKey(
            value.warningCode,
            `${path}.warningCode`
        ),
        severity: normalizeEnum(
            value.severity,
            ["warning", "informational"],
            `${path}.severity`
        ),
        scopeType,
        categoryKey: null,
        itemKey,
        messageKey: normalizeMessageKey(
            value.messageKey,
            `${path}.messageKey`
        ),
        boundedDetails: {}
    };
}

function normalizeSourceEvidence(value, index) {
    const path = `$.catalog.sourceEvidence[${index}]`;
    assertExactKeys(
        value,
        ["evidenceFingerprint", "relationshipType", "sourceGroupFingerprint"],
        path
    );
    return {
        evidenceFingerprint: normalizeHash(
            value.evidenceFingerprint,
            `${path}.evidenceFingerprint`
        ),
        relationshipType: normalizeEnum(
            value.relationshipType,
            CATALOG_SOURCE_EVIDENCE_RELATIONSHIPS,
            `${path}.relationshipType`
        ),
        sourceGroupFingerprint: normalizeHash(
            value.sourceGroupFingerprint,
            `${path}.sourceGroupFingerprint`
        )
    };
}

function normalizeCurrency(value) {
    if (
        typeof value.currencyCode !== "string" ||
        !/^[A-Z]{3}$/.test(value.currencyCode)
    ) {
        fail("CURRENCY_CODE_INVALID", "$.catalog.currencyCode");
    }
    if (!Object.hasOwn(SUPPORTED_CURRENCY_EXPONENTS, value.currencyCode)) {
        fail("CURRENCY_CODE_UNSUPPORTED", "$.catalog.currencyCode");
    }
    if (
        !Number.isSafeInteger(value.currencyExponent) ||
        value.currencyExponent < 0 ||
        value.currencyExponent > 3
    ) {
        fail("CURRENCY_EXPONENT_UNSUPPORTED", "$.catalog.currencyExponent");
    }
    if (
        SUPPORTED_CURRENCY_EXPONENTS[value.currencyCode] !==
        value.currencyExponent
    ) {
        fail("CURRENCY_EXPONENT_MISMATCH", "$.catalog.currencyExponent");
    }
    return {
        currencyCode: value.currencyCode,
        currencyExponent: value.currencyExponent
    };
}

function normalizeCapabilities(value) {
    assertArray(
        value.requiredCapabilities,
        CATALOG_CONTENT_BOUNDS.maxCapabilities,
        "$.catalog.requiredCapabilities",
        { minimum: 2 }
    );
    const capabilities = value.requiredCapabilities
        .map((capability, index) =>
            normalizeCapability(
                capability,
                `$.catalog.requiredCapabilities[${index}]`
            )
        )
        .sort(compareCodeUnits);
    if (new Set(capabilities).size !== capabilities.length) {
        fail("CAPABILITY_DUPLICATE", "$.catalog.requiredCapabilities");
    }
    return capabilities;
}

function normalizeCatalog(value, { requireHash }) {
    const fields = [
        "contentSchemaVersion",
        "canonicalizationVersion",
        "calculationContractVersion",
        "hashAlgorithm",
        "currencyCode",
        "currencyExponent",
        "sourceEffectiveDate",
        "sourcePublishedDate",
        "requiredCapabilities",
        "categories",
        "items",
        "spendingBuckets",
        "bucketMemberships",
        "taxRules",
        "constraints",
        "warnings",
        "sourceEvidence"
    ];
    assertExactKeys(
        value,
        requireHash ? [...fields, "contentHash"] : fields,
        "$.catalog"
    );
    if (value.contentSchemaVersion !== CATALOG_CONTENT_SCHEMA_VERSION) {
        fail("CONTENT_SCHEMA_VERSION_UNSUPPORTED", "$.catalog");
    }
    if (value.canonicalizationVersion !== CANONICALIZATION_VERSION) {
        fail("CANONICALIZATION_VERSION_UNSUPPORTED", "$.catalog");
    }
    if (value.calculationContractVersion !== CALCULATION_CONTRACT_VERSION) {
        fail("CALCULATION_CONTRACT_VERSION_UNSUPPORTED", "$.catalog");
    }
    if (value.hashAlgorithm !== HASH_ALGORITHM) {
        fail("HASH_ALGORITHM_UNSUPPORTED", "$.catalog");
    }

    const { currencyCode, currencyExponent } = normalizeCurrency(value);
    const requiredCapabilities = normalizeCapabilities(value);

    assertArray(
        value.categories,
        CATALOG_CONTENT_BOUNDS.maxCategories,
        "$.catalog.categories"
    );
    const categories = value.categories
        .map(normalizeCategory)
        .sort((left, right) =>
            compareCodeUnits(left.categoryKey, right.categoryKey)
        );
    assertUnique(
        categories,
        category => category.categoryKey,
        "CATEGORY_KEY_DUPLICATE",
        "$.catalog.categories"
    );
    const categoryKeys = new Set(
        categories.map(category => category.categoryKey)
    );

    assertArray(
        value.items,
        CATALOG_CONTENT_BOUNDS.maxItems,
        "$.catalog.items",
        { minimum: 1 }
    );
    const items = value.items
        .map(normalizeItem)
        .sort((left, right) => compareCodeUnits(left.itemKey, right.itemKey));
    assertUnique(
        items,
        item => item.itemKey,
        "ITEM_KEY_DUPLICATE",
        "$.catalog.items"
    );
    const itemKeys = new Set(items.map(item => item.itemKey));
    for (const item of items) {
        if (item.categoryKey !== null && !categoryKeys.has(item.categoryKey)) {
            fail("CATEGORY_REFERENCE_MISSING", "$.catalog.items");
        }
    }

    assertArray(
        value.spendingBuckets,
        CATALOG_CONTENT_BOUNDS.maxBuckets,
        "$.catalog.spendingBuckets"
    );
    const spendingBuckets = value.spendingBuckets
        .map((bucket, index) => normalizeBucket(bucket, index, currencyCode))
        .sort((left, right) =>
            compareCodeUnits(left.bucketKey, right.bucketKey)
        );
    assertUnique(
        spendingBuckets,
        bucket => bucket.bucketKey,
        "BUCKET_KEY_DUPLICATE",
        "$.catalog.spendingBuckets"
    );
    if (spendingBuckets.filter(bucket => bucket.isPrimaryDisplay).length > 1) {
        fail("PRIMARY_BUCKET_AMBIGUOUS", "$.catalog.spendingBuckets");
    }
    const bucketKeys = new Set(
        spendingBuckets.map(bucket => bucket.bucketKey)
    );

    assertArray(
        value.bucketMemberships,
        CATALOG_CONTENT_BOUNDS.maxBucketMemberships,
        "$.catalog.bucketMemberships"
    );
    const bucketMemberships = value.bucketMemberships
        .map(normalizeBucketMembership)
        .sort((left, right) =>
            compareCodeUnits(left.itemKey, right.itemKey) ||
            compareCodeUnits(left.bucketKey, right.bucketKey)
        );
    assertUnique(
        bucketMemberships,
        membership => `${membership.itemKey}:${membership.bucketKey}`,
        "BUCKET_MEMBERSHIP_DUPLICATE",
        "$.catalog.bucketMemberships"
    );
    for (const membership of bucketMemberships) {
        if (!itemKeys.has(membership.itemKey)) {
            fail("ITEM_REFERENCE_MISSING", "$.catalog.bucketMemberships");
        }
        if (!bucketKeys.has(membership.bucketKey)) {
            fail("BUCKET_REFERENCE_MISSING", "$.catalog.bucketMemberships");
        }
    }
    const primaryMembershipItems = new Set();
    for (const membership of bucketMemberships) {
        if (!membership.primaryDisplay) continue;
        if (primaryMembershipItems.has(membership.itemKey)) {
            fail("PRIMARY_MEMBERSHIP_AMBIGUOUS", "$.catalog.bucketMemberships");
        }
        primaryMembershipItems.add(membership.itemKey);
    }

    assertArray(
        value.taxRules,
        CATALOG_CONTENT_BOUNDS.maxTaxRules,
        "$.catalog.taxRules"
    );
    const taxRules = value.taxRules
        .map(normalizeTaxRule)
        .sort((left, right) =>
            compareCodeUnits(left.scopeType, right.scopeType) ||
            compareCodeUnits(left.categoryKey ?? "", right.categoryKey ?? "") ||
            compareCodeUnits(left.itemKey ?? "", right.itemKey ?? "") ||
            right.priority - left.priority
        );
    assertUnique(
        taxRules,
        rule =>
            [
                rule.scopeType,
                rule.categoryKey ?? "",
                rule.itemKey ?? "",
                rule.priority
            ].join(":"),
        "TAX_RULE_DUPLICATE",
        "$.catalog.taxRules"
    );
    for (const rule of taxRules) {
        if (rule.categoryKey !== null && !categoryKeys.has(rule.categoryKey)) {
            fail("CATEGORY_REFERENCE_MISSING", "$.catalog.taxRules");
        }
        if (rule.itemKey !== null && !itemKeys.has(rule.itemKey)) {
            fail("ITEM_REFERENCE_MISSING", "$.catalog.taxRules");
        }
    }

    assertArray(
        value.constraints,
        CATALOG_CONTENT_BOUNDS.maxConstraints,
        "$.catalog.constraints"
    );
    const constraints = value.constraints
        .map(normalizeConstraint)
        .sort((left, right) =>
            compareCodeUnits(left.constraintKey, right.constraintKey)
        );
    assertUnique(
        constraints,
        constraint => constraint.constraintKey,
        "CONSTRAINT_KEY_DUPLICATE",
        "$.catalog.constraints"
    );

    assertArray(
        value.warnings,
        CATALOG_CONTENT_BOUNDS.maxWarnings,
        "$.catalog.warnings"
    );
    const warnings = value.warnings
        .map(normalizeWarning)
        .sort((left, right) =>
            compareCodeUnits(left.scopeType, right.scopeType) ||
            compareCodeUnits(left.itemKey ?? "", right.itemKey ?? "") ||
            SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
            compareCodeUnits(left.warningCode, right.warningCode) ||
            compareCodeUnits(left.messageKey, right.messageKey)
        );
    assertUnique(
        warnings,
        warning =>
            [
                warning.scopeType,
                warning.itemKey ?? "",
                warning.warningCode,
                warning.severity,
                warning.messageKey
            ].join(":"),
        "WARNING_DUPLICATE",
        "$.catalog.warnings"
    );
    for (const warning of warnings) {
        if (warning.itemKey !== null && !itemKeys.has(warning.itemKey)) {
            fail("ITEM_REFERENCE_MISSING", "$.catalog.warnings");
        }
    }

    assertArray(
        value.sourceEvidence,
        CATALOG_CONTENT_BOUNDS.maxSourceEvidence,
        "$.catalog.sourceEvidence",
        { minimum: 1 }
    );
    const sourceEvidence = value.sourceEvidence
        .map(normalizeSourceEvidence)
        .sort((left, right) =>
            compareCodeUnits(
                left.evidenceFingerprint,
                right.evidenceFingerprint
            ) ||
            compareCodeUnits(left.relationshipType, right.relationshipType) ||
            compareCodeUnits(
                left.sourceGroupFingerprint,
                right.sourceGroupFingerprint
            )
        );
    assertUnique(
        sourceEvidence,
        evidence => evidence.evidenceFingerprint,
        "SOURCE_EVIDENCE_DUPLICATE",
        "$.catalog.sourceEvidence"
    );

    const inferredCapabilities = new Set([
        "money.minor_units.v1",
        "quantity.bounded_integer.v1"
    ]);
    if (spendingBuckets.length > 0) {
        inferredCapabilities.add("spending_buckets.parallel_pretax.v1");
    }
    if (taxRules.some(rule => rule.treatmentState !== "not_applicable")) {
        inferredCapabilities.add("tax.single_treatment.line_rounding.v1");
    }
    if (constraints.length > 0) {
        inferredCapabilities.add("constraints.order_aggregate.v1");
    }
    for (const capability of inferredCapabilities) {
        if (!requiredCapabilities.includes(capability)) {
            fail(
                "CAPABILITY_DECLARATION_MISSING",
                "$.catalog.requiredCapabilities"
            );
        }
    }

    const normalized = {
        contentSchemaVersion: CATALOG_CONTENT_SCHEMA_VERSION,
        canonicalizationVersion: CANONICALIZATION_VERSION,
        calculationContractVersion: CALCULATION_CONTRACT_VERSION,
        hashAlgorithm: HASH_ALGORITHM,
        currencyCode,
        currencyExponent,
        sourceEffectiveDate: normalizeDate(
            value.sourceEffectiveDate,
            "$.catalog.sourceEffectiveDate"
        ),
        sourcePublishedDate: normalizeDate(
            value.sourcePublishedDate,
            "$.catalog.sourcePublishedDate"
        ),
        requiredCapabilities,
        categories,
        items,
        spendingBuckets,
        bucketMemberships,
        taxRules,
        constraints,
        warnings,
        sourceEvidence
    };

    if (!requireHash) return normalized;
    const contentHash = normalizeHash(
        value.contentHash,
        "$.catalog.contentHash"
    );
    if (contentHash !== hashCanonicalCatalog(normalized)) {
        fail("CONTENT_HASH_MISMATCH", "$.catalog.contentHash");
    }
    return { ...normalized, contentHash };
}

function hashCanonicalCatalog(value) {
    return createHash(HASH_ALGORITHM)
        .update(canonicalizeStoreCalcValue(value), "utf8")
        .digest("hex");
}

function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) {
        return value;
    }
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

export function sealCatalogVersionContent(value) {
    const normalized = normalizeCatalog(value, { requireHash: false });
    return deepFreeze({
        ...normalized,
        contentHash: hashCanonicalCatalog(normalized)
    });
}

export function verifyCatalogVersionContent(value) {
    return deepFreeze(normalizeCatalog(value, { requireHash: true }));
}
