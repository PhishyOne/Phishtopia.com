BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

SELECT pg_advisory_xact_lock(7356507374803211041);

DO $storecalc_program_preflight$
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
        RAISE EXCEPTION 'storecalc_program_role_config_invalid'
            USING ERRCODE = '22023';
    END IF;

    IF migration_owner_role <> current_user THEN
        RAISE EXCEPTION 'storecalc_program_owner_mismatch'
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
        RAISE EXCEPTION 'storecalc_program_role_mismatch'
            USING ERRCODE = '42501';
    END IF;

    IF NOT has_database_privilege(migration_owner_role, current_database(), 'CREATE')
       OR has_database_privilege(web_role, current_database(), 'CREATE')
       OR has_database_privilege(worker_role, current_database(), 'CREATE')
       OR has_database_privilege(backup_role, current_database(), 'CREATE') THEN
        RAISE EXCEPTION 'storecalc_program_database_grant_mismatch'
            USING ERRCODE = '42501';
    END IF;

    FOREACH source_role IN ARRAY configured_roles LOOP
        FOREACH target_role IN ARRAY configured_roles LOOP
            IF source_role <> target_role
               AND pg_has_role(source_role, target_role, 'MEMBER') THEN
                RAISE EXCEPTION 'storecalc_program_role_inheritance_mismatch'
                    USING ERRCODE = '42501';
            END IF;
        END LOOP;
    END LOOP;

    IF to_regnamespace('storecalc') IS NULL
       OR to_regclass('public.users') IS NULL
       OR pg_get_userbyid(
           (SELECT nspowner FROM pg_namespace WHERE nspname = 'storecalc')
       ) IS DISTINCT FROM migration_owner_role THEN
        RAISE EXCEPTION 'storecalc_program_directory_baseline_missing';
    END IF;

    SELECT array_agg(format('%s:%s', relname, relkind) ORDER BY relname)
    INTO actual_relations
    FROM pg_class
    WHERE relnamespace = 'storecalc'::regnamespace;

    IF md5(array_to_string(actual_relations, E'\n')) <> 'fca2a2dbb8efbcd63d9747e1b62dead4'
       OR cardinality(actual_relations) <> 48 THEN
        RAISE EXCEPTION 'storecalc_program_directory_relation_mismatch';
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
        RAISE EXCEPTION 'storecalc_program_directory_column_mismatch';
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
        RAISE EXCEPTION 'storecalc_program_directory_constraint_mismatch';
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
        RAISE EXCEPTION 'storecalc_program_directory_index_mismatch';
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
        RAISE EXCEPTION 'storecalc_program_directory_foreign_key_mismatch';
    END IF;

    IF NOT EXISTS (
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
    ) THEN
        RAISE EXCEPTION 'storecalc_program_directory_function_mismatch';
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
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgqual IS NULL;

    IF actual_triggers IS DISTINCT FROM ARRAY[
        'facilities_merge_acyclic_trigger:facilities:assert_facility_merge_acyclic:O:23',
        'jurisdictions_acyclic_trigger:jurisdictions:assert_jurisdiction_acyclic:O:23',
        'reviewed_timezones_validate_trigger:reviewed_timezones:assert_reviewed_timezone_exists:O:23'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_program_directory_trigger_mismatch';
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
        RAISE EXCEPTION 'storecalc_program_directory_unexpected_grantee';
    END IF;

    SELECT array_agg(
        format('%s:%s:%s:%s:%s', id, capability_key, schema_version, is_available, migration_key)
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
           WHERE (capability_key = 'schema.foundation' AND verified_at IS NULL)
              OR (capability_key <> 'schema.foundation' AND verified_at IS NOT NULL)
       ) THEN
        RAISE EXCEPTION 'storecalc_program_directory_capability_mismatch';
    END IF;

    IF to_regclass('storecalc.store_programs') IS NOT NULL
       OR to_regclass('storecalc.program_facility_assignments') IS NOT NULL
       OR to_regprocedure('storecalc.assert_program_assignment_coherent()') IS NOT NULL
       OR to_regprocedure('storecalc.lock_program_assignment_topology()') IS NOT NULL
       OR to_regprocedure('storecalc.protect_store_program_assignment_lineage()') IS NOT NULL
       OR to_regprocedure('storecalc.protect_program_assignment_parent_lineage()') IS NOT NULL THEN
        RAISE EXCEPTION 'storecalc_program_target_already_exists';
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
        RAISE EXCEPTION 'storecalc_program_users_identity_mismatch'
            USING ERRCODE = '55000';
    END IF;

    IF NOT has_column_privilege(
        migration_owner_role,
        'public.users',
        'id',
        'REFERENCES'
    ) THEN
        RAISE EXCEPTION 'storecalc_program_users_reference_denied'
            USING ERRCODE = '42501';
    END IF;
END
$storecalc_program_preflight$;

CREATE TABLE storecalc.store_programs (
    id integer GENERATED BY DEFAULT AS IDENTITY,
    owning_agency_id integer,
    record_scope text NOT NULL,
    owner_user_id integer,
    name text NOT NULL,
    description text,
    program_type text,
    status text NOT NULL,
    created_by_subject_id integer,
    created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    lifecycle_generation integer NOT NULL DEFAULT 1,
    CONSTRAINT store_programs_pkey
        PRIMARY KEY (id),
    CONSTRAINT store_programs_owning_agency_id_fkey
        FOREIGN KEY (owning_agency_id)
        REFERENCES storecalc.agencies(id)
        ON DELETE RESTRICT,
    CONSTRAINT store_programs_owner_user_id_fkey
        FOREIGN KEY (owner_user_id)
        REFERENCES public.users(id)
        ON DELETE RESTRICT,
    CONSTRAINT store_programs_created_by_subject_id_fkey
        FOREIGN KEY (created_by_subject_id)
        REFERENCES storecalc.contributor_subjects(id)
        ON DELETE RESTRICT,
    CONSTRAINT store_programs_scope_check
        CHECK (record_scope IN ('public', 'private')),
    CONSTRAINT store_programs_scope_owner_check
        CHECK (
            (record_scope = 'public' AND owner_user_id IS NULL)
            OR (record_scope = 'private' AND owner_user_id IS NOT NULL)
        ),
    CONSTRAINT store_programs_name_check
        CHECK (
            char_length(name) BETWEEN 1 AND 200
            AND octet_length(name) <= 800
            AND name = btrim(name)
            AND name !~ '[[:cntrl:]]'
        ),
    CONSTRAINT store_programs_description_check
        CHECK (
            description IS NULL
            OR (
                char_length(description) BETWEEN 1 AND 4000
                AND octet_length(description) <= 16000
                AND description = btrim(description)
            )
        ),
    CONSTRAINT store_programs_type_format_check
        CHECK (
            program_type IS NULL
            OR (
                char_length(program_type) BETWEEN 1 AND 64
                AND octet_length(program_type) <= 64
                AND program_type ~ '^[a-z][a-z0-9_]*$'
            )
        ),
    CONSTRAINT store_programs_status_check
        CHECK (status IN ('draft', 'active', 'inactive', 'withdrawn', 'archived')),
    CONSTRAINT store_programs_timestamp_order_check
        CHECK (updated_at >= created_at),
    CONSTRAINT store_programs_generation_check
        CHECK (lifecycle_generation >= 1)
);

CREATE INDEX store_programs_agency_name_idx
    ON storecalc.store_programs (owning_agency_id, name);

CREATE INDEX store_programs_owner_idx
    ON storecalc.store_programs (owner_user_id)
    WHERE owner_user_id IS NOT NULL;

CREATE INDEX store_programs_created_by_subject_idx
    ON storecalc.store_programs (created_by_subject_id)
    WHERE created_by_subject_id IS NOT NULL;

CREATE INDEX store_programs_status_name_idx
    ON storecalc.store_programs (status, name, id);

CREATE TABLE storecalc.program_facility_assignments (
    id integer GENERATED BY DEFAULT AS IDENTITY,
    program_id integer NOT NULL,
    facility_id integer NOT NULL,
    audience_key text NOT NULL,
    valid_from date,
    valid_through date,
    assignment_state text NOT NULL,
    source_evidence_id integer,
    recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    retired_at timestamptz,
    lifecycle_generation integer NOT NULL DEFAULT 1,
    CONSTRAINT program_facility_assignments_pkey
        PRIMARY KEY (id),
    CONSTRAINT program_facility_assignments_id_lineage_key
        UNIQUE (id, program_id, facility_id),
    CONSTRAINT program_facility_assignments_program_id_fkey
        FOREIGN KEY (program_id)
        REFERENCES storecalc.store_programs(id)
        ON DELETE RESTRICT,
    CONSTRAINT program_facility_assignments_facility_id_fkey
        FOREIGN KEY (facility_id)
        REFERENCES storecalc.facilities(id)
        ON DELETE RESTRICT,
    CONSTRAINT program_facility_assignments_audience_key_check
        CHECK (
            char_length(audience_key) BETWEEN 1 AND 64
            AND octet_length(audience_key) <= 64
            AND audience_key ~ '^[a-z][a-z0-9_]*$'
        ),
    CONSTRAINT program_facility_assignments_effective_dates_check
        CHECK (valid_from IS NULL OR valid_through IS NULL OR valid_through >= valid_from),
    CONSTRAINT program_facility_assignments_state_check
        CHECK (assignment_state IN ('draft', 'supported', 'disputed', 'withdrawn', 'retired')),
    CONSTRAINT program_facility_assignments_evidence_deferred_check
        CHECK (source_evidence_id IS NULL),
    CONSTRAINT program_facility_assignments_retired_order_check
        CHECK (retired_at IS NULL OR retired_at >= recorded_at),
    CONSTRAINT program_facility_assignments_retired_state_check
        CHECK ((assignment_state = 'retired') = (retired_at IS NOT NULL)),
    CONSTRAINT program_facility_assignments_generation_check
        CHECK (lifecycle_generation >= 1)
);

CREATE INDEX program_facility_assignments_resolution_idx
    ON storecalc.program_facility_assignments (
        facility_id,
        audience_key,
        assignment_state,
        valid_from,
        valid_through,
        program_id
    );

CREATE INDEX program_facility_assignments_program_idx
    ON storecalc.program_facility_assignments (program_id, facility_id, audience_key);

CREATE FUNCTION storecalc.lock_program_assignment_topology()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storecalc
AS $storecalc_program_topology_lock_function$
BEGIN
    LOCK TABLE storecalc.program_facility_assignments IN SHARE ROW EXCLUSIVE MODE;
    RETURN NULL;
END
$storecalc_program_topology_lock_function$;

CREATE FUNCTION storecalc.assert_program_assignment_coherent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storecalc
AS $storecalc_program_assignment_function$
DECLARE
    program_scope text;
    program_owner_id integer;
    program_country_id integer;
    facility_scope text;
    facility_owner_id integer;
    facility_country_id integer;
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.program_id IS NOT DISTINCT FROM OLD.program_id
       AND NEW.facility_id IS NOT DISTINCT FROM OLD.facility_id
       AND NEW.audience_key IS NOT DISTINCT FROM OLD.audience_key
       AND NEW.valid_from IS NOT DISTINCT FROM OLD.valid_from
       AND NEW.valid_through IS NOT DISTINCT FROM OLD.valid_through
       AND NEW.assignment_state IS NOT DISTINCT FROM OLD.assignment_state THEN
        RETURN NEW;
    END IF;

    SELECT
        program.record_scope,
        program.owner_user_id,
        agency.country_id
    INTO program_scope, program_owner_id, program_country_id
    FROM storecalc.store_programs AS program
    LEFT JOIN storecalc.agencies AS agency
      ON agency.id = program.owning_agency_id
    WHERE program.id = NEW.program_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'storecalc_assignment_program_missing'
            USING ERRCODE = '23503';
    END IF;

    SELECT
        facility.record_scope,
        facility.owner_user_id,
        facility.physical_country_id
    INTO facility_scope, facility_owner_id, facility_country_id
    FROM storecalc.facilities AS facility
    WHERE facility.id = NEW.facility_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'storecalc_assignment_facility_missing'
            USING ERRCODE = '23503';
    END IF;

    IF program_country_id IS NOT NULL
       AND program_country_id <> facility_country_id THEN
        RAISE EXCEPTION 'storecalc_assignment_agency_country_mismatch'
            USING ERRCODE = '23514';
    END IF;

    IF program_scope = 'private'
       AND facility_scope = 'private'
       AND program_owner_id IS DISTINCT FROM facility_owner_id THEN
        RAISE EXCEPTION 'storecalc_assignment_private_owner_mismatch'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.assignment_state = 'supported'
       AND EXISTS (
           SELECT 1
           FROM storecalc.program_facility_assignments AS existing_assignment
           WHERE existing_assignment.program_id = NEW.program_id
             AND existing_assignment.facility_id = NEW.facility_id
             AND existing_assignment.audience_key = NEW.audience_key
             AND existing_assignment.assignment_state = 'supported'
             AND existing_assignment.id IS DISTINCT FROM NEW.id
             AND daterange(
                 existing_assignment.valid_from,
                 existing_assignment.valid_through,
                 '[]'
             ) && daterange(NEW.valid_from, NEW.valid_through, '[]')
       ) THEN
        RAISE EXCEPTION 'storecalc_assignment_supported_interval_overlap'
            USING ERRCODE = '23P01';
    END IF;

    RETURN NEW;
END
$storecalc_program_assignment_function$;

CREATE FUNCTION storecalc.protect_store_program_assignment_lineage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storecalc
AS $storecalc_program_lineage_function$
BEGIN
    IF NEW.owning_agency_id IS NOT DISTINCT FROM OLD.owning_agency_id
       AND NEW.record_scope IS NOT DISTINCT FROM OLD.record_scope
       AND NEW.owner_user_id IS NOT DISTINCT FROM OLD.owner_user_id THEN
        RETURN NEW;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM storecalc.program_facility_assignments
        WHERE program_id = OLD.id
    ) THEN
        RAISE EXCEPTION 'storecalc_assigned_program_lineage_immutable'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END
