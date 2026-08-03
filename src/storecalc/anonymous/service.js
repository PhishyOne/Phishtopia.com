import {
    CALCULATION_BOUNDS,
    calculateStoreCalcOrder,
    StoreCalcCalculationError,
    SUPPORTED_CALCULATION_CAPABILITIES,
    verifyResolvedConfiguration
} from "../calculation/core.js";

export const ANONYMOUS_CALCULATION_REQUEST_SCHEMA_VERSION =
    "storecalc.anonymous-calculation-request.v1";
export const ANONYMOUS_CALCULATION_RESPONSE_SCHEMA_VERSION =
    "storecalc.anonymous-calculation-response.v1";

const KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const UNSIGNED_INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const MAX_MONEY_MINOR = BigInt(CALCULATION_BOUNDS.maxMoneyMinor);
const MAX_QUANTITY = BigInt(CALCULATION_BOUNDS.maxQuantity);

const ERROR_STATUSES = Object.freeze({
    invalid_request: 400,
    catalog_unavailable: 404,
    configuration_stale: 409,
    calculation_request_invalid: 422,
    calculation_unavailable: 503
});

export class StoreCalcAnonymousCalculationError extends Error {
    constructor(code, { calculationCode = null, path = null } = {}) {
        super(code);
        this.name = "StoreCalcAnonymousCalculationError";
        this.code = code;
        this.status = ERROR_STATUSES[code] ?? 503;
        this.calculationCode = calculationCode;
        this.path = path;
    }
}

function fail(code, details) {
    throw new StoreCalcAnonymousCalculationError(code, details);
}

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, keys) {
    if (!isPlainObject(value)) return false;
    const actual = Object.keys(value);
    return (
        actual.length === keys.length &&
        keys.every(key => Object.hasOwn(value, key))
    );
}

function normalizeSelectionKey(value) {
    if (
        typeof value !== "string" ||
        value.length > 64 ||
        !KEY_PATTERN.test(value)
    ) {
        fail("invalid_request");
    }
    return value;
}

function normalizeUnsigned(value, maximum) {
    if (
        typeof value !== "string" ||
        value.length > maximum.toString().length ||
        !UNSIGNED_INTEGER_PATTERN.test(value)
    ) {
        fail("invalid_request");
    }
    const parsed = BigInt(value);
    if (parsed > maximum) fail("invalid_request");
    return parsed.toString();
}

function normalizeQuantities(value) {
    if (
        !Array.isArray(value) ||
        value.length > CALCULATION_BOUNDS.maxSelectedLines
    ) {
        fail("invalid_request");
    }

    const seen = new Set();
    return value.map(entry => {
        if (!hasExactKeys(entry, ["itemKey", "quantity"])) {
            fail("invalid_request");
        }
        const itemKey = normalizeSelectionKey(entry.itemKey);
        if (seen.has(itemKey)) fail("invalid_request");
        seen.add(itemKey);
        return {
            itemKey,
            quantity: normalizeUnsigned(entry.quantity, MAX_QUANTITY)
        };
    });
}

function normalizeDate(value) {
    if (typeof value !== "string") fail("invalid_request");
    const match = DATE_PATTERN.exec(value);
    if (!match) fail("invalid_request");

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
        fail("invalid_request");
    }
    return value;
}

function normalizeRequest(value) {
    if (
        !hasExactKeys(value, [
            "requestSchemaVersion",
            "facilitySelectionKey",
            "templateSelectionKey",
            "audienceKey",
            "configurationHash",
            "contextDate",
            "quantities",
            "availableFundsMinor"
        ])
    ) {
        fail("invalid_request");
    }
    if (
        value.requestSchemaVersion !==
        ANONYMOUS_CALCULATION_REQUEST_SCHEMA_VERSION
    ) {
        fail("invalid_request");
    }
    if (
        typeof value.configurationHash !== "string" ||
        !HASH_PATTERN.test(value.configurationHash)
    ) {
        fail("invalid_request");
    }
    return {
        facilitySelectionKey: normalizeSelectionKey(
            value.facilitySelectionKey
        ),
        templateSelectionKey: normalizeSelectionKey(
            value.templateSelectionKey
        ),
        audienceKey: normalizeSelectionKey(value.audienceKey),
        configurationHash: value.configurationHash,
        contextDate: normalizeDate(value.contextDate),
        quantities: normalizeQuantities(value.quantities),
        availableFundsMinor:
            value.availableFundsMinor === null
                ? null
                : normalizeUnsigned(
                      value.availableFundsMinor,
                      MAX_MONEY_MINOR
                  )
    };
}

function isClientCalculationError(error) {
    return (
        error.code === "CALCULATION_OVERFLOW" ||
        error.code === "AGGREGATE_COUNT_OVERFLOW" ||
        error.path === "$.contextDate" ||
        error.path === "$.availableFundsMinor" ||
        error.path === "$.quantities" ||
        /^\$\.quantities\[\d+\](?:\.|$)/.test(error.path)
    );
}

function resolveConfiguration(registry, request) {
    let resolution;
    try {
        resolution = registry.resolve({
            facilitySelectionKey: request.facilitySelectionKey,
            templateSelectionKey: request.templateSelectionKey,
            audienceKey: request.audienceKey,
            contextDate: request.contextDate
        });
    } catch {
        fail("calculation_unavailable");
    }

    if (!isPlainObject(resolution) || typeof resolution.state !== "string") {
        fail("calculation_unavailable");
    }
    if (resolution.state === "unavailable") {
        if (!hasExactKeys(resolution, ["state"])) {
            fail("calculation_unavailable");
        }
        fail("catalog_unavailable");
    }
    if (
        resolution.state !== "available" ||
        !hasExactKeys(resolution, ["state", "configuration"])
    ) {
        fail("calculation_unavailable");
    }

    try {
        return verifyResolvedConfiguration(resolution.configuration);
    } catch {
        fail("calculation_unavailable");
    }
}

export function createAnonymousCalculationService({ registry }) {
    if (!registry || typeof registry.resolve !== "function") {
        throw new TypeError("A StoreCalc catalog registry is required.");
    }

    return Object.freeze({
        calculate(value) {
            const request = normalizeRequest(value);
            const configuration = resolveConfiguration(registry, request);
            if (request.configurationHash !== configuration.contentHash) {
                fail("configuration_stale");
            }

            try {
                return calculateStoreCalcOrder({
                    configuration,
                    contextDate: request.contextDate,
                    quantities: request.quantities,
                    availableFundsMinor: request.availableFundsMinor,
                    supportedCapabilities: [
                        ...SUPPORTED_CALCULATION_CAPABILITIES
                    ]
                });
            } catch (error) {
                if (
                    error instanceof StoreCalcCalculationError &&
                    isClientCalculationError(error)
                ) {
                    fail("calculation_request_invalid", {
                        calculationCode: error.code,
                        path: error.path
                    });
                }
                fail("calculation_unavailable");
            }
        }
    });
}

export function anonymousCalculationErrorBody(error) {
    const body = {
        responseSchemaVersion:
            ANONYMOUS_CALCULATION_RESPONSE_SCHEMA_VERSION,
        success: false,
        error: {
            code:
                error instanceof StoreCalcAnonymousCalculationError
                    ? error.code
                    : "calculation_unavailable"
        }
    };
    if (
        error instanceof StoreCalcAnonymousCalculationError &&
        error.code === "calculation_request_invalid"
    ) {
        body.error.calculationCode = error.calculationCode;
        body.error.path = error.path;
    }
    return body;
}
