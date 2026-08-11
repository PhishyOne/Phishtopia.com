import {
    CATALOG_CONTENT_BOUNDS,
    sealCatalogVersionContent,
    StoreCalcCatalogContentError
} from "./content.js";
import { HASH_ALGORITHM } from "../calculation/core.js";

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const COUNT_PATTERN = /^(?:0|[1-9][0-9]*)$/;

const BEGIN_SQL = "BEGIN ISOLATION LEVEL REPEATABLE READ";
const TIMEOUTS_SQL = `
    /* storecalc:catalog-seal:timeouts */
    SELECT
        set_config('lock_timeout', '3s', true),
        set_config('statement_timeout', '30s', true),
        set_config('idle_in_transaction_session_timeout', '30s', true)
`;
const MIGRATION_LOCK_SQL = `
    /* storecalc:catalog-seal:migration-lock */
    SELECT pg_advisory_xact_lock_shared(7356507374803211041)
`;
const LOCK_SQL = `
    /* storecalc:catalog-seal:lock */
    LOCK TABLE storecalc.template_versions IN SHARE ROW EXCLUSIVE MODE
`;
const CAPABILITY_SQL = `
    /* storecalc:catalog-seal:capability */
    SELECT schema_version, is_available, verified_at, migration_key
    FROM storecalc.schema_capabilities
    WHERE capability_key = 'anonymous.calculation'
    FOR SHARE
`;
const HEADER_SQL = `
    /* storecalc:catalog-seal:header */
    SELECT
        version_row.id,
        version_row.template_id,
        version_row.content_state,
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
        version_row.sealed_at,
        template_row.status AS template_status
    FROM storecalc.template_versions AS version_row
    JOIN storecalc.templates AS template_row
      ON template_row.id = version_row.template_id
    WHERE version_row.id = $1
    FOR UPDATE OF version_row
`;
const COUNTS_SQL = `
    /* storecalc:catalog-seal:counts */
    SELECT
        (
            SELECT count(*)::text
            FROM storecalc.version_categories
            WHERE version_id = $1
        ) AS category_count,
        (
            SELECT count(*)::text
            FROM storecalc.version_items
            WHERE version_id = $1
        ) AS item_count,
        (
            SELECT count(*)::text
            FROM storecalc.version_spending_buckets
            WHERE version_id = $1
        ) AS bucket_count,
        (
            SELECT count(*)::text
            FROM storecalc.version_item_bucket_memberships
            WHERE version_id = $1
        ) AS membership_count,
        (
            SELECT count(*)::text
            FROM storecalc.version_tax_rules
            WHERE version_id = $1
        ) AS tax_rule_count,
        (
            SELECT count(*)::text
            FROM storecalc.version_constraints
            WHERE version_id = $1
        ) AS constraint_count,
        (
            SELECT count(*)::text
            FROM storecalc.version_warnings
            WHERE version_id = $1
        ) AS warning_count,
        (
            SELECT count(*)::text
            FROM storecalc.version_source_evidence
            WHERE version_id = $1
        ) AS source_evidence_count
`;
const CATEGORIES_SQL = `
    /* storecalc:catalog-seal:categories */
    SELECT
        version_category.template_id,
        version_category.category_id,
        category_identity.stable_key AS category_key,
        version_category.display_name,
        version_category.description,
        version_category.sort_order,
        version_category.active
    FROM storecalc.version_categories AS version_category
    LEFT JOIN storecalc.template_categories AS category_identity
      ON category_identity.id = version_category.category_id
     AND category_identity.template_id = version_category.template_id
    WHERE version_category.version_id = $1
    ORDER BY version_category.id
`;
const ITEMS_SQL = `
    /* storecalc:catalog-seal:items */
    SELECT
        version_item.template_id,
        version_item.item_id,
        item_identity.stable_key AS item_key,
        version_item.category_version_id,
        category_identity.stable_key AS category_key,
        version_item.sku,
        version_item.display_name,
        version_item.description,
        version_item.unit_label,
        version_item.price_state,
        version_item.price_minor::text AS price_minor,
        version_item.minimum_selected_quantity::text
            AS minimum_selected_quantity,
        version_item.maximum_order_quantity::text
            AS maximum_order_quantity,
        version_item.quantity_step::text AS quantity_step,
        version_item.availability_state,
        version_item.sort_order
    FROM storecalc.version_items AS version_item
    LEFT JOIN storecalc.template_items AS item_identity
      ON item_identity.id = version_item.item_id
     AND item_identity.template_id = version_item.template_id
    LEFT JOIN storecalc.version_categories AS category_version
      ON category_version.id = version_item.category_version_id
     AND category_version.version_id = version_item.version_id
    LEFT JOIN storecalc.template_categories AS category_identity
      ON category_identity.id = category_version.category_id
     AND category_identity.template_id = version_item.template_id
    WHERE version_item.version_id = $1
    ORDER BY version_item.id
`;
const BUCKETS_SQL = `
    /* storecalc:catalog-seal:buckets */
    SELECT
        stable_key AS bucket_key,
        display_name,
        limit_state,
        limit_minor::text AS limit_minor,
        measure_currency_code,
        is_primary_display,
        sort_order
    FROM storecalc.version_spending_buckets
    WHERE version_id = $1
    ORDER BY id
`;
const MEMBERSHIPS_SQL = `
    /* storecalc:catalog-seal:memberships */
    SELECT
        item_identity.stable_key AS item_key,
        bucket.stable_key AS bucket_key,
        membership.membership_type,
        membership.primary_display
    FROM storecalc.version_item_bucket_memberships AS membership
    LEFT JOIN storecalc.version_items AS version_item
      ON version_item.id = membership.version_item_id
     AND version_item.version_id = membership.version_id
    LEFT JOIN storecalc.template_items AS item_identity
      ON item_identity.id = version_item.item_id
     AND item_identity.template_id = version_item.template_id
    LEFT JOIN storecalc.version_spending_buckets AS bucket
      ON bucket.id = membership.spending_bucket_id
     AND bucket.version_id = membership.version_id
    WHERE membership.version_id = $1
    ORDER BY membership.version_item_id, membership.spending_bucket_id
`;
const TAX_RULES_SQL = `
    /* storecalc:catalog-seal:tax-rules */
    SELECT
        tax_rule.scope_type,
        tax_rule.category_version_id,
        category_identity.stable_key AS category_key,
        tax_rule.item_version_id,
        item_identity.stable_key AS item_key,
        tax_rule.treatment_state,
        tax_rule.rate_ppm::text AS rate_ppm,
        tax_rule.price_includes_tax,
        tax_rule.rounding_mode,
        tax_rule.rounding_scope,
        tax_rule.priority
    FROM storecalc.version_tax_rules AS tax_rule
    LEFT JOIN storecalc.version_categories AS category_version
      ON category_version.id = tax_rule.category_version_id
     AND category_version.version_id = tax_rule.version_id
    LEFT JOIN storecalc.template_categories AS category_identity
      ON category_identity.id = category_version.category_id
     AND category_identity.template_id = category_version.template_id
    LEFT JOIN storecalc.version_items AS version_item
      ON version_item.id = tax_rule.item_version_id
     AND version_item.version_id = tax_rule.version_id
    LEFT JOIN storecalc.template_items AS item_identity
      ON item_identity.id = version_item.item_id
     AND item_identity.template_id = version_item.template_id
    WHERE tax_rule.version_id = $1
    ORDER BY tax_rule.id
`;
const CONSTRAINTS_SQL = `
    /* storecalc:catalog-seal:constraints */
    SELECT
        stable_key AS constraint_key,
        display_name,
        constraint_type,
        measure_type,
        comparator,
        value_state,
        limit_value::text AS limit_value,
        unit_code,
        scope_type,
        composition_behavior,
        priority
    FROM storecalc.version_constraints
    WHERE version_id = $1
    ORDER BY id
`;
const WARNINGS_SQL = `
    /* storecalc:catalog-seal:warnings */
    SELECT
        warning.warning_code,
        warning.severity,
        warning.scope_type,
        warning.category_version_id,
        warning.item_version_id,
        item_identity.stable_key AS item_key,
        warning.message_key,
        warning.bounded_details::text AS bounded_details_text
    FROM storecalc.version_warnings AS warning
    LEFT JOIN storecalc.version_items AS version_item
      ON version_item.id = warning.item_version_id
     AND version_item.version_id = warning.version_id
    LEFT JOIN storecalc.template_items AS item_identity
      ON item_identity.id = version_item.item_id
     AND item_identity.template_id = version_item.template_id
    WHERE warning.version_id = $1
    ORDER BY warning.id
`;
const SOURCE_EVIDENCE_SQL = `
    /* storecalc:catalog-seal:source-evidence */
    SELECT
        relationship.evidence_id,
        evidence.normalized_fingerprint AS evidence_fingerprint,
        relationship.relationship_type,
        relationship.source_group_id,
        source_group.canonical_fingerprint AS source_group_fingerprint,
        evidence.privacy_state,
        evidence.redistribution_state,
        evidence.withdrawn_at,
        source_group.grouping_type,
        source_group.independence_state,
        source_group.superseded_at
    FROM storecalc.version_source_evidence AS relationship
    LEFT JOIN storecalc.evidence AS evidence
      ON evidence.id = relationship.evidence_id
    LEFT JOIN storecalc.evidence_groups AS source_group
      ON source_group.id = relationship.source_group_id
    WHERE relationship.version_id = $1
    ORDER BY relationship.evidence_id
`;
const SEAL_SQL = `
    /* storecalc:catalog-seal:update */
    UPDATE storecalc.template_versions
    SET content_state = 'sealed',
        hash_algorithm = $2,
        content_hash = $3,
        sealed_at = transaction_timestamp()
    WHERE id = $1
      AND content_state = 'draft'
      AND hash_algorithm IS NULL
      AND content_hash IS NULL
      AND sealed_at IS NULL
    RETURNING id, template_id, content_state, hash_algorithm, content_hash
`;

