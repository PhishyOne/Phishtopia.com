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
       ) <> 133 THEN
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

    IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'storecalc'::regnamespace) <> 14
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
    ) <> 34 THEN
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
        '3:anonymous.calculation:6:f:0009_constraints',
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

DO $storecalc_template_version_postflight$
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
    actual_relations text[];
    actual_columns text[];
    actual_constraints text[];
    actual_check_definitions text[];
    actual_indexes text[];
    actual_foreign_keys text[];
    actual_triggers text[];
    actual_capabilities text[];
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
              'template_versions',
              'template_versions_id_seq',
              'template_versions_pkey',
              'template_versions_id_template_key',
              'template_versions_template_number_key',
              'template_versions_state_idx',
              'template_versions_based_on_idx',
              'template_versions_created_by_subject_idx',
              'template_versions_content_hash_idx'
          ]
      );

    IF actual_relations IS DISTINCT FROM ARRAY[
        'template_versions:r',
        'template_versions_based_on_idx:i',
        'template_versions_content_hash_idx:i',
        'template_versions_created_by_subject_idx:i',
        'template_versions_id_seq:S',
        'template_versions_id_template_key:i',
        'template_versions_pkey:i',
        'template_versions_state_idx:i',
        'template_versions_template_number_key:i'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_template_version_postflight_relation_mismatch';
    END IF;

    SELECT array_agg(
        format(
            '%s:%s:%s:%s:%s',
            column_row.column_name,
            column_row.data_type,
            column_row.is_nullable,
            COALESCE(column_row.identity_generation, ''),
            COALESCE(column_row.column_default, '')
        )
        ORDER BY column_row.ordinal_position
    )
    INTO actual_columns
    FROM information_schema.columns AS column_row
    WHERE column_row.table_schema = 'storecalc'
      AND column_row.table_name = 'template_versions';

    IF actual_columns IS DISTINCT FROM ARRAY[
        'id:integer:NO:BY DEFAULT:',
        'template_id:integer:NO::',
        'version_number:integer:NO::',
        'content_state:text:NO::',
        'currency_code:text:NO::',
        'currency_exponent:smallint:NO::',
        'source_effective_date:date:YES::',
        'source_published_date:date:YES::',
        'based_on_version_id:integer:YES::',
        'calculation_contract_version:text:NO::',
        'required_capabilities:ARRAY:NO::',
        'content_schema_version:text:NO::',
        'canonicalization_version:text:NO::',
        'hash_algorithm:text:YES::',
        'content_hash:text:YES::',
        'created_by_subject_id:integer:YES::',
        'created_at:timestamp with time zone:NO::transaction_timestamp()',
        'sealed_at:timestamp with time zone:YES::'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_template_version_postflight_column_mismatch';
    END IF;

    SELECT array_agg(
        format('%s:%s', constraint_row.conname, constraint_row.contype)
        ORDER BY constraint_row.conname
    )
    INTO actual_constraints
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'storecalc.template_versions'::regclass;

    IF actual_constraints IS DISTINCT FROM ARRAY[
        'template_versions_based_on_self_check:c',
        'template_versions_based_on_template_fkey:f',
        'template_versions_calculation_contract_check:c',
        'template_versions_canonicalization_check:c',
        'template_versions_content_schema_check:c',
        'template_versions_content_state_check:c',
        'template_versions_created_by_subject_id_fkey:f',
        'template_versions_currency_contract_check:c',
        'template_versions_hash_state_check:c',
        'template_versions_id_template_key:u',
        'template_versions_pkey:p',
        'template_versions_required_capabilities_check:c',
        'template_versions_sealed_order_check:c',
        'template_versions_template_id_fkey:f',
        'template_versions_template_number_key:u',
        'template_versions_version_number_check:c'
    ]::text[]
       OR EXISTS (
           SELECT 1
           FROM pg_constraint
           WHERE conrelid = 'storecalc.template_versions'::regclass
             AND (NOT convalidated OR condeferrable OR condeferred)
       ) THEN
       RAISE EXCEPTION 'storecalc_template_version_postflight_constraint_mismatch';
    END IF;


    SELECT array_agg(
        format('%s:%s', constraint_row.conname, pg_get_constraintdef(constraint_row.oid))
        ORDER BY constraint_row.conname
    )
    INTO actual_check_definitions
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'storecalc.template_versions'::regclass
      AND constraint_row.contype = 'c';

    IF actual_check_definitions IS DISTINCT FROM ARRAY[
        'template_versions_based_on_self_check:CHECK (((based_on_version_id IS NULL) OR (based_on_version_id <> id)))',
        'template_versions_calculation_contract_check:CHECK ((calculation_contract_version = ''storecalc.calculation.v1''::text))',
        'template_versions_canonicalization_check:CHECK ((canonicalization_version = ''storecalc.canonical-json.v1''::text))',
        'template_versions_content_schema_check:CHECK ((content_schema_version = ''storecalc.catalog-content.v1''::text))',
        'template_versions_content_state_check:CHECK ((content_state = ANY (ARRAY[''draft''::text, ''sealed''::text])))',
        'template_versions_currency_contract_check:CHECK (((currency_code = ''USD''::text) AND (currency_exponent = 2)))',
        'template_versions_hash_state_check:CHECK ((((content_state = ''draft''::text) AND (hash_algorithm IS NULL) AND (content_hash IS NULL) AND (sealed_at IS NULL)) OR ((content_state = ''sealed''::text) AND (hash_algorithm = ''sha256''::text) AND (content_hash ~ ''^[a-f0-9]{64}$''::text) AND (sealed_at IS NOT NULL))))',
        'template_versions_required_capabilities_check:CHECK (((array_ndims(required_capabilities) = 1) AND (array_lower(required_capabilities, 1) = 1) AND ((cardinality(required_capabilities) >= 2) AND (cardinality(required_capabilities) <= 32)) AND (array_position(required_capabilities, NULL::text) IS NULL) AND (required_capabilities <@ ARRAY[''constraints.order_aggregate.v1''::text, ''money.minor_units.v1''::text, ''quantity.bounded_integer.v1''::text, ''spending_buckets.parallel_pretax.v1''::text, ''tax.single_treatment.line_rounding.v1''::text])))',
        'template_versions_sealed_order_check:CHECK (((sealed_at IS NULL) OR (sealed_at >= created_at)))',
        'template_versions_version_number_check:CHECK ((version_number >= 1))'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_template_version_postflight_check_definition_mismatch'
            USING DETAIL = COALESCE(actual_check_definitions::text, 'NULL');
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.template_versions'::regclass
          AND conname = 'template_versions_id_template_key'
          AND pg_get_constraintdef(oid) = 'UNIQUE (id, template_id)'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.template_versions'::regclass
          AND conname = 'template_versions_template_number_key'
          AND pg_get_constraintdef(oid) = 'UNIQUE (template_id, version_number)'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.template_versions'::regclass
          AND conname = 'template_versions_currency_contract_check'
          AND pg_get_constraintdef(oid) = 'CHECK (((currency_code = ''USD''::text) AND (currency_exponent = 2)))'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.template_versions'::regclass
          AND conname = 'template_versions_calculation_contract_check'
          AND pg_get_constraintdef(oid) = 'CHECK ((calculation_contract_version = ''storecalc.calculation.v1''::text))'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.template_versions'::regclass
          AND conname = 'template_versions_content_schema_check'
          AND pg_get_constraintdef(oid) = 'CHECK ((content_schema_version = ''storecalc.catalog-content.v1''::text))'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.template_versions'::regclass
          AND conname = 'template_versions_canonicalization_check'
          AND pg_get_constraintdef(oid) = 'CHECK ((canonicalization_version = ''storecalc.canonical-json.v1''::text))'
    ) THEN
        RAISE EXCEPTION 'storecalc_template_version_postflight_constraint_definition_mismatch';
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
              'template_versions_pkey',
              'template_versions_id_template_key',
              'template_versions_template_number_key',
              'template_versions_state_idx',
              'template_versions_based_on_idx',
              'template_versions_created_by_subject_idx',
              'template_versions_content_hash_idx'
          ]
      );

    IF actual_indexes IS DISTINCT FROM ARRAY[
        'template_versions_based_on_idx:CREATE INDEX template_versions_based_on_idx ON storecalc.template_versions USING btree (based_on_version_id) WHERE (based_on_version_id IS NOT NULL)',
        'template_versions_content_hash_idx:CREATE INDEX template_versions_content_hash_idx ON storecalc.template_versions USING btree (content_hash) WHERE (content_hash IS NOT NULL)',
        'template_versions_created_by_subject_idx:CREATE INDEX template_versions_created_by_subject_idx ON storecalc.template_versions USING btree (created_by_subject_id) WHERE (created_by_subject_id IS NOT NULL)',
        'template_versions_id_template_key:CREATE UNIQUE INDEX template_versions_id_template_key ON storecalc.template_versions USING btree (id, template_id)',
        'template_versions_pkey:CREATE UNIQUE INDEX template_versions_pkey ON storecalc.template_versions USING btree (id)',
        'template_versions_state_idx:CREATE INDEX template_versions_state_idx ON storecalc.template_versions USING btree (template_id, content_state, version_number DESC, id)',
        'template_versions_template_number_key:CREATE UNIQUE INDEX template_versions_template_number_key ON storecalc.template_versions USING btree (template_id, version_number)'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_template_version_postflight_index_mismatch';
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
      AND constraint_row.conrelid = 'storecalc.template_versions'::regclass;

    IF actual_foreign_keys IS DISTINCT FROM ARRAY[
        'template_versions_based_on_template_fkey:storecalc.template_versions:{based_on_version_id,template_id}:storecalc.template_versions:{id,template_id}:r',
        'template_versions_created_by_subject_id_fkey:storecalc.template_versions:{created_by_subject_id}:storecalc.contributor_subjects:{id}:r',
        'template_versions_template_id_fkey:storecalc.template_versions:{template_id}:storecalc.templates:{id}:r'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_template_version_postflight_foreign_key_mismatch';
    END IF;

    IF pg_get_userbyid(
        (SELECT relowner FROM pg_class WHERE oid = 'storecalc.template_versions'::regclass)
    ) IS DISTINCT FROM migration_owner_role
       OR pg_get_userbyid(
           (SELECT relowner FROM pg_class WHERE oid = 'storecalc.template_versions_id_seq'::regclass)
       ) IS DISTINCT FROM migration_owner_role
       OR pg_get_serial_sequence(
           'storecalc.template_versions',
           'id'
       ) IS DISTINCT FROM 'storecalc.template_versions_id_seq'
       OR NOT EXISTS (
           SELECT 1
           FROM pg_sequence
           WHERE seqrelid = 'storecalc.template_versions_id_seq'::regclass
             AND seqstart = 1
             AND seqincrement = 1
             AND seqmax = 2147483647
             AND seqmin = 1
             AND seqcache = 1
             AND NOT seqcycle
       ) THEN
        RAISE EXCEPTION 'storecalc_template_version_postflight_owner_or_sequence_mismatch';
    END IF;

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
            'template_versions_topology_lock_trigger',
            'template_versions_coherence_trigger',
            'templates_version_topology_lock_trigger'
        ]
    )
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgqual IS NULL;

    IF actual_triggers IS DISTINCT FROM ARRAY[
        'template_versions_coherence_trigger:template_versions:assert_template_version_coherent:O:31',
        'template_versions_topology_lock_trigger:template_versions:lock_template_version_topology:O:30',
        'templates_version_topology_lock_trigger:templates:lock_template_version_topology:O:18'
    ]::text[]
       OR (
           SELECT count(*)
           FROM pg_trigger AS trigger_row
           JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid
           WHERE relation.relnamespace = 'storecalc'::regnamespace
             AND NOT trigger_row.tgisinternal
       ) <> 34
       OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'storecalc'::regnamespace) <> 14
       OR NOT EXISTS (
           SELECT 1
           FROM pg_proc AS procedure
           JOIN pg_language AS language ON language.oid = procedure.prolang
           WHERE procedure.oid = 'storecalc.lock_template_version_topology()'::regprocedure
             AND language.lanname = 'plpgsql'
             AND procedure.prorettype = 'trigger'::regtype
             AND procedure.pronargs = 0
             AND procedure.prosecdef
             AND procedure.provolatile = 'v'
             AND procedure.proconfig = ARRAY['search_path=pg_catalog, storecalc']
             AND pg_get_userbyid(procedure.proowner) = migration_owner_role
             AND md5(procedure.prosrc) = '97bdfca97587a8f75e98a951a660d924'
       ) OR NOT EXISTS (
           SELECT 1
           FROM pg_proc AS procedure
           JOIN pg_language AS language ON language.oid = procedure.prolang
           WHERE procedure.oid = 'storecalc.assert_template_version_coherent()'::regprocedure
             AND language.lanname = 'plpgsql'
             AND procedure.prorettype = 'trigger'::regtype
             AND procedure.pronargs = 0
             AND procedure.prosecdef
             AND procedure.provolatile = 'v'
             AND procedure.proconfig = ARRAY['search_path=pg_catalog, storecalc']
             AND pg_get_userbyid(procedure.proowner) = migration_owner_role
             AND md5(procedure.prosrc) = '11c51b40a9603a7e43e158e323e696d9'
       )
       OR (SELECT count(*) FROM pg_class WHERE relnamespace = 'storecalc'::regnamespace) <> 133 THEN
        RAISE EXCEPTION 'storecalc_template_version_postflight_function_or_trigger_mismatch';
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
        RAISE EXCEPTION 'storecalc_template_version_postflight_unexpected_grantee';
    END IF;

    IF has_table_privilege(web_role, 'storecalc.template_versions', 'SELECT')
       OR has_table_privilege(web_role, 'storecalc.template_versions', 'INSERT')
       OR has_table_privilege(web_role, 'storecalc.template_versions', 'UPDATE')
       OR has_table_privilege(web_role, 'storecalc.template_versions', 'DELETE')
       OR has_table_privilege(worker_role, 'storecalc.template_versions', 'SELECT')
       OR has_table_privilege(worker_role, 'storecalc.template_versions', 'INSERT')
       OR has_table_privilege(worker_role, 'storecalc.template_versions', 'UPDATE')
       OR has_table_privilege(worker_role, 'storecalc.template_versions', 'DELETE')
       OR NOT has_table_privilege(backup_role, 'storecalc.template_versions', 'SELECT')
       OR has_table_privilege(backup_role, 'storecalc.template_versions', 'INSERT')
       OR has_table_privilege(backup_role, 'storecalc.template_versions', 'UPDATE')
       OR has_table_privilege(backup_role, 'storecalc.template_versions', 'DELETE')
       OR has_sequence_privilege(web_role, 'storecalc.template_versions_id_seq', 'SELECT')
       OR has_sequence_privilege(web_role, 'storecalc.template_versions_id_seq', 'USAGE')
       OR has_sequence_privilege(worker_role, 'storecalc.template_versions_id_seq', 'SELECT')
       OR has_sequence_privilege(worker_role, 'storecalc.template_versions_id_seq', 'USAGE')
       OR NOT has_sequence_privilege(backup_role, 'storecalc.template_versions_id_seq', 'SELECT')
       OR has_sequence_privilege(backup_role, 'storecalc.template_versions_id_seq', 'USAGE')
       OR has_sequence_privilege(backup_role, 'storecalc.template_versions_id_seq', 'UPDATE')
       OR has_function_privilege(web_role, 'storecalc.lock_template_version_topology()', 'EXECUTE')
       OR has_function_privilege(worker_role, 'storecalc.lock_template_version_topology()', 'EXECUTE')
       OR has_function_privilege(backup_role, 'storecalc.lock_template_version_topology()', 'EXECUTE')
       OR has_function_privilege(web_role, 'storecalc.assert_template_version_coherent()', 'EXECUTE')
       OR has_function_privilege(worker_role, 'storecalc.assert_template_version_coherent()', 'EXECUTE')
       OR has_function_privilege(backup_role, 'storecalc.assert_template_version_coherent()', 'EXECUTE') THEN
        RAISE EXCEPTION 'storecalc_template_version_postflight_grant_mismatch';
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
        '3:anonymous.calculation:6:f:0009_constraints',
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
       ) THEN
        RAISE EXCEPTION 'storecalc_template_version_postflight_capability_or_seed_mismatch';
    END IF;
