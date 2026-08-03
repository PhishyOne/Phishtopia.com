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
    allowed_grantee_oids oid[];
    source_role text;
    target_role text;
    actual_relations text[];
    actual_constraints text[];
    actual_indexes text[];
    actual_columns text[];
    actual_capabilities text[];
    expected_relations constant text[] := ARRAY[
        'schema_capabilities:r',
        'schema_capabilities_capability_key_key:i',
        'schema_capabilities_id_seq:S',
        'schema_capabilities_pkey:i'
    ];
    expected_constraints constant text[] := ARRAY[
        'schema_capabilities_available_verified_check:c:CHECK (((NOT is_available) OR (verified_at IS NOT NULL)))',
        'schema_capabilities_capability_key_format_check:c:CHECK ((((char_length(capability_key) >= 1) AND (char_length(capability_key) <= 64)) AND (octet_length(capability_key) <= 64) AND (capability_key ~ ''^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)*$''::text)))',
        'schema_capabilities_capability_key_key:u:UNIQUE (capability_key)',
        'schema_capabilities_migration_key_format_check:c:CHECK ((((char_length(migration_key) >= 6) AND (char_length(migration_key) <= 64)) AND (octet_length(migration_key) <= 64) AND (migration_key ~ ''^[0-9]{4}_[a-z][a-z0-9_]*$''::text)))',
        'schema_capabilities_pkey:p:PRIMARY KEY (id)',
        'schema_capabilities_schema_version_check:c:CHECK ((schema_version >= 0))'
    ];
    expected_indexes constant text[] := ARRAY[
        'schema_capabilities_capability_key_key:CREATE UNIQUE INDEX schema_capabilities_capability_key_key ON storecalc.schema_capabilities USING btree (capability_key)',
        'schema_capabilities_pkey:CREATE UNIQUE INDEX schema_capabilities_pkey ON storecalc.schema_capabilities USING btree (id)'
    ];
    expected_columns constant text[] := ARRAY[
        'id:integer:NO:BY DEFAULT:',
        'capability_key:text:NO::',
        'schema_version:integer:NO::',
        'is_available:boolean:NO::false',
        'verified_at:timestamp with time zone:YES::',
        'migration_key:text:NO::',
        'updated_at:timestamp with time zone:NO::transaction_timestamp()'
    ];
    expected_capabilities constant text[] := ARRAY[
        '1:schema.foundation:1:true:0001_schema_foundation',
        '2:public.directory:0:false:0001_schema_foundation',
        '3:anonymous.calculation:0:false:0001_schema_foundation',
        '4:saved.orders:0:false:0001_schema_foundation',
        '5:public.contribution:0:false:0001_schema_foundation',
        '6:evidence.upload:0:false:0001_schema_foundation',
        '7:owner.support:0:false:0001_schema_foundation',
        '8:scoped.profiles:0:false:0001_schema_foundation'
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

    SELECT array_agg(oid ORDER BY oid)
    INTO allowed_grantee_oids
    FROM pg_roles
    WHERE rolname = ANY (configured_roles);

    IF COALESCE(cardinality(allowed_grantee_oids), 0) <> 4
       OR lower('public') = ANY (
           ARRAY(
               SELECT lower(role_name)
               FROM unnest(configured_roles) AS role_name
           )
       ) THEN
        RAISE EXCEPTION 'storecalc_verify_role_config_invalid'
            USING ERRCODE = '22023';
    END IF;

    IF migration_owner_role <> current_user THEN
        RAISE EXCEPTION 'storecalc_verify_owner_mismatch'
            USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_roles
        WHERE rolname = ANY (configured_roles)
          AND (
              rolsuper
              OR rolcreaterole
              OR rolcreatedb
              OR rolreplication
              OR rolbypassrls
          )
    ) THEN
        RAISE EXCEPTION 'storecalc_verify_role_is_overprivileged'
            USING ERRCODE = '42501';
    END IF;

    IF NOT has_database_privilege(
        migration_owner_role,
        current_database(),
        'CREATE'
    ) OR has_database_privilege(web_role, current_database(), 'CREATE')
       OR has_database_privilege(worker_role, current_database(), 'CREATE')
       OR has_database_privilege(backup_role, current_database(), 'CREATE') THEN
        RAISE EXCEPTION 'storecalc_verify_database_grant_mismatch'
            USING ERRCODE = '42501';
    END IF;

    FOREACH source_role IN ARRAY configured_roles LOOP
        FOREACH target_role IN ARRAY configured_roles LOOP
            IF source_role <> target_role
               AND pg_has_role(source_role, target_role, 'MEMBER') THEN
                RAISE EXCEPTION 'storecalc_verify_role_inheritance_mismatch'
                    USING ERRCODE = '42501';
            END IF;
        END LOOP;
    END LOOP;

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

    IF EXISTS (
        SELECT 1
        FROM pg_class
        WHERE relnamespace = 'storecalc'::regnamespace
          AND pg_get_userbyid(relowner) <> migration_owner_role
    ) THEN
        RAISE EXCEPTION 'storecalc_relation_owner_mismatch';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_class
        WHERE oid = 'storecalc.schema_capabilities'::regclass
          AND (
              relpersistence <> 'p'
              OR relrowsecurity
              OR relforcerowsecurity
          )
    ) OR EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'storecalc.schema_capabilities'::regclass
          AND NOT tgisinternal
    ) OR EXISTS (
        SELECT 1
        FROM pg_policy
        WHERE polrelid = 'storecalc.schema_capabilities'::regclass
    ) THEN
        RAISE EXCEPTION 'storecalc_table_security_definition_mismatch';
    END IF;

    SELECT array_agg(format('%s:%s', relname, relkind) ORDER BY relname)
    INTO actual_relations
    FROM pg_class
    WHERE relnamespace = 'storecalc'::regnamespace;

    IF actual_relations IS DISTINCT FROM expected_relations THEN
        RAISE EXCEPTION 'storecalc_relation_definition_mismatch';
    END IF;

    SELECT array_agg(
        format('%s:%s:%s', conname, contype, pg_get_constraintdef(oid))
        ORDER BY conname
    )
    INTO actual_constraints
    FROM pg_constraint
    WHERE conrelid = 'storecalc.schema_capabilities'::regclass;

    IF actual_constraints IS DISTINCT FROM expected_constraints THEN
        RAISE EXCEPTION 'storecalc_constraint_definition_mismatch';
    END IF;

    SELECT array_agg(
        format('%s:%s', relname, pg_get_indexdef(oid))
        ORDER BY relname
    )
    INTO actual_indexes
    FROM pg_class
    WHERE relnamespace = 'storecalc'::regnamespace
      AND relkind = 'i';

    IF actual_indexes IS DISTINCT FROM expected_indexes THEN
        RAISE EXCEPTION 'storecalc_index_definition_mismatch';
    END IF;

    SELECT array_agg(
        format(
            '%s:%s:%s:%s:%s',
            column_name,
            data_type,
            is_nullable,
            COALESCE(identity_generation, ''),
            COALESCE(column_default, '')
        )
        ORDER BY ordinal_position
    )
    INTO actual_columns
    FROM information_schema.columns
    WHERE table_schema = 'storecalc'
      AND table_name = 'schema_capabilities';

    IF actual_columns IS DISTINCT FROM expected_columns THEN
        RAISE EXCEPTION 'storecalc_column_definition_mismatch';
    END IF;

    IF pg_get_serial_sequence(
        'storecalc.schema_capabilities',
        'id'
    ) IS DISTINCT FROM 'storecalc.schema_capabilities_id_seq'
       OR NOT EXISTS (
           SELECT 1
           FROM pg_sequence
           WHERE seqrelid = 'storecalc.schema_capabilities_id_seq'::regclass
             AND seqstart = 1
             AND seqincrement = 1
             AND seqmax = 2147483647
             AND seqmin = 1
             AND seqcache = 1
             AND NOT seqcycle
       )
       OR (SELECT last_value FROM storecalc.schema_capabilities_id_seq) <> 8
       OR NOT (SELECT is_called FROM storecalc.schema_capabilities_id_seq) THEN
        RAISE EXCEPTION 'storecalc_sequence_definition_mismatch';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM (
            SELECT acl.grantee
            FROM pg_namespace AS namespaces,
                 LATERAL aclexplode(COALESCE(namespaces.nspacl, acldefault('n', namespaces.nspowner))) AS acl
            WHERE namespaces.nspname = 'storecalc'

            UNION ALL

            SELECT acl.grantee
            FROM pg_class AS relations,
                 LATERAL aclexplode(COALESCE(relations.relacl, acldefault('r', relations.relowner))) AS acl
            WHERE relations.oid = 'storecalc.schema_capabilities'::regclass

            UNION ALL

            SELECT acl.grantee
            FROM pg_class AS relations,
                 LATERAL aclexplode(COALESCE(relations.relacl, acldefault('S', relations.relowner))) AS acl
            WHERE relations.oid = 'storecalc.schema_capabilities_id_seq'::regclass
        ) AS object_grants
        WHERE object_grants.grantee <> ALL (allowed_grantee_oids)
    ) THEN
        RAISE EXCEPTION 'storecalc_unexpected_grantee_detected';
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

    SELECT array_agg(
        format(
            '%s:%s:%s:%s:%s',
            id,
            capability_key,
            schema_version,
            is_available,
            migration_key
        )
        ORDER BY id
    )
    INTO actual_capabilities
    FROM storecalc.schema_capabilities;

    IF actual_capabilities IS DISTINCT FROM expected_capabilities
       OR EXISTS (
           SELECT 1
           FROM storecalc.schema_capabilities
           WHERE (
               capability_key = 'schema.foundation'
               AND (
                   verified_at IS NULL
                   OR updated_at IS DISTINCT FROM verified_at
               )
           ) OR (
               capability_key <> 'schema.foundation'
               AND verified_at IS NOT NULL
           )
       )
       OR (SELECT count(DISTINCT updated_at) FROM storecalc.schema_capabilities) <> 1 THEN
        RAISE EXCEPTION 'storecalc_capability_state_mismatch';
    END IF;
END
$storecalc_verify$;

COMMIT;
