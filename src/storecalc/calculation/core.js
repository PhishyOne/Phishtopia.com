import { createHash } from "node:crypto";

export const CALCULATION_CONTRACT_VERSION = "storecalc.calculation.v1";
export const RESOLVED_CONFIGURATION_SCHEMA_VERSION =
    "storecalc.resolved-configuration.v1";
export const CATALOG_CONTENT_SCHEMA_VERSION = "storecalc.catalog-content.v1";
export const CALCULATION_RESULT_SCHEMA_VERSION =
    "storecalc.calculation-result.v1";
export const CANONICALIZATION_VERSION = "storecalc.canonical-json.v1";
export const HASH_ALGORITHM = "sha256";
export const ENGINE_VERSION = "1.0.0";

export const SUPPORTED_CALCULATION_CAPABILITIES = Object.freeze([
    "constraints.order_aggregate.v1",
    "money.minor_units.v1",
    "quantity.bounded_integer.v1",
    "spending_buckets.parallel_pretax.v1",
    "tax.single_treatment.line_rounding.v1"
]);

export const SUPPORTED_CURRENCY_EXPONENTS = Object.freeze({
    USD: 2
});

export const CALCULATION_BOUNDS = Object.freeze({
    maxAggregateCount: "1000000000",
    maxBuckets: 64,
    maxCapabilities: 32,
    maxConstraints: 64,
    maxItems: 1000,
    maxMoneyMinor: "9223372036854775807",
    maxQuantity: "1000000",
    maxSelectedLines: 1000,
    maxTaxRatePpm: "1000000",
    maxWarnings: 1000
});

const MAX_AGGREGATE_COUNT = BigInt(CALCULATION_BOUNDS.maxAggregateCount);
const MAX_MONEY_MINOR = BigInt(CALCULATION_BOUNDS.maxMoneyMinor);
const MAX_QUANTITY = BigInt(CALCULATION_BOUNDS.maxQuantity);
const MAX_TAX_RATE_PPM = BigInt(CALCULATION_BOUNDS.maxTaxRatePpm);
const PPM_DENOMINATOR = 1_000_000n;
const TEXT_ENCODER = new TextEncoder();
const ENGINE_CAPABILITIES = new Set(SUPPORTED_CALCULATION_CAPABILITIES);
const KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const CAPABILITY_PATTERN =
    /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*\.v[1-9][0-9]*$/;
const UNSIGNED_INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const FORBIDDEN_SHORT_TEXT =
    /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u206f]/u;

const SEVERITY_ORDER = Object.freeze({
    hard_error: 0,
    over_limit: 1,
    warning: 2,
    informational: 3
});

export class StoreCalcCalculationError extends Error {
    constructor(code, path = "$") {
        super(code);
        this.name = "StoreCalcCalculationError";
        this.code = code;
        this.path = path;
    }
}

function fail(code, path = "$") {
    throw new StoreCalcCalculationError(code, path);
}

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, required, optional, path) {
    if (!isPlainObject(value)) fail("OBJECT_REQUIRED", path);

    const allowed = new Set([...required, ...optional]);
    const actual = Object.keys(value);

    if (required.some(key => !Object.hasOwn(value, key))) {
        fail("OBJECT_FIELD_MISSING", path);
    }
    if (actual.some(key => !allowed.has(key))) {
        fail("OBJECT_FIELD_UNSUPPORTED", path);
    }
}

function assertArray(value, maximum, path, { minimum = 0 } = {}) {
    if (!Array.isArray(value)) fail("ARRAY_REQUIRED", path);
    if (value.length < minimum || value.length > maximum) {
        fail("ARRAY_BOUND_EXCEEDED", path);
    }
}

function normalizeShortText(
    value,
    path,
    { maximumCodePoints = 120, maximumBytes = 512 } = {}
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
    if (value.normalize("NFC") !== value || FORBIDDEN_SHORT_TEXT.test(value)) {
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

function normalizeKey(value, path) {
    const normalized = normalizeShortText(value, path, {
        maximumCodePoints: 64,
        maximumBytes: 64
    });
    if (!KEY_PATTERN.test(normalized)) fail("KEY_INVALID", path);
    return normalized;
}

function normalizeMessageKey(value, path) {
    const normalized = normalizeShortText(value, path, {
        maximumCodePoints: 128,
        maximumBytes: 128
    });
    if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+$/.test(normalized)) {
        fail("MESSAGE_KEY_INVALID", path);
    }
    return normalized;
}

function normalizeCapability(value, path) {
    const normalized = normalizeShortText(value, path, {
        maximumCodePoints: 96,
        maximumBytes: 96
    });
    if (!CAPABILITY_PATTERN.test(normalized)) {
        fail("CAPABILITY_INVALID", path);
    }
    return normalized;
}

function parseUnsigned(value, maximum, path, { minimum = 0n } = {}) {
    if (typeof value !== "string") {
        fail("UNSIGNED_INTEGER_INVALID", path);
    }
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

function normalizeSortOrder(value, path) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
        fail("SORT_ORDER_INVALID", path);
    }
    return value;
}

function normalizeEnum(value, allowed, path) {
    if (typeof value !== "string" || !allowed.includes(value)) {
        fail("ENUM_VALUE_INVALID", path);
    }
    return value;
}

function compareCodeUnits(left, right) {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
}

function assertNullableFieldsAreNull(value, fields, path) {
    if (fields.some(field => value[field] !== null)) {
        fail("EXPLICIT_STATE_NULLABILITY_INVALID", path);
    }
}

function normalizeWarning(value, path) {
    assertExactKeys(
        value,
        ["warningCode", "severity", "messageKey"],
        [],
        path
    );
    const severity = normalizeEnum(
        value.severity,
        ["warning", "informational"],
        `${path}.severity`
    );
    return {
        warningCode: normalizeKey(value.warningCode, `${path}.warningCode`),
        severity,
        messageKey: normalizeMessageKey(value.messageKey, `${path}.messageKey`)
    };
}