END
$storecalc_template_version_postflight$;

DO $storecalc_version_content_postflight$
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
        'storecalc.version_categories',
        'storecalc.version_items'
    ];
    new_sequences constant text[] := ARRAY[
        'storecalc.version_categories_id_seq',
        'storecalc.version_items_id_seq'
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
              'version_categories',
              'version_categories_id_seq',
              'version_categories_pkey',
              'version_categories_id_version_key',
              'version_categories_version_category_key',
              'version_categories_version_sort_idx',
              'version_categories_category_lineage_idx',
              'version_items',
              'version_items_id_seq',
              'version_items_pkey',
              'version_items_id_version_key',
              'version_items_version_item_key',
              'version_items_version_sort_idx',
              'version_items_item_lineage_idx',
              'version_items_category_version_idx'
          ]
      );

    IF actual_relations IS DISTINCT FROM ARRAY[
        'version_categories:r',
        'version_categories_category_lineage_idx:i',
        'version_categories_id_seq:S',
        'version_categories_id_version_key:i',
        'version_categories_pkey:i',
        'version_categories_version_category_key:i',
        'version_categories_version_sort_idx:i',
        'version_items:r',
        'version_items_category_version_idx:i',
        'version_items_id_seq:S',
        'version_items_id_version_key:i',
        'version_items_item_lineage_idx:i',
        'version_items_pkey:i',
        'version_items_version_item_key:i',
        'version_items_version_sort_idx:i'
    ]::text[]
       OR (SELECT count(*) FROM pg_class WHERE relnamespace = 'storecalc'::regnamespace) <> 133 THEN
        RAISE EXCEPTION 'storecalc_version_content_postflight_relation_mismatch';
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
          ARRAY['version_categories', 'version_items']
      );

    IF actual_columns IS DISTINCT FROM ARRAY[
        'version_categories:id:integer:NO:BY DEFAULT:',
        'version_categories:version_id:integer:NO::',
        'version_categories:template_id:integer:NO::',
        'version_categories:category_id:integer:NO::',
        'version_categories:display_name:text:NO::',
        'version_categories:description:text:YES::',
        'version_categories:sort_order:integer:NO::',
        'version_categories:active:boolean:NO::',
        'version_items:id:integer:NO:BY DEFAULT:',
        'version_items:version_id:integer:NO::',
        'version_items:template_id:integer:NO::',
        'version_items:item_id:integer:NO::',
        'version_items:category_version_id:integer:YES::',
        'version_items:sku:text:YES::',
        'version_items:display_name:text:NO::',
        'version_items:description:text:YES::',
        'version_items:unit_label:text:YES::',
        'version_items:price_state:text:NO::',
        'version_items:price_minor:bigint:YES::',
        'version_items:minimum_selected_quantity:integer:NO::',
        'version_items:maximum_order_quantity:integer:NO::',
        'version_items:quantity_step:integer:NO::',
        'version_items:availability_state:text:NO::',
        'version_items:sort_order:integer:NO::'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_version_content_postflight_column_mismatch';
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
          ARRAY['version_categories', 'version_items']
      );

    IF actual_constraints IS DISTINCT FROM ARRAY[
        'version_categories:version_categories_category_template_fkey:f',
        'version_categories:version_categories_description_check:c',
        'version_categories:version_categories_display_name_check:c',
        'version_categories:version_categories_id_version_key:u',
        'version_categories:version_categories_pkey:p',
        'version_categories:version_categories_sort_order_check:c',
        'version_categories:version_categories_version_category_key:u',
        'version_categories:version_categories_version_template_fkey:f',
        'version_items:version_items_availability_state_check:c',
        'version_items:version_items_category_version_fkey:f',
        'version_items:version_items_description_check:c',
        'version_items:version_items_display_name_check:c',
        'version_items:version_items_id_version_key:u',
        'version_items:version_items_item_template_fkey:f',
        'version_items:version_items_pkey:p',
        'version_items:version_items_price_nullability_check:c',
        'version_items:version_items_price_state_check:c',
        'version_items:version_items_quantity_check:c',
        'version_items:version_items_sku_check:c',
        'version_items:version_items_sort_order_check:c',
        'version_items:version_items_unit_label_check:c',
        'version_items:version_items_version_item_key:u',
        'version_items:version_items_version_template_fkey:f'
    ]::text[]
       OR EXISTS (
           SELECT 1
           FROM pg_constraint AS constraint_row
           JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
           WHERE relation.relnamespace = 'storecalc'::regnamespace
             AND relation.relname = ANY (
                 ARRAY['version_categories', 'version_items']
             )
             AND (
                 NOT constraint_row.convalidated
                 OR constraint_row.condeferrable
                 OR constraint_row.condeferred
             )
       ) THEN
        RAISE EXCEPTION 'storecalc_version_content_postflight_constraint_mismatch';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.version_items'::regclass
          AND conname = 'version_items_price_nullability_check'
          AND pg_get_constraintdef(oid) = 'CHECK ((((price_state = ''known''::text) AND (price_minor IS NOT NULL) AND (price_minor >= 0)) OR ((price_state = ANY (ARRAY[''unknown''::text, ''unsupported''::text])) AND (price_minor IS NULL))))'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.version_items'::regclass
          AND conname = 'version_items_quantity_check'
          AND pg_get_constraintdef(oid) = 'CHECK ((((minimum_selected_quantity >= 1) AND (minimum_selected_quantity <= 1000000)) AND ((maximum_order_quantity >= 1) AND (maximum_order_quantity <= 1000000)) AND ((quantity_step >= 1) AND (quantity_step <= 1000000)) AND (maximum_order_quantity >= minimum_selected_quantity)))'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.version_categories'::regclass
          AND conname = 'version_categories_version_category_key'
          AND pg_get_constraintdef(oid) = 'UNIQUE (version_id, category_id)'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.version_items'::regclass
          AND conname = 'version_items_version_item_key'
          AND pg_get_constraintdef(oid) = 'UNIQUE (version_id, item_id)'
    ) THEN
        RAISE EXCEPTION 'storecalc_version_content_postflight_constraint_definition_mismatch';
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
              'version_categories_pkey',
              'version_categories_id_version_key',
              'version_categories_version_category_key',
              'version_categories_version_sort_idx',
              'version_categories_category_lineage_idx',
              'version_items_pkey',
              'version_items_id_version_key',
              'version_items_version_item_key',
              'version_items_version_sort_idx',
              'version_items_item_lineage_idx',
              'version_items_category_version_idx'
          ]
      );

    IF actual_indexes IS DISTINCT FROM ARRAY[
        'version_categories_category_lineage_idx:CREATE INDEX version_categories_category_lineage_idx ON storecalc.version_categories USING btree (category_id, template_id, version_id)',
        'version_categories_id_version_key:CREATE UNIQUE INDEX version_categories_id_version_key ON storecalc.version_categories USING btree (id, version_id)',
        'version_categories_pkey:CREATE UNIQUE INDEX version_categories_pkey ON storecalc.version_categories USING btree (id)',
        'version_categories_version_category_key:CREATE UNIQUE INDEX version_categories_version_category_key ON storecalc.version_categories USING btree (version_id, category_id)',
        'version_categories_version_sort_idx:CREATE INDEX version_categories_version_sort_idx ON storecalc.version_categories USING btree (version_id, active DESC, sort_order, id)',
        'version_items_category_version_idx:CREATE INDEX version_items_category_version_idx ON storecalc.version_items USING btree (category_version_id, version_id, sort_order, id) WHERE (category_version_id IS NOT NULL)',
        'version_items_id_version_key:CREATE UNIQUE INDEX version_items_id_version_key ON storecalc.version_items USING btree (id, version_id)',
        'version_items_item_lineage_idx:CREATE INDEX version_items_item_lineage_idx ON storecalc.version_items USING btree (item_id, template_id, version_id)',
        'version_items_pkey:CREATE UNIQUE INDEX version_items_pkey ON storecalc.version_items USING btree (id)',
        'version_items_version_item_key:CREATE UNIQUE INDEX version_items_version_item_key ON storecalc.version_items USING btree (version_id, item_id)',
        'version_items_version_sort_idx:CREATE INDEX version_items_version_sort_idx ON storecalc.version_items USING btree (version_id, availability_state, sort_order, id)'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_version_content_postflight_index_mismatch';
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
          ARRAY['version_categories', 'version_items']
      );

    IF actual_foreign_keys IS DISTINCT FROM ARRAY[
        'version_categories_category_template_fkey:storecalc.version_categories:{category_id,template_id}:storecalc.template_categories:{id,template_id}:r',
        'version_categories_version_template_fkey:storecalc.version_categories:{version_id,template_id}:storecalc.template_versions:{id,template_id}:r',
        'version_items_category_version_fkey:storecalc.version_items:{category_version_id,version_id}:storecalc.version_categories:{id,version_id}:r',
        'version_items_item_template_fkey:storecalc.version_items:{item_id,template_id}:storecalc.template_items:{id,template_id}:r',
        'version_items_version_template_fkey:storecalc.version_items:{version_id,template_id}:storecalc.template_versions:{id,template_id}:r'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_version_content_postflight_foreign_key_mismatch';
    END IF;

    FOREACH object_name IN ARRAY new_tables LOOP
        IF pg_get_userbyid(
            (SELECT relowner FROM pg_class WHERE oid = object_name::regclass)
        ) IS DISTINCT FROM migration_owner_role
           OR EXISTS (
               SELECT 1
               FROM pg_class
               WHERE oid = object_name::regclass
                 AND (relpersistence <> 'p' OR relrowsecurity OR relforcerowsecurity)
           )
           OR EXISTS (
               SELECT 1
               FROM pg_policy
               WHERE polrelid = object_name::regclass
           ) THEN
            RAISE EXCEPTION 'storecalc_version_content_postflight_table_security_mismatch';
        END IF;
    END LOOP;

    FOREACH object_name IN ARRAY new_sequences LOOP
        IF pg_get_userbyid(
            (SELECT relowner FROM pg_class WHERE oid = object_name::regclass)
        ) IS DISTINCT FROM migration_owner_role
           OR pg_get_serial_sequence(
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
            RAISE EXCEPTION 'storecalc_version_content_postflight_sequence_mismatch';
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
            'version_categories_version_topology_lock_trigger',
            'version_categories_content_mutability_trigger',
            'version_items_version_topology_lock_trigger',
            'version_items_content_mutability_trigger'
        ]
    )
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgqual IS NULL;

    IF actual_triggers IS DISTINCT FROM ARRAY[
        'version_categories_content_mutability_trigger:version_categories:assert_version_content_mutable:O:31',
        'version_categories_version_topology_lock_trigger:version_categories:lock_template_version_topology:O:30',
        'version_items_content_mutability_trigger:version_items:assert_version_content_mutable:O:31',
        'version_items_version_topology_lock_trigger:version_items:lock_template_version_topology:O:30'
    ]::text[]
       OR (
           SELECT count(*)
           FROM pg_trigger AS trigger_row
           JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid
           WHERE relation.relnamespace = 'storecalc'::regnamespace
             AND NOT trigger_row.tgisinternal
       ) <> 34
       OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'storecalc'::regnamespace) <> 14
       OR NOT EXISTS (
           SELECT 1
           FROM pg_proc AS procedure
           JOIN pg_language AS language ON language.oid = procedure.prolang
           WHERE procedure.oid = 'storecalc.assert_version_content_mutable()'::regprocedure
             AND language.lanname = 'plpgsql'
             AND procedure.prorettype = 'trigger'::regtype
             AND procedure.pronargs = 0
             AND procedure.prosecdef
             AND procedure.provolatile = 'v'
             AND procedure.proconfig = ARRAY['search_path=pg_catalog, storecalc']
             AND pg_get_userbyid(procedure.proowner) = migration_owner_role
             AND md5(procedure.prosrc) = 'a51e17e52e4398b1a16092290e5fda94'
       ) THEN
        RAISE EXCEPTION 'storecalc_version_content_postflight_function_or_trigger_mismatch';
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
        RAISE EXCEPTION 'storecalc_version_content_postflight_unexpected_grantee';
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
            RAISE EXCEPTION 'storecalc_version_content_postflight_table_grant_mismatch';
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
            RAISE EXCEPTION 'storecalc_version_content_postflight_sequence_grant_mismatch';
        END IF;
    END LOOP;

    IF has_function_privilege(
        web_role,
        'storecalc.assert_version_content_mutable()',
        'EXECUTE'
    ) OR has_function_privilege(
        worker_role,
        'storecalc.assert_version_content_mutable()',
        'EXECUTE'
    ) OR has_function_privilege(
        backup_role,
        'storecalc.assert_version_content_mutable()',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'storecalc_version_content_postflight_function_grant_mismatch';
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
        '3:anonymous.calculation:6:f:0009_constraints',
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
       ) THEN
        RAISE EXCEPTION 'storecalc_version_content_postflight_capability_or_seed_mismatch';
    END IF;
