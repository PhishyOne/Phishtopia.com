BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

SELECT pg_advisory_xact_lock(7356507374803211041);

DO $storecalc_verify$
DECLARE
    migration_owner_role text := current_setting('storecalc.migration_owner_role', true);
    web_role text := current_setting('storecalc.web_role', true);
    worker_role text := current_setting('storecalc.worker_role', true);
    backup_role text := current_setting('storecalc.backup_role', true);
    configured_roles text[];
    actual_relations text[];
    actual_constraints text[];
    actual_columns text[];
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
    expected_columns constant text[] := ARRAY[
        'id:integer:NO:BY DEFAULT',
        'capability_key:text:NO:',
        'schema_version:integer:NO:',
        'is_available:boolean:NO:',
        'verified_at:timestamp with time zone:YES:',
        'migration_key:text:NO:',
        'updated_at:timestamp with time zone:NO:'
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
        RAISE EXCEPTION 'storecalc_verify_role_config_missing'
            USING ERRCODE = '22023';
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
        RAISE EXCEPTION 'storecalc_relation_definition_mismatch';
    END IF;

    SELECT array_agg(format('%s:%s', conname, contype) ORDER BY conname)
    INTO actual_constraints
    FROM pg_constraint
    WHERE conrelid = 'storecalc.schema_capabilities'::regclass;

    IF actual_constraints IS DISTINCT FROM expected_constraints THEN
        RAISE EXCEPTION 'storecalc_constraint_definition_mismatch';
    END IF;

    SELECT array_agg(
        format('%s:%s:%s:%s', column_name, data_type, is_nullable, identity_generation)
        ORDER BY ordinal_position
    )
    INTO actual_columns
    FROM information_schema.columns
    WHERE table_schema = 'storecalc'
      AND table_name = 'schema_capabilities';

    IF actual_columns IS DISTINCT FROM expected_columns THEN
        RAISE EXCEPTION 'storecalc_column_definition_mismatch';
    END IF;

    IF (
        SELECT column_default
        FROM information_schema.columns
        WHERE table_schema = 'storecalc'
          AND table_name = 'schema_capabilities'
          AND column_name = 'is_available'
    ) IS DISTINCT FROM 'false' THEN
        RAISE EXCEPTION 'storecalc_availability_default_mismatch';
    END IF;

    IF (
        SELECT column_default
        FROM information_schema.columns
        WHERE table_schema = 'storecalc'
          AND table_name = 'schema_capabilities'
          AND column_name = 'updated_at'
    ) IS DISTINCT FROM 'transaction_timestamp()' THEN
        RAISE EXCEPTION 'storecalc_updated_at_default_mismatch';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_namespace AS namespaces,
             LATERAL aclexplode(COALESCE(namespaces.nspacl, acldefault('n', namespaces.nspowner))) AS acl
        WHERE namespaces.nspname = 'storecalc'
          AND acl.grantee = 0
    ) OR EXISTS (
        SELECT 1
        FROM pg_class AS relations,
             LATERAL aclexplode(COALESCE(relations.relacl, acldefault('r', relations.relowner))) AS acl
        WHERE relations.oid = 'storecalc.schema_capabilities'::regclass
          AND acl.grantee = 0
    ) OR EXISTS (
        SELECT 1
        FROM pg_class AS relations,
             LATERAL aclexplode(COALESCE(relations.relacl, acldefault('S', relations.relowner))) AS acl
        WHERE relations.oid = 'storecalc.schema_capabilities_id_seq'::regclass
          AND acl.grantee = 0
    ) THEN
        RAISE EXCEPTION 'storecalc_public_grant_detected';
    END IF;

    IF NOT has_schema_privilege(web_role, 'storecalc', 'USAGE')
       OR has_schema_privilege(web_role, 'storecalc', 'CREATE')
       OR NOT has_schema_privilege(worker_role, 'storecalc', 'USAGE')
       OR has_schema_privilege(worker_role, 'storecalc', 'CREATE')
       OR NOT has_schema_privilege(backup_role, 'storecalc', 'USAGE')
       OR has_schema_privilege(backup_role, 'storecalc', 'CREATE') THEN
        RAISE EXCEPTION 'storecalc_schema_grant_mismatch';
    END IF;

    IF NOT has_table_privilege(web_role, 'storecalc.schema_capabilities', 'SELECT')
       OR has_table_privilege(web_role, 'storecalc.schema_capabilities', 'INSERT')
       OR has_table_privilege(web_role, 'storecalc.schema_capabilities', 'UPDATE')
       OR has_table_privilege(web_role, 'storecalc.schema_capabilities', 'DELETE')
       OR NOT has_table_privilege(worker_role, 'storecalc.schema_capabilities', 'SELECT')
       OR has_table_privilege(worker_role, 'storecalc.schema_capabilities', 'INSERT')
       OR has_table_privilege(worker_role, 'storecalc.schema_capabilities', 'UPDATE')
       OR has_table_privilege(worker_role, 'storecalc.schema_capabilities', 'DELETE')
       OR NOT has_table_privilege(backup_role, 'storecalc.schema_capabilities', 'SELECT')
       OR has_table_privilege(backup_role, 'storecalc.schema_capabilities', 'INSERT')
       OR has_table_privilege(backup_role, 'storecalc.schema_capabilities', 'UPDATE')
       OR has_table_privilege(backup_role, 'storecalc.schema_capabilities', 'DELETE') THEN
        RAISE EXCEPTION 'storecalc_table_grant_mismatch';
    END IF;

    IF has_sequence_privilege(web_role, 'storecalc.schema_capabilities_id_seq', 'SELECT')
       OR has_sequence_privilege(web_role, 'storecalc.schema_capabilities_id_seq', 'USAGE')
       OR has_sequence_privilege(worker_role, 'storecalc.schema_capabilities_id_seq', 'SELECT')
       OR has_sequence_privilege(worker_role, 'storecalc.schema_capabilities_id_seq', 'USAGE')
       OR NOT has_sequence_privilege(backup_role, 'storecalc.schema_capabilities_id_seq', 'SELECT')
       OR has_sequence_privilege(backup_role, 'storecalc.schema_capabilities_id_seq', 'USAGE')
       OR has_sequence_privilege(backup_role, 'storecalc.schema_capabilities_id_seq', 'UPDATE') THEN
        RAISE EXCEPTION 'storecalc_sequence_grant_mismatch';
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
        RAISE EXCEPTION 'storecalc_capability_state_mismatch';
    END IF;
END
$storecalc_verify$;

COMMIT;