function compareWarnings(left, right) {
    return (
        SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
        compareCodeUnits(left.warningCode, right.warningCode) ||
        compareCodeUnits(left.messageKey, right.messageKey)
    );
}

function assertUniqueWarnings(warnings, path) {
    const seen = new Set();
    for (const warning of warnings) {
        const identity = `${warning.warningCode}:${warning.severity}:${warning.messageKey}`;
        if (seen.has(identity)) fail("WARNING_DUPLICATE", path);
        seen.add(identity);
    }
}

function normalizeTaxTreatment(value, path) {
    assertExactKeys(
        value,
        [
            "state",
            "ratePpm",
            "priceIncludesTax",
            "roundingMode",
            "roundingScope"
        ],
        [],
        path
    );
    const state = normalizeEnum(
        value.state,
        ["known", "not_applicable", "unknown", "unsupported"],
        `${path}.state`
    );

    if (state !== "known") {
        assertNullableFieldsAreNull(
            value,
            [
                "ratePpm",
                "priceIncludesTax",
                "roundingMode",
                "roundingScope"
            ],
            path
        );
        return {
            state,
            ratePpm: null,
            priceIncludesTax: null,
            roundingMode: null,
            roundingScope: null
        };
    }

    const ratePpm = parseUnsigned(
        value.ratePpm,
        MAX_TAX_RATE_PPM,
        `${path}.ratePpm`
    );
    if (typeof value.priceIncludesTax !== "boolean") {
        fail("BOOLEAN_REQUIRED", `${path}.priceIncludesTax`);
    }

    return {
        state,
        ratePpm: ratePpm.toString(),
        priceIncludesTax: value.priceIncludesTax,
        roundingMode: normalizeEnum(
            value.roundingMode,
            ["half_up", "floor", "ceiling"],
            `${path}.roundingMode`
        ),
        roundingScope: normalizeEnum(
            value.roundingScope,
            ["line"],
            `${path}.roundingScope`
        )
    };
}

function normalizeBucketMembership(value, path) {
    assertExactKeys(
        value,
        ["bucketKey", "membershipType", "primaryDisplay"],
        [],
        path
    );
    if (typeof value.primaryDisplay !== "boolean") {
        fail("BOOLEAN_REQUIRED", `${path}.primaryDisplay`);
    }
    return {
        bucketKey: normalizeKey(value.bucketKey, `${path}.bucketKey`),
        membershipType: normalizeEnum(
            value.membershipType,
            ["counts_toward", "excluded", "informational_only"],
            `${path}.membershipType`
        ),
        primaryDisplay: value.primaryDisplay
    };
}

function normalizeItem(value, path) {
    assertExactKeys(
        value,
        [
            "itemKey",
            "displayName",
            "sortOrder",
            "priceState",
            "priceMinor",
            "minimumSelectedQuantity",
            "maximumOrderQuantity",
            "quantityStep",
            "availabilityState",
            "taxTreatment",
            "bucketMemberships",
            "warnings"
        ],
        [],
        path
    );

    const priceState = normalizeEnum(
        value.priceState,
        ["known", "unknown", "unsupported"],
        `${path}.priceState`
    );
    let priceMinor = null;
    if (priceState === "known") {
        priceMinor = parseUnsigned(
            value.priceMinor,
            MAX_MONEY_MINOR,
            `${path}.priceMinor`
        ).toString();
    } else if (value.priceMinor !== null) {
        fail("EXPLICIT_STATE_NULLABILITY_INVALID", `${path}.priceMinor`);
    }

    const minimum = parseUnsigned(
        value.minimumSelectedQuantity,
        MAX_QUANTITY,
        `${path}.minimumSelectedQuantity`,
        { minimum: 1n }
    );
    const maximum = parseUnsigned(
        value.maximumOrderQuantity,
        MAX_QUANTITY,
        `${path}.maximumOrderQuantity`,
        { minimum: 1n }
    );
    const step = parseUnsigned(
        value.quantityStep,
        MAX_QUANTITY,
        `${path}.quantityStep`,
        { minimum: 1n }
    );
    if (maximum < minimum) {
        fail("QUANTITY_RULE_INVALID", path);
    }

    assertArray(
        value.bucketMemberships,
        CALCULATION_BOUNDS.maxBuckets,
        `${path}.bucketMemberships`
    );
    const memberships = value.bucketMemberships
        .map((membership, index) =>
            normalizeBucketMembership(
                membership,
                `${path}.bucketMemberships[${index}]`
            )
        )
        .sort((left, right) => {
            return (
                compareCodeUnits(left.bucketKey, right.bucketKey) ||
                compareCodeUnits(left.membershipType, right.membershipType)
            );
        });
    const membershipKeys = new Set();
    for (const membership of memberships) {
        if (membershipKeys.has(membership.bucketKey)) {
            fail("BUCKET_MEMBERSHIP_DUPLICATE", `${path}.bucketMemberships`);
        }
        membershipKeys.add(membership.bucketKey);
    }
    if (memberships.filter(membership => membership.primaryDisplay).length > 1) {
        fail("PRIMARY_BUCKET_AMBIGUOUS", `${path}.bucketMemberships`);
    }

    assertArray(
        value.warnings,
        CALCULATION_BOUNDS.maxWarnings,
        `${path}.warnings`
    );
    const warnings = value.warnings
        .map((warning, index) =>
            normalizeWarning(warning, `${path}.warnings[${index}]`)
        )
        .sort(compareWarnings);
    assertUniqueWarnings(warnings, `${path}.warnings`);

    return {
        itemKey: normalizeKey(value.itemKey, `${path}.itemKey`),
        displayName: normalizeShortText(
            value.displayName,
            `${path}.displayName`
        ),
        sortOrder: normalizeSortOrder(value.sortOrder, `${path}.sortOrder`),
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
        taxTreatment: normalizeTaxTreatment(
            value.taxTreatment,
            `${path}.taxTreatment`
        ),
        bucketMemberships: memberships,
        warnings
    };
}