END
$storecalc_version_content_postflight$;

DO $storecalc_spending_buckets_postflight$
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
        'storecalc.version_spending_buckets',
        'storecalc.version_item_bucket_memberships'
    ];
    new_sequences constant text[] := ARRAY[
        'storecalc.version_spending_buckets_id_seq'
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
              'version_spending_buckets',
              'version_spending_buckets_id_seq',
              'version_spending_buckets_pkey',
              'version_spending_buckets_id_version_key',
              'version_spending_buckets_version_stable_key_key',
              'version_spending_buckets_version_sort_idx',
              'version_spending_buckets_primary_display_key',
              'version_item_bucket_memberships',
              'version_item_bucket_memberships_pkey',
              'version_item_bucket_memberships_version_item_lineage_idx',
              'version_item_bucket_memberships_bucket_lineage_idx',
              'version_item_bucket_memberships_primary_display_key'
          ]
      );

    IF actual_relations IS DISTINCT FROM ARRAY[
        'version_item_bucket_memberships:r',
        'version_item_bucket_memberships_bucket_lineage_idx:i',
        'version_item_bucket_memberships_pkey:i',
        'version_item_bucket_memberships_primary_display_key:i',
        'version_item_bucket_memberships_version_item_lineage_idx:i',
        'version_spending_buckets:r',
        'version_spending_buckets_id_seq:S',
        'version_spending_buckets_id_version_key:i',
        'version_spending_buckets_pkey:i',
        'version_spending_buckets_primary_display_key:i',
        'version_spending_buckets_version_sort_idx:i',
        'version_spending_buckets_version_stable_key_key:i'
    ]::text[]
       OR (SELECT count(*) FROM pg_class WHERE relnamespace = 'storecalc'::regnamespace) <> 133 THEN
        RAISE EXCEPTION 'storecalc_spending_buckets_postflight_relation_mismatch';
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
          ARRAY[
              'version_spending_buckets',
              'version_item_bucket_memberships'
          ]
      );

    IF actual_columns IS DISTINCT FROM ARRAY[
        'version_item_bucket_memberships:version_item_id:integer:NO::',
        'version_item_bucket_memberships:version_id:integer:NO::',
        'version_item_bucket_memberships:spending_bucket_id:integer:NO::',
        'version_item_bucket_memberships:membership_type:text:NO::',
        'version_item_bucket_memberships:primary_display:boolean:NO::',
        'version_spending_buckets:id:integer:NO:BY DEFAULT:',
        'version_spending_buckets:version_id:integer:NO::',
        'version_spending_buckets:stable_key:text:NO::',
        'version_spending_buckets:display_name:text:NO::',
        'version_spending_buckets:limit_state:text:NO::',
        'version_spending_buckets:limit_minor:bigint:YES::',
        'version_spending_buckets:measure_currency_code:text:NO::',
        'version_spending_buckets:is_primary_display:boolean:NO::',
        'version_spending_buckets:sort_order:integer:NO::'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_spending_buckets_postflight_column_mismatch';
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
          ARRAY[
              'version_spending_buckets',
              'version_item_bucket_memberships'
          ]
      );

    IF actual_constraints IS DISTINCT FROM ARRAY[
        'version_item_bucket_memberships:version_item_bucket_memberships_membership_type_check:c',
        'version_item_bucket_memberships:version_item_bucket_memberships_pkey:p',
        'version_item_bucket_memberships:version_item_bucket_memberships_spending_bucket_version_fkey:f',
        'version_item_bucket_memberships:version_item_bucket_memberships_version_item_fkey:f',
        'version_spending_buckets:version_spending_buckets_display_name_check:c',
        'version_spending_buckets:version_spending_buckets_id_version_key:u',
        'version_spending_buckets:version_spending_buckets_limit_nullability_check:c',
        'version_spending_buckets:version_spending_buckets_limit_state_check:c',
        'version_spending_buckets:version_spending_buckets_measure_currency_code_check:c',
        'version_spending_buckets:version_spending_buckets_pkey:p',
        'version_spending_buckets:version_spending_buckets_sort_order_check:c',
        'version_spending_buckets:version_spending_buckets_stable_key_check:c',
        'version_spending_buckets:version_spending_buckets_version_id_fkey:f',
        'version_spending_buckets:version_spending_buckets_version_stable_key_key:u'
    ]::text[]
       OR EXISTS (
           SELECT 1
           FROM pg_constraint AS constraint_row
           JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
           WHERE relation.relnamespace = 'storecalc'::regnamespace
             AND relation.relname = ANY (
                 ARRAY[
                     'version_spending_buckets',
                     'version_item_bucket_memberships'
                 ]
             )
             AND (
                 NOT constraint_row.convalidated
                 OR constraint_row.condeferrable
                 OR constraint_row.condeferred
             )
       ) THEN
        RAISE EXCEPTION 'storecalc_spending_buckets_postflight_constraint_mismatch';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.version_spending_buckets'::regclass
          AND conname = 'version_spending_buckets_limit_nullability_check'
          AND pg_get_constraintdef(oid) = 'CHECK ((((limit_state = ''known''::text) AND (limit_minor IS NOT NULL) AND (limit_minor >= 0)) OR ((limit_state = ANY (ARRAY[''unlimited''::text, ''not_applicable''::text, ''unknown''::text, ''unsupported''::text])) AND (limit_minor IS NULL))))'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.version_spending_buckets'::regclass
          AND conname = 'version_spending_buckets_version_stable_key_key'
          AND pg_get_constraintdef(oid) = 'UNIQUE (version_id, stable_key)'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.version_item_bucket_memberships'::regclass
          AND conname = 'version_item_bucket_memberships_membership_type_check'
          AND pg_get_constraintdef(oid) = 'CHECK ((membership_type = ANY (ARRAY[''counts_toward''::text, ''excluded''::text, ''informational_only''::text])))'
    ) THEN
        RAISE EXCEPTION 'storecalc_spending_buckets_postflight_constraint_definition_mismatch';
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
              'version_spending_buckets_pkey',
              'version_spending_buckets_id_version_key',
              'version_spending_buckets_version_stable_key_key',
              'version_spending_buckets_version_sort_idx',
              'version_spending_buckets_primary_display_key',
              'version_item_bucket_memberships_pkey',
              'version_item_bucket_memberships_version_item_lineage_idx',
              'version_item_bucket_memberships_bucket_lineage_idx',
              'version_item_bucket_memberships_primary_display_key'
          ]
      );

    IF actual_indexes IS DISTINCT FROM ARRAY[
        'version_item_bucket_memberships_bucket_lineage_idx:CREATE INDEX version_item_bucket_memberships_bucket_lineage_idx ON storecalc.version_item_bucket_memberships USING btree (spending_bucket_id, version_id, version_item_id)',
        'version_item_bucket_memberships_pkey:CREATE UNIQUE INDEX version_item_bucket_memberships_pkey ON storecalc.version_item_bucket_memberships USING btree (version_item_id, spending_bucket_id)',
        'version_item_bucket_memberships_primary_display_key:CREATE UNIQUE INDEX version_item_bucket_memberships_primary_display_key ON storecalc.version_item_bucket_memberships USING btree (version_item_id) WHERE primary_display',
        'version_item_bucket_memberships_version_item_lineage_idx:CREATE INDEX version_item_bucket_memberships_version_item_lineage_idx ON storecalc.version_item_bucket_memberships USING btree (version_item_id, version_id, spending_bucket_id)',
        'version_spending_buckets_id_version_key:CREATE UNIQUE INDEX version_spending_buckets_id_version_key ON storecalc.version_spending_buckets USING btree (id, version_id)',
        'version_spending_buckets_pkey:CREATE UNIQUE INDEX version_spending_buckets_pkey ON storecalc.version_spending_buckets USING btree (id)',
        'version_spending_buckets_primary_display_key:CREATE UNIQUE INDEX version_spending_buckets_primary_display_key ON storecalc.version_spending_buckets USING btree (version_id) WHERE is_primary_display',
        'version_spending_buckets_version_sort_idx:CREATE INDEX version_spending_buckets_version_sort_idx ON storecalc.version_spending_buckets USING btree (version_id, sort_order, stable_key, id)',
        'version_spending_buckets_version_stable_key_key:CREATE UNIQUE INDEX version_spending_buckets_version_stable_key_key ON storecalc.version_spending_buckets USING btree (version_id, stable_key)'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_spending_buckets_postflight_index_mismatch';
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
          ARRAY[
              'version_spending_buckets',
              'version_item_bucket_memberships'
          ]
      );

    IF actual_foreign_keys IS DISTINCT FROM ARRAY[
        'version_item_bucket_memberships_spending_bucket_version_fkey:storecalc.version_item_bucket_memberships:{spending_bucket_id,version_id}:storecalc.version_spending_buckets:{id,version_id}:r',
        'version_item_bucket_memberships_version_item_fkey:storecalc.version_item_bucket_memberships:{version_item_id,version_id}:storecalc.version_items:{id,version_id}:r',
        'version_spending_buckets_version_id_fkey:storecalc.version_spending_buckets:{version_id}:storecalc.template_versions:{id}:r'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_spending_buckets_postflight_foreign_key_mismatch';
    END IF;

    FOREACH object_name IN ARRAY new_tables LOOP
        IF pg_get_userbyid(
            (SELECT relowner FROM pg_class WHERE oid = object_name::regclass)
        ) IS DISTINCT FROM migration_owner_role
           OR EXISTS (
               SELECT 1
               FROM pg_class
               WHERE oid = object_name::regclass
                 AND (relpersistence <> 'p' OR relrowsecurity OR relforcerowsecurity)
           )
           OR EXISTS (
               SELECT 1
               FROM pg_policy
               WHERE polrelid = object_name::regclass
           ) THEN
            RAISE EXCEPTION 'storecalc_spending_buckets_postflight_table_security_mismatch';
        END IF;
    END LOOP;

    FOREACH object_name IN ARRAY new_sequences LOOP
        IF pg_get_userbyid(
            (SELECT relowner FROM pg_class WHERE oid = object_name::regclass)
        ) IS DISTINCT FROM migration_owner_role
           OR pg_get_serial_sequence(
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
            RAISE EXCEPTION 'storecalc_spending_buckets_postflight_sequence_mismatch';
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
            'version_spending_buckets_version_topology_lock_trigger',
            'version_spending_buckets_content_mutability_trigger',
            'version_item_bucket_memberships_version_topology_lock_trigger',
            'version_item_bucket_memberships_content_mutability_trigger'
        ]
    )
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgqual IS NULL;

    IF actual_triggers IS DISTINCT FROM ARRAY[
        'version_item_bucket_memberships_content_mutability_trigger:version_item_bucket_memberships:assert_version_content_mutable:O:31',
        'version_item_bucket_memberships_version_topology_lock_trigger:version_item_bucket_memberships:lock_template_version_topology:O:30',
        'version_spending_buckets_content_mutability_trigger:version_spending_buckets:assert_version_content_mutable:O:31',
        'version_spending_buckets_version_topology_lock_trigger:version_spending_buckets:lock_template_version_topology:O:30'
    ]::text[]
       OR (
           SELECT count(*)
           FROM pg_trigger AS trigger_row
           JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid
           WHERE relation.relnamespace = 'storecalc'::regnamespace
             AND NOT trigger_row.tgisinternal
       ) <> 34
       OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'storecalc'::regnamespace) <> 14 THEN
        RAISE EXCEPTION 'storecalc_spending_buckets_postflight_trigger_mismatch';
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
        RAISE EXCEPTION 'storecalc_spending_buckets_postflight_unexpected_grantee';
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
            RAISE EXCEPTION 'storecalc_spending_buckets_postflight_table_grant_mismatch';
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
            RAISE EXCEPTION 'storecalc_spending_buckets_postflight_sequence_grant_mismatch';
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
        '3:anonymous.calculation:6:f:0009_constraints',
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
       ) THEN
        RAISE EXCEPTION 'storecalc_spending_buckets_postflight_capability_or_seed_mismatch';
    END IF;
END
$storecalc_spending_buckets_postflight$;

