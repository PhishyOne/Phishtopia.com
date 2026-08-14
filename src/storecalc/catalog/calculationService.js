import {
    CALCULATION_BOUNDS,
    calculateStoreCalcOrder,
    SUPPORTED_CALCULATION_CAPABILITIES,
    verifyResolvedConfiguration
} from "../calculation/core.js";
import { CATALOG_CONFIGURATION_PROJECTION_VERSION } from "./configurationProjector.js";
import {
    CATALOG_REQUEST_ORCHESTRATION_VERSION,
    orchestrateCatalogRequest
} from "./requestService.js";
import { CATALOG_RESOLVER_VERSION } from "./resolutionService.js";

export const CATALOG_CALCULATION_ORCHESTRATION_VERSION =
    "storecalc.catalog-calculation-orchestration.v1";

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const MAX_MONEY_MINOR = BigInt(CALCULATION_BOUNDS.maxMoneyMinor);
const MAX_QUANTITY = BigInt(CALCULATION_BOUNDS.maxQuantity);
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const UNSIGNED_INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const REQUEST_KEYS = Object.freeze([
    "facilityId",
    "programId",
    "templateId",
    "audienceKey",
    "configurationHash",
    "contextDate",
    "quantities",
    "availableFundsMinor"
]);
const CATALOG_REQUEST_KEYS = Object.freeze([
    "facilityId",
    "programId",
    "templateId",
    "audienceKey",
    "contextDate"
]);
const UNAVAILABLE_KEYS = Object.freeze([
    "state",
    "orchestrationVersion",
    "resolverVersion",
    "context"
]);
const RESOLVED_KEYS = Object.freeze([
    "state",
    "orchestrationVersion",
    "resolverVersion",
    "projectionVersion",
    "context",
    "assignmentInterval",
    "applicabilityInterval",
    "lineage",
    "catalog",
    "configuration"
]);

export class StoreCalcCatalogCalculationError extends Error {
    constructor(code, path = "$") {
        super(code);
        this.name = "StoreCalcCatalogCalculationError";
        this.code = code;
        this.path = path;
    }
}

function fail(code, path = "$") {
    throw new StoreCalcCatalogCalculationError(code, path);
}

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, keys) {
    return (
        isPlainObject(value) &&
        Object.keys(value).length === keys.length &&
        keys.every(key => Object.hasOwn(value, key))
    );
}

function requireId(value, path) {
    if (
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > MAX_POSTGRES_INTEGER
    ) {
        fail("REQUEST_INVALID", path);
    }
    return value;
}

function requireKey(value, path) {
    if (
        typeof value !== "string" ||
        value.length > 64 ||
        !KEY_PATTERN.test(value)
    ) {
        fail("REQUEST_INVALID", path);
    }
    return value;
}

function requireDate(value, path) {
    if (typeof value !== "string") fail("REQUEST_INVALID", path);
    const match = DATE_PATTERN.exec(value);
    if (!match) fail("REQUEST_INVALID", path);
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (
        year < 1 ||
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > days[month - 1]
    ) {
        fail("REQUEST_INVALID", path);
    }
    return value;
}

function requireUnsigned(value, maximum, path) {
    if (
        typeof value !== "string" ||
        value.length > maximum.toString().length ||
        !UNSIGNED_INTEGER_PATTERN.test(value)
    ) {
        fail("REQUEST_INVALID", path);
    }
    if (BigInt(value) > maximum) fail("REQUEST_INVALID", path);
    return value;
}

function normalizeQuantities(value) {
    if (
        !Array.isArray(value) ||
        Object.keys(value).length !== value.length ||
        value.length > CALCULATION_BOUNDS.maxSelectedLines
    ) {
        fail("REQUEST_INVALID", "$.quantities");
    }
    const seen = new Set();
    return Object.freeze(
        value.map((entry, index) => {
            const path = `$.quantities[${index}]`;
            if (!hasExactKeys(entry, ["itemKey", "quantity"])) {
                fail("REQUEST_INVALID", path);
            }
            const itemKey = requireKey(entry.itemKey, `${path}.itemKey`);
            if (seen.has(itemKey)) fail("REQUEST_INVALID", `${path}.itemKey`);
            seen.add(itemKey);
            return Object.freeze({
                itemKey,
                quantity: requireUnsigned(
                    entry.quantity,
                    MAX_QUANTITY,
                    `${path}.quantity`
                )
            });
        })
    );
}

