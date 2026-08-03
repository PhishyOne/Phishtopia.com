BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

SELECT pg_advisory_xact_lock(7356507374803211041);

DO $storecalc_directory_preflight$
DECLARE
    migration_owner_role text := current_setting('storecalc.migration_owner_role', true);
    web_role text := current_setting('storecalc.web_role', true);
    worker_role text := current_setting('storecalc.worker_role', true);
    backup_role text := current_setting('storecalc.backup_role', true);
    configured_roles text[];
    source_role text;
    target_role text;
    actual_relations text[];
    actual_capabilities text[];
    schema_owner text;
BEGIN
    configured_roles := ARRAY[
        migration_owner_role,
        web_role,
        worker_role,
        backup_role
    ];

    IF array_position(configured_roles, NULL) IS NOT NULL
       OR array_position(configured_roles, '') IS NOT NULL THEN
        RAISE EXCEPTION 'storecalc_directory_role_config_missing'
            USING ERRCODE = '22023';
    END IF;

    IF lower('public') = ANY (
        ARRAY(
            SELECT lower(role_name)
            FROM unnest(configured_roles) AS role_name
        )
    ) OR (SELECT count(DISTINCT role_name) FROM unnest(configured_roles) AS role_name) <> 4 THEN
        RAISE EXCEPTION 'storecalc_directory_role_config_invalid'
            USING ERRCODE = '22023';
    END IF;

    IF migration_owner_role <> current_user THEN
        RAISE EXCEPTION 'storecalc_directory_owner_mismatch'
            USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM unnest(configured_roles) AS configured(role_name)
        LEFT JOIN pg_roles AS roles
          ON roles.rolname = configured.role_name
        WHERE roles.oid IS NULL
    ) THEN
        RAISE EXCEPTION 'storecalc_directory_configured_role_missing'
            USING ERRCODE = '42704';
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
        RAISE EXCEPTION 'storecalc_directory_role_is_overprivileged'
            USING ERRCODE = '42501';
    END IF;

    IF NOT has_database_privilege(migration_owner_role, current_database(), 'CREATE')
       OR has_database_privilege(web_role, current_database(), 'CREATE')
       OR has_database_privilege(worker_role, current_database(), 'CREATE')
       OR has_database_privilege(backup_role, current_database(), 'CREATE') THEN
        RAISE EXCEPTION 'storecalc_directory_database_grant_mismatch'
            USING ERRCODE = '42501';
    END IF;

    FOREACH source_role IN ARRAY configured_roles LOOP
        FOREACH target_role IN ARRAY configured_roles LOOP
            IF source_role <> target_role
               AND pg_has_role(source_role, target_role, 'MEMBER') THEN
                RAISE EXCEPTION 'storecalc_directory_role_inheritance_mismatch'
                    USING ERRCODE = '42501';
            END IF;
        END LOOP;
    END LOOP;

    IF to_regnamespace('storecalc') IS NULL
       OR to_regclass('storecalc.schema_capabilities') IS NULL THEN
        RAISE EXCEPTION 'storecalc_directory_foundation_missing'
            USING ERRCODE = '55000';
    END IF;

    SELECT pg_get_userbyid(nspowner)
    INTO schema_owner
    FROM pg_namespace
    WHERE nspname = 'storecalc';

    IF schema_owner IS DISTINCT FROM migration_owner_role THEN
        RAISE EXCEPTION 'storecalc_directory_schema_owner_mismatch'
            USING ERRCODE = '42501';
    END IF;

    SELECT array_agg(format('%s:%s', relname, relkind) ORDER BY relname)
    INTO actual_relations
    FROM pg_class
    WHERE relnamespace = 'storecalc'::regnamespace;

    IF actual_relations IS DISTINCT FROM ARRAY[
        'schema_capabilities:r',
        'schema_capabilities_capability_key_key:i',
        'schema_capabilities_id_seq:S',
        'schema_capabilities_pkey:i'
    ]::text[] THEN
        RAISE EXCEPTION 'storecalc_directory_foundation_relation_mismatch'
            USING ERRCODE = '55000';
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
        '2:public.directory:0:f:0001_schema_foundation',
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
               AND (
                   verified_at IS NOT NULL
                   OR updated_at IS DISTINCT FROM (
                       SELECT verified_at
                       FROM storecalc.schema_capabilities
                       WHERE capability_key = 'schema.foundation'
                   )
               )
           )
       ) THEN
        RAISE EXCEPTION 'storecalc_directory_foundation_capability_mismatch'
            USING ERRCODE = '55000';
    END IF;

    IF to_regclass('public.users') IS NULL THEN
        RAISE EXCEPTION 'storecalc_directory_users_identity_mismatch'
            USING ERRCODE = '55000';
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
        RAISE EXCEPTION 'storecalc_directory_users_identity_mismatch'
            USING ERRCODE = '55000';
    END IF;

    IF NOT has_column_privilege(
        migration_owner_role,
        'public.users',
        'id',
        'REFERENCES'
    ) THEN
        RAISE EXCEPTION 'storecalc_directory_users_reference_denied'
            USING ERRCODE = '42501';
    END IF;