DO $storecalc_tax_rules_postflight$
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
        'storecalc.version_tax_rules'
    ];
    new_sequences constant text[] := ARRAY[
        'storecalc.version_tax_rules_id_seq'
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
              'version_tax_rules',
              'version_tax_rules_id_seq',
              'version_tax_rules_pkey',
              'version_tax_rules_id_version_key',
              'version_tax_rules_version_resolution_idx',
              'version_tax_rules_template_priority_key',
              'version_tax_rules_category_priority_key',
              'version_tax_rules_item_priority_key'
          ]
      );

    IF actual_relations IS DISTINCT FROM ARRAY[
        'version_tax_rules:r',
        'version_tax_rules_category_priority_key:i',
        'version_tax_rules_id_seq:S',
        'version_tax_rules_id_version_key:i',
        'version_tax_rules_item_priority_key:i',
        'version_tax_rules_pkey:i',
        'version_tax_rules_template_priority_key:i',
        'version_tax_rules_version_resolution_idx:i'
    ]::text[]
       OR (SELECT count(*) FROM pg_class WHERE relnamespace = 'storecalc'::regnamespace) <> 133 THEN
        RAISE EXCEPTION 'storecalc_tax_rules_postflight_relation_mismatch';
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
      AND column_row.table_name = 'version_tax_rules';

    IF actual_columns IS DISTINCT FROM ARRAY[
        'version_tax_rules:id:integer:NO:BY DEFAULT:',
        'version_tax_rules:version_id:integer:NO::',
        'version_tax_rules:scope_type:text:NO::',
        'version_tax_rules:category_version_id:integer:YES::',
        'version_tax_rules:item_version_id:integer:YES::',
        'version_tax_rules:treatment_state:text:NO::',
        'version_tax_rules:rate_ppm:integer:YES::',
        'version_tax_rules:price_includes_tax:boolean:YES::',
        'version_tax_rules:rounding_mode:text:YES::',
        'version_tax_rules:rounding_scope:text:YES::',
        'version_tax_rules:priority:integer:NO::',
        'version_tax_rules:created_at:timestamp with time zone:NO::transaction_timestamp()'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_tax_rules_postflight_column_mismatch';
    END IF;

    SELECT array_agg(
        format('%s:%s', constraint_row.conname, constraint_row.contype)
        ORDER BY constraint_row.conname
    )
    INTO actual_constraints
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'storecalc.version_tax_rules'::regclass;

    IF actual_constraints IS DISTINCT FROM ARRAY[
        'version_tax_rules_category_version_fkey:f',
        'version_tax_rules_id_version_key:u',
        'version_tax_rules_item_version_fkey:f',
        'version_tax_rules_pkey:p',
        'version_tax_rules_priority_check:c',
        'version_tax_rules_rate_ppm_check:c',
        'version_tax_rules_rounding_mode_check:c',
        'version_tax_rules_rounding_scope_check:c',
        'version_tax_rules_scope_target_check:c',
        'version_tax_rules_scope_type_check:c',
        'version_tax_rules_treatment_nullability_check:c',
        'version_tax_rules_treatment_state_check:c',
        'version_tax_rules_version_id_fkey:f'
    ]::text[]
       OR EXISTS (
           SELECT 1
           FROM pg_constraint
           WHERE conrelid = 'storecalc.version_tax_rules'::regclass
             AND (NOT convalidated OR condeferrable OR condeferred)
       ) THEN
        RAISE EXCEPTION 'storecalc_tax_rules_postflight_constraint_mismatch';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.version_tax_rules'::regclass
          AND conname = 'version_tax_rules_scope_target_check'
          AND pg_get_constraintdef(oid) = 'CHECK ((((scope_type = ''template''::text) AND (category_version_id IS NULL) AND (item_version_id IS NULL)) OR ((scope_type = ''category''::text) AND (category_version_id IS NOT NULL) AND (item_version_id IS NULL)) OR ((scope_type = ''item''::text) AND (category_version_id IS NULL) AND (item_version_id IS NOT NULL))))'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.version_tax_rules'::regclass
          AND conname = 'version_tax_rules_treatment_nullability_check'
          AND pg_get_constraintdef(oid) = 'CHECK ((((treatment_state = ''known''::text) AND (rate_ppm IS NOT NULL) AND (price_includes_tax IS NOT NULL) AND (rounding_mode IS NOT NULL) AND (rounding_scope IS NOT NULL)) OR ((treatment_state <> ''known''::text) AND (rate_ppm IS NULL) AND (price_includes_tax IS NULL) AND (rounding_mode IS NULL) AND (rounding_scope IS NULL))))'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.version_tax_rules'::regclass
          AND conname = 'version_tax_rules_rate_ppm_check'
          AND pg_get_constraintdef(oid) = 'CHECK (((rate_ppm IS NULL) OR ((rate_ppm >= 0) AND (rate_ppm <= 1000000))))'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.version_tax_rules'::regclass
          AND conname = 'version_tax_rules_id_version_key'
          AND pg_get_constraintdef(oid) = 'UNIQUE (id, version_id)'
    ) THEN
        RAISE EXCEPTION 'storecalc_tax_rules_postflight_constraint_definition_mismatch';
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
              'version_tax_rules_pkey',
              'version_tax_rules_id_version_key',
              'version_tax_rules_version_resolution_idx',
              'version_tax_rules_template_priority_key',
              'version_tax_rules_category_priority_key',
              'version_tax_rules_item_priority_key'
          ]
      );

    IF actual_indexes IS DISTINCT FROM ARRAY[
        'version_tax_rules_category_priority_key:CREATE UNIQUE INDEX version_tax_rules_category_priority_key ON storecalc.version_tax_rules USING btree (version_id, category_version_id, priority) WHERE (scope_type = ''category''::text)',
        'version_tax_rules_id_version_key:CREATE UNIQUE INDEX version_tax_rules_id_version_key ON storecalc.version_tax_rules USING btree (id, version_id)',
        'version_tax_rules_item_priority_key:CREATE UNIQUE INDEX version_tax_rules_item_priority_key ON storecalc.version_tax_rules USING btree (version_id, item_version_id, priority) WHERE (scope_type = ''item''::text)',
        'version_tax_rules_pkey:CREATE UNIQUE INDEX version_tax_rules_pkey ON storecalc.version_tax_rules USING btree (id)',
        'version_tax_rules_template_priority_key:CREATE UNIQUE INDEX version_tax_rules_template_priority_key ON storecalc.version_tax_rules USING btree (version_id, priority) WHERE (scope_type = ''template''::text)',
        'version_tax_rules_version_resolution_idx:CREATE INDEX version_tax_rules_version_resolution_idx ON storecalc.version_tax_rules USING btree (version_id, priority DESC, scope_type, id)'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_tax_rules_postflight_index_mismatch';
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
      AND source_relation.oid = 'storecalc.version_tax_rules'::regclass;

    IF actual_foreign_keys IS DISTINCT FROM ARRAY[
        'version_tax_rules_category_version_fkey:storecalc.version_tax_rules:{category_version_id,version_id}:storecalc.version_categories:{id,version_id}:r',
        'version_tax_rules_item_version_fkey:storecalc.version_tax_rules:{item_version_id,version_id}:storecalc.version_items:{id,version_id}:r',
        'version_tax_rules_version_id_fkey:storecalc.version_tax_rules:{version_id}:storecalc.template_versions:{id}:r'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_tax_rules_postflight_foreign_key_mismatch';
    END IF;

    FOREACH object_name IN ARRAY new_tables LOOP
        IF pg_get_userbyid(
            (SELECT relowner FROM pg_class WHERE oid = object_name::regclass)
        ) IS DISTINCT FROM migration_owner_role
           OR EXISTS (
               SELECT 1
               FROM pg_class
               WHERE oid = object_name::regclass
                 AND (relpersistence <> 'p' OR relrowsecurity OR relforcerowsecurity)
           )
           OR EXISTS (
               SELECT 1
               FROM pg_policy
               WHERE polrelid = object_name::regclass
           ) THEN
            RAISE EXCEPTION 'storecalc_tax_rules_postflight_table_security_mismatch';
        END IF;
    END LOOP;

    FOREACH object_name IN ARRAY new_sequences LOOP
        IF pg_get_userbyid(
            (SELECT relowner FROM pg_class WHERE oid = object_name::regclass)
        ) IS DISTINCT FROM migration_owner_role
           OR pg_get_serial_sequence(
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
            RAISE EXCEPTION 'storecalc_tax_rules_postflight_sequence_mismatch';
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
            'version_tax_rules_version_topology_lock_trigger',
            'version_tax_rules_content_mutability_trigger'
        ]
    )
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgqual IS NULL;

    IF actual_triggers IS DISTINCT FROM ARRAY[
        'version_tax_rules_content_mutability_trigger:version_tax_rules:assert_version_content_mutable:O:31',
        'version_tax_rules_version_topology_lock_trigger:version_tax_rules:lock_template_version_topology:O:30'
    ]::text[]
       OR (
           SELECT count(*)
           FROM pg_trigger AS trigger_row
           JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid
           WHERE relation.relnamespace = 'storecalc'::regnamespace
             AND NOT trigger_row.tgisinternal
       ) <> 34
       OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'storecalc'::regnamespace) <> 14 THEN
        RAISE EXCEPTION 'storecalc_tax_rules_postflight_trigger_mismatch';
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
        RAISE EXCEPTION 'storecalc_tax_rules_postflight_unexpected_grantee';
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
            RAISE EXCEPTION 'storecalc_tax_rules_postflight_table_grant_mismatch';
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
            RAISE EXCEPTION 'storecalc_tax_rules_postflight_sequence_grant_mismatch';
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
        '3:anonymous.calculation:6:f:0009_constraints',
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
       ) THEN
        RAISE EXCEPTION 'storecalc_tax_rules_postflight_capability_or_seed_mismatch';
    END IF;
END
$storecalc_tax_rules_postflight$;

DO $storecalc_order_constraints_postflight$
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
    actual_check_definitions text[];
    actual_indexes text[];
    actual_foreign_keys text[];
    actual_triggers text[];
    actual_capabilities text[];
    new_tables constant text[] := ARRAY[
        'storecalc.version_constraints'
    ];
    new_sequences constant text[] := ARRAY[
        'storecalc.version_constraints_id_seq'
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
              'version_constraints',
              'version_constraints_id_seq',
              'version_constraints_pkey',
              'version_constraints_id_version_key',
              'version_constraints_version_stable_key_key',
              'version_constraints_version_resolution_idx'
          ]
      );

    IF actual_relations IS DISTINCT FROM ARRAY[
        'version_constraints:r',
        'version_constraints_id_seq:S',
        'version_constraints_id_version_key:i',
        'version_constraints_pkey:i',
        'version_constraints_version_resolution_idx:i',
        'version_constraints_version_stable_key_key:i'
    ]::text[]
       OR (SELECT count(*) FROM pg_class WHERE relnamespace = 'storecalc'::regnamespace) <> 133 THEN
        RAISE EXCEPTION 'storecalc_order_constraints_postflight_relation_mismatch';
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
      AND column_row.table_name = 'version_constraints';

    IF actual_columns IS DISTINCT FROM ARRAY[
        'version_constraints:id:integer:NO:BY DEFAULT:',
        'version_constraints:version_id:integer:NO::',
        'version_constraints:stable_key:text:NO::',
        'version_constraints:display_name:text:NO::',
        'version_constraints:constraint_type:text:NO::',
        'version_constraints:measure_type:text:NO::',
        'version_constraints:comparator:text:NO::',
        'version_constraints:value_state:text:NO::',
        'version_constraints:limit_value:bigint:YES::',
        'version_constraints:unit_code:text:NO::',
        'version_constraints:scope_type:text:NO::',
        'version_constraints:composition_behavior:text:NO::',
        'version_constraints:priority:integer:NO::'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_order_constraints_postflight_column_mismatch';
    END IF;

    SELECT array_agg(
        format('%s:%s', constraint_row.conname, constraint_row.contype)
        ORDER BY constraint_row.conname
    )
    INTO actual_constraints
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'storecalc.version_constraints'::regclass;

    IF actual_constraints IS DISTINCT FROM ARRAY[
        'version_constraints_comparator_check:c',
        'version_constraints_comparator_state_check:c',
        'version_constraints_composition_behavior_check:c',
        'version_constraints_constraint_type_check:c',
        'version_constraints_display_name_check:c',
        'version_constraints_id_version_key:u',
        'version_constraints_limit_nullability_check:c',
        'version_constraints_measure_type_check:c',
        'version_constraints_pkey:p',
        'version_constraints_priority_check:c',
        'version_constraints_scope_type_check:c',
        'version_constraints_stable_key_check:c',
        'version_constraints_unit_code_check:c',
        'version_constraints_value_state_check:c',
        'version_constraints_version_id_fkey:f',
        'version_constraints_version_stable_key_key:u'
    ]::text[]
       OR EXISTS (
           SELECT 1
           FROM pg_constraint
           WHERE conrelid = 'storecalc.version_constraints'::regclass
             AND (NOT convalidated OR condeferrable OR condeferred)
       ) THEN
        RAISE EXCEPTION 'storecalc_order_constraints_postflight_constraint_mismatch';
    END IF;

    SELECT array_agg(
        format('%s:%s', constraint_row.conname, pg_get_constraintdef(constraint_row.oid))
        ORDER BY constraint_row.conname
    )
    INTO actual_check_definitions
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'storecalc.version_constraints'::regclass
      AND constraint_row.contype = 'c';

    IF actual_check_definitions IS DISTINCT FROM ARRAY[
        'version_constraints_comparator_check:CHECK ((comparator = ANY (ARRAY[''less_than_or_equal''::text, ''greater_than_or_equal''::text])))',
        'version_constraints_comparator_state_check:CHECK (((comparator <> ''greater_than_or_equal''::text) OR (value_state <> ''unlimited''::text)))',
        'version_constraints_composition_behavior_check:CHECK ((composition_behavior = ''all_must_pass''::text))',
        'version_constraints_constraint_type_check:CHECK ((constraint_type = ''order_aggregate''::text))',
        'version_constraints_display_name_check:CHECK ((((char_length(display_name) >= 1) AND (char_length(display_name) <= 120)) AND (octet_length(display_name) <= 512) AND (display_name = btrim(display_name)) AND (display_name !~ ''[[:cntrl:]]''::text)))',
        'version_constraints_limit_nullability_check:CHECK ((((value_state = ''known''::text) AND (limit_value IS NOT NULL) AND ((limit_value >= 0) AND (limit_value <= 1000000000))) OR ((value_state = ANY (ARRAY[''unlimited''::text, ''not_applicable''::text, ''unknown''::text, ''unsupported''::text])) AND (limit_value IS NULL))))',
        'version_constraints_measure_type_check:CHECK ((measure_type = ANY (ARRAY[''total_quantity''::text, ''distinct_line_count''::text])))',
        'version_constraints_priority_check:CHECK (((priority >= 0) AND (priority <= 1000000)))',
        'version_constraints_scope_type_check:CHECK ((scope_type = ''order''::text))',
        'version_constraints_stable_key_check:CHECK ((((char_length(stable_key) >= 1) AND (char_length(stable_key) <= 64)) AND (octet_length(stable_key) <= 64) AND (stable_key ~ ''^[a-z][a-z0-9]*([._-][a-z0-9]+)*$''::text)))',
        'version_constraints_unit_code_check:CHECK ((unit_code = ''count''::text))',
        'version_constraints_value_state_check:CHECK ((value_state = ANY (ARRAY[''known''::text, ''unlimited''::text, ''not_applicable''::text, ''unknown''::text, ''unsupported''::text])))'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_order_constraints_postflight_constraint_definition_mismatch'
            USING DETAIL = COALESCE(actual_check_definitions::text, 'NULL');
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
              'version_constraints_pkey',
              'version_constraints_id_version_key',
              'version_constraints_version_stable_key_key',
              'version_constraints_version_resolution_idx'
          ]
      );

    IF actual_indexes IS DISTINCT FROM ARRAY[
        'version_constraints_id_version_key:CREATE UNIQUE INDEX version_constraints_id_version_key ON storecalc.version_constraints USING btree (id, version_id)',
        'version_constraints_pkey:CREATE UNIQUE INDEX version_constraints_pkey ON storecalc.version_constraints USING btree (id)',
        'version_constraints_version_resolution_idx:CREATE INDEX version_constraints_version_resolution_idx ON storecalc.version_constraints USING btree (version_id, priority, stable_key, id)',
        'version_constraints_version_stable_key_key:CREATE UNIQUE INDEX version_constraints_version_stable_key_key ON storecalc.version_constraints USING btree (version_id, stable_key)'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_order_constraints_postflight_index_mismatch';
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
      AND source_relation.oid = 'storecalc.version_constraints'::regclass;

    IF actual_foreign_keys IS DISTINCT FROM ARRAY[
        'version_constraints_version_id_fkey:storecalc.version_constraints:{version_id}:storecalc.template_versions:{id}:r'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_order_constraints_postflight_foreign_key_mismatch';
    END IF;

    FOREACH object_name IN ARRAY new_tables LOOP
        IF pg_get_userbyid(
            (SELECT relowner FROM pg_class WHERE oid = object_name::regclass)
        ) IS DISTINCT FROM migration_owner_role
           OR EXISTS (
               SELECT 1
               FROM pg_class
               WHERE oid = object_name::regclass
                 AND (relpersistence <> 'p' OR relrowsecurity OR relforcerowsecurity)
           )
           OR EXISTS (
               SELECT 1
               FROM pg_policy
               WHERE polrelid = object_name::regclass
           ) THEN
            RAISE EXCEPTION 'storecalc_order_constraints_postflight_table_security_mismatch';
        END IF;
    END LOOP;

    FOREACH object_name IN ARRAY new_sequences LOOP
        IF pg_get_userbyid(
            (SELECT relowner FROM pg_class WHERE oid = object_name::regclass)
        ) IS DISTINCT FROM migration_owner_role
           OR pg_get_serial_sequence(
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
            RAISE EXCEPTION 'storecalc_order_constraints_postflight_sequence_mismatch';
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
            'version_constraints_version_topology_lock_trigger',
            'version_constraints_content_mutability_trigger'
        ]
    )
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgqual IS NULL;

    IF actual_triggers IS DISTINCT FROM ARRAY[
        'version_constraints_content_mutability_trigger:version_constraints:assert_version_content_mutable:O:31',
        'version_constraints_version_topology_lock_trigger:version_constraints:lock_template_version_topology:O:30'
    ]::text[]
       OR (
           SELECT count(*)
           FROM pg_trigger AS trigger_row
           JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid
           WHERE relation.relnamespace = 'storecalc'::regnamespace
             AND NOT trigger_row.tgisinternal
       ) <> 34
       OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'storecalc'::regnamespace) <> 14 THEN
        RAISE EXCEPTION 'storecalc_order_constraints_postflight_trigger_mismatch';
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
        RAISE EXCEPTION 'storecalc_order_constraints_postflight_unexpected_grantee';
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
            RAISE EXCEPTION 'storecalc_order_constraints_postflight_table_grant_mismatch';
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
            RAISE EXCEPTION 'storecalc_order_constraints_postflight_sequence_grant_mismatch';
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
        '3:anonymous.calculation:6:f:0009_constraints',
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
       ) THEN
        RAISE EXCEPTION 'storecalc_order_constraints_postflight_capability_or_seed_mismatch';
    END IF;
