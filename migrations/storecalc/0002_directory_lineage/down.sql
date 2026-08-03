BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

SELECT pg_advisory_xact_lock(7356507374803211041);

DO $storecalc_directory_rollback_preflight$
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
        RAISE EXCEPTION 'storecalc_directory_rollback_role_config_invalid'
            USING ERRCODE = '22023';
    END IF;

    IF migration_owner_role <> current_user THEN
        RAISE EXCEPTION 'storecalc_directory_rollback_owner_mismatch'
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
        RAISE EXCEPTION 'storecalc_directory_rollback_role_mismatch'
            USING ERRCODE = '42501';
    END IF;

    IF NOT has_database_privilege(migration_owner_role, current_database(), 'CREATE')
       OR has_database_privilege(web_role, current_database(), 'CREATE')
       OR has_database_privilege(worker_role, current_database(), 'CREATE')
       OR has_database_privilege(backup_role, current_database(), 'CREATE') THEN
        RAISE EXCEPTION 'storecalc_directory_rollback_database_grant_mismatch'
            USING ERRCODE = '42501';
    END IF;

    FOREACH source_role IN ARRAY configured_roles LOOP
        FOREACH target_role IN ARRAY configured_roles LOOP
            IF source_role <> target_role
               AND pg_has_role(source_role, target_role, 'MEMBER') THEN
                RAISE EXCEPTION 'storecalc_directory_rollback_role_inheritance_mismatch'
                    USING ERRCODE = '42501';
            END IF;
        END LOOP;
    END LOOP;

    IF to_regnamespace('storecalc') IS NULL
       OR to_regclass('public.users') IS NULL
       OR pg_get_userbyid(
           (SELECT nspowner FROM pg_namespace WHERE nspname = 'storecalc')
       ) IS DISTINCT FROM migration_owner_role THEN
        RAISE EXCEPTION 'storecalc_directory_rollback_baseline_mismatch';
    END IF;

    SELECT array_agg(format('%s:%s', relname, relkind) ORDER BY relname)
    INTO actual_relations
    FROM pg_class
    WHERE relnamespace = 'storecalc'::regnamespace;

    IF md5(array_to_string(actual_relations, E'\n')) <> 'fca2a2dbb8efbcd63d9747e1b62dead4'
       OR cardinality(actual_relations) <> 48 THEN
        RAISE EXCEPTION 'storecalc_directory_rollback_relation_mismatch';
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
        RAISE EXCEPTION 'storecalc_directory_rollback_owner_drift';
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

    IF md5(array_to_string(actual_columns, E'\n')) <> 'f1b5c0116049455b1d4a32f3d649b3b7'
       OR cardinality(actual_columns) <> 69 THEN
        RAISE EXCEPTION 'storecalc_directory_rollback_column_mismatch';
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

    IF md5(array_to_string(actual_constraints, E'\n')) <> 'f56f7b75661fb074032960b4da5dc668'
       OR cardinality(actual_constraints) <> 70
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
        RAISE EXCEPTION 'storecalc_directory_rollback_constraint_mismatch';
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

    IF md5(array_to_string(actual_indexes, E'\n')) <> 'c463b1d054846276d68bacef913d0f34'
       OR cardinality(actual_indexes) <> 29 THEN
        RAISE EXCEPTION 'storecalc_directory_rollback_index_mismatch';
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

    IF md5(array_to_string(actual_foreign_keys, E'\n')) <> '040b11e9754c2117a62e0c56af9e18bb'
       OR cardinality(actual_foreign_keys) <> 14 THEN
        RAISE EXCEPTION 'storecalc_directory_rollback_foreign_key_mismatch';
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
        RAISE EXCEPTION 'storecalc_directory_rollback_check_drift';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE oid = 'storecalc.assert_reviewed_timezone_exists()'::regprocedure
          AND pg_get_userbyid(proowner) = migration_owner_role
          AND prosecdef
          AND proconfig = ARRAY['search_path=pg_catalog, storecalc']
          AND md5(prosrc) = '413d3098a67b7cfabe0cd4aed1917988'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE oid = 'storecalc.assert_jurisdiction_acyclic()'::regprocedure
          AND pg_get_userbyid(proowner) = migration_owner_role
          AND prosecdef
          AND proconfig = ARRAY['search_path=pg_catalog, storecalc']
          AND md5(prosrc) = 'c7c391a378c393c1a65c7cfc2f543c5b'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE oid = 'storecalc.assert_facility_merge_acyclic()'::regprocedure
          AND pg_get_userbyid(proowner) = migration_owner_role
          AND prosecdef
          AND proconfig = ARRAY['search_path=pg_catalog, storecalc']
          AND md5(prosrc) = 'cdd50d9c47881788dbfbb8b36f589957'
    ) THEN
        RAISE EXCEPTION 'storecalc_directory_rollback_function_drift';
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
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_directory_rollback_trigger_drift';
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
        RAISE EXCEPTION 'storecalc_directory_rollback_unexpected_grantee';
    END IF;

    IF NOT has_schema_privilege(web_role, 'storecalc', 'USAGE')
       OR has_schema_privilege(web_role, 'storecalc', 'CREATE')
       OR NOT has_schema_privilege(worker_role, 'storecalc', 'USAGE')
       OR has_schema_privilege(worker_role, 'storecalc', 'CREATE')
       OR NOT has_schema_privilege(backup_role, 'storecalc', 'USAGE')
       OR has_schema_privilege(backup_role, 'storecalc', 'CREATE') THEN
        RAISE EXCEPTION 'storecalc_directory_rollback_schema_grant_mismatch';
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
       ) THEN
        RAISE EXCEPTION 'storecalc_directory_rollback_capability_drift';
    END IF;

    IF EXISTS (SELECT 1 FROM storecalc.facility_sources)
       OR EXISTS (SELECT 1 FROM storecalc.facility_aliases)
       OR EXISTS (SELECT 1 FROM storecalc.facilities)
       OR EXISTS (SELECT 1 FROM storecalc.agencies)
       OR EXISTS (SELECT 1 FROM storecalc.jurisdictions)
       OR EXISTS (SELECT 1 FROM storecalc.countries)
       OR EXISTS (SELECT 1 FROM storecalc.reviewed_timezones)
       OR EXISTS (SELECT 1 FROM storecalc.contributor_subjects) THEN
        RAISE EXCEPTION 'storecalc_directory_rollback_not_empty'
            USING ERRCODE = '55000';
    END IF;

    IF (SELECT last_value FROM storecalc.contributor_subjects_id_seq) <> 1
       OR (SELECT is_called FROM storecalc.contributor_subjects_id_seq)
       OR (SELECT last_value FROM storecalc.countries_id_seq) <> 1
       OR (SELECT is_called FROM storecalc.countries_id_seq)
       OR (SELECT last_value FROM storecalc.jurisdictions_id_seq) <> 1
       OR (SELECT is_called FROM storecalc.jurisdictions_id_seq)
       OR (SELECT last_value FROM storecalc.agencies_id_seq) <> 1
       OR (SELECT is_called FROM storecalc.agencies_id_seq)
       OR (SELECT last_value FROM storecalc.facilities_id_seq) <> 1
       OR (SELECT is_called FROM storecalc.facilities_id_seq)
       OR (SELECT last_value FROM storecalc.facility_aliases_id_seq) <> 1
       OR (SELECT is_called FROM storecalc.facility_aliases_id_seq)
       OR (SELECT last_value FROM storecalc.facility_sources_id_seq) <> 1
       OR (SELECT is_called FROM storecalc.facility_sources_id_seq) THEN
        RAISE EXCEPTION 'storecalc_directory_rollback_sequence_used'
            USING ERRCODE = '55000';
    END IF;