function normalizeBucket(value, path) {
    assertExactKeys(
        value,
        [
            "bucketKey",
            "displayName",
            "sortOrder",
            "limitState",
            "limitMinor"
        ],
        [],
        path
    );
    const limitState = normalizeEnum(
        value.limitState,
        ["known", "unlimited", "not_applicable", "unknown", "unsupported"],
        `${path}.limitState`
    );
    let limitMinor = null;
    if (limitState === "known") {
        limitMinor = parseUnsigned(
            value.limitMinor,
            MAX_MONEY_MINOR,
            `${path}.limitMinor`
        ).toString();
    } else if (value.limitMinor !== null) {
        fail("EXPLICIT_STATE_NULLABILITY_INVALID", `${path}.limitMinor`);
    }
    return {
        bucketKey: normalizeKey(value.bucketKey, `${path}.bucketKey`),
        displayName: normalizeShortText(
            value.displayName,
            `${path}.displayName`
        ),
        sortOrder: normalizeSortOrder(value.sortOrder, `${path}.sortOrder`),
        limitState,
        limitMinor
    };
}

function normalizeConstraint(value, path) {
    assertExactKeys(
        value,
        [
            "constraintKey",
            "displayName",
            "sortOrder",
            "measureType",
            "comparator",
            "valueState",
            "limitValue",
            "unitCode"
        ],
        [],
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
        limitValue = parseUnsigned(
            value.limitValue,
            MAX_AGGREGATE_COUNT,
            `${path}.limitValue`
        ).toString();
    } else if (value.limitValue !== null) {
        fail("EXPLICIT_STATE_NULLABILITY_INVALID", `${path}.limitValue`);
    }
    return {
        constraintKey: normalizeKey(
            value.constraintKey,
            `${path}.constraintKey`
        ),
        displayName: normalizeShortText(
            value.displayName,
            `${path}.displayName`
        ),
        sortOrder: normalizeSortOrder(value.sortOrder, `${path}.sortOrder`),
        measureType: normalizeEnum(
            value.measureType,
            ["total_quantity", "distinct_line_count"],
            `${path}.measureType`
        ),
        comparator,
        valueState,
        limitValue,
        unitCode: normalizeEnum(value.unitCode, ["count"], `${path}.unitCode`)
    };
}

function assertUniqueKeys(values, keyName, code, path) {
    const seen = new Set();
    for (const value of values) {
        if (seen.has(value[keyName])) fail(code, path);
        seen.add(value[keyName]);
    }
}

