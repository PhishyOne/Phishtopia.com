import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

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

test(
  "StoreCalc V1 warnings are typed, seal-serialized, isolated, and reversibly unused",
  { timeout: 60_000 },
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

      const preConstraintFingerprint = await schemaFingerprint(client);
      await expectRejected(
        runMigrationSql(client, warningUpSql),
        "storecalc_template_postflight_relation_mismatch",
        "P0001",
      );
      assert.deepEqual(
        await schemaFingerprint(client),
        preConstraintFingerprint,
        "a rejected pre-constraint warning migration changed schema state",
      );

      await runMigrationSql(client, constraintUpSql);
      await runMigrationSql(client, constraintVerifySql);
      const constraintBaseline = await versionBaseShape(client);
      await runMigrationSql(client, warningUpSql);
      await runMigrationSql(client, warningVerifySql);

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
            schema_version: 7,
            is_available: false,
            verified_at: null,
            migration_key: "0010_warnings",
          },
        ],
      );

      for (const role of [ROLE_SETTINGS.web_role, ROLE_SETTINGS.worker_role]) {
        await runAsRole(client, role, async () => {
          await expectPermissionDenied(
            client.query("SELECT * FROM storecalc.version_warnings"),
          );
          await expectPermissionDenied(
            client.query("SELECT nextval('storecalc.version_warnings_id_seq')"),
          );
        });
      }

      await runAsRole(client, ROLE_SETTINGS.backup_role, async () => {
        assert.equal(
          (await client.query("SELECT count(*) FROM storecalc.version_warnings"))
            .rows[0].count,
          "0",
        );
        assert.equal(
          (
            await client.query(
              "SELECT last_value FROM storecalc.version_warnings_id_seq",
            )
          ).rows[0].last_value,
          "1",
        );
        await expectPermissionDenied(
          client.query(
            "INSERT INTO storecalc.version_warnings (" +
              "version_id, warning_code, severity, scope_type, message_key" +
              ") VALUES (1, 'denied', 'warning', 'template', " +
              "'storecalc.warning.denied')",
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
          const programId = (
            await client.query(
              "INSERT INTO storecalc.store_programs (" +
                "record_scope, owner_user_id, name, status, created_by_subject_id" +
                ") VALUES ('public', NULL, 'Warning Test Program', 'active', $1) " +
                "RETURNING id",
              [subjectId],
            )
          ).rows[0].id;
          const templateId = (
            await client.query(
              "INSERT INTO storecalc.templates (" +
                "program_id, visibility, owner_user_id, name, status, created_by_subject_id" +
                ") VALUES ($1, 'public', NULL, 'Warning Test Template', 'active', $2) " +
                "RETURNING id",
              [programId, subjectId],
            )
          ).rows[0].id;
          const templateItems = await client.query(
            "INSERT INTO storecalc.template_items (" +
              "template_id, stable_key, created_by_subject_id" +
              ") VALUES " +
              "($1, 'first_item', $2), ($1, 'second_item', $2) " +
              "RETURNING id, stable_key",
            [templateId, subjectId],
          );
          const itemByKey = Object.fromEntries(
            templateItems.rows.map((row) => [row.stable_key, row.id]),
          );
          const versionOne = await insertVersion(client, {
            templateId,
            versionNumber: 1,
            createdBySubjectId: subjectId,
          });
          const versionTwo = await insertVersion(client, {
            templateId,
            versionNumber: 2,
            createdBySubjectId: subjectId,
          });
          const firstVersionItem = await insertVersionItem(client, {
            versionId: versionOne,
            templateId,
            itemId: itemByKey.first_item,
            displayName: "First item",
            sortOrder: 10,
          });
          const secondVersionItem = await insertVersionItem(client, {
            versionId: versionOne,
            templateId,
            itemId: itemByKey.second_item,
            displayName: "Second item",
            sortOrder: 20,
          });
          const otherVersionItem = await insertVersionItem(client, {
            versionId: versionTwo,
            templateId,
            itemId: itemByKey.first_item,
            displayName: "First item",
            sortOrder: 10,
          });

          return {
            subjectId,
            programId,
            templateId,
            versionOne,
            versionTwo,
            firstVersionItem,
            secondVersionItem,
            otherVersionItem,
          };
        },
      );

      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, async () => {
        const templateWarningId = await insertVersionWarning(client, {
          versionId: fixture.versionOne,
          warningCode: "catalog.notice",
          messageKey: "storecalc.warning.catalog_notice",
        });
        const itemWarningId = await insertVersionWarning(client, {
          versionId: fixture.versionOne,
          warningCode: "item.notice",
          severity: "informational",
          scopeType: "item",
          itemVersionId: fixture.firstVersionItem,
          messageKey: "storecalc.warning.item_notice",
        });
        await insertVersionWarning(client, {
          versionId: fixture.versionOne,
          warningCode: "item.notice",
          severity: "informational",
          scopeType: "item",
          itemVersionId: fixture.secondVersionItem,
          messageKey: "storecalc.warning.item_notice",
        });
        const temporaryId = await insertVersionWarning(client, {
          versionId: fixture.versionOne,
          warningCode: "temporary.notice",
        });

        await expectRejected(
          insertVersionWarning(client, {
            versionId: fixture.versionOne,
            warningCode: "catalog.notice",
            messageKey: "storecalc.warning.catalog_notice",
          }),
          "version_warnings_template_identity_idx",
          "23505",
        );
        await expectRejected(
          insertVersionWarning(client, {
            versionId: fixture.versionOne,
            warningCode: "item.notice",
            severity: "informational",
            scopeType: "item",
            itemVersionId: fixture.firstVersionItem,
            messageKey: "storecalc.warning.item_notice",
          }),
          "version_warnings_item_identity_idx",
          "23505",
        );
        await expectRejected(
          insertVersionWarning(client, {
            versionId: 2_000_000_000,
            warningCode: "missing.version",
          }),
          "storecalc_version_content_parent_missing",
          "23503",
        );
        await expectRejected(
          insertVersionWarning(client, {
            versionId: fixture.versionOne,
            warningCode: "cross.version",
            scopeType: "item",
            itemVersionId: fixture.otherVersionItem,
          }),
          "version_warnings_item_version_fkey",
          "23503",
        );

        const invalidCases = [
          {
            values: { warningCode: "Uppercase" },
            constraint: "version_warnings_warning_code_check",
          },
          {
            values: { warningCode: "bad_severity", severity: "hard_error" },
            constraint: "version_warnings_severity_check",
          },
          {
            values: {
              warningCode: "template_target",
              itemVersionId: fixture.firstVersionItem,
            },
            constraint: "version_warnings_target_check",
          },
          {
            values: {
              warningCode: "item_target",
              scopeType: "item",
            },
            constraint: "version_warnings_target_check",
          },
          {
            values: {
              warningCode: "category_target",
              categoryVersionId: 1,
            },
            constraint: "version_warnings_target_check",
          },
          {
            values: { warningCode: "bad_message", messageKey: "bad" },
            constraint: "version_warnings_message_key_check",
          },
          {
            values: {
              warningCode: "details_not_supported",
              boundedDetails: { detail: "not yet supported" },
            },
            constraint: "version_warnings_bounded_details_check",
          },
        ];

        for (const invalidCase of invalidCases) {
          await expectRejected(
            insertVersionWarning(client, {
              versionId: fixture.versionOne,
              ...invalidCase.values,
            }),
            invalidCase.constraint,
            "23514",
          );
        }

        await client.query(
          "UPDATE storecalc.version_warnings " +
            "SET message_key = 'storecalc.warning.catalog_updated' WHERE id = $1",
          [templateWarningId],
        );
        await client.query("DELETE FROM storecalc.version_warnings WHERE id = $1", [
          temporaryId,
        ]);

        await client.query(
          "UPDATE storecalc.template_versions " +
            "SET content_state = 'sealed', hash_algorithm = 'sha256', " +
            "content_hash = $2, sealed_at = transaction_timestamp() " +
            "WHERE id = $1",
          [fixture.versionOne, "f".repeat(64)],
        );

        await expectRejected(
          client.query(
            "UPDATE storecalc.version_warnings " +
              "SET message_key = 'storecalc.warning.forbidden' WHERE id = $1",
            [itemWarningId],
          ),
          "storecalc_sealed_version_content_immutable",
          "55000",
        );
        await expectRejected(
          client.query("DELETE FROM storecalc.version_warnings WHERE id = $1", [
            templateWarningId,
          ]),
          "storecalc_sealed_version_content_immutable",
          "55000",
        );
        await expectRejected(
          insertVersionWarning(client, {
            versionId: fixture.versionOne,
            warningCode: "sealed.insert",
          }),
          "storecalc_sealed_version_content_immutable",
          "55000",
        );
      });

      const firstClient = await openMigrationClient(connectionString);
      const secondClient = await openMigrationClient(connectionString);
      try {
        await firstClient.query("BEGIN");
        await insertVersionWarning(firstClient, {
          versionId: fixture.versionTwo,
          warningCode: "concurrent.notice",
          scopeType: "item",
          itemVersionId: fixture.otherVersionItem,
        });

        let sealSettled = false;
        const sealVersion = secondClient
          .query(
            "UPDATE storecalc.template_versions " +
              "SET content_state = 'sealed', hash_algorithm = 'sha256', " +
              "content_hash = $2, sealed_at = transaction_timestamp() " +
              "WHERE id = $1",
            [fixture.versionTwo, "a".repeat(64)],
          )
          .finally(() => {
            sealSettled = true;
          });
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(
          sealSettled,
          false,
          "version sealing bypassed the warning topology lock",
        );
        await firstClient.query("COMMIT");
        assert.equal((await sealVersion).rowCount, 1);
        await expectRejected(
          insertVersionWarning(secondClient, {
            versionId: fixture.versionTwo,
            warningCode: "late.notice",
          }),
          "storecalc_sealed_version_content_immutable",
          "55000",
        );
      } finally {
        await resetRole(firstClient);
        await resetRole(secondClient);
        await firstClient.end();
        await secondClient.end();
      }

      await runMigrationSql(client, warningVerifySql);
      await expectRejected(
        runMigrationSql(client, warningDownSql),
        "storecalc_version_warnings_rollback_not_empty",
        "55000",
      );

      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query("TRUNCATE storecalc.version_warnings"),
      );
      await expectRejected(
        runMigrationSql(client, warningDownSql),
        "storecalc_version_warnings_rollback_sequence_used",
        "55000",
      );
      await resetSequences(client, WARNING_SEQUENCES);

      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "ALTER TABLE storecalc.version_warnings " +
            "DROP CONSTRAINT version_warnings_bounded_details_check; " +
            "ALTER TABLE storecalc.version_warnings " +
            "ADD CONSTRAINT version_warnings_bounded_details_check CHECK (true)",
        ),
      );
      await expectRejected(
        runMigrationSql(client, warningVerifySql),
        "storecalc_version_warnings_postflight_constraint_definition_mismatch",
        "P0001",
      );
      await expectRejected(
        runMigrationSql(client, warningDownSql),
        "storecalc_version_warnings_postflight_constraint_definition_mismatch",
        "P0001",
      );
      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "ALTER TABLE storecalc.version_warnings " +
            "DROP CONSTRAINT version_warnings_bounded_details_check; " +
            "ALTER TABLE storecalc.version_warnings " +
            "ADD CONSTRAINT version_warnings_bounded_details_check " +
            "CHECK (bounded_details = '{}'::jsonb)",
        ),
      );

      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "GRANT SELECT ON storecalc.version_warnings TO storecalc_test_outsider",
        ),
      );
      await expectRejected(
        runMigrationSql(client, warningVerifySql),
        "unexpected_grantee",
        "P0001",
      );
      await expectRejected(
        runMigrationSql(client, warningDownSql),
        "unexpected_grantee",
        "P0001",
      );
      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "REVOKE SELECT ON storecalc.version_warnings FROM storecalc_test_outsider",
        ),
      );

      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "ALTER TABLE storecalc.version_warnings DISABLE TRIGGER " +
            "version_warnings_content_mutability_trigger",
        ),
      );
      await expectRejected(
        runMigrationSql(client, warningVerifySql),
        "storecalc_version_warnings_postflight_trigger_mismatch",
        "P0001",
      );
      await expectRejected(
        runMigrationSql(client, warningDownSql),
        "storecalc_version_warnings_postflight_trigger_mismatch",
        "P0001",
      );
      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "ALTER TABLE storecalc.version_warnings ENABLE TRIGGER " +
            "version_warnings_content_mutability_trigger",
        ),
      );

      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "UPDATE storecalc.schema_capabilities SET schema_version = 99 " +
            "WHERE capability_key = 'anonymous.calculation'",
        ),
      );
      await expectRejected(
        runMigrationSql(client, warningVerifySql),
        "capability_or_seed_mismatch",
        "P0001",
      );
      await expectRejected(
        runMigrationSql(client, warningDownSql),
        "capability_or_seed_mismatch",
        "P0001",
      );
      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "UPDATE storecalc.schema_capabilities SET schema_version = 7 " +
            "WHERE capability_key = 'anonymous.calculation'",
        ),
      );

      await runMigrationSql(client, warningVerifySql);
      const installedShape = await versionBaseShape(client);
      await expectRejected(
        runMigrationSql(client, warningUpSql),
        "storecalc_template_postflight_relation_mismatch",
        "P0001",
      );
      assert.deepEqual(
        await versionBaseShape(client),
        installedShape,
        "a rejected warning migration rerun changed database state",
      );

      await runMigrationSql(client, warningDownSql);
      await runMigrationSql(client, constraintVerifySql);
      assert.deepEqual(
        await versionBaseShape(client),
        constraintBaseline,
        "warning rollback did not restore the order-constraint schema",
      );

      await runMigrationSql(client, constraintDownSql);
      await runMigrationSql(client, taxDownSql);
      await runMigrationSql(client, bucketDownSql);

      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "DELETE FROM storecalc.version_items; " +
            "DELETE FROM storecalc.version_categories",
        ),
      );
      await resetSequences(client, CONTENT_SEQUENCES);
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
        client.query("DELETE FROM storecalc.store_programs"),
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
        client.query("DELETE FROM storecalc.contributor_subjects"),
      );
      await resetSequences(client, DIRECTORY_SEQUENCES);
      await runMigrationSql(client, directoryDownSql);
      await runMigrationSql(client, foundationVerifySql);
      assert.deepEqual(
        await schemaFingerprint(client),
        foundationFingerprint,
        "directory rollback did not restore the foundation",
      );
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
