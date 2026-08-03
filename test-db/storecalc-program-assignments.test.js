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
    "StoreCalc shared programs and assignments are coherent, serialized, isolated, and reversibly empty",
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
            await expectRejected(
                runMigrationSql(client, programUpSql),
                "storecalc_program_directory_baseline_missing",
                "P0001"
            );
            assert.deepEqual(
                await schemaFingerprint(client),
                foundationFingerprint,
                "a rejected pre-directory program migration changed the foundation"
            );
            await createUsersTable(client);
            await runMigrationSql(client, directoryUpSql);
            await runMigrationSql(client, directoryVerifySql);
            const directoryFingerprint = await directoryShape(client);

            await runMigrationSql(client, programUpSql);
            await runMigrationSql(client, programVerifySql);

            assert.deepEqual(
                (
                    await client.query(`
                        SELECT schema_version, is_available, verified_at, migration_key
                        FROM storecalc.schema_capabilities
                        WHERE capability_key = 'public.directory'
                    `)
                ).rows,
                [
                    {
                        schema_version: 2,
                        is_available: false,
                        verified_at: null,
                        migration_key: "0003_program_assignments"
                    }
                ]
            );

            for (const role of [ROLE_SETTINGS.web_role, ROLE_SETTINGS.worker_role]) {
                await runAsRole(client, role, async () => {
                    await expectPermissionDenied(
                        client.query("SELECT id FROM storecalc.store_programs")
                    );
                    await expectPermissionDenied(
                        client.query(
                            "SELECT id FROM storecalc.program_facility_assignments"
                        )
                    );
                    await expectPermissionDenied(
                        client.query(
                            "SELECT nextval('storecalc.store_programs_id_seq')"
                        )
                    );
                });
            }

            await runAsRole(client, ROLE_SETTINGS.backup_role, async () => {
                assert.equal(
                    (
                        await client.query(
                            "SELECT count(*)::integer AS count FROM storecalc.store_programs"
                        )
                    ).rows[0].count,
                    0
                );
                await client.query(
                    "SELECT last_value FROM storecalc.store_programs_id_seq"
                );
                await expectPermissionDenied(
                    client.query(
                        "INSERT INTO storecalc.store_programs (record_scope, name, status) VALUES ('public', 'Denied', 'active')"
                    )
                );
            });

            await runAsRole(client, OUTSIDER_ROLE, async () => {
                await expectPermissionDenied(
                    client.query("SELECT id FROM storecalc.store_programs")
                );
            });

            const ownerA = (
                await client.query(
                    "INSERT INTO public.users DEFAULT VALUES RETURNING id"
                )
            ).rows[0].id;
            const ownerB = (
                await client.query(
                    "INSERT INTO public.users DEFAULT VALUES RETURNING id"
                )
            ).rows[0].id;

            const fixture = await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                async () => {
                    await expectRejected(
                        client.query(`
                            INSERT INTO storecalc.store_programs (
                                record_scope, name, status
                            ) VALUES ('private', 'Ownerless private program', 'draft')
                        `),
                        "store_programs_scope_owner_check",
                        "23514"
                    );
                    await expectRejected(
                        client.query(
                            `
                                INSERT INTO storecalc.store_programs (
                                    record_scope, owner_user_id, name, status
                                ) VALUES ('public', $1, 'Owned public program', 'active')
                            `,
                            [ownerA]
                        ),
                        "store_programs_scope_owner_check",
                        "23514"
                    );

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
                    const countries = await client.query(`
                        INSERT INTO storecalc.countries (
                            code_alpha2, code_alpha3, official_name, support_status, active
                        ) VALUES
                            ('US', 'USA', 'United States', 'limited_directory', true),
                            ('CA', 'CAN', 'Canada', 'unsupported', true)
                        RETURNING id, code_alpha2
                    `);
                    const countryByCode = Object.fromEntries(
                        countries.rows.map((row) => [row.code_alpha2, row.id])
                    );
                    const agencies = await client.query(
                        `
                            INSERT INTO storecalc.agencies (
                                country_id, official_name, agency_type, status
                            ) VALUES
                                ($1, 'United States Corrections', 'state_corrections', 'active'),
                                ($2, 'Canada Corrections', 'provincial_corrections', 'active')
                            RETURNING id, country_id
                        `,
                        [countryByCode.US, countryByCode.CA]
                    );
                    const agencyByCountry = Object.fromEntries(
                        agencies.rows.map((row) => [row.country_id, row.id])
                    );
                    const facilities = await client.query(
                        `
                            INSERT INTO storecalc.facilities (
                                physical_country_id, agency_id, record_scope,
                                owner_user_id, official_name, status, created_by_subject_id
                            ) VALUES
                                ($1, $2, 'public', NULL, 'US Public One', 'active', $5),
                                ($1, $2, 'public', NULL, 'US Public Two', 'active', $5),
                                ($3, $4, 'public', NULL, 'CA Public', 'active', $5),
                                ($1, $2, 'private', $6, 'Private A', 'provisional', $5),
                                ($1, $2, 'private', $7, 'Private B', 'provisional', $8)
                            RETURNING id, official_name
                        `,
                        [
                            countryByCode.US,
                            agencyByCountry[countryByCode.US],
                            countryByCode.CA,
                            agencyByCountry[countryByCode.CA],
                            subjectByUser[ownerA],
                            ownerA,
                            ownerB,
                            subjectByUser[ownerB]
                        ]
                    );
                    const facilityByName = Object.fromEntries(
                        facilities.rows.map((row) => [row.official_name, row.id])
                    );
                    const programs = await client.query(
                        `
                            INSERT INTO storecalc.store_programs (
                                owning_agency_id, record_scope, owner_user_id,
                                name, program_type, status, created_by_subject_id
                            ) VALUES
                                ($1, 'public', NULL, 'US Shared Commissary', 'commissary', 'active', $2),
                                ($1, 'private', $3, 'Private Program A', 'commissary', 'draft', $2),
                                ($1, 'private', $4, 'Private Program B', 'commissary', 'draft', $5)
                            RETURNING id, name
                        `,
                        [
                            agencyByCountry[countryByCode.US],
                            subjectByUser[ownerA],
                            ownerA,
                            ownerB,
                            subjectByUser[ownerB]
                        ]
                    );
                    const programByName = Object.fromEntries(
                        programs.rows.map((row) => [row.name, row.id])
                    );

                    assert.equal(
                        (
                            await client.query(`
                                SELECT count(*)::integer AS count
                                FROM information_schema.columns
                                WHERE table_schema = 'storecalc'
                                  AND table_name = 'store_programs'
                                  AND column_name = 'facility_id'
                            `)
                        ).rows[0].count,
                        0,
                        "program identities became facility-owned"
                    );

                    const firstAssignment = await client.query(
                        `
                            INSERT INTO storecalc.program_facility_assignments (
                                program_id, facility_id, audience_key,
                                valid_from, valid_through, assignment_state
                            ) VALUES ($1, $2, 'general', DATE '2026-01-01', DATE '2026-06-30', 'supported')
                            RETURNING id
                        `,
                        [
                            programByName["US Shared Commissary"],
                            facilityByName["US Public One"]
                        ]
                    );
                    await client.query(
                        `
                            INSERT INTO storecalc.program_facility_assignments (
                                program_id, facility_id, audience_key,
                                valid_from, valid_through, assignment_state
                            ) VALUES
                                ($1, $2, 'general', DATE '2026-07-01', DATE '2026-12-31', 'supported'),
                                ($1, $3, 'general', NULL, NULL, 'supported'),
                                ($1, $2, 'segregation', DATE '2026-01-01', DATE '2026-12-31', 'supported')
                        `,
                        [
                            programByName["US Shared Commissary"],
                            facilityByName["US Public One"],
                            facilityByName["US Public Two"]
                        ]
                    );

                    await expectRejected(
                        client.query(
                            `
                                INSERT INTO storecalc.program_facility_assignments (
                                    program_id, facility_id, audience_key,
                                    valid_from, valid_through, assignment_state
                                ) VALUES ($1, $2, 'general', DATE '2026-06-30', DATE '2026-07-15', 'supported')
                            `,
                            [
                                programByName["US Shared Commissary"],
                                facilityByName["US Public One"]
                            ]
                        ),
                        "storecalc_assignment_supported_interval_overlap",
                        "23P01"
                    );
                    await expectRejected(
                        client.query(
                            `
                                INSERT INTO storecalc.program_facility_assignments (
                                    program_id, facility_id, audience_key, assignment_state
                                ) VALUES ($1, $2, 'general', 'supported')
                            `,
                            [
                                programByName["US Shared Commissary"],
                                facilityByName["US Public Two"]
                            ]
                        ),
                        "storecalc_assignment_supported_interval_overlap",
                        "23P01"
                    );
                    await expectRejected(
                        client.query(
                            `
                                INSERT INTO storecalc.program_facility_assignments (
                                    program_id, facility_id, audience_key, assignment_state
                                ) VALUES ($1, $2, 'general', 'supported')
                            `,
                            [
                                programByName["US Shared Commissary"],
                                facilityByName["CA Public"]
                            ]
                        ),
                        "storecalc_assignment_agency_country_mismatch",
                        "23514"
                    );
                    await expectRejected(
                        client.query(
                            `
                                INSERT INTO storecalc.program_facility_assignments (
                                    program_id, facility_id, audience_key, assignment_state
                                ) VALUES ($1, $2, 'personal', 'draft')
                            `,
                            [
                                programByName["Private Program A"],
                                facilityByName["Private B"]
                            ]
                        ),
                        "storecalc_assignment_private_owner_mismatch",
                        "23514"
                    );
                    await client.query(
                        `
                            INSERT INTO storecalc.program_facility_assignments (
                                program_id, facility_id, audience_key, assignment_state
                            ) VALUES
                                ($1, $2, 'personal', 'draft'),
                                ($3, $4, 'general', 'draft')
                        `,
                        [
                            programByName["Private Program A"],
                            facilityByName["US Public One"],
                            programByName["US Shared Commissary"],
                            facilityByName["Private B"]
                        ]
                    );
                    await expectRejected(
                        client.query(
                            `
                                INSERT INTO storecalc.program_facility_assignments (
                                    program_id, facility_id, audience_key,
                                    assignment_state, source_evidence_id
                                ) VALUES ($1, $2, 'evidence_test', 'draft', 1)
                            `,
                            [
                                programByName["US Shared Commissary"],
                                facilityByName["US Public One"]
                            ]
                        ),
                        "program_facility_assignments_evidence_deferred_check",
                        "23514"
                    );

                    await expectRejected(
                        client.query(
                            "UPDATE storecalc.store_programs SET owner_user_id = $1 WHERE id = $2",
                            [ownerB, programByName["Private Program A"]]
                        ),
                        "storecalc_assigned_program_lineage_immutable",
                        "55000"
                    );
                    await expectRejected(
                        client.query(
                            "UPDATE storecalc.facilities SET owner_user_id = $1 WHERE id = $2",
                            [ownerA, facilityByName["Private B"]]
                        ),
                        "storecalc_assigned_facility_lineage_immutable",
                        "55000"
                    );
                    await expectRejected(
                        client.query(
                            "UPDATE storecalc.agencies SET country_id = $1 WHERE id = $2",
                            [
                                countryByCode.CA,
                                agencyByCountry[countryByCode.US]
                            ]
                        ),
                        "storecalc_assigned_agency_country_immutable",
                        "55000"
                    );

                    return {
                        ownerA,
                        ownerB,
                        subjectByUser,
                        countryByCode,
                        agencyByCountry,
                        facilityByName,
                        programByName,
                        firstAssignmentId: firstAssignment.rows[0].id
                    };
                }
            );

            const concurrentProgram = await runAsRole(
                client,
                ROLE_SETTINGS.migration_owner_role,
                async () => {
                    const result = await client.query(
                        `
                            INSERT INTO storecalc.store_programs (
                                record_scope, name, status, created_by_subject_id
                            ) VALUES ('public', 'Concurrent Program', 'active', $1)
                            RETURNING id
                        `,
                        [fixture.subjectByUser[ownerA]]
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
                        INSERT INTO storecalc.program_facility_assignments (
                            program_id, facility_id, audience_key,
                            valid_from, valid_through, assignment_state
                        ) VALUES ($1, $2, 'concurrent', DATE '2027-01-01', DATE '2027-12-31', 'supported')
                    `,
                    [concurrentProgram, fixture.facilityByName["US Public One"]]
                );

                let secondSettled = false;
                const secondInsert = secondClient
                    .query(
                        `
                            INSERT INTO storecalc.program_facility_assignments (
                                program_id, facility_id, audience_key,
                                valid_from, valid_through, assignment_state
                            ) VALUES ($1, $2, 'concurrent', DATE '2027-06-01', DATE '2028-01-01', 'supported')
                        `,
                        [concurrentProgram, fixture.facilityByName["US Public One"]]
                    )
                    .finally(() => {
                        secondSettled = true;
                    });
                await new Promise((resolve) => setTimeout(resolve, 100));
                assert.equal(
                    secondSettled,
                    false,
                    "the competing assignment did not wait for the topology lock"
                );
                await firstClient.query("COMMIT");
                await expectRejected(
                    secondInsert,
                    "storecalc_assignment_supported_interval_overlap",
                    "23P01"
                );
            } finally {
                await resetRole(firstClient);
                await resetRole(secondClient);
                await firstClient.end();
                await secondClient.end();
            }

            await runMigrationSql(client, programVerifySql);
            await expectRejected(
                runMigrationSql(client, programDownSql),
                "storecalc_program_rollback_not_empty",
                "P0001"
            );

            await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
                client.query(`
                    DELETE FROM storecalc.program_facility_assignments;
                    DELETE FROM storecalc.store_programs;
                `)
            );
            await expectRejected(
                runMigrationSql(client, programDownSql),
                "storecalc_program_rollback_sequence_used",
                "P0001"
            );
            await resetSequences(client, PROGRAM_SEQUENCES);

            await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
                client.query(`
                    ALTER TABLE storecalc.store_programs
                        DROP CONSTRAINT store_programs_scope_owner_check;
                    ALTER TABLE storecalc.store_programs
                        ADD CONSTRAINT store_programs_scope_owner_check CHECK (true);
                `)
            );
            await expectRejected(
                runMigrationSql(client, programVerifySql),
                "storecalc_program_verify_check_definition_mismatch",
                "P0001"
            );
            await expectRejected(
                runMigrationSql(client, programDownSql),
                "storecalc_program_rollback_check_drift",
                "P0001"
            );
            await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
                client.query(`
                    ALTER TABLE storecalc.store_programs
                        DROP CONSTRAINT store_programs_scope_owner_check;
                    ALTER TABLE storecalc.store_programs
                        ADD CONSTRAINT store_programs_scope_owner_check
                        CHECK (
                            (record_scope = 'public' AND owner_user_id IS NULL)
                            OR (record_scope = 'private' AND owner_user_id IS NOT NULL)
                        );
                `)
            );

            await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
                client.query(
                    `GRANT SELECT ON storecalc.store_programs TO ${quoteIdentifier(OUTSIDER_ROLE)}`
                )
            );
            await expectRejected(
                runMigrationSql(client, programVerifySql),
                "storecalc_program_verify_unexpected_grantee",
                "P0001"
            );
            await expectRejected(
                runMigrationSql(client, programDownSql),
                "storecalc_program_rollback_unexpected_grantee",
                "P0001"
            );
            await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
                client.query(
                    `REVOKE SELECT ON storecalc.store_programs FROM ${quoteIdentifier(OUTSIDER_ROLE)}`
                )
            );

            await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
                client.query(
                    "ALTER TABLE storecalc.program_facility_assignments DISABLE TRIGGER program_facility_assignments_coherent_trigger"
                )
            );
            await expectRejected(
                runMigrationSql(client, programVerifySql),
                "storecalc_program_verify_table_security_mismatch",
                "P0001"
            );
            await expectRejected(
                runMigrationSql(client, programDownSql),
                "storecalc_program_rollback_trigger_drift",
                "P0001"
            );
            await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
                client.query(
                    "ALTER TABLE storecalc.program_facility_assignments ENABLE TRIGGER program_facility_assignments_coherent_trigger"
                )
            );

            await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
                client.query(`
                    UPDATE storecalc.schema_capabilities
                    SET schema_version = 3
                    WHERE capability_key = 'public.directory'
                `)
            );
            await expectRejected(
                runMigrationSql(client, programVerifySql),
                "storecalc_program_verify_capability_state_mismatch",
                "P0001"
            );
            await expectRejected(
                runMigrationSql(client, programDownSql),
                "storecalc_program_rollback_capability_state_changed",
                "P0001"
            );
            await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
                client.query(`
                    UPDATE storecalc.schema_capabilities
                    SET schema_version = 2
                    WHERE capability_key = 'public.directory'
                `)
            );

            await runMigrationSql(client, programVerifySql);
            const installedFingerprint = await schemaFingerprint(client);
            await expectRejected(
                runMigrationSql(client, programUpSql),
                "storecalc_program_directory_relation_mismatch",
                "P0001"
            );
            assert.deepEqual(
                await schemaFingerprint(client),
                installedFingerprint,
                "a rejected program migration rerun changed database state"
            );

            await runMigrationSql(client, programDownSql);
            await runMigrationSql(client, directoryVerifySql);
            assert.deepEqual(
                await directoryShape(client),
                directoryFingerprint,
                "program rollback did not restore the directory schema and capability shape"
            );

            await runAsRole(client, ROLE_SETTINGS.migration_owner_role, () =>
                client.query(`
                    DELETE FROM storecalc.facilities;
                    DELETE FROM storecalc.agencies;
                    DELETE FROM storecalc.jurisdictions;
                    DELETE FROM storecalc.countries;
                    DELETE FROM storecalc.reviewed_timezones;
                    DELETE FROM storecalc.contributor_subjects;
                `)
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
