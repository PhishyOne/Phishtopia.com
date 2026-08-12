import { SUPPORTED_CALCULATION_CAPABILITIES } from "../calculation/core.js";

export const CATALOG_RESOLVER_VERSION = "storecalc.catalog-resolution.v1";

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const AUDIENCE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ENGINE_CAPABILITIES = new Set(SUPPORTED_CALCULATION_CAPABILITIES);
const INPUT_KEYS = Object.freeze([
    "facilityId",
    "programId",
    "templateId",
    "audienceKey",
    "contextDate"
]);

// One statement gives resolution a single PostgreSQL snapshot. LIMIT 2 is
// deliberate: zero is unavailable, one is resolved, and two proves ambiguity
// without loading an unbounded drifted result set. No timestamp or insertion
// ordering is allowed to choose a winner.
const RESOLVE_SQL = `
    /* storecalc:catalog-resolve */
    WITH capability AS MATERIALIZED (
        SELECT schema_version, is_available, verified_at, migration_key
        FROM storecalc.schema_capabilities
        WHERE capability_key = 'anonymous.calculation'
    ),
    candidates AS MATERIALIZED (
        SELECT
            assignment_row.id AS assignment_id,
            assignment_row.facility_id,
            assignment_row.program_id,
            assignment_row.audience_key,
            applicability.id AS applicability_id,
            applicability.template_id,
            applicability.selection_mode,
            applicability.exact_version_id,
            applicability.publication_id,
            publication.version_id AS publication_version_id,
            CASE
                WHEN publication.id IS NULL THEN NULL
                ELSE publication.ended_at IS NULL
            END AS publication_is_current,
            version_row.id AS version_id,
            version_row.version_number,
            version_row.currency_code,
            version_row.currency_exponent,
            to_char(version_row.source_effective_date, 'YYYY-MM-DD')
                AS source_effective_date,
            to_char(version_row.source_published_date, 'YYYY-MM-DD')
                AS source_published_date,
            version_row.calculation_contract_version,
            version_row.required_capabilities,
            version_row.content_schema_version,
            version_row.canonicalization_version,
            version_row.hash_algorithm,
            version_row.content_hash,
            to_char(assignment_row.valid_from, 'YYYY-MM-DD')
                AS assignment_valid_from,
            to_char(assignment_row.valid_through, 'YYYY-MM-DD')
                AS assignment_valid_through,
            to_char(applicability.valid_from, 'YYYY-MM-DD')
                AS applicability_valid_from,
            to_char(applicability.valid_through, 'YYYY-MM-DD')
                AS applicability_valid_through
        FROM storecalc.facilities AS facility_row
        JOIN storecalc.program_facility_assignments AS assignment_row
          ON assignment_row.facility_id = facility_row.id
        JOIN storecalc.store_programs AS program_row
          ON program_row.id = assignment_row.program_id
        JOIN storecalc.templates AS template_row
          ON template_row.program_id = program_row.id
        JOIN storecalc.assignment_template_applicability AS applicability
          ON applicability.assignment_id = assignment_row.id
         AND applicability.program_id = assignment_row.program_id
         AND applicability.facility_id = assignment_row.facility_id
         AND applicability.template_id = template_row.id
        LEFT JOIN storecalc.template_publications AS publication
          ON publication.id = applicability.publication_id
         AND publication.template_id = applicability.template_id
        JOIN storecalc.template_versions AS version_row
          ON version_row.id = CASE applicability.selection_mode
                WHEN 'exact_version' THEN applicability.exact_version_id
                WHEN 'publication' THEN publication.version_id
             END
         AND version_row.template_id = applicability.template_id
        WHERE facility_row.id = $1
          AND facility_row.record_scope = 'public'
          AND facility_row.status IN ('active', 'renamed')
          AND facility_row.merged_into_facility_id IS NULL
          AND program_row.id = $2
          AND program_row.record_scope = 'public'
          AND program_row.status = 'active'
          AND template_row.id = $3
          AND template_row.visibility = 'public'
          AND template_row.status = 'active'
          AND assignment_row.audience_key = $4
          AND assignment_row.assignment_state = 'supported'
          AND assignment_row.retired_at IS NULL
          AND (assignment_row.valid_from IS NULL OR assignment_row.valid_from <= $5::date)
          AND (assignment_row.valid_through IS NULL OR assignment_row.valid_through >= $5::date)
          AND applicability.applicability_state = 'supported'
          AND applicability.ended_at IS NULL
          AND (applicability.valid_from IS NULL OR applicability.valid_from <= $5::date)
          AND (applicability.valid_through IS NULL OR applicability.valid_through >= $5::date)
          AND version_row.content_state = 'sealed'
          AND (version_row.source_effective_date IS NULL OR version_row.source_effective_date <= $5::date)
        ORDER BY applicability.id
        LIMIT 2
    )
    SELECT capability.*, candidates.*
    FROM capability
    LEFT JOIN candidates ON true
    ORDER BY candidates.applicability_id
`;

