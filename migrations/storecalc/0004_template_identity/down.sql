BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

SELECT pg_advisory_xact_lock(7356507374803211041);

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
    source_role text;
    target_role text;
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
    IF array_position(configured_roles, NULL) IS NOT NULL
       OR array_position(configured_roles, '') IS NOT NULL
       OR lower('public') = ANY (
           ARRAY(
               SELECT lower(role_name)
               FROM unnest(configured_roles) AS role_name
           )
       )
       OR (SELECT count(DISTINCT role_name) FROM unnest(configured_roles) AS role_name) <> 4 THEN
        RAISE EXCEPTION 'storecalc_template_verify_role_config_invalid'
            USING ERRCODE = '22023';
    END IF;

    IF migration_owner_role <> current_user THEN
        RAISE EXCEPTION 'storecalc_template_verify_owner_mismatch'
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
        RAISE EXCEPTION 'storecalc_template_verify_role_mismatch'
            USING ERRCODE = '42501';
    END IF;

    IF NOT has_database_privilege(migration_owner_role, current_database(), 'CREATE')
       OR has_database_privilege(web_role, current_database(), 'CREATE')
       OR has_database_privilege(worker_role, current_database(), 'CREATE')
       OR has_database_privilege(backup_role, current_database(), 'CREATE') THEN
        RAISE EXCEPTION 'storecalc_template_verify_database_grant_mismatch'
            USING ERRCODE = '42501';
    END IF;

    FOREACH source_role IN ARRAY configured_roles LOOP
        FOREACH target_role IN ARRAY configured_roles LOOP
            IF source_role <> target_role
               AND pg_has_role(source_role, target_role, 'MEMBER') THEN
                RAISE EXCEPTION 'storecalc_template_verify_role_inheritance_mismatch'
                    USING ERRCODE = '42501';
            END IF;
        END LOOP;
    END LOOP;

    IF to_regnamespace('storecalc') IS NULL
       OR to_regclass('public.users') IS NULL
       OR pg_get_userbyid(
           (SELECT nspowner FROM pg_namespace WHERE nspname = 'storecalc')
       ) IS DISTINCT FROM migration_owner_role THEN
        RAISE EXCEPTION 'storecalc_template_verify_baseline_mismatch';
    END IF;

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
    ]::text[]
       OR (
           SELECT count(*)
           FROM pg_class
           WHERE relnamespace = 'storecalc'::regnamespace
       ) <> 83 THEN
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

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.templates'::regclass
          AND conname = 'templates_visibility_owner_check'
          AND pg_get_constraintdef(oid) = 'CHECK ((((visibility = ''public''::text) AND (owner_user_id IS NULL)) OR ((visibility = ''private''::text) AND (owner_user_id IS NOT NULL))))'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.templates'::regclass
          AND conname = 'templates_archived_state_check'
          AND pg_get_constraintdef(oid) = 'CHECK (((status = ''archived''::text) = (archived_at IS NOT NULL)))'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.template_categories'::regclass
          AND conname = 'template_categories_template_stable_key_key'
          AND pg_get_constraintdef(oid) = 'UNIQUE (template_id, stable_key)'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.template_items'::regclass
          AND conname = 'template_items_template_stable_key_key'
          AND pg_get_constraintdef(oid) = 'UNIQUE (template_id, stable_key)'
    ) THEN
        RAISE EXCEPTION 'storecalc_template_verify_constraint_definition_mismatch';
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

    IF actual_indexes IS DISTINCT FROM ARRAY[
        'template_categories_active_idx:CREATE INDEX template_categories_active_idx ON storecalc.template_categories USING btree (template_id, stable_key, id) WHERE (retired_at IS NULL)',
        'template_categories_created_by_subject_idx:CREATE INDEX template_categories_created_by_subject_idx ON storecalc.template_categories USING btree (created_by_subject_id) WHERE (created_by_subject_id IS NOT NULL)',
        'template_categories_id_template_key:CREATE UNIQUE INDEX template_categories_id_template_key ON storecalc.template_categories USING btree (id, template_id)',
        'template_categories_pkey:CREATE UNIQUE INDEX template_categories_pkey ON storecalc.template_categories USING btree (id)',
        'template_categories_template_stable_key_key:CREATE UNIQUE INDEX template_categories_template_stable_key_key ON storecalc.template_categories USING btree (template_id, stable_key)',
        'template_items_active_idx:CREATE INDEX template_items_active_idx ON storecalc.template_items USING btree (template_id, stable_key, id) WHERE (retired_at IS NULL)',
        'template_items_created_by_subject_idx:CREATE INDEX template_items_created_by_subject_idx ON storecalc.template_items USING btree (created_by_subject_id) WHERE (created_by_subject_id IS NOT NULL)',
        'template_items_id_template_key:CREATE UNIQUE INDEX template_items_id_template_key ON storecalc.template_items USING btree (id, template_id)',
        'template_items_pkey:CREATE UNIQUE INDEX template_items_pkey ON storecalc.template_items USING btree (id)',
        'template_items_template_stable_key_key:CREATE UNIQUE INDEX template_items_template_stable_key_key ON storecalc.template_items USING btree (template_id, stable_key)',
        'templates_created_by_subject_idx:CREATE INDEX templates_created_by_subject_idx ON storecalc.templates USING btree (created_by_subject_id) WHERE (created_by_subject_id IS NOT NULL)',
        'templates_id_program_key:CREATE UNIQUE INDEX templates_id_program_key ON storecalc.templates USING btree (id, program_id)',
        'templates_owner_idx:CREATE INDEX templates_owner_idx ON storecalc.templates USING btree (owner_user_id) WHERE (owner_user_id IS NOT NULL)',
        'templates_pkey:CREATE UNIQUE INDEX templates_pkey ON storecalc.templates USING btree (id)',
        'templates_program_name_idx:CREATE INDEX templates_program_name_idx ON storecalc.templates USING btree (program_id, status, name, id)',
        'templates_visibility_status_idx:CREATE INDEX templates_visibility_status_idx ON storecalc.templates USING btree (visibility, status, name, id)'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_template_postflight_index_mismatch';
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
      AND source_relation.relname = ANY (
          ARRAY['templates', 'template_categories', 'template_items']
      );

    IF actual_foreign_keys IS DISTINCT FROM ARRAY[
        'template_categories_created_by_subject_id_fkey:storecalc.template_categories:{created_by_subject_id}:storecalc.contributor_subjects:{id}:r',
        'template_categories_template_id_fkey:storecalc.template_categories:{template_id}:storecalc.templates:{id}:r',
        'template_items_created_by_subject_id_fkey:storecalc.template_items:{created_by_subject_id}:storecalc.contributor_subjects:{id}:r',
        'template_items_template_id_fkey:storecalc.template_items:{template_id}:storecalc.templates:{id}:r',
        'templates_created_by_subject_id_fkey:storecalc.templates:{created_by_subject_id}:storecalc.contributor_subjects:{id}:r',
        'templates_owner_user_id_fkey:storecalc.templates:{owner_user_id}:public.users:{id}:r',
        'templates_program_id_fkey:storecalc.templates:{program_id}:storecalc.store_programs:{id}:r'
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

    IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'storecalc'::regnamespace) <> 11
       OR NOT EXISTS (
           SELECT 1
           FROM pg_proc AS procedure
           JOIN pg_language AS language ON language.oid = procedure.prolang
           WHERE procedure.oid = 'storecalc.lock_template_identity_topology()'::regprocedure
             AND language.lanname = 'plpgsql'
             AND procedure.prorettype = 'trigger'::regtype
             AND procedure.pronargs = 0
             AND procedure.prosecdef
             AND procedure.provolatile = 'v'
             AND procedure.proconfig = ARRAY['search_path=pg_catalog, storecalc']
             AND pg_get_userbyid(procedure.proowner) = migration_owner_role
             AND md5(procedure.prosrc) = 'efea8fe71bdefd1e62dff018998c63c7'
       ) OR NOT EXISTS (
           SELECT 1
           FROM pg_proc AS procedure
           JOIN pg_language AS language ON language.oid = procedure.prolang
           WHERE procedure.oid = 'storecalc.assert_template_coherent()'::regprocedure
             AND language.lanname = 'plpgsql'
             AND procedure.prorettype = 'trigger'::regtype
             AND procedure.pronargs = 0
             AND procedure.prosecdef
             AND procedure.provolatile = 'v'
             AND procedure.proconfig = ARRAY['search_path=pg_catalog, storecalc']
             AND pg_get_userbyid(procedure.proowner) = migration_owner_role
             AND md5(procedure.prosrc) = '9fff4f8ef280d873cbd898c3cb58023a'
       ) OR NOT EXISTS (
           SELECT 1
           FROM pg_proc AS procedure
           JOIN pg_language AS language ON language.oid = procedure.prolang
           WHERE procedure.oid = 'storecalc.protect_program_template_lineage()'::regprocedure
             AND language.lanname = 'plpgsql'
             AND procedure.prorettype = 'trigger'::regtype
             AND procedure.pronargs = 0
             AND procedure.prosecdef
             AND procedure.provolatile = 'v'
             AND procedure.proconfig = ARRAY['search_path=pg_catalog, storecalc']
             AND pg_get_userbyid(procedure.proowner) = migration_owner_role
             AND md5(procedure.prosrc) = '69445ad031bfa14abf64901418e5111c'
       ) OR NOT EXISTS (
           SELECT 1
           FROM pg_proc AS procedure
           JOIN pg_language AS language ON language.oid = procedure.prolang
           WHERE procedure.oid = 'storecalc.protect_template_stable_identity()'::regprocedure
             AND language.lanname = 'plpgsql'
             AND procedure.prorettype = 'trigger'::regtype
             AND procedure.pronargs = 0
             AND procedure.prosecdef
             AND procedure.provolatile = 'v'
             AND procedure.proconfig = ARRAY['search_path=pg_catalog, storecalc']
             AND pg_get_userbyid(procedure.proowner) = migration_owner_role
             AND md5(procedure.prosrc) = 'efc91571e536933a4f1469eabd5f555e'
       ) THEN
        RAISE EXCEPTION 'storecalc_template_postflight_function_inventory_mismatch';
    END IF;

    IF (
        SELECT count(*)
        FROM pg_trigger AS trigger_row
        JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid
        WHERE relation.relnamespace = 'storecalc'::regnamespace
          AND NOT trigger_row.tgisinternal
    ) <> 19 THEN
        RAISE EXCEPTION 'storecalc_template_verify_trigger_inventory_mismatch';
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
       OR EXISTS (
           SELECT 1
           FROM storecalc.schema_capabilities
           WHERE capability_key = 'schema.foundation'
             AND verified_at IS NULL
       ) THEN
        RAISE EXCEPTION 'storecalc_template_postflight_capability_or_seed_mismatch';
    END IF;
END
$storecalc_template_postflight$;

DO $storecalc_template_rollback_guard$
DECLARE
    object_name text;
    sequence_last_value bigint;
    sequence_is_called boolean;
BEGIN
    IF EXISTS (SELECT 1 FROM storecalc.template_categories)
       OR EXISTS (SELECT 1 FROM storecalc.template_items)
       OR EXISTS (SELECT 1 FROM storecalc.templates) THEN
        RAISE EXCEPTION 'storecalc_template_rollback_not_empty';
    END IF;

    FOREACH object_name IN ARRAY ARRAY[
        'storecalc.templates_id_seq',
        'storecalc.template_categories_id_seq',
        'storecalc.template_items_id_seq'
    ] LOOP
        EXECUTE format(
            'SELECT last_value, is_called FROM %s',
            object_name
        ) INTO sequence_last_value, sequence_is_called;

        IF sequence_last_value <> 1 OR sequence_is_called THEN
            RAISE EXCEPTION 'storecalc_template_rollback_sequence_used';
        END IF;
    END LOOP;
END
$storecalc_template_rollback_guard$;

DROP TRIGGER template_categories_identity_trigger
    ON storecalc.template_categories;
DROP TRIGGER template_categories_topology_lock_trigger
    ON storecalc.template_categories;
DROP TRIGGER template_items_identity_trigger
    ON storecalc.template_items;
DROP TRIGGER template_items_topology_lock_trigger
    ON storecalc.template_items;
DROP TRIGGER templates_coherence_trigger
    ON storecalc.templates;
DROP TRIGGER templates_topology_lock_trigger
    ON storecalc.templates;
DROP TRIGGER store_programs_template_lineage_trigger
    ON storecalc.store_programs;
DROP TRIGGER store_programs_template_topology_lock_trigger
    ON storecalc.store_programs;

DROP FUNCTION storecalc.protect_template_stable_identity();
DROP FUNCTION storecalc.protect_program_template_lineage();
DROP FUNCTION storecalc.assert_template_coherent();
DROP FUNCTION storecalc.lock_template_identity_topology();

DROP TABLE storecalc.template_items;
DROP TABLE storecalc.template_categories;
DROP TABLE storecalc.templates;

DO $storecalc_template_capability_rollback$
BEGIN
    UPDATE storecalc.schema_capabilities
    SET schema_version = 0,
        migration_key = '0001_schema_foundation',
        updated_at = (
            SELECT verified_at
            FROM storecalc.schema_capabilities
            WHERE capability_key = 'schema.foundation'
        )
    WHERE capability_key = 'anonymous.calculation'
      AND schema_version = 1
      AND NOT is_available
      AND verified_at IS NULL
      AND migration_key = '0004_template_identity';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'storecalc_template_rollback_capability_changed';
    END IF;
END
$storecalc_template_capability_rollback$;

DO $storecalc_template_rollback_postflight$
DECLARE
    actual_capabilities text[];
BEGIN
    IF to_regclass('storecalc.templates') IS NOT NULL
       OR to_regclass('storecalc.templates_id_seq') IS NOT NULL
       OR to_regclass('storecalc.template_categories') IS NOT NULL
       OR to_regclass('storecalc.template_categories_id_seq') IS NOT NULL
       OR to_regclass('storecalc.template_items') IS NOT NULL
       OR to_regclass('storecalc.template_items_id_seq') IS NOT NULL
       OR to_regprocedure('storecalc.lock_template_identity_topology()') IS NOT NULL
       OR to_regprocedure('storecalc.assert_template_coherent()') IS NOT NULL
       OR to_regprocedure('storecalc.protect_program_template_lineage()') IS NOT NULL
       OR to_regprocedure('storecalc.protect_template_stable_identity()') IS NOT NULL THEN
        RAISE EXCEPTION 'storecalc_template_rollback_object_remains';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_trigger AS trigger_row
        JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid
        WHERE relation.relnamespace = 'storecalc'::regnamespace
          AND trigger_row.tgname = ANY (
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
    ) THEN
        RAISE EXCEPTION 'storecalc_template_rollback_trigger_remains';
    END IF;

    IF (
        SELECT count(*)
        FROM pg_class
        WHERE relnamespace = 'storecalc'::regnamespace
    ) <> 61
       OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'storecalc'::regnamespace) <> 7
       OR (
           SELECT count(*)
           FROM pg_trigger AS trigger_row
           JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid
           WHERE relation.relnamespace = 'storecalc'::regnamespace
             AND NOT trigger_row.tgisinternal
       ) <> 11 THEN
        RAISE EXCEPTION 'storecalc_template_rollback_baseline_inventory_mismatch';
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
       OR NOT EXISTS (
           SELECT 1
           FROM storecalc.schema_capabilities
           WHERE capability_key = 'anonymous.calculation'
             AND updated_at IS NOT DISTINCT FROM (
                 SELECT verified_at
                 FROM storecalc.schema_capabilities
                 WHERE capability_key = 'schema.foundation'
             )
       ) THEN
        RAISE EXCEPTION 'storecalc_template_rollback_capability_mismatch';
    END IF;
END
$storecalc_template_rollback_postflight$;

COMMIT;