$storecalc_program_lineage_function$;

CREATE FUNCTION storecalc.protect_program_assignment_parent_lineage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storecalc
AS $storecalc_program_parent_lineage_function$
BEGIN
    IF TG_TABLE_NAME = 'facilities' THEN
        IF NEW.physical_country_id IS NOT DISTINCT FROM OLD.physical_country_id
           AND NEW.record_scope IS NOT DISTINCT FROM OLD.record_scope
           AND NEW.owner_user_id IS NOT DISTINCT FROM OLD.owner_user_id THEN
            RETURN NEW;
        END IF;

        IF EXISTS (
            SELECT 1
            FROM storecalc.program_facility_assignments
            WHERE facility_id = OLD.id
        ) THEN
            RAISE EXCEPTION 'storecalc_assigned_facility_lineage_immutable'
                USING ERRCODE = '55000';
        END IF;
    ELSIF TG_TABLE_NAME = 'agencies' THEN
        IF NEW.country_id IS NOT DISTINCT FROM OLD.country_id THEN
            RETURN NEW;
        END IF;

        IF EXISTS (
            SELECT 1
            FROM storecalc.store_programs AS program
            JOIN storecalc.program_facility_assignments AS assignment
              ON assignment.program_id = program.id
            WHERE program.owning_agency_id = OLD.id
        ) THEN
            RAISE EXCEPTION 'storecalc_assigned_agency_country_immutable'
                USING ERRCODE = '55000';
        END IF;
    ELSE
        RAISE EXCEPTION 'storecalc_program_parent_trigger_target_invalid'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END
