import {
    SUPPORTED_CALCULATION_CAPABILITIES,
    verifyResolvedConfiguration
} from "../calculation/core.js";

export const MAX_PUBLIC_CALCULATION_CATALOGS = 128;

const KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ENGINE_CAPABILITIES = new Set(SUPPORTED_CALCULATION_CAPABILITIES);

export class StoreCalcCatalogRegistryError extends Error {
    constructor(code, path = "$") {
        super(code);
        this.name = "StoreCalcCatalogRegistryError";
        this.code = code;
        this.path = path;
    }
}

function fail(code, path) {
    throw new StoreCalcCatalogRegistryError(code, path);
}

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, keys, path) {
    if (!isPlainObject(value)) fail("CATALOG_ENTRY_INVALID", path);
    const actual = Object.keys(value);
    if (
        actual.length !== keys.length ||
        keys.some(key => !Object.hasOwn(value, key))
    ) {
        fail("CATALOG_ENTRY_SHAPE_INVALID", path);
    }
}

function normalizeKey(value, path) {
    if (
        typeof value !== "string" ||
        value.length > 64 ||
        !KEY_PATTERN.test(value)
    ) {
        fail("CATALOG_KEY_INVALID", path);
    }
    return value;
}

function normalizeDate(value, path) {
    if (typeof value !== "string") fail("CATALOG_DATE_INVALID", path);
    const match = DATE_PATTERN.exec(value);
    if (!match) fail("CATALOG_DATE_INVALID", path);

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
        fail("CATALOG_DATE_INVALID", path);
    }
    return value;
}

function compareCodeUnits(left, right) {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
}

function compareEntries(left, right) {
    return (
        compareCodeUnits(left.facilitySelectionKey, right.facilitySelectionKey) ||
        compareCodeUnits(left.templateSelectionKey, right.templateSelectionKey) ||
        compareCodeUnits(left.audienceKey, right.audienceKey) ||
        compareCodeUnits(left.effectiveFrom, right.effectiveFrom) ||
        compareCodeUnits(
            left.effectiveThrough ?? "9999-12-31",
            right.effectiveThrough ?? "9999-12-31"
        ) ||
        compareCodeUnits(
            left.configuration.contentHash,
            right.configuration.contentHash
        )
    );
}

function sameScope(left, right) {
    return (
        left.facilitySelectionKey === right.facilitySelectionKey &&
        left.templateSelectionKey === right.templateSelectionKey &&
        left.audienceKey === right.audienceKey
    );
}

function normalizeEntry(value, index) {
    const path = `$.catalogs[${index}]`;
    assertExactKeys(
        value,
        [
            "facilitySelectionKey",
            "templateSelectionKey",
            "audienceKey",
            "effectiveFrom",
            "effectiveThrough",
            "configuration"
        ],
        path
    );

    const effectiveFrom = normalizeDate(
        value.effectiveFrom,
        `${path}.effectiveFrom`
    );
    const effectiveThrough =
        value.effectiveThrough === null
            ? null
            : normalizeDate(
                  value.effectiveThrough,
                  `${path}.effectiveThrough`
              );
    if (effectiveThrough !== null && effectiveThrough < effectiveFrom) {
        fail("CATALOG_INTERVAL_INVALID", path);
    }

    let configuration;
    try {
        configuration = verifyResolvedConfiguration(value.configuration);
    } catch {
        fail("CATALOG_CONFIGURATION_INVALID", `${path}.configuration`);
    }
    if (
        configuration.requiredCapabilities.some(
            capability => !ENGINE_CAPABILITIES.has(capability)
        )
    ) {
        fail("CATALOG_CAPABILITY_UNSUPPORTED", `${path}.configuration`);
    }

    return Object.freeze({
        facilitySelectionKey: normalizeKey(
            value.facilitySelectionKey,
            `${path}.facilitySelectionKey`
        ),
        templateSelectionKey: normalizeKey(
            value.templateSelectionKey,
            `${path}.templateSelectionKey`
        ),
        audienceKey: normalizeKey(value.audienceKey, `${path}.audienceKey`),
        effectiveFrom,
        effectiveThrough,
        configuration
    });
}

function validateIntervals(entries) {
    for (let index = 1; index < entries.length; index += 1) {
        const previous = entries[index - 1];
        const current = entries[index];
        if (!sameScope(previous, current)) continue;
        if (
            previous.effectiveThrough === null ||
            current.effectiveFrom <= previous.effectiveThrough
        ) {
            fail("CATALOG_INTERVAL_OVERLAP", "$.catalogs");
        }
    }
}

function isEffective(entry, contextDate) {
    return (
        entry.effectiveFrom <= contextDate &&
        (entry.effectiveThrough === null ||
            contextDate <= entry.effectiveThrough)
    );
}

export function createPublicCalculationCatalogRegistry(catalogs) {
    if (!Array.isArray(catalogs)) {
        fail("CATALOG_ARRAY_REQUIRED", "$.catalogs");
    }
    if (catalogs.length > MAX_PUBLIC_CALCULATION_CATALOGS) {
        fail("CATALOG_ARRAY_BOUND_EXCEEDED", "$.catalogs");
    }

    const entries = catalogs.map(normalizeEntry).sort(compareEntries);
    validateIntervals(entries);
    Object.freeze(entries);

    return Object.freeze({
        resolve({
            facilitySelectionKey,
            templateSelectionKey,
            audienceKey,
            contextDate
        }) {
            const entry = entries.find(candidate => {
                return (
                    candidate.facilitySelectionKey === facilitySelectionKey &&
                    candidate.templateSelectionKey === templateSelectionKey &&
                    candidate.audienceKey === audienceKey &&
                    isEffective(candidate, contextDate)
                );
            });
            if (!entry) return Object.freeze({ state: "unavailable" });
            return Object.freeze({
                state: "available",
                configuration: entry.configuration
            });
        }
    });
}
