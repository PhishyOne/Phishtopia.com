BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

SELECT pg_advisory_xact_lock(7356507374803211041);

DO $storecalc_program_rollback_preflight$
DECLARE
    migration_owner_role text := current_setting('storecalc.migration_owner_role', true);
    web_role text := current_setting('storecalc.web_role', true);
    worker_role text := current_setting('storecalc.worker_role', true);
    backup_role text := current_setting('storecalc.backup_role', true);
    configured_roles text[];
    allowed_grantee_oids oid[];
    source_role text;
    target_role text;
    object_name text;
    actual_baseline_relations text[];
    actual_baseline_columns text[];
    actual_baseline_constraints text[];
    actual_baseline_indexes text[];
    actual_baseline_foreign_keys text[];
    actual_new_relations text[];
    actual_columns text[];
    actual_constraints text[];
    actual_indexes text[];
    actual_foreign_keys text[];
    actual_triggers text[];
    actual_capabilities text[];
    sequence_last_value bigint;
    sequence_is_called boolean;
    new_tables constant text[] := ARRAY[
        'storecalc.store_programs',
        'storecalc.program_facility_assignments'
    ];
    new_sequences constant text[] := ARRAY[
        'storecalc.store_programs_id_seq',
        'storecalc.program_facility_assignments_id_seq'
    ];
