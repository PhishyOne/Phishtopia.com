BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

SELECT pg_advisory_xact_lock(7356507374803211041);

DO $storecalc_program_verify$
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
    expected_columns constant text[] := ARRAY[
        'program_facility_assignments:id:integer:NO:BY DEFAULT:',
        'program_facility_assignments:program_id:integer:NO::',
        'program_facility_assignments:facility_id:integer:NO::',
        'program_facility_assignments:audience_key:text:NO::',
        'program_facility_assignments:valid_from:date:YES::',
        'program_facility_assignments:valid_through:date:YES::',
        'program_facility_assignments:assignment_state:text:NO::',
        'program_facility_assignments:source_evidence_id:integer:YES::',
        'program_facility_assignments:recorded_at:timestamp with time zone:NO::transaction_timestamp()',
        'program_facility_assignments:retired_at:timestamp with time zone:YES::',
        'program_facility_assignments:lifecycle_generation:integer:NO::1',
        'store_programs:id:integer:NO:BY DEFAULT:',
        'store_programs:owning_agency_id:integer:YES::',
        'store_programs:record_scope:text:NO::',
        'store_programs:owner_user_id:integer:YES::',
        'store_programs:name:text:NO::',
        'store_programs:description:text:YES::',
        'store_programs:program_type:text:YES::',
        'store_programs:status:text:NO::',
        'store_programs:created_by_subject_id:integer:YES::',
        'store_programs:created_at:timestamp with time zone:NO::transaction_timestamp()',
        'store_programs:updated_at:timestamp with time zone:NO::transaction_timestamp()',
        'store_programs:lifecycle_generation:integer:NO::1'
    ];
    expected_constraints constant text[] := ARRAY[
        'program_facility_assignments:program_facility_assignments_audience_key_check:c',
        'program_facility_assignments:program_facility_assignments_effective_dates_check:c',
        'program_facility_assignments:program_facility_assignments_evidence_deferred_check:c',
        'program_facility_assignments:program_facility_assignments_facility_id_fkey:f',
        'program_facility_assignments:program_facility_assignments_generation_check:c',
        'program_facility_assignments:program_facility_assignments_id_lineage_key:u',
        'program_facility_assignments:program_facility_assignments_pkey:p',
        'program_facility_assignments:program_facility_assignments_program_id_fkey:f',
        'program_facility_assignments:program_facility_assignments_retired_order_check:c',
        'program_facility_assignments:program_facility_assignments_retired_state_check:c',
        'program_facility_assignments:program_facility_assignments_state_check:c',
        'store_programs:store_programs_created_by_subject_id_fkey:f',
        'store_programs:store_programs_description_check:c',
        'store_programs:store_programs_generation_check:c',
        'store_programs:store_programs_name_check:c',
        'store_programs:store_programs_owner_user_id_fkey:f',
        'store_programs:store_programs_owning_agency_id_fkey:f',
        'store_programs:store_programs_pkey:p',
        'store_programs:store_programs_scope_check:c',
        'store_programs:store_programs_scope_owner_check:c',
        'store_programs:store_programs_status_check:c',
        'store_programs:store_programs_timestamp_order_check:c',
        'store_programs:store_programs_type_format_check:c'
    ];
    expected_indexes constant text[] := ARRAY[
        'program_facility_assignments_id_lineage_key:CREATE UNIQUE INDEX program_facility_assignments_id_lineage_key ON storecalc.program_facility_assignments USING btree (id, program_id, facility_id)',
        'program_facility_assignments_pkey:CREATE UNIQUE INDEX program_facility_assignments_pkey ON storecalc.program_facility_assignments USING btree (id)',
        'program_facility_assignments_program_idx:CREATE INDEX program_facility_assignments_program_idx ON storecalc.program_facility_assignments USING btree (program_id, facility_id, audience_key)',
        'program_facility_assignments_resolution_idx:CREATE INDEX program_facility_assignments_resolution_idx ON storecalc.program_facility_assignments USING btree (facility_id, audience_key, assignment_state, valid_from, valid_through, program_id)',
        'store_programs_agency_name_idx:CREATE INDEX store_programs_agency_name_idx ON storecalc.store_programs USING btree (owning_agency_id, name)',
        'store_programs_created_by_subject_idx:CREATE INDEX store_programs_created_by_subject_idx ON storecalc.store_programs USING btree (created_by_subject_id) WHERE (created_by_subject_id IS NOT NULL)',
        'store_programs_owner_idx:CREATE INDEX store_programs_owner_idx ON storecalc.store_programs USING btree (owner_user_id) WHERE (owner_user_id IS NOT NULL)',
        'store_programs_pkey:CREATE UNIQUE INDEX store_programs_pkey ON storecalc.store_programs USING btree (id)',
        'store_programs_status_name_idx:CREATE INDEX store_programs_status_name_idx ON storecalc.store_programs USING btree (status, name, id)'
    ];
    expected_foreign_keys constant text[] := ARRAY[
        'program_facility_assignments_facility_id_fkey:storecalc.program_facility_assignments:{facility_id}:storecalc.facilities:{id}:r',
        'program_facility_assignments_program_id_fkey:storecalc.program_facility_assignments:{program_id}:storecalc.store_programs:{id}:r',
        'store_programs_created_by_subject_id_fkey:storecalc.store_programs:{created_by_subject_id}:storecalc.contributor_subjects:{id}:r',
        'store_programs_owner_user_id_fkey:storecalc.store_programs:{owner_user_id}:public.users:{id}:r',
        'store_programs_owning_agency_id_fkey:storecalc.store_programs:{owning_agency_id}:storecalc.agencies:{id}:r'
    ];
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
        RAISE EXCEPTION 'storecalc_program_verify_role_config_invalid'
            USING ERRCODE = '22023';
    END IF;

    IF migration_owner_role <> current_user THEN
        RAISE EXCEPTION 'storecalc_program_verify_owner_mismatch'
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
        RAISE EXCEPTION 'storecalc_program_verify_role_mismatch'
            USING ERRCODE = '42501';
    END IF;

    IF NOT has_database_privilege(migration_owner_role, current_database(), 'CREATE')
       OR has_database_privilege(web_role, current_database(), 'CREATE')
       OR has_database_privilege(worker_role, current_database(), 'CREATE')
       OR has_database_privilege(backup_role, current_database(), 'CREATE') THEN
        RAISE EXCEPTION 'storecalc_program_verify_database_grant_mismatch'
            USING ERRCODE = '42501';
    END IF;

    FOREACH source_role IN ARRAY configured_roles LOOP
        FOREACH target_role IN ARRAY configured_roles LOOP
            IF source_role <> target_role
               AND pg_has_role(source_role, target_role, 'MEMBER') THEN
                RAISE EXCEPTION 'storecalc_program_verify_role_inheritance_mismatch'
                    USING ERRCODE = '42501';
            END IF;
        END LOOP;
    END LOOP;

    IF to_regnamespace('storecalc') IS NULL
       OR to_regclass('public.users') IS NULL
       OR pg_get_userbyid(
           (SELECT nspowner FROM pg_namespace WHERE nspname = 'storecalc')
       ) IS DISTINCT FROM migration_owner_role THEN
        RAISE EXCEPTION 'storecalc_program_verify_baseline_mismatch';
    END IF;

    IF NOT EXISTS (
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
        RAISE EXCEPTION 'storecalc_program_verify_users_identity_mismatch';
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
        RAISE EXCEPTION 'storecalc_program_verify_baseline_relation_mismatch';
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
        RAISE EXCEPTION 'storecalc_program_verify_baseline_column_mismatch';
    END IF;

    SELECT array_agg(
        format('%s:%s:%s', relation.relname, constraint_row.conname, constraint_row.contype)
        ORDER BY relation.relname, constraint_row.conname
    )
    INTO actual_baseline_constraints
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS relation
      ON relation.oid = constraint_row.conrelid
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
        RAISE EXCEPTION 'storecalc_program_verify_baseline_constraint_mismatch';
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
        RAISE EXCEPTION 'storecalc_program_verify_baseline_index_mismatch';
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
    JOIN pg_class AS source_relation
      ON source_relation.oid = constraint_row.conrelid
    JOIN pg_namespace AS source_namespace
      ON source_namespace.oid = source_relation.relnamespace
    JOIN pg_class AS target_relation
      ON target_relation.oid = constraint_row.confrelid
    JOIN pg_namespace AS target_namespace
      ON target_namespace.oid = target_relation.relnamespace
    WHERE constraint_row.contype = 'f'
      AND source_relation.relnamespace = 'storecalc'::regnamespace
      AND source_relation.relname <> ALL (ARRAY['store_programs', 'program_facility_assignments']);

    IF md5(array_to_string(actual_baseline_foreign_keys, E'\n')) <> '040b11e9754c2117a62e0c56af9e18bb'
       OR cardinality(actual_baseline_foreign_keys) <> 14 THEN
        RAISE EXCEPTION 'storecalc_program_verify_baseline_foreign_key_mismatch';
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
        RAISE EXCEPTION 'storecalc_program_verify_relation_definition_mismatch';
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
        RAISE EXCEPTION 'storecalc_program_verify_object_owner_mismatch';
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
      AND column_row.table_name = ANY (
          ARRAY['store_programs', 'program_facility_assignments']
      );

    IF actual_columns IS DISTINCT FROM expected_columns THEN
        RAISE EXCEPTION 'storecalc_program_verify_column_definition_mismatch';
    END IF;

    SELECT array_agg(
        format('%s:%s:%s', relation.relname, constraint_row.conname, constraint_row.contype)
        ORDER BY relation.relname, constraint_row.conname
    )
    INTO actual_constraints
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS relation
      ON relation.oid = constraint_row.conrelid
    WHERE relation.relnamespace = 'storecalc'::regnamespace
      AND relation.relname = ANY (ARRAY['store_programs', 'program_facility_assignments']);

    IF actual_constraints IS DISTINCT FROM expected_constraints
       OR EXISTS (
           SELECT 1
           FROM pg_constraint AS constraint_row
           JOIN pg_class AS relation
             ON relation.oid = constraint_row.conrelid
           WHERE relation.relnamespace = 'storecalc'::regnamespace
             AND relation.relname = ANY (ARRAY['store_programs', 'program_facility_assignments'])
             AND (
                 NOT constraint_row.convalidated
                 OR constraint_row.condeferrable
                 OR constraint_row.condeferred
             )
       ) THEN
        RAISE EXCEPTION 'storecalc_program_verify_constraint_definition_mismatch';
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
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.program_facility_assignments'::regclass
          AND conname = 'program_facility_assignments_generation_check'
          AND pg_get_constraintdef(oid) = 'CHECK ((lifecycle_generation >= 1))'
    ) THEN
        RAISE EXCEPTION 'storecalc_program_verify_check_definition_mismatch';
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

    IF actual_indexes IS DISTINCT FROM expected_indexes THEN
        RAISE EXCEPTION 'storecalc_program_verify_index_definition_mismatch';
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
    JOIN pg_class AS source_relation
      ON source_relation.oid = constraint_row.conrelid
    JOIN pg_namespace AS source_namespace
      ON source_namespace.oid = source_relation.relnamespace
    JOIN pg_class AS target_relation
      ON target_relation.oid = constraint_row.confrelid
    JOIN pg_namespace AS target_namespace
      ON target_namespace.oid = target_relation.relnamespace
    WHERE constraint_row.contype = 'f'
      AND source_relation.relnamespace = 'storecalc'::regnamespace
      AND source_relation.relname = ANY (ARRAY['store_programs', 'program_facility_assignments']);

    IF actual_foreign_keys IS DISTINCT FROM expected_foreign_keys THEN
        RAISE EXCEPTION 'storecalc_program_verify_foreign_key_definition_mismatch';
    END IF;

    FOREACH object_name IN ARRAY ARRAY[
        'storecalc.store_programs',
        'storecalc.program_facility_assignments'
    ] LOOP
        IF pg_get_serial_sequence(object_name, 'id') IS DISTINCT FROM object_name || '_id_seq'
           OR NOT EXISTS (
               SELECT 1
               FROM pg_sequence
               WHERE seqrelid = (object_name || '_id_seq')::regclass
                 AND seqstart = 1
                 AND seqincrement = 1
                 AND seqmax = 2147483647
                 AND seqmin = 1
                 AND seqcache = 1
                 AND NOT seqcycle
           ) THEN
            RAISE EXCEPTION 'storecalc_program_verify_sequence_definition_mismatch';
        END IF;
    END LOOP;

    IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'storecalc'::regnamespace) <> 7
       OR NOT EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE oid = 'storecalc.assert_reviewed_timezone_exists()'::regprocedure
          AND prosecdef
          AND proconfig = ARRAY['search_path=pg_catalog, storecalc']
          AND md5(prosrc) = '413d3098a67b7cfabe0cd4aed1917988'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE oid = 'storecalc.assert_jurisdiction_acyclic()'::regprocedure
          AND prosecdef
          AND proconfig = ARRAY['search_path=pg_catalog, storecalc']
          AND md5(prosrc) = 'c7c391a378c393c1a65c7cfc2f543c5b'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE oid = 'storecalc.assert_facility_merge_acyclic()'::regprocedure
          AND prosecdef
          AND proconfig = ARRAY['search_path=pg_catalog, storecalc']
          AND md5(prosrc) = 'cdd50d9c47881788dbfbb8b36f589957'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_proc AS procedure
        JOIN pg_language AS language ON language.oid = procedure.prolang
        WHERE procedure.oid = 'storecalc.lock_program_assignment_topology()'::regprocedure
          AND language.lanname = 'plpgsql'
          AND procedure.prorettype = 'trigger'::regtype
          AND procedure.pronargs = 0
          AND procedure.prosecdef
          AND procedure.provolatile = 'v'
          AND procedure.proconfig = ARRAY['search_path=pg_catalog, storecalc']
          AND md5(procedure.prosrc) = '9569aecc34463c8c9246f2b54735c0fe'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_proc AS procedure
        JOIN pg_language AS language ON language.oid = procedure.prolang
        WHERE procedure.oid = 'storecalc.assert_program_assignment_coherent()'::regprocedure
          AND language.lanname = 'plpgsql'
          AND procedure.prorettype = 'trigger'::regtype
          AND procedure.pronargs = 0
          AND procedure.prosecdef
          AND procedure.provolatile = 'v'
          AND procedure.proconfig = ARRAY['search_path=pg_catalog, storecalc']
          AND md5(procedure.prosrc) = '36aede37eb9412cba9649983a79e87b2'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_proc AS procedure
        JOIN pg_language AS language ON language.oid = procedure.prolang
        WHERE procedure.oid = 'storecalc.protect_store_program_assignment_lineage()'::regprocedure
          AND language.lanname = 'plpgsql'
          AND procedure.prorettype = 'trigger'::regtype
          AND procedure.pronargs = 0
          AND procedure.prosecdef
          AND procedure.provolatile = 'v'
          AND procedure.proconfig = ARRAY['search_path=pg_catalog, storecalc']
          AND md5(procedure.prosrc) = '0bf202d4159ba9df6aa8c16076b2d306'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_proc AS procedure
        JOIN pg_language AS language ON language.oid = procedure.prolang
        WHERE procedure.oid = 'storecalc.protect_program_assignment_parent_lineage()'::regprocedure
          AND language.lanname = 'plpgsql'
          AND procedure.prorettype = 'trigger'::regtype
          AND procedure.pronargs = 0
          AND procedure.prosecdef
          AND procedure.provolatile = 'v'
          AND procedure.proconfig = ARRAY['search_path=pg_catalog, storecalc']
          AND md5(procedure.prosrc) = 'bac771f0f93698d804caa354c5aeb4e7'
    ) THEN
        RAISE EXCEPTION 'storecalc_program_verify_function_definition_mismatch';
    END IF;

    SELECT array_agg(
        format('%s:%s:%s:%s:%s', trigger_row.tgname, relation.relname, procedure.proname, trigger_row.tgenabled, trigger_row.tgtype)
        ORDER BY trigger_row.tgname
    )
    INTO actual_triggers
    FROM pg_trigger AS trigger_row
    JOIN pg_class AS relation
      ON relation.oid = trigger_row.tgrelid
    JOIN pg_proc AS procedure
      ON procedure.oid = trigger_row.tgfoid
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
    ]::text[]
       OR EXISTS (
           SELECT 1
           FROM pg_policy
           WHERE polrelid = ANY (new_tables::regclass[])
       ) OR EXISTS (
           SELECT 1
           FROM pg_class
           WHERE oid = ANY (new_tables::regclass[])
             AND (relpersistence <> 'p' OR relrowsecurity OR relforcerowsecurity)
       ) THEN
        RAISE EXCEPTION 'storecalc_program_verify_table_security_mismatch';
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
        RAISE EXCEPTION 'storecalc_program_verify_unexpected_grantee';
    END IF;

    IF NOT has_schema_privilege(web_role, 'storecalc', 'USAGE')
       OR has_schema_privilege(web_role, 'storecalc', 'CREATE')
       OR NOT has_schema_privilege(worker_role, 'storecalc', 'USAGE')
       OR has_schema_privilege(worker_role, 'storecalc', 'CREATE')
       OR NOT has_schema_privilege(backup_role, 'storecalc', 'USAGE')
       OR has_schema_privilege(backup_role, 'storecalc', 'CREATE') THEN
        RAISE EXCEPTION 'storecalc_program_verify_schema_grant_mismatch';
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
            RAISE EXCEPTION 'storecalc_program_verify_table_grant_mismatch';
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
            RAISE EXCEPTION 'storecalc_program_verify_sequence_grant_mismatch';
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
        RAISE EXCEPTION 'storecalc_program_verify_function_grant_mismatch';
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
       )
       OR NOT EXISTS (
           SELECT 1
           FROM storecalc.schema_capabilities AS directory
           JOIN storecalc.schema_capabilities AS foundation
             ON foundation.capability_key = 'schema.foundation'
           WHERE directory.capability_key = 'public.directory'
             AND directory.updated_at >= foundation.verified_at
       ) THEN
        RAISE EXCEPTION 'storecalc_program_verify_capability_state_mismatch';
    END IF;