function normalizeConfiguration(value, { requireHash }) {
    const required = [
        "resolvedSchemaVersion",
        "calculationContractVersion",
        "contentSchemaVersion",
        "canonicalizationVersion",
        "hashAlgorithm",
        "configurationKey",
        "currencyCode",
        "currencyExponent",
        "requiredCapabilities",
        "items",
        "spendingBuckets",
        "constraints",
        "warnings"
    ];
    assertExactKeys(
        value,
        requireHash ? [...required, "contentHash"] : required,
        [],
        "$.configuration"
    );

    if (value.resolvedSchemaVersion !== RESOLVED_CONFIGURATION_SCHEMA_VERSION) {
        fail("RESOLVED_SCHEMA_VERSION_UNSUPPORTED", "$.configuration");
    }
    if (value.calculationContractVersion !== CALCULATION_CONTRACT_VERSION) {
        fail("CALCULATION_CONTRACT_VERSION_UNSUPPORTED", "$.configuration");
    }
    if (value.contentSchemaVersion !== CATALOG_CONTENT_SCHEMA_VERSION) {
        fail("CONTENT_SCHEMA_VERSION_UNSUPPORTED", "$.configuration");
    }
    if (value.canonicalizationVersion !== CANONICALIZATION_VERSION) {
        fail("CANONICALIZATION_VERSION_UNSUPPORTED", "$.configuration");
    }
    if (value.hashAlgorithm !== HASH_ALGORITHM) {
        fail("HASH_ALGORITHM_UNSUPPORTED", "$.configuration");
    }

    const configurationKey = normalizeKey(
        value.configurationKey,
        "$.configuration.configurationKey"
    );
    if (
        typeof value.currencyCode !== "string" ||
        !/^[A-Z]{3}$/.test(value.currencyCode)
    ) {
        fail("CURRENCY_CODE_INVALID", "$.configuration.currencyCode");
    }
    if (
        !Number.isSafeInteger(value.currencyExponent) ||
        value.currencyExponent < 0 ||
        value.currencyExponent > 3
    ) {
        fail(
            "CURRENCY_EXPONENT_UNSUPPORTED",
            "$.configuration.currencyExponent"
        );
    }
    if (!Object.hasOwn(SUPPORTED_CURRENCY_EXPONENTS, value.currencyCode)) {
        fail("CURRENCY_CODE_UNSUPPORTED", "$.configuration.currencyCode");
    }
    if (
        SUPPORTED_CURRENCY_EXPONENTS[value.currencyCode] !==
        value.currencyExponent
    ) {
        fail(
            "CURRENCY_EXPONENT_MISMATCH",
            "$.configuration.currencyExponent"
        );
    }

    assertArray(
        value.requiredCapabilities,
        CALCULATION_BOUNDS.maxCapabilities,
        "$.configuration.requiredCapabilities",
        { minimum: 2 }
    );
    const requiredCapabilities = value.requiredCapabilities
        .map((capability, index) =>
            normalizeCapability(
                capability,
                `$.configuration.requiredCapabilities[${index}]`
            )
        )
        .sort();
    if (new Set(requiredCapabilities).size !== requiredCapabilities.length) {
        fail(
            "CAPABILITY_DUPLICATE",
            "$.configuration.requiredCapabilities"
        );
    }

    assertArray(value.items, CALCULATION_BOUNDS.maxItems, "$.configuration.items", {
        minimum: 1
    });
    const items = value.items
        .map((item, index) =>
            normalizeItem(item, `$.configuration.items[${index}]`)
        )
        .sort((left, right) => {
            return (
                left.sortOrder - right.sortOrder ||
                compareCodeUnits(left.itemKey, right.itemKey)
            );
        });
    assertUniqueKeys(
        items,
        "itemKey",
        "ITEM_KEY_DUPLICATE",
        "$.configuration.items"
    );

    assertArray(
        value.spendingBuckets,
        CALCULATION_BOUNDS.maxBuckets,
        "$.configuration.spendingBuckets"
    );
    const spendingBuckets = value.spendingBuckets
        .map((bucket, index) =>
            normalizeBucket(bucket, `$.configuration.spendingBuckets[${index}]`)
        )
        .sort((left, right) => {
            return (
                left.sortOrder - right.sortOrder ||
                compareCodeUnits(left.bucketKey, right.bucketKey)
            );
        });
    assertUniqueKeys(
        spendingBuckets,
        "bucketKey",
        "BUCKET_KEY_DUPLICATE",
        "$.configuration.spendingBuckets"
    );
    const bucketKeys = new Set(spendingBuckets.map(bucket => bucket.bucketKey));
    for (const item of items) {
        for (const membership of item.bucketMemberships) {
            if (!bucketKeys.has(membership.bucketKey)) {
                fail("BUCKET_REFERENCE_MISSING", "$.configuration.items");
            }
        }
    }

    assertArray(
        value.constraints,
        CALCULATION_BOUNDS.maxConstraints,
        "$.configuration.constraints"
    );
    const constraints = value.constraints
        .map((constraint, index) =>
            normalizeConstraint(
                constraint,
                `$.configuration.constraints[${index}]`
            )
        )
        .sort((left, right) => {
            return (
                left.sortOrder - right.sortOrder ||
                compareCodeUnits(left.constraintKey, right.constraintKey)
            );
        });
    assertUniqueKeys(
        constraints,
        "constraintKey",
        "CONSTRAINT_KEY_DUPLICATE",
        "$.configuration.constraints"
    );

    assertArray(
        value.warnings,
        CALCULATION_BOUNDS.maxWarnings,
        "$.configuration.warnings"
    );
    const warnings = value.warnings
        .map((warning, index) =>
            normalizeWarning(warning, `$.configuration.warnings[${index}]`)
        )
        .sort(compareWarnings);
    assertUniqueWarnings(warnings, "$.configuration.warnings");
    const totalWarningCount = items.reduce(
        (total, item) => total + item.warnings.length,
        warnings.length
    );
    if (totalWarningCount > CALCULATION_BOUNDS.maxWarnings) {
        fail("WARNING_COUNT_BOUND_EXCEEDED", "$.configuration.warnings");
    }

    const inferredCapabilities = new Set([
        "money.minor_units.v1",
        "quantity.bounded_integer.v1"
    ]);
    if (
        items.some(item => item.taxTreatment.state !== "not_applicable")
    ) {
        inferredCapabilities.add("tax.single_treatment.line_rounding.v1");
    }
    if (spendingBuckets.length > 0) {
        inferredCapabilities.add("spending_buckets.parallel_pretax.v1");
    }
    if (constraints.length > 0) {
        inferredCapabilities.add("constraints.order_aggregate.v1");
    }
    for (const capability of inferredCapabilities) {
        if (!requiredCapabilities.includes(capability)) {
            fail(
                "CAPABILITY_DECLARATION_MISSING",
                "$.configuration.requiredCapabilities"
            );
        }
    }

    const normalized = {
        resolvedSchemaVersion: RESOLVED_CONFIGURATION_SCHEMA_VERSION,
        calculationContractVersion: CALCULATION_CONTRACT_VERSION,
        contentSchemaVersion: CATALOG_CONTENT_SCHEMA_VERSION,
        canonicalizationVersion: CANONICALIZATION_VERSION,
        hashAlgorithm: HASH_ALGORITHM,
        configurationKey,
        currencyCode: value.currencyCode,
        currencyExponent: value.currencyExponent,
        requiredCapabilities,
        items,
        spendingBuckets,
        constraints,
        warnings
    };

    if (requireHash) {
        if (
            typeof value.contentHash !== "string" ||
            !HASH_PATTERN.test(value.contentHash)
        ) {
            fail("CONTENT_HASH_INVALID", "$.configuration.contentHash");
        }
        const expectedHash = sha256Canonical(normalized);
        if (value.contentHash !== expectedHash) {
            fail("CONTENT_HASH_MISMATCH", "$.configuration.contentHash");
        }
        return { ...normalized, contentHash: value.contentHash };
    }

    return normalized;
}

