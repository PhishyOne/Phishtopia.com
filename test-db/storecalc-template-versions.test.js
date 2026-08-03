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

test(
    "StoreCalc template versions are sealed, coherent, serialized, isolated, and reversibly unused",
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

            const preTemplateFingerprint = await schemaFingerprint(client);
            await expectRejected(
                runMigrationSql(client, versionUpSql),
                "storecalc_template_postflight_relation_mismatch",
                "P0001"
            );
            assert.deepEqual(
                await schemaFingerprint(client),
                preTemplateFingerprint,
                "a rejected pre-template version migration changed schema state"
            );

            await runMigrationSql(client, templateUpSql);
            await runMigrationSql(client, templateVerifySql);
            const templateBaseline = await versionBaseShape(client);

            await runMigrationSql(client, versionUpSql);
            await runMigrationSql(client, versionVerifySql);

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
                        schema_version: 2,
                        is_available: false,
                        verified_at: null,
                        migration_key: "0005_template_versions"
                    }
                ]
            );

            for (const role of [
                ROLE_SETTINGS.web_role,
                ROLE_SETTINGS.worker_role
            ]) {
                await runAsRole(client, role, async () => {
                    await expectPermissionDenied(
                        client.query("SELECT id FROM storecalc.template_versions")
                    );
                    await expectPermissionDenied(
                        client.query(
                            "SELECT nextval('storecalc.template_versions_id_seq')"
                        )
                    );
                    await expectPermissionDenied(
                        client.query(
                            "SELECT storecalc.lock_template_version_topology()"
                        )
                    );
                });
            }

            await runAsRole(client, ROLE_SETTINGS.backup_role, async () => {
                assert.equal(
                    (
                        await client.query(
                            "SELECT count(*)::integer AS count " +
                            "FROM storecalc.template_versions"
                        )
                    ).rows[0].count,
                    0
                );
                await client.query(
                    "SELECT last_value FROM storecalc.template_versions_id_seq"
                );
                await expectPermissionDenied(
                    client.query(
                        "INSERT INTO storecalc.template_versions (" +
                        "template_id, version_number, content_state, currency_code, " +
                        "currency_exponent, calculation_contract_version, " +
                        "required_capabilities, content_schema_version, " +
                        "canonicalization_version" +
                        ") VALUES (" +
                        "1, 1, 'draft', 'USD', 2, 'storecalc.calculation.v1', " +
                        "ARRAY['money.minor_units.v1', 'quantity.bounded_integer.v1'], " +
                        "'storecalc.catalog-content.v1', 'storecalc.canonical-json.v1'" +
                        ")"
                    )
                );
            });

            await runAsRole(client, OUTSIDER_ROLE, async () => {
                await expectPermissionDenied(
                    client.query("SELECT id FROM storecalc.template_versions")
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
                            ") VALUES ('public', NULL, 'Version Test Program', 'active', $1) " +
                            "RETURNING id",
                            [subjectId]
                        )
                    ).rows[0].id;
                    const templates = await client.query(
                        "INSERT INTO storecalc.templates (" +
                        "program_id, visibility, owner_user_id, name, status, created_by_subject_id" +
                        ") VALUES " +
                        "($1, 'public', NULL, 'Primary Version Template', 'active', $2), " +
                        "($1, 'public', NULL, 'Other Version Template', 'active', $2), " +
                        "($1, 'public', NULL, 'Archived Version Template', 'draft', $2) " +
                        "RETURNING id, name",
                        [programId, subjectId]
                    );
                    const templateByName = Object.fromEntries(
                        templates.rows.map((row) => [row.name, row.id])
                    );

                    await client.query(
                        "UPDATE storecalc.templates " +
                        "SET status = 'archived', archived_at = transaction_timestamp(), " +
                        "updated_at = transaction_timestamp() WHERE id = $1",
                        [templateByName["Archived Version Template"]]
                    );

                    const baseVersionId = await insertVersion(client, {
                        templateId: templateByName["Primary Version Template"],
                        versionNumber: 1,
                        createdBySubjectId: subjectId
                    });

                    await expectRejected(
                        client.query(
                            "INSERT INTO storecalc.template_versions (" +
                            "template_id, version_number, content_state, currency_code, " +
                            "currency_exponent, calculation_contract_version, " +
                            "required_capabilities, content_schema_version, " +
                            "canonicalization_version, hash_algorithm, content_hash, " +
                            "created_by_subject_id, sealed_at" +
                            ") VALUES (" +
                            "$1, 2, 'sealed', 'USD', 2, 'storecalc.calculation.v1', " +
                            "$2::text[], 'storecalc.catalog-content.v1', " +
                            "'storecalc.canonical-json.v1', 'sha256', $3, $4, " +
                            "transaction_timestamp()" +
                            ")",
                            [
                                templateByName["Primary Version Template"],
                                VERSION_CAPABILITIES,
                                "b".repeat(64),
                                subjectId
                            ]
                        ),
                        "storecalc_template_version_must_start_draft",
                        "23514"
                    );

                    await expectRejected(
                        insertVersion(client, {
                            templateId:
                                templateByName["Primary Version Template"],
                            versionNumber: 2,
                            capabilities: [
                                "quantity.bounded_integer.v1",
                                "money.minor_units.v1"
                            ],
                            createdBySubjectId: subjectId
                        }),
                        "storecalc_template_version_capabilities_not_canonical",
                        "23514"
                    );
                    await expectRejected(
                        insertVersion(client, {
                            templateId:
                                templateByName["Primary Version Template"],
                            versionNumber: 2,
                            capabilities: [
                                "money.minor_units.v1",
                                "money.minor_units.v1"
                            ],
                            createdBySubjectId: subjectId
                        }),
                        "storecalc_template_version_capability_duplicate",
                        "23514"
                    );
                    await expectRejected(
                        insertVersion(client, {
                            templateId:
                                templateByName["Primary Version Template"],
                            versionNumber: 2,
                            capabilities: [
                                "money.minor_units.v1",
                                "unsupported.future.v1"
                            ],
                            createdBySubjectId: subjectId
                        }),
                        "template_versions_required_capabilities_check",
                        "23514"
                    );
                    await expectRejected(
                        insertVersion(client, {
                            templateId:
                                templateByName["Primary Version Template"],
                            versionNumber: 2,
                            currencyCode: "EUR",
                            currencyExponent: 2,
                            createdBySubjectId: subjectId
                        }),
                        "template_versions_currency_contract_check",
                        "23514"
                    );
                    await expectRejected(
                        insertVersion(client, {
                            templateId:
                                templateByName["Primary Version Template"],
                            versionNumber: 1,
                            createdBySubjectId: subjectId
                        }),
                        "template_versions_template_number_key",
                        "23505"
                    );

                    const draftParentId = await insertVersion(client, {
                        templateId: templateByName["Primary Version Template"],
                        versionNumber: 2,
                        createdBySubjectId: subjectId
                    });
                    await expectRejected(
                        insertVersion(client, {
                            templateId:
                                templateByName["Primary Version Template"],
                            versionNumber: 3,
                            basedOnVersionId: draftParentId,
                            createdBySubjectId: subjectId
                        }),
                        "storecalc_template_version_base_not_sealed",
                        "23514"
                    );
                    await expectRejected(
                        insertVersion(client, {
                            templateId: templateByName["Other Version Template"],
                            versionNumber: 1,
                            basedOnVersionId: baseVersionId,
                            createdBySubjectId: subjectId
                        }),
                        "storecalc_template_version_base_missing",
                        "23503"
                    );
                    await expectRejected(
                        insertVersion(client, {
                            id: 500,
                            templateId:
                                templateByName["Primary Version Template"],
                            versionNumber: 3,
                            basedOnVersionId: 500,
                            createdBySubjectId: subjectId
                        }),
                        "storecalc_template_version_self_ancestry",
                        "23514"
                    );
                    await expectRejected(
                        insertVersion(client, {
                            templateId:
                                templateByName["Archived Version Template"],
                            versionNumber: 1,
                            createdBySubjectId: subjectId
                        }),
                        "storecalc_template_version_template_closed",
                        "55000"
                    );

                    await client.query(
                        "UPDATE storecalc.template_versions " +
                        "SET content_state = 'sealed', hash_algorithm = 'sha256', " +
                        "content_hash = $2, sealed_at = transaction_timestamp() " +
                        "WHERE id = $1",
                        [baseVersionId, "a".repeat(64)]
                    );
                    const childVersionId = await insertVersion(client, {
                        templateId: templateByName["Primary Version Template"],
                        versionNumber: 3,
                        basedOnVersionId: baseVersionId,
                        createdBySubjectId: subjectId
                    });

                    await expectRejected(
                        client.query(
                            "UPDATE storecalc.template_versions " +
                            "SET based_on_version_id = NULL WHERE id = $1",
                            [childVersionId]
                        ),
                        "storecalc_template_version_lineage_immutable",
                        "55000"
                    );
                    await expectRejected(
                        client.query(
                            "UPDATE storecalc.template_versions " +
                            "SET source_effective_date = DATE '2026-01-01' WHERE id = $1",
                            [baseVersionId]
                        ),
                        "storecalc_sealed_template_version_immutable",
                        "55000"
                    );
                    await expectRejected(
                        client.query(
                            "DELETE FROM storecalc.template_versions WHERE id = $1",
                            [baseVersionId]
                        ),
                        "storecalc_sealed_template_version_delete_forbidden",
                        "55000"
                    );

                    return {
                        subjectId,
                        templateId:
                            templateByName["Primary Version Template"]
                    };
                }
            );

            await runMigrationSql(client, versionVerifySql);

            const firstClient = await openMigrationClient(connectionString);
            const secondClient = await openMigrationClient(connectionString);
            try {
                await firstClient.query("BEGIN");
                await insertVersion(firstClient, {
                    templateId: fixture.templateId,
                    versionNumber: 20,
                    createdBySubjectId: fixture.subjectId
                });

                let secondSettled = false;
                const competingInsert = insertVersion(secondClient, {
                    templateId: fixture.templateId,
                    versionNumber: 20,
                    createdBySubjectId: fixture.subjectId
                }).finally(() => {
                    secondSettled = true;
                });
                await new Promise((resolve) => setTimeout(resolve, 100));
                assert.equal(
                    secondSettled,
                    false,
                    "competing version allocation bypassed the topology lock"
                );
                await firstClient.query("COMMIT");
                await expectRejected(
                    competingInsert,
                    "template_versions_template_number_key",
                    "23505"
                );
            } finally {
                await resetRole(firstClient);
                await resetRole(secondClient);
                await firstClient.end();
                await secondClient.end();
            }

            await runMigrationSql(client, versionVerifySql);
            await expectRejected(
                runMigrationSql(client, versionDownSql),
                "storecalc_template_version_rollback_not_empty",
                "55000"
            );

            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () => client.query("TRUNCATE storecalc.template_versions")
            );
            await expectRejected(
                runMigrationSql(client, versionDownSql),
                "storecalc_template_version_rollback_sequence_used",
                "55000"
            );
            await resetSequences(client, ["template_versions_id_seq"]);

            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(
                        "ALTER TABLE storecalc.template_versions " +
                        "DROP CONSTRAINT template_versions_currency_contract_check; " +
                        "ALTER TABLE storecalc.template_versions " +
                        "ADD CONSTRAINT template_versions_currency_contract_check CHECK (true)"
                    )
            );
            await expectRejected(
                runMigrationSql(client, versionVerifySql),
                "storecalc_template_version_postflight_check_definition_mismatch",
                "P0001"
            );
            await expectRejected(
                runMigrationSql(client, versionDownSql),
                "storecalc_template_version_postflight_check_definition_mismatch",
                "P0001"
            );
            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(
                        "ALTER TABLE storecalc.template_versions " +
                        "DROP CONSTRAINT template_versions_currency_contract_check; " +
                        "ALTER TABLE storecalc.template_versions " +
                        "ADD CONSTRAINT template_versions_currency_contract_check " +
                        "CHECK (currency_code = 'USD' AND currency_exponent = 2)"
                    )
            );

            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(
                        "GRANT SELECT ON storecalc.template_versions " +
                        "TO storecalc_test_outsider"
                    )
            );
            await expectRejected(
                runMigrationSql(client, versionVerifySql),
                "storecalc_template_postflight_unexpected_grantee",
                "P0001"
            );
            await expectRejected(
                runMigrationSql(client, versionDownSql),
                "storecalc_template_postflight_unexpected_grantee",
                "P0001"
            );
            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(
                        "REVOKE SELECT ON storecalc.template_versions " +
                        "FROM storecalc_test_outsider"
                    )
            );

            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(
                        "ALTER TABLE storecalc.template_versions DISABLE TRIGGER " +
                        "template_versions_coherence_trigger"
                    )
            );
            await expectRejected(
                runMigrationSql(client, versionVerifySql),
                "storecalc_template_version_postflight_function_or_trigger_mismatch",
                "P0001"
            );
            await expectRejected(
                runMigrationSql(client, versionDownSql),
                "storecalc_template_version_postflight_function_or_trigger_mismatch",
                "P0001"
            );
            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(
                        "ALTER TABLE storecalc.template_versions ENABLE TRIGGER " +
                        "template_versions_coherence_trigger"
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
                runMigrationSql(client, versionVerifySql),
                "storecalc_template_postflight_capability_or_seed_mismatch",
                "P0001"
            );
            await expectRejected(
                runMigrationSql(client, versionDownSql),
                "storecalc_template_postflight_capability_or_seed_mismatch",
                "P0001"
            );
            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(
                        "UPDATE storecalc.schema_capabilities SET schema_version = 2 " +
                        "WHERE capability_key = 'anonymous.calculation'"
                    )
            );

            await runMigrationSql(client, versionVerifySql);
            const installedShape = await versionBaseShape(client);
            await expectRejected(
                runMigrationSql(client, versionUpSql),
                "storecalc_template_postflight_relation_mismatch",
                "P0001"
            );
            assert.deepEqual(
                await versionBaseShape(client),
                installedShape,
                "a rejected version migration rerun changed database state"
            );

            await runMigrationSql(client, versionDownSql);
            await runMigrationSql(client, templateVerifySql);
            assert.deepEqual(
                await versionBaseShape(client),
                templateBaseline,
                "version rollback did not restore the template identity shape"
            );

            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () => client.query("DELETE FROM storecalc.templates")
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