END
$storecalc_program_verify$;

CREATE TABLE storecalc.templates (
    id integer GENERATED BY DEFAULT AS IDENTITY,
    program_id integer NOT NULL,
    visibility text NOT NULL,
    owner_user_id integer,
    name text NOT NULL,
    status text NOT NULL,
    created_by_subject_id integer,
    created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    archived_at timestamptz,
    CONSTRAINT templates_pkey
        PRIMARY KEY (id),
    CONSTRAINT templates_id_program_key
        UNIQUE (id, program_id),
    CONSTRAINT templates_program_id_fkey
        FOREIGN KEY (program_id)
        REFERENCES storecalc.store_programs(id)
        ON DELETE RESTRICT,
    CONSTRAINT templates_owner_user_id_fkey
        FOREIGN KEY (owner_user_id)
        REFERENCES public.users(id)
        ON DELETE RESTRICT,
    CONSTRAINT templates_created_by_subject_id_fkey
        FOREIGN KEY (created_by_subject_id)
        REFERENCES storecalc.contributor_subjects(id)
        ON DELETE RESTRICT,
    CONSTRAINT templates_visibility_check
        CHECK (visibility IN ('public', 'private')),
    CONSTRAINT templates_visibility_owner_check
        CHECK (
            (visibility = 'public' AND owner_user_id IS NULL)
            OR (visibility = 'private' AND owner_user_id IS NOT NULL)
        ),
    CONSTRAINT templates_name_check
        CHECK (
            char_length(name) BETWEEN 1 AND 200
            AND octet_length(name) <= 800
            AND name = btrim(name)
            AND name !~ '[[:cntrl:]]'
        ),
    CONSTRAINT templates_status_check
        CHECK (status IN ('draft', 'active', 'inactive', 'withdrawn', 'archived')),
    CONSTRAINT templates_archived_state_check
        CHECK ((status = 'archived') = (archived_at IS NOT NULL)),
    CONSTRAINT templates_timestamp_order_check
        CHECK (
            updated_at >= created_at
            AND (archived_at IS NULL OR archived_at >= created_at)
        )
);

