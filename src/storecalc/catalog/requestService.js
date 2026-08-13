import { createHash } from "node:crypto";

import {
    canonicalizeStoreCalcValue,
    verifyResolvedConfiguration
} from "../calculation/core.js";
import {
    CATALOG_CONFIGURATION_PROJECTION_VERSION,
    projectCatalogVersionContent
} from "./configurationProjector.js";
import { verifyCatalogVersionContent } from "./content.js";
import {
    CATALOG_RESOLVER_VERSION,
    resolvePublicCatalogVersion
} from "./resolutionService.js";
import { loadSealedCatalogVersionContent } from "./sealingService.js";

export const CATALOG_REQUEST_ORCHESTRATION_VERSION =
    "storecalc.catalog-request-orchestration.v1";

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CONTEXT_KEYS = Object.freeze([
    "facilityId",
    "programId",
    "templateId",
    "audienceKey",
    "contextDate"
]);
const LINEAGE_KEYS = Object.freeze([
    "assignmentId",
    "applicabilityId",
    "selectionMode",
    "exactVersionId",
    "publicationId",
    "publicationIsCurrent",
    "versionId",
    "facilityId",
    "programId",
    "templateId",
    "audienceKey"
]);
const CATALOG_KEYS = Object.freeze([
    "versionId",
    "versionNumber",
    "currencyCode",
    "currencyExponent",
    "sourceEffectiveDate",
    "sourcePublishedDate",
    "calculationContractVersion",
    "requiredCapabilities",
    "contentSchemaVersion",
    "canonicalizationVersion",
    "hashAlgorithm",
    "contentHash"
]);

export class StoreCalcCatalogRequestError extends Error {
    constructor(code, path = "$", options = undefined) {
        super(code, options);
        this.name = "StoreCalcCatalogRequestError";
        this.code = code;
        this.path = path;
    }
}

function fail(code, path = "$", cause = undefined) {
    const options = cause === undefined ? undefined : { cause };
    throw new StoreCalcCatalogRequestError(code, path, options);
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

function requireExactObject(value, keys, path) {
    if (!hasExactKeys(value, keys)) {
        fail("DEPENDENCY_RESULT_INVALID", path);
    }
    return value;
}

function requireId(value, path) {
    if (
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > MAX_POSTGRES_INTEGER
    ) {
        fail("DEPENDENCY_RESULT_INVALID", path);
    }
    return value;
}

function requireNullableId(value, path) {
    return value === null ? null : requireId(value, path);
}

function requireDate(value, path, { nullable = false } = {}) {
    if (nullable && value === null) return null;
    if (typeof value !== "string") fail("DEPENDENCY_RESULT_INVALID", path);
    const match = DATE_PATTERN.exec(value);
    if (!match) fail("DEPENDENCY_RESULT_INVALID", path);
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
        fail("DEPENDENCY_RESULT_INVALID", path);
    }
    return value;
}

function requireHash(value, path) {
    if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
        fail("DEPENDENCY_RESULT_INVALID", path);
    }
    return value;
}

function sameArray(left, right) {
    return (
        Array.isArray(left) &&
        Array.isArray(right) &&
        left.length === right.length &&
        left.every((value, index) => value === right[index])
    );
}

function normalizeContext(value, input) {
    requireExactObject(value, CONTEXT_KEYS, "$.resolution.context");
    if (
        !hasExactKeys(input, CONTEXT_KEYS) ||
        CONTEXT_KEYS.some(key => value[key] !== input[key])
    ) {
        fail("DEPENDENCY_RESULT_DRIFT", "$.resolution.context");
    }
    requireId(value.facilityId, "$.resolution.context.facilityId");
    requireId(value.programId, "$.resolution.context.programId");
    requireId(value.templateId, "$.resolution.context.templateId");
    if (
        typeof value.audienceKey !== "string" ||
        !/^[a-z][a-z0-9_]*$/.test(value.audienceKey)
    ) {
        fail("DEPENDENCY_RESULT_INVALID", "$.resolution.context.audienceKey");
    }
    requireDate(value.contextDate, "$.resolution.context.contextDate");
    return Object.freeze({
        facilityId: value.facilityId,
        programId: value.programId,
        templateId: value.templateId,
        audienceKey: value.audienceKey,
        contextDate: value.contextDate
    });
}