END
$storecalc_directory_preflight$;

CREATE TABLE storecalc.contributor_subjects (
    id integer GENERATED BY DEFAULT AS IDENTITY,
    user_id integer,
    subject_generation integer NOT NULL DEFAULT 1,
    status text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    anonymized_at timestamptz,
    CONSTRAINT contributor_subjects_pkey
        PRIMARY KEY (id),
    CONSTRAINT contributor_subjects_user_id_key
        UNIQUE (user_id),
    CONSTRAINT contributor_subjects_user_id_fkey
        FOREIGN KEY (user_id)
        REFERENCES public.users(id)
        ON DELETE SET NULL,
    CONSTRAINT contributor_subjects_generation_check
        CHECK (subject_generation >= 1),
    CONSTRAINT contributor_subjects_status_format_check
        CHECK (
            char_length(status) BETWEEN 1 AND 32
            AND octet_length(status) <= 32
            AND status ~ '^[a-z][a-z0-9_]*$'
        ),
    CONSTRAINT contributor_subjects_anonymized_state_check
        CHECK (
            (status = 'anonymized') = (anonymized_at IS NOT NULL)
            AND (status <> 'anonymized' OR user_id IS NULL)
            AND (anonymized_at IS NULL OR anonymized_at >= created_at)
        )
);

CREATE TABLE storecalc.reviewed_timezones (
    timezone_name text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    reviewed_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    CONSTRAINT reviewed_timezones_pkey
        PRIMARY KEY (timezone_name),
    CONSTRAINT reviewed_timezones_name_format_check
        CHECK (
            char_length(timezone_name) BETWEEN 1 AND 64
            AND octet_length(timezone_name) <= 64
            AND (
                timezone_name = 'UTC'
                OR timezone_name ~ '^[A-Za-z][A-Za-z0-9._+-]*(/[A-Za-z0-9._+-]+)+$'
            )
        )
);

CREATE TABLE storecalc.countries (
    id integer GENERATED BY DEFAULT AS IDENTITY,
    code_alpha2 text NOT NULL,
    code_alpha3 text,
    official_name text NOT NULL,
    native_name text,
    support_status text NOT NULL,
    active boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    CONSTRAINT countries_pkey
        PRIMARY KEY (id),
    CONSTRAINT countries_code_alpha2_key
        UNIQUE (code_alpha2),
    CONSTRAINT countries_code_alpha3_key
        UNIQUE (code_alpha3),
    CONSTRAINT countries_code_alpha2_format_check
        CHECK (code_alpha2 ~ '^[A-Z]{2}$'),
    CONSTRAINT countries_code_alpha3_format_check
        CHECK (code_alpha3 IS NULL OR code_alpha3 ~ '^[A-Z]{3}$'),
    CONSTRAINT countries_official_name_check
        CHECK (
            char_length(official_name) BETWEEN 1 AND 200
            AND octet_length(official_name) <= 800
            AND official_name = btrim(official_name)
            AND official_name !~ '[[:cntrl:]]'
        ),
    CONSTRAINT countries_native_name_check
        CHECK (
            native_name IS NULL
            OR (
                char_length(native_name) BETWEEN 1 AND 200
                AND octet_length(native_name) <= 800
                AND native_name = btrim(native_name)
                AND native_name !~ '[[:cntrl:]]'
            )
        ),
    CONSTRAINT countries_support_status_check
        CHECK (
            support_status IN (
                'full_directory',
                'limited_directory',
                'community_starting',
                'requested',
                'unsupported'
            )
        ),
    CONSTRAINT countries_timestamp_order_check
        CHECK (updated_at >= created_at)
);