BEGIN
    configured_roles := ARRAY[
        migration_owner_role,
        web_role,
        worker_role,
        backup_role
    ];

    IF array_position(configured_roles, NULL) IS NOT NULL
       OR array_position(configured_roles, '') IS NOT NULL
       OR lower('public') = ANY (
           ARRAY(
               SELECT lower(role_name)
               FROM unnest(configured_roles) AS role_name
           )
       )
       OR (SELECT count(DISTINCT role_name) FROM unnest(configured_roles) AS role_name) <> 4 THEN
        RAISE EXCEPTION 'storecalc_program_rollback_role_config_invalid'
            USING ERRCODE = '22023';
    END IF;

    IF migration_owner_role <> current_user THEN
        RAISE EXCEPTION 'storecalc_program_rollback_owner_mismatch'
            USING ERRCODE = '42501';
    END IF;

    SELECT array_agg(oid ORDER BY oid)
    INTO allowed_grantee_oids
    FROM pg_roles
    WHERE rolname = ANY (configured_roles);

    IF COALESCE(cardinality(allowed_grantee_oids), 0) <> 4
       OR EXISTS (
           SELECT 1
           FROM pg_roles
           WHERE rolname = ANY (configured_roles)
             AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)
       ) THEN
        RAISE EXCEPTION 'storecalc_program_rollback_role_mismatch'
            USING ERRCODE = '42501';
    END IF;

    IF NOT has_database_privilege(migration_owner_role, current_database(), 'CREATE')
       OR has_database_privilege(web_role, current_database(), 'CREATE')
       OR has_database_privilege(worker_role, current_database(), 'CREATE')
       OR has_database_privilege(backup_role, current_database(), 'CREATE') THEN
        RAISE EXCEPTION 'storecalc_program_rollback_database_grant_mismatch'
            USING ERRCODE = '42501';
    END IF;

    FOREACH source_role IN ARRAY configured_roles LOOP
        FOREACH target_role IN ARRAY configured_roles LOOP
            IF source_role <> target_role
               AND pg_has_role(source_role, target_role, 'MEMBER') THEN
                RAISE EXCEPTION 'storecalc_program_rollback_role_inheritance_mismatch'
                    USING ERRCODE = '42501';
            END IF;
        END LOOP;
    END LOOP;

    IF to_regnamespace('storecalc') IS NULL
       OR pg_get_userbyid(
           (SELECT nspowner FROM pg_namespace WHERE nspname = 'storecalc')
       ) IS DISTINCT FROM migration_owner_role THEN
        RAISE EXCEPTION 'storecalc_program_rollback_baseline_mismatch';
    END IF;

    IF to_regclass('public.users') IS NULL
       OR NOT EXISTS (
           SELECT 1
           FROM pg_attribute
           WHERE attrelid = 'public.users'::regclass
             AND attname = 'id'
             AND atttypid = 'integer'::regtype
             AND attnotnull
             AND NOT attisdropped
       ) OR NOT EXISTS (
           SELECT 1
           FROM pg_constraint
           WHERE conrelid = 'public.users'::regclass
             AND contype = 'p'
             AND conkey = ARRAY[
                 (
                     SELECT attnum
                     FROM pg_attribute
                     WHERE attrelid = 'public.users'::regclass
                       AND attname = 'id'
                       AND NOT attisdropped
                 )
             ]::smallint[]
       ) THEN
        RAISE EXCEPTION 'storecalc_program_rollback_users_identity_mismatch';
    END IF;

    SELECT array_agg(format('%s:%s', relname, relkind) ORDER BY relname)
    INTO actual_baseline_relations
    FROM pg_class
    WHERE relnamespace = 'storecalc'::regnamespace
      AND relname <> ALL (
          ARRAY[
              'store_programs',
              'store_programs_id_seq',
              'store_programs_pkey',
              'store_programs_agency_name_idx',
              'store_programs_owner_idx',
              'store_programs_created_by_subject_idx',
              'store_programs_status_name_idx',
              'program_facility_assignments',
              'program_facility_assignments_id_seq',
              'program_facility_assignments_pkey',
              'program_facility_assignments_id_lineage_key',
              'program_facility_assignments_resolution_idx',
              'program_facility_assignments_program_idx'
          ]
      );

    IF md5(array_to_string(actual_baseline_relations, E'\n')) <> 'fca2a2dbb8efbcd63d9747e1b62dead4'
       OR cardinality(actual_baseline_relations) <> 48 THEN
        RAISE EXCEPTION 'storecalc_program_rollback_baseline_relation_mismatch';
    END IF;

    SELECT array_agg(
        format(
            '%s:%s:%s:%s:%s:%s',
            column_row.table_name,
            column_row.column_name,
            column_row.data_type,
            column_row.is_nullable,
            COALESCE(column_row.identity_generation, ''),
            COALESCE(column_row.column_default, '')
        )
        ORDER BY column_row.table_name, column_row.ordinal_position
    )
    INTO actual_baseline_columns
    FROM information_schema.columns AS column_row
    WHERE column_row.table_schema = 'storecalc'
      AND column_row.table_name = ANY (
          ARRAY[
              'contributor_subjects',
              'reviewed_timezones',
              'countries',
              'jurisdictions',
              'agencies',
              'facilities',
              'facility_aliases',
              'facility_sources'
          ]
      );

    IF md5(array_to_string(actual_baseline_columns, E'\n')) <> 'f1b5c0116049455b1d4a32f3d649b3b7'
       OR cardinality(actual_baseline_columns) <> 69 THEN
        RAISE EXCEPTION 'storecalc_program_rollback_baseline_column_mismatch';
    END IF;

    SELECT array_agg(
        format('%s:%s:%s', relation.relname, constraint_row.conname, constraint_row.contype)
        ORDER BY relation.relname, constraint_row.conname
    )
    INTO actual_baseline_constraints
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
    WHERE relation.relnamespace = 'storecalc'::regnamespace
      AND relation.relname <> 'schema_capabilities'
      AND relation.relname <> ALL (ARRAY['store_programs', 'program_facility_assignments']);

    IF md5(array_to_string(actual_baseline_constraints, E'\n')) <> 'f56f7b75661fb074032960b4da5dc668'
       OR cardinality(actual_baseline_constraints) <> 70
       OR EXISTS (
           SELECT 1
           FROM pg_constraint AS constraint_row
           JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
           WHERE relation.relnamespace = 'storecalc'::regnamespace
             AND relation.relname <> 'schema_capabilities'
             AND relation.relname <> ALL (ARRAY['store_programs', 'program_facility_assignments'])
             AND (
                 NOT constraint_row.convalidated
                 OR constraint_row.condeferrable
                 OR constraint_row.condeferred
             )
       ) THEN
        RAISE EXCEPTION 'storecalc_program_rollback_baseline_constraint_mismatch';
    END IF;

    SELECT array_agg(
        format('%s:%s', relation.relname, pg_get_indexdef(relation.oid))
        ORDER BY relation.relname
    )
    INTO actual_baseline_indexes
    FROM pg_class AS relation
    WHERE relation.relnamespace = 'storecalc'::regnamespace
      AND relation.relkind = 'i'
      AND relation.relname <> ALL (
          ARRAY[
              'schema_capabilities_capability_key_key',
              'schema_capabilities_pkey',
              'store_programs_pkey',
              'store_programs_agency_name_idx',
              'store_programs_owner_idx',
              'store_programs_created_by_subject_idx',
              'store_programs_status_name_idx',
              'program_facility_assignments_pkey',
              'program_facility_assignments_id_lineage_key',
              'program_facility_assignments_resolution_idx',
              'program_facility_assignments_program_idx'
          ]
      );

    IF md5(array_to_string(actual_baseline_indexes, E'\n')) <> 'c463b1d054846276d68bacef913d0f34'
       OR cardinality(actual_baseline_indexes) <> 29 THEN
        RAISE EXCEPTION 'storecalc_program_rollback_baseline_index_mismatch';
    END IF;

    SELECT array_agg(
        format(
            '%s:%s.%s:%s:%s.%s:%s:%s',
            constraint_row.conname,
            source_namespace.nspname,
            source_relation.relname,
            ARRAY(
                SELECT attribute.attname
                FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key(attnum, position)
                JOIN pg_attribute AS attribute
                  ON attribute.attrelid = constraint_row.conrelid
                 AND attribute.attnum = key.attnum
                ORDER BY key.position
            ),
            target_namespace.nspname,
            target_relation.relname,
            ARRAY(
                SELECT attribute.attname
                FROM unnest(constraint_row.confkey) WITH ORDINALITY AS key(attnum, position)
                JOIN pg_attribute AS attribute
                  ON attribute.attrelid = constraint_row.confrelid
                 AND attribute.attnum = key.attnum
                ORDER BY key.position
            ),
            constraint_row.confdeltype
        )
        ORDER BY constraint_row.conname
    )
    INTO actual_baseline_foreign_keys
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS source_relation ON source_relation.oid = constraint_row.conrelid
    JOIN pg_namespace AS source_namespace ON source_namespace.oid = source_relation.relnamespace
    JOIN pg_class AS target_relation ON target_relation.oid = constraint_row.confrelid
    JOIN pg_namespace AS target_namespace ON target_namespace.oid = target_relation.relnamespace
    WHERE constraint_row.contype = 'f'
      AND source_relation.relnamespace = 'storecalc'::regnamespace
      AND source_relation.relname <> ALL (ARRAY['store_programs', 'program_facility_assignments']);

    IF md5(array_to_string(actual_baseline_foreign_keys, E'\n')) <> '040b11e9754c2117a62e0c56af9e18bb'
       OR cardinality(actual_baseline_foreign_keys) <> 14 THEN
        RAISE EXCEPTION 'storecalc_program_rollback_baseline_foreign_key_mismatch';
    END IF;

    SELECT array_agg(format('%s:%s', relname, relkind) ORDER BY relname)
    INTO actual_new_relations
    FROM pg_class
    WHERE relnamespace = 'storecalc'::regnamespace
      AND relname = ANY (
          ARRAY[
              'store_programs',
              'store_programs_id_seq',
              'store_programs_pkey',
              'store_programs_agency_name_idx',
              'store_programs_owner_idx',
              'store_programs_created_by_subject_idx',
              'store_programs_status_name_idx',
              'program_facility_assignments',
              'program_facility_assignments_id_seq',
              'program_facility_assignments_pkey',
              'program_facility_assignments_id_lineage_key',
              'program_facility_assignments_resolution_idx',
              'program_facility_assignments_program_idx'
          ]
      );

    IF actual_new_relations IS DISTINCT FROM ARRAY[
        'program_facility_assignments:r',
        'program_facility_assignments_id_lineage_key:i',
        'program_facility_assignments_id_seq:S',
        'program_facility_assignments_pkey:i',
        'program_facility_assignments_program_idx:i',
        'program_facility_assignments_resolution_idx:i',
        'store_programs:r',
        'store_programs_agency_name_idx:i',
        'store_programs_created_by_subject_idx:i',
        'store_programs_id_seq:S',
        'store_programs_owner_idx:i',
        'store_programs_pkey:i',
        'store_programs_status_name_idx:i'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_program_rollback_relation_mismatch';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_class
        WHERE relnamespace = 'storecalc'::regnamespace
          AND pg_get_userbyid(relowner) <> migration_owner_role
    ) OR EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE pronamespace = 'storecalc'::regnamespace
          AND pg_get_userbyid(proowner) <> migration_owner_role
    ) THEN
        RAISE EXCEPTION 'storecalc_program_rollback_owner_drift';
    END IF;

    SELECT array_agg(
        format(
            '%s:%s:%s:%s:%s:%s',
            column_row.table_name,
            column_row.column_name,
            column_row.data_type,
            column_row.is_nullable,
            COALESCE(column_row.identity_generation, ''),
            COALESCE(column_row.column_default, '')
        )
        ORDER BY column_row.table_name, column_row.ordinal_position
    )
    INTO actual_columns
    FROM information_schema.columns AS column_row
    WHERE column_row.table_schema = 'storecalc'
      AND column_row.table_name = ANY (ARRAY['store_programs', 'program_facility_assignments']);

    IF md5(array_to_string(actual_columns, E'\n')) <> '78a643d7ab673d84995cdcc825588726'
       OR cardinality(actual_columns) <> 23 THEN
        RAISE EXCEPTION 'storecalc_program_rollback_column_mismatch';
    END IF;

    SELECT array_agg(
        format('%s:%s:%s', relation.relname, constraint_row.conname, constraint_row.contype)
        ORDER BY relation.relname, constraint_row.conname
    )
    INTO actual_constraints
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
    WHERE relation.relnamespace = 'storecalc'::regnamespace
      AND relation.relname = ANY (ARRAY['store_programs', 'program_facility_assignments']);

    IF md5(array_to_string(actual_constraints, E'\n')) <> 'a6c0cf4f60fed8fed1b1a51b6498ef79'
       OR cardinality(actual_constraints) <> 23
       OR EXISTS (
           SELECT 1
           FROM pg_constraint AS constraint_row
           JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
           WHERE relation.relnamespace = 'storecalc'::regnamespace
             AND relation.relname = ANY (ARRAY['store_programs', 'program_facility_assignments'])
             AND (
                 NOT constraint_row.convalidated
                 OR constraint_row.condeferrable
                 OR constraint_row.condeferred
             )
       ) THEN
        RAISE EXCEPTION 'storecalc_program_rollback_constraint_mismatch';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.store_programs'::regclass
          AND conname = 'store_programs_scope_owner_check'
          AND pg_get_constraintdef(oid) = 'CHECK ((((record_scope = ''public''::text) AND (owner_user_id IS NULL)) OR ((record_scope = ''private''::text) AND (owner_user_id IS NOT NULL))))'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.program_facility_assignments'::regclass
          AND conname = 'program_facility_assignments_evidence_deferred_check'
          AND pg_get_constraintdef(oid) = 'CHECK ((source_evidence_id IS NULL))'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.program_facility_assignments'::regclass
          AND conname = 'program_facility_assignments_retired_state_check'
          AND pg_get_constraintdef(oid) = 'CHECK (((assignment_state = ''retired''::text) = (retired_at IS NOT NULL)))'
    ) THEN
        RAISE EXCEPTION 'storecalc_program_rollback_check_drift';
    END IF;

    SELECT array_agg(
        format('%s:%s', relation.relname, pg_get_indexdef(relation.oid))
        ORDER BY relation.relname
    )
    INTO actual_indexes
    FROM pg_class AS relation
    WHERE relation.relnamespace = 'storecalc'::regnamespace
      AND relation.relkind = 'i'
      AND relation.relname = ANY (
          ARRAY[
              'store_programs_pkey',
              'store_programs_agency_name_idx',
              'store_programs_owner_idx',
              'store_programs_created_by_subject_idx',
              'store_programs_status_name_idx',
              'program_facility_assignments_pkey',
              'program_facility_assignments_id_lineage_key',
              'program_facility_assignments_resolution_idx',
              'program_facility_assignments_program_idx'
          ]
      );

    IF md5(array_to_string(actual_indexes, E'\n')) <> '2b2657b34ac8af7b17e3bfdd89372213'
       OR cardinality(actual_indexes) <> 9 THEN
        RAISE EXCEPTION 'storecalc_program_rollback_index_mismatch';
    END IF;

    SELECT array_agg(
        format(
            '%s:%s.%s:%s:%s.%s:%s:%s',
            constraint_row.conname,
            source_namespace.nspname,
            source_relation.relname,
            ARRAY(
                SELECT attribute.attname
                FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key(attnum, position)
                JOIN pg_attribute AS attribute
                  ON attribute.attrelid = constraint_row.conrelid
                 AND attribute.attnum = key.attnum
                ORDER BY key.position
            ),
            target_namespace.nspname,
            target_relation.relname,
            ARRAY(
                SELECT attribute.attname
                FROM unnest(constraint_row.confkey) WITH ORDINALITY AS key(attnum, position)
                JOIN pg_attribute AS attribute
                  ON attribute.attrelid = constraint_row.confrelid
                 AND attribute.attnum = key.attnum
                ORDER BY key.position
            ),
            constraint_row.confdeltype
        )
        ORDER BY constraint_row.conname
    )
    INTO actual_foreign_keys
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS source_relation ON source_relation.oid = constraint_row.conrelid
    JOIN pg_namespace AS source_namespace ON source_namespace.oid = source_relation.relnamespace
    JOIN pg_class AS target_relation ON target_relation.oid = constraint_row.confrelid
    JOIN pg_namespace AS target_namespace ON target_namespace.oid = target_relation.relnamespace
    WHERE constraint_row.contype = 'f'
      AND source_relation.relnamespace = 'storecalc'::regnamespace
      AND source_relation.relname = ANY (ARRAY['store_programs', 'program_facility_assignments']);

    IF md5(array_to_string(actual_foreign_keys, E'\n')) <> '0e7e58648fd73f040f1c28d8ef73402c'
       OR cardinality(actual_foreign_keys) <> 5 THEN
        RAISE EXCEPTION 'storecalc_program_rollback_foreign_key_mismatch';
    END IF;

    IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'storecalc'::regnamespace) <> 7
       OR NOT EXISTS (
           SELECT 1 FROM pg_proc
           WHERE oid = 'storecalc.assert_reviewed_timezone_exists()'::regprocedure
             AND prosecdef
             AND proconfig = ARRAY['search_path=pg_catalog, storecalc']
             AND md5(prosrc) = '413d3098a67b7cfabe0cd4aed1917988'
       ) OR NOT EXISTS (
           SELECT 1 FROM pg_proc
           WHERE oid = 'storecalc.assert_jurisdiction_acyclic()'::regprocedure
             AND prosecdef
             AND proconfig = ARRAY['search_path=pg_catalog, storecalc']
             AND md5(prosrc) = 'c7c391a378c393c1a65c7cfc2f543c5b'
       ) OR NOT EXISTS (
           SELECT 1 FROM pg_proc
           WHERE oid = 'storecalc.assert_facility_merge_acyclic()'::regprocedure
             AND prosecdef
             AND proconfig = ARRAY['search_path=pg_catalog, storecalc']
             AND md5(prosrc) = 'cdd50d9c47881788dbfbb8b36f589957'
       ) OR NOT EXISTS (
           SELECT 1 FROM pg_proc
           WHERE oid = 'storecalc.lock_program_assignment_topology()'::regprocedure
             AND prosecdef
             AND proconfig = ARRAY['search_path=pg_catalog, storecalc']
             AND md5(prosrc) = '9569aecc34463c8c9246f2b54735c0fe'
       ) OR NOT EXISTS (
           SELECT 1 FROM pg_proc
           WHERE oid = 'storecalc.assert_program_assignment_coherent()'::regprocedure
             AND prosecdef
             AND proconfig = ARRAY['search_path=pg_catalog, storecalc']
             AND md5(prosrc) = '36aede37eb9412cba9649983a79e87b2'
       ) OR NOT EXISTS (
           SELECT 1 FROM pg_proc
           WHERE oid = 'storecalc.protect_store_program_assignment_lineage()'::regprocedure
             AND prosecdef
             AND proconfig = ARRAY['search_path=pg_catalog, storecalc']
             AND md5(prosrc) = '0bf202d4159ba9df6aa8c16076b2d306'
       ) OR NOT EXISTS (
           SELECT 1 FROM pg_proc
           WHERE oid = 'storecalc.protect_program_assignment_parent_lineage()'::regprocedure
             AND prosecdef
             AND proconfig = ARRAY['search_path=pg_catalog, storecalc']
             AND md5(prosrc) = 'bac771f0f93698d804caa354c5aeb4e7'
       ) THEN
        RAISE EXCEPTION 'storecalc_program_rollback_function_drift';
    END IF;

    SELECT array_agg(
        format('%s:%s:%s:%s:%s', trigger_row.tgname, relation.relname, procedure.proname, trigger_row.tgenabled, trigger_row.tgtype)
        ORDER BY trigger_row.tgname
    )
    INTO actual_triggers
    FROM pg_trigger AS trigger_row
    JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid
    JOIN pg_proc AS procedure ON procedure.oid = trigger_row.tgfoid
    WHERE relation.relnamespace = 'storecalc'::regnamespace
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgqual IS NULL;

    IF actual_triggers IS DISTINCT FROM ARRAY[
        'agencies_assignment_lineage_trigger:agencies:protect_program_assignment_parent_lineage:O:19',
        'agencies_assignment_topology_lock_trigger:agencies:lock_program_assignment_topology:O:18',
        'facilities_assignment_lineage_trigger:facilities:protect_program_assignment_parent_lineage:O:19',
        'facilities_assignment_topology_lock_trigger:facilities:lock_program_assignment_topology:O:18',
        'facilities_merge_acyclic_trigger:facilities:assert_facility_merge_acyclic:O:23',
        'jurisdictions_acyclic_trigger:jurisdictions:assert_jurisdiction_acyclic:O:23',
        'program_facility_assignments_coherent_trigger:program_facility_assignments:assert_program_assignment_coherent:O:23',
        'program_facility_assignments_topology_lock_trigger:program_facility_assignments:lock_program_assignment_topology:O:22',
        'reviewed_timezones_validate_trigger:reviewed_timezones:assert_reviewed_timezone_exists:O:23',
        'store_programs_assignment_lineage_trigger:store_programs:protect_store_program_assignment_lineage:O:19',
        'store_programs_assignment_topology_lock_trigger:store_programs:lock_program_assignment_topology:O:18'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_program_rollback_trigger_drift';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM (
            SELECT acl.grantee
            FROM pg_namespace AS namespace,
                 LATERAL aclexplode(COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))) AS acl
            WHERE namespace.nspname = 'storecalc'

            UNION ALL

            SELECT acl.grantee
            FROM pg_class AS relation,
                 LATERAL aclexplode(
                     COALESCE(
                         relation.relacl,
                         acldefault(
                             CASE WHEN relation.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END,
                             relation.relowner
                         )
                     )
                 ) AS acl
            WHERE relation.relnamespace = 'storecalc'::regnamespace

            UNION ALL

            SELECT acl.grantee
            FROM pg_proc AS procedure,
                 LATERAL aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) AS acl
            WHERE procedure.pronamespace = 'storecalc'::regnamespace
        ) AS object_grants
        WHERE object_grants.grantee <> ALL (allowed_grantee_oids)
    ) THEN
        RAISE EXCEPTION 'storecalc_program_rollback_unexpected_grantee';
    END IF;

    FOREACH object_name IN ARRAY new_tables LOOP
        IF has_table_privilege(web_role, object_name, 'SELECT')
           OR has_table_privilege(web_role, object_name, 'INSERT')
           OR has_table_privilege(web_role, object_name, 'UPDATE')
           OR has_table_privilege(web_role, object_name, 'DELETE')
           OR has_table_privilege(worker_role, object_name, 'SELECT')
           OR has_table_privilege(worker_role, object_name, 'INSERT')
           OR has_table_privilege(worker_role, object_name, 'UPDATE')
           OR has_table_privilege(worker_role, object_name, 'DELETE')
           OR NOT has_table_privilege(backup_role, object_name, 'SELECT')
           OR has_table_privilege(backup_role, object_name, 'INSERT')
           OR has_table_privilege(backup_role, object_name, 'UPDATE')
           OR has_table_privilege(backup_role, object_name, 'DELETE') THEN
            RAISE EXCEPTION 'storecalc_program_rollback_table_grant_mismatch';
        END IF;
    END LOOP;

    FOREACH object_name IN ARRAY new_sequences LOOP
        IF has_sequence_privilege(web_role, object_name, 'SELECT')
           OR has_sequence_privilege(web_role, object_name, 'USAGE')
           OR has_sequence_privilege(worker_role, object_name, 'SELECT')
           OR has_sequence_privilege(worker_role, object_name, 'USAGE')
           OR NOT has_sequence_privilege(backup_role, object_name, 'SELECT')
           OR has_sequence_privilege(backup_role, object_name, 'USAGE')
           OR has_sequence_privilege(backup_role, object_name, 'UPDATE') THEN
            RAISE EXCEPTION 'storecalc_program_rollback_sequence_grant_mismatch';
        END IF;
    END LOOP;

    IF has_function_privilege(web_role, 'storecalc.lock_program_assignment_topology()', 'EXECUTE')
       OR has_function_privilege(worker_role, 'storecalc.lock_program_assignment_topology()', 'EXECUTE')
       OR has_function_privilege(backup_role, 'storecalc.lock_program_assignment_topology()', 'EXECUTE')
       OR has_function_privilege(web_role, 'storecalc.assert_program_assignment_coherent()', 'EXECUTE')
       OR has_function_privilege(worker_role, 'storecalc.assert_program_assignment_coherent()', 'EXECUTE')
       OR has_function_privilege(backup_role, 'storecalc.assert_program_assignment_coherent()', 'EXECUTE')
       OR has_function_privilege(web_role, 'storecalc.protect_store_program_assignment_lineage()', 'EXECUTE')
       OR has_function_privilege(worker_role, 'storecalc.protect_store_program_assignment_lineage()', 'EXECUTE')
       OR has_function_privilege(backup_role, 'storecalc.protect_store_program_assignment_lineage()', 'EXECUTE')
       OR has_function_privilege(web_role, 'storecalc.protect_program_assignment_parent_lineage()', 'EXECUTE')
       OR has_function_privilege(worker_role, 'storecalc.protect_program_assignment_parent_lineage()', 'EXECUTE')
       OR has_function_privilege(backup_role, 'storecalc.protect_program_assignment_parent_lineage()', 'EXECUTE') THEN
        RAISE EXCEPTION 'storecalc_program_rollback_function_grant_mismatch';
    END IF;

    SELECT array_agg(
        format('%s:%s:%s:%s:%s', id, capability_key, schema_version, is_available, migration_key)
        ORDER BY id
    )
    INTO actual_capabilities
    FROM storecalc.schema_capabilities;

    IF actual_capabilities IS DISTINCT FROM ARRAY[
        '1:schema.foundation:1:t:0001_schema_foundation',
        '2:public.directory:2:f:0003_program_assignments',
        '3:anonymous.calculation:0:f:0001_schema_foundation',
        '4:saved.orders:0:f:0001_schema_foundation',
        '5:public.contribution:0:f:0001_schema_foundation',
        '6:evidence.upload:0:f:0001_schema_foundation',
        '7:owner.support:0:f:0001_schema_foundation',
        '8:scoped.profiles:0:f:0001_schema_foundation'
    ]::text[]
       OR EXISTS (
           SELECT 1
           FROM storecalc.schema_capabilities
           WHERE (capability_key = 'schema.foundation' AND verified_at IS NULL)
              OR (capability_key <> 'schema.foundation' AND verified_at IS NOT NULL)
       ) THEN
        RAISE EXCEPTION 'storecalc_program_rollback_capability_state_changed';
    END IF;

    IF EXISTS (SELECT 1 FROM storecalc.program_facility_assignments)
       OR EXISTS (SELECT 1 FROM storecalc.store_programs) THEN
        RAISE EXCEPTION 'storecalc_program_rollback_not_empty';
    END IF;

    FOREACH object_name IN ARRAY new_sequences LOOP
        EXECUTE format('SELECT last_value, is_called FROM %s', object_name)
        INTO sequence_last_value, sequence_is_called;

        IF sequence_last_value <> 1 OR sequence_is_called THEN
            RAISE EXCEPTION 'storecalc_program_rollback_sequence_used';
        END IF;
    END LOOP;