END
$storecalc_order_constraints_postflight$;

DO $storecalc_order_constraints_rollback_preflight$
DECLARE
    constraint_sequence_last bigint;
    constraint_sequence_called boolean;
BEGIN
    IF EXISTS (SELECT 1 FROM storecalc.version_constraints) THEN
        RAISE EXCEPTION 'storecalc_order_constraints_rollback_not_empty'
            USING ERRCODE = '55000';
    END IF;

    SELECT last_value, is_called
    INTO constraint_sequence_last, constraint_sequence_called
    FROM storecalc.version_constraints_id_seq;

    IF constraint_sequence_last IS DISTINCT FROM 1
       OR constraint_sequence_called IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'storecalc_order_constraints_rollback_sequence_used'
            USING ERRCODE = '55000';
    END IF;
END
$storecalc_order_constraints_rollback_preflight$;

DROP TRIGGER version_constraints_content_mutability_trigger
    ON storecalc.version_constraints;
DROP TRIGGER version_constraints_version_topology_lock_trigger
    ON storecalc.version_constraints;

DROP TABLE storecalc.version_constraints;

DO $storecalc_order_constraints_capability_rollback$
BEGIN
    UPDATE storecalc.schema_capabilities
    SET schema_version = 5,
        migration_key = '0008_tax_rules',
        updated_at = transaction_timestamp()
    WHERE capability_key = 'anonymous.calculation'
      AND schema_version = 6
      AND NOT is_available
      AND verified_at IS NULL
      AND migration_key = '0009_constraints';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'storecalc_order_constraints_rollback_capability_precondition_failed';
    END IF;
END
$storecalc_order_constraints_capability_rollback$;


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
       ) <> 127 THEN
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

    IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'storecalc'::regnamespace) <> 14
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
    ) <> 32 THEN
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
        '3:anonymous.calculation:5:f:0008_tax_rules',
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

DO $storecalc_template_version_postflight$
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
    actual_relations text[];
    actual_columns text[];
    actual_constraints text[];
    actual_check_definitions text[];
    actual_indexes text[];
    actual_foreign_keys text[];
    actual_triggers text[];
    actual_capabilities text[];
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
              'template_versions',
              'template_versions_id_seq',
              'template_versions_pkey',
              'template_versions_id_template_key',
              'template_versions_template_number_key',
              'template_versions_state_idx',
              'template_versions_based_on_idx',
              'template_versions_created_by_subject_idx',
              'template_versions_content_hash_idx'
          ]
      );

    IF actual_relations IS DISTINCT FROM ARRAY[
        'template_versions:r',
        'template_versions_based_on_idx:i',
        'template_versions_content_hash_idx:i',
        'template_versions_created_by_subject_idx:i',
        'template_versions_id_seq:S',
        'template_versions_id_template_key:i',
        'template_versions_pkey:i',
        'template_versions_state_idx:i',
        'template_versions_template_number_key:i'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_template_version_postflight_relation_mismatch';
    END IF;

    SELECT array_agg(
        format(
            '%s:%s:%s:%s:%s',
            column_row.column_name,
            column_row.data_type,
            column_row.is_nullable,
            COALESCE(column_row.identity_generation, ''),
            COALESCE(column_row.column_default, '')
        )
        ORDER BY column_row.ordinal_position
    )
    INTO actual_columns
    FROM information_schema.columns AS column_row
    WHERE column_row.table_schema = 'storecalc'
      AND column_row.table_name = 'template_versions';

    IF actual_columns IS DISTINCT FROM ARRAY[
        'id:integer:NO:BY DEFAULT:',
        'template_id:integer:NO::',
        'version_number:integer:NO::',
        'content_state:text:NO::',
        'currency_code:text:NO::',
        'currency_exponent:smallint:NO::',
        'source_effective_date:date:YES::',
        'source_published_date:date:YES::',
        'based_on_version_id:integer:YES::',
        'calculation_contract_version:text:NO::',
        'required_capabilities:ARRAY:NO::',
        'content_schema_version:text:NO::',
        'canonicalization_version:text:NO::',
        'hash_algorithm:text:YES::',
        'content_hash:text:YES::',
        'created_by_subject_id:integer:YES::',
        'created_at:timestamp with time zone:NO::transaction_timestamp()',
        'sealed_at:timestamp with time zone:YES::'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_template_version_postflight_column_mismatch';
    END IF;

    SELECT array_agg(
        format('%s:%s', constraint_row.conname, constraint_row.contype)
        ORDER BY constraint_row.conname
    )
    INTO actual_constraints
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'storecalc.template_versions'::regclass;

    IF actual_constraints IS DISTINCT FROM ARRAY[
        'template_versions_based_on_self_check:c',
        'template_versions_based_on_template_fkey:f',
        'template_versions_calculation_contract_check:c',
        'template_versions_canonicalization_check:c',
        'template_versions_content_schema_check:c',
        'template_versions_content_state_check:c',
        'template_versions_created_by_subject_id_fkey:f',
        'template_versions_currency_contract_check:c',
        'template_versions_hash_state_check:c',
        'template_versions_id_template_key:u',
        'template_versions_pkey:p',
        'template_versions_required_capabilities_check:c',
        'template_versions_sealed_order_check:c',
        'template_versions_template_id_fkey:f',
        'template_versions_template_number_key:u',
        'template_versions_version_number_check:c'
    ]::text[]
       OR EXISTS (
           SELECT 1
           FROM pg_constraint
           WHERE conrelid = 'storecalc.template_versions'::regclass
             AND (NOT convalidated OR condeferrable OR condeferred)
       ) THEN
       RAISE EXCEPTION 'storecalc_template_version_postflight_constraint_mismatch';
    END IF;


    SELECT array_agg(
        format('%s:%s', constraint_row.conname, pg_get_constraintdef(constraint_row.oid))
        ORDER BY constraint_row.conname
    )
    INTO actual_check_definitions
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'storecalc.template_versions'::regclass
      AND constraint_row.contype = 'c';

    IF actual_check_definitions IS DISTINCT FROM ARRAY[
        'template_versions_based_on_self_check:CHECK (((based_on_version_id IS NULL) OR (based_on_version_id <> id)))',
        'template_versions_calculation_contract_check:CHECK ((calculation_contract_version = ''storecalc.calculation.v1''::text))',
        'template_versions_canonicalization_check:CHECK ((canonicalization_version = ''storecalc.canonical-json.v1''::text))',
        'template_versions_content_schema_check:CHECK ((content_schema_version = ''storecalc.catalog-content.v1''::text))',
        'template_versions_content_state_check:CHECK ((content_state = ANY (ARRAY[''draft''::text, ''sealed''::text])))',
        'template_versions_currency_contract_check:CHECK (((currency_code = ''USD''::text) AND (currency_exponent = 2)))',
        'template_versions_hash_state_check:CHECK ((((content_state = ''draft''::text) AND (hash_algorithm IS NULL) AND (content_hash IS NULL) AND (sealed_at IS NULL)) OR ((content_state = ''sealed''::text) AND (hash_algorithm = ''sha256''::text) AND (content_hash ~ ''^[a-f0-9]{64}$''::text) AND (sealed_at IS NOT NULL))))',
        'template_versions_required_capabilities_check:CHECK (((array_ndims(required_capabilities) = 1) AND (array_lower(required_capabilities, 1) = 1) AND ((cardinality(required_capabilities) >= 2) AND (cardinality(required_capabilities) <= 32)) AND (array_position(required_capabilities, NULL::text) IS NULL) AND (required_capabilities <@ ARRAY[''constraints.order_aggregate.v1''::text, ''money.minor_units.v1''::text, ''quantity.bounded_integer.v1''::text, ''spending_buckets.parallel_pretax.v1''::text, ''tax.single_treatment.line_rounding.v1''::text])))',
        'template_versions_sealed_order_check:CHECK (((sealed_at IS NULL) OR (sealed_at >= created_at)))',
        'template_versions_version_number_check:CHECK ((version_number >= 1))'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_template_version_postflight_check_definition_mismatch'
            USING DETAIL = COALESCE(actual_check_definitions::text, 'NULL');
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.template_versions'::regclass
          AND conname = 'template_versions_id_template_key'
          AND pg_get_constraintdef(oid) = 'UNIQUE (id, template_id)'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.template_versions'::regclass
          AND conname = 'template_versions_template_number_key'
          AND pg_get_constraintdef(oid) = 'UNIQUE (template_id, version_number)'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.template_versions'::regclass
          AND conname = 'template_versions_currency_contract_check'
          AND pg_get_constraintdef(oid) = 'CHECK (((currency_code = ''USD''::text) AND (currency_exponent = 2)))'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.template_versions'::regclass
          AND conname = 'template_versions_calculation_contract_check'
          AND pg_get_constraintdef(oid) = 'CHECK ((calculation_contract_version = ''storecalc.calculation.v1''::text))'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.template_versions'::regclass
          AND conname = 'template_versions_content_schema_check'
          AND pg_get_constraintdef(oid) = 'CHECK ((content_schema_version = ''storecalc.catalog-content.v1''::text))'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.template_versions'::regclass
          AND conname = 'template_versions_canonicalization_check'
          AND pg_get_constraintdef(oid) = 'CHECK ((canonicalization_version = ''storecalc.canonical-json.v1''::text))'
    ) THEN
        RAISE EXCEPTION 'storecalc_template_version_postflight_constraint_definition_mismatch';
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
              'template_versions_pkey',
              'template_versions_id_template_key',
              'template_versions_template_number_key',
              'template_versions_state_idx',
              'template_versions_based_on_idx',
              'template_versions_created_by_subject_idx',
              'template_versions_content_hash_idx'
          ]
      );

    IF actual_indexes IS DISTINCT FROM ARRAY[
        'template_versions_based_on_idx:CREATE INDEX template_versions_based_on_idx ON storecalc.template_versions USING btree (based_on_version_id) WHERE (based_on_version_id IS NOT NULL)',
        'template_versions_content_hash_idx:CREATE INDEX template_versions_content_hash_idx ON storecalc.template_versions USING btree (content_hash) WHERE (content_hash IS NOT NULL)',
        'template_versions_created_by_subject_idx:CREATE INDEX template_versions_created_by_subject_idx ON storecalc.template_versions USING btree (created_by_subject_id) WHERE (created_by_subject_id IS NOT NULL)',
        'template_versions_id_template_key:CREATE UNIQUE INDEX template_versions_id_template_key ON storecalc.template_versions USING btree (id, template_id)',
        'template_versions_pkey:CREATE UNIQUE INDEX template_versions_pkey ON storecalc.template_versions USING btree (id)',
        'template_versions_state_idx:CREATE INDEX template_versions_state_idx ON storecalc.template_versions USING btree (template_id, content_state, version_number DESC, id)',
        'template_versions_template_number_key:CREATE UNIQUE INDEX template_versions_template_number_key ON storecalc.template_versions USING btree (template_id, version_number)'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_template_version_postflight_index_mismatch';
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
      AND constraint_row.conrelid = 'storecalc.template_versions'::regclass;

    IF actual_foreign_keys IS DISTINCT FROM ARRAY[
        'template_versions_based_on_template_fkey:storecalc.template_versions:{based_on_version_id,template_id}:storecalc.template_versions:{id,template_id}:r',
        'template_versions_created_by_subject_id_fkey:storecalc.template_versions:{created_by_subject_id}:storecalc.contributor_subjects:{id}:r',
        'template_versions_template_id_fkey:storecalc.template_versions:{template_id}:storecalc.templates:{id}:r'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_template_version_postflight_foreign_key_mismatch';
    END IF;

    IF pg_get_userbyid(
        (SELECT relowner FROM pg_class WHERE oid = 'storecalc.template_versions'::regclass)
    ) IS DISTINCT FROM migration_owner_role
       OR pg_get_userbyid(
           (SELECT relowner FROM pg_class WHERE oid = 'storecalc.template_versions_id_seq'::regclass)
       ) IS DISTINCT FROM migration_owner_role
       OR pg_get_serial_sequence(
           'storecalc.template_versions',
           'id'
       ) IS DISTINCT FROM 'storecalc.template_versions_id_seq'
       OR NOT EXISTS (
           SELECT 1
           FROM pg_sequence
           WHERE seqrelid = 'storecalc.template_versions_id_seq'::regclass
             AND seqstart = 1
             AND seqincrement = 1
             AND seqmax = 2147483647
             AND seqmin = 1
             AND seqcache = 1
             AND NOT seqcycle
       ) THEN
        RAISE EXCEPTION 'storecalc_template_version_postflight_owner_or_sequence_mismatch';
    END IF;

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
            'template_versions_topology_lock_trigger',
            'template_versions_coherence_trigger',
            'templates_version_topology_lock_trigger'
        ]
    )
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgqual IS NULL;

    IF actual_triggers IS DISTINCT FROM ARRAY[
        'template_versions_coherence_trigger:template_versions:assert_template_version_coherent:O:31',
        'template_versions_topology_lock_trigger:template_versions:lock_template_version_topology:O:30',
        'templates_version_topology_lock_trigger:templates:lock_template_version_topology:O:18'
    ]::text[]
       OR (
           SELECT count(*)
           FROM pg_trigger AS trigger_row
           JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid
           WHERE relation.relnamespace = 'storecalc'::regnamespace
             AND NOT trigger_row.tgisinternal
       ) <> 32
       OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'storecalc'::regnamespace) <> 14
       OR NOT EXISTS (
           SELECT 1
           FROM pg_proc AS procedure
           JOIN pg_language AS language ON language.oid = procedure.prolang
           WHERE procedure.oid = 'storecalc.lock_template_version_topology()'::regprocedure
             AND language.lanname = 'plpgsql'
             AND procedure.prorettype = 'trigger'::regtype
             AND procedure.pronargs = 0
             AND procedure.prosecdef
             AND procedure.provolatile = 'v'
             AND procedure.proconfig = ARRAY['search_path=pg_catalog, storecalc']
             AND pg_get_userbyid(procedure.proowner) = migration_owner_role
             AND md5(procedure.prosrc) = '97bdfca97587a8f75e98a951a660d924'
       ) OR NOT EXISTS (
           SELECT 1
           FROM pg_proc AS procedure
           JOIN pg_language AS language ON language.oid = procedure.prolang
           WHERE procedure.oid = 'storecalc.assert_template_version_coherent()'::regprocedure
             AND language.lanname = 'plpgsql'
             AND procedure.prorettype = 'trigger'::regtype
             AND procedure.pronargs = 0
             AND procedure.prosecdef
             AND procedure.provolatile = 'v'
             AND procedure.proconfig = ARRAY['search_path=pg_catalog, storecalc']
             AND pg_get_userbyid(procedure.proowner) = migration_owner_role
             AND md5(procedure.prosrc) = '11c51b40a9603a7e43e158e323e696d9'
       )
       OR (SELECT count(*) FROM pg_class WHERE relnamespace = 'storecalc'::regnamespace) <> 127 THEN
        RAISE EXCEPTION 'storecalc_template_version_postflight_function_or_trigger_mismatch';
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
        RAISE EXCEPTION 'storecalc_template_version_postflight_unexpected_grantee';
    END IF;

    IF has_table_privilege(web_role, 'storecalc.template_versions', 'SELECT')
       OR has_table_privilege(web_role, 'storecalc.template_versions', 'INSERT')
       OR has_table_privilege(web_role, 'storecalc.template_versions', 'UPDATE')
       OR has_table_privilege(web_role, 'storecalc.template_versions', 'DELETE')
       OR has_table_privilege(worker_role, 'storecalc.template_versions', 'SELECT')
       OR has_table_privilege(worker_role, 'storecalc.template_versions', 'INSERT')
       OR has_table_privilege(worker_role, 'storecalc.template_versions', 'UPDATE')
       OR has_table_privilege(worker_role, 'storecalc.template_versions', 'DELETE')
       OR NOT has_table_privilege(backup_role, 'storecalc.template_versions', 'SELECT')
       OR has_table_privilege(backup_role, 'storecalc.template_versions', 'INSERT')
       OR has_table_privilege(backup_role, 'storecalc.template_versions', 'UPDATE')
       OR has_table_privilege(backup_role, 'storecalc.template_versions', 'DELETE')
       OR has_sequence_privilege(web_role, 'storecalc.template_versions_id_seq', 'SELECT')
       OR has_sequence_privilege(web_role, 'storecalc.template_versions_id_seq', 'USAGE')
       OR has_sequence_privilege(worker_role, 'storecalc.template_versions_id_seq', 'SELECT')
       OR has_sequence_privilege(worker_role, 'storecalc.template_versions_id_seq', 'USAGE')
       OR NOT has_sequence_privilege(backup_role, 'storecalc.template_versions_id_seq', 'SELECT')
       OR has_sequence_privilege(backup_role, 'storecalc.template_versions_id_seq', 'USAGE')
       OR has_sequence_privilege(backup_role, 'storecalc.template_versions_id_seq', 'UPDATE')
       OR has_function_privilege(web_role, 'storecalc.lock_template_version_topology()', 'EXECUTE')
       OR has_function_privilege(worker_role, 'storecalc.lock_template_version_topology()', 'EXECUTE')
       OR has_function_privilege(backup_role, 'storecalc.lock_template_version_topology()', 'EXECUTE')
       OR has_function_privilege(web_role, 'storecalc.assert_template_version_coherent()', 'EXECUTE')
       OR has_function_privilege(worker_role, 'storecalc.assert_template_version_coherent()', 'EXECUTE')
       OR has_function_privilege(backup_role, 'storecalc.assert_template_version_coherent()', 'EXECUTE') THEN
        RAISE EXCEPTION 'storecalc_template_version_postflight_grant_mismatch';
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
        '3:anonymous.calculation:5:f:0008_tax_rules',
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
       ) THEN
        RAISE EXCEPTION 'storecalc_template_version_postflight_capability_or_seed_mismatch';
    END IF;
