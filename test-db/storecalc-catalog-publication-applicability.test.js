import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

import {
  StoreCalcCatalogApplicabilityError,
  transitionCatalogApplicability,
} from "../src/storecalc/catalog/applicabilityService.js";
import {
  publishCatalogVersion,
  StoreCalcCatalogPublicationError,
} from "../src/storecalc/catalog/publicationService.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const migrationPath = (key) => path.join(ROOT, "migrations", "storecalc", key);
const DATABASE_NAME = "storecalc_migration_test";
const ROLE_SETTINGS = {
  migration_owner_role: "storecalc_test_migration",
  web_role: "storecalc_test_web",
  worker_role: "storecalc_test_worker",
  backup_role: "storecalc_test_backup",
};
const OUTSIDER_ROLE = "storecalc_test_outsider";
const ALL_TEST_ROLES = [...Object.values(ROLE_SETTINGS), OUTSIDER_ROLE];
const DIRECTORY_SEQUENCES = [
  "contributor_subjects_id_seq",
  "countries_id_seq",
  "jurisdictions_id_seq",
  "agencies_id_seq",
  "facilities_id_seq",
  "facility_aliases_id_seq",
  "facility_sources_id_seq",
];
const PROGRAM_SEQUENCES = [
  "store_programs_id_seq",
  "program_facility_assignments_id_seq",
];
const TEMPLATE_SEQUENCES = [
  "templates_id_seq",
  "template_categories_id_seq",
  "template_items_id_seq",
];

const readMigration = (key, file) =>
  readFileSync(path.join(migrationPath(key), file), "utf8");
const foundationUpSql = readMigration("0001_schema_foundation", "up.sql");
const foundationVerifySql = readMigration(
  "0001_schema_foundation",
  "verify.sql",
);
const foundationDownSql = readMigration("0001_schema_foundation", "down.sql");
const directoryUpSql = readMigration("0002_directory_lineage", "up.sql");
const directoryVerifySql = readMigration(
  "0002_directory_lineage",
  "verify.sql",
);
const directoryDownSql = readMigration("0002_directory_lineage", "down.sql");
const programUpSql = readMigration("0003_program_assignments", "up.sql");
const programVerifySql = readMigration(
  "0003_program_assignments",
  "verify.sql",
);
const programDownSql = readMigration("0003_program_assignments", "down.sql");
const templateUpSql = readMigration("0004_template_identity", "up.sql");
const templateVerifySql = readMigration("0004_template_identity", "verify.sql");
const templateDownSql = readMigration("0004_template_identity", "down.sql");

function quoteIdentifier(value) {
  assert.match(value, /^[a-z][a-z0-9_]*$/);
  return `"${value}"`;
}

function assertDisposableTarget() {
  assert.equal(
    process.env.STORECALC_DB_TEST_ALLOW,
    "1",
    "STORECALC_DB_TEST_ALLOW=1 is required",
  );
  const connectionString = process.env.STORECALC_TEST_DATABASE_URL;
  assert.ok(connectionString, "STORECALC_TEST_DATABASE_URL is required");
  const target = new URL(connectionString);
  assert.ok(
    ["127.0.0.1", "localhost", "::1"].includes(target.hostname),
    "database tests may target only loopback",
  );
  assert.equal(target.pathname, `/${DATABASE_NAME}`);
  return connectionString;
}

async function resetRole(client) {
  await client.query("ROLLBACK").catch(() => null);
  await client.query("RESET ROLE").catch(() => null);
}

async function configureRoles(client, overrides = {}) {
  const settings = { ...ROLE_SETTINGS, ...overrides };
  for (const [setting, value] of Object.entries(settings)) {
    await client.query("SELECT set_config($1, $2, false)", [
      `storecalc.${setting}`,
      value,
    ]);
  }
}

async function runAsRole(client, role, callback) {
  await client.query(`SET ROLE ${quoteIdentifier(role)}`);
  try {
    return await callback();
  } finally {
    await resetRole(client);
  }
}

async function runMigrationSql(client, sql, overrides = {}) {
  return runAsRole(client, ROLE_SETTINGS.migration_owner_role, async () => {
    await configureRoles(client, overrides);
    return client.query(sql);
  });
}

async function expectRejected(action, message, code) {
  await assert.rejects(action, (error) => {
    assert.equal(error.code, code);
    assert.match(error.message, new RegExp(message));
    return true;
  });
}

async function expectPermissionDenied(action) {
  await assert.rejects(action, (error) => {
    assert.equal(error.code, "42501");
    return true;
  });
}

async function schemaFingerprint(client) {
  const schemaResult = await client.query(`
        SELECT nspname, pg_get_userbyid(nspowner) AS owner, nspacl::text AS acl
        FROM pg_namespace
        WHERE nspname = 'storecalc'
    `);
  const relationResult = await client.query(`
        SELECT relname, relkind, pg_get_userbyid(relowner) AS owner, relacl::text AS acl
        FROM pg_class
        WHERE relnamespace = to_regnamespace('storecalc')
        ORDER BY relname
    `);
  const capabilityResult =
    Number(schemaResult.rowCount) > 0
      ? await client.query(`
            SELECT capability_key, schema_version, is_available, verified_at,
                   migration_key, updated_at
            FROM storecalc.schema_capabilities
            ORDER BY capability_key
        `)
      : { rows: [] };
  return {
    schema: schemaResult.rows,
    relations: relationResult.rows,
    capabilities: capabilityResult.rows,
  };
}

async function directoryShape(client) {
  const relationResult = await client.query(`
        SELECT relname, relkind, pg_get_userbyid(relowner) AS owner, relacl::text AS acl
        FROM pg_class
        WHERE relnamespace = to_regnamespace('storecalc')
        ORDER BY relname
    `);
  const capabilityResult = await client.query(`
        SELECT capability_key, schema_version, is_available, verified_at, migration_key
        FROM storecalc.schema_capabilities
        ORDER BY capability_key
    `);
  return {
    relations: relationResult.rows,
    capabilities: capabilityResult.rows,
  };
}

async function programShape(client) {
  const relationResult = await client.query(`
        SELECT relname, relkind, pg_get_userbyid(relowner) AS owner, relacl::text AS acl
        FROM pg_class
        WHERE relnamespace = to_regnamespace('storecalc')
        ORDER BY relname
    `);
  const functionResult = await client.query(`
        SELECT proname, md5(prosrc) AS body_hash, prosecdef, proconfig, proacl::text AS acl
        FROM pg_proc
        WHERE pronamespace = to_regnamespace('storecalc')
        ORDER BY proname
    `);
  const triggerResult = await client.query(`
        SELECT trigger_row.tgname, relation.relname, trigger_row.tgenabled, trigger_row.tgtype
        FROM pg_trigger AS trigger_row
        JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid
        WHERE relation.relnamespace = to_regnamespace('storecalc')
          AND NOT trigger_row.tgisinternal
        ORDER BY trigger_row.tgname
    `);
  const capabilityResult = await client.query(`
        SELECT capability_key, schema_version, is_available, verified_at,
               migration_key, updated_at
        FROM storecalc.schema_capabilities
        ORDER BY capability_key
    `);
  return {
    relations: relationResult.rows,
    functions: functionResult.rows,
    triggers: triggerResult.rows,
    capabilities: capabilityResult.rows,
  };
}

