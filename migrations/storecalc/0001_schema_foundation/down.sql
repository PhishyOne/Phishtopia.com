BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

SELECT pg_advisory_xact_lock(7356507374803211041);

DO $storecalc_rollback_preflight$
DECLARE
    migration_owner_role text := current_setting('storecalc.migration_owner_role', true);
    web_role text := current_setting('storecalc.web_role', true);
    worker_role text := current_setting('storecalc.worker_role', true);
    backup_role text := current_setting('storecalc.backup_role', true);
    configured_roles text[];
    actual_relations text[];
    actual_constraints text[];
    expected_relations constant text[] := ARRAY[
        'schema_capabilities:r',
        'schema_capabilities_capability_key_key:i',
        'schema_capabilities_id_seq:S',
        'schema_capabilities_pkey:i'
    ];
    expected_constraints constant text[] := ARRAY[
        'schema_capabilities_available_verified_check:c',
        'schema_capabilities_capability_key_format_check:c',
        'schema_capabilities_capability_key_key:u',
        'schema_capabilities_migration_key_format_check:c',
        'schema_capabilities_pkey:p',
        'schema_capabilities_schema_version_check:c'
    ];
    relation_owner text;
BEGIN
    configured_roles := ARRAY[
        migration_owner_role,
        web_role,
        worker_role,
        backup_role
    ];

    IF array_position(configured_roles, NULL) IS NOT NULL
       OR array_position(configured_roles, '') IS NOT NULL THEN
        RAISE EXCEPTION 'storecalc_rollback_role_config_missing'
            USING ERRCODE = '22023';
    END IF;

    IF migration_owner_role <> current_user THEN
        RAISE EXCEPTION 'storecalc_rollback_owner_mismatch'
            USING ERRCODE = '42501';
    END IF;

    IF to_regnamespace('storecalc') IS NULL
       OR to_regclass('storecalc.schema_capabilities') IS NULL THEN
        RAISE EXCEPTION 'storecalc_foundation_missing';
    END IF;

    SELECT pg_get_userbyid(nspowner)
    INTO relation_owner
    FROM pg_namespace
    WHERE nspname = 'storecalc';

    IF relation_owner IS DISTINCT FROM migration_owner_role THEN
        RAISE EXCEPTION 'storecalc_schema_owner_mismatch';
    END IF;

    SELECT tableowner
    INTO relation_owner
    FROM pg_tables
    WHERE schemaname = 'storecalc'
      AND tablename = 'schema_capabilities';

    IF relation_owner IS DISTINCT FROM migration_owner_role THEN
        RAISE EXCEPTION 'storecalc_table_owner_mismatch';
    END IF;

    SELECT array_agg(format('%s:%s', relname, relkind) ORDER BY relname)
    INTO actual_relations
    FROM pg_class
    WHERE relnamespace = 'storecalc'::regnamespace;

    IF actual_relations IS DISTINCT FROM expected_relations THEN
        RAISE EXCEPTION 'storecalc_rollback_relation_mismatch';
    END IF;

    SELECT array_agg(format('%s:%s', conname, contype) ORDER BY conname)
    INTO actual_constraints
    FROM pg_constraint
    WHERE conrelid = 'storecalc.schema_capabilities'::regclass;

    IF actual_constraints IS DISTINCT FROM expected_constraints THEN
        RAISE EXCEPTION 'storecalc_rollback_constraint_mismatch';
    END IF;

    IF (SELECT count(*) FROM storecalc.schema_capabilities) <> 8
       OR (SELECT count(*) FROM storecalc.schema_capabilities WHERE is_available) <> 1
       OR EXISTS (
           SELECT 1
           FROM storecalc.schema_capabilities
           WHERE migration_key <> '0001_schema_foundation'
       )
       OR NOT EXISTS (
           SELECT 1
           FROM storecalc.schema_capabilities
           WHERE capability_key = 'schema.foundation'
             AND schema_version = 1
             AND is_available
             AND verified_at IS NOT NULL
       )
       OR EXISTS (
           SELECT 1
           FROM storecalc.schema_capabilities
           WHERE capability_key <> 'schema.foundation'
             AND (
                 schema_version <> 0
                 OR is_available
                 OR verified_at IS NOT NULL
             )
       ) THEN
        RAISE EXCEPTION 'storecalc_rollback_capability_state_changed';
    END IF;
END
$storecalc_rollback_preflight$;

DROP TABLE storecalc.schema_capabilities;
DROP SCHEMA storecalc;

COMMIT;
