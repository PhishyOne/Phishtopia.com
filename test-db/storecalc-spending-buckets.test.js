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

test(
  "StoreCalc spending buckets are parallel, lineage-safe, seal-serialized, isolated, and reversibly unused",
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

      const preContentFingerprint = await schemaFingerprint(client);
      await expectRejected(
        runMigrationSql(client, bucketUpSql),
        "storecalc_template_postflight_relation_mismatch",
        "P0001",
      );
      assert.deepEqual(
        await schemaFingerprint(client),
        preContentFingerprint,
        "a rejected pre-content bucket migration changed schema state",
      );

      await runMigrationSql(client, contentUpSql);
      await runMigrationSql(client, contentVerifySql);
      const contentBaseline = await versionBaseShape(client);
      await runMigrationSql(client, bucketUpSql);
      await runMigrationSql(client, bucketVerifySql);

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
            schema_version: 4,
            is_available: false,
            verified_at: null,
            migration_key: "0007_buckets",
          },
        ],
      );

      for (const role of [ROLE_SETTINGS.web_role, ROLE_SETTINGS.worker_role]) {
        await runAsRole(client, role, async () => {
          for (const table of [
            "version_spending_buckets",
            "version_item_bucket_memberships",
          ]) {
            await expectPermissionDenied(
              client.query("SELECT * FROM storecalc." + table),
            );
          }
          await expectPermissionDenied(
            client.query(
              "SELECT nextval('storecalc.version_spending_buckets_id_seq')",
            ),
          );
        });
      }

      await runAsRole(client, ROLE_SETTINGS.backup_role, async () => {
        for (const table of [
          "version_spending_buckets",
          "version_item_bucket_memberships",
        ]) {
          assert.equal(
            (
              await client.query(
                "SELECT count(*)::integer AS count FROM storecalc." + table,
              )
            ).rows[0].count,
            0,
          );
        }
        await client.query(
          "SELECT last_value FROM storecalc.version_spending_buckets_id_seq",
        );
        await expectPermissionDenied(
          client.query(
            "INSERT INTO storecalc.version_spending_buckets (" +
              "version_id, stable_key, display_name, limit_state, limit_minor, " +
              "measure_currency_code, is_primary_display, sort_order" +
              ") VALUES (1, 'denied', 'Denied', 'known', 1, 'USD', false, 1)",
          ),
        );
      });

      await runAsRole(client, OUTSIDER_ROLE, async () => {
        await expectPermissionDenied(
          client.query("SELECT * FROM storecalc.version_spending_buckets"),
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
                ") VALUES ('public', NULL, 'Bucket Test Program', 'active', $1) " +
                "RETURNING id",
              [subjectId],
            )
          ).rows[0].id;
          const templates = await client.query(
            "INSERT INTO storecalc.templates (" +
              "program_id, visibility, owner_user_id, name, status, created_by_subject_id" +
              ") VALUES " +
              "($1, 'public', NULL, 'Primary Bucket Template', 'active', $2), " +
              "($1, 'public', NULL, 'Other Bucket Template', 'active', $2) " +
              "RETURNING id, name",
            [programId, subjectId],
          );
          const templateByName = Object.fromEntries(
            templates.rows.map((row) => [row.name, row.id]),
          );
          const primaryTemplateId = templateByName["Primary Bucket Template"];
          const otherTemplateId = templateByName["Other Bucket Template"];

          const stableItems = await client.query(
            "INSERT INTO storecalc.template_items (" +
              "template_id, stable_key, created_by_subject_id" +
              ") VALUES " +
              "($1, 'synthetic_soup', $3), " +
              "($1, 'synthetic_soap', $3), " +
              "($2, 'other_item', $3) " +
              "RETURNING id, stable_key",
            [primaryTemplateId, otherTemplateId, subjectId],
          );
          const itemByKey = Object.fromEntries(
            stableItems.rows.map((row) => [row.stable_key, row.id]),
          );

          const versionIds = {
            primaryOne: await insertVersion(client, {
              templateId: primaryTemplateId,
              versionNumber: 1,
              capabilities: BUCKET_CAPABILITIES,
              createdBySubjectId: subjectId,
            }),
            primaryTwo: await insertVersion(client, {
              templateId: primaryTemplateId,
              versionNumber: 2,
              capabilities: BUCKET_CAPABILITIES,
              createdBySubjectId: subjectId,
            }),
            otherOne: await insertVersion(client, {
              templateId: otherTemplateId,
              versionNumber: 1,
              capabilities: BUCKET_CAPABILITIES,
              createdBySubjectId: subjectId,
            }),
          };

          const itemIds = {
            soupOne: await insertVersionItem(client, {
              versionId: versionIds.primaryOne,
              templateId: primaryTemplateId,
              itemId: itemByKey.synthetic_soup,
              displayName: "Synthetic soup",
            }),
            soapOne: await insertVersionItem(client, {
              versionId: versionIds.primaryOne,
              templateId: primaryTemplateId,
              itemId: itemByKey.synthetic_soap,
              displayName: "Synthetic soap",
            }),
            otherOne: await insertVersionItem(client, {
              versionId: versionIds.otherOne,
              templateId: otherTemplateId,
              itemId: itemByKey.other_item,
              displayName: "Other synthetic item",
            }),
          };

          return {
            subjectId,
            programId,
            templateByName,
            versionIds,
            itemIds,
          };
        },
      );

      const bucketIds = await runAsRole(
        client,
        ROLE_SETTINGS.migration_owner_role,
        async () => {
          const primaryVersionId = fixture.versionIds.primaryOne;
          const mainId = await insertSpendingBucket(client, {
            versionId: primaryVersionId,
            stableKey: "main",
            displayName: "Main limit",
            limitState: "known",
            limitMinor: 600,
            isPrimaryDisplay: true,
            sortOrder: 10,
          });
          const foodId = await insertSpendingBucket(client, {
            versionId: primaryVersionId,
            stableKey: "food",
            displayName: "Food limit",
            limitState: "known",
            limitMinor: 200,
            sortOrder: 20,
          });
          const unknownId = await insertSpendingBucket(client, {
            versionId: primaryVersionId,
            stableKey: "uncertain",
            displayName: "Uncertain limit",
            limitState: "unknown",
            limitMinor: null,
            sortOrder: 30,
          });
          const unlimitedId = await insertSpendingBucket(client, {
            versionId: primaryVersionId,
            stableKey: "unlimited",
            displayName: "Unlimited total",
            limitState: "unlimited",
            limitMinor: null,
            sortOrder: 40,
          });
          const notApplicableId = await insertSpendingBucket(client, {
            versionId: primaryVersionId,
            stableKey: "not_applicable",
            displayName: "Not applicable total",
            limitState: "not_applicable",
            limitMinor: null,
            sortOrder: 50,
          });
          const unsupportedId = await insertSpendingBucket(client, {
            versionId: primaryVersionId,
            stableKey: "unsupported",
            displayName: "Unsupported total",
            limitState: "unsupported",
            limitMinor: null,
            sortOrder: 60,
          });
          const otherId = await insertSpendingBucket(client, {
            versionId: fixture.versionIds.otherOne,
            stableKey: "other",
            displayName: "Other limit",
            limitState: "known",
            limitMinor: 100,
          });

          await expectRejected(
            insertSpendingBucket(client, {
              versionId: primaryVersionId,
              stableKey: "main",
            }),
            "version_spending_buckets_version_stable_key_key",
            "23505",
          );
          await expectRejected(
            insertSpendingBucket(client, {
              versionId: primaryVersionId,
              stableKey: "second_primary",
              isPrimaryDisplay: true,
            }),
            "version_spending_buckets_primary_display_key",
            "23505",
          );
          await expectRejected(
            insertSpendingBucket(client, {
              versionId: primaryVersionId,
              stableKey: "known_without_value",
              limitState: "known",
              limitMinor: null,
            }),
            "version_spending_buckets_limit_nullability_check",
            "23514",
          );
          await expectRejected(
            insertSpendingBucket(client, {
              versionId: primaryVersionId,
              stableKey: "unlimited_with_value",
              limitState: "unlimited",
              limitMinor: 1,
            }),
            "version_spending_buckets_limit_nullability_check",
            "23514",
          );
          await expectRejected(
            insertSpendingBucket(client, {
              versionId: primaryVersionId,
              stableKey: "invalid_state",
              limitState: "maybe",
              limitMinor: null,
            }),
            "version_spending_buckets_limit_",
            "23514",
          );
          await expectRejected(
            insertSpendingBucket(client, {
              versionId: primaryVersionId,
              stableKey: "wrong_currency",
              measureCurrencyCode: "EUR",
            }),
            "version_spending_buckets_measure_currency_code_check",
            "23514",
          );
          await expectRejected(
            insertSpendingBucket(client, {
              versionId: primaryVersionId,
              stableKey: "Bad-Key",
            }),
            "version_spending_buckets_stable_key_check",
            "23514",
          );
          await expectRejected(
            insertSpendingBucket(client, {
              versionId: primaryVersionId,
              stableKey: "bad_sort",
              sortOrder: -1,
            }),
            "version_spending_buckets_sort_order_check",
            "23514",
          );

          await insertBucketMembership(client, {
            versionItemId: fixture.itemIds.soupOne,
            versionId: primaryVersionId,
            spendingBucketId: mainId,
            membershipType: "counts_toward",
            primaryDisplay: true,
          });
          await insertBucketMembership(client, {
            versionItemId: fixture.itemIds.soupOne,
            versionId: primaryVersionId,
            spendingBucketId: foodId,
            membershipType: "counts_toward",
          });
          await insertBucketMembership(client, {
            versionItemId: fixture.itemIds.soupOne,
            versionId: primaryVersionId,
            spendingBucketId: unknownId,
            membershipType: "informational_only",
          });
          await insertBucketMembership(client, {
            versionItemId: fixture.itemIds.soapOne,
            versionId: primaryVersionId,
            spendingBucketId: foodId,
            membershipType: "excluded",
            primaryDisplay: true,
          });

          await expectRejected(
            insertBucketMembership(client, {
              versionItemId: fixture.itemIds.soupOne,
              versionId: primaryVersionId,
              spendingBucketId: mainId,
            }),
            "version_item_bucket_memberships_pkey",
            "23505",
          );
          await expectRejected(
            insertBucketMembership(client, {
              versionItemId: fixture.itemIds.soupOne,
              versionId: primaryVersionId,
              spendingBucketId: unlimitedId,
              primaryDisplay: true,
            }),
            "version_item_bucket_memberships_primary_display_key",
            "23505",
          );
          await expectRejected(
            insertBucketMembership(client, {
              versionItemId: fixture.itemIds.soupOne,
              versionId: primaryVersionId,
              spendingBucketId: otherId,
            }),
            "version_item_bucket_memberships_spending_bucket_version_fkey",
            "23503",
          );
          await expectRejected(
            insertBucketMembership(client, {
              versionItemId: fixture.itemIds.otherOne,
              versionId: primaryVersionId,
              spendingBucketId: notApplicableId,
            }),
            "version_item_bucket_memberships_version_item_fkey",
            "23503",
          );
          await expectRejected(
            insertBucketMembership(client, {
              versionItemId: fixture.itemIds.soapOne,
              versionId: primaryVersionId,
              spendingBucketId: unsupportedId,
              membershipType: "stacked",
            }),
            "version_item_bucket_memberships_membership_type_check",
            "23514",
          );

          await client.query(
            "UPDATE storecalc.version_spending_buckets " +
              "SET limit_minor = 250 WHERE id = $1",
            [foodId],
          );
          await client.query(
            "UPDATE storecalc.version_item_bucket_memberships " +
              "SET membership_type = 'excluded' " +
              "WHERE version_item_id = $1 AND spending_bucket_id = $2",
            [fixture.itemIds.soupOne, unknownId],
          );
          await client.query(
            "DELETE FROM storecalc.version_item_bucket_memberships " +
              "WHERE version_item_id = $1 AND spending_bucket_id = $2",
            [fixture.itemIds.soapOne, foodId],
          );

          await client.query(
            "UPDATE storecalc.template_versions " +
              "SET content_state = 'sealed', hash_algorithm = 'sha256', " +
              "content_hash = $2, sealed_at = transaction_timestamp() " +
              "WHERE id = $1",
            [primaryVersionId, "f".repeat(64)],
          );

          await expectRejected(
            client.query(
              "UPDATE storecalc.version_spending_buckets " +
                "SET display_name = 'Changed after seal' WHERE id = $1",
              [mainId],
            ),
            "storecalc_sealed_version_content_immutable",
            "55000",
          );
          await expectRejected(
            client.query(
              "DELETE FROM storecalc.version_item_bucket_memberships " +
                "WHERE version_item_id = $1 AND spending_bucket_id = $2",
              [fixture.itemIds.soupOne, foodId],
            ),
            "storecalc_sealed_version_content_immutable",
            "55000",
          );
          await expectRejected(
            insertSpendingBucket(client, {
              versionId: primaryVersionId,
              stableKey: "late",
            }),
            "storecalc_sealed_version_content_immutable",
            "55000",
          );

          return { mainId, foodId };
        },
      );
      assert.ok(bucketIds.mainId > 0);
      assert.ok(bucketIds.foodId > 0);

      const firstClient = await openMigrationClient(connectionString);
      const secondClient = await openMigrationClient(connectionString);
      try {
        await firstClient.query("BEGIN");
        await insertSpendingBucket(firstClient, {
          versionId: fixture.versionIds.primaryTwo,
          stableKey: "concurrent",
          displayName: "Concurrent bucket",
        });

        let sealSettled = false;
        const sealVersion = secondClient
          .query(
            "UPDATE storecalc.template_versions " +
              "SET content_state = 'sealed', hash_algorithm = 'sha256', " +
              "content_hash = $2, sealed_at = transaction_timestamp() " +
              "WHERE id = $1",
            [fixture.versionIds.primaryTwo, "a".repeat(64)],
          )
          .finally(() => {
            sealSettled = true;
          });
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(
          sealSettled,
          false,
          "version sealing bypassed the bucket topology lock",
        );
        await firstClient.query("COMMIT");
        assert.equal((await sealVersion).rowCount, 1);
        await expectRejected(
          insertSpendingBucket(secondClient, {
            versionId: fixture.versionIds.primaryTwo,
            stableKey: "after_seal",
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

      await runMigrationSql(client, bucketVerifySql);
      await expectRejected(
        runMigrationSql(client, bucketDownSql),
        "storecalc_spending_buckets_rollback_not_empty",
        "55000",
      );

      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "TRUNCATE storecalc.version_item_bucket_memberships, " +
            "storecalc.version_spending_buckets",
        ),
      );
      await expectRejected(
        runMigrationSql(client, bucketDownSql),
        "storecalc_spending_buckets_rollback_sequence_used",
        "55000",
      );
      await resetSequences(client, BUCKET_SEQUENCES);

      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "ALTER TABLE storecalc.version_spending_buckets " +
            "DROP CONSTRAINT version_spending_buckets_limit_nullability_check; " +
            "ALTER TABLE storecalc.version_spending_buckets " +
            "ADD CONSTRAINT version_spending_buckets_limit_nullability_check CHECK (true)",
        ),
      );
      await expectRejected(
        runMigrationSql(client, bucketVerifySql),
        "storecalc_spending_buckets_postflight_constraint_definition_mismatch",
        "P0001",
      );
      await expectRejected(
        runMigrationSql(client, bucketDownSql),
        "storecalc_spending_buckets_postflight_constraint_definition_mismatch",
        "P0001",
      );
      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "ALTER TABLE storecalc.version_spending_buckets " +
            "DROP CONSTRAINT version_spending_buckets_limit_nullability_check; " +
            "ALTER TABLE storecalc.version_spending_buckets " +
            "ADD CONSTRAINT version_spending_buckets_limit_nullability_check CHECK (" +
            "(limit_state = 'known' AND limit_minor IS NOT NULL AND limit_minor >= 0) " +
            "OR (limit_state IN ('unlimited', 'not_applicable', 'unknown', 'unsupported') " +
            "AND limit_minor IS NULL)" +
            ")",
        ),
      );

      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "GRANT SELECT ON storecalc.version_spending_buckets " +
            "TO storecalc_test_outsider",
        ),
      );
      await expectRejected(
        runMigrationSql(client, bucketVerifySql),
        "unexpected_grantee",
        "P0001",
      );
      await expectRejected(
        runMigrationSql(client, bucketDownSql),
        "unexpected_grantee",
        "P0001",
      );
      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "REVOKE SELECT ON storecalc.version_spending_buckets " +
            "FROM storecalc_test_outsider",
        ),
      );

      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "ALTER TABLE storecalc.version_spending_buckets DISABLE TRIGGER " +
            "version_spending_buckets_content_mutability_trigger",
        ),
      );
      await expectRejected(
        runMigrationSql(client, bucketVerifySql),
        "storecalc_spending_buckets_postflight_trigger_mismatch",
        "P0001",
      );
      await expectRejected(
        runMigrationSql(client, bucketDownSql),
        "storecalc_spending_buckets_postflight_trigger_mismatch",
        "P0001",
      );
      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "ALTER TABLE storecalc.version_spending_buckets ENABLE TRIGGER " +
            "version_spending_buckets_content_mutability_trigger",
        ),
      );

      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "UPDATE storecalc.schema_capabilities SET schema_version = 99 " +
            "WHERE capability_key = 'anonymous.calculation'",
        ),
      );
      await expectRejected(
        runMigrationSql(client, bucketVerifySql),
        "capability_or_seed_mismatch",
        "P0001",
      );
      await expectRejected(
        runMigrationSql(client, bucketDownSql),
        "capability_or_seed_mismatch",
        "P0001",
      );
      await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
        client.query(
          "UPDATE storecalc.schema_capabilities SET schema_version = 4 " +
            "WHERE capability_key = 'anonymous.calculation'",
        ),
      );

      await runMigrationSql(client, bucketVerifySql);
      const installedShape = await versionBaseShape(client);
      await expectRejected(
        runMigrationSql(client, bucketUpSql),
        "storecalc_template_postflight_relation_mismatch",
        "P0001",
      );
      assert.deepEqual(
        await versionBaseShape(client),
        installedShape,
        "a rejected bucket migration rerun changed database state",
      );

      await runMigrationSql(client, bucketDownSql);
      await runMigrationSql(client, contentVerifySql);
      assert.deepEqual(
        await versionBaseShape(client),
        contentBaseline,
        "bucket rollback did not restore the version-content shape",
      );

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
