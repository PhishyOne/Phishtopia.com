import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const migrationPath = (key) =>
    path.join(ROOT, "migrations", "storecalc", key);
const DATABASE_NAME = "storecalc_migration_test";
const ROLE_SETTINGS = {
    migration_owner_role: "storecalc_test_migration",
    web_role: "storecalc_test_web",
    worker_role: "storecalc_test_worker",
    backup_role: "storecalc_test_backup"
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
    "facility_sources_id_seq"
];
const PROGRAM_SEQUENCES = [
    "store_programs_id_seq",
    "program_facility_assignments_id_seq"
];
const TEMPLATE_SEQUENCES = [
    "templates_id_seq",
    "template_categories_id_seq",
    "template_items_id_seq"
];

const readMigration = (key, file) =>
    readFileSync(path.join(migrationPath(key), file), "utf8");
const foundationUpSql = readMigration("0001_schema_foundation", "up.sql");
const foundationVerifySql = readMigration(
    "0001_schema_foundation",
    "verify.sql"
);
const foundationDownSql = readMigration("0001_schema_foundation", "down.sql");
const directoryUpSql = readMigration("0002_directory_lineage", "up.sql");
const directoryVerifySql = readMigration(
    "0002_directory_lineage",
    "verify.sql"
);
const directoryDownSql = readMigration("0002_directory_lineage", "down.sql");
const programUpSql = readMigration("0003_program_assignments", "up.sql");
const programVerifySql = readMigration(
    "0003_program_assignments",
    "verify.sql"
);
const programDownSql = readMigration("0003_program_assignments", "down.sql");
const templateUpSql = readMigration("0004_template_identity", "up.sql");
const templateVerifySql = readMigration(
    "0004_template_identity",
    "verify.sql"
);
const templateDownSql = readMigration("0004_template_identity", "down.sql");

function quoteIdentifier(value) {
    assert.match(value, /^[a-z][a-z0-9_]*$/);
    return `"${value}"`;
}

function assertDisposableTarget() {
    assert.equal(
        process.env.STORECALC_DB_TEST_ALLOW,
        "1",
        "STORECALC_DB_TEST_ALLOW=1 is required"
    );
    const connectionString = process.env.STORECALC_TEST_DATABASE_URL;
    assert.ok(connectionString, "STORECALC_TEST_DATABASE_URL is required");
    const target = new URL(connectionString);
    assert.ok(
        ["127.0.0.1", "localhost", "::1"].includes(target.hostname),
        "database tests may target only loopback"
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
            value
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
    const capabilityResult = Number(schemaResult.rowCount) > 0
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
        capabilities: capabilityResult.rows
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
        capabilities: capabilityResult.rows
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
        capabilities: capabilityResult.rows
    };
}

async function removeTestState(client) {
    await resetRole(client);
    await client.query("DROP SCHEMA IF EXISTS storecalc CASCADE");
    await client.query("DROP TABLE IF EXISTS public.users CASCADE");
    await client.query(`
        ALTER DEFAULT PRIVILEGES
        FOR ROLE ${quoteIdentifier(ROLE_SETTINGS.migration_owner_role)}
        REVOKE SELECT ON TABLES FROM ${quoteIdentifier(OUTSIDER_ROLE)}
    `).catch(() => null);
    for (const role of ALL_TEST_ROLES) {
        await client.query(
            `REVOKE CREATE ON DATABASE ${quoteIdentifier(DATABASE_NAME)} FROM ${quoteIdentifier(role)}`
        ).catch(() => null);
    }
    for (const role of [...ALL_TEST_ROLES].reverse()) {
        await client.query(`DROP ROLE IF EXISTS ${quoteIdentifier(role)}`);
    }
}