CREATE INDEX templates_program_name_idx
    ON storecalc.templates (program_id, status, name, id);

CREATE INDEX templates_owner_idx
    ON storecalc.templates (owner_user_id)
    WHERE owner_user_id IS NOT NULL;

CREATE INDEX templates_created_by_subject_idx
    ON storecalc.templates (created_by_subject_id)
    WHERE created_by_subject_id IS NOT NULL;

CREATE INDEX templates_visibility_status_idx
    ON storecalc.templates (visibility, status, name, id);

CREATE TABLE storecalc.template_categories (
    id integer GENERATED BY DEFAULT AS IDENTITY,
    template_id integer NOT NULL,
    stable_key text NOT NULL,
    created_by_subject_id integer,
    created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    retired_at timestamptz,
    CONSTRAINT template_categories_pkey
        PRIMARY KEY (id),
    CONSTRAINT template_categories_id_template_key
        UNIQUE (id, template_id),
    CONSTRAINT template_categories_template_stable_key_key
        UNIQUE (template_id, stable_key),
    CONSTRAINT template_categories_template_id_fkey
        FOREIGN KEY (template_id)
        REFERENCES storecalc.templates(id)
        ON DELETE RESTRICT,
    CONSTRAINT template_categories_created_by_subject_id_fkey
        FOREIGN KEY (created_by_subject_id)
        REFERENCES storecalc.contributor_subjects(id)
        ON DELETE RESTRICT,
    CONSTRAINT template_categories_stable_key_check
        CHECK (
            char_length(stable_key) BETWEEN 1 AND 64
            AND octet_length(stable_key) <= 64
            AND stable_key ~ '^[a-z][a-z0-9_]*$'
        ),
    CONSTRAINT template_categories_retired_order_check
        CHECK (retired_at IS NULL OR retired_at >= created_at)
);