CREATE TABLE storecalc.jurisdictions (
    id integer GENERATED BY DEFAULT AS IDENTITY,
    country_id integer NOT NULL,
    parent_jurisdiction_id integer,
    jurisdiction_type text NOT NULL,
    official_name text NOT NULL,
    native_name text,
    code text,
    active boolean NOT NULL,
    CONSTRAINT jurisdictions_pkey
        PRIMARY KEY (id),
    CONSTRAINT jurisdictions_id_country_key
        UNIQUE (id, country_id),
    CONSTRAINT jurisdictions_country_id_fkey
        FOREIGN KEY (country_id)
        REFERENCES storecalc.countries(id)
        ON DELETE RESTRICT,
    CONSTRAINT jurisdictions_parent_country_fkey
        FOREIGN KEY (parent_jurisdiction_id, country_id)
        REFERENCES storecalc.jurisdictions(id, country_id)
        ON DELETE RESTRICT,
    CONSTRAINT jurisdictions_parent_not_self_check
        CHECK (parent_jurisdiction_id IS NULL OR parent_jurisdiction_id <> id),
    CONSTRAINT jurisdictions_type_format_check
        CHECK (
            char_length(jurisdiction_type) BETWEEN 1 AND 32
            AND octet_length(jurisdiction_type) <= 32
            AND jurisdiction_type ~ '^[a-z][a-z0-9_]*$'
        ),
    CONSTRAINT jurisdictions_official_name_check
        CHECK (
            char_length(official_name) BETWEEN 1 AND 200
            AND octet_length(official_name) <= 800
            AND official_name = btrim(official_name)
            AND official_name !~ '[[:cntrl:]]'
        ),
    CONSTRAINT jurisdictions_native_name_check
        CHECK (
            native_name IS NULL
            OR (
                char_length(native_name) BETWEEN 1 AND 200
                AND octet_length(native_name) <= 800
                AND native_name = btrim(native_name)
                AND native_name !~ '[[:cntrl:]]'
            )
        ),
    CONSTRAINT jurisdictions_code_check
        CHECK (
            code IS NULL
            OR (
                char_length(code) BETWEEN 1 AND 32
                AND octet_length(code) <= 32
                AND code = btrim(code)
                AND code !~ '[[:cntrl:]]'
            )
        )
);

CREATE INDEX jurisdictions_parent_country_idx
    ON storecalc.jurisdictions (parent_jurisdiction_id, country_id)
    WHERE parent_jurisdiction_id IS NOT NULL;

CREATE INDEX jurisdictions_country_name_idx
    ON storecalc.jurisdictions (country_id, official_name);