function normalizeInterval(value, path) {
    requireExactObject(value, ["validFrom", "validThrough"], path);
    const validFrom = requireDate(value.validFrom, `${path}.validFrom`, {
        nullable: true
    });
    const validThrough = requireDate(value.validThrough, `${path}.validThrough`, {
        nullable: true
    });
    if (validFrom !== null && validThrough !== null && validFrom > validThrough) {
        fail("DEPENDENCY_RESULT_INVALID", path);
    }
    return Object.freeze({ validFrom, validThrough });
}

function intervalContains(interval, contextDate) {
    return (
        (interval.validFrom === null || interval.validFrom <= contextDate) &&
        (interval.validThrough === null || interval.validThrough >= contextDate)
    );
}

function normalizeLineage(value, context) {
    requireExactObject(value, LINEAGE_KEYS, "$.resolution.lineage");
    const assignmentId = requireId(
        value.assignmentId,
        "$.resolution.lineage.assignmentId"
    );
    const applicabilityId = requireId(
        value.applicabilityId,
        "$.resolution.lineage.applicabilityId"
    );
    const exactVersionId = requireNullableId(
        value.exactVersionId,
        "$.resolution.lineage.exactVersionId"
    );
    const publicationId = requireNullableId(
        value.publicationId,
        "$.resolution.lineage.publicationId"
    );
    const versionId = requireId(value.versionId, "$.resolution.lineage.versionId");
    const exactSelection =
        value.selectionMode === "exact_version" &&
        exactVersionId === versionId &&
        publicationId === null &&
        value.publicationIsCurrent === null;
    const publicationSelection =
        value.selectionMode === "publication" &&
        exactVersionId === null &&
        publicationId !== null &&
        typeof value.publicationIsCurrent === "boolean";
    if (!exactSelection && !publicationSelection) {
        fail("DEPENDENCY_RESULT_INVALID", "$.resolution.lineage");
    }
    if (
        value.facilityId !== context.facilityId ||
        value.programId !== context.programId ||
        value.templateId !== context.templateId ||
        value.audienceKey !== context.audienceKey
    ) {
        fail("DEPENDENCY_RESULT_DRIFT", "$.resolution.lineage");
    }
    return Object.freeze({
        assignmentId,
        applicabilityId,
        selectionMode: value.selectionMode,
        exactVersionId,
        publicationId,
        publicationIsCurrent: value.publicationIsCurrent,
        versionId,
        facilityId: value.facilityId,
        programId: value.programId,
        templateId: value.templateId,
        audienceKey: value.audienceKey
    });
}

function normalizeCatalog(value, lineage, context) {
    requireExactObject(value, CATALOG_KEYS, "$.resolution.catalog");
    if (
        requireId(value.versionId, "$.resolution.catalog.versionId") !==
        lineage.versionId
    ) {
        fail("DEPENDENCY_RESULT_DRIFT", "$.resolution.catalog.versionId");
    }
    requireId(value.versionNumber, "$.resolution.catalog.versionNumber");
    if (
        value.currencyCode !== "USD" ||
        value.currencyExponent !== 2 ||
        value.calculationContractVersion !== "storecalc.calculation.v1" ||
        value.contentSchemaVersion !== "storecalc.catalog-content.v1" ||
        value.canonicalizationVersion !== "storecalc.canonical-json.v1" ||
        value.hashAlgorithm !== "sha256"
    ) {
        fail("DEPENDENCY_RESULT_INVALID", "$.resolution.catalog");
    }
    const effectiveDate = requireDate(
        value.sourceEffectiveDate,
        "$.resolution.catalog.sourceEffectiveDate",
        { nullable: true }
    );
    requireDate(
        value.sourcePublishedDate,
        "$.resolution.catalog.sourcePublishedDate",
        { nullable: true }
    );
    if (effectiveDate !== null && effectiveDate > context.contextDate) {
        fail("DEPENDENCY_RESULT_DRIFT", "$.resolution.catalog.sourceEffectiveDate");
    }
    const requiredCapabilities = value.requiredCapabilities;
    if (
        !Array.isArray(requiredCapabilities) ||
        Object.keys(requiredCapabilities).length !== requiredCapabilities.length ||
        requiredCapabilities.length < 2 ||
        requiredCapabilities.length > 32 ||
        requiredCapabilities.some(
            (capability, index) =>
                typeof capability !== "string" ||
                !/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*\.v[1-9][0-9]*$/.test(
                    capability
                ) ||
                (index > 0 && requiredCapabilities[index - 1] >= capability)
        )
    ) {
        fail("DEPENDENCY_RESULT_INVALID", "$.resolution.catalog.requiredCapabilities");
    }
    requireHash(value.contentHash, "$.resolution.catalog.contentHash");
    return Object.freeze({
        versionId: value.versionId,
        versionNumber: value.versionNumber,
        currencyCode: value.currencyCode,
        currencyExponent: value.currencyExponent,
        sourceEffectiveDate: value.sourceEffectiveDate,
        sourcePublishedDate: value.sourcePublishedDate,
        calculationContractVersion: value.calculationContractVersion,
        requiredCapabilities: Object.freeze([...requiredCapabilities]),
        contentSchemaVersion: value.contentSchemaVersion,
        canonicalizationVersion: value.canonicalizationVersion,
        hashAlgorithm: value.hashAlgorithm,
        contentHash: value.contentHash
    });
}