export class StoreCalcCatalogResolutionError extends Error {
    constructor(code, path = "$", options = undefined) {
        super(code, options);
        this.name = "StoreCalcCatalogResolutionError";
        this.code = code;
        this.path = path;
    }
}

function fail(code, path = "$", cause = undefined) {
    const options = cause === undefined ? undefined : { cause };
    throw new StoreCalcCatalogResolutionError(code, path, options);
}

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function assertDatabasePool(pool) {
    if (!pool || typeof pool !== "object" || typeof pool.query !== "function") {
        fail("DATABASE_POOL_INVALID", "$.database");
    }
}

function assertExactInput(value) {
    if (!isPlainObject(value)) fail("RESOLUTION_INPUT_INVALID");
    const keys = Object.keys(value);
    if (
        keys.length !== INPUT_KEYS.length ||
        INPUT_KEYS.some(key => !Object.hasOwn(value, key))
    ) {
        fail("RESOLUTION_INPUT_INVALID");
    }
}

function normalizeId(value, path) {
    if (
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > MAX_POSTGRES_INTEGER
    ) {
        fail("RESOLUTION_ID_INVALID", path);
    }
    return value;
}

function normalizeAudienceKey(value) {
    if (
        typeof value !== "string" ||
        value.length > 64 ||
        !AUDIENCE_KEY_PATTERN.test(value)
    ) {
        fail("RESOLUTION_AUDIENCE_INVALID", "$.audienceKey");
    }
    return value;
}

function normalizeDate(value) {
    if (typeof value !== "string") {
        fail("RESOLUTION_DATE_INVALID", "$.contextDate");
    }
    const match = DATE_PATTERN.exec(value);
    if (!match) fail("RESOLUTION_DATE_INVALID", "$.contextDate");

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
        fail("RESOLUTION_DATE_INVALID", "$.contextDate");
    }
    return value;
}

function normalizeInput(value) {
    assertExactInput(value);
    return Object.freeze({
        facilityId: normalizeId(value.facilityId, "$.facilityId"),
        programId: normalizeId(value.programId, "$.programId"),
        templateId: normalizeId(value.templateId, "$.templateId"),
        audienceKey: normalizeAudienceKey(value.audienceKey),
        contextDate: normalizeDate(value.contextDate)
    });
}

function rowsFrom(result) {
    if (!result || !Array.isArray(result.rows)) {
        fail("DATABASE_RESULT_INVALID", "$.database.resolution");
    }
    return result.rows;
}

function requireInteger(value, path) {
    if (!Number.isSafeInteger(value)) fail("DATABASE_TYPE_DRIFT", path);
    return value;
}

function requireNullableInteger(value, path) {
    return value === null ? null : requireInteger(value, path);
}

function requireString(value, path) {
    if (typeof value !== "string") fail("DATABASE_TYPE_DRIFT", path);
    return value;
}

function requireNullableString(value, path) {
    return value === null ? null : requireString(value, path);
}

function requireBoolean(value, path) {
    if (typeof value !== "boolean") fail("DATABASE_TYPE_DRIFT", path);
    return value;
}