async function createTestRoles(client) {
    await client.query(
        `REVOKE CREATE ON DATABASE ${quoteIdentifier(DATABASE_NAME)} FROM PUBLIC`
    );
    for (const role of ALL_TEST_ROLES) {
        await client.query(`
            CREATE ROLE ${quoteIdentifier(role)}
            NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
        `);
    }
    await client.query(
        `GRANT CREATE ON DATABASE ${quoteIdentifier(DATABASE_NAME)} TO ${quoteIdentifier(ROLE_SETTINGS.migration_owner_role)}`
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
        `SET ROLE ${quoteIdentifier(ROLE_SETTINGS.migration_owner_role)}`
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
        "FROM pg_class WHERE relnamespace = to_regnamespace('storecalc') ORDER BY relname"
    );
    const functionResult = await client.query(
        "SELECT proname, md5(prosrc) AS body_hash, prosecdef, proconfig, proacl::text AS acl " +
        "FROM pg_proc WHERE pronamespace = to_regnamespace('storecalc') ORDER BY proname"
    );
    const triggerResult = await client.query(
        "SELECT trigger_row.tgname, relation.relname, trigger_row.tgenabled, trigger_row.tgtype " +
        "FROM pg_trigger AS trigger_row JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid " +
        "WHERE relation.relnamespace = to_regnamespace('storecalc') " +
        "AND NOT trigger_row.tgisinternal ORDER BY trigger_row.tgname"
    );
    const capabilityResult = await client.query(
        "SELECT capability_key, schema_version, is_available, verified_at, migration_key " +
        "FROM storecalc.schema_capabilities ORDER BY capability_key"
    );
    return {
        relations: relationResult.rows,
        functions: functionResult.rows,
        triggers: triggerResult.rows,
        capabilities: capabilityResult.rows
    };
}

const VERSION_CAPABILITIES = [
    "money.minor_units.v1",
    "quantity.bounded_integer.v1"
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
            values.createdBySubjectId ?? null
        ]
    );
    return result.rows[0].id;
}


const contentUpSql = readMigration("0006_version_content", "up.sql");
const contentVerifySql = readMigration("0006_version_content", "verify.sql");
const contentDownSql = readMigration("0006_version_content", "down.sql");
const CONTENT_SEQUENCES = [
    "version_categories_id_seq",
    "version_items_id_seq"
];

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
            values.active ?? true
        ]
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
            values.sortOrder ?? 10
        ]
    );
    return result.rows[0].id;
}