function normalizeResolution(value, input) {
    if (!isPlainObject(value) || value.resolverVersion !== CATALOG_RESOLVER_VERSION) {
        fail("DEPENDENCY_RESULT_INVALID", "$.resolution");
    }
    if (value.state === "unavailable") {
        requireExactObject(
            value,
            ["state", "resolverVersion", "context"],
            "$.resolution"
        );
        return Object.freeze({
            state: "unavailable",
            context: normalizeContext(value.context, input)
        });
    }
    if (value.state !== "resolved") {
        fail("DEPENDENCY_RESULT_INVALID", "$.resolution.state");
    }
    requireExactObject(
        value,
        [
            "state",
            "resolverVersion",
            "context",
            "assignmentInterval",
            "applicabilityInterval",
            "lineage",
            "catalog"
        ],
        "$.resolution"
    );
    const context = normalizeContext(value.context, input);
    const lineage = normalizeLineage(value.lineage, context);
    const catalog = normalizeCatalog(value.catalog, lineage, context);
    const assignmentInterval = normalizeInterval(
        value.assignmentInterval,
        "$.resolution.assignmentInterval"
    );
    const applicabilityInterval = normalizeInterval(
        value.applicabilityInterval,
        "$.resolution.applicabilityInterval"
    );
    if (
        !intervalContains(assignmentInterval, context.contextDate) ||
        !intervalContains(applicabilityInterval, context.contextDate)
    ) {
        fail("DEPENDENCY_RESULT_DRIFT", "$.resolution.intervals");
    }
    return Object.freeze({
        state: "resolved",
        context,
        assignmentInterval,
        applicabilityInterval,
        lineage,
        catalog
    });
}

function configurationKeyFrom(resolution) {
    const material = {
        orchestrationVersion: CATALOG_REQUEST_ORCHESTRATION_VERSION,
        resolverVersion: CATALOG_RESOLVER_VERSION,
        projectionVersion: CATALOG_CONFIGURATION_PROJECTION_VERSION,
        lineage: {
            assignmentId: resolution.lineage.assignmentId,
            applicabilityId: resolution.lineage.applicabilityId,
            selectionMode: resolution.lineage.selectionMode,
            exactVersionId: resolution.lineage.exactVersionId,
            publicationId: resolution.lineage.publicationId,
            versionId: resolution.lineage.versionId,
            facilityId: resolution.lineage.facilityId,
            programId: resolution.lineage.programId,
            templateId: resolution.lineage.templateId,
            audienceKey: resolution.lineage.audienceKey
        },
        catalogContentHash: resolution.catalog.contentHash
    };
    const digest = createHash("sha256")
        .update(canonicalizeStoreCalcValue(material), "utf8")
        .digest("hex");
    return `sc.${digest.slice(0, 61)}`;
}