function assertCapability(rows) {
    if (rows.length === 0) {
        fail("SCHEMA_CAPABILITY_UNSUPPORTED", "$.database.capability");
    }
    const row = rows[0];
    if (
        requireInteger(row.schema_version, "$.database.capability.schemaVersion") !== 9 ||
        requireBoolean(row.is_available, "$.database.capability.isAvailable") !== false ||
        row.verified_at !== null ||
        requireString(row.migration_key, "$.database.capability.migrationKey") !==
            "0012_catalog_publication_applicability"
    ) {
        fail("SCHEMA_CAPABILITY_UNSUPPORTED", "$.database.capability");
    }
    for (let index = 1; index < rows.length; index += 1) {
        const candidate = rows[index];
        if (
            candidate.schema_version !== row.schema_version ||
            candidate.is_available !== row.is_available ||
            candidate.verified_at !== row.verified_at ||
            candidate.migration_key !== row.migration_key
        ) {
            fail("DATABASE_RESULT_INVALID", "$.database.capability");
        }
    }
}

function normalizeCapabilities(value) {
    if (!Array.isArray(value)) {
        fail("DATABASE_TYPE_DRIFT", "$.database.catalog.requiredCapabilities");
    }
    const keys = Object.keys(value);
    if (
        keys.length !== value.length ||
        keys.some((key, index) => key !== String(index))
    ) {
        fail("DATABASE_TYPE_DRIFT", "$.database.catalog.requiredCapabilities");
    }
    const normalized = value.map((capability, index) =>
        requireString(
            capability,
            `$.database.catalog.requiredCapabilities[${index}]`
        )
    );
    if (
        new Set(normalized).size !== normalized.length ||
        normalized.some((capability, index) =>
            index > 0 && normalized[index - 1] >= capability
        )
    ) {
        fail(
            "CATALOG_CAPABILITIES_NOT_CANONICAL",
            "$.database.catalog.requiredCapabilities"
        );
    }
    if (normalized.some(capability => !ENGINE_CAPABILITIES.has(capability))) {
        fail(
            "CATALOG_CAPABILITY_UNSUPPORTED",
            "$.database.catalog.requiredCapabilities"
        );
    }
    return Object.freeze(normalized);
}

function assertInputLineage(row, input) {
    const assignmentId = requireInteger(
        row.assignment_id,
        "$.database.lineage.assignmentId"
    );
    const applicabilityId = requireInteger(
        row.applicability_id,
        "$.database.lineage.applicabilityId"
    );
    if (
        requireInteger(row.facility_id, "$.database.lineage.facilityId") !==
            input.facilityId ||
        requireInteger(row.program_id, "$.database.lineage.programId") !==
            input.programId ||
        requireInteger(row.template_id, "$.database.lineage.templateId") !==
            input.templateId ||
        requireString(row.audience_key, "$.database.lineage.audienceKey") !==
            input.audienceKey
    ) {
        fail("CATALOG_LINEAGE_INVALID", "$.database.lineage");
    }
    const selectionMode = requireString(
        row.selection_mode,
        "$.database.lineage.selectionMode"
    );
    const exactVersionId = requireNullableInteger(
        row.exact_version_id,
        "$.database.lineage.exactVersionId"
    );
    const publicationId = requireNullableInteger(
        row.publication_id,
        "$.database.lineage.publicationId"
    );
    const publicationVersionId = requireNullableInteger(
        row.publication_version_id,
        "$.database.lineage.publicationVersionId"
    );
    const versionId = requireInteger(
        row.version_id,
        "$.database.lineage.versionId"
    );

    const exactSelection =
        selectionMode === "exact_version" &&
        exactVersionId === versionId &&
        publicationId === null &&
        publicationVersionId === null &&
        row.publication_is_current === null;
    const publicationSelection =
        selectionMode === "publication" &&
        exactVersionId === null &&
        publicationId !== null &&
        publicationVersionId === versionId &&
        typeof row.publication_is_current === "boolean";
    if (!exactSelection && !publicationSelection) {
        fail("CATALOG_LINEAGE_INVALID", "$.database.lineage");
    }

    return Object.freeze({
        assignmentId,
        applicabilityId,
        selectionMode,
        exactVersionId,
        publicationId,
        publicationIsCurrent:
            selectionMode === "publication" ? row.publication_is_current : null,
        versionId,
        facilityId: input.facilityId,
        programId: input.programId,
        templateId: input.templateId,
        audienceKey: input.audienceKey
    });
}