function normalizeRequest(value) {
    if (!hasExactKeys(value, REQUEST_KEYS)) fail("REQUEST_INVALID");
    if (
        typeof value.configurationHash !== "string" ||
        !HASH_PATTERN.test(value.configurationHash)
    ) {
        fail("REQUEST_INVALID", "$.configurationHash");
    }
    const catalogRequest = Object.freeze({
        facilityId: requireId(value.facilityId, "$.facilityId"),
        programId: requireId(value.programId, "$.programId"),
        templateId: requireId(value.templateId, "$.templateId"),
        audienceKey: requireKey(value.audienceKey, "$.audienceKey"),
        contextDate: requireDate(value.contextDate, "$.contextDate")
    });
    const availableFundsMinor =
        value.availableFundsMinor === null
            ? null
            : requireUnsigned(
                  value.availableFundsMinor,
                  MAX_MONEY_MINOR,
                  "$.availableFundsMinor"
              );
    return Object.freeze({
        catalogRequest,
        configurationHash: value.configurationHash,
        quantities: normalizeQuantities(value.quantities),
        availableFundsMinor
    });
}

function sameCatalogRequest(value, expected) {
    return (
        hasExactKeys(value, CATALOG_REQUEST_KEYS) &&
        CATALOG_REQUEST_KEYS.every(key => value[key] === expected[key])
    );
}

function normalizeCatalogResult(value, request) {
    if (!isPlainObject(value)) {
        fail("DEPENDENCY_RESULT_INVALID", "$.catalogRequest");
    }
    if (
        value.orchestrationVersion !== CATALOG_REQUEST_ORCHESTRATION_VERSION ||
        value.resolverVersion !== CATALOG_RESOLVER_VERSION
    ) {
        fail("DEPENDENCY_RESULT_INVALID", "$.catalogRequest");
    }
    if (!sameCatalogRequest(value.context, request.catalogRequest)) {
        fail("DEPENDENCY_RESULT_DRIFT", "$.catalogRequest.context");
    }
    if (value.state === "unavailable") {
        if (!hasExactKeys(value, UNAVAILABLE_KEYS)) {
            fail("DEPENDENCY_RESULT_INVALID", "$.catalogRequest");
        }
        return Object.freeze({ state: "unavailable", source: value });
    }
    if (
        value.state !== "resolved" ||
        !hasExactKeys(value, RESOLVED_KEYS) ||
        value.projectionVersion !== CATALOG_CONFIGURATION_PROJECTION_VERSION
    ) {
        fail("DEPENDENCY_RESULT_INVALID", "$.catalogRequest");
    }
    let configuration;
    try {
        configuration = verifyResolvedConfiguration(value.configuration);
    } catch {
        fail("DEPENDENCY_RESULT_INVALID", "$.catalogRequest.configuration");
    }
    if (configuration.contentHash !== request.configurationHash) {
        fail("CONFIGURATION_STALE", "$.configurationHash");
    }
    return Object.freeze({ state: "resolved", source: value, configuration });
}

function copyMetadata(source) {
    return structuredClone({
        catalogRequestOrchestrationVersion: source.orchestrationVersion,
        resolverVersion: source.resolverVersion,
        projectionVersion: source.projectionVersion,
        context: source.context,
        assignmentInterval: source.assignmentInterval,
        applicabilityInterval: source.applicabilityInterval,
        lineage: source.lineage,
        catalog: source.catalog
    });
}

function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) {
        return value;
    }
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

function dependenciesFrom(value) {
    if (
        !hasExactKeys(value, ["orchestrateCatalogRequest"]) ||
        typeof value.orchestrateCatalogRequest !== "function"
    ) {
        fail("DEPENDENCY_INVALID", "$.dependencies");
    }
    return Object.freeze({ ...value });
}

export function createCatalogCalculationOrchestrator(dependencies) {
    const services = dependenciesFrom(dependencies);
    return async function orchestrateCatalogCalculation(pool, value) {
        const request = normalizeRequest(value);
        const catalogResult = normalizeCatalogResult(
            await services.orchestrateCatalogRequest(
                pool,
                request.catalogRequest
            ),
            request
        );
        if (catalogResult.state === "unavailable") {
            return deepFreeze({
                state: "unavailable",
                orchestrationVersion:
                    CATALOG_CALCULATION_ORCHESTRATION_VERSION,
                catalogRequestOrchestrationVersion:
                    catalogResult.source.orchestrationVersion,
                resolverVersion: catalogResult.source.resolverVersion,
                context: structuredClone(catalogResult.source.context)
            });
        }

        const calculation = calculateStoreCalcOrder({
            configuration: catalogResult.configuration,
            contextDate: request.catalogRequest.contextDate,
            quantities: request.quantities,
            availableFundsMinor: request.availableFundsMinor,
            supportedCapabilities: [...SUPPORTED_CALCULATION_CAPABILITIES]
        });
        return deepFreeze({
            state: "calculated",
            orchestrationVersion: CATALOG_CALCULATION_ORCHESTRATION_VERSION,
            ...copyMetadata(catalogResult.source),
            calculation
        });
    };
}

export const orchestrateCatalogCalculation =
    createCatalogCalculationOrchestrator({ orchestrateCatalogRequest });
