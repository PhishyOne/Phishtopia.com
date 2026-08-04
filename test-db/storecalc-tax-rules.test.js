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

test(
  "StoreCalc tax rules are scope-exact, lineage-safe, seal-serialized, isolated, and reversibly unused",
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

      const preBucketFingerprint = await schemaFingerprint(client);
      await expectRejected(
        runMigrationSql(client, taxUpSql),
        "storecalc_template_postflight_relation_mismatch",
        "P0001",
      );
      assert.deepEqual(
        await schemaFingerprint(client),
        preBucketFingerprint,
        "a rejected pre-bucket tax migration changed schema state",
      );

      await runMigrationSql(client, bucketUpSql);
      await runMigrationSql(client, bucketVerifySql);
      const bucketBaseline = await versionBaseShape(client);
      await runMigrationSql(client, taxUpSql);
      await runMigrationSql(client, taxVerifySql);

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
            schema_version: 5,
            is_available: false,
            verified_at: null,
            migration_key: "0008_tax_rules",
          },
        ],
      );

      for (const role of [ROLE_SETTINGS.web_role, ROLE_SETTINGS.worker_role]) {
        await runAsRole(client, role, async () => {
          await expectPermissionDenied(
            client.query("SELECT * FROM storecalc.version_tax_rules"),
          );
          await expectPermissionDenied(
            client.query(
              "SELECT nextval('storecalc.version_tax_rules_id_seq')",
            ),
          );
        });
      }

      await runAsRole(client, ROLE_SETTINGS.backup_role, async () => {
        assert.equal(
          (
            await client.query(
              "SELECT count(*)::integer AS count FROM storecalc.version_tax_rules",
            )
          ).rows[0].count,
          0,
        );
        await client.query(
          "SELECT last_value FROM storecalc.version_tax_rules_id_seq",
        );
        await expectPermissionDenied(
          client.query(
            "INSERT INTO storecalc.version_tax_rules (" +
              "version_id, scope_type, treatment_state, rate_ppm, " +
              "price_includes_tax, rounding_mode, rounding_scope, priority" +
              ") VALUES (1, 'template', 'known', 0, false, 'half_up', 'line', 1)",
          ),
        );
      });

      await runAsRole(client, OUTSIDER_ROLE, async () => {
        await expectPermissionDenied(
          client.query("SELECT * FROM storecalc.version_tax_rules"),
        );
      });

      const userId = (
        await client.query(
          "INSERT INTO public.users DEFAULT VALUES RETURNING id",
        )
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
                ") VALUES ('public', NULL, 'Tax Test Program', 'active', $1) " +
                "RETURNING id",
              [subjectId],
            )
          ).rows[0].id;
          const templates = await client.query(
            "INSERT INTO storecalc.templates (" +
              "program_id, visibility, owner_user_id, name, status, created_by_subject_id" +
              ") VALUES " +
              "($1, 'public', NULL, 'Primary Tax Template', 'active', $2), " +
              "($1, 'public', NULL, 'Other Tax Template', 'active', $2) " +
              "RETURNING id, name",
            [programId, subjectId],
          );
          const templateByName = Object.fromEntries(
            templates.rows.map((row) => [row.name, row.id]),
          );
          const primaryTemplateId = templateByName["Primary Tax Template"];
          const otherTemplateId = templateByName["Other Tax Template"];

          const categories = await client.query(
            "INSERT INTO storecalc.template_categories (" +
              "template_id, stable_key, created_by_subject_id" +
              ") VALUES ($1, 'food', $3), ($2, 'other', $3) " +
              "RETURNING id, stable_key",
            [primaryTemplateId, otherTemplateId, subjectId],
          );
          const categoryByKey = Object.fromEntries(
            categories.rows.map((row) => [row.stable_key, row.id]),
          );
          const items = await client.query(
            "INSERT INTO storecalc.template_items (" +
              "template_id, stable_key, created_by_subject_id" +
              ") VALUES ($1, 'synthetic_item', $3), ($2, 'other_item', $3) " +
              "RETURNING id, stable_key",
            [primaryTemplateId, otherTemplateId, subjectId],
          );
          const itemByKey = Object.fromEntries(
            items.rows.map((row) => [row.stable_key, row.id]),
          );

          const versionIds = {
            primaryOne: await insertVersion(client, {
              templateId: primaryTemplateId,
              versionNumber: 1,
              capabilities: TAX_CAPABILITIES,
              createdBySubjectId: subjectId,
            }),
            primaryTwo: await insertVersion(client, {
              templateId: primaryTemplateId,
              versionNumber: 2,
              capabilities: TAX_CAPABILITIES,
              createdBySubjectId: subjectId,
            }),
            otherOne: await insertVersion(client, {
              templateId: otherTemplateId,
              versionNumber: 1,
              capabilities: TAX_CAPABILITIES,
              createdBySubjectId: subjectId,
            }),
          };

          const categoryIds = {
            primaryOne: await insertVersionCategory(client, {
              versionId: versionIds.primaryOne,
              templateId: primaryTemplateId,
              categoryId: categoryByKey.food,
              displayName: "Food",
            }),
            primaryTwo: await insertVersionCategory(client, {
              versionId: versionIds.primaryTwo,
              templateId: primaryTemplateId,
              categoryId: categoryByKey.food,
              displayName: "Food",
            }),
            otherOne: await insertVersionCategory(client, {
              versionId: versionIds.otherOne,
              templateId: otherTemplateId,
              categoryId: categoryByKey.other,
              displayName: "Other",
            }),
          };
          const itemIds = {
            primaryOne: await insertVersionItem(client, {
              versionId: versionIds.primaryOne,
              templateId: primaryTemplateId,
              itemId: itemByKey.synthetic_item,
              categoryVersionId: categoryIds.primaryOne,
            }),
            primaryTwo: await insertVersionItem(client, {
              versionId: versionIds.primaryTwo,
              templateId: primaryTemplateId,
              itemId: itemByKey.synthetic_item,
              categoryVersionId: categoryIds.primaryTwo,
            }),
            otherOne: await insertVersionItem(client, {
              versionId: versionIds.otherOne,
              templateId: otherTemplateId,
              itemId: itemByKey.other_item,
              categoryVersionId: categoryIds.otherOne,
            }),
          };

          return {
            subjectId,
            programId,
            templateByName,
            versionIds,
            categoryIds,
            itemIds,
          };
        },
      );

      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, async () => {
        const versionId = fixture.versionIds.primaryOne;
        const templateRuleId = await insertTaxRule(client, {
          versionId,
          scopeType: "template",
          treatmentState: "known",
          ratePpm: 0,
          priceIncludesTax: false,
          roundingMode: "half_up",
          roundingScope: "line",
          priority: 10,
        });
        const categoryRuleId = await insertTaxRule(client, {
          versionId,
          scopeType: "category",
          categoryVersionId: fixture.categoryIds.primaryOne,
          treatmentState: "known",
          ratePpm: 50_000,
          priceIncludesTax: true,
          roundingMode: "floor",
          roundingScope: "line",
          priority: 20,
        });
        const itemRuleId = await insertTaxRule(client, {
          versionId,
          scopeType: "item",
          itemVersionId: fixture.itemIds.primaryOne,
          treatmentState: "known",
          ratePpm: 1_000_000,
          priceIncludesTax: false,
          roundingMode: "ceiling",
          roundingScope: "line",
          priority: 30,
        });
        const temporaryRuleId = await insertTaxRule(client, {
          versionId,
          scopeType: "category",
          categoryVersionId: fixture.categoryIds.primaryOne,
          treatmentState: "not_applicable",
          ratePpm: null,
          priceIncludesTax: null,
          roundingMode: null,
          roundingScope: null,
          priority: 40,
        });
        await insertTaxRule(client, {
          versionId,
          scopeType: "item",
          itemVersionId: fixture.itemIds.primaryOne,
          treatmentState: "unsupported",
          ratePpm: null,
          priceIncludesTax: null,
          roundingMode: null,
          roundingScope: null,
          priority: 40,
        });
        await insertTaxRule(client, {
          versionId: fixture.versionIds.otherOne,
          scopeType: "template",
          treatmentState: "unknown",
          ratePpm: null,
          priceIncludesTax: null,
          roundingMode: null,
          roundingScope: null,
          priority: 10,
        });

        await expectRejected(
          insertTaxRule(client, {
            versionId,
            scopeType: "template",
            priority: 10,
          }),
          "version_tax_rules_template_priority_key",
          "23505",
        );
        await expectRejected(
          insertTaxRule(client, {
            versionId,
            scopeType: "category",
            categoryVersionId: fixture.categoryIds.primaryOne,
            priority: 20,
          }),
          "version_tax_rules_category_priority_key",
          "23505",
        );
        await expectRejected(
          insertTaxRule(client, {
            versionId,
            scopeType: "item",
            itemVersionId: fixture.itemIds.primaryOne,
            priority: 30,
          }),
          "version_tax_rules_item_priority_key",
          "23505",
        );
        await expectRejected(
          insertTaxRule(client, {
            versionId,
            scopeType: "template",
            categoryVersionId: fixture.categoryIds.primaryOne,
            priority: 70,
          }),
          "version_tax_rules_scope_target_check",
          "23514",
        );
        await expectRejected(
          insertTaxRule(client, {
            versionId,
            scopeType: "category",
            categoryVersionId: null,
            priority: 71,
          }),
          "version_tax_rules_scope_target_check",
          "23514",
        );
        await expectRejected(
          insertTaxRule(client, {
            versionId,
            scopeType: "item",
            categoryVersionId: fixture.categoryIds.primaryOne,
            itemVersionId: fixture.itemIds.primaryOne,
            priority: 72,
          }),
          "version_tax_rules_scope_target_check",
          "23514",
        );
        await expectRejected(
          insertTaxRule(client, {
            versionId,
            scopeType: "category",
            categoryVersionId: fixture.categoryIds.primaryTwo,
            priority: 73,
          }),
          "version_tax_rules_category_version_fkey",
          "23503",
        );
        await expectRejected(
          insertTaxRule(client, {
            versionId,
            scopeType: "item",
            itemVersionId: fixture.itemIds.otherOne,
            priority: 74,
          }),
          "version_tax_rules_item_version_fkey",
          "23503",
        );
        await expectRejected(
          insertTaxRule(client, {
            versionId,
            treatmentState: "maybe",
            ratePpm: null,
            priceIncludesTax: null,
            roundingMode: null,
            roundingScope: null,
            priority: 75,
          }),
          "version_tax_rules_treatment_state_check",
          "23514",
        );
        await expectRejected(
          insertTaxRule(client, {
            versionId,
            treatmentState: "known",
            ratePpm: null,
            priority: 76,
          }),
          "version_tax_rules_treatment_nullability_check",
          "23514",
        );
        await expectRejected(
          insertTaxRule(client, {
            versionId,
            treatmentState: "unknown",
            ratePpm: 1,
            priceIncludesTax: null,
            roundingMode: null,
            roundingScope: null,
            priority: 77,
          }),
          "version_tax_rules_treatment_nullability_check",
          "23514",
        );
        await expectRejected(
          insertTaxRule(client, {
            versionId,
            ratePpm: -1,
            priority: 78,
          }),
          "version_tax_rules_rate_ppm_check",
          "23514",
        );
        await expectRejected(
          insertTaxRule(client, {
            versionId,
            ratePpm: 1_000_001,
            priority: 79,
          }),
          "version_tax_rules_rate_ppm_check",
          "23514",
        );
        await expectRejected(
          insertTaxRule(client, {
            versionId,
            roundingMode: "bankers",
            priority: 80,
          }),
          "version_tax_rules_rounding_mode_check",
          "23514",
        );
        await expectRejected(
          insertTaxRule(client, {
            versionId,
            roundingScope: "order",
            priority: 81,
          }),
          "version_tax_rules_rounding_scope_check",
          "23514",
        );
        await expectRejected(
          insertTaxRule(client, {
            versionId,
            priority: -1,
          }),
          "version_tax_rules_priority_check",
          "23514",
        );

        await client.query(
          "UPDATE storecalc.version_tax_rules " +
            "SET rate_ppm = 1000 WHERE id = $1",
          [templateRuleId],
        );
        await client.query(
          "DELETE FROM storecalc.version_tax_rules WHERE id = $1",
          [temporaryRuleId],
        );
        assert.ok(categoryRuleId > 0);
        assert.ok(itemRuleId > 0);

        await client.query(
          "UPDATE storecalc.template_versions " +
            "SET content_state = 'sealed', hash_algorithm = 'sha256', " +
            "content_hash = $2, sealed_at = transaction_timestamp() " +
            "WHERE id = $1",
          [versionId, "b".repeat(64)],
        );

        await expectRejected(
          client.query(
            "UPDATE storecalc.version_tax_rules " +
              "SET rate_ppm = 2000 WHERE id = $1",
            [templateRuleId],
          ),
          "storecalc_sealed_version_content_immutable",
          "55000",
        );
        await expectRejected(
          client.query(
            "DELETE FROM storecalc.version_tax_rules WHERE id = $1",
            [categoryRuleId],
          ),
          "storecalc_sealed_version_content_immutable",
          "55000",
        );
        await expectRejected(
          insertTaxRule(client, {
            versionId,
            priority: 99,
          }),
          "storecalc_sealed_version_content_immutable",
          "55000",
        );
      });

      const firstClient = await openMigrationClient(connectionString);
      const secondClient = await openMigrationClient(connectionString);
      try {
        await firstClient.query("BEGIN");
        await insertTaxRule(firstClient, {
          versionId: fixture.versionIds.primaryTwo,
          scopeType: "template",
          priority: 10,
        });

        let sealSettled = false;
        const sealVersion = secondClient
          .query(
            "UPDATE storecalc.template_versions " +
              "SET content_state = 'sealed', hash_algorithm = 'sha256', " +
              "content_hash = $2, sealed_at = transaction_timestamp() " +
              "WHERE id = $1",
            [fixture.versionIds.primaryTwo, "c".repeat(64)],
          )
          .finally(() => {
            sealSettled = true;
          });
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(
          sealSettled,
          false,
          "version sealing bypassed the tax topology lock",
        );
        await firstClient.query("COMMIT");
        assert.equal((await sealVersion).rowCount, 1);
        await expectRejected(
          insertTaxRule(secondClient, {
            versionId: fixture.versionIds.primaryTwo,
            priority: 20,
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

      await runMigrationSql(client, taxVerifySql);
      await expectRejected(
        runMigrationSql(client, taxDownSql),
        "storecalc_tax_rules_rollback_not_empty",
        "55000",
      );

      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query("TRUNCATE storecalc.version_tax_rules"),
      );
      await expectRejected(
        runMigrationSql(client, taxDownSql),
        "storecalc_tax_rules_rollback_sequence_used",
        "55000",
      );
      await resetSequences(client, TAX_SEQUENCES);

      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "ALTER TABLE storecalc.version_tax_rules " +
            "DROP CONSTRAINT version_tax_rules_scope_target_check; " +
            "ALTER TABLE storecalc.version_tax_rules " +
            "ADD CONSTRAINT version_tax_rules_scope_target_check CHECK (true)",
        ),
      );
      await expectRejected(
        runMigrationSql(client, taxVerifySql),
        "storecalc_tax_rules_postflight_constraint_definition_mismatch",
        "P0001",
      );
      await expectRejected(
        runMigrationSql(client, taxDownSql),
        "storecalc_tax_rules_postflight_constraint_definition_mismatch",
        "P0001",
      );
      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "ALTER TABLE storecalc.version_tax_rules " +
            "DROP CONSTRAINT version_tax_rules_scope_target_check; " +
            "ALTER TABLE storecalc.version_tax_rules " +
            "ADD CONSTRAINT version_tax_rules_scope_target_check CHECK (" +
            "(scope_type = 'template' AND category_version_id IS NULL AND item_version_id IS NULL) " +
            "OR (scope_type = 'category' AND category_version_id IS NOT NULL AND item_version_id IS NULL) " +
            "OR (scope_type = 'item' AND category_version_id IS NULL AND item_version_id IS NOT NULL)" +
            ")",
        ),
      );

      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "GRANT SELECT ON storecalc.version_tax_rules " +
            "TO storecalc_test_outsider",
        ),
      );
      await expectRejected(
        runMigrationSql(client, taxVerifySql),
        "unexpected_grantee",
        "P0001",
      );
      await expectRejected(
        runMigrationSql(client, taxDownSql),
        "unexpected_grantee",
        "P0001",
      );
      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "REVOKE SELECT ON storecalc.version_tax_rules " +
            "FROM storecalc_test_outsider",
        ),
      );

      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "ALTER TABLE storecalc.version_tax_rules DISABLE TRIGGER " +
            "version_tax_rules_content_mutability_trigger",
        ),
      );
      await expectRejected(
        runMigrationSql(client, taxVerifySql),
        "storecalc_tax_rules_postflight_trigger_mismatch",
        "P0001",
      );
      await expectRejected(
        runMigrationSql(client, taxDownSql),
        "storecalc_tax_rules_postflight_trigger_mismatch",
        "P0001",
      );
      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "ALTER TABLE storecalc.version_tax_rules ENABLE TRIGGER " +
            "version_tax_rules_content_mutability_trigger",
        ),
      );

      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "UPDATE storecalc.schema_capabilities SET schema_version = 99 " +
            "WHERE capability_key = 'anonymous.calculation'",
        ),
      );
      await expectRejected(
        runMigrationSql(client, taxVerifySql),
        "capability_or_seed_mismatch",
        "P0001",
      );
      await expectRejected(
        runMigrationSql(client, taxDownSql),
        "capability_or_seed_mismatch",
        "P0001",
      );
      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "UPDATE storecalc.schema_capabilities SET schema_version = 5 " +
            "WHERE capability_key = 'anonymous.calculation'",
        ),
      );

      await runMigrationSql(client, taxVerifySql);
      const installedShape = await versionBaseShape(client);
      await expectRejected(
        runMigrationSql(client, taxUpSql),
        "storecalc_template_postflight_relation_mismatch",
        "P0001",
      );
      assert.deepEqual(
        await versionBaseShape(client),
        installedShape,
        "a rejected tax migration rerun changed database state",
      );

      await runMigrationSql(client, taxDownSql);
      await runMigrationSql(client, bucketVerifySql);
      assert.deepEqual(
        await versionBaseShape(client),
        bucketBaseline,
        "tax rollback did not restore the bucket schema",
      );

      await runMigrationSql(client, bucketDownSql);

      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "TRUNCATE storecalc.version_items, storecalc.version_categories",
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
