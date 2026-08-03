import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PACKAGE_PATH = path.join(
    ROOT,
    "migrations",
    "storecalc",
    "0001_schema_foundation"
);
const DATABASE_NAME = "storecalc_migration_test";
const ROLE_SETTINGS = {
    migration_owner_role: "storecalc_test_migration",
    web_role: "storecalc_test_web",
    worker_role: "storecalc_test_worker",
    backup_role: "storecalc_test_backup"
};
const OUTSIDER_ROLE = "storecalc_test_outsider";
const ALL_TEST_ROLES = [...Object.values(ROLE_SETTINGS), OUTSIDER_ROLE];

const upSql = readFileSync(path.join(PACKAGE_PATH, "up.sql"), "utf8");
const verifySql = readFileSync(path.join(PACKAGE_PATH, "verify.sql"), "utf8");
const downSql = readFileSync(path.join(PACKAGE_PATH, "down.sql"), "utf8");
const manifest = JSON.parse(
    readFileSync(path.join(PACKAGE_PATH, "manifest.json"), "utf8")
);

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
        SELECT
            relname,
            relkind,
            pg_get_userbyid(relowner) AS owner,
            relacl::text AS acl
        FROM pg_class
        WHERE relnamespace = to_regnamespace('storecalc')
        ORDER BY relname
    `);
    const capabilityResult = toBoolean(schemaResult.rowCount)
        ? await client.query(`
            SELECT
                capability_key,
                schema_version,
                is_available,
                verified_at IS NOT NULL AS is_verified,
                migration_key
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

function toBoolean(value) {
    return Number(value) > 0;
}

