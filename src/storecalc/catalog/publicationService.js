export const CATALOG_PUBLICATION_TRANSITION_VERSION =
    "storecalc.catalog-publication-transition.v1";

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const REASON_CODE_PATTERN = /^[a-z][a-z0-9_]*$/;
const INPUT_KEYS = Object.freeze([
    "templateId",
    "versionId",
    "expectedCurrentPublicationId",
    "actorSubjectId",
    "reasonCode"
]);

const BEGIN_SQL = "BEGIN ISOLATION LEVEL READ COMMITTED";
const TIMEOUTS_SQL = `
    /* storecalc:catalog-publish:timeouts */
    SELECT
        set_config('lock_timeout', '3s', true),
        set_config('statement_timeout', '30s', true),
        set_config('idle_in_transaction_session_timeout', '30s', true)
`;
const MIGRATION_LOCK_SQL = `
    /* storecalc:catalog-publish:migration-lock */
    SELECT pg_advisory_xact_lock_shared(7356507374803211041)
`;
const TOPOLOGY_LOCK_SQL = `
    /* storecalc:catalog-publish:topology-lock */
    LOCK TABLE storecalc.template_versions IN SHARE ROW EXCLUSIVE MODE;
    LOCK TABLE storecalc.program_facility_assignments IN SHARE ROW EXCLUSIVE MODE;
    LOCK TABLE storecalc.template_publications IN SHARE ROW EXCLUSIVE MODE;
    LOCK TABLE storecalc.assignment_template_applicability IN SHARE ROW EXCLUSIVE MODE
`;
const CAPABILITY_SQL = `
    /* storecalc:catalog-publish:capability */
    SELECT schema_version, is_available, verified_at, migration_key
    FROM storecalc.schema_capabilities
    WHERE capability_key = 'anonymous.calculation'
    FOR SHARE
`;
const STATE_SQL = `
    /* storecalc:catalog-publish:state */
    SELECT
        version_row.id AS version_id,
        version_row.template_id,
        version_row.content_state,
        version_row.sealed_at,
        template_row.status AS template_status,
        program_row.status AS program_status,
        publication_row.id AS current_publication_id,
        publication_row.version_id AS current_version_id,
        publication_row.lifecycle_generation AS current_lifecycle_generation
    FROM storecalc.template_versions AS version_row
    JOIN storecalc.templates AS template_row
      ON template_row.id = version_row.template_id
    JOIN storecalc.store_programs AS program_row
      ON program_row.id = template_row.program_id
    LEFT JOIN storecalc.template_publications AS publication_row
      ON publication_row.template_id = template_row.id
     AND publication_row.ended_at IS NULL
    WHERE version_row.id = $1
      AND version_row.template_id = $2
`;
const CLOSE_SQL = `
    /* storecalc:catalog-publish:close */
    UPDATE storecalc.template_publications
    SET
        ended_at = transaction_timestamp(),
        ended_actor_type = 'owner',
        ended_by_subject_id = $3,
        ended_reason_code = $4,
        lifecycle_generation = lifecycle_generation + 1
    WHERE id = $1
      AND template_id = $2
      AND ended_at IS NULL
      AND lifecycle_generation = $5
    RETURNING id, lifecycle_generation
`;
const INSERT_SQL = `
    /* storecalc:catalog-publish:insert */
    WITH inserted AS (
        INSERT INTO storecalc.template_publications (
            template_id,
            version_id,
            started_at,
            actor_type,
            published_by_subject_id,
            reason_code
        ) VALUES ($1, $2, transaction_timestamp(), 'owner', $3, $4)
        RETURNING id, template_id, version_id, started_at, lifecycle_generation
    )
    SELECT
        id,
        template_id,
        version_id,
        to_char(
            started_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ) AS started_at,
        lifecycle_generation
    FROM inserted
`;

export class StoreCalcCatalogPublicationError extends Error {
    constructor(code, path = "$", options = undefined) {
        super(code, options);
        this.name = "StoreCalcCatalogPublicationError";
        this.code = code;
        this.path = path;
    }
}