async function removeTestState(client) {
  await resetRole(client);
  await client.query("DROP SCHEMA IF EXISTS storecalc CASCADE");
  await client.query("DROP TABLE IF EXISTS public.users CASCADE");
  await client
    .query(
      `
        ALTER DEFAULT PRIVILEGES
        FOR ROLE ${quoteIdentifier(ROLE_SETTINGS.migration_owner_role)}
        REVOKE SELECT ON TABLES FROM ${quoteIdentifier(OUTSIDER_ROLE)}
    `,
    )
    .catch(() => null);
  for (const role of ALL_TEST_ROLES) {
    await client
      .query(
        `REVOKE CREATE ON DATABASE ${quoteIdentifier(DATABASE_NAME)} FROM ${quoteIdentifier(role)}`,
      )
      .catch(() => null);
  }
  for (const role of [...ALL_TEST_ROLES].reverse()) {
    await client.query(`DROP ROLE IF EXISTS ${quoteIdentifier(role)}`);
  }
}

async function createTestRoles(client) {
  await client.query(
    `REVOKE CREATE ON DATABASE ${quoteIdentifier(DATABASE_NAME)} FROM PUBLIC`,
  );
  for (const role of ALL_TEST_ROLES) {
    await client.query(`
            CREATE ROLE ${quoteIdentifier(role)}
            NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
        `);
  }
  await client.query(
    `GRANT CREATE ON DATABASE ${quoteIdentifier(DATABASE_NAME)} TO ${quoteIdentifier(ROLE_SETTINGS.migration_owner_role)}`,
  );
}

async function createUsersTable(client) {
  await client.query(`
        CREATE TABLE public.users (
            id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY
        )
    `);
  await client.query(`
        GRANT REFERENCES (id)
        ON public.users
        TO ${quoteIdentifier(ROLE_SETTINGS.migration_owner_role)}
    `);
}

async function resetSequences(client, sequenceNames) {
  await runAsRole(client, ROLE_SETTINGS.migration_owner_role, async () => {
    for (const sequence of sequenceNames) {
      await client.query(`SELECT setval('storecalc.${sequence}', 1, false)`);
    }
  });
}

async function openMigrationClient(connectionString) {
  const client = new pg.Client({ connectionString, ssl: false });
  await client.connect();
  await client.query(
    `SET ROLE ${quoteIdentifier(ROLE_SETTINGS.migration_owner_role)}`,
  );
  await configureRoles(client);
  return client;
}

const versionUpSql = readMigration("0005_template_versions", "up.sql");
const versionVerifySql = readMigration("0005_template_versions", "verify.sql");
const versionDownSql = readMigration("0005_template_versions", "down.sql");

async function versionBaseShape(client) {
  const relationResult = await client.query(
    "SELECT relname, relkind, pg_get_userbyid(relowner) AS owner, relacl::text AS acl " +
      "FROM pg_class WHERE relnamespace = to_regnamespace('storecalc') ORDER BY relname",
  );
  const functionResult = await client.query(
    "SELECT proname, md5(prosrc) AS body_hash, prosecdef, proconfig, proacl::text AS acl " +
      "FROM pg_proc WHERE pronamespace = to_regnamespace('storecalc') ORDER BY proname",
  );
  const triggerResult = await client.query(
    "SELECT trigger_row.tgname, relation.relname, trigger_row.tgenabled, trigger_row.tgtype " +
      "FROM pg_trigger AS trigger_row JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid " +
      "WHERE relation.relnamespace = to_regnamespace('storecalc') " +
      "AND NOT trigger_row.tgisinternal ORDER BY trigger_row.tgname",
  );
  const capabilityResult = await client.query(
    "SELECT capability_key, schema_version, is_available, verified_at, migration_key " +
      "FROM storecalc.schema_capabilities ORDER BY capability_key",
  );
  return {
    relations: relationResult.rows,
    functions: functionResult.rows,
    triggers: triggerResult.rows,
    capabilities: capabilityResult.rows,
  };
}

const VERSION_CAPABILITIES = [
  "money.minor_units.v1",
  "quantity.bounded_integer.v1",
];

async function insertVersion(client, values) {
  const result = await client.query(
    "INSERT INTO storecalc.template_versions (" +
      "id, template_id, version_number, content_state, currency_code, currency_exponent, " +
      "based_on_version_id, calculation_contract_version, required_capabilities, " +
      "content_schema_version, canonicalization_version, created_by_subject_id" +
      ") VALUES (" +
      "COALESCE($1, nextval('storecalc.template_versions_id_seq')), " +
      "$2, $3, $4, $5, $6, $7, 'storecalc.calculation.v1', $8::text[], " +
      "'storecalc.catalog-content.v1', 'storecalc.canonical-json.v1', $9" +
      ") RETURNING id",
    [
      values.id ?? null,
      values.templateId,
      values.versionNumber,
      values.contentState ?? "draft",
      values.currencyCode ?? "USD",
      values.currencyExponent ?? 2,
      values.basedOnVersionId ?? null,
      values.capabilities ?? VERSION_CAPABILITIES,
      values.createdBySubjectId ?? null,
    ],
  );
  return result.rows[0].id;
}

const contentUpSql = readMigration("0006_version_content", "up.sql");
const contentVerifySql = readMigration("0006_version_content", "verify.sql");
const contentDownSql = readMigration("0006_version_content", "down.sql");
const CONTENT_SEQUENCES = ["version_categories_id_seq", "version_items_id_seq"];

async function insertVersionCategory(client, values) {
  const result = await client.query(
    "INSERT INTO storecalc.version_categories (" +
      "id, version_id, template_id, category_id, display_name, description, " +
      "sort_order, active" +
      ") VALUES (" +
      "COALESCE($1, nextval('storecalc.version_categories_id_seq')), " +
      "$2, $3, $4, $5, $6, $7, $8" +
      ") RETURNING id",
    [
      values.id ?? null,
      values.versionId,
      values.templateId,
      values.categoryId,
      values.displayName ?? "Synthetic category",
      values.description ?? null,
      values.sortOrder ?? 10,
      values.active ?? true,
    ],
  );
  return result.rows[0].id;
}

async function insertVersionItem(client, values) {
  const result = await client.query(
    "INSERT INTO storecalc.version_items (" +
      "id, version_id, template_id, item_id, category_version_id, sku, " +
      "display_name, description, unit_label, price_state, price_minor, " +
      "minimum_selected_quantity, maximum_order_quantity, quantity_step, " +
      "availability_state, sort_order" +
      ") VALUES (" +
      "COALESCE($1, nextval('storecalc.version_items_id_seq')), " +
      "$2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16" +
      ") RETURNING id",
    [
      values.id ?? null,
      values.versionId,
      values.templateId,
      values.itemId,
      values.categoryVersionId ?? null,
      values.sku ?? null,
      values.displayName ?? "Synthetic item",
      values.description ?? null,
      values.unitLabel ?? null,
      values.priceState ?? "known",
      values.priceMinor === undefined ? 100 : values.priceMinor,
      values.minimumSelectedQuantity ?? 1,
      values.maximumOrderQuantity ?? 4,
      values.quantityStep ?? 1,
      values.availabilityState ?? "available",
      values.sortOrder ?? 10,
    ],
  );
  return result.rows[0].id;
}

const bucketUpSql = readMigration("0007_buckets", "up.sql");
const bucketVerifySql = readMigration("0007_buckets", "verify.sql");
const bucketDownSql = readMigration("0007_buckets", "down.sql");
const BUCKET_SEQUENCES = ["version_spending_buckets_id_seq"];
const BUCKET_CAPABILITIES = [
  ...VERSION_CAPABILITIES,
  "spending_buckets.parallel_pretax.v1",
];