async function removeTestState(client) {
    await resetRole(client);
    await client.query("DROP SCHEMA IF EXISTS storecalc CASCADE");
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
            NOLOGIN
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            NOREPLICATION
            NOBYPASSRLS
        `);
    }

    await client.query(
        `GRANT CREATE ON DATABASE ${quoteIdentifier(DATABASE_NAME)} TO ${quoteIdentifier(ROLE_SETTINGS.migration_owner_role)}`
    );
}

test(
    "StoreCalc foundation migration fails closed, grants least privilege, and rolls back exactly",
    { timeout: 30_000 },
    async () => {
        const connectionString = assertDisposableTarget();
        const client = new pg.Client({ connectionString, ssl: false });
        await client.connect();

        try {
            await removeTestState(client);
            await createTestRoles(client);

            const serverVersion = await client.query(
                "SHOW server_version_num"
            );
            assert.ok(Number(serverVersion.rows[0].server_version_num) >= 170000);

            const originalFingerprint = await schemaFingerprint(client);
            assert.deepEqual(originalFingerprint, {
                schema: [],
                relations: [],
                capabilities: []
            });

            await expectRejected(
                runMigrationSql(client, upSql, {
                    backup_role: "storecalc_test_missing"
                }),
                "storecalc_configured_role_missing",
                "42704"
            );
            assert.equal(
                (await client.query("SELECT to_regnamespace('storecalc') AS oid"))
                    .rows[0].oid,
                null
            );

            await expectRejected(
                runMigrationSql(client, upSql, { backup_role: "postgres" }),
                "storecalc_configured_role_is_overprivileged",
                "42501"
            );
            assert.equal(
                (await client.query("SELECT to_regnamespace('storecalc') AS oid"))
                    .rows[0].oid,
                null
            );

            await client.query(`
                ALTER DEFAULT PRIVILEGES
                FOR ROLE ${quoteIdentifier(ROLE_SETTINGS.migration_owner_role)}
                GRANT SELECT ON TABLES TO ${quoteIdentifier(OUTSIDER_ROLE)}
            `);
            await expectRejected(
                runMigrationSql(client, upSql),
                "storecalc_unexpected_grantee_detected",
                "P0001"
            );
            assert.equal(
                (await client.query("SELECT to_regnamespace('storecalc') AS oid"))
                    .rows[0].oid,
                null,
                "postflight grant rejection did not roll back the schema"
            );
            await client.query(`
                ALTER DEFAULT PRIVILEGES
                FOR ROLE ${quoteIdentifier(ROLE_SETTINGS.migration_owner_role)}
                REVOKE SELECT ON TABLES FROM ${quoteIdentifier(OUTSIDER_ROLE)}
            `);

            await client.query(
                `CREATE SCHEMA storecalc AUTHORIZATION ${quoteIdentifier(ROLE_SETTINGS.web_role)}`
            );
            await expectRejected(
                runMigrationSql(client, upSql),
                "storecalc_schema_already_exists",
                "42P06"
            );
            const unsafeSchema = await client.query(`
                SELECT pg_get_userbyid(nspowner) AS owner
                FROM pg_namespace
                WHERE nspname = 'storecalc'
            `);
            assert.equal(unsafeSchema.rows[0].owner, ROLE_SETTINGS.web_role);
            assert.equal(
                (
                    await client.query(`
                        SELECT count(*)::integer AS count
                        FROM pg_class
                        WHERE relnamespace = 'storecalc'::regnamespace
                    `)
                ).rows[0].count,
                0
            );
            await client.query("DROP SCHEMA storecalc");

            await runMigrationSql(client, upSql);
            await runMigrationSql(client, verifySql);

            const expectedCapabilities = Object.entries(
                manifest.expectedDefinitions.capabilities
            )
                .map(([capability_key, value]) => ({
                    capability_key,
                    schema_version: value.schemaVersion,
                    is_available: value.available
                }))
                .sort((left, right) =>
                    left.capability_key.localeCompare(right.capability_key)
                );
            const capabilityResult = await client.query(`
                SELECT capability_key, schema_version, is_available
                FROM storecalc.schema_capabilities
                ORDER BY capability_key
            `);
            assert.deepEqual(capabilityResult.rows, expectedCapabilities);

            for (const role of [
                ROLE_SETTINGS.web_role,
                ROLE_SETTINGS.worker_role
            ]) {
                await runAsRole(client, role, async () => {
                    const visible = await client.query(`
                        SELECT capability_key, is_available
                        FROM storecalc.schema_capabilities
                        ORDER BY capability_key
                    `);
                    assert.equal(visible.rowCount, 8);
                    await expectPermissionDenied(
                        client.query(`
                            INSERT INTO storecalc.schema_capabilities (
                                capability_key,
                                schema_version,
                                migration_key
                            )
                            VALUES ('test.forbidden', 0, '0001_schema_foundation')
                        `)
                    );
                    await expectPermissionDenied(
                        client.query("CREATE TABLE storecalc.forbidden (id integer)")
                    );
                    await expectPermissionDenied(
                        client.query(
                            "SELECT last_value FROM storecalc.schema_capabilities_id_seq"
                        )
                    );
                });
            }

            await runAsRole(client, ROLE_SETTINGS.backup_role, async () => {
                assert.equal(
                    (
                        await client.query(
                            "SELECT count(*)::integer AS count FROM storecalc.schema_capabilities"
                        )
                    ).rows[0].count,
                    8
                );
                await client.query(
                    "SELECT last_value FROM storecalc.schema_capabilities_id_seq"
                );
                await expectPermissionDenied(
                    client.query(
                        "SELECT nextval('storecalc.schema_capabilities_id_seq')"
                    )
                );
                await expectPermissionDenied(
                    client.query(
                        "UPDATE storecalc.schema_capabilities SET updated_at = updated_at"
                    )
                );
            });

            await runAsRole(client, OUTSIDER_ROLE, async () => {
                await expectPermissionDenied(
                    client.query(
                        "SELECT capability_key FROM storecalc.schema_capabilities"
                    )
                );
            });

            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(
                        `GRANT SELECT ON storecalc.schema_capabilities TO ${quoteIdentifier(OUTSIDER_ROLE)}`
                    )
            );
            await expectRejected(
                runMigrationSql(client, verifySql),
                "storecalc_unexpected_grantee_detected",
                "P0001"
            );
            await expectRejected(
                runMigrationSql(client, downSql),
                "storecalc_rollback_unexpected_grantee",
                "P0001"
            );
            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(
                        `REVOKE SELECT ON storecalc.schema_capabilities FROM ${quoteIdentifier(OUTSIDER_ROLE)}`
                    )
            );

            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(`
                        ALTER TABLE storecalc.schema_capabilities
                            DROP CONSTRAINT schema_capabilities_schema_version_check;
                        ALTER TABLE storecalc.schema_capabilities
                            ADD CONSTRAINT schema_capabilities_schema_version_check
                            CHECK (schema_version >= -1);
                    `)
            );
            await expectRejected(
                runMigrationSql(client, verifySql),
                "storecalc_constraint_definition_mismatch",
                "P0001"
            );
            await expectRejected(
                runMigrationSql(client, downSql),
                "storecalc_rollback_constraint_mismatch",
                "P0001"
            );
            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(`
                        ALTER TABLE storecalc.schema_capabilities
                            DROP CONSTRAINT schema_capabilities_schema_version_check;
                        ALTER TABLE storecalc.schema_capabilities
                            ADD CONSTRAINT schema_capabilities_schema_version_check
                            CHECK (schema_version >= 0);
                    `)
            );

            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(
                        "SELECT nextval('storecalc.schema_capabilities_id_seq')"
                    )
            );
            await expectRejected(
                runMigrationSql(client, verifySql),
                "storecalc_sequence_definition_mismatch",
                "P0001"
            );
            await expectRejected(
                runMigrationSql(client, downSql),
                "storecalc_rollback_sequence_mismatch",
                "P0001"
            );
            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(
                        "SELECT setval('storecalc.schema_capabilities_id_seq', 8, true)"
                    )
            );

            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(`
                        UPDATE storecalc.schema_capabilities
                        SET updated_at = updated_at + interval '1 second'
                        WHERE capability_key = 'public.directory'
                    `)
            );
            await expectRejected(
                runMigrationSql(client, verifySql),
                "storecalc_capability_state_mismatch",
                "P0001"
            );
            await expectRejected(
                runMigrationSql(client, downSql),
                "storecalc_rollback_capability_state_changed",
                "P0001"
            );
            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(`
                        UPDATE storecalc.schema_capabilities
                        SET updated_at = (
                            SELECT verified_at
                            FROM storecalc.schema_capabilities
                            WHERE capability_key = 'schema.foundation'
                        )
                        WHERE capability_key = 'public.directory'
                    `)
            );
            await runMigrationSql(client, verifySql);

            const installedFingerprint = await schemaFingerprint(client);
            await expectRejected(
                runMigrationSql(client, upSql),
                "storecalc_schema_already_exists",
                "42P06"
            );
            assert.deepEqual(
                await schemaFingerprint(client),
                installedFingerprint,
                "a rejected rerun changed the installed foundation"
            );

            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                async () => {
                    await client.query(`
                        INSERT INTO storecalc.schema_capabilities (
                            capability_key,
                            schema_version,
                            migration_key
                        )
                        VALUES ('test.rollback_guard', 0, '0001_schema_foundation')
                    `);
                }
            );
            await expectRejected(
                runMigrationSql(client, downSql),
                "storecalc_rollback_capability_state_changed",
                "P0001"
            );
            assert.equal(
                (
                    await client.query(`
                        SELECT count(*)::integer AS count
                        FROM storecalc.schema_capabilities
                        WHERE capability_key = 'test.rollback_guard'
                    `)
                ).rows[0].count,
                1,
                "a rejected rollback mutated capability state"
            );

            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(`
                        DELETE FROM storecalc.schema_capabilities
                        WHERE capability_key = 'test.rollback_guard'
                    `)
            );
            await runMigrationSql(client, verifySql);
            await runMigrationSql(client, downSql);

            assert.deepEqual(
                await schemaFingerprint(client),
                originalFingerprint,
                "rollback did not restore the original fingerprint"
            );
        } finally {
            await removeTestState(client).catch(() => null);
            await client.end();
        }
    }
);