CREATE INDEX template_categories_created_by_subject_idx
    ON storecalc.template_categories (created_by_subject_id)
    WHERE created_by_subject_id IS NOT NULL;

CREATE INDEX template_categories_active_idx
    ON storecalc.template_categories (template_id, stable_key, id)
    WHERE retired_at IS NULL;

CREATE TABLE storecalc.template_items (
    id integer GENERATED BY DEFAULT AS IDENTITY,
    template_id integer NOT NULL,
    stable_key text NOT NULL,
    created_by_subject_id integer,
    created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    retired_at timestamptz,
    CONSTRAINT template_items_pkey
        PRIMARY KEY (id),
    CONSTRAINT template_items_id_template_key
        UNIQUE (id, template_id),
    CONSTRAINT template_items_template_stable_key_key
        UNIQUE (template_id, stable_key),
    CONSTRAINT template_items_template_id_fkey
        FOREIGN KEY (template_id)
        REFERENCES storecalc.templates(id)
        ON DELETE RESTRICT,
    CONSTRAINT template_items_created_by_subject_id_fkey
        FOREIGN KEY (created_by_subject_id)
        REFERENCES storecalc.contributor_subjects(id)
        ON DELETE RESTRICT,
    CONSTRAINT template_items_stable_key_check
        CHECK (
            char_length(stable_key) BETWEEN 1 AND 64
            AND octet_length(stable_key) <= 64
            AND stable_key ~ '^[a-z][a-z0-9_]*$'
        ),
    CONSTRAINT template_items_retired_order_check
        CHECK (retired_at IS NULL OR retired_at >= created_at)
);