$storecalc_program_parent_lineage_function$;

CREATE TRIGGER program_facility_assignments_topology_lock_trigger
BEFORE INSERT OR UPDATE ON storecalc.program_facility_assignments
FOR EACH STATEMENT
EXECUTE FUNCTION storecalc.lock_program_assignment_topology();

CREATE TRIGGER program_facility_assignments_coherent_trigger
BEFORE INSERT OR UPDATE ON storecalc.program_facility_assignments
FOR EACH ROW
EXECUTE FUNCTION storecalc.assert_program_assignment_coherent();

CREATE TRIGGER store_programs_assignment_topology_lock_trigger
BEFORE UPDATE ON storecalc.store_programs
FOR EACH STATEMENT
EXECUTE FUNCTION storecalc.lock_program_assignment_topology();

CREATE TRIGGER store_programs_assignment_lineage_trigger
BEFORE UPDATE ON storecalc.store_programs
FOR EACH ROW
EXECUTE FUNCTION storecalc.protect_store_program_assignment_lineage();

CREATE TRIGGER facilities_assignment_topology_lock_trigger
BEFORE UPDATE ON storecalc.facilities
FOR EACH STATEMENT
EXECUTE FUNCTION storecalc.lock_program_assignment_topology();

CREATE TRIGGER facilities_assignment_lineage_trigger
BEFORE UPDATE ON storecalc.facilities
FOR EACH ROW
EXECUTE FUNCTION storecalc.protect_program_assignment_parent_lineage();