async function insertSpendingBucket(client, values) {
  const result = await client.query(
    "INSERT INTO storecalc.version_spending_buckets (" +
      "id, version_id, stable_key, display_name, limit_state, limit_minor, " +
      "measure_currency_code, is_primary_display, sort_order" +
      ") VALUES (" +
      "COALESCE($1, nextval('storecalc.version_spending_buckets_id_seq')), " +
      "$2, $3, $4, $5, $6, $7, $8, $9" +
      ") RETURNING id",
    [
      values.id ?? null,
      values.versionId,
      values.stableKey,
      values.displayName ?? "Synthetic spending bucket",
      values.limitState ?? "known",
      values.limitMinor === undefined ? 100 : values.limitMinor,
      values.measureCurrencyCode ?? "USD",
      values.isPrimaryDisplay ?? false,
      values.sortOrder ?? 10,
    ],
  );
  return result.rows[0].id;
}

async function insertBucketMembership(client, values) {
  await client.query(
    "INSERT INTO storecalc.version_item_bucket_memberships (" +
      "version_item_id, version_id, spending_bucket_id, membership_type, primary_display" +
      ") VALUES ($1, $2, $3, $4, $5)",
    [
      values.versionItemId,
      values.versionId,
      values.spendingBucketId,
      values.membershipType ?? "counts_toward",
      values.primaryDisplay ?? false,
    ],
  );
}

const taxUpSql = readMigration("0008_tax_rules", "up.sql");
const taxVerifySql = readMigration("0008_tax_rules", "verify.sql");
const taxDownSql = readMigration("0008_tax_rules", "down.sql");
const TAX_SEQUENCES = ["version_tax_rules_id_seq"];
const TAX_CAPABILITIES = [
  ...VERSION_CAPABILITIES,
  "tax.single_treatment.line_rounding.v1",
];

async function insertTaxRule(client, values) {
  const result = await client.query(
    "INSERT INTO storecalc.version_tax_rules (" +
      "id, version_id, scope_type, category_version_id, item_version_id, " +
      "treatment_state, rate_ppm, price_includes_tax, rounding_mode, " +
      "rounding_scope, priority" +
      ") VALUES (" +
      "COALESCE($1, nextval('storecalc.version_tax_rules_id_seq')), " +
      "$2, $3, $4, $5, $6, $7, $8, $9, $10, $11" +
      ") RETURNING id",
    [
      values.id ?? null,
      values.versionId,
      values.scopeType ?? "template",
      values.categoryVersionId ?? null,
      values.itemVersionId ?? null,
      values.treatmentState ?? "known",
      values.ratePpm === undefined ? 0 : values.ratePpm,
      values.priceIncludesTax === undefined ? false : values.priceIncludesTax,
      values.roundingMode === undefined ? "half_up" : values.roundingMode,
      values.roundingScope === undefined ? "line" : values.roundingScope,
      values.priority ?? 10,
    ],
  );
  return result.rows[0].id;
}

const constraintUpSql = readMigration("0009_constraints", "up.sql");
const constraintVerifySql = readMigration("0009_constraints", "verify.sql");
const constraintDownSql = readMigration("0009_constraints", "down.sql");
const ORDER_CONSTRAINT_SEQUENCES = ["version_constraints_id_seq"];
const ORDER_CONSTRAINT_CAPABILITIES = [
  "constraints.order_aggregate.v1",
  ...VERSION_CAPABILITIES,
];

async function insertOrderConstraint(client, values) {
  const valueState = values.valueState ?? "known";
  const limitValue =
    values.limitValue === undefined
      ? valueState === "known"
        ? 8
        : null
      : values.limitValue;
  const result = await client.query(
    "INSERT INTO storecalc.version_constraints (" +
      "id, version_id, stable_key, display_name, constraint_type, " +
      "measure_type, comparator, value_state, limit_value, unit_code, " +
      "scope_type, composition_behavior, priority" +
      ") VALUES (" +
      "COALESCE($1, nextval('storecalc.version_constraints_id_seq')), " +
      "$2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13" +
      ") RETURNING id",
    [
      values.id ?? null,
      values.versionId,
      values.stableKey,
      values.displayName ?? "Synthetic order constraint",
      values.constraintType ?? "order_aggregate",
      values.measureType ?? "total_quantity",
      values.comparator ?? "less_than_or_equal",
      valueState,
      limitValue,
      values.unitCode ?? "count",
      values.scopeType ?? "order",
      values.compositionBehavior ?? "all_must_pass",
      values.priority ?? 10,
    ],
  );
  return result.rows[0].id;
}

const warningUpSql = readMigration("0010_warnings", "up.sql");
const warningVerifySql = readMigration("0010_warnings", "verify.sql");
const warningDownSql = readMigration("0010_warnings", "down.sql");
const WARNING_SEQUENCES = ["version_warnings_id_seq"];

async function insertVersionWarning(client, values) {
  const result = await client.query(
    "INSERT INTO storecalc.version_warnings (" +
      "id, version_id, warning_code, severity, scope_type, " +
      "category_version_id, item_version_id, message_key, bounded_details" +
      ") VALUES (" +
      "COALESCE($1, nextval('storecalc.version_warnings_id_seq')), " +
      "$2, $3, $4, $5, $6, $7, $8, $9::jsonb" +
      ") RETURNING id",
    [
      values.id ?? null,
      values.versionId,
      values.warningCode,
      values.severity ?? "warning",
      values.scopeType ?? "template",
      values.categoryVersionId ?? null,
      values.itemVersionId ?? null,
      values.messageKey ?? "storecalc.warning.synthetic",
      JSON.stringify(values.boundedDetails ?? {}),
    ],
  );
  return result.rows[0].id;
}

const evidenceUpSql = readMigration("0011_source_evidence", "up.sql");
const evidenceVerifySql = readMigration("0011_source_evidence", "verify.sql");
const evidenceDownSql = readMigration("0011_source_evidence", "down.sql");
const EVIDENCE_SEQUENCES = ["evidence_id_seq", "evidence_groups_id_seq"];

async function insertEvidence(client, values) {
  const result = await client.query(
    "INSERT INTO storecalc.evidence (" +
      "id, contributor_subject_id, source_type, source_url, source_title, " +
      "source_date, language_tag, metadata_visibility, privacy_state, " +
      "redistribution_state, normalized_fingerprint, withdrawn_at, " +
      "lifecycle_generation" +
      ") VALUES (" +
      "COALESCE($1, nextval('storecalc.evidence_id_seq')), " +
      "$2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13" +
      ") RETURNING id",
    [
      values.id ?? null,
      values.contributorSubjectId ?? null,
      values.sourceType ?? "external_citation",
      values.sourceUrl ?? "https://example.invalid/source",
      values.sourceTitle ?? "Synthetic source",
      values.sourceDate ?? null,
      values.languageTag ?? null,
      values.metadataVisibility ?? "private",
      values.privacyState ?? "pending_review",
      values.redistributionState ?? "metadata_only",
      values.fingerprint,
      values.withdrawnAt ?? null,
      values.lifecycleGeneration ?? 1,
    ],
  );
  return result.rows[0].id;
}

async function insertEvidenceGroup(client, values) {
  const result = await client.query(
    "INSERT INTO storecalc.evidence_groups (" +
      "id, grouping_type, canonical_fingerprint, independence_state, superseded_at" +
      ") VALUES (" +
      "COALESCE($1, nextval('storecalc.evidence_groups_id_seq')), " +
      "$2, $3, $4, $5" +
      ") RETURNING id",
    [
      values.id ?? null,
      values.groupingType ?? "source_lineage",
      values.fingerprint,
      values.independenceState ?? "unreviewed",
      values.supersededAt ?? null,
    ],
  );
  return result.rows[0].id;
}

async function insertVersionSourceEvidence(client, values) {
  await client.query(
    "INSERT INTO storecalc.version_source_evidence (" +
      "version_id, evidence_id, relationship_type, source_group_id" +
      ") VALUES ($1, $2, $3, $4)",
    [
      values.versionId,
      values.evidenceId,
      values.relationshipType ?? "supports_catalog",
      values.sourceGroupId,
    ],
  );
}