CREATE INDEX template_items_created_by_subject_idx
    ON storecalc.template_items (created_by_subject_id)
    WHERE created_by_subject_id IS NOT NULL;

CREATE INDEX template_items_active_idx
    ON storecalc.template_items (template_id, stable_key, id)
    WHERE retired_at IS NULL;

CREATE FUNCTION storecalc.lock_template_identity_topology()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storecalc
AS $storecalc_template_topology_lock_function$
BEGIN
    LOCK TABLE storecalc.templates IN SHARE ROW EXCLUSIVE MODE;
    RETURN NULL;
END
$storecalc_template_topology_lock_function$;

CREATE FUNCTION storecalc.assert_template_coherent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storecalc
AS $storecalc_template_coherence_function$
DECLARE
    program_scope text;
    program_owner_id integer;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.id IS DISTINCT FROM OLD.id
           OR NEW.program_id IS DISTINCT FROM OLD.program_id
           OR NEW.visibility IS DISTINCT FROM OLD.visibility
           OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
           OR NEW.created_by_subject_id IS DISTINCT FROM OLD.created_by_subject_id
           OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'storecalc_template_identity_immutable'
                USING ERRCODE = '55000';
        END IF;

        IF OLD.archived_at IS NOT NULL
           AND NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
            RAISE EXCEPTION 'storecalc_template_archive_immutable'
                USING ERRCODE = '55000';
        END IF;
    END IF;

    SELECT program.record_scope, program.owner_user_id
    INTO program_scope, program_owner_id
    FROM storecalc.store_programs AS program
    WHERE program.id = NEW.program_id
    FOR KEY SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'storecalc_template_program_missing'
            USING ERRCODE = '23503';
    END IF;

    IF NEW.visibility = 'public' AND program_scope <> 'public' THEN
        RAISE EXCEPTION 'storecalc_public_template_requires_public_program'
            USING ERRCODE = '23514';
    END IF;

    IF program_scope = 'private'
       AND NEW.owner_user_id IS DISTINCT FROM program_owner_id THEN
        RAISE EXCEPTION 'storecalc_template_private_owner_mismatch'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END
$storecalc_template_coherence_function$;

CREATE FUNCTION storecalc.protect_program_template_lineage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storecalc
AS $storecalc_program_template_lineage_function$
BEGIN
    IF NEW.record_scope IS NOT DISTINCT FROM OLD.record_scope
       AND NEW.owner_user_id IS NOT DISTINCT FROM OLD.owner_user_id THEN
        RETURN NEW;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM storecalc.templates
        WHERE program_id = OLD.id
    ) THEN
        RAISE EXCEPTION 'storecalc_templated_program_lineage_immutable'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END
$storecalc_program_template_lineage_function$;

CREATE FUNCTION storecalc.protect_template_stable_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storecalc
AS $storecalc_template_stable_identity_function$
DECLARE
    template_status text;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.id IS DISTINCT FROM OLD.id
           OR NEW.template_id IS DISTINCT FROM OLD.template_id
           OR NEW.stable_key IS DISTINCT FROM OLD.stable_key
           OR NEW.created_by_subject_id IS DISTINCT FROM OLD.created_by_subject_id
           OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'storecalc_stable_identity_immutable'
                USING ERRCODE = '55000';
        END IF;

        IF OLD.retired_at IS NOT NULL
           AND NEW.retired_at IS DISTINCT FROM OLD.retired_at THEN
            RAISE EXCEPTION 'storecalc_stable_identity_retirement_immutable'
                USING ERRCODE = '55000';
        END IF;

        RETURN NEW;
    END IF;

    SELECT template.status
    INTO template_status
    FROM storecalc.templates AS template
    WHERE template.id = NEW.template_id
    FOR KEY SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'storecalc_stable_identity_template_missing'
            USING ERRCODE = '23503';
    END IF;

    IF template_status NOT IN ('draft', 'active') THEN
        RAISE EXCEPTION 'storecalc_stable_identity_template_closed'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END
$storecalc_template_stable_identity_function$;

CREATE TRIGGER templates_topology_lock_trigger
BEFORE INSERT OR UPDATE ON storecalc.templates
FOR EACH STATEMENT
EXECUTE FUNCTION storecalc.lock_template_identity_topology();