CREATE TABLE storecalc.agencies (
    id integer GENERATED BY DEFAULT AS IDENTITY,
    country_id integer NOT NULL,
    governing_jurisdiction_id integer,
    official_name text NOT NULL,
    native_name text,
    agency_type text,
    status text NOT NULL,
    official_url text,
    CONSTRAINT agencies_pkey
        PRIMARY KEY (id),
    CONSTRAINT agencies_id_country_key
        UNIQUE (id, country_id),
    CONSTRAINT agencies_country_id_fkey
        FOREIGN KEY (country_id)
        REFERENCES storecalc.countries(id)
        ON DELETE RESTRICT,
    CONSTRAINT agencies_governing_country_fkey
        FOREIGN KEY (governing_jurisdiction_id, country_id)
        REFERENCES storecalc.jurisdictions(id, country_id)
        ON DELETE RESTRICT,
    CONSTRAINT agencies_official_name_check
        CHECK (
            char_length(official_name) BETWEEN 1 AND 200
            AND octet_length(official_name) <= 800
            AND official_name = btrim(official_name)
            AND official_name !~ '[[:cntrl:]]'
        ),
    CONSTRAINT agencies_native_name_check
        CHECK (
            native_name IS NULL
            OR (
                char_length(native_name) BETWEEN 1 AND 200
                AND octet_length(native_name) <= 800
                AND native_name = btrim(native_name)
                AND native_name !~ '[[:cntrl:]]'
            )
        ),
    CONSTRAINT agencies_type_format_check
        CHECK (
            agency_type IS NULL
            OR (
                char_length(agency_type) BETWEEN 1 AND 32
                AND octet_length(agency_type) <= 32
                AND agency_type ~ '^[a-z][a-z0-9_]*$'
            )
        ),
    CONSTRAINT agencies_status_format_check
        CHECK (
            char_length(status) BETWEEN 1 AND 32
            AND octet_length(status) <= 32
            AND status ~ '^[a-z][a-z0-9_]*$'
        ),
    CONSTRAINT agencies_official_url_check
        CHECK (
            official_url IS NULL
            OR (
                char_length(official_url) BETWEEN 9 AND 2048
                AND octet_length(official_url) <= 4096
                AND official_url ~ '^https://[^[:space:]]+$'
                AND official_url !~ '[[:cntrl:]]'
            )
        )
);

CREATE INDEX agencies_governing_country_idx
    ON storecalc.agencies (governing_jurisdiction_id, country_id)
    WHERE governing_jurisdiction_id IS NOT NULL;

CREATE INDEX agencies_country_name_idx
    ON storecalc.agencies (country_id, official_name);