function fail(code, path = "$", cause = undefined) {
    const options = cause === undefined ? undefined : { cause };
    throw new StoreCalcCatalogPublicationError(code, path, options);
}

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function requireId(value, path) {
    if (
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > MAX_POSTGRES_INTEGER
    ) {
        fail("PUBLICATION_INPUT_INVALID", path);
    }
    return value;
}

function requireNullableId(value, path) {
    return value === null ? null : requireId(value, path);
}

function normalizeInput(value) {
    if (!isPlainObject(value)) fail("PUBLICATION_INPUT_INVALID");
    const keys = Object.keys(value);
    if (
        keys.length !== INPUT_KEYS.length ||
        INPUT_KEYS.some(key => !Object.hasOwn(value, key))
    ) {
        fail("PUBLICATION_INPUT_INVALID");
    }
    if (
        typeof value.reasonCode !== "string" ||
        value.reasonCode.length < 1 ||
        value.reasonCode.length > 64 ||
        Buffer.byteLength(value.reasonCode, "utf8") > 64 ||
        !REASON_CODE_PATTERN.test(value.reasonCode)
    ) {
        fail("PUBLICATION_INPUT_INVALID", "$.reasonCode");
    }
    return Object.freeze({
        templateId: requireId(value.templateId, "$.templateId"),
        versionId: requireId(value.versionId, "$.versionId"),
        expectedCurrentPublicationId: requireNullableId(
            value.expectedCurrentPublicationId,
            "$.expectedCurrentPublicationId"
        ),
        actorSubjectId: requireId(value.actorSubjectId, "$.actorSubjectId"),
        reasonCode: value.reasonCode
    });
}

function assertDatabasePool(pool) {
    if (!pool || typeof pool !== "object" || typeof pool.connect !== "function") {
        fail("DATABASE_POOL_INVALID", "$.database");
    }
}

function rowsFrom(result, path) {
    if (!result || !Array.isArray(result.rows)) {
        fail("DATABASE_RESULT_INVALID", path);
    }
    return result.rows;
}

function requireDatabaseId(value, path) {
    if (
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > MAX_POSTGRES_INTEGER
    ) {
        fail("DATABASE_TYPE_DRIFT", path);
    }
    return value;
}

function requireNullableDatabaseId(value, path) {
    return value === null ? null : requireDatabaseId(value, path);
}

function assertCapability(result) {
    const rows = rowsFrom(result, "$.database.capability");
    if (rows.length !== 1) {
        fail("SCHEMA_CAPABILITY_UNSUPPORTED", "$.database.capability");
    }
    const row = rows[0];
    if (
        row.schema_version !== 9 ||
        row.is_available !== false ||
        row.verified_at !== null ||
        row.migration_key !== "0012_catalog_publication_applicability"
    ) {
        fail("SCHEMA_CAPABILITY_UNSUPPORTED", "$.database.capability");
    }
}

function normalizeState(result, input) {
    const rows = rowsFrom(result, "$.database.state");
    if (rows.length === 0) fail("VERSION_NOT_FOUND", "$.versionId");
    if (rows.length !== 1) {
        fail("DATABASE_RESULT_INVALID", "$.database.state");
    }
    const row = rows[0];
    if (
        requireDatabaseId(row.version_id, "$.database.state.versionId") !==
            input.versionId ||
        requireDatabaseId(row.template_id, "$.database.state.templateId") !==
            input.templateId
    ) {
        fail("CATALOG_LINEAGE_INVALID", "$.database.state");
    }
    if (row.content_state !== "sealed" || row.sealed_at === null) {
        fail("VERSION_NOT_SEALED", "$.versionId");
    }
    if (row.template_status !== "active" || row.program_status !== "active") {
        fail("PUBLICATION_PARENT_INACTIVE", "$.database.state");
    }
    const currentPublicationId = requireNullableDatabaseId(
        row.current_publication_id,
        "$.database.state.currentPublicationId"
    );
    const currentVersionId = requireNullableDatabaseId(
        row.current_version_id,
        "$.database.state.currentVersionId"
    );
    const currentLifecycleGeneration = requireNullableDatabaseId(
        row.current_lifecycle_generation,
        "$.database.state.currentLifecycleGeneration"
    );
    const allCurrentNull =
        currentPublicationId === null &&
        currentVersionId === null &&
        currentLifecycleGeneration === null;
    const allCurrentPresent =
        currentPublicationId !== null &&
        currentVersionId !== null &&
        currentLifecycleGeneration !== null;
    if (!allCurrentNull && !allCurrentPresent) {
        fail("DATABASE_RESULT_INVALID", "$.database.state.currentPublication");
    }
    if (currentPublicationId !== input.expectedCurrentPublicationId) {
        fail("CURRENT_PUBLICATION_CHANGED", "$.expectedCurrentPublicationId");
    }
    if (currentVersionId === input.versionId) {
        fail("VERSION_ALREADY_CURRENT", "$.versionId");
    }
    return { currentPublicationId, currentLifecycleGeneration };
}

