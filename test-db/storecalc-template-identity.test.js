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
        SELECT capability_key, schema_version, is_available, verified_at, migration_key
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

test(
    "StoreCalc template identities are coherent, stable, serialized, isolated, and reversibly empty",
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

            const preProgramFingerprint = await schemaFingerprint(client);
            await expectRejected(
                runMigrationSql(client, templateUpSql),
                "storecalc_program_verify_relation_definition_mismatch",
                "P0001"
            );
            assert.deepEqual(
                await schemaFingerprint(client),
                preProgramFingerprint,
                "a rejected pre-program template migration changed the directory schema"
            );

            await runMigrationSql(client, programUpSql);
            await runMigrationSql(client, programVerifySql);
            const programFingerprint = await programShape(client);

            await runMigrationSql(client, templateUpSql);
            await runMigrationSql(client, templateVerifySql);

            assert.deepEqual(
                (
                    await client.query(`
                        SELECT schema_version, is_available, verified_at, migration_key
                        FROM storecalc.schema_capabilities
                        WHERE capability_key = 'anonymous.calculation'
                    `)
                ).rows,
                [
                    {
                        schema_version: 1,
                        is_available: false,
                        verified_at: null,
                        migration_key: "0004_template_identity"
                    }
                ]
            );

            for (const role of [ROLE_SETTINGS.web_role, ROLE_SETTINGS.worker_role]) {
                await runAsRole(client, role, async () => {
                    for (const table of [
                        "templates",
                        "template_categories",
                        "template_items"
                    ]) {
                        await expectPermissionDenied(
                            client.query(`SELECT id FROM storecalc.${table}`)
                        );
                    }
                    await expectPermissionDenied(
                        client.query(
                            "SELECT nextval('storecalc.templates_id_seq')"
                        )
                    );
                    await expectPermissionDenied(
                        client.query(
                            "SELECT storecalc.lock_template_identity_topology()"
                        )
                    );
                });
            }

            await runAsRole(client, ROLE_SETTINGS.backup_role, async () => {
                for (const table of [
                    "templates",
                    "template_categories",
                    "template_items"
                ]) {
                    assert.equal(
                        (
                            await client.query(
                                `SELECT count(*)::integer AS count FROM storecalc.${table}`
                            )
                        ).rows[0].count,
                        0
                    );
                }
                await client.query(
                    "SELECT last_value FROM storecalc.templates_id_seq"
                );
                await expectPermissionDenied(
                    client.query(
                        "INSERT INTO storecalc.templates (program_id, visibility, name, status) VALUES (1, 'public', 'Denied', 'draft')"
                    )
                );
            });

            await runAsRole(client, OUTSIDER_ROLE, async () => {
                await expectPermissionDenied(
                    client.query("SELECT id FROM storecalc.templates")
                );
            });

            const ownerA = (
                await client.query("INSERT INTO public.users DEFAULT VALUES RETURNING id")
            ).rows[0].id;
            const ownerB = (
                await client.query("INSERT INTO public.users DEFAULT VALUES RETURNING id")
            ).rows[0].id;

            const fixture = await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                async () => {
                    const subjects = await client.query(
                        `
                            INSERT INTO storecalc.contributor_subjects (user_id, status)
                            VALUES ($1, 'active'), ($2, 'active')
                            RETURNING id, user_id
                        `,
                        [ownerA, ownerB]
                    );
                    const subjectByUser = Object.fromEntries(
                        subjects.rows.map((row) => [row.user_id, row.id])
                    );
                    const programs = await client.query(
                        `
                            INSERT INTO storecalc.store_programs (
                                record_scope, owner_user_id, name, status,
                                created_by_subject_id
                            ) VALUES
                                ('public', NULL, 'Shared Public Program', 'active', $1),
                                ('private', $2, 'Private Program A', 'draft', $1),
                                ('private', $3, 'Private Program B', 'draft', $4)
                            RETURNING id, name
                        `,
                        [subjectByUser[ownerA], ownerA, ownerB, subjectByUser[ownerB]]
                    );
                    const programByName = Object.fromEntries(
                        programs.rows.map((row) => [row.name, row.id])
                    );

                    await expectRejected(
                        client.query(
                            `
                                INSERT INTO storecalc.templates (
                                    program_id, visibility, name, status
                                ) VALUES ($1, 'private', 'Ownerless', 'draft')
                            `,
                            [programByName["Shared Public Program"]]
                        ),
                        "templates_visibility_owner_check",
                        "23514"
                    );
                    await expectRejected(
                        client.query(
                            `
                                INSERT INTO storecalc.templates (
                                    program_id, visibility, owner_user_id, name, status
                                ) VALUES ($1, 'public', $2, 'Owned public', 'draft')
                            `,
                            [programByName["Shared Public Program"], ownerA]
                        ),
                        "templates_visibility_owner_check",
                        "23514"
                    );
                    await expectRejected(
                        client.query(
                            `
                                INSERT INTO storecalc.templates (
                                    program_id, visibility, name, status,
                                    created_by_subject_id
                                ) VALUES ($1, 'public', 'Invalid public', 'draft', $2)
                            `,
                            [programByName["Private Program A"], subjectByUser[ownerA]]
                        ),
                        "storecalc_public_template_requires_public_program",
                        "23514"
                    );
                    await expectRejected(
                        client.query(
                            `
                                INSERT INTO storecalc.templates (
                                    program_id, visibility, owner_user_id, name, status,
                                    created_by_subject_id
                                ) VALUES ($1, 'private', $2, 'Cross owner', 'draft', $3)
                            `,
                            [
                                programByName["Private Program A"],
                                ownerB,
                                subjectByUser[ownerB]
                            ]
                        ),
                        "storecalc_template_private_owner_mismatch",
                        "23514"
                    );

                    const templates = await client.query(
                        `
                            INSERT INTO storecalc.templates (
                                program_id, visibility, owner_user_id, name, status,
                                created_by_subject_id
                            ) VALUES
                                ($1, 'public', NULL, 'Public Catalog', 'active', $2),
                                ($1, 'private', $3, 'Private Extension', 'draft', $2),
                                ($4, 'private', $3, 'Private Catalog A', 'draft', $2)
                            RETURNING id, name
                        `,
                        [
                            programByName["Shared Public Program"],
                            subjectByUser[ownerA],
                            ownerA,
                            programByName["Private Program A"]
                        ]
                    );
                    const templateByName = Object.fromEntries(
                        templates.rows.map((row) => [row.name, row.id])
                    );

                    const category = await client.query(
                        `
                            INSERT INTO storecalc.template_categories (
                                template_id, stable_key, created_by_subject_id
                            ) VALUES ($1, 'food', $2)
                            RETURNING id
                        `,
                        [templateByName["Public Catalog"], subjectByUser[ownerA]]
                    );
                    const item = await client.query(
                        `
                            INSERT INTO storecalc.template_items (
                                template_id, stable_key, created_by_subject_id
                            ) VALUES ($1, 'ramen_spicy', $2)
                            RETURNING id
                        `,
                        [templateByName["Public Catalog"], subjectByUser[ownerA]]
                    );

                    await expectRejected(
                        client.query(
                            `INSERT INTO storecalc.template_categories (template_id, stable_key)
                             VALUES ($1, 'food')`,
                            [templateByName["Public Catalog"]]
                        ),
                        "template_categories_template_stable_key_key",
                        "23505"
                    );
                    await client.query(
                        `INSERT INTO storecalc.template_categories (template_id, stable_key)
                         VALUES ($1, 'food')`,
                        [templateByName["Private Catalog A"]]
                    );
                    await expectRejected(
                        client.query(
                            `INSERT INTO storecalc.template_items (template_id, stable_key)
                             VALUES ($1, 'Bad Key')`,
                            [templateByName["Public Catalog"]]
                        ),
                        "template_items_stable_key_check",
                        "23514"
                    );

                    await expectRejected(
                        client.query(
                            "UPDATE storecalc.templates SET program_id = $1 WHERE id = $2",
                            [
                                programByName["Private Program A"],
                                templateByName["Private Extension"]
                            ]
                        ),
                        "storecalc_template_identity_immutable",
                        "55000"
                    );
                    await expectRejected(
                        client.query(
                            "UPDATE storecalc.store_programs SET owner_user_id = $1 WHERE id = $2",
                            [ownerB, programByName["Private Program A"]]
                        ),
                        "storecalc_templated_program_lineage_immutable",
                        "55000"
                    );
                    await expectRejected(
                        client.query(
                            "UPDATE storecalc.template_categories SET stable_key = 'renamed' WHERE id = $1",
                            [category.rows[0].id]
                        ),
                        "storecalc_stable_identity_immutable",
                        "55000"
                    );
                    await expectRejected(
                        client.query(
                            "UPDATE storecalc.template_items SET template_id = $1 WHERE id = $2",
                            [templateByName["Private Catalog A"], item.rows[0].id]
                        ),
                        "storecalc_stable_identity_immutable",
                        "55000"
                    );

                    await client.query(
                        "UPDATE storecalc.template_items SET retired_at = transaction_timestamp() WHERE id = $1",
                        [item.rows[0].id]
                    );
                    await expectRejected(
                        client.query(
                            "UPDATE storecalc.template_items SET retired_at = NULL WHERE id = $1",
                            [item.rows[0].id]
                        ),
                        "storecalc_stable_identity_retirement_immutable",
                        "55000"
                    );

                    await client.query(
                        `
                            UPDATE storecalc.templates
                            SET status = 'archived',
                                archived_at = transaction_timestamp(),
                                updated_at = transaction_timestamp()
                            WHERE id = $1
                        `,
                        [templateByName["Private Extension"]]
                    );
                    await expectRejected(
                        client.query(
                            `
                                UPDATE storecalc.templates
                                SET status = 'active', archived_at = NULL,
                                    updated_at = transaction_timestamp()
                                WHERE id = $1
                            `,
                            [templateByName["Private Extension"]]
                        ),
                        "storecalc_template_archive_immutable",
                        "55000"
                    );
                    await expectRejected(
                        client.query(
                            `INSERT INTO storecalc.template_items (template_id, stable_key)
                             VALUES ($1, 'late_item')`,
                            [templateByName["Private Extension"]]
                        ),
                        "storecalc_stable_identity_template_closed",
                        "55000"
                    );

                    await client.query(
                        `
                            UPDATE storecalc.templates
                            SET name = 'Public Catalog Renamed',
                                updated_at = transaction_timestamp()
                            WHERE id = $1
                        `,
                        [templateByName["Public Catalog"]]
                    );

                    return { subjectByUser, programByName, templateByName };
                }
            );

            const concurrentProgram = await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                async () => {
                    const result = await client.query(
                        `
                            INSERT INTO storecalc.store_programs (
                                record_scope, owner_user_id, name, status,
                                created_by_subject_id
                            ) VALUES ('private', $1, 'Concurrent Private Program', 'draft', $2)
                            RETURNING id
                        `,
                        [ownerA, fixture.subjectByUser[ownerA]]
                    );
                    return result.rows[0].id;
                }
            );
            const firstClient = await openMigrationClient(connectionString);
            const secondClient = await openMigrationClient(connectionString);
            try {
                await firstClient.query("BEGIN");
                await firstClient.query(
                    `
                        INSERT INTO storecalc.templates (
                            program_id, visibility, owner_user_id, name, status,
                            created_by_subject_id
                        ) VALUES ($1, 'private', $2, 'Concurrent Template', 'draft', $3)
                    `,
                    [concurrentProgram, ownerA, fixture.subjectByUser[ownerA]]
                );

                let secondSettled = false;
                const secondUpdate = secondClient
                    .query(
                        "UPDATE storecalc.store_programs SET owner_user_id = $1 WHERE id = $2",
                        [ownerB, concurrentProgram]
                    )
                    .finally(() => {
                        secondSettled = true;
                    });
                await new Promise((resolve) => setTimeout(resolve, 100));
                assert.equal(
                    secondSettled,
                    false,
                    "the parent rewrite did not wait for the template topology lock"
                );
                await firstClient.query("COMMIT");
                await expectRejected(
                    secondUpdate,
                    "storecalc_templated_program_lineage_immutable",
                    "55000"
                );
            } finally {
                await resetRole(firstClient);
                await resetRole(secondClient);
                await firstClient.end();
                await secondClient.end();
            }

            await runMigrationSql(client, templateVerifySql);
            await expectRejected(
                runMigrationSql(client, templateDownSql),
                "storecalc_template_rollback_not_empty",
                "P0001"
            );

            await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
                client.query(`
                    DELETE FROM storecalc.template_items;
                    DELETE FROM storecalc.template_categories;
                    DELETE FROM storecalc.templates;
                `)
            );
            await expectRejected(
                runMigrationSql(client, templateDownSql),
                "storecalc_template_rollback_sequence_used",
                "P0001"
            );
            await resetSequences(client, TEMPLATE_SEQUENCES);

            await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
                client.query(`
                    ALTER TABLE storecalc.templates
                        DROP CONSTRAINT templates_visibility_owner_check;
                    ALTER TABLE storecalc.templates
                        ADD CONSTRAINT templates_visibility_owner_check CHECK (true);
                `)
            );
            await expectRejected(
                runMigrationSql(client, templateVerifySql),
                "storecalc_template_verify_constraint_definition_mismatch",
                "P0001"
            );
            await expectRejected(
                runMigrationSql(client, templateDownSql),
                "storecalc_template_verify_constraint_definition_mismatch",
                "P0001"
            );
            await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
                client.query(`
                    ALTER TABLE storecalc.templates
                        DROP CONSTRAINT templates_visibility_owner_check;
                    ALTER TABLE storecalc.templates
                        ADD CONSTRAINT templates_visibility_owner_check
                        CHECK (
                            (visibility = 'public' AND owner_user_id IS NULL)
                            OR (visibility = 'private' AND owner_user_id IS NOT NULL)
                        );
                `)
            );

            await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
                client.query(
                    `GRANT SELECT ON storecalc.templates TO ${quoteIdentifier(OUTSIDER_ROLE)}`
                )
            );
            await expectRejected(
                runMigrationSql(client, templateVerifySql),
                "storecalc_template_postflight_unexpected_grantee",
                "P0001"
            );
            await expectRejected(
                runMigrationSql(client, templateDownSql),
                "storecalc_template_postflight_unexpected_grantee",
                "P0001"
            );
            await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
                client.query(
                    `REVOKE SELECT ON storecalc.templates FROM ${quoteIdentifier(OUTSIDER_ROLE)}`
                )
            );

            await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
                client.query(
                    "ALTER TABLE storecalc.templates DISABLE TRIGGER templates_coherence_trigger"
                )
            );
            await expectRejected(
                runMigrationSql(client, templateVerifySql),
                "storecalc_template_postflight_trigger_mismatch",
                "P0001"
            );
            await expectRejected(
                runMigrationSql(client, templateDownSql),
                "storecalc_template_postflight_trigger_mismatch",
                "P0001"
            );
            await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
                client.query(
                    "ALTER TABLE storecalc.templates ENABLE TRIGGER templates_coherence_trigger"
                )
            );

            await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
                client.query(`
                    UPDATE storecalc.schema_capabilities
                    SET schema_version = 2
                    WHERE capability_key = 'anonymous.calculation'
                `)
            );
            await expectRejected(
                runMigrationSql(client, templateVerifySql),
                "storecalc_template_postflight_capability_or_seed_mismatch",
                "P0001"
            );
            await expectRejected(
                runMigrationSql(client, templateDownSql),
                "storecalc_template_postflight_capability_or_seed_mismatch",
                "P0001"
            );
            await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
                client.query(`
                    UPDATE storecalc.schema_capabilities
                    SET schema_version = 1
                    WHERE capability_key = 'anonymous.calculation'
                `)
            );

            await runMigrationSql(client, templateVerifySql);
            const installedFingerprint = await schemaFingerprint(client);
            await expectRejected(
                runMigrationSql(client, templateUpSql),
                "storecalc_program_verify_baseline_relation_mismatch",
                "P0001"
            );
            assert.deepEqual(
                await schemaFingerprint(client),
                installedFingerprint,
                "a rejected template migration rerun changed database state"
            );

            await runMigrationSql(client, templateDownSql);
            await runMigrationSql(client, programVerifySql);
            assert.deepEqual(
                await programShape(client),
                programFingerprint,
                "template rollback did not restore the program schema and capability shape"
            );

            await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
                client.query("DELETE FROM storecalc.store_programs")
            );
            await resetSequences(client, PROGRAM_SEQUENCES);
            await runMigrationSql(client, programDownSql);
            await runMigrationSql(client, directoryVerifySql);
            assert.deepEqual(
                await directoryShape(client),
                directoryFingerprint,
                "program rollback did not restore the directory schema"
            );

            await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
                client.query("DELETE FROM storecalc.contributor_subjects")
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
