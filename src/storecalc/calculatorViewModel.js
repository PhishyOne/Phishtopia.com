import {
    CALCULATION_BOUNDS,
    SUPPORTED_CALCULATION_CAPABILITIES,
    verifyResolvedConfiguration
} from "./calculation/core.js";
import {
    ANONYMOUS_CALCULATION_REQUEST_SCHEMA_VERSION,
    ANONYMOUS_CALCULATION_RESPONSE_SCHEMA_VERSION
} from "./anonymous/service.js";

export const CALCULATOR_VIEW_SCHEMA_VERSION = "storecalc.calculator-view.v1";
export const CALCULATOR_ENDPOINT = "/storecalc/api/v1/calculate";

const KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const FORBIDDEN_SHORT_TEXT =
    /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u206f]/u;
const ENGINE_CAPABILITIES = new Set(SUPPORTED_CALCULATION_CAPABILITIES);

export class StoreCalcCalculatorViewError extends Error {
    constructor(code, path = "$") {
        super(code);
        this.name = "StoreCalcCalculatorViewError";
        this.code = code;
        this.path = path;
    }
}

function fail(code, path) {
    throw new StoreCalcCalculatorViewError(code, path);
}

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, keys, path) {
    if (!isPlainObject(value)) fail("VIEW_OBJECT_REQUIRED", path);
    const actual = Object.keys(value);
    if (
        actual.length !== keys.length ||
        keys.some(key => !Object.hasOwn(value, key))
    ) {
        fail("VIEW_OBJECT_SHAPE_INVALID", path);
    }
}

function normalizeText(value, path, maximumCodePoints = 160) {
    if (
        typeof value !== "string" ||
        !value ||
        value !== value.trim() ||
        value.length > maximumCodePoints * 2 ||
        value.normalize("NFC") !== value ||
        FORBIDDEN_SHORT_TEXT.test(value) ||
        Array.from(value).length > maximumCodePoints
    ) {
        fail("VIEW_TEXT_INVALID", path);
    }
    return value;
}

function normalizeKey(value, path) {
    const normalized = normalizeText(value, path, 64);
    if (!KEY_PATTERN.test(normalized)) fail("VIEW_KEY_INVALID", path);
    return normalized;
}

function normalizeDate(value, path) {
    if (typeof value !== "string") fail("VIEW_DATE_INVALID", path);
    const match = DATE_PATTERN.exec(value);
    if (!match) fail("VIEW_DATE_INVALID", path);

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
        fail("VIEW_DATE_INVALID", path);
    }
    return value;
}

function normalizeSource(value) {
    assertExactKeys(value, ["title", "url", "checkedOn"], "$.source");
    let sourceUrl;
    try {
        sourceUrl = new URL(value.url);
    } catch {
        fail("VIEW_SOURCE_URL_INVALID", "$.source.url");
    }
    if (
        sourceUrl.protocol !== "https:" ||
        sourceUrl.username ||
        sourceUrl.password ||
        sourceUrl.hash
    ) {
        fail("VIEW_SOURCE_URL_INVALID", "$.source.url");
    }
    return {
        title: normalizeText(value.title, "$.source.title"),
        url: sourceUrl.toString(),
        checkedOn: normalizeDate(value.checkedOn, "$.source.checkedOn")
    };
}

function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) {
        return value;
    }
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

export function formatStoreCalcMinorUnits(
    minorUnits,
    currencyExponent,
    currencyCode
) {
    if (
        typeof minorUnits !== "string" ||
        !/^(?:0|[1-9][0-9]*)$/.test(minorUnits) ||
        !Number.isSafeInteger(currencyExponent) ||
        currencyExponent < 0 ||
        currencyExponent > 3 ||
        typeof currencyCode !== "string" ||
        !/^[A-Z]{3}$/.test(currencyCode)
    ) {
        fail("VIEW_MONEY_INVALID", "$.money");
    }
    const padded = minorUnits.padStart(currencyExponent + 1, "0");
    const whole =
        currencyExponent === 0 ? padded : padded.slice(0, -currencyExponent);
    const fraction =
        currencyExponent === 0 ? "" : `.${padded.slice(-currencyExponent)}`;
    return `${currencyCode} ${whole}${fraction}`;
}