CREATE TRIGGER templates_coherence_trigger
BEFORE INSERT OR UPDATE ON storecalc.templates
FOR EACH ROW
EXECUTE FUNCTION storecalc.assert_template_coherent();

CREATE TRIGGER store_programs_template_topology_lock_trigger
BEFORE UPDATE ON storecalc.store_programs
FOR EACH STATEMENT
EXECUTE FUNCTION storecalc.lock_template_identity_topology();

CREATE TRIGGER store_programs_template_lineage_trigger
BEFORE UPDATE ON storecalc.store_programs
FOR EACH ROW
EXECUTE FUNCTION storecalc.protect_program_template_lineage();

CREATE TRIGGER template_categories_topology_lock_trigger
BEFORE INSERT OR UPDATE OR DELETE ON storecalc.template_categories
FOR EACH STATEMENT
EXECUTE FUNCTION storecalc.lock_template_identity_topology();

CREATE TRIGGER template_categories_identity_trigger
BEFORE INSERT OR UPDATE ON storecalc.template_categories
FOR EACH ROW
EXECUTE FUNCTION storecalc.protect_template_stable_identity();

CREATE TRIGGER template_items_topology_lock_trigger
BEFORE INSERT OR UPDATE OR DELETE ON storecalc.template_items
FOR EACH STATEMENT
EXECUTE FUNCTION storecalc.lock_template_identity_topology();

CREATE TRIGGER template_items_identity_trigger
BEFORE INSERT OR UPDATE ON storecalc.template_items
FOR EACH ROW
EXECUTE FUNCTION storecalc.protect_template_stable_identity();

REVOKE ALL ON TABLE
    storecalc.templates,
    storecalc.template_categories,
    storecalc.template_items
FROM PUBLIC;

REVOKE ALL ON SEQUENCE
    storecalc.templates_id_seq,
    storecalc.template_categories_id_seq,
    storecalc.template_items_id_seq
FROM PUBLIC;

REVOKE ALL ON FUNCTION
    storecalc.lock_template_identity_topology(),
    storecalc.assert_template_coherent(),
    storecalc.protect_program_template_lineage(),
    storecalc.protect_template_stable_identity()
FROM PUBLIC;

DO $storecalc_template_grants$
DECLARE
    backup_role text := current_setting('storecalc.backup_role');
BEGIN
    EXECUTE format(
        'GRANT SELECT ON TABLE '
        || 'storecalc.templates, '
        || 'storecalc.template_categories, '
        || 'storecalc.template_items TO %I',
        backup_role
    );

    EXECUTE format(
        'GRANT SELECT ON SEQUENCE '
        || 'storecalc.templates_id_seq, '
        || 'storecalc.template_categories_id_seq, '
        || 'storecalc.template_items_id_seq TO %I',
        backup_role
    );
END
$storecalc_template_grants$;

DO $storecalc_template_capability$
BEGIN
    UPDATE storecalc.schema_capabilities
    SET schema_version = 1,
        migration_key = '0004_template_identity',
        updated_at = transaction_timestamp()
    WHERE capability_key = 'anonymous.calculation'
      AND schema_version = 0
      AND NOT is_available
      AND verified_at IS NULL
      AND migration_key = '0001_schema_foundation';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'storecalc_template_capability_precondition_failed';
    END IF;
END
$storecalc_template_capability$;

DO $storecalc_template_postflight$
DECLARE
    migration_owner_role text := current_setting('storecalc.migration_owner_role');
    web_role text := current_setting('storecalc.web_role');
    worker_role text := current_setting('storecalc.worker_role');
    backup_role text := current_setting('storecalc.backup_role');
    configured_roles text[] := ARRAY[
        current_setting('storecalc.migration_owner_role'),
        current_setting('storecalc.web_role'),
        current_setting('storecalc.worker_role'),
        current_setting('storecalc.backup_role')
    ];
    allowed_grantee_oids oid[];
    object_name text;
    actual_relations text[];
    actual_columns text[];
    actual_constraints text[];
    actual_indexes text[];
    actual_foreign_keys text[];
    actual_triggers text[];
    actual_capabilities text[];
    new_tables constant text[] := ARRAY[
        'storecalc.templates',
        'storecalc.template_categories',
        'storecalc.template_items'
    ];
    new_sequences constant text[] := ARRAY[
        'storecalc.templates_id_seq',
        'storecalc.template_categories_id_seq',
        'storecalc.template_items_id_seq'
    ];