CREATE TABLE storecalc.facilities (
    id integer GENERATED BY DEFAULT AS IDENTITY,
    physical_country_id integer NOT NULL,
    physical_jurisdiction_id integer,
    agency_id integer,
    record_scope text NOT NULL,
    owner_user_id integer,
    official_name text NOT NULL,
    native_name text,
    facility_type text,
    locality text,
    timezone_name text,
    status text NOT NULL,
    merged_into_facility_id integer,
    created_by_subject_id integer,
    created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    lifecycle_generation integer NOT NULL DEFAULT 1,
    CONSTRAINT facilities_pkey
        PRIMARY KEY (id),
    CONSTRAINT facilities_id_country_key
        UNIQUE (id, physical_country_id),
    CONSTRAINT facilities_country_id_fkey
        FOREIGN KEY (physical_country_id)
        REFERENCES storecalc.countries(id)
        ON DELETE RESTRICT,
    CONSTRAINT facilities_jurisdiction_country_fkey
        FOREIGN KEY (physical_jurisdiction_id, physical_country_id)
        REFERENCES storecalc.jurisdictions(id, country_id)
        ON DELETE RESTRICT,
    CONSTRAINT facilities_agency_country_fkey
        FOREIGN KEY (agency_id, physical_country_id)
        REFERENCES storecalc.agencies(id, country_id)
        ON DELETE RESTRICT,
    CONSTRAINT facilities_owner_user_id_fkey
        FOREIGN KEY (owner_user_id)
        REFERENCES public.users(id)
        ON DELETE RESTRICT,
    CONSTRAINT facilities_timezone_name_fkey
        FOREIGN KEY (timezone_name)
        REFERENCES storecalc.reviewed_timezones(timezone_name)
        ON DELETE RESTRICT,
    CONSTRAINT facilities_merged_into_fkey
        FOREIGN KEY (merged_into_facility_id)
        REFERENCES storecalc.facilities(id)
        ON DELETE RESTRICT,
    CONSTRAINT facilities_created_by_subject_fkey
        FOREIGN KEY (created_by_subject_id)
        REFERENCES storecalc.contributor_subjects(id)
        ON DELETE RESTRICT,
    CONSTRAINT facilities_scope_check
        CHECK (record_scope IN ('public', 'private')),
    CONSTRAINT facilities_scope_owner_check
        CHECK (
            (record_scope = 'public' AND owner_user_id IS NULL)
            OR (record_scope = 'private' AND owner_user_id IS NOT NULL)
        ),
    CONSTRAINT facilities_official_name_check
        CHECK (
            char_length(official_name) BETWEEN 1 AND 200
            AND octet_length(official_name) <= 800
            AND official_name = btrim(official_name)
            AND official_name !~ '[[:cntrl:]]'
        ),
    CONSTRAINT facilities_native_name_check
        CHECK (
            native_name IS NULL
            OR (
                char_length(native_name) BETWEEN 1 AND 200
                AND octet_length(native_name) <= 800
                AND native_name = btrim(native_name)
                AND native_name !~ '[[:cntrl:]]'
            )
        ),
    CONSTRAINT facilities_type_format_check
        CHECK (
            facility_type IS NULL
            OR (
                char_length(facility_type) BETWEEN 1 AND 32
                AND octet_length(facility_type) <= 32
                AND facility_type ~ '^[a-z][a-z0-9_]*$'
            )
        ),
    CONSTRAINT facilities_locality_check
        CHECK (
            locality IS NULL
            OR (
                char_length(locality) BETWEEN 1 AND 200
                AND octet_length(locality) <= 800
                AND locality = btrim(locality)
                AND locality !~ '[[:cntrl:]]'
            )
        ),
    CONSTRAINT facilities_status_check
        CHECK (status IN ('active', 'renamed', 'closed', 'merged', 'provisional')),
    CONSTRAINT facilities_provisional_scope_check
        CHECK (status <> 'provisional' OR record_scope = 'private'),
    CONSTRAINT facilities_merge_state_check
        CHECK (
            (status = 'merged') = (merged_into_facility_id IS NOT NULL)
            AND (merged_into_facility_id IS NULL OR merged_into_facility_id <> id)
        ),
    CONSTRAINT facilities_timestamp_order_check
        CHECK (updated_at >= created_at),
    CONSTRAINT facilities_generation_check
        CHECK (lifecycle_generation >= 1)
);

CREATE INDEX facilities_jurisdiction_country_idx
    ON storecalc.facilities (physical_jurisdiction_id, physical_country_id)
    WHERE physical_jurisdiction_id IS NOT NULL;

CREATE INDEX facilities_agency_country_idx
    ON storecalc.facilities (agency_id, physical_country_id)
    WHERE agency_id IS NOT NULL;

CREATE INDEX facilities_owner_idx
    ON storecalc.facilities (owner_user_id)
    WHERE owner_user_id IS NOT NULL;

CREATE INDEX facilities_timezone_idx
    ON storecalc.facilities (timezone_name)
    WHERE timezone_name IS NOT NULL;

CREATE INDEX facilities_merge_idx
    ON storecalc.facilities (merged_into_facility_id)
    WHERE merged_into_facility_id IS NOT NULL;

CREATE INDEX facilities_created_by_subject_idx
    ON storecalc.facilities (created_by_subject_id)
    WHERE created_by_subject_id IS NOT NULL;

CREATE INDEX facilities_country_name_idx
    ON storecalc.facilities (physical_country_id, official_name);