function normalizeLoaded(value, resolution) {
    requireExactObject(
        value,
        ["versionId", "templateId", "contentHash", "catalog"],
        "$.loadedCatalog"
    );
    if (
        value.versionId !== resolution.lineage.versionId ||
        value.templateId !== resolution.lineage.templateId ||
        value.contentHash !== resolution.catalog.contentHash
    ) {
        fail("DEPENDENCY_RESULT_DRIFT", "$.loadedCatalog");
    }
    let catalog;
    try {
        catalog = verifyCatalogVersionContent(value.catalog);
    } catch (error) {
        fail("DEPENDENCY_RESULT_INVALID", "$.loadedCatalog.catalog", error);
    }
    if (catalog.contentHash !== resolution.catalog.contentHash) {
        fail("DEPENDENCY_RESULT_DRIFT", "$.loadedCatalog.catalog.contentHash");
    }
    return catalog;
}

function normalizeConfiguration(value, key, catalog) {
    let configuration;
    try {
        configuration = verifyResolvedConfiguration(value);
    } catch (error) {
        fail("DEPENDENCY_RESULT_INVALID", "$.configuration", error);
    }
    if (
        configuration.configurationKey !== key ||
        configuration.calculationContractVersion !==
            catalog.calculationContractVersion ||
        configuration.contentSchemaVersion !== catalog.contentSchemaVersion ||
        configuration.canonicalizationVersion !==
            catalog.canonicalizationVersion ||
        configuration.hashAlgorithm !== catalog.hashAlgorithm ||
        configuration.currencyCode !== catalog.currencyCode ||
        configuration.currencyExponent !== catalog.currencyExponent ||
        !sameArray(
            configuration.requiredCapabilities,
            catalog.requiredCapabilities
        )
    ) {
        fail("DEPENDENCY_RESULT_DRIFT", "$.configuration");
    }
    return configuration;
}

function dependenciesFrom(value) {
    requireExactObject(
        value,
        ["resolvePublicCatalogVersion", "loadSealedCatalogVersionContent"],
        "$.dependencies"
    );
    if (
        typeof value.resolvePublicCatalogVersion !== "function" ||
        typeof value.loadSealedCatalogVersionContent !== "function"
    ) {
        fail("DEPENDENCY_INVALID", "$.dependencies");
    }
    return Object.freeze({ ...value });
}

export function createCatalogRequestOrchestrator(dependencies) {
    const services = dependenciesFrom(dependencies);
    return async function orchestrateCatalogRequest(pool, input) {
        const resolution = normalizeResolution(
            await services.resolvePublicCatalogVersion(pool, input),
            input
        );
        if (resolution.state === "unavailable") {
            return Object.freeze({
                state: "unavailable",
                orchestrationVersion: CATALOG_REQUEST_ORCHESTRATION_VERSION,
                resolverVersion: CATALOG_RESOLVER_VERSION,
                context: resolution.context
            });
        }

        const loadRequest = Object.freeze({
            versionId: resolution.lineage.versionId,
            templateId: resolution.lineage.templateId,
            contentHash: resolution.catalog.contentHash
        });
        const catalog = normalizeLoaded(
            await services.loadSealedCatalogVersionContent(pool, loadRequest),
            resolution
        );
        const configurationKey = configurationKeyFrom(resolution);
        const configuration = normalizeConfiguration(
            projectCatalogVersionContent(catalog, { configurationKey }),
            configurationKey,
            catalog
        );

        return Object.freeze({
            state: "resolved",
            orchestrationVersion: CATALOG_REQUEST_ORCHESTRATION_VERSION,
            resolverVersion: CATALOG_RESOLVER_VERSION,
            projectionVersion: CATALOG_CONFIGURATION_PROJECTION_VERSION,
            context: resolution.context,
            assignmentInterval: resolution.assignmentInterval,
            applicabilityInterval: resolution.applicabilityInterval,
            lineage: resolution.lineage,
            catalog: resolution.catalog,
            configuration
        });
    };
}

export const orchestrateCatalogRequest = createCatalogRequestOrchestrator({
    resolvePublicCatalogVersion,
    loadSealedCatalogVersionContent
});