const catalogPublicationUpSql = readMigration(
  "0012_catalog_publication_applicability",
  "up.sql",
);
const catalogPublicationVerifySql = readMigration(
  "0012_catalog_publication_applicability",
  "verify.sql",
);
const catalogPublicationDownSql = readMigration(
  "0012_catalog_publication_applicability",
  "down.sql",
);
const CATALOG_PUBLICATION_SEQUENCES = [
  "template_publications_id_seq",
  "assignment_template_applicability_id_seq",
];

async function sealVersion(client, versionId, hashCharacter) {
  const result = await client.query(
    "UPDATE storecalc.template_versions " +
      "SET content_state = 'sealed', hash_algorithm = 'sha256', " +
      "content_hash = $2, sealed_at = transaction_timestamp() " +
      "WHERE id = $1",
    [versionId, hashCharacter.repeat(64)],
  );
  assert.equal(result.rowCount, 1);
}

async function insertPublication(client, values) {
  const result = await client.query(
    "INSERT INTO storecalc.template_publications (" +
      "id, template_id, version_id, started_at, actor_type, " +
      "published_by_subject_id, reason_code" +
      ") VALUES (" +
      "COALESCE($1, nextval('storecalc.template_publications_id_seq')), " +
      "$2, $3, transaction_timestamp() + ($4 * interval '1 second'), " +
      "$5, $6, $7" +
      ") RETURNING id, started_at",
    [
      values.id ?? null,
      values.templateId,
      values.versionId,
      values.startOffsetSeconds ?? 0,
      values.actorType ?? "owner",
      values.subjectId ?? null,
      values.reasonCode ?? "reviewed_publication",
    ],
  );
  return result.rows[0];
}

async function closePublication(client, values) {
  return client.query(
    "UPDATE storecalc.template_publications " +
      "SET ended_at = transaction_timestamp() + ($2 * interval '1 second'), " +
      "ended_actor_type = $3, ended_by_subject_id = $4, " +
      "ended_reason_code = $5, lifecycle_generation = lifecycle_generation + 1 " +
      "WHERE id = $1",
    [
      values.id,
      values.endOffsetSeconds ?? 0,
      values.actorType ?? "owner",
      values.subjectId ?? null,
      values.reasonCode ?? "reviewed_replacement",
    ],
  );
}

async function insertApplicability(client, values) {
  const result = await client.query(
    "INSERT INTO storecalc.assignment_template_applicability (" +
      "id, assignment_id, program_id, facility_id, template_id, " +
      "selection_mode, exact_version_id, publication_id, valid_from, " +
      "valid_through, applicability_state, actor_type, " +
      "recorded_by_subject_id, reason_code" +
      ") VALUES (" +
      "COALESCE($1, nextval('storecalc.assignment_template_applicability_id_seq')), " +
      "$2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14" +
      ") RETURNING id",
    [
      values.id ?? null,
      values.assignmentId,
      values.programId,
      values.facilityId,
      values.templateId,
      values.selectionMode ?? "exact_version",
      values.exactVersionId ?? null,
      values.publicationId ?? null,
      values.validFrom ?? null,
      values.validThrough ?? null,
      values.applicabilityState ?? "supported",
      values.actorType ?? "owner",
      values.subjectId ?? null,
      values.reasonCode ?? "reviewed_applicability",
    ],
  );
  return result.rows[0].id;
}

async function closeApplicability(client, values) {
  return client.query(
    "UPDATE storecalc.assignment_template_applicability " +
      "SET ended_at = transaction_timestamp(), ended_actor_type = $2, " +
      "ended_by_subject_id = $3, ended_reason_code = $4, " +
      "lifecycle_generation = lifecycle_generation + 1 " +
      "WHERE id = $1",
    [
      values.id,
      values.actorType ?? "owner",
      values.subjectId ?? null,
      values.reasonCode ?? "reviewed_correction",
    ],
  );
}