CREATE TABLE storecalc.facility_aliases (
    id integer GENERATED BY DEFAULT AS IDENTITY,
    facility_id integer NOT NULL,
    alias text NOT NULL,
    normalized_alias text NOT NULL,
    alias_type text NOT NULL,
    language_tag text,
    created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    retired_at timestamptz,
    CONSTRAINT facility_aliases_pkey
        PRIMARY KEY (id),
    CONSTRAINT facility_aliases_facility_id_fkey
        FOREIGN KEY (facility_id)
        REFERENCES storecalc.facilities(id)
        ON DELETE RESTRICT,
    CONSTRAINT facility_aliases_alias_check
        CHECK (
            char_length(alias) BETWEEN 1 AND 200
            AND octet_length(alias) <= 800
            AND alias = btrim(alias)
            AND alias !~ '[[:cntrl:]]'
        ),
    CONSTRAINT facility_aliases_normalized_check
        CHECK (
            char_length(normalized_alias) BETWEEN 1 AND 240
            AND octet_length(normalized_alias) <= 960
            AND normalized_alias = btrim(normalized_alias)
            AND normalized_alias !~ '[[:cntrl:]]'
        ),
    CONSTRAINT facility_aliases_type_format_check
        CHECK (
            char_length(alias_type) BETWEEN 1 AND 32
            AND octet_length(alias_type) <= 32
            AND alias_type ~ '^[a-z][a-z0-9_]*$'
        ),
    CONSTRAINT facility_aliases_language_tag_check
        CHECK (
            language_tag IS NULL
            OR (
                char_length(language_tag) BETWEEN 1 AND 63
                AND octet_length(language_tag) <= 63
                AND language_tag ~ '^[A-Za-z0-9]{1,8}(-[A-Za-z0-9]{1,8})*$'
            )
        ),
    CONSTRAINT facility_aliases_retired_order_check
        CHECK (retired_at IS NULL OR retired_at >= created_at)
);

CREATE UNIQUE INDEX facility_aliases_identity_key
    ON storecalc.facility_aliases (
        facility_id,
        normalized_alias,
        alias_type,
        COALESCE(language_tag, '')
    );

CREATE INDEX facility_aliases_search_idx
    ON storecalc.facility_aliases (normalized_alias, facility_id);

CREATE TABLE storecalc.facility_sources (
    id integer GENERATED BY DEFAULT AS IDENTITY,
    facility_id integer NOT NULL,
    source_type text NOT NULL,
    source_url text NOT NULL,
    source_title text NOT NULL,
    source_date date,
    last_checked_at timestamptz,
    last_seen_at timestamptz,
    content_hash text,
    created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    CONSTRAINT facility_sources_pkey
        PRIMARY KEY (id),
    CONSTRAINT facility_sources_facility_url_key
        UNIQUE (facility_id, source_url),
    CONSTRAINT facility_sources_facility_id_fkey
        FOREIGN KEY (facility_id)
        REFERENCES storecalc.facilities(id)
        ON DELETE RESTRICT,
    CONSTRAINT facility_sources_type_format_check
        CHECK (
            char_length(source_type) BETWEEN 1 AND 32
            AND octet_length(source_type) <= 32
            AND source_type ~ '^[a-z][a-z0-9_]*$'
        ),
    CONSTRAINT facility_sources_url_check
        CHECK (
            char_length(source_url) BETWEEN 9 AND 2048
            AND octet_length(source_url) <= 4096
            AND source_url ~ '^https://[^[:space:]]+$'
            AND source_url !~ '[[:cntrl:]]'
        ),
    CONSTRAINT facility_sources_title_check
        CHECK (
            char_length(source_title) BETWEEN 1 AND 300
            AND octet_length(source_title) <= 1200
            AND source_title = btrim(source_title)
            AND source_title !~ '[[:cntrl:]]'
        ),
    CONSTRAINT facility_sources_check_order_check
        CHECK (
            last_seen_at IS NULL
            OR (
                last_checked_at IS NOT NULL
                AND last_seen_at <= last_checked_at
            )
        ),
    CONSTRAINT facility_sources_content_hash_check
        CHECK (content_hash IS NULL OR content_hash ~ '^[a-f0-9]{64}$')
);

CREATE INDEX facility_sources_facility_checked_idx
    ON storecalc.facility_sources (facility_id, last_checked_at DESC NULLS LAST);