function assertCloseResult(result, state) {
    const rows = rowsFrom(result, "$.database.close");
    if (
        rows.length !== 1 ||
        requireDatabaseId(rows[0].id, "$.database.close.id") !==
            state.currentPublicationId ||
        requireDatabaseId(
            rows[0].lifecycle_generation,
            "$.database.close.lifecycleGeneration"
        ) !==
            state.currentLifecycleGeneration + 1
    ) {
        fail("CURRENT_PUBLICATION_CHANGED", "$.database.close");
    }
}

function normalizeInserted(result, input) {
    const rows = rowsFrom(result, "$.database.insert");
    if (rows.length !== 1) {
        fail("PUBLICATION_INSERT_INVALID", "$.database.insert");
    }
    const row = rows[0];
    if (
        requireDatabaseId(row.template_id, "$.database.insert.templateId") !==
            input.templateId ||
        requireDatabaseId(row.version_id, "$.database.insert.versionId") !==
            input.versionId ||
        requireDatabaseId(
            row.lifecycle_generation,
            "$.database.insert.lifecycleGeneration"
        ) !== 1 ||
        typeof row.started_at !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(
            row.started_at
        )
    ) {
        fail("PUBLICATION_INSERT_INVALID", "$.database.insert");
    }
    return Object.freeze({
        id: requireDatabaseId(row.id, "$.database.insert.id"),
        templateId: input.templateId,
        versionId: input.versionId,
        startedAt: row.started_at,
        lifecycleGeneration: 1
    });
}

export async function publishCatalogVersion(pool, value) {
    assertDatabasePool(pool);
    const input = normalizeInput(value);
    const client = await pool.connect();
    if (
        !client ||
        typeof client.query !== "function" ||
        typeof client.release !== "function"
    ) {
        fail("DATABASE_CLIENT_INVALID", "$.database");
    }

    let transactionOpen = false;
    let destroyConnection = false;
    try {
        await client.query(BEGIN_SQL);
        transactionOpen = true;
        await client.query(TIMEOUTS_SQL);
        await client.query(MIGRATION_LOCK_SQL);
        await client.query(TOPOLOGY_LOCK_SQL);
        assertCapability(await client.query(CAPABILITY_SQL));
        const state = normalizeState(
            await client.query(STATE_SQL, [input.versionId, input.templateId]),
            input
        );
        if (state.currentPublicationId !== null) {
            assertCloseResult(
                await client.query(CLOSE_SQL, [
                    state.currentPublicationId,
                    input.templateId,
                    input.actorSubjectId,
                    input.reasonCode,
                    state.currentLifecycleGeneration
                ]),
                state
            );
        }
        const publication = normalizeInserted(
            await client.query(INSERT_SQL, [
                input.templateId,
                input.versionId,
                input.actorSubjectId,
                input.reasonCode
            ]),
            input
        );
        await client.query("COMMIT");
        transactionOpen = false;
        return Object.freeze({
            transitionVersion: CATALOG_PUBLICATION_TRANSITION_VERSION,
            replacedPublicationId: state.currentPublicationId,
            publication
        });
    } catch (error) {
        if (transactionOpen) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                destroyConnection = true;
                fail(
                    "TRANSACTION_ROLLBACK_FAILED",
                    "$.database",
                    new AggregateError([error, rollbackError])
                );
            }
        }
        throw error;
    } finally {
        client.release(
            destroyConnection
                ? new Error("storecalc_catalog_publication_connection_uncertain")
                : undefined
        );
    }
}