CREATE TRIGGER agencies_assignment_topology_lock_trigger
BEFORE UPDATE ON storecalc.agencies
FOR EACH STATEMENT
EXECUTE FUNCTION storecalc.lock_program_assignment_topology();

CREATE TRIGGER agencies_assignment_lineage_trigger
BEFORE UPDATE ON storecalc.agencies
FOR EACH ROW
EXECUTE FUNCTION storecalc.protect_program_assignment_parent_lineage();

REVOKE ALL ON TABLE
    storecalc.store_programs,
    storecalc.program_facility_assignments
FROM PUBLIC;

REVOKE ALL ON SEQUENCE
    storecalc.store_programs_id_seq,
    storecalc.program_facility_assignments_id_seq
FROM PUBLIC;

REVOKE ALL ON FUNCTION
    storecalc.lock_program_assignment_topology(),
    storecalc.assert_program_assignment_coherent(),
    storecalc.protect_store_program_assignment_lineage(),
    storecalc.protect_program_assignment_parent_lineage()
FROM PUBLIC;

DO $storecalc_program_grants$
DECLARE
    backup_role text := current_setting('storecalc.backup_role');
BEGIN
    EXECUTE format(
        'GRANT SELECT ON TABLE '
        'storecalc.store_programs, '
        'storecalc.program_facility_assignments TO %I',
        backup_role
    );

    EXECUTE format(
        'GRANT SELECT ON SEQUENCE '
        'storecalc.store_programs_id_seq, '
        'storecalc.program_facility_assignments_id_seq TO %I',
        backup_role
    );