CREATE FUNCTION storecalc.assert_reviewed_timezone_exists()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storecalc
AS $storecalc_timezone_function$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_timezone_names
        WHERE name = NEW.timezone_name
    ) THEN
        RAISE EXCEPTION 'storecalc_timezone_not_in_database_tzdata'
            USING ERRCODE = '22023';
    END IF;

    RETURN NEW;
END
$storecalc_timezone_function$;

CREATE FUNCTION storecalc.assert_jurisdiction_acyclic()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storecalc
AS $storecalc_jurisdiction_function$
DECLARE
    cycle_found boolean;
BEGIN
    IF NEW.parent_jurisdiction_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.parent_jurisdiction_id = NEW.id THEN
        RAISE EXCEPTION 'storecalc_jurisdiction_cycle'
            USING ERRCODE = '23514';
    END IF;

    LOCK TABLE storecalc.jurisdictions IN SHARE ROW EXCLUSIVE MODE;

    WITH RECURSIVE ancestors AS (
        SELECT
            jurisdiction.id,
            jurisdiction.parent_jurisdiction_id,
            ARRAY[jurisdiction.id] AS path,
            false AS cycle
        FROM storecalc.jurisdictions AS jurisdiction
        WHERE jurisdiction.id = NEW.parent_jurisdiction_id

        UNION ALL

        SELECT
            jurisdiction.id,
            jurisdiction.parent_jurisdiction_id,
            ancestor.path || jurisdiction.id,
            jurisdiction.id = ANY (ancestor.path)
        FROM storecalc.jurisdictions AS jurisdiction
        JOIN ancestors AS ancestor
          ON jurisdiction.id = ancestor.parent_jurisdiction_id
        WHERE NOT ancestor.cycle
    )
    SELECT EXISTS (
        SELECT 1
        FROM ancestors
        WHERE id = NEW.id OR cycle
    )
    INTO cycle_found;

    IF cycle_found THEN
        RAISE EXCEPTION 'storecalc_jurisdiction_cycle'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END
$storecalc_jurisdiction_function$;

CREATE FUNCTION storecalc.assert_facility_merge_acyclic()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storecalc
AS $storecalc_facility_merge_function$
DECLARE
    cycle_found boolean;
BEGIN
    IF NEW.merged_into_facility_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.merged_into_facility_id = NEW.id THEN
        RAISE EXCEPTION 'storecalc_facility_merge_cycle'
            USING ERRCODE = '23514';
    END IF;

    LOCK TABLE storecalc.facilities IN SHARE ROW EXCLUSIVE MODE;

    WITH RECURSIVE destinations AS (
        SELECT
            facility.id,
            facility.merged_into_facility_id,
            ARRAY[facility.id] AS path,
            false AS cycle
        FROM storecalc.facilities AS facility
        WHERE facility.id = NEW.merged_into_facility_id

        UNION ALL

        SELECT
            facility.id,
            facility.merged_into_facility_id,
            destination.path || facility.id,
            facility.id = ANY (destination.path)
        FROM storecalc.facilities AS facility
        JOIN destinations AS destination
          ON facility.id = destination.merged_into_facility_id
        WHERE NOT destination.cycle
    )
    SELECT EXISTS (
        SELECT 1
        FROM destinations
        WHERE id = NEW.id OR cycle
    )
    INTO cycle_found;

    IF cycle_found THEN
        RAISE EXCEPTION 'storecalc_facility_merge_cycle'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END
$storecalc_facility_merge_function$;

CREATE TRIGGER reviewed_timezones_validate_trigger
BEFORE INSERT OR UPDATE ON storecalc.reviewed_timezones
FOR EACH ROW
EXECUTE FUNCTION storecalc.assert_reviewed_timezone_exists();

CREATE TRIGGER jurisdictions_acyclic_trigger
BEFORE INSERT OR UPDATE ON storecalc.jurisdictions
FOR EACH ROW
EXECUTE FUNCTION storecalc.assert_jurisdiction_acyclic();