export class StoreCalcCatalogSealingError extends Error {
    constructor(code, path = "$", options = undefined) {
        super(code, options);
        this.name = "StoreCalcCatalogSealingError";
        this.code = code;
        this.path = path;
    }
}

function fail(code, path = "$", cause = undefined) {
    const options = cause === undefined ? undefined : { cause };
    throw new StoreCalcCatalogSealingError(code, path, options);
}

function assertDatabasePool(pool) {
    if (!pool || typeof pool !== "object" || typeof pool.connect !== "function") {
        fail("DATABASE_POOL_INVALID", "$.database");
    }
}

function assertVersionId(versionId) {
    if (
        !Number.isSafeInteger(versionId) ||
        versionId < 1 ||
        versionId > MAX_POSTGRES_INTEGER
    ) {
        fail("VERSION_ID_INVALID", "$.versionId");
    }
}

function rowsFrom(result, path) {
    if (!result || !Array.isArray(result.rows)) {
        fail("DATABASE_RESULT_INVALID", path);
    }
    return result.rows;
}

function oneRow(result, path) {
    const rows = rowsFrom(result, path);
    if (rows.length !== 1) fail("DATABASE_RESULT_INVALID", path);
    return rows[0];
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

function requireNullableBoolean(value, path) {
    return value === null ? null : requireBoolean(value, path);
}

function requireTextInteger(value, path) {
    const normalized = requireString(value, path);
    if (!COUNT_PATTERN.test(normalized)) fail("DATABASE_TYPE_DRIFT", path);
    return normalized;
}

function requireNullableTextInteger(value, path) {
    return value === null ? null : requireTextInteger(value, path);
}

function parseCount(value, maximum, path, { minimum = 0 } = {}) {
    const normalized = requireTextInteger(value, path);
    if (normalized.length > String(maximum).length) {
        fail("CATALOG_COUNT_BOUND_EXCEEDED", path);
    }
    const count = BigInt(normalized);
    if (count < BigInt(minimum)) fail("CATALOG_REQUIRED_CONTENT_MISSING", path);
    if (count > BigInt(maximum)) fail("CATALOG_COUNT_BOUND_EXCEEDED", path);
    return Number(count);
}

function assertRowCount(rows, expected, path) {
    if (rows.length !== expected) fail("CATALOG_ROW_COUNT_DRIFT", path);
}

function normalizeHeader(row, versionId) {
    const id = requireInteger(row.id, "$.database.header.id");
    if (id !== versionId) fail("VERSION_ID_DRIFT", "$.database.header.id");

    const templateId = requireInteger(
        row.template_id,
        "$.database.header.templateId"
    );
    const contentState = requireString(
        row.content_state,
        "$.database.header.contentState"
    );
    if (contentState !== "draft") fail("VERSION_NOT_DRAFT", "$.versionId");
    if (
        row.hash_algorithm !== null ||
        row.content_hash !== null ||
        row.sealed_at !== null
    ) {
        fail("VERSION_DRAFT_HASH_STATE_INVALID", "$.database.header");
    }
    const templateStatus = requireString(
        row.template_status,
        "$.database.header.templateStatus"
    );
    if (!new Set(["draft", "active"]).has(templateStatus)) {
        fail("TEMPLATE_NOT_SEALABLE", "$.database.header.templateStatus");
    }
    if (!Array.isArray(row.required_capabilities)) {
        fail("DATABASE_TYPE_DRIFT", "$.database.header.requiredCapabilities");
    }
    const capabilityKeys = Object.keys(row.required_capabilities);
    if (
        capabilityKeys.length !== row.required_capabilities.length ||
        capabilityKeys.some((key, index) => key !== String(index))
    ) {
        fail("DATABASE_TYPE_DRIFT", "$.database.header.requiredCapabilities");
    }
    const requiredCapabilities = row.required_capabilities.map(
        (capability, index) =>
            requireString(
                capability,
                `$.database.header.requiredCapabilities[${index}]`
            )
    );
    const canonicalCapabilities = [...requiredCapabilities].sort();
    if (
        new Set(requiredCapabilities).size !== requiredCapabilities.length ||
        canonicalCapabilities.some(
            (capability, index) => capability !== requiredCapabilities[index]
        )
    ) {
        fail(
            "VERSION_CAPABILITIES_NOT_CANONICAL",
            "$.database.header.requiredCapabilities"
        );
    }

    return {
        id,
        templateId,
        contentSchemaVersion: requireString(
            row.content_schema_version,
            "$.database.header.contentSchemaVersion"
        ),
        canonicalizationVersion: requireString(
            row.canonicalization_version,
            "$.database.header.canonicalizationVersion"
        ),
        calculationContractVersion: requireString(
            row.calculation_contract_version,
            "$.database.header.calculationContractVersion"
        ),
        currencyCode: requireString(
            row.currency_code,
            "$.database.header.currencyCode"
        ),
        currencyExponent: requireInteger(
            row.currency_exponent,
            "$.database.header.currencyExponent"
        ),
        sourceEffectiveDate: requireNullableString(
            row.source_effective_date,
            "$.database.header.sourceEffectiveDate"
        ),
        sourcePublishedDate: requireNullableString(
            row.source_published_date,
            "$.database.header.sourcePublishedDate"
        ),
        requiredCapabilities
    };
}

function assertSchemaCapability(result) {
    const rows = rowsFrom(result, "$.database.capability");
    if (rows.length !== 1) {
        fail("SCHEMA_CAPABILITY_UNSUPPORTED", "$.database.capability");
    }
    const row = rows[0];
    if (
        requireInteger(
            row.schema_version,
            "$.database.capability.schemaVersion"
        ) !== 8 ||
        requireBoolean(
            row.is_available,
            "$.database.capability.isAvailable"
        ) !== false ||
        row.verified_at !== null ||
        requireString(
            row.migration_key,
            "$.database.capability.migrationKey"
        ) !== "0011_source_evidence"
    ) {
        fail("SCHEMA_CAPABILITY_UNSUPPORTED", "$.database.capability");
    }
}

function normalizeCounts(row) {
    return {
        categories: parseCount(
            row.category_count,
            CATALOG_CONTENT_BOUNDS.maxCategories,
            "$.database.counts.categories"
        ),
        items: parseCount(
            row.item_count,
            CATALOG_CONTENT_BOUNDS.maxItems,
            "$.database.counts.items",
            { minimum: 1 }
        ),
        spendingBuckets: parseCount(
            row.bucket_count,
            CATALOG_CONTENT_BOUNDS.maxBuckets,
            "$.database.counts.spendingBuckets"
        ),
        bucketMemberships: parseCount(
            row.membership_count,
            CATALOG_CONTENT_BOUNDS.maxBucketMemberships,
            "$.database.counts.bucketMemberships"
        ),
        taxRules: parseCount(
            row.tax_rule_count,
            CATALOG_CONTENT_BOUNDS.maxTaxRules,
            "$.database.counts.taxRules"
        ),
        constraints: parseCount(
            row.constraint_count,
            CATALOG_CONTENT_BOUNDS.maxConstraints,
            "$.database.counts.constraints"
        ),
        warnings: parseCount(
            row.warning_count,
            CATALOG_CONTENT_BOUNDS.maxWarnings,
            "$.database.counts.warnings"
        ),
        sourceEvidence: parseCount(
            row.source_evidence_count,
            CATALOG_CONTENT_BOUNDS.maxSourceEvidence,
            "$.database.counts.sourceEvidence",
            { minimum: 1 }
        )
    };
}

function normalizeCategories(rows, header) {
    return rows.map((row, index) => {
        const path = `$.database.categories[${index}]`;
        if (requireInteger(row.template_id, `${path}.templateId`) !== header.templateId) {
            fail("CATALOG_LINEAGE_INVALID", `${path}.templateId`);
        }
        requireInteger(row.category_id, `${path}.categoryId`);
        return {
            categoryKey: requireString(row.category_key, `${path}.categoryKey`),
            displayName: requireString(row.display_name, `${path}.displayName`),
            description: requireNullableString(
                row.description,
                `${path}.description`
            ),
            sortOrder: requireInteger(row.sort_order, `${path}.sortOrder`),
            active: requireBoolean(row.active, `${path}.active`)
        };
    });
}

function normalizeItems(rows, header) {
    return rows.map((row, index) => {
        const path = `$.database.items[${index}]`;
        if (requireInteger(row.template_id, `${path}.templateId`) !== header.templateId) {
            fail("CATALOG_LINEAGE_INVALID", `${path}.templateId`);
        }
        requireInteger(row.item_id, `${path}.itemId`);
        const categoryVersionId = requireNullableInteger(
            row.category_version_id,
            `${path}.categoryVersionId`
        );
        const categoryKey = requireNullableString(
            row.category_key,
            `${path}.categoryKey`
        );
        if ((categoryVersionId === null) !== (categoryKey === null)) {
            fail("CATALOG_LINEAGE_INVALID", `${path}.categoryKey`);
        }
        return {
            itemKey: requireString(row.item_key, `${path}.itemKey`),
            categoryKey,
            sku: requireNullableString(row.sku, `${path}.sku`),
            displayName: requireString(row.display_name, `${path}.displayName`),
            description: requireNullableString(
                row.description,
                `${path}.description`
            ),
            unitLabel: requireNullableString(row.unit_label, `${path}.unitLabel`),
            priceState: requireString(row.price_state, `${path}.priceState`),
            priceMinor: requireNullableTextInteger(
                row.price_minor,
                `${path}.priceMinor`
            ),
            minimumSelectedQuantity: requireTextInteger(
                row.minimum_selected_quantity,
                `${path}.minimumSelectedQuantity`
            ),
            maximumOrderQuantity: requireTextInteger(
                row.maximum_order_quantity,
                `${path}.maximumOrderQuantity`
            ),
            quantityStep: requireTextInteger(
                row.quantity_step,
                `${path}.quantityStep`
            ),
            availabilityState: requireString(
                row.availability_state,
                `${path}.availabilityState`
            ),
            sortOrder: requireInteger(row.sort_order, `${path}.sortOrder`)
        };
    });
}

function normalizeBuckets(rows) {
    return rows.map((row, index) => {
        const path = `$.database.spendingBuckets[${index}]`;
        return {
            bucketKey: requireString(row.bucket_key, `${path}.bucketKey`),
            displayName: requireString(row.display_name, `${path}.displayName`),
            limitState: requireString(row.limit_state, `${path}.limitState`),
            limitMinor: requireNullableTextInteger(
                row.limit_minor,
                `${path}.limitMinor`
            ),
            measureCurrencyCode: requireString(
                row.measure_currency_code,
                `${path}.measureCurrencyCode`
            ),
            isPrimaryDisplay: requireBoolean(
                row.is_primary_display,
                `${path}.isPrimaryDisplay`
            ),
            sortOrder: requireInteger(row.sort_order, `${path}.sortOrder`)
        };
    });
}

function normalizeMemberships(rows) {
    return rows.map((row, index) => {
        const path = `$.database.bucketMemberships[${index}]`;
        return {
            itemKey: requireString(row.item_key, `${path}.itemKey`),
            bucketKey: requireString(row.bucket_key, `${path}.bucketKey`),
            membershipType: requireString(
                row.membership_type,
                `${path}.membershipType`
            ),
            primaryDisplay: requireBoolean(
                row.primary_display,
                `${path}.primaryDisplay`
            )
        };
    });
}

function normalizeTaxRules(rows) {
    return rows.map((row, index) => {
        const path = `$.database.taxRules[${index}]`;
        const scopeType = requireString(row.scope_type, `${path}.scopeType`);
        const categoryVersionId = requireNullableInteger(
            row.category_version_id,
            `${path}.categoryVersionId`
        );
        const categoryKey = requireNullableString(
            row.category_key,
            `${path}.categoryKey`
        );
        const itemVersionId = requireNullableInteger(
            row.item_version_id,
            `${path}.itemVersionId`
        );
        const itemKey = requireNullableString(row.item_key, `${path}.itemKey`);
        const validTarget =
            (scopeType === "template" &&
                categoryVersionId === null &&
                categoryKey === null &&
                itemVersionId === null &&
                itemKey === null) ||
            (scopeType === "category" &&
                categoryVersionId !== null &&
                categoryKey !== null &&
                itemVersionId === null &&
                itemKey === null) ||
            (scopeType === "item" &&
                categoryVersionId === null &&
                categoryKey === null &&
                itemVersionId !== null &&
                itemKey !== null);
        if (!validTarget) fail("CATALOG_LINEAGE_INVALID", path);
        return {
            scopeType,
            categoryKey,
            itemKey,
            treatmentState: requireString(
                row.treatment_state,
                `${path}.treatmentState`
            ),
            ratePpm: requireNullableTextInteger(row.rate_ppm, `${path}.ratePpm`),
            priceIncludesTax: requireNullableBoolean(
                row.price_includes_tax,
                `${path}.priceIncludesTax`
            ),
            roundingMode: requireNullableString(
                row.rounding_mode,
                `${path}.roundingMode`
            ),
            roundingScope: requireNullableString(
                row.rounding_scope,
                `${path}.roundingScope`
            ),
            priority: requireInteger(row.priority, `${path}.priority`)
        };
    });
}

function normalizeConstraints(rows) {
    return rows.map((row, index) => {
        const path = `$.database.constraints[${index}]`;
        return {
            constraintKey: requireString(
                row.constraint_key,
                `${path}.constraintKey`
            ),
            displayName: requireString(row.display_name, `${path}.displayName`),
            constraintType: requireString(
                row.constraint_type,
                `${path}.constraintType`
            ),
            measureType: requireString(row.measure_type, `${path}.measureType`),
            comparator: requireString(row.comparator, `${path}.comparator`),
            valueState: requireString(row.value_state, `${path}.valueState`),
            limitValue: requireNullableTextInteger(
                row.limit_value,
                `${path}.limitValue`
            ),
            unitCode: requireString(row.unit_code, `${path}.unitCode`),
            scopeType: requireString(row.scope_type, `${path}.scopeType`),
            compositionBehavior: requireString(
                row.composition_behavior,
                `${path}.compositionBehavior`
            ),
            priority: requireInteger(row.priority, `${path}.priority`)
        };
    });
}

function normalizeWarnings(rows) {
    return rows.map((row, index) => {
        const path = `$.database.warnings[${index}]`;
        const scopeType = requireString(row.scope_type, `${path}.scopeType`);
        const categoryVersionId = requireNullableInteger(
            row.category_version_id,
            `${path}.categoryVersionId`
        );
        const itemVersionId = requireNullableInteger(
            row.item_version_id,
            `${path}.itemVersionId`
        );
        const itemKey = requireNullableString(row.item_key, `${path}.itemKey`);
        if (
            categoryVersionId !== null ||
            (scopeType === "template" &&
                (itemVersionId !== null || itemKey !== null)) ||
            (scopeType === "item" &&
                (itemVersionId === null || itemKey === null))
        ) {
            fail("CATALOG_LINEAGE_INVALID", path);
        }
        if (requireString(row.bounded_details_text, `${path}.boundedDetails`) !== "{}") {
            fail("CATALOG_CONTENT_UNSUPPORTED", `${path}.boundedDetails`);
        }
        return {
            warningCode: requireString(row.warning_code, `${path}.warningCode`),
            severity: requireString(row.severity, `${path}.severity`),
            scopeType,
            categoryKey: null,
            itemKey,
            messageKey: requireString(row.message_key, `${path}.messageKey`),
            boundedDetails: {}
        };
    });
}

function normalizeSourceEvidence(rows) {
    return rows.map((row, index) => {
        const path = `$.database.sourceEvidence[${index}]`;
        requireInteger(row.evidence_id, `${path}.evidenceId`);
        requireInteger(row.source_group_id, `${path}.sourceGroupId`);
        const eligible =
            row.privacy_state === "metadata_safe" &&
            row.redistribution_state === "metadata_only" &&
            row.withdrawn_at === null &&
            row.grouping_type === "source_lineage" &&
            row.independence_state === "accepted" &&
            row.superseded_at === null;
        if (!eligible) fail("SOURCE_EVIDENCE_INELIGIBLE", path);
        return {
            evidenceFingerprint: requireString(
                row.evidence_fingerprint,
                `${path}.evidenceFingerprint`
            ),
            relationshipType: requireString(
                row.relationship_type,
                `${path}.relationshipType`
            ),
            sourceGroupFingerprint: requireString(
                row.source_group_fingerprint,
                `${path}.sourceGroupFingerprint`
            )
        };
    });
}

async function queryCatalogRows(client, versionId, counts, header) {
    const queries = [
        ["categories", CATEGORIES_SQL],
        ["items", ITEMS_SQL],
        ["spendingBuckets", BUCKETS_SQL],
        ["bucketMemberships", MEMBERSHIPS_SQL],
        ["taxRules", TAX_RULES_SQL],
        ["constraints", CONSTRAINTS_SQL],
        ["warnings", WARNINGS_SQL],
        ["sourceEvidence", SOURCE_EVIDENCE_SQL]
    ];
    const rows = {};
    for (const [path, sql] of queries) {
        const values = rowsFrom(
            await client.query(sql, [versionId]),
            `$.database.${path}`
        );
        assertRowCount(values, counts[path], `$.database.${path}`);
        rows[path] = values;
    }

    return {
        contentSchemaVersion: header.contentSchemaVersion,
        canonicalizationVersion: header.canonicalizationVersion,
        calculationContractVersion: header.calculationContractVersion,
        hashAlgorithm: HASH_ALGORITHM,
        currencyCode: header.currencyCode,
        currencyExponent: header.currencyExponent,
        sourceEffectiveDate: header.sourceEffectiveDate,
        sourcePublishedDate: header.sourcePublishedDate,
        requiredCapabilities: header.requiredCapabilities,
        categories: normalizeCategories(rows.categories, header),
        items: normalizeItems(rows.items, header),
        spendingBuckets: normalizeBuckets(rows.spendingBuckets),
        bucketMemberships: normalizeMemberships(rows.bucketMemberships),
        taxRules: normalizeTaxRules(rows.taxRules),
        constraints: normalizeConstraints(rows.constraints),
        warnings: normalizeWarnings(rows.warnings),
        sourceEvidence: normalizeSourceEvidence(rows.sourceEvidence)
    };
}

function sealCanonicalContent(content) {
    try {
        return sealCatalogVersionContent(content);
    } catch (error) {
        if (error instanceof StoreCalcCatalogContentError) {
            fail("CATALOG_CONTENT_INVALID", error.path, error);
        }
        throw error;
    }
}

function assertSealResult(result, header, sealedCatalog) {
    const rows = rowsFrom(result, "$.database.seal");
    if (result.rowCount !== 1 || rows.length !== 1) {
        fail("SEAL_STATE_CHANGED", "$.database.seal");
    }
    const row = rows[0];
    if (
        requireInteger(row.id, "$.database.seal.id") !== header.id ||
        requireInteger(row.template_id, "$.database.seal.templateId") !==
            header.templateId ||
        row.content_state !== "sealed" ||
        row.hash_algorithm !== HASH_ALGORITHM ||
        row.content_hash !== sealedCatalog.contentHash
    ) {
        fail("SEAL_RESULT_INVALID", "$.database.seal");
    }
}

export async function sealCatalogVersion(pool, { versionId } = {}) {
    assertDatabasePool(pool);
    assertVersionId(versionId);

    const client = await pool.connect();
    if (
        !client ||
        typeof client.query !== "function" ||
        typeof client.release !== "function"
    ) {
        fail("DATABASE_CLIENT_INVALID", "$.database");
    }

    let transactionOpen = false;
    let destroyConnection = false;
    try {
        await client.query(BEGIN_SQL);
        transactionOpen = true;
        await client.query(TIMEOUTS_SQL);
        await client.query(MIGRATION_LOCK_SQL);
        await client.query(LOCK_SQL);
        assertSchemaCapability(await client.query(CAPABILITY_SQL));

        const headerRows = rowsFrom(
            await client.query(HEADER_SQL, [versionId]),
            "$.database.header"
        );
        if (headerRows.length === 0) fail("VERSION_NOT_FOUND", "$.versionId");
        if (headerRows.length !== 1) {
            fail("DATABASE_RESULT_INVALID", "$.database.header");
        }
        const header = normalizeHeader(headerRows[0], versionId);
        const counts = normalizeCounts(
            oneRow(
                await client.query(COUNTS_SQL, [versionId]),
                "$.database.counts"
            )
        );
        const content = await queryCatalogRows(
            client,
            versionId,
            counts,
            header
        );
        const sealedCatalog = sealCanonicalContent(content);
        const sealResult = await client.query(SEAL_SQL, [
            versionId,
            HASH_ALGORITHM,
            sealedCatalog.contentHash
        ]);
        assertSealResult(sealResult, header, sealedCatalog);

        await client.query("COMMIT");
        transactionOpen = false;
        return Object.freeze({
            versionId: header.id,
            templateId: header.templateId,
            contentHash: sealedCatalog.contentHash,
            catalog: sealedCatalog
        });
    } catch (error) {
        if (transactionOpen) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                destroyConnection = true;
                fail(
                    "TRANSACTION_ROLLBACK_FAILED",
                    "$.database",
                    new AggregateError([error, rollbackError])
                );
            }
        }
        throw error;
    } finally {
        client.release(
            destroyConnection
                ? new Error("storecalc_catalog_sealing_connection_uncertain")
                : undefined
        );
    }
}