export function canonicalizeStoreCalcValue(value) {
    if (value === null) return "null";
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number") {
        if (!Number.isSafeInteger(value)) fail("CANONICAL_NUMBER_INVALID");
        return String(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonicalizeStoreCalcValue).join(",")}]`;
    }
    if (isPlainObject(value)) {
        const fields = Object.keys(value)
            .sort()
            .map(key => {
                if (value[key] === undefined) fail("CANONICAL_VALUE_INVALID");
                return `${JSON.stringify(key)}:${canonicalizeStoreCalcValue(value[key])}`;
            });
        return `{${fields.join(",")}}`;
    }
    fail("CANONICAL_VALUE_INVALID");
}

function sha256Canonical(value) {
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

export function sealResolvedConfiguration(value) {
    const normalized = normalizeConfiguration(value, { requireHash: false });
    return deepFreeze({
        ...normalized,
        contentHash: sha256Canonical(normalized)
    });
}

export function verifyResolvedConfiguration(value) {
    return deepFreeze(normalizeConfiguration(value, { requireHash: true }));
}

function normalizeDate(value, path) {
    if (typeof value !== "string") fail("CONTEXT_DATE_INVALID", path);
    const match = DATE_PATTERN.exec(value);
    if (!match) fail("CONTEXT_DATE_INVALID", path);

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysByMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysByMonth[month - 1]) {
        fail("CONTEXT_DATE_INVALID", path);
    }
    return value;
}

function addMoney(left, right, path) {
    const result = left + right;
    if (result > MAX_MONEY_MINOR) fail("CALCULATION_OVERFLOW", path);
    return result;
}

function multiplyMoney(price, quantity, path) {
    const result = price * quantity;
    if (result > MAX_MONEY_MINOR) fail("CALCULATION_OVERFLOW", path);
    return result;
}

function divideRounded(numerator, denominator, mode) {
    const quotient = numerator / denominator;
    const remainder = numerator % denominator;
    if (remainder === 0n || mode === "floor") return quotient;
    if (mode === "ceiling") return quotient + 1n;
    return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

function makeValidation(
    severity,
    code,
    targetType,
    targetKey,
    messageKey,
    details = {}
) {
    return {
        severity,
        code,
        targetType,
        targetKey,
        messageKey,
        details
    };
}

function compareValidations(left, right) {
    return (
        SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
        compareCodeUnits(left.code, right.code) ||
        compareCodeUnits(left.targetType, right.targetType) ||
        compareCodeUnits(left.targetKey ?? "", right.targetKey ?? "")
    );
}

function normalizeSupportedCapabilities(value) {
    assertArray(
        value,
        CALCULATION_BOUNDS.maxCapabilities,
        "$.supportedCapabilities"
    );
    const capabilities = value
        .map((capability, index) =>
            normalizeCapability(capability, `$.supportedCapabilities[${index}]`)
        )
        .sort();
    if (new Set(capabilities).size !== capabilities.length) {
        fail("CAPABILITY_DUPLICATE", "$.supportedCapabilities");
    }
    for (const capability of capabilities) {
        if (!ENGINE_CAPABILITIES.has(capability)) {
            fail("UNSUPPORTED_CAPABILITY", "$.supportedCapabilities");
        }
    }
    return capabilities;
}

function normalizeQuantities(value, itemsByKey) {
    assertArray(
        value,
        CALCULATION_BOUNDS.maxSelectedLines,
        "$.quantities"
    );
    const quantities = new Map();
    for (let index = 0; index < value.length; index += 1) {
        const path = `$.quantities[${index}]`;
        const entry = value[index];
        assertExactKeys(entry, ["itemKey", "quantity"], [], path);
        const itemKey = normalizeKey(entry.itemKey, `${path}.itemKey`);
        if (!itemsByKey.has(itemKey)) fail("ITEM_REFERENCE_MISSING", path);
        if (quantities.has(itemKey)) fail("QUANTITY_DUPLICATE", path);
        quantities.set(
            itemKey,
            parseUnsigned(entry.quantity, MAX_QUANTITY, `${path}.quantity`)
        );
    }
    return quantities;
}

function calculateKnownTax(listedTotal, treatment, path) {
    const rate = BigInt(treatment.ratePpm);
    if (!treatment.priceIncludesTax) {
        const tax = divideRounded(
            listedTotal * rate,
            PPM_DENOMINATOR,
            treatment.roundingMode
        );
        const lineTotal = addMoney(listedTotal, tax, path);
        return { itemSubtotal: listedTotal, tax, lineTotal };
    }

    const tax = divideRounded(
        listedTotal * rate,
        PPM_DENOMINATOR + rate,
        treatment.roundingMode
    );
    return {
        itemSubtotal: listedTotal - tax,
        tax,
        lineTotal: listedTotal
    };
}

function sumKnown(values, path) {
    let total = 0n;
    for (const value of values) total = addMoney(total, value, path);
    return total;
}

function computeLine(item, quantity, validations) {
    const target = item.itemKey;
    if (item.availabilityState === "unavailable") {
        validations.push(
            makeValidation(
                "hard_error",
                "item_unavailable",
                "item",
                target,
                "storecalc.validation.item_unavailable"
            )
        );
    } else if (item.availabilityState === "unknown") {
        validations.push(
            makeValidation(
                "warning",
                "item_availability_unknown",
                "item",
                target,
                "storecalc.validation.item_availability_unknown"
            )
        );
    }

    const minimum = BigInt(item.minimumSelectedQuantity);
    const maximum = BigInt(item.maximumOrderQuantity);
    const step = BigInt(item.quantityStep);
    if (quantity < minimum) {
        validations.push(
            makeValidation(
                "hard_error",
                "quantity_below_minimum",
                "item",
                target,
                "storecalc.validation.quantity_below_minimum",
                { minimum: minimum.toString(), actual: quantity.toString() }
            )
        );
    }
    if (quantity > maximum) {
        validations.push(
            makeValidation(
                "hard_error",
                "quantity_above_maximum",
                "item",
                target,
                "storecalc.validation.quantity_above_maximum",
                { maximum: maximum.toString(), actual: quantity.toString() }
            )
        );
    }
    if (quantity >= minimum && (quantity - minimum) % step !== 0n) {
        validations.push(
            makeValidation(
                "hard_error",
                "quantity_step_mismatch",
                "item",
                target,
                "storecalc.validation.quantity_step_mismatch",
                {
                    minimum: minimum.toString(),
                    step: step.toString(),
                    actual: quantity.toString()
                }
            )
        );
    }

    if (item.priceState !== "known") {
        validations.push(
            makeValidation(
                "hard_error",
                item.priceState === "unknown"
                    ? "item_price_unknown"
                    : "item_price_unsupported",
                "item",
                target,
                item.priceState === "unknown"
                    ? "storecalc.validation.item_price_unknown"
                    : "storecalc.validation.item_price_unsupported"
            )
        );
        return {
            output: {
                itemKey: item.itemKey,
                displayName: item.displayName,
                quantity: quantity.toString(),
                availabilityState: item.availabilityState,
                priceState: item.priceState,
                unitPriceMinor: null,
                listedPriceTotalState: item.priceState,
                listedPriceTotalMinor: null,
                itemSubtotalState: item.priceState,
                itemSubtotalMinor: null,
                taxState: "unknown",
                taxMinor: null,
                lineTotalState: item.priceState,
                lineTotalMinor: null,
                taxTreatment: item.taxTreatment,
                bucketMemberships: item.bucketMemberships
            },
            listedTotal: null,
            itemSubtotal: null,
            tax: null,
            lineTotal: null,
            unknownState: item.priceState
        };
    }

    const unitPrice = BigInt(item.priceMinor);
    const listedTotal = multiplyMoney(
        unitPrice,
        quantity,
        `$.configuration.items.${item.itemKey}`
    );
    let itemSubtotal = null;
    let tax = null;
    let lineTotal = null;
    let itemSubtotalState = "unknown";
    let taxState = item.taxTreatment.state;
    let lineTotalState = "unknown";

    if (item.taxTreatment.state === "known") {
        ({ itemSubtotal, tax, lineTotal } = calculateKnownTax(
            listedTotal,
            item.taxTreatment,
            `$.configuration.items.${item.itemKey}`
        ));
        itemSubtotalState = "known";
        taxState = "known";
        lineTotalState = "known";
    } else if (item.taxTreatment.state === "not_applicable") {
        itemSubtotal = listedTotal;
        lineTotal = listedTotal;
        itemSubtotalState = "known";
        lineTotalState = "known";
    } else {
        validations.push(
            makeValidation(
                item.taxTreatment.state === "unknown" ? "warning" : "hard_error",
                item.taxTreatment.state === "unknown"
                    ? "item_tax_unknown"
                    : "item_tax_unsupported",
                "item",
                target,
                item.taxTreatment.state === "unknown"
                    ? "storecalc.validation.item_tax_unknown"
                    : "storecalc.validation.item_tax_unsupported"
            )
        );
        itemSubtotalState = item.taxTreatment.state;
        lineTotalState = item.taxTreatment.state;
    }

    return {
        output: {
            itemKey: item.itemKey,
            displayName: item.displayName,
            quantity: quantity.toString(),
            availabilityState: item.availabilityState,
            priceState: item.priceState,
            unitPriceMinor: item.priceMinor,
            listedPriceTotalState: "known",
            listedPriceTotalMinor: listedTotal.toString(),
            itemSubtotalState,
            itemSubtotalMinor: itemSubtotal?.toString() ?? null,
            taxState,
            taxMinor: tax?.toString() ?? null,
            lineTotalState,
            lineTotalMinor: lineTotal?.toString() ?? null,
            taxTreatment: item.taxTreatment,
            bucketMemberships: item.bucketMemberships
        },
        listedTotal,
        itemSubtotal,
        tax,
        lineTotal,
        unknownState:
            lineTotal === null ? item.taxTreatment.state : null
    };
}

function computeBuckets(configuration, computedLines, validations) {
    return configuration.spendingBuckets.map(bucket => {
        const contributions = [];
        let unknownState = null;
        for (const line of computedLines) {
            const membership = line.output.bucketMemberships.find(
                candidate =>
                    candidate.bucketKey === bucket.bucketKey &&
                    candidate.membershipType === "counts_toward"
            );
            if (!membership) continue;
            if (line.itemSubtotal === null) {
                const candidateState =
                    line.unknownState === "unsupported"
                        ? "unsupported"
                        : "unknown";
                if (candidateState === "unsupported" || unknownState === null) {
                    unknownState = candidateState;
                }
            } else {
                contributions.push(line.itemSubtotal);
            }
        }

        const amountState = unknownState ?? "known";
        const amount = unknownState
            ? null
            : sumKnown(contributions, `$.spendingBuckets.${bucket.bucketKey}`);
        if (unknownState) {
            validations.push(
                makeValidation(
                    unknownState === "unsupported" ? "hard_error" : "warning",
                    unknownState === "unsupported"
                        ? "bucket_amount_unsupported"
                        : "bucket_amount_unknown",
                    "bucket",
                    bucket.bucketKey,
                    unknownState === "unsupported"
                        ? "storecalc.validation.bucket_amount_unsupported"
                        : "storecalc.validation.bucket_amount_unknown"
                )
            );
        }

        if (bucket.limitState === "unknown") {
            validations.push(
                makeValidation(
                    "warning",
                    "bucket_limit_unknown",
                    "bucket",
                    bucket.bucketKey,
                    "storecalc.validation.bucket_limit_unknown"
                )
            );
        } else if (bucket.limitState === "unsupported") {
            validations.push(
                makeValidation(
                    "hard_error",
                    "bucket_limit_unsupported",
                    "bucket",
                    bucket.bucketKey,
                    "storecalc.validation.bucket_limit_unsupported"
                )
            );
        }

        let resultState;
        if (
            amountState === "unsupported" ||
            bucket.limitState === "unsupported"
        ) {
            resultState = "unsupported";
        } else if (
            amountState === "unknown" ||
            bucket.limitState === "unknown"
        ) {
            resultState = "unknown";
        } else if (bucket.limitState === "known") {
            const limit = BigInt(bucket.limitMinor);
            resultState = amount <= limit ? "within_limit" : "over_limit";
            if (amount > limit) {
                validations.push(
                    makeValidation(
                        "over_limit",
                        "bucket_limit_exceeded",
                        "bucket",
                        bucket.bucketKey,
                        "storecalc.validation.bucket_limit_exceeded",
                        {
                            limitMinor: limit.toString(),
                            actualMinor: amount.toString(),
                            overageMinor: (amount - limit).toString()
                        }
                    )
                );
            }
        } else {
            resultState = bucket.limitState;
        }

        return {
            bucketKey: bucket.bucketKey,
            displayName: bucket.displayName,
            amountBasis: "pre_tax_item_subtotal",
            amountState,
            amountMinor: amount?.toString() ?? null,
            limitState: bucket.limitState,
            limitMinor: bucket.limitMinor,
            resultState
        };
    });
}

function compareConstraint(actual, limit, comparator) {
    return comparator === "less_than_or_equal"
        ? actual <= limit
        : actual >= limit;
}

function computeConstraints(configuration, computedLines, validations) {
    const totalQuantity = computedLines.reduce(
        (total, line) => total + BigInt(line.output.quantity),
        0n
    );
    if (totalQuantity > MAX_AGGREGATE_COUNT) {
        fail("AGGREGATE_COUNT_OVERFLOW", "$.quantities");
    }
    const distinctLineCount = BigInt(computedLines.length);

    return configuration.constraints.map(constraint => {
        const actual =
            constraint.measureType === "total_quantity"
                ? totalQuantity
                : distinctLineCount;
        let resultState;
        if (constraint.valueState === "known") {
            const limit = BigInt(constraint.limitValue);
            const passes = compareConstraint(
                actual,
                limit,
                constraint.comparator
            );
            resultState = passes ? "passes" : "over_limit";
            if (!passes) {
                validations.push(
                    makeValidation(
                        "over_limit",
                        "aggregate_constraint_failed",
                        "constraint",
                        constraint.constraintKey,
                        "storecalc.validation.aggregate_constraint_failed",
                        {
                            comparator: constraint.comparator,
                            limitValue: limit.toString(),
                            actualValue: actual.toString(),
                            unitCode: constraint.unitCode
                        }
                    )
                );
            }
        } else if (constraint.valueState === "unknown") {
            resultState = "unknown";
            validations.push(
                makeValidation(
                    "warning",
                    "aggregate_constraint_unknown",
                    "constraint",
                    constraint.constraintKey,
                    "storecalc.validation.aggregate_constraint_unknown"
                )
            );
        } else if (constraint.valueState === "unsupported") {
            resultState = "unsupported";
            validations.push(
                makeValidation(
                    "hard_error",
                    "aggregate_constraint_unsupported",
                    "constraint",
                    constraint.constraintKey,
                    "storecalc.validation.aggregate_constraint_unsupported"
                )
            );
        } else {
            resultState = constraint.valueState;
        }

        return {
            constraintKey: constraint.constraintKey,
            displayName: constraint.displayName,
            measureType: constraint.measureType,
            comparator: constraint.comparator,
            valueState: constraint.valueState,
            actualValue: actual.toString(),
            limitValue: constraint.limitValue,
            unitCode: constraint.unitCode,
            resultState
        };
    });
}

function computeTotals(computedLines) {
    const listedValues = computedLines.map(line => line.listedTotal);
    const subtotalValues = computedLines.map(line => line.itemSubtotal);
    const taxValues = computedLines.map(line => line.tax);
    const totalValues = computedLines.map(line => line.lineTotal);
    const unsupported = computedLines.some(
        line => line.unknownState === "unsupported"
    );
    const unknown = computedLines.some(line => line.unknownState === "unknown");
    const anyKnownTax = computedLines.some(
        line => line.output.taxState === "known"
    );

    const listedKnown = listedValues.every(value => value !== null);
    const subtotalKnown = subtotalValues.every(value => value !== null);
    const taxKnown = taxValues.every(
        (value, index) =>
            value !== null ||
            computedLines[index].output.taxState === "not_applicable"
    );
    const finalKnown = totalValues.every(value => value !== null);

    return {
        listedPriceTotalState: listedKnown
            ? "known"
            : unsupported
              ? "unsupported"
              : "unknown",
        listedPriceTotalMinor: listedKnown
            ? sumKnown(listedValues, "$.totals.listedPriceTotalMinor").toString()
            : null,
        itemSubtotalState: subtotalKnown
            ? "known"
            : unsupported
              ? "unsupported"
              : "unknown",
        itemSubtotalMinor: subtotalKnown
            ? sumKnown(subtotalValues, "$.totals.itemSubtotalMinor").toString()
            : null,
        taxState:
            computedLines.length === 0 || (!anyKnownTax && taxKnown)
                ? "not_applicable"
                : taxKnown
                  ? "known"
                  : unsupported
                    ? "unsupported"
                    : "unknown",
        taxMinor:
            anyKnownTax && taxKnown
                ? sumKnown(
                      taxValues.map(value => value ?? 0n),
                      "$.totals.taxMinor"
                  ).toString()
                : null,
        finalTotalState: finalKnown
            ? "known"
            : unsupported
              ? "unsupported"
              : unknown
                ? "unknown"
                : "unknown",
        finalTotalMinor: finalKnown
            ? sumKnown(totalValues, "$.totals.finalTotalMinor").toString()
            : null,
        totalScope: "items_and_supported_tax_only",
        facilityFeeState: "unsupported",
        facilityFeeMinor: null
    };
}

function computeAvailableFunds(availableFunds, totals, validations) {
    if (availableFunds === null) {
        return {
            state: "not_provided",
            availableFundsMinor: null,
            remainingState: "not_applicable",
            remainingMinor: null,
            resultState: "not_applicable"
        };
    }
    if (totals.finalTotalState !== "known") {
        return {
            state: "known",
            availableFundsMinor: availableFunds.toString(),
            remainingState: "unknown",
            remainingMinor: null,
            resultState: "unknown"
        };
    }

    const finalTotal = BigInt(totals.finalTotalMinor);
    const remaining = availableFunds - finalTotal;
    if (remaining < 0n) {
        validations.push(
            makeValidation(
                "over_limit",
                "personal_funds_exceeded",
                "available_funds",
                null,
                "storecalc.validation.personal_funds_exceeded",
                {
                    availableFundsMinor: availableFunds.toString(),
                    finalTotalMinor: finalTotal.toString(),
                    overageMinor: (-remaining).toString()
                }
            )
        );
    }
    return {
        state: "known",
        availableFundsMinor: availableFunds.toString(),
        remainingState: "known",
        remainingMinor: remaining.toString(),
        resultState: remaining < 0n ? "over_limit" : "within_funds"
    };
}

function normalizeCalculationInput(value) {
    assertExactKeys(
        value,
        [
            "configuration",
            "contextDate",
            "quantities",
            "availableFundsMinor",
            "supportedCapabilities"
        ],
        [],
        "$"
    );
    const configuration = normalizeConfiguration(value.configuration, {
        requireHash: true
    });
    const supportedCapabilities = normalizeSupportedCapabilities(
        value.supportedCapabilities
    );
    for (const capability of configuration.requiredCapabilities) {
        if (!ENGINE_CAPABILITIES.has(capability)) {
            fail(
                "UNSUPPORTED_CAPABILITY",
                "$.configuration.requiredCapabilities"
            );
        }
        if (!supportedCapabilities.includes(capability)) {
            fail("CAPABILITY_NOT_AVAILABLE", "$.supportedCapabilities");
        }
    }

    const itemsByKey = new Map(
        configuration.items.map(item => [item.itemKey, item])
    );
    const quantities = normalizeQuantities(value.quantities, itemsByKey);
    let availableFunds = null;
    if (value.availableFundsMinor !== null) {
        availableFunds = parseUnsigned(
            value.availableFundsMinor,
            MAX_MONEY_MINOR,
            "$.availableFundsMinor"
        );
    }
    return {
        configuration,
        contextDate: normalizeDate(value.contextDate, "$.contextDate"),
        quantities,
        availableFunds
    };
}

export function calculateStoreCalcOrder(value) {
    const input = normalizeCalculationInput(value);
    const validations = [];
    const computedLines = [];
    const warnings = input.configuration.warnings.map(warning => ({
        ...warning,
        targetType: "configuration",
        targetKey: input.configuration.configurationKey
    }));

    for (const item of input.configuration.items) {
        const quantity = input.quantities.get(item.itemKey) ?? 0n;
        if (quantity === 0n) continue;
        const line = computeLine(item, quantity, validations);
        computedLines.push(line);
        for (const warning of item.warnings) {
            warnings.push({
                ...warning,
                targetType: "item",
                targetKey: item.itemKey
            });
        }
    }

    const totals = computeTotals(computedLines);
    const spendingBuckets = computeBuckets(
        input.configuration,
        computedLines,
        validations
    );
    const constraints = computeConstraints(
        input.configuration,
        computedLines,
        validations
    );
    const availableFunds = computeAvailableFunds(
        input.availableFunds,
        totals,
        validations
    );

    validations.sort(compareValidations);
    warnings.sort((left, right) => {
        return (
            compareWarnings(left, right) ||
            compareCodeUnits(left.targetType, right.targetType) ||
            compareCodeUnits(left.targetKey, right.targetKey)
        );
    });

    const hasHardError = validations.some(
        validation => validation.severity === "hard_error"
    );
    const hasOverLimit = validations.some(
        validation => validation.severity === "over_limit"
    );
    const hasUncertainty =
        validations.some(validation => validation.severity === "warning") ||
        warnings.some(warning => warning.severity === "warning") ||
        totals.finalTotalState !== "known";

    const resultWithoutHash = {
        resultSchemaVersion: CALCULATION_RESULT_SCHEMA_VERSION,
        engineVersion: ENGINE_VERSION,
        calculationContractVersion: CALCULATION_CONTRACT_VERSION,
        canonicalizationVersion: CANONICALIZATION_VERSION,
        hashAlgorithm: HASH_ALGORITHM,
        configurationKey: input.configuration.configurationKey,
        configurationHash: input.configuration.contentHash,
        contextDate: input.contextDate,
        currencyCode: input.configuration.currencyCode,
        currencyExponent: input.configuration.currencyExponent,
        requiredCapabilities: input.configuration.requiredCapabilities,
        calculationState: hasHardError
            ? "invalid"
            : hasUncertainty
              ? "incomplete"
              : "complete",
        complianceState:
            hasHardError || hasOverLimit
                ? "violations"
                : hasUncertainty
                  ? "unknown"
                  : "passes_known_rules",
        ruleResolution: {
            taxBehavior: "exactly_one_item_treatment",
            taxRoundingScope: "line",
            spendingBucketBehavior: "parallel_pretax_not_summed",
            aggregateConstraintBehavior: "all_must_pass"
        },
        lines: computedLines.map(line => line.output),
        totals,
        spendingBuckets,
        constraints,
        availableFunds,
        warnings,
        validations
    };
    return deepFreeze({
        ...resultWithoutHash,
        resultHash: sha256Canonical(resultWithoutHash)
    });
}