END
$storecalc_program_rollback_preflight$;

DROP TRIGGER agencies_assignment_lineage_trigger ON storecalc.agencies;
DROP TRIGGER agencies_assignment_topology_lock_trigger ON storecalc.agencies;
DROP TRIGGER facilities_assignment_lineage_trigger ON storecalc.facilities;
DROP TRIGGER facilities_assignment_topology_lock_trigger ON storecalc.facilities;
DROP TRIGGER store_programs_assignment_lineage_trigger ON storecalc.store_programs;
DROP TRIGGER store_programs_assignment_topology_lock_trigger ON storecalc.store_programs;
DROP TRIGGER program_facility_assignments_coherent_trigger ON storecalc.program_facility_assignments;
DROP TRIGGER program_facility_assignments_topology_lock_trigger ON storecalc.program_facility_assignments;

DROP TABLE storecalc.program_facility_assignments;
DROP TABLE storecalc.store_programs;

DROP FUNCTION storecalc.protect_program_assignment_parent_lineage();
DROP FUNCTION storecalc.protect_store_program_assignment_lineage();
DROP FUNCTION storecalc.assert_program_assignment_coherent();
DROP FUNCTION storecalc.lock_program_assignment_topology();

UPDATE storecalc.schema_capabilities
SET schema_version = 1,
    migration_key = '0002_directory_lineage',
    updated_at = transaction_timestamp()