END
$storecalc_template_version_postflight$;

DO $storecalc_version_content_postflight$
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
        'storecalc.version_categories',
        'storecalc.version_items'
    ];
    new_sequences constant text[] := ARRAY[
        'storecalc.version_categories_id_seq',
        'storecalc.version_items_id_seq'
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
              'version_categories',
              'version_categories_id_seq',
              'version_categories_pkey',
              'version_categories_id_version_key',
              'version_categories_version_category_key',
              'version_categories_version_sort_idx',
              'version_categories_category_lineage_idx',
              'version_items',
              'version_items_id_seq',
              'version_items_pkey',
              'version_items_id_version_key',
              'version_items_version_item_key',
              'version_items_version_sort_idx',
              'version_items_item_lineage_idx',
              'version_items_category_version_idx'
          ]
      );

    IF actual_relations IS DISTINCT FROM ARRAY[
        'version_categories:r',
        'version_categories_category_lineage_idx:i',
        'version_categories_id_seq:S',
        'version_categories_id_version_key:i',
        'version_categories_pkey:i',
        'version_categories_version_category_key:i',
        'version_categories_version_sort_idx:i',
        'version_items:r',
        'version_items_category_version_idx:i',
        'version_items_id_seq:S',
        'version_items_id_version_key:i',
        'version_items_item_lineage_idx:i',
        'version_items_pkey:i',
        'version_items_version_item_key:i',
        'version_items_version_sort_idx:i'
    ]::text[]
       OR (SELECT count(*) FROM pg_class WHERE relnamespace = 'storecalc'::regnamespace) <> 127 THEN
        RAISE EXCEPTION 'storecalc_version_content_postflight_relation_mismatch';
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
          ARRAY['version_categories', 'version_items']
      );

    IF actual_columns IS DISTINCT FROM ARRAY[
        'version_categories:id:integer:NO:BY DEFAULT:',
        'version_categories:version_id:integer:NO::',
        'version_categories:template_id:integer:NO::',
        'version_categories:category_id:integer:NO::',
        'version_categories:display_name:text:NO::',
        'version_categories:description:text:YES::',
        'version_categories:sort_order:integer:NO::',
        'version_categories:active:boolean:NO::',
        'version_items:id:integer:NO:BY DEFAULT:',
        'version_items:version_id:integer:NO::',
        'version_items:template_id:integer:NO::',
        'version_items:item_id:integer:NO::',
        'version_items:category_version_id:integer:YES::',
        'version_items:sku:text:YES::',
        'version_items:display_name:text:NO::',
        'version_items:description:text:YES::',
        'version_items:unit_label:text:YES::',
        'version_items:price_state:text:NO::',
        'version_items:price_minor:bigint:YES::',
        'version_items:minimum_selected_quantity:integer:NO::',
        'version_items:maximum_order_quantity:integer:NO::',
        'version_items:quantity_step:integer:NO::',
        'version_items:availability_state:text:NO::',
        'version_items:sort_order:integer:NO::'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_version_content_postflight_column_mismatch';
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
          ARRAY['version_categories', 'version_items']
      );

    IF actual_constraints IS DISTINCT FROM ARRAY[
        'version_categories:version_categories_category_template_fkey:f',
        'version_categories:version_categories_description_check:c',
        'version_categories:version_categories_display_name_check:c',
        'version_categories:version_categories_id_version_key:u',
        'version_categories:version_categories_pkey:p',
        'version_categories:version_categories_sort_order_check:c',
        'version_categories:version_categories_version_category_key:u',
        'version_categories:version_categories_version_template_fkey:f',
        'version_items:version_items_availability_state_check:c',
        'version_items:version_items_category_version_fkey:f',
        'version_items:version_items_description_check:c',
        'version_items:version_items_display_name_check:c',
        'version_items:version_items_id_version_key:u',
        'version_items:version_items_item_template_fkey:f',
        'version_items:version_items_pkey:p',
        'version_items:version_items_price_nullability_check:c',
        'version_items:version_items_price_state_check:c',
        'version_items:version_items_quantity_check:c',
        'version_items:version_items_sku_check:c',
        'version_items:version_items_sort_order_check:c',
        'version_items:version_items_unit_label_check:c',
        'version_items:version_items_version_item_key:u',
        'version_items:version_items_version_template_fkey:f'
    ]::text[]
       OR EXISTS (
           SELECT 1
           FROM pg_constraint AS constraint_row
           JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
           WHERE relation.relnamespace = 'storecalc'::regnamespace
             AND relation.relname = ANY (
                 ARRAY['version_categories', 'version_items']
             )
             AND (
                 NOT constraint_row.convalidated
                 OR constraint_row.condeferrable
                 OR constraint_row.condeferred
             )
       ) THEN
        RAISE EXCEPTION 'storecalc_version_content_postflight_constraint_mismatch';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.version_items'::regclass
          AND conname = 'version_items_price_nullability_check'
          AND pg_get_constraintdef(oid) = 'CHECK ((((price_state = ''known''::text) AND (price_minor IS NOT NULL) AND (price_minor >= 0)) OR ((price_state = ANY (ARRAY[''unknown''::text, ''unsupported''::text])) AND (price_minor IS NULL))))'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.version_items'::regclass
          AND conname = 'version_items_quantity_check'
          AND pg_get_constraintdef(oid) = 'CHECK ((((minimum_selected_quantity >= 1) AND (minimum_selected_quantity <= 1000000)) AND ((maximum_order_quantity >= 1) AND (maximum_order_quantity <= 1000000)) AND ((quantity_step >= 1) AND (quantity_step <= 1000000)) AND (maximum_order_quantity >= minimum_selected_quantity)))'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.version_categories'::regclass
          AND conname = 'version_categories_version_category_key'
          AND pg_get_constraintdef(oid) = 'UNIQUE (version_id, category_id)'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.version_items'::regclass
          AND conname = 'version_items_version_item_key'
          AND pg_get_constraintdef(oid) = 'UNIQUE (version_id, item_id)'
    ) THEN
        RAISE EXCEPTION 'storecalc_version_content_postflight_constraint_definition_mismatch';
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
              'version_categories_pkey',
              'version_categories_id_version_key',
              'version_categories_version_category_key',
              'version_categories_version_sort_idx',
              'version_categories_category_lineage_idx',
              'version_items_pkey',
              'version_items_id_version_key',
              'version_items_version_item_key',
              'version_items_version_sort_idx',
              'version_items_item_lineage_idx',
              'version_items_category_version_idx'
          ]
      );

    IF actual_indexes IS DISTINCT FROM ARRAY[
        'version_categories_category_lineage_idx:CREATE INDEX version_categories_category_lineage_idx ON storecalc.version_categories USING btree (category_id, template_id, version_id)',
        'version_categories_id_version_key:CREATE UNIQUE INDEX version_categories_id_version_key ON storecalc.version_categories USING btree (id, version_id)',
        'version_categories_pkey:CREATE UNIQUE INDEX version_categories_pkey ON storecalc.version_categories USING btree (id)',
        'version_categories_version_category_key:CREATE UNIQUE INDEX version_categories_version_category_key ON storecalc.version_categories USING btree (version_id, category_id)',
        'version_categories_version_sort_idx:CREATE INDEX version_categories_version_sort_idx ON storecalc.version_categories USING btree (version_id, active DESC, sort_order, id)',
        'version_items_category_version_idx:CREATE INDEX version_items_category_version_idx ON storecalc.version_items USING btree (category_version_id, version_id, sort_order, id) WHERE (category_version_id IS NOT NULL)',
        'version_items_id_version_key:CREATE UNIQUE INDEX version_items_id_version_key ON storecalc.version_items USING btree (id, version_id)',
        'version_items_item_lineage_idx:CREATE INDEX version_items_item_lineage_idx ON storecalc.version_items USING btree (item_id, template_id, version_id)',
        'version_items_pkey:CREATE UNIQUE INDEX version_items_pkey ON storecalc.version_items USING btree (id)',
        'version_items_version_item_key:CREATE UNIQUE INDEX version_items_version_item_key ON storecalc.version_items USING btree (version_id, item_id)',
        'version_items_version_sort_idx:CREATE INDEX version_items_version_sort_idx ON storecalc.version_items USING btree (version_id, availability_state, sort_order, id)'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_version_content_postflight_index_mismatch';
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
          ARRAY['version_categories', 'version_items']
      );

    IF actual_foreign_keys IS DISTINCT FROM ARRAY[
        'version_categories_category_template_fkey:storecalc.version_categories:{category_id,template_id}:storecalc.template_categories:{id,template_id}:r',
        'version_categories_version_template_fkey:storecalc.version_categories:{version_id,template_id}:storecalc.template_versions:{id,template_id}:r',
        'version_items_category_version_fkey:storecalc.version_items:{category_version_id,version_id}:storecalc.version_categories:{id,version_id}:r',
        'version_items_item_template_fkey:storecalc.version_items:{item_id,template_id}:storecalc.template_items:{id,template_id}:r',
        'version_items_version_template_fkey:storecalc.version_items:{version_id,template_id}:storecalc.template_versions:{id,template_id}:r'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_version_content_postflight_foreign_key_mismatch';
    END IF;

    FOREACH object_name IN ARRAY new_tables LOOP
        IF pg_get_userbyid(
            (SELECT relowner FROM pg_class WHERE oid = object_name::regclass)
        ) IS DISTINCT FROM migration_owner_role
           OR EXISTS (
               SELECT 1
               FROM pg_class
               WHERE oid = object_name::regclass
                 AND (relpersistence <> 'p' OR relrowsecurity OR relforcerowsecurity)
           )
           OR EXISTS (
               SELECT 1
               FROM pg_policy
               WHERE polrelid = object_name::regclass
           ) THEN
            RAISE EXCEPTION 'storecalc_version_content_postflight_table_security_mismatch';
        END IF;
    END LOOP;

    FOREACH object_name IN ARRAY new_sequences LOOP
        IF pg_get_userbyid(
            (SELECT relowner FROM pg_class WHERE oid = object_name::regclass)
        ) IS DISTINCT FROM migration_owner_role
           OR pg_get_serial_sequence(
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
            RAISE EXCEPTION 'storecalc_version_content_postflight_sequence_mismatch';
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
            'version_categories_version_topology_lock_trigger',
            'version_categories_content_mutability_trigger',
            'version_items_version_topology_lock_trigger',
            'version_items_content_mutability_trigger'
        ]
    )
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgqual IS NULL;

    IF actual_triggers IS DISTINCT FROM ARRAY[
        'version_categories_content_mutability_trigger:version_categories:assert_version_content_mutable:O:31',
        'version_categories_version_topology_lock_trigger:version_categories:lock_template_version_topology:O:30',
        'version_items_content_mutability_trigger:version_items:assert_version_content_mutable:O:31',
        'version_items_version_topology_lock_trigger:version_items:lock_template_version_topology:O:30'
    ]::text[]
       OR (
           SELECT count(*)
           FROM pg_trigger AS trigger_row
           JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid
           WHERE relation.relnamespace = 'storecalc'::regnamespace
             AND NOT trigger_row.tgisinternal
       ) <> 32
       OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'storecalc'::regnamespace) <> 14
       OR NOT EXISTS (
           SELECT 1
           FROM pg_proc AS procedure
           JOIN pg_language AS language ON language.oid = procedure.prolang
           WHERE procedure.oid = 'storecalc.assert_version_content_mutable()'::regprocedure
             AND language.lanname = 'plpgsql'
             AND procedure.prorettype = 'trigger'::regtype
             AND procedure.pronargs = 0
             AND procedure.prosecdef
             AND procedure.provolatile = 'v'
             AND procedure.proconfig = ARRAY['search_path=pg_catalog, storecalc']
             AND pg_get_userbyid(procedure.proowner) = migration_owner_role
             AND md5(procedure.prosrc) = 'a51e17e52e4398b1a16092290e5fda94'
       ) THEN
        RAISE EXCEPTION 'storecalc_version_content_postflight_function_or_trigger_mismatch';
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
        RAISE EXCEPTION 'storecalc_version_content_postflight_unexpected_grantee';
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
            RAISE EXCEPTION 'storecalc_version_content_postflight_table_grant_mismatch';
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
            RAISE EXCEPTION 'storecalc_version_content_postflight_sequence_grant_mismatch';
        END IF;
    END LOOP;

    IF has_function_privilege(
        web_role,
        'storecalc.assert_version_content_mutable()',
        'EXECUTE'
    ) OR has_function_privilege(
        worker_role,
        'storecalc.assert_version_content_mutable()',
        'EXECUTE'
    ) OR has_function_privilege(
        backup_role,
        'storecalc.assert_version_content_mutable()',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'storecalc_version_content_postflight_function_grant_mismatch';
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
        '3:anonymous.calculation:5:f:0008_tax_rules',
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
       ) THEN
        RAISE EXCEPTION 'storecalc_version_content_postflight_capability_or_seed_mismatch';
    END IF;
