import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FOUNDATION_PATH = path.join(
    ROOT,
    "migrations",
    "storecalc",
    "0001_schema_foundation"
);
const DIRECTORY_PATH = path.join(
    ROOT,
    "migrations",
    "storecalc",
    "0002_directory_lineage"
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
const IDENTITY_SEQUENCES = [
    "contributor_subjects_id_seq",
    "countries_id_seq",
    "jurisdictions_id_seq",
    "agencies_id_seq",
    "facilities_id_seq",
    "facility_aliases_id_seq",
    "facility_sources_id_seq"
];

const foundationUpSql = readFileSync(
    path.join(FOUNDATION_PATH, "up.sql"),
    "utf8"
);
const foundationVerifySql = readFileSync(
    path.join(FOUNDATION_PATH, "verify.sql"),
    "utf8"
);
const foundationDownSql = readFileSync(
    path.join(FOUNDATION_PATH, "down.sql"),
    "utf8"
);
const directoryUpSql = readFileSync(path.join(DIRECTORY_PATH, "up.sql"), "utf8");
const directoryVerifySql = readFileSync(
    path.join(DIRECTORY_PATH, "verify.sql"),
    "utf8"
);
const directoryDownSql = readFileSync(
    path.join(DIRECTORY_PATH, "down.sql"),
    "utf8"
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
    const capabilityResult = Number(schemaResult.rowCount) > 0
        ? await client.query(`
            SELECT
                capability_key,
                schema_version,
                is_available,
                verified_at,
                migration_key,
                updated_at
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

async function resetDirectorySequences(client) {
    await runAsRole(
        client,
        ROLE_SETTINGS.migration_owner_role,
        async () => {
            for (const sequence of IDENTITY_SEQUENCES) {
                await client.query(
                    `SELECT setval('storecalc.${sequence}', 1, false)`
                );
            }
        }
    );
}

test(
    "StoreCalc directory lineage is coherent, isolated, drift-detecting, and reversibly empty",
    { timeout: 45_000 },
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
            assert.deepEqual(originalFingerprint, {
                schema: [],
                relations: [],
                capabilities: []
            });

            await runMigrationSql(client, foundationUpSql);
            await runMigrationSql(client, foundationVerifySql);
            const foundationFingerprint = await schemaFingerprint(client);

            await expectRejected(
                runMigrationSql(client, directoryUpSql),
                "storecalc_directory_users_identity_mismatch",
                "55000"
            );
            assert.deepEqual(
                await schemaFingerprint(client),
                foundationFingerprint,
                "a missing users dependency changed the foundation"
            );

            await createUsersTable(client);
            await runMigrationSql(client, directoryUpSql);
            await runMigrationSql(client, directoryVerifySql);

            const directoryCapability = await client.query(`
                SELECT schema_version, is_available, verified_at, migration_key
                FROM storecalc.schema_capabilities
                WHERE capability_key = 'public.directory'
            `);
            assert.deepEqual(directoryCapability.rows, [
                {
                    schema_version: 1,
                    is_available: false,
                    verified_at: null,
                    migration_key: "0002_directory_lineage"
                }
            ]);

            for (const role of [
                ROLE_SETTINGS.web_role,
                ROLE_SETTINGS.worker_role
            ]) {
                await runAsRole(client, role, async () => {
                    assert.equal(
                        (
                            await client.query(`
                                SELECT count(*)::integer AS count
                                FROM storecalc.schema_capabilities
                            `)
                        ).rows[0].count,
                        8
                    );
                    await expectPermissionDenied(
                        client.query("SELECT id FROM storecalc.countries")
                    );
                    await expectPermissionDenied(
                        client.query(`
                            INSERT INTO storecalc.reviewed_timezones (timezone_name)
                            VALUES ('UTC')
                        `)
                    );
                    await expectPermissionDenied(
                        client.query(
                            "SELECT nextval('storecalc.countries_id_seq')"
                        )
                    );
                });
            }

            await runAsRole(client, ROLE_SETTINGS.backup_role, async () => {
                assert.equal(
                    (
                        await client.query(
                            "SELECT count(*)::integer AS count FROM storecalc.facilities"
                        )
                    ).rows[0].count,
                    0
                );
                await client.query(
                    "SELECT last_value FROM storecalc.countries_id_seq"
                );
                await expectPermissionDenied(
                    client.query(
                        "SELECT nextval('storecalc.countries_id_seq')"
                    )
                );
                await expectPermissionDenied(
                    client.query(
                        "UPDATE storecalc.countries SET active = active"
                    )
                );
            });

            await runAsRole(client, OUTSIDER_ROLE, async () => {
                await expectPermissionDenied(
                    client.query("SELECT id FROM storecalc.countries")
                );
            });

            const userResult = await client.query(
                "INSERT INTO public.users DEFAULT VALUES RETURNING id"
            );
            const userId = userResult.rows[0].id;

            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                async () => {
                    await expectRejected(
                        client.query(`
                            INSERT INTO storecalc.reviewed_timezones (timezone_name)
                            VALUES ('Mars/Olympus')
                        `),
                        "storecalc_timezone_not_in_database_tzdata",
                        "22023"
                    );
                    await client.query(`
                        INSERT INTO storecalc.reviewed_timezones (timezone_name)
                        VALUES ('America/New_York')
                    `);
                }
            );

            const fixture = await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                async () => {
                    const subject = await client.query(
                        `
                            INSERT INTO storecalc.contributor_subjects (
                                user_id,
                                status
                            )
                            VALUES ($1, 'active')
                            RETURNING id
                        `,
                        [userId]
                    );
                    const countries = await client.query(`
                        INSERT INTO storecalc.countries (
                            code_alpha2,
                            code_alpha3,
                            official_name,
                            support_status,
                            active
                        )
                        VALUES
                            ('US', 'USA', 'United States', 'limited_directory', true),
                            ('CA', 'CAN', 'Canada', 'unsupported', true)
                        RETURNING id, code_alpha2
                    `);
                    const countryIds = Object.fromEntries(
                        countries.rows.map((row) => [row.code_alpha2, row.id])
                    );
                    const georgia = await client.query(
                        `
                            INSERT INTO storecalc.jurisdictions (
                                country_id,
                                jurisdiction_type,
                                official_name,
                                code,
                                active
                            )
                            VALUES ($1, 'state', 'Georgia', 'GA', true)
                            RETURNING id
                        `,
                        [countryIds.US]
                    );
                    const county = await client.query(
                        `
                            INSERT INTO storecalc.jurisdictions (
                                country_id,
                                parent_jurisdiction_id,
                                jurisdiction_type,
                                official_name,
                                active
                            )
                            VALUES ($1, $2, 'county', 'Chattooga County', true)
                            RETURNING id
                        `,
                        [countryIds.US, georgia.rows[0].id]
                    );

                    await expectRejected(
                        client.query(
                            `
                                UPDATE storecalc.jurisdictions
                                SET parent_jurisdiction_id = $1
                                WHERE id = $2
                            `,
                            [county.rows[0].id, georgia.rows[0].id]
                        ),
                        "storecalc_jurisdiction_cycle",
                        "23514"
                    );
                    await expectRejected(
                        client.query(
                            `
                                INSERT INTO storecalc.jurisdictions (
                                    country_id,
                                    parent_jurisdiction_id,
                                    jurisdiction_type,
                                    official_name,
                                    active
                                )
                                VALUES ($1, $2, 'province', 'Ontario', true)
                            `,
                            [countryIds.CA, georgia.rows[0].id]
                        ),
                        "jurisdictions_parent_country_fkey",
                        "23503"
                    );

                    const agency = await client.query(
                        `
                            INSERT INTO storecalc.agencies (
                                country_id,
                                governing_jurisdiction_id,
                                official_name,
                                agency_type,
                                status,
                                official_url
                            )
                            VALUES (
                                $1,
                                $2,
                                'Georgia Department of Corrections',
                                'state_corrections',
                                'active',
                                'https://gdc.georgia.gov/'
                            )
                            RETURNING id
                        `,
                        [countryIds.US, georgia.rows[0].id]
                    );
                    await expectRejected(
                        client.query(
                            `
                                INSERT INTO storecalc.agencies (
                                    country_id,
                                    governing_jurisdiction_id,
                                    official_name,
                                    status
                                )
                                VALUES ($1, $2, 'Wrong-country agency', 'active')
                            `,
                            [countryIds.CA, georgia.rows[0].id]
                        ),
                        "agencies_governing_country_fkey",
                        "23503"
                    );

                    await expectRejected(
                        client.query(
                            `
                                INSERT INTO storecalc.facilities (
                                    physical_country_id,
                                    record_scope,
                                    official_name,
                                    status
                                )
                                VALUES ($1, 'private', 'Ownerless private', 'provisional')
                            `,
                            [countryIds.US]
                        ),
                        "facilities_scope_owner_check",
                        "23514"
                    );
                    await expectRejected(
                        client.query(
                            `
                                INSERT INTO storecalc.facilities (
                                    physical_country_id,
                                    record_scope,
                                    owner_user_id,
                                    official_name,
                                    status
                                )
                                VALUES ($1, 'public', $2, 'Owned public', 'active')
                            `,
                            [countryIds.US, userId]
                        ),
                        "facilities_scope_owner_check",
                        "23514"
                    );
                    await expectRejected(
                        client.query(
                            `
                                INSERT INTO storecalc.facilities (
                                    physical_country_id,
                                    physical_jurisdiction_id,
                                    record_scope,
                                    official_name,
                                    status
                                )
                                VALUES ($1, $2, 'public', 'Wrong-country facility', 'active')
                            `,
                            [countryIds.CA, georgia.rows[0].id]
                        ),
                        "facilities_jurisdiction_country_fkey",
                        "23503"
                    );
                    await expectRejected(
                        client.query(
                            `
                                INSERT INTO storecalc.facilities (
                                    physical_country_id,
                                    agency_id,
                                    record_scope,
                                    official_name,
                                    status
                                )
                                VALUES ($1, $2, 'public', 'Wrong-agency facility', 'active')
                            `,
                            [countryIds.CA, agency.rows[0].id]
                        ),
                        "facilities_agency_country_fkey",
                        "23503"
                    );
                    await expectRejected(
                        client.query(
                            `
                                INSERT INTO storecalc.facilities (
                                    physical_country_id,
                                    record_scope,
                                    official_name,
                                    timezone_name,
                                    status
                                )
                                VALUES ($1, 'public', 'Unreviewed timezone', 'UTC', 'active')
                            `,
                            [countryIds.US]
                        ),
                        "facilities_timezone_name_fkey",
                        "23503"
                    );

                    const facilities = await client.query(
                        `
                            INSERT INTO storecalc.facilities (
                                physical_country_id,
                                physical_jurisdiction_id,
                                agency_id,
                                record_scope,
                                official_name,
                                facility_type,
                                locality,
                                timezone_name,
                                status,
                                created_by_subject_id
                            )
                            VALUES
                                ($1, $2, $3, 'public', 'Hays State Prison', 'state_prison', 'Trion', 'America/New_York', 'active', $4),
                                ($1, $2, $3, 'public', 'Directory duplicate A', 'state_prison', 'Trion', 'America/New_York', 'active', $4),
                                ($1, $2, $3, 'public', 'Directory duplicate B', 'state_prison', 'Trion', 'America/New_York', 'active', $4)
                            RETURNING id, official_name
                        `,
                        [
                            countryIds.US,
                            georgia.rows[0].id,
                            agency.rows[0].id,
                            subject.rows[0].id
                        ]
                    );
                    const facilityIds = Object.fromEntries(
                        facilities.rows.map((row) => [row.official_name, row.id])
                    );

                    await client.query(
                        `
                            UPDATE storecalc.facilities
                            SET status = 'merged',
                                merged_into_facility_id = $1
                            WHERE id = $2
                        `,
                        [
                            facilityIds["Hays State Prison"],
                            facilityIds["Directory duplicate A"]
                        ]
                    );
                    await expectRejected(
                        client.query(
                            `
                                UPDATE storecalc.facilities
                                SET status = 'merged',
                                    merged_into_facility_id = $1
                                WHERE id = $2
                            `,
                            [
                                facilityIds["Directory duplicate A"],
                                facilityIds["Hays State Prison"]
                            ]
                        ),
                        "storecalc_facility_merge_cycle",
                        "23514"
                    );
                    await client.query(
                        `
                            UPDATE storecalc.facilities
                            SET status = 'active',
                                merged_into_facility_id = NULL
                            WHERE id = $1
                        `,
                        [facilityIds["Directory duplicate A"]]
                    );

                    await client.query(
                        `
                            INSERT INTO storecalc.facility_aliases (
                                facility_id,
                                alias,
                                normalized_alias,
                                alias_type,
                                language_tag
                            )
                            VALUES ($1, 'Hays', 'hays', 'abbreviation', 'en')
                        `,
                        [facilityIds["Hays State Prison"]]
                    );
                    await expectRejected(
                        client.query(
                            `
                                INSERT INTO storecalc.facility_aliases (
                                    facility_id,
                                    alias,
                                    normalized_alias,
                                    alias_type,
                                    language_tag
                                )
                                VALUES ($1, 'HAYS', 'hays', 'abbreviation', 'en')
                            `,
                            [facilityIds["Hays State Prison"]]
                        ),
                        "facility_aliases_identity_key",
                        "23505"
                    );

                    await client.query(
                        `
                            INSERT INTO storecalc.facility_sources (
                                facility_id,
                                source_type,
                                source_url,
                                source_title,
                                source_date,
                                last_checked_at,
                                last_seen_at,
                                content_hash
                            )
                            VALUES (
                                $1,
                                'official_facility_page',
                                'https://gdc.georgia.gov/locations/hays-state-prison',
                                'Hays State Prison',
                                DATE '2026-08-03',
                                TIMESTAMPTZ '2026-08-03 12:00:00+00',
                                TIMESTAMPTZ '2026-08-03 12:00:00+00',
                                repeat('a', 64)
                            )
                        `,
                        [facilityIds["Hays State Prison"]]
                    );
                    await expectRejected(
                        client.query(
                            `
                                INSERT INTO storecalc.facility_sources (
                                    facility_id,
                                    source_type,
                                    source_url,
                                    source_title,
                                    last_checked_at,
                                    last_seen_at
                                )
                                VALUES (
                                    $1,
                                    'official_facility_page',
                                    'https://example.gov/bad-time',
                                    'Bad source timing',
                                    TIMESTAMPTZ '2026-08-03 12:00:00+00',
                                    TIMESTAMPTZ '2026-08-03 12:00:01+00'
                                )
                            `,
                            [facilityIds["Hays State Prison"]]
                        ),
                        "facility_sources_check_order_check",
                        "23514"
                    );

                    return {
                        subjectId: subject.rows[0].id,
                        countryIds,
                        georgiaId: georgia.rows[0].id,
                        countyId: county.rows[0].id,
                        agencyId: agency.rows[0].id,
                        facilityIds
                    };
                }
            );

            await client.query("DELETE FROM public.users WHERE id = $1", [userId]);
            assert.deepEqual(
                (
                    await client.query(
                        "SELECT user_id FROM storecalc.contributor_subjects WHERE id = $1",
                        [fixture.subjectId]
                    )
                ).rows,
                [{ user_id: null }],
                "account deletion did not detach the contributor subject"
            );

            await runMigrationSql(client, directoryVerifySql);
            await expectRejected(
                runMigrationSql(client, directoryDownSql),
                "storecalc_directory_rollback_not_empty",
                "55000"
            );

            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(`
                        ALTER TABLE storecalc.contributor_subjects
                            DROP CONSTRAINT contributor_subjects_generation_check;
                        ALTER TABLE storecalc.contributor_subjects
                            ADD CONSTRAINT contributor_subjects_generation_check
                            CHECK (subject_generation >= 0);
                    `)
            );
            await expectRejected(
                runMigrationSql(client, directoryVerifySql),
                "storecalc_directory_check_definition_mismatch",
                "P0001"
            );
            await expectRejected(
                runMigrationSql(client, directoryDownSql),
                "storecalc_directory_rollback_check_drift",
                "P0001"
            );
            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(`
                        ALTER TABLE storecalc.contributor_subjects
                            DROP CONSTRAINT contributor_subjects_generation_check;
                        ALTER TABLE storecalc.contributor_subjects
                            ADD CONSTRAINT contributor_subjects_generation_check
                            CHECK (subject_generation >= 1);
                    `)
            );

            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(
                        `GRANT SELECT ON storecalc.countries TO ${quoteIdentifier(OUTSIDER_ROLE)}`
                    )
            );
            await expectRejected(
                runMigrationSql(client, directoryVerifySql),
                "storecalc_directory_unexpected_grantee",
                "P0001"
            );
            await expectRejected(
                runMigrationSql(client, directoryDownSql),
                "storecalc_directory_rollback_unexpected_grantee",
                "P0001"
            );
            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(
                        `REVOKE SELECT ON storecalc.countries FROM ${quoteIdentifier(OUTSIDER_ROLE)}`
                    )
            );

            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(`
                        UPDATE storecalc.schema_capabilities
                        SET schema_version = 2
                        WHERE capability_key = 'public.directory'
                    `)
            );
            await expectRejected(
                runMigrationSql(client, directoryVerifySql),
                "storecalc_directory_capability_state_mismatch",
                "P0001"
            );
            await expectRejected(
                runMigrationSql(client, directoryDownSql),
                "storecalc_directory_rollback_capability_drift",
                "P0001"
            );
            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(`
                        UPDATE storecalc.schema_capabilities
                        SET schema_version = 1
                        WHERE capability_key = 'public.directory'
                    `)
            );

            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(
                        "ALTER TABLE storecalc.facilities DISABLE TRIGGER facilities_merge_acyclic_trigger"
                    )
            );
            await expectRejected(
                runMigrationSql(client, directoryVerifySql),
                "storecalc_directory_table_security_mismatch",
                "P0001"
            );
            await expectRejected(
                runMigrationSql(client, directoryDownSql),
                "storecalc_directory_rollback_trigger_drift",
                "P0001"
            );
            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(
                        "ALTER TABLE storecalc.facilities ENABLE TRIGGER facilities_merge_acyclic_trigger"
                    )
            );

            await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                () =>
                    client.query(`
                        DELETE FROM storecalc.facility_sources;
                        DELETE FROM storecalc.facility_aliases;
                        DELETE FROM storecalc.facilities;
                        DELETE FROM storecalc.agencies;
                        DELETE FROM storecalc.jurisdictions;
                        DELETE FROM storecalc.countries;
                        DELETE FROM storecalc.reviewed_timezones;
                        DELETE FROM storecalc.contributor_subjects;
                    `)
            );

            await expectRejected(
                runMigrationSql(client, directoryDownSql),
                "storecalc_directory_rollback_sequence_used",
                "55000"
            );
            await resetDirectorySequences(client);
            await runMigrationSql(client, directoryVerifySql);

            const installedFingerprint = await schemaFingerprint(client);
            await expectRejected(
                runMigrationSql(client, directoryUpSql),
                "storecalc_directory_foundation_relation_mismatch",
                "55000"
            );
            assert.deepEqual(
                await schemaFingerprint(client),
                installedFingerprint,
                "a rejected migration rerun changed directory state"
            );

            await runMigrationSql(client, directoryDownSql);
            await runMigrationSql(client, foundationVerifySql);
            assert.deepEqual(
                await schemaFingerprint(client),
                foundationFingerprint,
                "directory rollback did not restore the exact foundation"
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