WHERE capability_key = 'public.directory'
  AND schema_version = 2
  AND NOT is_available
  AND verified_at IS NULL
  AND migration_key = '0003_program_assignments';

DO $storecalc_program_rollback_postflight$
DECLARE
    actual_relations text[];
    actual_triggers text[];
BEGIN
    IF to_regclass('storecalc.store_programs') IS NOT NULL
       OR to_regclass('storecalc.program_facility_assignments') IS NOT NULL
       OR to_regprocedure('storecalc.lock_program_assignment_topology()') IS NOT NULL
       OR to_regprocedure('storecalc.assert_program_assignment_coherent()') IS NOT NULL
       OR to_regprocedure('storecalc.protect_store_program_assignment_lineage()') IS NOT NULL
       OR to_regprocedure('storecalc.protect_program_assignment_parent_lineage()') IS NOT NULL THEN
        RAISE EXCEPTION 'storecalc_program_rollback_target_remains';
    END IF;

    SELECT array_agg(format('%s:%s', relname, relkind) ORDER BY relname)
    INTO actual_relations
    FROM pg_class
    WHERE relnamespace = 'storecalc'::regnamespace;

    IF md5(array_to_string(actual_relations, E'\n')) <> 'fca2a2dbb8efbcd63d9747e1b62dead4'
       OR cardinality(actual_relations) <> 48 THEN
        RAISE EXCEPTION 'storecalc_program_rollback_baseline_not_restored';
    END IF;

    SELECT array_agg(
        format('%s:%s:%s:%s:%s', trigger_row.tgname, relation.relname, procedure.proname, trigger_row.tgenabled, trigger_row.tgtype)
        ORDER BY trigger_row.tgname
    )
    INTO actual_triggers
    FROM pg_trigger AS trigger_row
    JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid
    JOIN pg_proc AS procedure ON procedure.oid = trigger_row.tgfoid
    WHERE relation.relnamespace = 'storecalc'::regnamespace
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgqual IS NULL;

    IF actual_triggers IS DISTINCT FROM ARRAY[
        'facilities_merge_acyclic_trigger:facilities:assert_facility_merge_acyclic:O:23',
        'jurisdictions_acyclic_trigger:jurisdictions:assert_jurisdiction_acyclic:O:23',
        'reviewed_timezones_validate_trigger:reviewed_timezones:assert_reviewed_timezone_exists:O:23'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_program_rollback_baseline_trigger_not_restored';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM storecalc.schema_capabilities
        WHERE capability_key = 'public.directory'
          AND schema_version = 1
          AND NOT is_available
          AND verified_at IS NULL
          AND migration_key = '0002_directory_lineage'
    ) THEN
        RAISE EXCEPTION 'storecalc_program_rollback_capability_not_restored';
    END IF;
END
$storecalc_program_rollback_postflight$;

COMMIT;