END
$storecalc_version_content_postflight$;

DO $storecalc_spending_buckets_postflight$
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
        'storecalc.version_spending_buckets',
        'storecalc.version_item_bucket_memberships'
    ];
    new_sequences constant text[] := ARRAY[
        'storecalc.version_spending_buckets_id_seq'
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
              'version_spending_buckets',
              'version_spending_buckets_id_seq',
              'version_spending_buckets_pkey',
              'version_spending_buckets_id_version_key',
              'version_spending_buckets_version_stable_key_key',
              'version_spending_buckets_version_sort_idx',
              'version_spending_buckets_primary_display_key',
              'version_item_bucket_memberships',
              'version_item_bucket_memberships_pkey',
              'version_item_bucket_memberships_version_item_lineage_idx',
              'version_item_bucket_memberships_bucket_lineage_idx',
              'version_item_bucket_memberships_primary_display_key'
          ]
      );

    IF actual_relations IS DISTINCT FROM ARRAY[
        'version_item_bucket_memberships:r',
        'version_item_bucket_memberships_bucket_lineage_idx:i',
        'version_item_bucket_memberships_pkey:i',
        'version_item_bucket_memberships_primary_display_key:i',
        'version_item_bucket_memberships_version_item_lineage_idx:i',
        'version_spending_buckets:r',
        'version_spending_buckets_id_seq:S',
        'version_spending_buckets_id_version_key:i',
        'version_spending_buckets_pkey:i',
        'version_spending_buckets_primary_display_key:i',
        'version_spending_buckets_version_sort_idx:i',
        'version_spending_buckets_version_stable_key_key:i'
    ]::text[]
       OR (SELECT count(*) FROM pg_class WHERE relnamespace = 'storecalc'::regnamespace) <> 127 THEN
        RAISE EXCEPTION 'storecalc_spending_buckets_postflight_relation_mismatch';
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
          ARRAY[
              'version_spending_buckets',
              'version_item_bucket_memberships'
          ]
      );

    IF actual_columns IS DISTINCT FROM ARRAY[
        'version_item_bucket_memberships:version_item_id:integer:NO::',
        'version_item_bucket_memberships:version_id:integer:NO::',
        'version_item_bucket_memberships:spending_bucket_id:integer:NO::',
        'version_item_bucket_memberships:membership_type:text:NO::',
        'version_item_bucket_memberships:primary_display:boolean:NO::',
        'version_spending_buckets:id:integer:NO:BY DEFAULT:',
        'version_spending_buckets:version_id:integer:NO::',
        'version_spending_buckets:stable_key:text:NO::',
        'version_spending_buckets:display_name:text:NO::',
        'version_spending_buckets:limit_state:text:NO::',
        'version_spending_buckets:limit_minor:bigint:YES::',
        'version_spending_buckets:measure_currency_code:text:NO::',
        'version_spending_buckets:is_primary_display:boolean:NO::',
        'version_spending_buckets:sort_order:integer:NO::'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_spending_buckets_postflight_column_mismatch';
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
          ARRAY[
              'version_spending_buckets',
              'version_item_bucket_memberships'
          ]
      );

    IF actual_constraints IS DISTINCT FROM ARRAY[
        'version_item_bucket_memberships:version_item_bucket_memberships_membership_type_check:c',
        'version_item_bucket_memberships:version_item_bucket_memberships_pkey:p',
        'version_item_bucket_memberships:version_item_bucket_memberships_spending_bucket_version_fkey:f',
        'version_item_bucket_memberships:version_item_bucket_memberships_version_item_fkey:f',
        'version_spending_buckets:version_spending_buckets_display_name_check:c',
        'version_spending_buckets:version_spending_buckets_id_version_key:u',
        'version_spending_buckets:version_spending_buckets_limit_nullability_check:c',
        'version_spending_buckets:version_spending_buckets_limit_state_check:c',
        'version_spending_buckets:version_spending_buckets_measure_currency_code_check:c',
        'version_spending_buckets:version_spending_buckets_pkey:p',
        'version_spending_buckets:version_spending_buckets_sort_order_check:c',
        'version_spending_buckets:version_spending_buckets_stable_key_check:c',
        'version_spending_buckets:version_spending_buckets_version_id_fkey:f',
        'version_spending_buckets:version_spending_buckets_version_stable_key_key:u'
    ]::text[]
       OR EXISTS (
           SELECT 1
           FROM pg_constraint AS constraint_row
           JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
           WHERE relation.relnamespace = 'storecalc'::regnamespace
             AND relation.relname = ANY (
                 ARRAY[
                     'version_spending_buckets',
                     'version_item_bucket_memberships'
                 ]
             )
             AND (
                 NOT constraint_row.convalidated
                 OR constraint_row.condeferrable
                 OR constraint_row.condeferred
             )
       ) THEN
        RAISE EXCEPTION 'storecalc_spending_buckets_postflight_constraint_mismatch';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.version_spending_buckets'::regclass
          AND conname = 'version_spending_buckets_limit_nullability_check'
          AND pg_get_constraintdef(oid) = 'CHECK ((((limit_state = ''known''::text) AND (limit_minor IS NOT NULL) AND (limit_minor >= 0)) OR ((limit_state = ANY (ARRAY[''unlimited''::text, ''not_applicable''::text, ''unknown''::text, ''unsupported''::text])) AND (limit_minor IS NULL))))'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.version_spending_buckets'::regclass
          AND conname = 'version_spending_buckets_version_stable_key_key'
          AND pg_get_constraintdef(oid) = 'UNIQUE (version_id, stable_key)'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.version_item_bucket_memberships'::regclass
          AND conname = 'version_item_bucket_memberships_membership_type_check'
          AND pg_get_constraintdef(oid) = 'CHECK ((membership_type = ANY (ARRAY[''counts_toward''::text, ''excluded''::text, ''informational_only''::text])))'
    ) THEN
        RAISE EXCEPTION 'storecalc_spending_buckets_postflight_constraint_definition_mismatch';
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
              'version_spending_buckets_pkey',
              'version_spending_buckets_id_version_key',
              'version_spending_buckets_version_stable_key_key',
              'version_spending_buckets_version_sort_idx',
              'version_spending_buckets_primary_display_key',
              'version_item_bucket_memberships_pkey',
              'version_item_bucket_memberships_version_item_lineage_idx',
              'version_item_bucket_memberships_bucket_lineage_idx',
              'version_item_bucket_memberships_primary_display_key'
          ]
      );

    IF actual_indexes IS DISTINCT FROM ARRAY[
        'version_item_bucket_memberships_bucket_lineage_idx:CREATE INDEX version_item_bucket_memberships_bucket_lineage_idx ON storecalc.version_item_bucket_memberships USING btree (spending_bucket_id, version_id, version_item_id)',
        'version_item_bucket_memberships_pkey:CREATE UNIQUE INDEX version_item_bucket_memberships_pkey ON storecalc.version_item_bucket_memberships USING btree (version_item_id, spending_bucket_id)',
        'version_item_bucket_memberships_primary_display_key:CREATE UNIQUE INDEX version_item_bucket_memberships_primary_display_key ON storecalc.version_item_bucket_memberships USING btree (version_item_id) WHERE primary_display',
        'version_item_bucket_memberships_version_item_lineage_idx:CREATE INDEX version_item_bucket_memberships_version_item_lineage_idx ON storecalc.version_item_bucket_memberships USING btree (version_item_id, version_id, spending_bucket_id)',
        'version_spending_buckets_id_version_key:CREATE UNIQUE INDEX version_spending_buckets_id_version_key ON storecalc.version_spending_buckets USING btree (id, version_id)',
        'version_spending_buckets_pkey:CREATE UNIQUE INDEX version_spending_buckets_pkey ON storecalc.version_spending_buckets USING btree (id)',
        'version_spending_buckets_primary_display_key:CREATE UNIQUE INDEX version_spending_buckets_primary_display_key ON storecalc.version_spending_buckets USING btree (version_id) WHERE is_primary_display',
        'version_spending_buckets_version_sort_idx:CREATE INDEX version_spending_buckets_version_sort_idx ON storecalc.version_spending_buckets USING btree (version_id, sort_order, stable_key, id)',
        'version_spending_buckets_version_stable_key_key:CREATE UNIQUE INDEX version_spending_buckets_version_stable_key_key ON storecalc.version_spending_buckets USING btree (version_id, stable_key)'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_spending_buckets_postflight_index_mismatch';
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
          ARRAY[
              'version_spending_buckets',
              'version_item_bucket_memberships'
          ]
      );

    IF actual_foreign_keys IS DISTINCT FROM ARRAY[
        'version_item_bucket_memberships_spending_bucket_version_fkey:storecalc.version_item_bucket_memberships:{spending_bucket_id,version_id}:storecalc.version_spending_buckets:{id,version_id}:r',
        'version_item_bucket_memberships_version_item_fkey:storecalc.version_item_bucket_memberships:{version_item_id,version_id}:storecalc.version_items:{id,version_id}:r',
        'version_spending_buckets_version_id_fkey:storecalc.version_spending_buckets:{version_id}:storecalc.template_versions:{id}:r'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_spending_buckets_postflight_foreign_key_mismatch';
    END IF;

    FOREACH object_name IN ARRAY new_tables LOOP
        IF pg_get_userbyid(
            (SELECT relowner FROM pg_class WHERE oid = object_name::regclass)
        ) IS DISTINCT FROM migration_owner_role
           OR EXISTS (
               SELECT 1
               FROM pg_class
               WHERE oid = object_name::regclass
                 AND (relpersistence <> 'p' OR relrowsecurity OR relforcerowsecurity)
           )
           OR EXISTS (
               SELECT 1
               FROM pg_policy
               WHERE polrelid = object_name::regclass
           ) THEN
            RAISE EXCEPTION 'storecalc_spending_buckets_postflight_table_security_mismatch';
        END IF;
    END LOOP;

    FOREACH object_name IN ARRAY new_sequences LOOP
        IF pg_get_userbyid(
            (SELECT relowner FROM pg_class WHERE oid = object_name::regclass)
        ) IS DISTINCT FROM migration_owner_role
           OR pg_get_serial_sequence(
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
            RAISE EXCEPTION 'storecalc_spending_buckets_postflight_sequence_mismatch';
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
            'version_spending_buckets_version_topology_lock_trigger',
            'version_spending_buckets_content_mutability_trigger',
            'version_item_bucket_memberships_version_topology_lock_trigger',
            'version_item_bucket_memberships_content_mutability_trigger'
        ]
    )
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgqual IS NULL;

    IF actual_triggers IS DISTINCT FROM ARRAY[
        'version_item_bucket_memberships_content_mutability_trigger:version_item_bucket_memberships:assert_version_content_mutable:O:31',
        'version_item_bucket_memberships_version_topology_lock_trigger:version_item_bucket_memberships:lock_template_version_topology:O:30',
        'version_spending_buckets_content_mutability_trigger:version_spending_buckets:assert_version_content_mutable:O:31',
        'version_spending_buckets_version_topology_lock_trigger:version_spending_buckets:lock_template_version_topology:O:30'
    ]::text[]
       OR (
           SELECT count(*)
           FROM pg_trigger AS trigger_row
           JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid
           WHERE relation.relnamespace = 'storecalc'::regnamespace
             AND NOT trigger_row.tgisinternal
       ) <> 32
       OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'storecalc'::regnamespace) <> 14 THEN
        RAISE EXCEPTION 'storecalc_spending_buckets_postflight_trigger_mismatch';
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
        RAISE EXCEPTION 'storecalc_spending_buckets_postflight_unexpected_grantee';
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
            RAISE EXCEPTION 'storecalc_spending_buckets_postflight_table_grant_mismatch';
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
            RAISE EXCEPTION 'storecalc_spending_buckets_postflight_sequence_grant_mismatch';
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
        '3:anonymous.calculation:5:f:0008_tax_rules',
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
       ) THEN
        RAISE EXCEPTION 'storecalc_spending_buckets_postflight_capability_or_seed_mismatch';
    END IF;