function normalizeCatalog(row, lineage, input) {
    const versionNumber = requireInteger(
        row.version_number,
        "$.database.catalog.versionNumber"
    );
    if (versionNumber < 1) {
        fail("CATALOG_LINEAGE_INVALID", "$.database.catalog.versionNumber");
    }
    if (
        requireString(row.currency_code, "$.database.catalog.currencyCode") !==
            "USD" ||
        requireInteger(
            row.currency_exponent,
            "$.database.catalog.currencyExponent"
        ) !== 2 ||
        requireString(
            row.calculation_contract_version,
            "$.database.catalog.calculationContractVersion"
        ) !== "storecalc.calculation.v1" ||
        requireString(
            row.content_schema_version,
            "$.database.catalog.contentSchemaVersion"
        ) !== "storecalc.catalog-content.v1" ||
        requireString(
            row.canonicalization_version,
            "$.database.catalog.canonicalizationVersion"
        ) !== "storecalc.canonical-json.v1" ||
        requireString(row.hash_algorithm, "$.database.catalog.hashAlgorithm") !==
            "sha256"
    ) {
        fail("CATALOG_CONTRACT_UNSUPPORTED", "$.database.catalog");
    }
    const contentHash = requireString(
        row.content_hash,
        "$.database.catalog.contentHash"
    );
    if (!HASH_PATTERN.test(contentHash)) {
        fail("DATABASE_TYPE_DRIFT", "$.database.catalog.contentHash");
    }
    const sourceEffectiveDate = requireNullableString(
        row.source_effective_date,
        "$.database.catalog.sourceEffectiveDate"
    );
    if (sourceEffectiveDate !== null && sourceEffectiveDate > input.contextDate) {
        fail("CATALOG_NOT_YET_EFFECTIVE", "$.database.catalog.sourceEffectiveDate");
    }

    return Object.freeze({
        versionId: lineage.versionId,
        versionNumber,
        currencyCode: "USD",
        currencyExponent: 2,
        sourceEffectiveDate,
        sourcePublishedDate: requireNullableString(
            row.source_published_date,
            "$.database.catalog.sourcePublishedDate"
        ),
        calculationContractVersion: "storecalc.calculation.v1",
        requiredCapabilities: normalizeCapabilities(row.required_capabilities),
        contentSchemaVersion: "storecalc.catalog-content.v1",
        canonicalizationVersion: "storecalc.canonical-json.v1",
        hashAlgorithm: "sha256",
        contentHash
    });
}

function normalizeInterval(row, prefix, path) {
    return Object.freeze({
        validFrom: requireNullableString(row[`${prefix}_valid_from`], `${path}.validFrom`),
        validThrough: requireNullableString(
            row[`${prefix}_valid_through`],
            `${path}.validThrough`
        )
    });
}

function unavailable(input) {
    return Object.freeze({
        state: "unavailable",
        resolverVersion: CATALOG_RESOLVER_VERSION,
        context: input
    });
}

function resolved(row, input) {
    const lineage = assertInputLineage(row, input);
    const catalog = normalizeCatalog(row, lineage, input);
    return Object.freeze({
        state: "resolved",
        resolverVersion: CATALOG_RESOLVER_VERSION,
        context: input,
        assignmentInterval: normalizeInterval(
            row,
            "assignment",
            "$.database.assignmentInterval"
        ),
        applicabilityInterval: normalizeInterval(
            row,
            "applicability",
            "$.database.applicabilityInterval"
        ),
        lineage,
        catalog
    });
}

export async function resolvePublicCatalogVersion(pool, value) {
    assertDatabasePool(pool);
    const input = normalizeInput(value);

    const result = await pool.query(RESOLVE_SQL, [
        input.facilityId,
        input.programId,
        input.templateId,
        input.audienceKey,
        input.contextDate
    ]);

    const rows = rowsFrom(result);
    assertCapability(rows);
    const candidates = rows.filter(row => row.applicability_id !== null);
    if (candidates.length === 0) return unavailable(input);
    if (candidates.length !== 1) {
        fail("CATALOG_RESOLUTION_AMBIGUOUS", "$.database.resolution");
    }
    return resolved(candidates[0], input);
}