END
$storecalc_directory_rollback_preflight$;

DROP TABLE storecalc.facility_sources;
DROP TABLE storecalc.facility_aliases;
DROP TABLE storecalc.facilities;
DROP TABLE storecalc.agencies;
DROP TABLE storecalc.jurisdictions;
DROP TABLE storecalc.countries;
DROP TABLE storecalc.reviewed_timezones;
DROP TABLE storecalc.contributor_subjects;

DROP FUNCTION storecalc.assert_facility_merge_acyclic();
DROP FUNCTION storecalc.assert_jurisdiction_acyclic();
DROP FUNCTION storecalc.assert_reviewed_timezone_exists();

UPDATE storecalc.schema_capabilities
SET schema_version = 0,
    is_available = false,
    verified_at = NULL,
    migration_key = '0001_schema_foundation',
    updated_at = (
        SELECT verified_at
        FROM storecalc.schema_capabilities
        WHERE capability_key = 'schema.foundation'
    )
WHERE capability_key = 'public.directory'
  AND schema_version = 1
  AND NOT is_available
  AND verified_at IS NULL
  AND migration_key = '0002_directory_lineage';

DO $storecalc_directory_rollback_postflight$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_class
        WHERE relnamespace = 'storecalc'::regnamespace
          AND relname <> ALL (
              ARRAY[
                  'schema_capabilities',
                  'schema_capabilities_capability_key_key',
                  'schema_capabilities_id_seq',
                  'schema_capabilities_pkey'
              ]
          )
    ) OR EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE pronamespace = 'storecalc'::regnamespace
    ) OR NOT EXISTS (
        SELECT 1
        FROM storecalc.schema_capabilities
        WHERE capability_key = 'public.directory'
          AND schema_version = 0
          AND NOT is_available
          AND verified_at IS NULL
          AND migration_key = '0001_schema_foundation'
          AND updated_at IS NOT DISTINCT FROM (
              SELECT verified_at
              FROM storecalc.schema_capabilities
              WHERE capability_key = 'schema.foundation'
          )
    ) THEN
        RAISE EXCEPTION 'storecalc_directory_rollback_postflight_mismatch';
    END IF;
END
$storecalc_directory_rollback_postflight$;

COMMIT;