test(
  "StoreCalc publication and applicability are sealed, lineage-exact, serialized, isolated, and reversibly unused",
  { timeout: 120_000 },
  async () => {
    const connectionString = assertDisposableTarget();
    const client = new pg.Client({ connectionString, ssl: false });
    await client.connect();

    try {
      await removeTestState(client);
      await createTestRoles(client);
      const serverVersion = await client.query("SHOW server_version_num");
      assert.ok(Number(serverVersion.rows[0].server_version_num) >= 170000);

      const originalFingerprint = await schemaFingerprint(client);
      await runMigrationSql(client, foundationUpSql);
      await runMigrationSql(client, foundationVerifySql);
      const foundationFingerprint = await schemaFingerprint(client);
      await createUsersTable(client);
      await runMigrationSql(client, directoryUpSql);
      await runMigrationSql(client, directoryVerifySql);
      const directoryFingerprint = await directoryShape(client);
      await runMigrationSql(client, programUpSql);
      await runMigrationSql(client, programVerifySql);
      const programFingerprint = await programShape(client);
      await runMigrationSql(client, templateUpSql);
      await runMigrationSql(client, templateVerifySql);
      await runMigrationSql(client, versionUpSql);
      await runMigrationSql(client, versionVerifySql);
      await runMigrationSql(client, contentUpSql);
      await runMigrationSql(client, contentVerifySql);
      await runMigrationSql(client, bucketUpSql);
      await runMigrationSql(client, bucketVerifySql);
      await runMigrationSql(client, taxUpSql);
      await runMigrationSql(client, taxVerifySql);
      await runMigrationSql(client, constraintUpSql);
      await runMigrationSql(client, constraintVerifySql);
      await runMigrationSql(client, warningUpSql);
      await runMigrationSql(client, warningVerifySql);

      const preEvidenceFingerprint = await versionBaseShape(client);
      await expectRejected(
        runMigrationSql(client, catalogPublicationUpSql),
        "storecalc_template_postflight_relation_mismatch",
        "P0001",
      );
      assert.deepEqual(
        await versionBaseShape(client),
        preEvidenceFingerprint,
        "a rejected pre-evidence publication migration changed schema state",
      );

      await runMigrationSql(client, evidenceUpSql);
      await runMigrationSql(client, evidenceVerifySql);
      const evidenceBaseline = await versionBaseShape(client);
      await runMigrationSql(client, catalogPublicationUpSql);
      await runMigrationSql(client, catalogPublicationVerifySql);

      assert.deepEqual(
        (
          await client.query(
            "SELECT schema_version, is_available, verified_at, migration_key " +
              "FROM storecalc.schema_capabilities " +
              "WHERE capability_key = 'anonymous.calculation'",
          )
        ).rows,
        [
          {
            schema_version: 9,
            is_available: false,
            verified_at: null,
            migration_key: "0012_catalog_publication_applicability",
          },
        ],
      );

      // web and worker roles cannot read publication state
      for (const role of [ROLE_SETTINGS.web_role, ROLE_SETTINGS.worker_role]) {
        await runAsRole(client, role, async () => {
          for (const table of [
            "template_publications",
            "assignment_template_applicability",
          ]) {
            await expectPermissionDenied(
              client.query("SELECT * FROM storecalc." + table),
            );
          }
          for (const sequence of CATALOG_PUBLICATION_SEQUENCES) {
            await expectPermissionDenied(
              client.query("SELECT nextval('storecalc." + sequence + "')"),
            );
          }
        });
      }

      await runAsRole(client, ROLE_SETTINGS.backup_role, async () => {
        for (const table of [
          "template_publications",
            "assignment_template_applicability",
        ]) {
          assert.equal(
            (await client.query("SELECT count(*) FROM storecalc." + table))
              .rows[0].count,
            "0",
          );
        }
        await expectPermissionDenied(
          client.query(
            "INSERT INTO storecalc.template_publications " +
              "(template_id, version_id, actor_type, reason_code) " +
              "VALUES (1, 1, 'system', 'denied')",
          ),
        );
      });

      const userId = (
        await client.query("INSERT INTO public.users DEFAULT VALUES RETURNING id")
      ).rows[0].id;

      const fixture = await runAsRole(
        client,
        ROLE_SETTINGS.migration_owner_role,
        async () => {
          const subjectId = (
            await client.query(
              "INSERT INTO storecalc.contributor_subjects " +
                "(user_id, status) VALUES ($1, 'active') RETURNING id",
              [userId],
            )
          ).rows[0].id;
          const countryId = (
            await client.query(
              "INSERT INTO storecalc.countries " +
                "(code_alpha2, code_alpha3, official_name, support_status, active) " +
                "VALUES ('US', 'USA', 'United States', 'limited_directory', true) " +
                "RETURNING id",
            )
          ).rows[0].id;
          const facilities = await client.query(
            "INSERT INTO storecalc.facilities (" +
              "physical_country_id, record_scope, owner_user_id, official_name, " +
              "status, created_by_subject_id" +
              ") VALUES " +
              "($1, 'public', NULL, 'Publication Facility One', 'active', $2), " +
              "($1, 'public', NULL, 'Publication Facility Two', 'active', $2) " +
              "RETURNING id, official_name",
            [countryId, subjectId],
          );
          const facilityByName = Object.fromEntries(
            facilities.rows.map((row) => [row.official_name, row.id]),
          );
          const programs = await client.query(
            "INSERT INTO storecalc.store_programs (" +
              "record_scope, owner_user_id, name, status, created_by_subject_id" +
              ") VALUES " +
              "('public', NULL, 'Publication Program', 'active', $1), " +
              "('public', NULL, 'Other Publication Program', 'active', $1) " +
              "RETURNING id, name",
            [subjectId],
          );
          const programByName = Object.fromEntries(
            programs.rows.map((row) => [row.name, row.id]),
          );
          const assignments = await client.query(
            "INSERT INTO storecalc.program_facility_assignments (" +
              "program_id, facility_id, audience_key, valid_from, valid_through, " +
              "assignment_state" +
              ") VALUES " +
              "($1, $3, 'general', DATE '2026-01-01', DATE '2026-12-31', 'supported'), " +
              "($1, $4, 'general', DATE '2026-01-01', DATE '2026-12-31', 'supported'), " +
              "($2, $4, 'general', DATE '2026-01-01', DATE '2026-12-31', 'supported') " +
              "RETURNING id, program_id, facility_id",
            [
              programByName["Publication Program"],
              programByName["Other Publication Program"],
              facilityByName["Publication Facility One"],
              facilityByName["Publication Facility Two"],
            ],
          );
          const assignmentOne = assignments.rows.find(
            (row) =>
              row.program_id === programByName["Publication Program"] &&
              row.facility_id === facilityByName["Publication Facility One"],
          ).id;
          const assignmentTwo = assignments.rows.find(
            (row) =>
              row.program_id === programByName["Publication Program"] &&
              row.facility_id === facilityByName["Publication Facility Two"],
          ).id;
          const otherAssignment = assignments.rows.find(
            (row) =>
              row.program_id === programByName["Other Publication Program"],
          ).id;
          const templates = await client.query(
            "INSERT INTO storecalc.templates (" +
              "program_id, visibility, owner_user_id, name, status, created_by_subject_id" +
              ") VALUES " +
              "($1, 'public', NULL, 'Primary Publication Template', 'active', $3), " +
              "($1, 'public', NULL, 'Concurrent Publication Template', 'active', $3), " +
              "($1, 'public', NULL, 'Assignment Lock Template', 'active', $3), " +
              "($1, 'public', NULL, 'Service Publication Template', 'active', $3), " +
              "($2, 'public', NULL, 'Other Program Template', 'active', $3) " +
              "RETURNING id, name",
            [
              programByName["Publication Program"],
              programByName["Other Publication Program"],
              subjectId,
            ],
          );
          const templateByName = Object.fromEntries(
            templates.rows.map((row) => [row.name, row.id]),
          );

          const versionOne = await insertVersion(client, {
            templateId: templateByName["Primary Publication Template"],
            versionNumber: 1,
            createdBySubjectId: subjectId,
          });
          const versionTwo = await insertVersion(client, {
            templateId: templateByName["Primary Publication Template"],
            versionNumber: 2,
            createdBySubjectId: subjectId,
          });
          const draftVersion = await insertVersion(client, {
            templateId: templateByName["Primary Publication Template"],
            versionNumber: 3,
            createdBySubjectId: subjectId,
          });
          const concurrentVersion = await insertVersion(client, {
            templateId: templateByName["Concurrent Publication Template"],
            versionNumber: 1,
            createdBySubjectId: subjectId,
          });
          const lockVersion = await insertVersion(client, {
            templateId: templateByName["Assignment Lock Template"],
            versionNumber: 1,
            createdBySubjectId: subjectId,
          });
          const serviceVersionOne = await insertVersion(client, {
            templateId: templateByName["Service Publication Template"],
            versionNumber: 1,
            createdBySubjectId: subjectId,
          });
          const serviceVersionTwo = await insertVersion(client, {
            templateId: templateByName["Service Publication Template"],
            versionNumber: 2,
            createdBySubjectId: subjectId,
          });
          const serviceVersionThree = await insertVersion(client, {
            templateId: templateByName["Service Publication Template"],
            versionNumber: 3,
            createdBySubjectId: subjectId,
          });
          const otherVersion = await insertVersion(client, {
            templateId: templateByName["Other Program Template"],
            versionNumber: 1,
            createdBySubjectId: subjectId,
          });

          await sealVersion(client, versionOne, "1");
          await sealVersion(client, versionTwo, "2");
          await sealVersion(client, concurrentVersion, "3");
          await sealVersion(client, lockVersion, "4");
          await sealVersion(client, serviceVersionOne, "5");
          await sealVersion(client, serviceVersionTwo, "6");
          await sealVersion(client, serviceVersionThree, "7");
          await sealVersion(client, otherVersion, "8");

          return {
            subjectId,
            countryId,
            facilityByName,
            programByName,
            assignmentOne,
            assignmentTwo,
            otherAssignment,
            templateByName,
            versionOne,
            versionTwo,
            draftVersion,
            concurrentVersion,
            lockVersion,
            serviceVersionOne,
            serviceVersionTwo,
            serviceVersionThree,
            otherVersion,
          };
        },
      );

      const servicePool = new pg.Pool({
        connectionString,
        ssl: false,
        max: 3,
      });
      try {
        const serviceTemplate =
          fixture.templateByName["Service Publication Template"];
        const first = await publishCatalogVersion(servicePool, {
          templateId: serviceTemplate,
          versionId: fixture.serviceVersionOne,
          expectedCurrentPublicationId: null,
          actorSubjectId: fixture.subjectId,
          reasonCode: "reviewed_initial_publication",
        });
        assert.equal(first.replacedPublicationId, null);
        assert.equal(first.publication.versionId, fixture.serviceVersionOne);

        const replacements = await Promise.allSettled([
          publishCatalogVersion(servicePool, {
            templateId: serviceTemplate,
            versionId: fixture.serviceVersionTwo,
            expectedCurrentPublicationId: first.publication.id,
            actorSubjectId: fixture.subjectId,
            reasonCode: "reviewed_replacement",
          }),
          publishCatalogVersion(servicePool, {
            templateId: serviceTemplate,
            versionId: fixture.serviceVersionThree,
            expectedCurrentPublicationId: first.publication.id,
            actorSubjectId: fixture.subjectId,
            reasonCode: "reviewed_replacement",
          }),
        ]);
        const fulfilled = replacements.filter(
          (result) => result.status === "fulfilled",
        );
        const rejected = replacements.filter(
          (result) => result.status === "rejected",
        );
        assert.equal(fulfilled.length, 1);
        assert.equal(rejected.length, 1);
        assert.ok(rejected[0].reason instanceof StoreCalcCatalogPublicationError);
        assert.equal(rejected[0].reason.code, "CURRENT_PUBLICATION_CHANGED");
        assert.equal(
          fulfilled[0].value.replacedPublicationId,
          first.publication.id,
        );

        const serviceRows = (
          await client.query(
            "SELECT id, version_id, ended_at, lifecycle_generation " +
              "FROM storecalc.template_publications " +
              "WHERE template_id = $1 ORDER BY id",
            [serviceTemplate],
          )
        ).rows;
        assert.equal(serviceRows.length, 2);
        assert.equal(serviceRows[0].id, first.publication.id);
        assert.ok(serviceRows[0].ended_at instanceof Date);
        assert.equal(serviceRows[0].lifecycle_generation, 2);
        assert.equal(serviceRows[1].ended_at, null);
        assert.equal(
          serviceRows[1].version_id,
          fulfilled[0].value.publication.versionId,
        );
        assert.equal(serviceRows[1].lifecycle_generation, 1);

        const currentServicePublicationId =
          fulfilled[0].value.publication.id;
        const firstApplicability = await transitionCatalogApplicability(
          servicePool,
          {
            assignmentId: fixture.assignmentOne,
            programId: fixture.programByName["Publication Program"],
            facilityId:
              fixture.facilityByName["Publication Facility One"],
            templateId: serviceTemplate,
            selection: {
              mode: "exact_version",
              targetId: fixture.serviceVersionOne,
            },
            validFrom: "2026-01-01",
            validThrough: "2026-06-30",
            applicabilityState: "supported",
            replacesApplicabilityId: null,
            actorSubjectId: fixture.subjectId,
            reasonCode: "reviewed_initial_applicability",
          },
        );
        const secondApplicability = await transitionCatalogApplicability(
          servicePool,
          {
            assignmentId: fixture.assignmentOne,
            programId: fixture.programByName["Publication Program"],
            facilityId:
              fixture.facilityByName["Publication Facility One"],
            templateId: serviceTemplate,
            selection: {
              mode: "exact_version",
              targetId: fixture.serviceVersionTwo,
            },
            validFrom: "2026-07-01",
            validThrough: "2026-12-31",
            applicabilityState: "supported",
            replacesApplicabilityId: null,
            actorSubjectId: fixture.subjectId,
            reasonCode: "reviewed_later_interval",
          },
        );
        assert.notEqual(
          firstApplicability.applicability.id,
          secondApplicability.applicability.id,
        );

        const corrections = await Promise.allSettled([
          transitionCatalogApplicability(servicePool, {
            assignmentId: fixture.assignmentOne,
            programId: fixture.programByName["Publication Program"],
            facilityId:
              fixture.facilityByName["Publication Facility One"],
            templateId: serviceTemplate,
            selection: {
              mode: "exact_version",
              targetId: fixture.serviceVersionTwo,
            },
            validFrom: "2026-01-01",
            validThrough: "2026-06-30",
            applicabilityState: "supported",
            replacesApplicabilityId: firstApplicability.applicability.id,
            actorSubjectId: fixture.subjectId,
            reasonCode: "reviewed_correction",
          }),
          transitionCatalogApplicability(servicePool, {
            assignmentId: fixture.assignmentOne,
            programId: fixture.programByName["Publication Program"],
            facilityId:
              fixture.facilityByName["Publication Facility One"],
            templateId: serviceTemplate,
            selection: {
              mode: "publication",
              targetId: currentServicePublicationId,
            },
            validFrom: "2026-01-01",
            validThrough: "2026-06-30",
            applicabilityState: "supported",
            replacesApplicabilityId: firstApplicability.applicability.id,
            actorSubjectId: fixture.subjectId,
            reasonCode: "reviewed_correction",
          }),
        ]);
        const correctionWinners = corrections.filter(
          (result) => result.status === "fulfilled",
        );
        const correctionLosers = corrections.filter(
          (result) => result.status === "rejected",
        );
        assert.equal(correctionWinners.length, 1);
        assert.equal(correctionLosers.length, 1);
        assert.ok(
          correctionLosers[0].reason instanceof
            StoreCalcCatalogApplicabilityError,
        );
        assert.equal(
          correctionLosers[0].reason.code,
          "CURRENT_APPLICABILITY_CHANGED",
        );

        const overlappingCreates = await Promise.allSettled([
          transitionCatalogApplicability(servicePool, {
            assignmentId: fixture.assignmentTwo,
            programId: fixture.programByName["Publication Program"],
            facilityId:
              fixture.facilityByName["Publication Facility Two"],
            templateId: serviceTemplate,
            selection: {
              mode: "exact_version",
              targetId: fixture.serviceVersionOne,
            },
            validFrom: "2026-01-01",
            validThrough: "2026-12-31",
            applicabilityState: "supported",
            replacesApplicabilityId: null,
            actorSubjectId: fixture.subjectId,
            reasonCode: "reviewed_applicability",
          }),
          transitionCatalogApplicability(servicePool, {
            assignmentId: fixture.assignmentTwo,
            programId: fixture.programByName["Publication Program"],
            facilityId:
              fixture.facilityByName["Publication Facility Two"],
            templateId: serviceTemplate,
            selection: {
              mode: "publication",
              targetId: currentServicePublicationId,
            },
            validFrom: "2026-06-01",
            validThrough: "2026-12-31",
            applicabilityState: "supported",
            replacesApplicabilityId: null,
            actorSubjectId: fixture.subjectId,
            reasonCode: "reviewed_applicability",
          }),
        ]);
        const overlapWinners = overlappingCreates.filter(
          (result) => result.status === "fulfilled",
        );
        const overlapLosers = overlappingCreates.filter(
          (result) => result.status === "rejected",
        );
        assert.equal(overlapWinners.length, 1);
        assert.equal(overlapLosers.length, 1);
        assert.equal(overlapLosers[0].reason.code, "23P01");

        const applicabilityRows = (
          await client.query(
            "SELECT assignment_id, id, ended_at, lifecycle_generation " +
              "FROM storecalc.assignment_template_applicability " +
              "WHERE template_id = $1 ORDER BY assignment_id, id",
            [serviceTemplate],
          )
        ).rows;
        const assignmentOneRows = applicabilityRows.filter(
          (row) => row.assignment_id === fixture.assignmentOne,
        );
        const assignmentTwoRows = applicabilityRows.filter(
          (row) => row.assignment_id === fixture.assignmentTwo,
        );
        assert.equal(assignmentOneRows.length, 3);
        assert.equal(
          assignmentOneRows.filter((row) => row.ended_at === null).length,
          2,
        );
        assert.equal(assignmentOneRows[0].lifecycle_generation, 2);
        assert.ok(assignmentOneRows[0].ended_at instanceof Date);
        assert.equal(assignmentTwoRows.length, 1);
        assert.equal(assignmentTwoRows[0].ended_at, null);
      } finally {
        await servicePool.end();
      }

      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, async () => {
        const primaryTemplate =
          fixture.templateByName["Primary Publication Template"];
        const publicationOne = await insertPublication(client, {
          templateId: primaryTemplate,
          versionId: fixture.versionOne,
          subjectId: fixture.subjectId,
        });

        // publication lineage rejects cross-template versions
        await expectRejected(
          insertPublication(client, {
            templateId: primaryTemplate,
            versionId: fixture.otherVersion,
            subjectId: fixture.subjectId,
          }),
          "storecalc_template_publication_lineage_missing",
          "23503",
        );
        await expectRejected(
          insertPublication(client, {
            templateId: primaryTemplate,
            versionId: fixture.draftVersion,
            subjectId: fixture.subjectId,
          }),
          "storecalc_template_publication_version_not_sealed",
          "23514",
        );
        await expectRejected(
          insertPublication(client, {
            templateId: primaryTemplate,
            versionId: fixture.versionTwo,
            startOffsetSeconds: -60,
            subjectId: fixture.subjectId,
          }),
          "storecalc_template_publication_backdated",
          "23514",
        );
        await expectRejected(
          insertPublication(client, {
            templateId: primaryTemplate,
            versionId: fixture.versionTwo,
            subjectId: fixture.subjectId,
          }),
          "storecalc_template_publication_interval_overlap",
          "23P01",
        );

        // selection null patterns fail closed
        await expectRejected(
          insertApplicability(client, {
            assignmentId: fixture.assignmentOne,
            programId: fixture.programByName["Publication Program"],
            facilityId: fixture.facilityByName["Publication Facility One"],
            templateId: primaryTemplate,
            selectionMode: "exact_version",
            exactVersionId: fixture.versionOne,
            publicationId: publicationOne.id,
            validFrom: "2026-01-01",
            validThrough: "2026-03-31",
            subjectId: fixture.subjectId,
          }),
          "storecalc_assignment_applicability_selection_invalid",
          "23514",
        );
        await expectRejected(
          insertApplicability(client, {
            assignmentId: fixture.assignmentOne,
            programId: fixture.programByName["Publication Program"],
            facilityId: fixture.facilityByName["Publication Facility One"],
            templateId: primaryTemplate,
            selectionMode: "publication",
            validFrom: "2026-01-01",
            validThrough: "2026-03-31",
            subjectId: fixture.subjectId,
          }),
          "storecalc_assignment_applicability_selection_invalid",
          "23514",
        );

        await expectRejected(
          insertApplicability(client, {
            assignmentId: fixture.assignmentOne,
            programId: fixture.programByName["Other Publication Program"],
            facilityId: fixture.facilityByName["Publication Facility One"],
            templateId: primaryTemplate,
            exactVersionId: fixture.versionOne,
            validFrom: "2026-01-01",
            validThrough: "2026-03-31",
            subjectId: fixture.subjectId,
          }),
          "storecalc_assignment_applicability_lineage_missing",
          "23503",
        );
        await expectRejected(
          insertApplicability(client, {
            assignmentId: fixture.assignmentOne,
            programId: fixture.programByName["Publication Program"],
            facilityId: fixture.facilityByName["Publication Facility One"],
            templateId: fixture.templateByName["Other Program Template"],
            exactVersionId: fixture.otherVersion,
            validFrom: "2026-01-01",
            validThrough: "2026-03-31",
            subjectId: fixture.subjectId,
          }),
          "storecalc_assignment_applicability_lineage_missing",
          "23503",
        );
        await expectRejected(
          insertApplicability(client, {
            assignmentId: fixture.assignmentOne,
            programId: fixture.programByName["Publication Program"],
            facilityId: fixture.facilityByName["Publication Facility One"],
            templateId: primaryTemplate,
            exactVersionId: fixture.draftVersion,
            validFrom: "2026-01-01",
            validThrough: "2026-03-31",
            subjectId: fixture.subjectId,
          }),
          "storecalc_assignment_applicability_version_not_sealed",
          "23514",
        );
        await expectRejected(
          insertApplicability(client, {
            assignmentId: fixture.assignmentOne,
            programId: fixture.programByName["Publication Program"],
            facilityId: fixture.facilityByName["Publication Facility One"],
            templateId: primaryTemplate,
            exactVersionId: fixture.versionOne,
            validFrom: "2025-12-31",
            validThrough: "2026-03-31",
            subjectId: fixture.subjectId,
          }),
          "storecalc_assignment_applicability_before_assignment",
          "23514",
        );

        const exactApplicability = await insertApplicability(client, {
          assignmentId: fixture.assignmentOne,
          programId: fixture.programByName["Publication Program"],
          facilityId: fixture.facilityByName["Publication Facility One"],
          templateId: primaryTemplate,
          exactVersionId: fixture.versionOne,
          validFrom: "2026-01-01",
          validThrough: "2026-06-30",
          subjectId: fixture.subjectId,
        });
        await expectRejected(
          insertApplicability(client, {
            assignmentId: fixture.assignmentOne,
            programId: fixture.programByName["Publication Program"],
            facilityId: fixture.facilityByName["Publication Facility One"],
            templateId: primaryTemplate,
            selectionMode: "publication",
            publicationId: publicationOne.id,
            validFrom: "2026-06-30",
            validThrough: "2026-09-30",
            subjectId: fixture.subjectId,
          }),
          "storecalc_assignment_applicability_interval_overlap",
          "23P01",
        );
        await insertApplicability(client, {
          assignmentId: fixture.assignmentOne,
          programId: fixture.programByName["Publication Program"],
          facilityId: fixture.facilityByName["Publication Facility One"],
          templateId: primaryTemplate,
          selectionMode: "publication",
          publicationId: publicationOne.id,
          validFrom: "2026-07-01",
          validThrough: "2026-12-31",
          subjectId: fixture.subjectId,
        });

        await new Promise((resolve) => setTimeout(resolve, 5));
        assert.equal(
          (await closeApplicability(client, {
            id: exactApplicability,
            subjectId: fixture.subjectId,
          })).rowCount,
          1,
        );
        const replacementApplicability = await insertApplicability(client, {
          assignmentId: fixture.assignmentOne,
          programId: fixture.programByName["Publication Program"],
          facilityId: fixture.facilityByName["Publication Facility One"],
          templateId: primaryTemplate,
          exactVersionId: fixture.versionOne,
          validFrom: "2026-01-01",
          validThrough: "2026-06-30",
          subjectId: fixture.subjectId,
          reasonCode: "corrected_applicability",
        });
        await expectRejected(
          client.query(
            "UPDATE storecalc.assignment_template_applicability " +
              "SET valid_through = DATE '2026-05-31' WHERE id = $1",
            [replacementApplicability],
          ),
          "storecalc_assignment_applicability_identity_immutable",
          "55000",
        );
        await expectRejected(
          client.query(
            "DELETE FROM storecalc.assignment_template_applicability WHERE id = $1",
            [replacementApplicability],
          ),
          "storecalc_assignment_applicability_delete_forbidden",
          "55000",
        );

        assert.equal(
          (await closePublication(client, {
            id: publicationOne.id,
            endOffsetSeconds: 1,
            subjectId: fixture.subjectId,
          })).rowCount,
          1,
        );
        await insertPublication(client, {
          templateId: primaryTemplate,
          versionId: fixture.versionTwo,
          startOffsetSeconds: 2,
          subjectId: fixture.subjectId,
          reasonCode: "reviewed_replacement",
        });
        await expectRejected(
          closePublication(client, {
            id: publicationOne.id,
            endOffsetSeconds: 3,
            subjectId: fixture.subjectId,
          }),
          "storecalc_template_publication_closed_immutable",
          "55000",
        );
        await expectRejected(
          client.query("DELETE FROM storecalc.template_publications WHERE id = $1", [
            publicationOne.id,
          ]),
          "storecalc_template_publication_delete_forbidden",
          "55000",
        );
      });

      const firstClient = await openMigrationClient(connectionString);
      const secondClient = await openMigrationClient(connectionString);
      try {
        const concurrentTemplate =
          fixture.templateByName["Concurrent Publication Template"];

        // publication switches serialize
        await firstClient.query("BEGIN");
        await insertPublication(firstClient, {
          templateId: concurrentTemplate,
          versionId: fixture.concurrentVersion,
          subjectId: fixture.subjectId,
        });
        let publicationSettled = false;
        const publicationRace = insertPublication(secondClient, {
          templateId: concurrentTemplate,
          versionId: fixture.concurrentVersion,
          subjectId: fixture.subjectId,
        }).finally(() => {
          publicationSettled = true;
        });
        const publicationRejected = expectRejected(
          publicationRace,
          "storecalc_template_publication_interval_overlap",
          "23P01",
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(publicationSettled, false);
        await firstClient.query("COMMIT");
        await publicationRejected;

        // applicability switches serialize
        await firstClient.query("BEGIN");
        await insertApplicability(firstClient, {
          assignmentId: fixture.assignmentTwo,
          programId: fixture.programByName["Publication Program"],
          facilityId: fixture.facilityByName["Publication Facility Two"],
          templateId: concurrentTemplate,
          exactVersionId: fixture.concurrentVersion,
          validFrom: "2026-01-01",
          validThrough: "2026-12-31",
          subjectId: fixture.subjectId,
        });
        let applicabilitySettled = false;
        const applicabilityRace = insertApplicability(secondClient, {
          assignmentId: fixture.assignmentTwo,
          programId: fixture.programByName["Publication Program"],
          facilityId: fixture.facilityByName["Publication Facility Two"],
          templateId: concurrentTemplate,
          exactVersionId: fixture.concurrentVersion,
          validFrom: "2026-06-01",
          validThrough: "2026-12-31",
          subjectId: fixture.subjectId,
        }).finally(() => {
          applicabilitySettled = true;
        });
        const applicabilityRejected = expectRejected(
          applicabilityRace,
          "storecalc_assignment_applicability_interval_overlap",
          "23P01",
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(applicabilitySettled, false);
        await firstClient.query("COMMIT");
        await applicabilityRejected;

        // assignment mutations enter the shared lock order
        await firstClient.query("BEGIN");
        await firstClient.query(
          "UPDATE storecalc.program_facility_assignments " +
            "SET lifecycle_generation = lifecycle_generation WHERE id = $1",
          [fixture.assignmentOne],
        );
        let publicationAfterAssignmentSettled = false;
        const publicationAfterAssignment = insertPublication(secondClient, {
          templateId: fixture.templateByName["Assignment Lock Template"],
          versionId: fixture.lockVersion,
          subjectId: fixture.subjectId,
        }).finally(() => {
          publicationAfterAssignmentSettled = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(publicationAfterAssignmentSettled, false);
        await firstClient.query("COMMIT");
        await publicationAfterAssignment;
      } finally {
        await resetRole(firstClient);
        await resetRole(secondClient);
        await firstClient.end();
        await secondClient.end();
      }

      await runMigrationSql(client, catalogPublicationVerifySql);

      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "GRANT SELECT ON storecalc.template_publications TO storecalc_test_outsider",
        ),
      );
      await expectRejected(
        runMigrationSql(client, catalogPublicationVerifySql),
        "unexpected_grantee",
        "P0001",
      );
      await expectRejected(
        runMigrationSql(client, catalogPublicationDownSql),
        "unexpected_grantee",
        "P0001",
      );
      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "REVOKE SELECT ON storecalc.template_publications FROM storecalc_test_outsider",
        ),
      );

      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "ALTER TABLE storecalc.template_publications DISABLE TRIGGER " +
            "template_publications_coherence_trigger",
        ),
      );
      await expectRejected(
        runMigrationSql(client, catalogPublicationVerifySql),
        "storecalc_catalog_publication_postflight_function_or_trigger_mismatch",
        "P0001",
      );
      await expectRejected(
        runMigrationSql(client, catalogPublicationDownSql),
        "storecalc_catalog_publication_postflight_function_or_trigger_mismatch",
        "P0001",
      );
      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "ALTER TABLE storecalc.template_publications ENABLE TRIGGER " +
            "template_publications_coherence_trigger",
        ),
      );

      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "UPDATE storecalc.schema_capabilities SET schema_version = 99 " +
            "WHERE capability_key = 'anonymous.calculation'",
        ),
      );
      await expectRejected(
        runMigrationSql(client, catalogPublicationVerifySql),
        "capability",
        "P0001",
      );
      await expectRejected(
        runMigrationSql(client, catalogPublicationDownSql),
        "capability",
        "P0001",
      );
      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "UPDATE storecalc.schema_capabilities SET schema_version = 9 " +
            "WHERE capability_key = 'anonymous.calculation'",
        ),
      );

      await runMigrationSql(client, catalogPublicationVerifySql);
      await expectRejected(
        runMigrationSql(client, catalogPublicationDownSql),
        "storecalc_catalog_publication_rollback_not_empty",
        "55000",
      );
      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "TRUNCATE storecalc.assignment_template_applicability, " +
            "storecalc.template_publications",
        ),
      );

      // rollback rejects used identity sequences
      await expectRejected(
        runMigrationSql(client, catalogPublicationDownSql),
        "storecalc_catalog_publication_rollback_sequence_used",
        "55000",
      );
      await resetSequences(client, CATALOG_PUBLICATION_SEQUENCES);

      await runMigrationSql(client, catalogPublicationDownSql);
      await runMigrationSql(client, evidenceVerifySql);
      assert.deepEqual(
        await versionBaseShape(client),
        evidenceBaseline,
        "catalog publication rollback did not restore source evidence",
      );

      await runMigrationSql(client, evidenceDownSql);
      await runMigrationSql(client, warningDownSql);
      await runMigrationSql(client, constraintDownSql);
      await runMigrationSql(client, taxDownSql);
      await runMigrationSql(client, bucketDownSql);
      await runMigrationSql(client, contentDownSql);

      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query("TRUNCATE storecalc.template_versions"),
      );
      await resetSequences(client, ["template_versions_id_seq"]);
      await runMigrationSql(client, versionDownSql);

      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "DELETE FROM storecalc.template_items; " +
            "DELETE FROM storecalc.template_categories; " +
            "DELETE FROM storecalc.templates",
        ),
      );
      await resetSequences(client, TEMPLATE_SEQUENCES);
      await runMigrationSql(client, templateDownSql);
      await runMigrationSql(client, programVerifySql);
      assert.deepEqual(
        await programShape(client),
        programFingerprint,
        "template rollback did not restore the program schema",
      );

      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "DELETE FROM storecalc.program_facility_assignments; " +
            "DELETE FROM storecalc.store_programs",
        ),
      );
      await resetSequences(client, PROGRAM_SEQUENCES);
      await runMigrationSql(client, programDownSql);
      await runMigrationSql(client, directoryVerifySql);
      assert.deepEqual(
        await directoryShape(client),
        directoryFingerprint,
        "program rollback did not restore the directory schema",
      );

      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "DELETE FROM storecalc.facilities; " +
            "DELETE FROM storecalc.countries; " +
            "DELETE FROM storecalc.contributor_subjects",
        ),
      );
      await resetSequences(client, DIRECTORY_SEQUENCES);
      await runMigrationSql(client, directoryDownSql);
      await runMigrationSql(client, foundationVerifySql);
      assert.deepEqual(
        await schemaFingerprint(client),
        foundationFingerprint,
        "directory rollback did not restore the foundation",
      );

      await client.query("DELETE FROM public.users WHERE id = $1", [userId]);
      await runMigrationSql(client, foundationDownSql);
      assert.deepEqual(
        await schemaFingerprint(client),
        originalFingerprint,
        "foundation rollback did not restore the original fingerprint",
      );
    } finally {
      await removeTestState(client).catch(() => null);
      await client.end();
    }
  },
);