END
$storecalc_spending_buckets_postflight$;

DO $storecalc_tax_rules_postflight$
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
        'storecalc.version_tax_rules'
    ];
    new_sequences constant text[] := ARRAY[
        'storecalc.version_tax_rules_id_seq'
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
              'version_tax_rules',
              'version_tax_rules_id_seq',
              'version_tax_rules_pkey',
              'version_tax_rules_id_version_key',
              'version_tax_rules_version_resolution_idx',
              'version_tax_rules_template_priority_key',
              'version_tax_rules_category_priority_key',
              'version_tax_rules_item_priority_key'
          ]
      );

    IF actual_relations IS DISTINCT FROM ARRAY[
        'version_tax_rules:r',
        'version_tax_rules_category_priority_key:i',
        'version_tax_rules_id_seq:S',
        'version_tax_rules_id_version_key:i',
        'version_tax_rules_item_priority_key:i',
        'version_tax_rules_pkey:i',
        'version_tax_rules_template_priority_key:i',
        'version_tax_rules_version_resolution_idx:i'
    ]::text[]
       OR (SELECT count(*) FROM pg_class WHERE relnamespace = 'storecalc'::regnamespace) <> 127 THEN
        RAISE EXCEPTION 'storecalc_tax_rules_postflight_relation_mismatch';
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
      AND column_row.table_name = 'version_tax_rules';

    IF actual_columns IS DISTINCT FROM ARRAY[
        'version_tax_rules:id:integer:NO:BY DEFAULT:',
        'version_tax_rules:version_id:integer:NO::',
        'version_tax_rules:scope_type:text:NO::',
        'version_tax_rules:category_version_id:integer:YES::',
        'version_tax_rules:item_version_id:integer:YES::',
        'version_tax_rules:treatment_state:text:NO::',
        'version_tax_rules:rate_ppm:integer:YES::',
        'version_tax_rules:price_includes_tax:boolean:YES::',
        'version_tax_rules:rounding_mode:text:YES::',
        'version_tax_rules:rounding_scope:text:YES::',
        'version_tax_rules:priority:integer:NO::',
        'version_tax_rules:created_at:timestamp with time zone:NO::transaction_timestamp()'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_tax_rules_postflight_column_mismatch';
    END IF;

    SELECT array_agg(
        format('%s:%s', constraint_row.conname, constraint_row.contype)
        ORDER BY constraint_row.conname
    )
    INTO actual_constraints
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'storecalc.version_tax_rules'::regclass;

    IF actual_constraints IS DISTINCT FROM ARRAY[
        'version_tax_rules_category_version_fkey:f',
        'version_tax_rules_id_version_key:u',
        'version_tax_rules_item_version_fkey:f',
        'version_tax_rules_pkey:p',
        'version_tax_rules_priority_check:c',
        'version_tax_rules_rate_ppm_check:c',
        'version_tax_rules_rounding_mode_check:c',
        'version_tax_rules_rounding_scope_check:c',
        'version_tax_rules_scope_target_check:c',
        'version_tax_rules_scope_type_check:c',
        'version_tax_rules_treatment_nullability_check:c',
        'version_tax_rules_treatment_state_check:c',
        'version_tax_rules_version_id_fkey:f'
    ]::text[]
       OR EXISTS (
           SELECT 1
           FROM pg_constraint
           WHERE conrelid = 'storecalc.version_tax_rules'::regclass
             AND (NOT convalidated OR condeferrable OR condeferred)
       ) THEN
        RAISE EXCEPTION 'storecalc_tax_rules_postflight_constraint_mismatch';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.version_tax_rules'::regclass
          AND conname = 'version_tax_rules_scope_target_check'
          AND pg_get_constraintdef(oid) = 'CHECK ((((scope_type = ''template''::text) AND (category_version_id IS NULL) AND (item_version_id IS NULL)) OR ((scope_type = ''category''::text) AND (category_version_id IS NOT NULL) AND (item_version_id IS NULL)) OR ((scope_type = ''item''::text) AND (category_version_id IS NULL) AND (item_version_id IS NOT NULL))))'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.version_tax_rules'::regclass
          AND conname = 'version_tax_rules_treatment_nullability_check'
          AND pg_get_constraintdef(oid) = 'CHECK ((((treatment_state = ''known''::text) AND (rate_ppm IS NOT NULL) AND (price_includes_tax IS NOT NULL) AND (rounding_mode IS NOT NULL) AND (rounding_scope IS NOT NULL)) OR ((treatment_state <> ''known''::text) AND (rate_ppm IS NULL) AND (price_includes_tax IS NULL) AND (rounding_mode IS NULL) AND (rounding_scope IS NULL))))'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.version_tax_rules'::regclass
          AND conname = 'version_tax_rules_rate_ppm_check'
          AND pg_get_constraintdef(oid) = 'CHECK (((rate_ppm IS NULL) OR ((rate_ppm >= 0) AND (rate_ppm <= 1000000))))'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.version_tax_rules'::regclass
          AND conname = 'version_tax_rules_id_version_key'
          AND pg_get_constraintdef(oid) = 'UNIQUE (id, version_id)'
    ) THEN
        RAISE EXCEPTION 'storecalc_tax_rules_postflight_constraint_definition_mismatch';
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
              'version_tax_rules_pkey',
              'version_tax_rules_id_version_key',
              'version_tax_rules_version_resolution_idx',
              'version_tax_rules_template_priority_key',
              'version_tax_rules_category_priority_key',
              'version_tax_rules_item_priority_key'
          ]
      );

    IF actual_indexes IS DISTINCT FROM ARRAY[
        'version_tax_rules_category_priority_key:CREATE UNIQUE INDEX version_tax_rules_category_priority_key ON storecalc.version_tax_rules USING btree (version_id, category_version_id, priority) WHERE (scope_type = ''category''::text)',
        'version_tax_rules_id_version_key:CREATE UNIQUE INDEX version_tax_rules_id_version_key ON storecalc.version_tax_rules USING btree (id, version_id)',
        'version_tax_rules_item_priority_key:CREATE UNIQUE INDEX version_tax_rules_item_priority_key ON storecalc.version_tax_rules USING btree (version_id, item_version_id, priority) WHERE (scope_type = ''item''::text)',
        'version_tax_rules_pkey:CREATE UNIQUE INDEX version_tax_rules_pkey ON storecalc.version_tax_rules USING btree (id)',
        'version_tax_rules_template_priority_key:CREATE UNIQUE INDEX version_tax_rules_template_priority_key ON storecalc.version_tax_rules USING btree (version_id, priority) WHERE (scope_type = ''template''::text)',
        'version_tax_rules_version_resolution_idx:CREATE INDEX version_tax_rules_version_resolution_idx ON storecalc.version_tax_rules USING btree (version_id, priority DESC, scope_type, id)'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_tax_rules_postflight_index_mismatch';
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
      AND source_relation.oid = 'storecalc.version_tax_rules'::regclass;

    IF actual_foreign_keys IS DISTINCT FROM ARRAY[
        'version_tax_rules_category_version_fkey:storecalc.version_tax_rules:{category_version_id,version_id}:storecalc.version_categories:{id,version_id}:r',
        'version_tax_rules_item_version_fkey:storecalc.version_tax_rules:{item_version_id,version_id}:storecalc.version_items:{id,version_id}:r',
        'version_tax_rules_version_id_fkey:storecalc.version_tax_rules:{version_id}:storecalc.template_versions:{id}:r'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_tax_rules_postflight_foreign_key_mismatch';
    END IF;

    FOREACH object_name IN ARRAY new_tables LOOP
        IF pg_get_userbyid(
            (SELECT relowner FROM pg_class WHERE oid = object_name::regclass)
        ) IS DISTINCT FROM migration_owner_role
           OR EXISTS (
               SELECT 1
               FROM pg_class
               WHERE oid = object_name::regclass
                 AND (relpersistence <> 'p' OR relrowsecurity OR relforcerowsecurity)
           )
           OR EXISTS (
               SELECT 1
               FROM pg_policy
               WHERE polrelid = object_name::regclass
           ) THEN
            RAISE EXCEPTION 'storecalc_tax_rules_postflight_table_security_mismatch';
        END IF;
    END LOOP;

    FOREACH object_name IN ARRAY new_sequences LOOP
        IF pg_get_userbyid(
            (SELECT relowner FROM pg_class WHERE oid = object_name::regclass)
        ) IS DISTINCT FROM migration_owner_role
           OR pg_get_serial_sequence(
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
            RAISE EXCEPTION 'storecalc_tax_rules_postflight_sequence_mismatch';
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
            'version_tax_rules_version_topology_lock_trigger',
            'version_tax_rules_content_mutability_trigger'
        ]
    )
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgqual IS NULL;

    IF actual_triggers IS DISTINCT FROM ARRAY[
        'version_tax_rules_content_mutability_trigger:version_tax_rules:assert_version_content_mutable:O:31',
        'version_tax_rules_version_topology_lock_trigger:version_tax_rules:lock_template_version_topology:O:30'
    ]::text[]
       OR (
           SELECT count(*)
           FROM pg_trigger AS trigger_row
           JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid
           WHERE relation.relnamespace = 'storecalc'::regnamespace
             AND NOT trigger_row.tgisinternal
       ) <> 32
       OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'storecalc'::regnamespace) <> 14 THEN
        RAISE EXCEPTION 'storecalc_tax_rules_postflight_trigger_mismatch';
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
        RAISE EXCEPTION 'storecalc_tax_rules_postflight_unexpected_grantee';
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
            RAISE EXCEPTION 'storecalc_tax_rules_postflight_table_grant_mismatch';
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
            RAISE EXCEPTION 'storecalc_tax_rules_postflight_sequence_grant_mismatch';
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
        '3:anonymous.calculation:5:f:0008_tax_rules',
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
       ) THEN
        RAISE EXCEPTION 'storecalc_tax_rules_postflight_capability_or_seed_mismatch';
    END IF;
END
$storecalc_tax_rules_postflight$;

COMMIT;