test(
    "StoreCalc version content is lineage-safe, state-exact, seal-serialized, isolated, and reversibly unused",
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

            const preVersionFingerprint = await schemaFingerprint(client);
            await expectRejected(
                runMigrationSql(client, contentUpSql),
                "storecalc_template_postflight_relation_mismatch",
                "P0001"
            );
            assert.deepEqual(
                await schemaFingerprint(client),
                preVersionFingerprint,
                "a rejected pre-version content migration changed schema state"
            );

            await runMigrationSql(client, versionUpSql);
            await runMigrationSql(client, versionVerifySql);
            const versionBaseline = await versionBaseShape(client);

            await runMigrationSql(client, contentUpSql);
            await runMigrationSql(client, contentVerifySql);

            assert.deepEqual(
                (
                    await client.query(
                        "SELECT schema_version, is_available, verified_at, migration_key " +
                        "FROM storecalc.schema_capabilities " +
                        "WHERE capability_key = 'anonymous.calculation'"
                    )
                ).rows,
                [
                    {
                        schema_version: 3,
                        is_available: false,
                        verified_at: null,
                        migration_key: "0006_version_content"
                    }
                ]
            );

            for (const role of [
                ROLE_SETTINGS.web_role,
                ROLE_SETTINGS.worker_role
            ]) {
                await runAsRole(client, role, async () => {
                    for (const table of [
                        "version_categories",
                        "version_items"
                    ]) {
                        await expectPermissionDenied(
                            client.query("SELECT id FROM storecalc." + table)
                        );
                    }
                    await expectPermissionDenied(
                        client.query(
                            "SELECT nextval('storecalc.version_items_id_seq')"
                        )
                    );
                    await expectPermissionDenied(
                        client.query(
                            "SELECT storecalc.assert_version_content_mutable()"
                        )
                    );
                });
            }

            await runAsRole(client, ROLE_SETTINGS.backup_role, async () => {
                for (const table of [
                    "version_categories",
                    "version_items"
                ]) {
                    assert.equal(
                        (
                            await client.query(
                                "SELECT count(*)::integer AS count FROM storecalc." +
                                table
                            )
                        ).rows[0].count,
                        0
                    );
                }
                await client.query(
                    "SELECT last_value FROM storecalc.version_categories_id_seq"
                );
                await client.query(
                    "SELECT last_value FROM storecalc.version_items_id_seq"
                );
                await expectPermissionDenied(
                    client.query(
                        "INSERT INTO storecalc.version_categories (" +
                        "version_id, template_id, category_id, display_name, " +
                        "sort_order, active" +
                        ") VALUES (1, 1, 1, 'Denied', 1, true)"
                    )
                );
            });

            await runAsRole(client, OUTSIDER_ROLE, async () => {
                await expectPermissionDenied(
                    client.query("SELECT id FROM storecalc.version_items")
                );
            });

            const userId = (
                await client.query(
                    "INSERT INTO public.users DEFAULT VALUES RETURNING id"
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
                            [userId]
                        )
                    ).rows[0].id;
                    const programId = (
                        await client.query(
                            "INSERT INTO storecalc.store_programs (" +
                            "record_scope, owner_user_id, name, status, created_by_subject_id" +
                            ") VALUES ('public', NULL, 'Content Test Program', 'active', $1) " +
                            "RETURNING id",
                            [subjectId]
                        )
                    ).rows[0].id;
                    const templates = await client.query(
                        "INSERT INTO storecalc.templates (" +
                        "program_id, visibility, owner_user_id, name, status, created_by_subject_id" +
                        ") VALUES " +
                        "($1, 'public', NULL, 'Primary Content Template', 'active', $2), " +
                        "($1, 'public', NULL, 'Other Content Template', 'active', $2), " +
                        "($1, 'public', NULL, 'Archived Content Template', 'draft', $2) " +
                        "RETURNING id, name",
                        [programId, subjectId]
                    );
                    const templateByName = Object.fromEntries(
                        templates.rows.map((row) => [row.name, row.id])
                    );

                    const stableCategories = await client.query(
                        "INSERT INTO storecalc.template_categories (" +
                        "template_id, stable_key, created_by_subject_id" +
                        ") VALUES " +
                        "($1, 'food', $3), ($1, 'hygiene', $3), " +
                        "($2, 'other_food', $3) RETURNING id, template_id, stable_key",
                        [
                            templateByName["Primary Content Template"],
                            templateByName["Other Content Template"],
                            subjectId
                        ]
                    );
                    const categoryByKey = Object.fromEntries(
                        stableCategories.rows.map((row) => [
                            row.stable_key,
                            row
                        ])
                    );
                    const stableItems = await client.query(
                        "INSERT INTO storecalc.template_items (" +
                        "template_id, stable_key, created_by_subject_id" +
                        ") VALUES " +
                        "($1, 'synthetic_soup', $3), ($1, 'synthetic_soap', $3), " +
                        "($2, 'other_item', $3) RETURNING id, template_id, stable_key",
                        [
                            templateByName["Primary Content Template"],
                            templateByName["Other Content Template"],
                            subjectId
                        ]
                    );
                    const itemByKey = Object.fromEntries(
                        stableItems.rows.map((row) => [row.stable_key, row])
                    );

                    const versionIds = {
                        primaryOne: await insertVersion(client, {
                            templateId:
                                templateByName["Primary Content Template"],
                            versionNumber: 1,
                            createdBySubjectId: subjectId
                        }),
                        primaryTwo: await insertVersion(client, {
                            templateId:
                                templateByName["Primary Content Template"],
                            versionNumber: 2,
                            createdBySubjectId: subjectId
                        }),
                        otherOne: await insertVersion(client, {
                            templateId:
                                templateByName["Other Content Template"],
                            versionNumber: 1,
                            createdBySubjectId: subjectId
                        }),
                        archivedOne: await insertVersion(client, {
                            templateId:
                                templateByName["Archived Content Template"],
                            versionNumber: 1,
                            createdBySubjectId: subjectId
                        })
                    };

                    await client.query(
                        "UPDATE storecalc.templates " +
                        "SET status = 'archived', archived_at = transaction_timestamp(), " +
                        "updated_at = transaction_timestamp() WHERE id = $1",
                        [templateByName["Archived Content Template"]]
                    );

                    return {
                        subjectId,
                        templateByName,
                        categoryByKey,
                        itemByKey,
                        versionIds
                    };
                }
            );

            const content = await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                async () => {
                    const primaryTemplateId =
                        fixture.templateByName["Primary Content Template"];
                    const foodCategoryId =
                        fixture.categoryByKey.food.id;
                    const categoryOneId = await insertVersionCategory(client, {
                        versionId: fixture.versionIds.primaryOne,
                        templateId: primaryTemplateId,
                        categoryId: foodCategoryId,
                        displayName: "Synthetic food",
                        description: "Synthetic category for database tests.",
                        sortOrder: 10,
                        active: true
                    });
                    const categoryTwoId = await insertVersionCategory(client, {
                        versionId: fixture.versionIds.primaryTwo,
                        templateId: primaryTemplateId,
                        categoryId: foodCategoryId,
                        displayName: "Synthetic food v2",
                        sortOrder: 10,
                        active: true
                    });

                    await expectRejected(
                        insertVersionCategory(client, {
                            versionId: fixture.versionIds.primaryOne,
                            templateId: primaryTemplateId,
                            categoryId: foodCategoryId
                        }),
                        "version_categories_version_category_key",
                        "23505"
                    );
                    await expectRejected(
                        insertVersionCategory(client, {
                            versionId: fixture.versionIds.primaryOne,
                            templateId: primaryTemplateId,
                            categoryId:
                                fixture.categoryByKey.other_food.id
                        }),
                        "version_categories_category_template_fkey",
                        "23503"
                    );
                    await expectRejected(
                        insertVersionCategory(client, {
                            versionId: fixture.versionIds.primaryOne,
                            templateId:
                                fixture.templateByName[
                                    "Other Content Template"
                                ],
                            categoryId:
                                fixture.categoryByKey.other_food.id
                        }),
                        "version_categories_version_template_fkey",
                        "23503"
                    );
                    await expectRejected(
                        insertVersionCategory(client, {
                            versionId: fixture.versionIds.primaryOne,
                            templateId: primaryTemplateId,
                            categoryId:
                                fixture.categoryByKey.hygiene.id,
                            displayName: ""
                        }),
                        "version_categories_display_name_check",
                        "23514"
                    );
                    await expectRejected(
                        insertVersionCategory(client, {
                            versionId: fixture.versionIds.primaryOne,
                            templateId: primaryTemplateId,
                            categoryId:
                                fixture.categoryByKey.hygiene.id,
                            sortOrder: -1
                        }),
                        "version_categories_sort_order_check",
                        "23514"
                    );
                    await expectRejected(
                        insertVersionCategory(client, {
                            versionId: fixture.versionIds.archivedOne,
                            templateId:
                                fixture.templateByName[
                                    "Archived Content Template"
                                ],
                            categoryId: foodCategoryId
                        }),
                        "storecalc_version_content_template_closed",
                        "55000"
                    );

                    const primaryItemId =
                        fixture.itemByKey.synthetic_soup.id;
                    const itemOneId = await insertVersionItem(client, {
                        versionId: fixture.versionIds.primaryOne,
                        templateId: primaryTemplateId,
                        itemId: primaryItemId,
                        categoryVersionId: categoryOneId,
                        sku: "SYN-001",
                        displayName: "Synthetic soup",
                        unitLabel: "one package",
                        priceState: "known",
                        priceMinor: 0,
                        minimumSelectedQuantity: 1,
                        maximumOrderQuantity: 4,
                        quantityStep: 1,
                        availabilityState: "available",
                        sortOrder: 10
                    });
                    const uncategorizedItemId = await insertVersionItem(
                        client,
                        {
                            versionId: fixture.versionIds.primaryOne,
                            templateId: primaryTemplateId,
                            itemId: fixture.itemByKey.synthetic_soap.id,
                            categoryVersionId: null,
                            displayName: "Synthetic soap",
                            priceState: "unsupported",
                            priceMinor: null,
                            availabilityState: "unknown",
                            sortOrder: 20
                        }
                    );
                    await insertVersionItem(client, {
                        versionId: fixture.versionIds.otherOne,
                        templateId:
                            fixture.templateByName["Other Content Template"],
                        itemId: fixture.itemByKey.other_item.id,
                        displayName: "Other unknown item",
                        priceState: "unknown",
                        priceMinor: null,
                        availabilityState: "unknown"
                    });

                    await expectRejected(
                        insertVersionItem(client, {
                            versionId: fixture.versionIds.primaryOne,
                            templateId: primaryTemplateId,
                            itemId: primaryItemId
                        }),
                        "version_items_version_item_key",
                        "23505"
                    );
                    await expectRejected(
                        insertVersionItem(client, {
                            versionId: fixture.versionIds.primaryOne,
                            templateId: primaryTemplateId,
                            itemId: fixture.itemByKey.other_item.id
                        }),
                        "version_items_item_template_fkey",
                        "23503"
                    );
                    await client.query(
                        "DELETE FROM storecalc.version_items WHERE id = $1",
                        [uncategorizedItemId]
                    );
                    await expectRejected(
                        insertVersionItem(client, {
                            versionId: fixture.versionIds.primaryOne,
                            templateId: primaryTemplateId,
                            itemId: fixture.itemByKey.synthetic_soap.id,
                            categoryVersionId: categoryTwoId
                        }),
                        "version_items_category_version_fkey",
                        "23503"
                    );
                    await expectRejected(
                        insertVersionItem(client, {
                            versionId: fixture.versionIds.primaryTwo,
                            templateId: primaryTemplateId,
                            itemId: primaryItemId,
                            categoryVersionId: categoryTwoId,
                            priceState: "unknown",
                            priceMinor: 5
                        }),
                        "version_items_price_nullability_check",
                        "23514"
                    );
                    await expectRejected(
                        insertVersionItem(client, {
                            versionId: fixture.versionIds.primaryTwo,
                            templateId: primaryTemplateId,
                            itemId: primaryItemId,
                            categoryVersionId: categoryTwoId,
                            priceState: "known",
                            priceMinor: null
                        }),
                        "version_items_price_nullability_check",
                        "23514"
                    );
                    await expectRejected(
                        insertVersionItem(client, {
                            versionId: fixture.versionIds.primaryTwo,
                            templateId: primaryTemplateId,
                            itemId: primaryItemId,
                            categoryVersionId: categoryTwoId,
                            minimumSelectedQuantity: 0
                        }),
                        "version_items_quantity_check",
                        "23514"
                    );
                    await expectRejected(
                        insertVersionItem(client, {
                            versionId: fixture.versionIds.primaryTwo,
                            templateId: primaryTemplateId,
                            itemId: primaryItemId,
                            categoryVersionId: categoryTwoId,
                            minimumSelectedQuantity: 4,
                            maximumOrderQuantity: 3
                        }),
                        "version_items_quantity_check",
                        "23514"
                    );
                    await expectRejected(
                        insertVersionItem(client, {
                            versionId: fixture.versionIds.primaryTwo,
                            templateId: primaryTemplateId,
                            itemId: primaryItemId,
                            categoryVersionId: categoryTwoId,
                            availabilityState: "maybe"
                        }),
                        "version_items_availability_state_check",
                        "23514"
                    );

                    await client.query(
                        "UPDATE storecalc.version_items " +
                        "SET display_name = 'Synthetic soup updated' WHERE id = $1",
                        [itemOneId]
                    );

                    await client.query(
                        "UPDATE storecalc.template_versions " +
                        "SET content_state = 'sealed', hash_algorithm = 'sha256', " +
                        "content_hash = $2, sealed_at = transaction_timestamp() " +
                        "WHERE id = $1",
                        [fixture.versionIds.primaryOne, "d".repeat(64)]
                    );

                    await expectRejected(
                        client.query(
                            "UPDATE storecalc.version_categories " +
                            "SET display_name = 'Changed after seal' WHERE id = $1",
                            [categoryOneId]
                        ),
                        "storecalc_sealed_version_content_immutable",
                        "55000"
                    );
                    await expectRejected(
                        client.query(
                            "DELETE FROM storecalc.version_items WHERE id = $1",
                            [itemOneId]
                        ),
                        "storecalc_sealed_version_content_immutable",
                        "55000"
                    );
                    await expectRejected(
                        insertVersionItem(client, {
                            versionId: fixture.versionIds.primaryOne,
                            templateId: primaryTemplateId,
                            itemId: fixture.itemByKey.synthetic_soap.id
                        }),
                        "storecalc_sealed_version_content_immutable",
                        "55000"
                    );

                    return { categoryTwoId };
                }
            );

            const firstClient = await openMigrationClient(connectionString);
            const secondClient = await openMigrationClient(connectionString);
            try {
                await firstClient.query("BEGIN");
                await insertVersionItem(firstClient, {
                    versionId: fixture.versionIds.primaryTwo,
                    templateId:
                        fixture.templateByName["Primary Content Template"],
                    itemId: fixture.itemByKey.synthetic_soup.id,
                    categoryVersionId: content.categoryTwoId,
                    displayName: "Concurrent synthetic soup"
                });

                let sealSettled = false;
                const sealVersion = secondClient
                    .query(
                        "UPDATE storecalc.template_versions " +
                        "SET content_state = 'sealed', hash_algorithm = 'sha256', " +
                        "content_hash = $2, sealed_at = transaction_timestamp() " +
                        "WHERE id = $1",
                        [fixture.versionIds.primaryTwo, "e".repeat(64)]
                    )
                    .finally(() => {
                        sealSettled = true;
                    });
                await new Promise((resolve) => setTimeout(resolve, 100));
                assert.equal(
                    sealSettled,
                    false,
                    "version sealing bypassed the child topology lock"
                );
                await firstClient.query("COMMIT");
                assert.equal((await sealVersion).rowCount, 1);
                await expectRejected(
                    insertVersionItem(secondClient, {
                        versionId: fixture.versionIds.primaryTwo,
                        templateId:
                            fixture.templateByName[
                                "Primary Content Template"
                            ],
                        itemId: fixture.itemByKey.synthetic_soap.id
                    }),
                    "storecalc_sealed_version_content_immutable",
                    "55000"
                );
            } finally {
                await resetRole(firstClient);
                await resetRole(secondClient);
                await firstClient.end();
                await secondClient.end();
            }

            await runMigrationSql(client, contentVerifySql);
            await expectRejected(
                runMigrationSql(client, contentDownSql),
                "storecalc_version_content_rollback_not_empty",
                "55000"
            );

            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(
                        "TRUNCATE storecalc.version_items, " +
                        "storecalc.version_categories"
                    )
            );
            await expectRejected(
                runMigrationSql(client, contentDownSql),
                "storecalc_version_content_rollback_sequence_used",
                "55000"
            );
            await resetSequences(client, CONTENT_SEQUENCES);

            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(
                        "ALTER TABLE storecalc.version_items " +
                        "DROP CONSTRAINT version_items_price_nullability_check; " +
                        "ALTER TABLE storecalc.version_items " +
                        "ADD CONSTRAINT version_items_price_nullability_check CHECK (true)"
                    )
            );
            await expectRejected(
                runMigrationSql(client, contentVerifySql),
                "storecalc_version_content_postflight_constraint_definition_mismatch",
                "P0001"
            );
            await expectRejected(
                runMigrationSql(client, contentDownSql),
                "storecalc_version_content_postflight_constraint_definition_mismatch",
                "P0001"
            );
            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(
                        "ALTER TABLE storecalc.version_items " +
                        "DROP CONSTRAINT version_items_price_nullability_check; " +
                        "ALTER TABLE storecalc.version_items " +
                        "ADD CONSTRAINT version_items_price_nullability_check CHECK (" +
                        "(price_state = 'known' AND price_minor IS NOT NULL AND price_minor >= 0) " +
                        "OR (price_state IN ('unknown', 'unsupported') AND price_minor IS NULL)" +
                        ")"
                    )
            );

            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(
                        "GRANT SELECT ON storecalc.version_items " +
                        "TO storecalc_test_outsider"
                    )
            );
            await expectRejected(
                runMigrationSql(client, contentVerifySql),
                "storecalc_template_postflight_unexpected_grantee",
                "P0001"
            );
            await expectRejected(
                runMigrationSql(client, contentDownSql),
                "storecalc_template_postflight_unexpected_grantee",
                "P0001"
            );
            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(
                        "REVOKE SELECT ON storecalc.version_items " +
                        "FROM storecalc_test_outsider"
                    )
            );

            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(
                        "ALTER TABLE storecalc.version_items DISABLE TRIGGER " +
                        "version_items_content_mutability_trigger"
                    )
            );
            await expectRejected(
                runMigrationSql(client, contentVerifySql),
                "storecalc_version_content_postflight_function_or_trigger_mismatch",
                "P0001"
            );
            await expectRejected(
                runMigrationSql(client, contentDownSql),
                "storecalc_version_content_postflight_function_or_trigger_mismatch",
                "P0001"
            );
            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(
                        "ALTER TABLE storecalc.version_items ENABLE TRIGGER " +
                        "version_items_content_mutability_trigger"
                    )
            );

            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(
                        "UPDATE storecalc.schema_capabilities SET schema_version = 99 " +
                        "WHERE capability_key = 'anonymous.calculation'"
                    )
            );
            await expectRejected(
                runMigrationSql(client, contentVerifySql),
                "storecalc_template_postflight_capability_or_seed_mismatch",
                "P0001"
            );
            await expectRejected(
                runMigrationSql(client, contentDownSql),
                "storecalc_template_postflight_capability_or_seed_mismatch",
                "P0001"
            );
            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(
                        "UPDATE storecalc.schema_capabilities SET schema_version = 3 " +
                        "WHERE capability_key = 'anonymous.calculation'"
                    )
            );

            await runMigrationSql(client, contentVerifySql);
            const installedShape = await versionBaseShape(client);
            await expectRejected(
                runMigrationSql(client, contentUpSql),
                "storecalc_template_postflight_relation_mismatch",
                "P0001"
            );
            assert.deepEqual(
                await versionBaseShape(client),
                installedShape,
                "a rejected content migration rerun changed database state"
            );

            await runMigrationSql(client, contentDownSql);
            await runMigrationSql(client, versionVerifySql);
            assert.deepEqual(
                await versionBaseShape(client),
                versionBaseline,
                "content rollback did not restore the version-header shape"
            );

            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () => client.query("TRUNCATE storecalc.template_versions")
            );
            await resetSequences(client, ["template_versions_id_seq"]);
            await runMigrationSql(client, versionDownSql);

            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(
                        "DELETE FROM storecalc.template_items; " +
                        "DELETE FROM storecalc.template_categories; " +
                        "DELETE FROM storecalc.templates"
                    )
            );
            await resetSequences(client, TEMPLATE_SEQUENCES);
            await runMigrationSql(client, templateDownSql);
            await runMigrationSql(client, programVerifySql);
            assert.deepEqual(
                await programShape(client),
                programFingerprint,
                "template rollback did not restore the program schema"
            );

            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () => client.query("DELETE FROM storecalc.store_programs")
            );
            await resetSequences(client, PROGRAM_SEQUENCES);
            await runMigrationSql(client, programDownSql);
            await runMigrationSql(client, directoryVerifySql);
            assert.deepEqual(
                await directoryShape(client),
                directoryFingerprint,
                "program rollback did not restore the directory schema"
            );

            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () => client.query("DELETE FROM storecalc.contributor_subjects")
            );
            await resetSequences(client, DIRECTORY_SEQUENCES);
            await runMigrationSql(client, directoryDownSql);
            await runMigrationSql(client, foundationVerifySql);
            assert.deepEqual(
                await schemaFingerprint(client),
                foundationFingerprint,
                "directory rollback did not restore the foundation"
            );
            await runMigrationSql(client, foundationDownSql);
            assert.deepEqual(
                await schemaFingerprint(client),
                originalFingerprint,
                "foundation rollback did not restore the original fingerprint"
            );
        } finally {
            await removeTestState(client).catch(() => null);
            await client.end();
        }
    }
);