CREATE TRIGGER facilities_merge_acyclic_trigger
BEFORE INSERT OR UPDATE ON storecalc.facilities
FOR EACH ROW
EXECUTE FUNCTION storecalc.assert_facility_merge_acyclic();

REVOKE ALL ON TABLE
    storecalc.contributor_subjects,
    storecalc.reviewed_timezones,
    storecalc.countries,
    storecalc.jurisdictions,
    storecalc.agencies,
    storecalc.facilities,
    storecalc.facility_aliases,
    storecalc.facility_sources
FROM PUBLIC;

REVOKE ALL ON SEQUENCE
    storecalc.contributor_subjects_id_seq,
    storecalc.countries_id_seq,
    storecalc.jurisdictions_id_seq,
    storecalc.agencies_id_seq,
    storecalc.facilities_id_seq,
    storecalc.facility_aliases_id_seq,
    storecalc.facility_sources_id_seq
FROM PUBLIC;

REVOKE ALL ON FUNCTION
    storecalc.assert_reviewed_timezone_exists(),
    storecalc.assert_jurisdiction_acyclic(),
    storecalc.assert_facility_merge_acyclic()
FROM PUBLIC;

DO $storecalc_directory_grants$
DECLARE
    backup_role text := current_setting('storecalc.backup_role');
BEGIN
    EXECUTE format(
        'GRANT SELECT ON TABLE '
        'storecalc.contributor_subjects, '
        'storecalc.reviewed_timezones, '
        'storecalc.countries, '
        'storecalc.jurisdictions, '
        'storecalc.agencies, '
        'storecalc.facilities, '
        'storecalc.facility_aliases, '
        'storecalc.facility_sources TO %I',
        backup_role
    );

    EXECUTE format(
        'GRANT SELECT ON SEQUENCE '
        'storecalc.contributor_subjects_id_seq, '
        'storecalc.countries_id_seq, '
        'storecalc.jurisdictions_id_seq, '
        'storecalc.agencies_id_seq, '
        'storecalc.facilities_id_seq, '
        'storecalc.facility_aliases_id_seq, '
        'storecalc.facility_sources_id_seq TO %I',
        backup_role
    );
END
$storecalc_directory_grants$;

UPDATE storecalc.schema_capabilities
SET schema_version = 1,
    migration_key = '0002_directory_lineage',
    updated_at = transaction_timestamp()
WHERE capability_key = 'public.directory'
  AND schema_version = 0
  AND NOT is_available
  AND verified_at IS NULL
  AND migration_key = '0001_schema_foundation';

DO $storecalc_directory_postflight$
DECLARE
    migration_owner_role text := current_setting('storecalc.migration_owner_role');
    web_role text := current_setting('storecalc.web_role');
    worker_role text := current_setting('storecalc.worker_role');
    backup_role text := current_setting('storecalc.backup_role');
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
    new_sequences constant text[] := ARRAY[
        'storecalc.contributor_subjects_id_seq',
        'storecalc.countries_id_seq',
        'storecalc.jurisdictions_id_seq',
        'storecalc.agencies_id_seq',
        'storecalc.facilities_id_seq',
        'storecalc.facility_aliases_id_seq',
        'storecalc.facility_sources_id_seq'
    ];
    allowed_grantee_oids oid[];
    object_name text;
BEGIN
    SELECT array_agg(oid ORDER BY oid)
    INTO allowed_grantee_oids
    FROM pg_roles
    WHERE rolname = ANY (
        ARRAY[
            migration_owner_role,
            web_role,
            worker_role,
            backup_role
        ]
    );

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

    FOREACH object_name IN ARRAY new_sequences LOOP
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

    IF NOT EXISTS (
        SELECT 1
        FROM storecalc.schema_capabilities
        WHERE capability_key = 'public.directory'
          AND schema_version = 1
          AND NOT is_available
          AND verified_at IS NULL
          AND migration_key = '0002_directory_lineage'
    ) THEN
        RAISE EXCEPTION 'storecalc_directory_capability_state_mismatch';
    END IF;
END
$storecalc_directory_postflight$;

COMMIT;