function taxLabel(treatment) {
    if (treatment.state === "known") {
        return treatment.priceIncludesTax
            ? "Tax included in listed price"
            : "Tax added after listed price";
    }
    return {
        not_applicable: "Tax not applicable",
        unknown: "Tax treatment unknown",
        unsupported: "Tax treatment unsupported"
    }[treatment.state];
}

function availabilityLabel(state) {
    return {
        available: "Available in this catalog",
        unavailable: "Unavailable in this catalog",
        unknown: "Availability not confirmed"
    }[state];
}

function buildItem(item, configuration) {
    const selectable =
        item.priceState === "known" && item.availabilityState !== "unavailable";
    return {
        itemKey: item.itemKey,
        displayName: item.displayName,
        priceState: item.priceState,
        priceMinor: item.priceMinor,
        priceLabel:
            item.priceState === "known"
                ? formatStoreCalcMinorUnits(
                      item.priceMinor,
                      configuration.currencyExponent,
                      configuration.currencyCode
                  )
                : item.priceState === "unknown"
                  ? "Price unknown"
                  : "Price unsupported",
        minimumSelectedQuantity: item.minimumSelectedQuantity,
        maximumOrderQuantity: item.maximumOrderQuantity,
        quantityStep: item.quantityStep,
        availabilityState: item.availabilityState,
        availabilityLabel: availabilityLabel(item.availabilityState),
        taxState: item.taxTreatment.state,
        taxLabel: taxLabel(item.taxTreatment),
        selectable
    };
}

export function buildStoreCalcCalculatorViewModel(value) {
    assertExactKeys(
        value,
        [
            "facilitySelectionKey",
            "facilityName",
            "templateSelectionKey",
            "templateName",
            "audienceKey",
            "audienceLabel",
            "contextDate",
            "source",
            "catalogNotice",
            "configuration"
        ],
        "$"
    );

    let configuration;
    try {
        configuration = verifyResolvedConfiguration(value.configuration);
    } catch {
        fail("VIEW_CONFIGURATION_INVALID", "$.configuration");
    }
    if (
        configuration.requiredCapabilities.some(
            capability => !ENGINE_CAPABILITIES.has(capability)
        )
    ) {
        fail("VIEW_CAPABILITY_UNSUPPORTED", "$.configuration");
    }

    return deepFreeze({
        viewSchemaVersion: CALCULATOR_VIEW_SCHEMA_VERSION,
        endpoint: CALCULATOR_ENDPOINT,
        requestSchemaVersion: ANONYMOUS_CALCULATION_REQUEST_SCHEMA_VERSION,
        responseSchemaVersion: ANONYMOUS_CALCULATION_RESPONSE_SCHEMA_VERSION,
        facilitySelectionKey: normalizeKey(
            value.facilitySelectionKey,
            "$.facilitySelectionKey"
        ),
        facilityName: normalizeText(value.facilityName, "$.facilityName"),
        templateSelectionKey: normalizeKey(
            value.templateSelectionKey,
            "$.templateSelectionKey"
        ),
        templateName: normalizeText(value.templateName, "$.templateName"),
        audienceKey: normalizeKey(value.audienceKey, "$.audienceKey"),
        audienceLabel: normalizeText(value.audienceLabel, "$.audienceLabel"),
        contextDate: normalizeDate(value.contextDate, "$.contextDate"),
        source: normalizeSource(value.source),
        catalogNotice: normalizeText(
            value.catalogNotice,
            "$.catalogNotice",
            240
        ),
        configurationKey: configuration.configurationKey,
        configurationHash: configuration.contentHash,
        currencyCode: configuration.currencyCode,
        currencyExponent: configuration.currencyExponent,
        maximumFundsMinor: CALCULATION_BOUNDS.maxMoneyMinor,
        items: configuration.items.map(item => buildItem(item, configuration))
    });
}