END
$storecalc_program_grants$;

UPDATE storecalc.schema_capabilities
SET schema_version = 2,
    migration_key = '0003_program_assignments',
    updated_at = transaction_timestamp()
WHERE capability_key = 'public.directory'
  AND schema_version = 1
  AND NOT is_available
  AND verified_at IS NULL
  AND migration_key = '0002_directory_lineage';

DO $storecalc_program_postflight$
DECLARE
    migration_owner_role text := current_setting('storecalc.migration_owner_role');
    web_role text := current_setting('storecalc.web_role');
    worker_role text := current_setting('storecalc.worker_role');
    backup_role text := current_setting('storecalc.backup_role');
    allowed_grantee_oids oid[];
    object_name text;
    actual_relations text[];
    actual_triggers text[];
    new_tables constant text[] := ARRAY[
        'storecalc.store_programs',
        'storecalc.program_facility_assignments'
    ];
    new_sequences constant text[] := ARRAY[
        'storecalc.store_programs_id_seq',
        'storecalc.program_facility_assignments_id_seq'
    ];
BEGIN
    SELECT array_agg(
        format('%s:%s', relation.relname, relation.relkind)
        ORDER BY relation.relname
    )
    INTO actual_relations
    FROM pg_class AS relation
    WHERE relation.relnamespace = 'storecalc'::regnamespace
      AND relation.relname = ANY (
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

    IF actual_relations IS DISTINCT FROM ARRAY[
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
        RAISE EXCEPTION 'storecalc_program_postflight_relation_mismatch';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_class
        WHERE oid = ANY ((new_tables || new_sequences)::regclass[])
          AND pg_get_userbyid(relowner) <> migration_owner_role
    ) OR EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE oid = ANY (
            ARRAY[
                'storecalc.assert_program_assignment_coherent()'::regprocedure,
                'storecalc.lock_program_assignment_topology()'::regprocedure,
                'storecalc.protect_store_program_assignment_lineage()'::regprocedure,
                'storecalc.protect_program_assignment_parent_lineage()'::regprocedure
            ]
        )
          AND pg_get_userbyid(proowner) <> migration_owner_role
    ) THEN
        RAISE EXCEPTION 'storecalc_program_postflight_owner_mismatch';
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
    WHERE trigger_row.tgname = ANY (
        ARRAY[
            'program_facility_assignments_coherent_trigger',
            'program_facility_assignments_topology_lock_trigger',
            'store_programs_assignment_lineage_trigger',
            'store_programs_assignment_topology_lock_trigger',
            'facilities_assignment_lineage_trigger',
            'facilities_assignment_topology_lock_trigger',
            'agencies_assignment_lineage_trigger',
            'agencies_assignment_topology_lock_trigger'
        ]
    )
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgqual IS NULL;

    IF actual_triggers IS DISTINCT FROM ARRAY[
        'agencies_assignment_lineage_trigger:agencies:protect_program_assignment_parent_lineage:O:19',
        'agencies_assignment_topology_lock_trigger:agencies:lock_program_assignment_topology:O:18',
        'facilities_assignment_lineage_trigger:facilities:protect_program_assignment_parent_lineage:O:19',
        'facilities_assignment_topology_lock_trigger:facilities:lock_program_assignment_topology:O:18',
        'program_facility_assignments_coherent_trigger:program_facility_assignments:assert_program_assignment_coherent:O:23',
        'program_facility_assignments_topology_lock_trigger:program_facility_assignments:lock_program_assignment_topology:O:22',
        'store_programs_assignment_lineage_trigger:store_programs:protect_store_program_assignment_lineage:O:19',
        'store_programs_assignment_topology_lock_trigger:store_programs:lock_program_assignment_topology:O:18'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_program_postflight_trigger_mismatch';
    END IF;

    SELECT array_agg(oid ORDER BY oid)
    INTO allowed_grantee_oids
    FROM pg_roles
    WHERE rolname = ANY (ARRAY[migration_owner_role, web_role, worker_role, backup_role]);

    IF EXISTS (
        SELECT 1
        FROM (
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
            WHERE relation.oid = ANY ((new_tables || new_sequences)::regclass[])

            UNION ALL

            SELECT acl.grantee
            FROM pg_proc AS procedure,
                 LATERAL aclexplode(
                     COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
                 ) AS acl
            WHERE procedure.oid = ANY (
                ARRAY[
                    'storecalc.assert_program_assignment_coherent()'::regprocedure,
                    'storecalc.lock_program_assignment_topology()'::regprocedure,
                    'storecalc.protect_store_program_assignment_lineage()'::regprocedure,
                    'storecalc.protect_program_assignment_parent_lineage()'::regprocedure
                ]
            )
        ) AS object_grants
        WHERE object_grants.grantee <> ALL (allowed_grantee_oids)
    ) THEN
        RAISE EXCEPTION 'storecalc_program_postflight_unexpected_grantee';
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
            RAISE EXCEPTION 'storecalc_program_postflight_table_grant_mismatch';
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
            RAISE EXCEPTION 'storecalc_program_postflight_sequence_grant_mismatch';
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
        RAISE EXCEPTION 'storecalc_program_postflight_function_grant_mismatch';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM storecalc.schema_capabilities
        WHERE capability_key = 'public.directory'
          AND schema_version = 2
          AND NOT is_available
          AND verified_at IS NULL
          AND migration_key = '0003_program_assignments'
    ) THEN
        RAISE EXCEPTION 'storecalc_program_postflight_capability_mismatch';
    END IF;
END
$storecalc_program_postflight$;

COMMIT;
