BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

SELECT pg_advisory_xact_lock(7356507374803211041);

DO $storecalc_directory_verify$
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
    actual_columns text[];
    actual_constraints text[];
    actual_indexes text[];
    actual_foreign_keys text[];
    actual_triggers text[];
    actual_capabilities text[];
    object_name text;
    table_name text;
    expected_sequence text;
    expected_relations constant text[] := ARRAY[
        'agencies:r',
        'agencies_country_name_idx:i',
        'agencies_governing_country_idx:i',
        'agencies_id_country_key:i',
        'agencies_id_seq:S',
        'agencies_pkey:i',
        'contributor_subjects:r',
        'contributor_subjects_id_seq:S',
        'contributor_subjects_pkey:i',
        'contributor_subjects_user_id_key:i',
        'countries:r',
        'countries_code_alpha2_key:i',
        'countries_code_alpha3_key:i',
        'countries_id_seq:S',
        'countries_pkey:i',
        'facilities:r',
        'facilities_agency_country_idx:i',
        'facilities_country_name_idx:i',
        'facilities_created_by_subject_idx:i',
        'facilities_id_country_key:i',
        'facilities_id_seq:S',
        'facilities_jurisdiction_country_idx:i',
        'facilities_merge_idx:i',
        'facilities_owner_idx:i',
        'facilities_pkey:i',
        'facilities_timezone_idx:i',
        'facility_aliases:r',
        'facility_aliases_id_seq:S',
        'facility_aliases_identity_key:i',
        'facility_aliases_pkey:i',
        'facility_aliases_search_idx:i',
        'facility_sources:r',
        'facility_sources_facility_checked_idx:i',
        'facility_sources_facility_url_key:i',
        'facility_sources_id_seq:S',
        'facility_sources_pkey:i',
        'jurisdictions:r',
        'jurisdictions_country_name_idx:i',
        'jurisdictions_id_country_key:i',
        'jurisdictions_id_seq:S',
        'jurisdictions_parent_country_idx:i',
        'jurisdictions_pkey:i',
        'reviewed_timezones:r',
        'reviewed_timezones_pkey:i',
        'schema_capabilities:r',
        'schema_capabilities_capability_key_key:i',
        'schema_capabilities_id_seq:S',
        'schema_capabilities_pkey:i'
    ];
    expected_columns constant text[] := ARRAY[
        'agencies:id:integer:NO:BY DEFAULT:',
        'agencies:country_id:integer:NO::',
        'agencies:governing_jurisdiction_id:integer:YES::',
        'agencies:official_name:text:NO::',
        'agencies:native_name:text:YES::',
        'agencies:agency_type:text:YES::',
        'agencies:status:text:NO::',
        'agencies:official_url:text:YES::',
        'contributor_subjects:id:integer:NO:BY DEFAULT:',
        'contributor_subjects:user_id:integer:YES::',
        'contributor_subjects:subject_generation:integer:NO::1',
        'contributor_subjects:status:text:NO::',
        'contributor_subjects:created_at:timestamp with time zone:NO::transaction_timestamp()',
        'contributor_subjects:anonymized_at:timestamp with time zone:YES::',
        'countries:id:integer:NO:BY DEFAULT:',
        'countries:code_alpha2:text:NO::',
        'countries:code_alpha3:text:YES::',
        'countries:official_name:text:NO::',
        'countries:native_name:text:YES::',
        'countries:support_status:text:NO::',
        'countries:active:boolean:NO::',
        'countries:created_at:timestamp with time zone:NO::transaction_timestamp()',
        'countries:updated_at:timestamp with time zone:NO::transaction_timestamp()',
        'facilities:id:integer:NO:BY DEFAULT:',
        'facilities:physical_country_id:integer:NO::',
        'facilities:physical_jurisdiction_id:integer:YES::',
        'facilities:agency_id:integer:YES::',
        'facilities:record_scope:text:NO::',
        'facilities:owner_user_id:integer:YES::',
        'facilities:official_name:text:NO::',
        'facilities:native_name:text:YES::',
        'facilities:facility_type:text:YES::',
        'facilities:locality:text:YES::',
        'facilities:timezone_name:text:YES::',
        'facilities:status:text:NO::',
        'facilities:merged_into_facility_id:integer:YES::',
        'facilities:created_by_subject_id:integer:YES::',
        'facilities:created_at:timestamp with time zone:NO::transaction_timestamp()',
        'facilities:updated_at:timestamp with time zone:NO::transaction_timestamp()',
        'facilities:lifecycle_generation:integer:NO::1',
        'facility_aliases:id:integer:NO:BY DEFAULT:',
        'facility_aliases:facility_id:integer:NO::',
        'facility_aliases:alias:text:NO::',
        'facility_aliases:normalized_alias:text:NO::',
        'facility_aliases:alias_type:text:NO::',
        'facility_aliases:language_tag:text:YES::',
        'facility_aliases:created_at:timestamp with time zone:NO::transaction_timestamp()',
        'facility_aliases:retired_at:timestamp with time zone:YES::',
        'facility_sources:id:integer:NO:BY DEFAULT:',
        'facility_sources:facility_id:integer:NO::',
        'facility_sources:source_type:text:NO::',
        'facility_sources:source_url:text:NO::',
        'facility_sources:source_title:text:NO::',
        'facility_sources:source_date:date:YES::',
        'facility_sources:last_checked_at:timestamp with time zone:YES::',
        'facility_sources:last_seen_at:timestamp with time zone:YES::',
        'facility_sources:content_hash:text:YES::',
        'facility_sources:created_at:timestamp with time zone:NO::transaction_timestamp()',
        'jurisdictions:id:integer:NO:BY DEFAULT:',
        'jurisdictions:country_id:integer:NO::',
        'jurisdictions:parent_jurisdiction_id:integer:YES::',
        'jurisdictions:jurisdiction_type:text:NO::',
        'jurisdictions:official_name:text:NO::',
        'jurisdictions:native_name:text:YES::',
        'jurisdictions:code:text:YES::',
        'jurisdictions:active:boolean:NO::',
        'reviewed_timezones:timezone_name:text:NO::',
        'reviewed_timezones:active:boolean:NO::true',
        'reviewed_timezones:reviewed_at:timestamp with time zone:NO::transaction_timestamp()'
    ];
    expected_constraints constant text[] := ARRAY[
        'agencies:agencies_country_id_fkey:f',
        'agencies:agencies_governing_country_fkey:f',
        'agencies:agencies_id_country_key:u',
        'agencies:agencies_native_name_check:c',
        'agencies:agencies_official_name_check:c',
        'agencies:agencies_official_url_check:c',
        'agencies:agencies_pkey:p',
        'agencies:agencies_status_format_check:c',
        'agencies:agencies_type_format_check:c',
        'contributor_subjects:contributor_subjects_anonymized_state_check:c',
        'contributor_subjects:contributor_subjects_generation_check:c',
        'contributor_subjects:contributor_subjects_pkey:p',
        'contributor_subjects:contributor_subjects_status_format_check:c',
        'contributor_subjects:contributor_subjects_user_id_fkey:f',
        'contributor_subjects:contributor_subjects_user_id_key:u',
        'countries:countries_code_alpha2_format_check:c',
        'countries:countries_code_alpha2_key:u',
        'countries:countries_code_alpha3_format_check:c',
        'countries:countries_code_alpha3_key:u',
        'countries:countries_native_name_check:c',
        'countries:countries_official_name_check:c',
        'countries:countries_pkey:p',
        'countries:countries_support_status_check:c',
        'countries:countries_timestamp_order_check:c',
        'facilities:facilities_agency_country_fkey:f',
        'facilities:facilities_country_id_fkey:f',
        'facilities:facilities_created_by_subject_fkey:f',
        'facilities:facilities_generation_check:c',
        'facilities:facilities_id_country_key:u',
        'facilities:facilities_jurisdiction_country_fkey:f',
        'facilities:facilities_locality_check:c',
        'facilities:facilities_merge_state_check:c',
        'facilities:facilities_merged_into_fkey:f',
        'facilities:facilities_native_name_check:c',
        'facilities:facilities_official_name_check:c',
        'facilities:facilities_owner_user_id_fkey:f',
        'facilities:facilities_pkey:p',
        'facilities:facilities_provisional_scope_check:c',
        'facilities:facilities_scope_check:c',
        'facilities:facilities_scope_owner_check:c',
        'facilities:facilities_status_check:c',
        'facilities:facilities_timestamp_order_check:c',
        'facilities:facilities_timezone_name_fkey:f',
        'facilities:facilities_type_format_check:c',
        'facility_aliases:facility_aliases_alias_check:c',
        'facility_aliases:facility_aliases_facility_id_fkey:f',
        'facility_aliases:facility_aliases_language_tag_check:c',
        'facility_aliases:facility_aliases_normalized_check:c',
        'facility_aliases:facility_aliases_pkey:p',
        'facility_aliases:facility_aliases_retired_order_check:c',
        'facility_aliases:facility_aliases_type_format_check:c',
        'facility_sources:facility_sources_check_order_check:c',
        'facility_sources:facility_sources_content_hash_check:c',
        'facility_sources:facility_sources_facility_id_fkey:f',
        'facility_sources:facility_sources_facility_url_key:u',
        'facility_sources:facility_sources_pkey:p',
        'facility_sources:facility_sources_title_check:c',
        'facility_sources:facility_sources_type_format_check:c',
        'facility_sources:facility_sources_url_check:c',
        'jurisdictions:jurisdictions_code_check:c',
        'jurisdictions:jurisdictions_country_id_fkey:f',
        'jurisdictions:jurisdictions_id_country_key:u',
        'jurisdictions:jurisdictions_native_name_check:c',
        'jurisdictions:jurisdictions_official_name_check:c',
        'jurisdictions:jurisdictions_parent_country_fkey:f',
        'jurisdictions:jurisdictions_parent_not_self_check:c',
        'jurisdictions:jurisdictions_pkey:p',
        'jurisdictions:jurisdictions_type_format_check:c',
        'reviewed_timezones:reviewed_timezones_name_format_check:c',
        'reviewed_timezones:reviewed_timezones_pkey:p'
    ];
    expected_indexes constant text[] := ARRAY[
        'agencies_country_name_idx:CREATE INDEX agencies_country_name_idx ON storecalc.agencies USING btree (country_id, official_name)',
        'agencies_governing_country_idx:CREATE INDEX agencies_governing_country_idx ON storecalc.agencies USING btree (governing_jurisdiction_id, country_id) WHERE (governing_jurisdiction_id IS NOT NULL)',
        'agencies_id_country_key:CREATE UNIQUE INDEX agencies_id_country_key ON storecalc.agencies USING btree (id, country_id)',
        'agencies_pkey:CREATE UNIQUE INDEX agencies_pkey ON storecalc.agencies USING btree (id)',
        'contributor_subjects_pkey:CREATE UNIQUE INDEX contributor_subjects_pkey ON storecalc.contributor_subjects USING btree (id)',
        'contributor_subjects_user_id_key:CREATE UNIQUE INDEX contributor_subjects_user_id_key ON storecalc.contributor_subjects USING btree (user_id)',
        'countries_code_alpha2_key:CREATE UNIQUE INDEX countries_code_alpha2_key ON storecalc.countries USING btree (code_alpha2)',
        'countries_code_alpha3_key:CREATE UNIQUE INDEX countries_code_alpha3_key ON storecalc.countries USING btree (code_alpha3)',
        'countries_pkey:CREATE UNIQUE INDEX countries_pkey ON storecalc.countries USING btree (id)',
        'facilities_agency_country_idx:CREATE INDEX facilities_agency_country_idx ON storecalc.facilities USING btree (agency_id, physical_country_id) WHERE (agency_id IS NOT NULL)',
        'facilities_country_name_idx:CREATE INDEX facilities_country_name_idx ON storecalc.facilities USING btree (physical_country_id, official_name)',
        'facilities_created_by_subject_idx:CREATE INDEX facilities_created_by_subject_idx ON storecalc.facilities USING btree (created_by_subject_id) WHERE (created_by_subject_id IS NOT NULL)',
        'facilities_id_country_key:CREATE UNIQUE INDEX facilities_id_country_key ON storecalc.facilities USING btree (id, physical_country_id)',
        'facilities_jurisdiction_country_idx:CREATE INDEX facilities_jurisdiction_country_idx ON storecalc.facilities USING btree (physical_jurisdiction_id, physical_country_id) WHERE (physical_jurisdiction_id IS NOT NULL)',
        'facilities_merge_idx:CREATE INDEX facilities_merge_idx ON storecalc.facilities USING btree (merged_into_facility_id) WHERE (merged_into_facility_id IS NOT NULL)',
        'facilities_owner_idx:CREATE INDEX facilities_owner_idx ON storecalc.facilities USING btree (owner_user_id) WHERE (owner_user_id IS NOT NULL)',
        'facilities_pkey:CREATE UNIQUE INDEX facilities_pkey ON storecalc.facilities USING btree (id)',
        'facilities_timezone_idx:CREATE INDEX facilities_timezone_idx ON storecalc.facilities USING btree (timezone_name) WHERE (timezone_name IS NOT NULL)',
        'facility_aliases_identity_key:CREATE UNIQUE INDEX facility_aliases_identity_key ON storecalc.facility_aliases USING btree (facility_id, normalized_alias, alias_type, COALESCE(language_tag, ''''::text))',
        'facility_aliases_pkey:CREATE UNIQUE INDEX facility_aliases_pkey ON storecalc.facility_aliases USING btree (id)',
        'facility_aliases_search_idx:CREATE INDEX facility_aliases_search_idx ON storecalc.facility_aliases USING btree (normalized_alias, facility_id)',
        'facility_sources_facility_checked_idx:CREATE INDEX facility_sources_facility_checked_idx ON storecalc.facility_sources USING btree (facility_id, last_checked_at DESC NULLS LAST)',
        'facility_sources_facility_url_key:CREATE UNIQUE INDEX facility_sources_facility_url_key ON storecalc.facility_sources USING btree (facility_id, source_url)',
        'facility_sources_pkey:CREATE UNIQUE INDEX facility_sources_pkey ON storecalc.facility_sources USING btree (id)',
        'jurisdictions_country_name_idx:CREATE INDEX jurisdictions_country_name_idx ON storecalc.jurisdictions USING btree (country_id, official_name)',
        'jurisdictions_id_country_key:CREATE UNIQUE INDEX jurisdictions_id_country_key ON storecalc.jurisdictions USING btree (id, country_id)',
        'jurisdictions_parent_country_idx:CREATE INDEX jurisdictions_parent_country_idx ON storecalc.jurisdictions USING btree (parent_jurisdiction_id, country_id) WHERE (parent_jurisdiction_id IS NOT NULL)',
        'jurisdictions_pkey:CREATE UNIQUE INDEX jurisdictions_pkey ON storecalc.jurisdictions USING btree (id)',
        'reviewed_timezones_pkey:CREATE UNIQUE INDEX reviewed_timezones_pkey ON storecalc.reviewed_timezones USING btree (timezone_name)'
    ];
    expected_foreign_keys constant text[] := ARRAY[
        'agencies_country_id_fkey:storecalc.agencies:{country_id}:storecalc.countries:{id}:r',
        'agencies_governing_country_fkey:storecalc.agencies:{governing_jurisdiction_id,country_id}:storecalc.jurisdictions:{id,country_id}:r',
        'contributor_subjects_user_id_fkey:storecalc.contributor_subjects:{user_id}:public.users:{id}:n',
        'facilities_agency_country_fkey:storecalc.facilities:{agency_id,physical_country_id}:storecalc.agencies:{id,country_id}:r',
        'facilities_country_id_fkey:storecalc.facilities:{physical_country_id}:storecalc.countries:{id}:r',
        'facilities_created_by_subject_fkey:storecalc.facilities:{created_by_subject_id}:storecalc.contributor_subjects:{id}:r',
        'facilities_jurisdiction_country_fkey:storecalc.facilities:{physical_jurisdiction_id,physical_country_id}:storecalc.jurisdictions:{id,country_id}:r',
        'facilities_merged_into_fkey:storecalc.facilities:{merged_into_facility_id}:storecalc.facilities:{id}:r',
        'facilities_owner_user_id_fkey:storecalc.facilities:{owner_user_id}:public.users:{id}:r',
        'facilities_timezone_name_fkey:storecalc.facilities:{timezone_name}:storecalc.reviewed_timezones:{timezone_name}:r',
        'facility_aliases_facility_id_fkey:storecalc.facility_aliases:{facility_id}:storecalc.facilities:{id}:r',
        'facility_sources_facility_id_fkey:storecalc.facility_sources:{facility_id}:storecalc.facilities:{id}:r',
        'jurisdictions_country_id_fkey:storecalc.jurisdictions:{country_id}:storecalc.countries:{id}:r',
        'jurisdictions_parent_country_fkey:storecalc.jurisdictions:{parent_jurisdiction_id,country_id}:storecalc.jurisdictions:{id,country_id}:r'
    ];
    new_tables constant text[] := ARRAY[
        'storecalc.contributor_subjects',
        'storecalc.reviewed_timezones',
        'storecalc.countries',
        'storecalc.jurisdictions',
        'storecalc.agencies',
        'storecalc.facilities',
        'storecalc.facility_aliases',
        'storecalc.facility_sources'
    ];
    identity_tables constant text[] := ARRAY[
        'storecalc.contributor_subjects',
        'storecalc.countries',
        'storecalc.jurisdictions',
        'storecalc.agencies',
        'storecalc.facilities',
        'storecalc.facility_aliases',
        'storecalc.facility_sources'
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
        RAISE EXCEPTION 'storecalc_directory_verify_role_config_invalid'
            USING ERRCODE = '22023';
    END IF;

    IF migration_owner_role <> current_user THEN
        RAISE EXCEPTION 'storecalc_directory_verify_owner_mismatch'
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
             AND (
                 rolsuper
                 OR rolcreaterole
                 OR rolcreatedb
                 OR rolreplication
                 OR rolbypassrls
             )
       ) THEN
        RAISE EXCEPTION 'storecalc_directory_verify_role_mismatch'
            USING ERRCODE = '42501';
    END IF;

    IF NOT has_database_privilege(migration_owner_role, current_database(), 'CREATE')
       OR has_database_privilege(web_role, current_database(), 'CREATE')
       OR has_database_privilege(worker_role, current_database(), 'CREATE')
       OR has_database_privilege(backup_role, current_database(), 'CREATE') THEN
        RAISE EXCEPTION 'storecalc_directory_verify_database_grant_mismatch'
            USING ERRCODE = '42501';
    END IF;

    FOREACH source_role IN ARRAY configured_roles LOOP
        FOREACH target_role IN ARRAY configured_roles LOOP
            IF source_role <> target_role
               AND pg_has_role(source_role, target_role, 'MEMBER') THEN
                RAISE EXCEPTION 'storecalc_directory_verify_role_inheritance_mismatch'
                    USING ERRCODE = '42501';
            END IF;
        END LOOP;
    END LOOP;

    IF to_regnamespace('storecalc') IS NULL
       OR to_regclass('public.users') IS NULL
       OR pg_get_userbyid(
           (SELECT nspowner FROM pg_namespace WHERE nspname = 'storecalc')
       ) IS DISTINCT FROM migration_owner_role THEN
        RAISE EXCEPTION 'storecalc_directory_verify_baseline_mismatch';
    END IF;

    SELECT array_agg(format('%s:%s', relname, relkind) ORDER BY relname)
    INTO actual_relations
    FROM pg_class
    WHERE relnamespace = 'storecalc'::regnamespace;

    IF actual_relations IS DISTINCT FROM expected_relations THEN
        RAISE EXCEPTION 'storecalc_directory_relation_definition_mismatch';
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
        RAISE EXCEPTION 'storecalc_directory_object_owner_mismatch';
    END IF;

    SELECT array_agg(
        format(
            '%s:%s:%s:%s:%s:%s',
            table_name,
            column_name,
            data_type,
            is_nullable,
            COALESCE(identity_generation, ''),
            COALESCE(column_default, '')
        )
        ORDER BY table_name, ordinal_position
    )
    INTO actual_columns
    FROM information_schema.columns
    WHERE table_schema = 'storecalc'
      AND table_name = ANY (
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

    IF actual_columns IS DISTINCT FROM expected_columns THEN
        RAISE EXCEPTION 'storecalc_directory_column_definition_mismatch';
    END IF;

    SELECT array_agg(
        format(
            '%s:%s:%s',
            relation.relname,
            constraint_row.conname,
            constraint_row.contype
        )
        ORDER BY relation.relname, constraint_row.conname
    )
    INTO actual_constraints
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS relation
      ON relation.oid = constraint_row.conrelid
    WHERE relation.relnamespace = 'storecalc'::regnamespace
      AND relation.relname <> 'schema_capabilities';

    IF actual_constraints IS DISTINCT FROM expected_constraints
       OR EXISTS (
           SELECT 1
           FROM pg_constraint AS constraint_row
           JOIN pg_class AS relation
             ON relation.oid = constraint_row.conrelid
           WHERE relation.relnamespace = 'storecalc'::regnamespace
             AND relation.relname <> 'schema_capabilities'
             AND (
                 NOT constraint_row.convalidated
                 OR constraint_row.condeferrable
                 OR constraint_row.condeferred
             )
       ) THEN
        RAISE EXCEPTION 'storecalc_directory_constraint_definition_mismatch';
    END IF;

    SELECT array_agg(
        format('%s:%s', relation.relname, pg_get_indexdef(relation.oid))
        ORDER BY relation.relname
    )
    INTO actual_indexes
    FROM pg_class AS relation
    WHERE relation.relnamespace = 'storecalc'::regnamespace
      AND relation.relkind = 'i'
      AND relation.relname <> ALL (
          ARRAY[
              'schema_capabilities_capability_key_key',
              'schema_capabilities_pkey'
          ]
      );

    IF actual_indexes IS DISTINCT FROM expected_indexes THEN
        RAISE EXCEPTION 'storecalc_directory_index_definition_mismatch';
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
      AND source_relation.relnamespace = 'storecalc'::regnamespace;

    IF actual_foreign_keys IS DISTINCT FROM expected_foreign_keys THEN
        RAISE EXCEPTION 'storecalc_directory_foreign_key_definition_mismatch';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.contributor_subjects'::regclass
          AND conname = 'contributor_subjects_generation_check'
          AND pg_get_constraintdef(oid) = 'CHECK ((subject_generation >= 1))'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.facilities'::regclass
          AND conname = 'facilities_scope_owner_check'
          AND pg_get_constraintdef(oid) = 'CHECK ((((record_scope = ''public''::text) AND (owner_user_id IS NULL)) OR ((record_scope = ''private''::text) AND (owner_user_id IS NOT NULL))))'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'storecalc.facilities'::regclass
          AND conname = 'facilities_generation_check'
          AND pg_get_constraintdef(oid) = 'CHECK ((lifecycle_generation >= 1))'
    ) THEN
        RAISE EXCEPTION 'storecalc_directory_check_definition_mismatch';
    END IF;

    FOREACH table_name IN ARRAY identity_tables LOOP
        expected_sequence := table_name || '_id_seq';

        IF pg_get_serial_sequence(table_name, 'id') IS DISTINCT FROM expected_sequence
           OR NOT EXISTS (
               SELECT 1
               FROM pg_sequence
               WHERE seqrelid = expected_sequence::regclass
                 AND seqstart = 1
                 AND seqincrement = 1
                 AND seqmax = 2147483647
                 AND seqmin = 1
                 AND seqcache = 1
                 AND NOT seqcycle
           ) THEN
            RAISE EXCEPTION 'storecalc_directory_sequence_definition_mismatch';
        END IF;
    END LOOP;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_proc AS procedure
        JOIN pg_language AS language
          ON language.oid = procedure.prolang
        WHERE procedure.oid = 'storecalc.assert_reviewed_timezone_exists()'::regprocedure
          AND pg_get_userbyid(procedure.proowner) = migration_owner_role
          AND language.lanname = 'plpgsql'
          AND procedure.prorettype = 'trigger'::regtype
          AND procedure.pronargs = 0
          AND procedure.prosecdef
          AND procedure.provolatile = 'v'
          AND procedure.proconfig = ARRAY['search_path=pg_catalog, storecalc']
          AND md5(procedure.prosrc) = '413d3098a67b7cfabe0cd4aed1917988'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_proc AS procedure
        JOIN pg_language AS language
          ON language.oid = procedure.prolang
        WHERE procedure.oid = 'storecalc.assert_jurisdiction_acyclic()'::regprocedure
          AND pg_get_userbyid(procedure.proowner) = migration_owner_role
          AND language.lanname = 'plpgsql'
          AND procedure.prorettype = 'trigger'::regtype
          AND procedure.pronargs = 0
          AND procedure.prosecdef
          AND procedure.provolatile = 'v'
          AND procedure.proconfig = ARRAY['search_path=pg_catalog, storecalc']
          AND md5(procedure.prosrc) = 'c7c391a378c393c1a65c7cfc2f543c5b'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_proc AS procedure
        JOIN pg_language AS language
          ON language.oid = procedure.prolang
        WHERE procedure.oid = 'storecalc.assert_facility_merge_acyclic()'::regprocedure
          AND pg_get_userbyid(procedure.proowner) = migration_owner_role
          AND language.lanname = 'plpgsql'
          AND procedure.prorettype = 'trigger'::regtype
          AND procedure.pronargs = 0
          AND procedure.prosecdef
          AND procedure.provolatile = 'v'
          AND procedure.proconfig = ARRAY['search_path=pg_catalog, storecalc']
          AND md5(procedure.prosrc) = 'cdd50d9c47881788dbfbb8b36f589957'
    ) THEN
        RAISE EXCEPTION 'storecalc_directory_function_definition_mismatch';
    END IF;

    SELECT array_agg(
        format(
            '%s:%s:%s:%s:%s',
            trigger_row.tgname,
            relation.relname,
            procedure.proname,
            trigger_row.tgenabled,
            trigger_row.tgtype
        )
        ORDER BY trigger_row.tgname
    )
    INTO actual_triggers
    FROM pg_trigger AS trigger_row
    JOIN pg_class AS relation
      ON relation.oid = trigger_row.tgrelid
    JOIN pg_proc AS procedure
      ON procedure.oid = trigger_row.tgfoid
    WHERE relation.relnamespace = 'storecalc'::regnamespace
      AND NOT trigger_row.tgisinternal;

    IF actual_triggers IS DISTINCT FROM ARRAY[
        'facilities_merge_acyclic_trigger:facilities:assert_facility_merge_acyclic:O:23',
        'jurisdictions_acyclic_trigger:jurisdictions:assert_jurisdiction_acyclic:O:23',
        'reviewed_timezones_validate_trigger:reviewed_timezones:assert_reviewed_timezone_exists:O:23'
    ]::text[]
       OR EXISTS (
           SELECT 1
           FROM pg_policy
           WHERE polrelid = ANY (new_tables::regclass[])
       ) OR EXISTS (
           SELECT 1
           FROM pg_class
           WHERE oid = ANY (new_tables::regclass[])
             AND (
                 relpersistence <> 'p'
                 OR relrowsecurity
                 OR relforcerowsecurity
             )
       ) THEN
        RAISE EXCEPTION 'storecalc_directory_table_security_mismatch';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM (
            SELECT acl.grantee
            FROM pg_namespace AS namespace,
                 LATERAL aclexplode(
                     COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))
                 ) AS acl
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
                 LATERAL aclexplode(
                     COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
                 ) AS acl
            WHERE procedure.pronamespace = 'storecalc'::regnamespace
        ) AS object_grants
        WHERE object_grants.grantee <> ALL (allowed_grantee_oids)
    ) THEN
        RAISE EXCEPTION 'storecalc_directory_unexpected_grantee';
    END IF;

    IF NOT has_schema_privilege(web_role, 'storecalc', 'USAGE')
       OR has_schema_privilege(web_role, 'storecalc', 'CREATE')
       OR NOT has_schema_privilege(worker_role, 'storecalc', 'USAGE')
       OR has_schema_privilege(worker_role, 'storecalc', 'CREATE')
       OR NOT has_schema_privilege(backup_role, 'storecalc', 'USAGE')
       OR has_schema_privilege(backup_role, 'storecalc', 'CREATE') THEN
        RAISE EXCEPTION 'storecalc_directory_schema_grant_mismatch';
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
            RAISE EXCEPTION 'storecalc_directory_table_grant_mismatch';
        END IF;
    END LOOP;

    FOREACH table_name IN ARRAY identity_tables LOOP
        object_name := table_name || '_id_seq';

        IF has_sequence_privilege(web_role, object_name, 'SELECT')
           OR has_sequence_privilege(web_role, object_name, 'USAGE')
           OR has_sequence_privilege(worker_role, object_name, 'SELECT')
           OR has_sequence_privilege(worker_role, object_name, 'USAGE')
           OR NOT has_sequence_privilege(backup_role, object_name, 'SELECT')
           OR has_sequence_privilege(backup_role, object_name, 'USAGE')
           OR has_sequence_privilege(backup_role, object_name, 'UPDATE') THEN
            RAISE EXCEPTION 'storecalc_directory_sequence_grant_mismatch';
        END IF;
    END LOOP;

    IF has_function_privilege(web_role, 'storecalc.assert_reviewed_timezone_exists()', 'EXECUTE')
       OR has_function_privilege(worker_role, 'storecalc.assert_reviewed_timezone_exists()', 'EXECUTE')
       OR has_function_privilege(backup_role, 'storecalc.assert_reviewed_timezone_exists()', 'EXECUTE')
       OR has_function_privilege(web_role, 'storecalc.assert_jurisdiction_acyclic()', 'EXECUTE')
       OR has_function_privilege(worker_role, 'storecalc.assert_jurisdiction_acyclic()', 'EXECUTE')
       OR has_function_privilege(backup_role, 'storecalc.assert_jurisdiction_acyclic()', 'EXECUTE')
       OR has_function_privilege(web_role, 'storecalc.assert_facility_merge_acyclic()', 'EXECUTE')
       OR has_function_privilege(worker_role, 'storecalc.assert_facility_merge_acyclic()', 'EXECUTE')
       OR has_function_privilege(backup_role, 'storecalc.assert_facility_merge_acyclic()', 'EXECUTE') THEN
        RAISE EXCEPTION 'storecalc_directory_function_grant_mismatch';
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

    IF actual_capabilities IS DISTINCT FROM ARRAY[
        '1:schema.foundation:1:t:0001_schema_foundation',
        '2:public.directory:1:f:0002_directory_lineage',
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
       OR NOT EXISTS (
           SELECT 1
           FROM storecalc.schema_capabilities AS directory
           JOIN storecalc.schema_capabilities AS foundation
             ON foundation.capability_key = 'schema.foundation'
           WHERE directory.capability_key = 'public.directory'
             AND directory.updated_at >= foundation.verified_at
       ) THEN
        RAISE EXCEPTION 'storecalc_directory_capability_state_mismatch';
    END IF;
END
$storecalc_directory_verify$;

COMMIT;