BEGIN
    SELECT array_agg(oid ORDER BY oid)
    INTO allowed_grantee_oids
    FROM pg_roles
    WHERE rolname = ANY (configured_roles);

    SELECT array_agg(format('%s:%s', relname, relkind) ORDER BY relname)
    INTO actual_relations
    FROM pg_class
    WHERE relnamespace = 'storecalc'::regnamespace
      AND relname = ANY (
          ARRAY[
              'templates',
              'templates_id_seq',
              'templates_pkey',
              'templates_id_program_key',
              'templates_program_name_idx',
              'templates_owner_idx',
              'templates_created_by_subject_idx',
              'templates_visibility_status_idx',
              'template_categories',
              'template_categories_id_seq',
              'template_categories_pkey',
              'template_categories_id_template_key',
              'template_categories_template_stable_key_key',
              'template_categories_created_by_subject_idx',
              'template_categories_active_idx',
              'template_items',
              'template_items_id_seq',
              'template_items_pkey',
              'template_items_id_template_key',
              'template_items_template_stable_key_key',
              'template_items_created_by_subject_idx',
              'template_items_active_idx'
          ]
      );

    IF actual_relations IS DISTINCT FROM ARRAY[
        'template_categories:r',
        'template_categories_active_idx:i',
        'template_categories_created_by_subject_idx:i',
        'template_categories_id_seq:S',
        'template_categories_id_template_key:i',
        'template_categories_pkey:i',
        'template_categories_template_stable_key_key:i',
        'template_items:r',
        'template_items_active_idx:i',
        'template_items_created_by_subject_idx:i',
        'template_items_id_seq:S',
        'template_items_id_template_key:i',
        'template_items_pkey:i',
        'template_items_template_stable_key_key:i',
        'templates:r',
        'templates_created_by_subject_idx:i',
        'templates_id_program_key:i',
        'templates_id_seq:S',
        'templates_owner_idx:i',
        'templates_pkey:i',
        'templates_program_name_idx:i',
        'templates_visibility_status_idx:i'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_template_postflight_relation_mismatch';
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
      AND column_row.table_name = ANY (
          ARRAY['templates', 'template_categories', 'template_items']
      );

    IF actual_columns IS DISTINCT FROM ARRAY[
        'template_categories:id:integer:NO:BY DEFAULT:',
        'template_categories:template_id:integer:NO::',
        'template_categories:stable_key:text:NO::',
        'template_categories:created_by_subject_id:integer:YES::',
        'template_categories:created_at:timestamp with time zone:NO::transaction_timestamp()',
        'template_categories:retired_at:timestamp with time zone:YES::',
        'template_items:id:integer:NO:BY DEFAULT:',
        'template_items:template_id:integer:NO::',
        'template_items:stable_key:text:NO::',
        'template_items:created_by_subject_id:integer:YES::',
        'template_items:created_at:timestamp with time zone:NO::transaction_timestamp()',
        'template_items:retired_at:timestamp with time zone:YES::',
        'templates:id:integer:NO:BY DEFAULT:',
        'templates:program_id:integer:NO::',
        'templates:visibility:text:NO::',
        'templates:owner_user_id:integer:YES::',
        'templates:name:text:NO::',
        'templates:status:text:NO::',
        'templates:created_by_subject_id:integer:YES::',
        'templates:created_at:timestamp with time zone:NO::transaction_timestamp()',
        'templates:updated_at:timestamp with time zone:NO::transaction_timestamp()',
        'templates:archived_at:timestamp with time zone:YES::'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_template_postflight_column_mismatch';
    END IF;

    SELECT array_agg(
        format('%s:%s:%s', relation.relname, constraint_row.conname, constraint_row.contype)
        ORDER BY relation.relname, constraint_row.conname
    )
    INTO actual_constraints
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
    WHERE relation.relnamespace = 'storecalc'::regnamespace
      AND relation.relname = ANY (
          ARRAY['templates', 'template_categories', 'template_items']
      );

    IF actual_constraints IS DISTINCT FROM ARRAY[
        'template_categories:template_categories_created_by_subject_id_fkey:f',
        'template_categories:template_categories_id_template_key:u',
        'template_categories:template_categories_pkey:p',
        'template_categories:template_categories_retired_order_check:c',
        'template_categories:template_categories_stable_key_check:c',
        'template_categories:template_categories_template_id_fkey:f',
        'template_categories:template_categories_template_stable_key_key:u',
        'template_items:template_items_created_by_subject_id_fkey:f',
        'template_items:template_items_id_template_key:u',
        'template_items:template_items_pkey:p',
        'template_items:template_items_retired_order_check:c',
        'template_items:template_items_stable_key_check:c',
        'template_items:template_items_template_id_fkey:f',
        'template_items:template_items_template_stable_key_key:u',
        'templates:templates_archived_state_check:c',
        'templates:templates_created_by_subject_id_fkey:f',
        'templates:templates_id_program_key:u',
        'templates:templates_name_check:c',
        'templates:templates_owner_user_id_fkey:f',
        'templates:templates_pkey:p',
        'templates:templates_program_id_fkey:f',
        'templates:templates_status_check:c',
        'templates:templates_timestamp_order_check:c',
        'templates:templates_visibility_check:c',
        'templates:templates_visibility_owner_check:c'
    ]::text[]
       OR EXISTS (
           SELECT 1
           FROM pg_constraint AS constraint_row
           JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
           WHERE relation.relnamespace = 'storecalc'::regnamespace
             AND relation.relname = ANY (
                 ARRAY['templates', 'template_categories', 'template_items']
             )
             AND (
                 NOT constraint_row.convalidated
                 OR constraint_row.condeferrable
                 OR constraint_row.condeferred
             )
       ) THEN
        RAISE EXCEPTION 'storecalc_template_postflight_constraint_mismatch';
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
              'templates_pkey',
              'templates_id_program_key',
              'templates_program_name_idx',
              'templates_owner_idx',
              'templates_created_by_subject_idx',
              'templates_visibility_status_idx',
              'template_categories_pkey',
              'template_categories_id_template_key',
              'template_categories_template_stable_key_key',
              'template_categories_created_by_subject_idx',
              'template_categories_active_idx',
              'template_items_pkey',
              'template_items_id_template_key',
              'template_items_template_stable_key_key',
              'template_items_created_by_subject_idx',
              'template_items_active_idx'
          ]
      );

    IF cardinality(actual_indexes) <> 16 THEN
        RAISE EXCEPTION 'storecalc_template_postflight_index_mismatch';
    END IF;

    SELECT array_agg(constraint_row.conname ORDER BY constraint_row.conname)
    INTO actual_foreign_keys
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
    WHERE constraint_row.contype = 'f'
      AND relation.relnamespace = 'storecalc'::regnamespace
      AND relation.relname = ANY (
          ARRAY['templates', 'template_categories', 'template_items']
      );

    IF actual_foreign_keys IS DISTINCT FROM ARRAY[
        'template_categories_created_by_subject_id_fkey',
        'template_categories_template_id_fkey',
        'template_items_created_by_subject_id_fkey',
        'template_items_template_id_fkey',
        'templates_created_by_subject_id_fkey',
        'templates_owner_user_id_fkey',
        'templates_program_id_fkey'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_template_postflight_foreign_key_mismatch';
    END IF;

    FOREACH object_name IN ARRAY new_tables LOOP
        IF pg_get_userbyid(
            (SELECT relowner FROM pg_class WHERE oid = object_name::regclass)
        ) IS DISTINCT FROM migration_owner_role THEN
            RAISE EXCEPTION 'storecalc_template_postflight_owner_mismatch';
        END IF;
    END LOOP;

    FOREACH object_name IN ARRAY new_sequences LOOP
        IF pg_get_serial_sequence(
            replace(object_name, '_id_seq', ''),
            'id'
        ) IS DISTINCT FROM object_name
           OR NOT EXISTS (
               SELECT 1
               FROM pg_sequence
               WHERE seqrelid = object_name::regclass
                 AND seqstart = 1
                 AND seqincrement = 1
                 AND seqmax = 2147483647
                 AND seqmin = 1
                 AND seqcache = 1
                 AND NOT seqcycle
           ) THEN
            RAISE EXCEPTION 'storecalc_template_postflight_sequence_mismatch';
        END IF;
    END LOOP;

    SELECT array_agg(
        format('%s:%s:%s:%s:%s', trigger_row.tgname, relation.relname, procedure.proname, trigger_row.tgenabled, trigger_row.tgtype)
        ORDER BY trigger_row.tgname
    )
    INTO actual_triggers
    FROM pg_trigger AS trigger_row
    JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid
    JOIN pg_proc AS procedure ON procedure.oid = trigger_row.tgfoid
    WHERE trigger_row.tgname = ANY (
        ARRAY[
            'templates_topology_lock_trigger',
            'templates_coherence_trigger',
            'store_programs_template_topology_lock_trigger',
            'store_programs_template_lineage_trigger',
            'template_categories_topology_lock_trigger',
            'template_categories_identity_trigger',
            'template_items_topology_lock_trigger',
            'template_items_identity_trigger'
        ]
    )
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgqual IS NULL;

    IF actual_triggers IS DISTINCT FROM ARRAY[
        'store_programs_template_lineage_trigger:store_programs:protect_program_template_lineage:O:19',
        'store_programs_template_topology_lock_trigger:store_programs:lock_template_identity_topology:O:18',
        'template_categories_identity_trigger:template_categories:protect_template_stable_identity:O:23',
        'template_categories_topology_lock_trigger:template_categories:lock_template_identity_topology:O:30',
        'template_items_identity_trigger:template_items:protect_template_stable_identity:O:23',
        'template_items_topology_lock_trigger:template_items:lock_template_identity_topology:O:30',
        'templates_coherence_trigger:templates:assert_template_coherent:O:23',
        'templates_topology_lock_trigger:templates:lock_template_identity_topology:O:22'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_template_postflight_trigger_mismatch';
    END IF;

    IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'storecalc'::regnamespace) <> 11 THEN
        RAISE EXCEPTION 'storecalc_template_postflight_function_inventory_mismatch';
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
        RAISE EXCEPTION 'storecalc_template_postflight_unexpected_grantee';
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
            RAISE EXCEPTION 'storecalc_template_postflight_table_grant_mismatch';
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
            RAISE EXCEPTION 'storecalc_template_postflight_sequence_grant_mismatch';
        END IF;
    END LOOP;

    FOREACH object_name IN ARRAY ARRAY[
        'storecalc.lock_template_identity_topology()',
        'storecalc.assert_template_coherent()',
        'storecalc.protect_program_template_lineage()',
        'storecalc.protect_template_stable_identity()'
    ] LOOP
        IF has_function_privilege(web_role, object_name, 'EXECUTE')
           OR has_function_privilege(worker_role, object_name, 'EXECUTE')
           OR has_function_privilege(backup_role, object_name, 'EXECUTE') THEN
            RAISE EXCEPTION 'storecalc_template_postflight_function_grant_mismatch';
        END IF;
    END LOOP;

    SELECT array_agg(
        format('%s:%s:%s:%s:%s', id, capability_key, schema_version, is_available, migration_key)
        ORDER BY id
    )
    INTO actual_capabilities
    FROM storecalc.schema_capabilities;

    IF actual_capabilities IS DISTINCT FROM ARRAY[
        '1:schema.foundation:1:t:0001_schema_foundation',
        '2:public.directory:2:f:0003_program_assignments',
        '3:anonymous.calculation:1:f:0004_template_identity',
        '4:saved.orders:0:f:0001_schema_foundation',
        '5:public.contribution:0:f:0001_schema_foundation',
        '6:evidence.upload:0:f:0001_schema_foundation',
        '7:owner.support:0:f:0001_schema_foundation',
        '8:scoped.profiles:0:f:0001_schema_foundation'
    ]::text[]
       OR EXISTS (
           SELECT 1
           FROM storecalc.schema_capabilities
           WHERE capability_key <> 'schema.foundation'
             AND verified_at IS NOT NULL
       )
       OR EXISTS (SELECT 1 FROM storecalc.templates)
       OR EXISTS (SELECT 1 FROM storecalc.template_categories)
       OR EXISTS (SELECT 1 FROM storecalc.template_items) THEN
        RAISE EXCEPTION 'storecalc_template_postflight_capability_or_seed_mismatch';
    END IF;
END
$storecalc_template_postflight$;

COMMIT;
