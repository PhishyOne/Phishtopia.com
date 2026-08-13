export const CATALOG_APPLICABILITY_TRANSITION_VERSION =
    "storecalc.catalog-applicability-transition.v1";

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const REASON_CODE_PATTERN = /^[a-z][a-z0-9_]*$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const INPUT_KEYS = Object.freeze([
    "assignmentId",
    "programId",
    "facilityId",
    "templateId",
    "selection",
    "validFrom",
    "validThrough",
    "applicabilityState",
    "replacesApplicabilityId",
    "actorSubjectId",
    "reasonCode"
]);
const SELECTION_KEYS = Object.freeze(["mode", "targetId"]);

const BEGIN_SQL = "BEGIN ISOLATION LEVEL READ COMMITTED";
const TIMEOUTS_SQL = `
    /* storecalc:catalog-applicability:timeouts */
    SELECT
        set_config('lock_timeout', '3s', true),
        set_config('statement_timeout', '30s', true),
        set_config('idle_in_transaction_session_timeout', '30s', true)
`;
const MIGRATION_LOCK_SQL = `
    /* storecalc:catalog-applicability:migration-lock */
    SELECT pg_advisory_xact_lock_shared(7356507374803211041)
`;
const TOPOLOGY_LOCK_SQL = `
    /* storecalc:catalog-applicability:topology-lock */
    LOCK TABLE storecalc.template_versions IN SHARE ROW EXCLUSIVE MODE;
    LOCK TABLE storecalc.program_facility_assignments IN SHARE ROW EXCLUSIVE MODE;
    LOCK TABLE storecalc.template_publications IN SHARE ROW EXCLUSIVE MODE;
    LOCK TABLE storecalc.assignment_template_applicability IN SHARE ROW EXCLUSIVE MODE
`;
const CAPABILITY_SQL = `
    /* storecalc:catalog-applicability:capability */
    SELECT schema_version, is_available, verified_at, migration_key
    FROM storecalc.schema_capabilities
    WHERE capability_key = 'anonymous.calculation'
    FOR SHARE
`;
const STATE_SQL = `
    /* storecalc:catalog-applicability:state */
    SELECT
        assignment_row.id AS assignment_id,
        assignment_row.program_id,
        assignment_row.facility_id,
        assignment_row.assignment_state,
        assignment_row.retired_at,
        to_char(assignment_row.valid_from, 'YYYY-MM-DD')
            AS assignment_valid_from,
        to_char(assignment_row.valid_through, 'YYYY-MM-DD')
            AS assignment_valid_through,
        program_row.status AS program_status,
        facility_row.status AS facility_status,
        template_row.id AS template_id,
        template_row.status AS template_status,
        CASE $5::text
            WHEN 'exact_version' THEN exact_version.id
            WHEN 'publication' THEN publication_version.id
        END AS selected_version_id,
        CASE $5::text
            WHEN 'exact_version' THEN exact_version.content_state
            WHEN 'publication' THEN publication_version.content_state
        END AS selected_version_state,
        publication_row.id AS selected_publication_id,
        replacement.id AS replacement_id,
        replacement.assignment_id AS replacement_assignment_id,
        replacement.program_id AS replacement_program_id,
        replacement.facility_id AS replacement_facility_id,
        replacement.template_id AS replacement_template_id,
        replacement.selection_mode AS replacement_selection_mode,
        replacement.exact_version_id AS replacement_exact_version_id,
        replacement.publication_id AS replacement_publication_id,
        to_char(replacement.valid_from, 'YYYY-MM-DD')
            AS replacement_valid_from,
        to_char(replacement.valid_through, 'YYYY-MM-DD')
            AS replacement_valid_through,
        replacement.applicability_state AS replacement_applicability_state,
        replacement.ended_at AS replacement_ended_at,
        replacement.lifecycle_generation AS replacement_lifecycle_generation
    FROM storecalc.program_facility_assignments AS assignment_row
    JOIN storecalc.store_programs AS program_row
      ON program_row.id = assignment_row.program_id
    JOIN storecalc.facilities AS facility_row
      ON facility_row.id = assignment_row.facility_id
    JOIN storecalc.templates AS template_row
      ON template_row.id = $4
     AND template_row.program_id = assignment_row.program_id
    LEFT JOIN storecalc.template_versions AS exact_version
      ON $5::text = 'exact_version'
     AND exact_version.id = $6
     AND exact_version.template_id = template_row.id
    LEFT JOIN storecalc.template_publications AS publication_row
      ON $5::text = 'publication'
     AND publication_row.id = $6
     AND publication_row.template_id = template_row.id
    LEFT JOIN storecalc.template_versions AS publication_version
      ON publication_version.id = publication_row.version_id
     AND publication_version.template_id = publication_row.template_id
    LEFT JOIN storecalc.assignment_template_applicability AS replacement
      ON replacement.id = $7
    WHERE assignment_row.id = $1
      AND assignment_row.program_id = $2
      AND assignment_row.facility_id = $3
`;
const CLOSE_SQL = `
    /* storecalc:catalog-applicability:close */
    UPDATE storecalc.assignment_template_applicability
    SET
        ended_at = transaction_timestamp(),
        ended_actor_type = 'owner',
        ended_by_subject_id = $4,
        ended_reason_code = $5,
        lifecycle_generation = lifecycle_generation + 1
    WHERE id = $1
      AND assignment_id = $2
      AND template_id = $3
      AND ended_at IS NULL
      AND lifecycle_generation = $6
    RETURNING id, lifecycle_generation
`;
const INSERT_SQL = `
    /* storecalc:catalog-applicability:insert */
    WITH inserted AS (
        INSERT INTO storecalc.assignment_template_applicability (
            assignment_id,
            program_id,
            facility_id,
            template_id,
            selection_mode,
            exact_version_id,
            publication_id,
            valid_from,
            valid_through,
            applicability_state,
            actor_type,
            recorded_by_subject_id,
            reason_code
        ) VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            CASE WHEN $5 = 'exact_version' THEN $6::integer ELSE NULL END,
            CASE WHEN $5 = 'publication' THEN $6::integer ELSE NULL END,
            $7::date,
            $8::date,
            $9,
            'owner',
            $10,
            $11
        )
        RETURNING
            id,
            assignment_id,
            program_id,
            facility_id,
            template_id,
            selection_mode,
            exact_version_id,
            publication_id,
            valid_from,
            valid_through,
            applicability_state,
            recorded_at,
            lifecycle_generation
    )
    SELECT
        id,
        assignment_id,
        program_id,
        facility_id,
        template_id,
        selection_mode,
        exact_version_id,
        publication_id,
        to_char(valid_from, 'YYYY-MM-DD') AS valid_from,
        to_char(valid_through, 'YYYY-MM-DD') AS valid_through,
        applicability_state,
        to_char(
            recorded_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ) AS recorded_at,
        lifecycle_generation
    FROM inserted
`;

export class StoreCalcCatalogApplicabilityError extends Error {
    constructor(code, path = "$", options = undefined) {
        super(code, options);
        this.name = "StoreCalcCatalogApplicabilityError";
        this.code = code;
        this.path = path;
    }
}

function fail(code, path = "$", cause = undefined) {
    const options = cause === undefined ? undefined : { cause };
    throw new StoreCalcCatalogApplicabilityError(code, path, options);
}

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, keys) {
    return (
        isPlainObject(value) &&
        Object.keys(value).length === keys.length &&
        keys.every(key => Object.hasOwn(value, key))
    );
}

function requireId(value, path) {
    if (
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > MAX_POSTGRES_INTEGER
    ) {
        fail("APPLICABILITY_INPUT_INVALID", path);
    }
    return value;
}

function requireNullableId(value, path) {
    return value === null ? null : requireId(value, path);
}

function requireDate(value, path) {
    if (value === null) return null;
    if (typeof value !== "string") {
        fail("APPLICABILITY_INPUT_INVALID", path);
    }
    const match = DATE_PATTERN.exec(value);
    if (!match) fail("APPLICABILITY_INPUT_INVALID", path);
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (
        year < 1 ||
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > days[month - 1]
    ) {
        fail("APPLICABILITY_INPUT_INVALID", path);
    }
    return value;
}

function normalizeInput(value) {
    if (!hasExactKeys(value, INPUT_KEYS)) fail("APPLICABILITY_INPUT_INVALID");
    if (!hasExactKeys(value.selection, SELECTION_KEYS)) {
        fail("APPLICABILITY_INPUT_INVALID", "$.selection");
    }
    if (!new Set(["exact_version", "publication"]).has(value.selection.mode)) {
        fail("APPLICABILITY_INPUT_INVALID", "$.selection.mode");
    }
    const validFrom = requireDate(value.validFrom, "$.validFrom");
    const validThrough = requireDate(value.validThrough, "$.validThrough");
    if (validFrom !== null && validThrough !== null && validThrough < validFrom) {
        fail("APPLICABILITY_INPUT_INVALID", "$.validThrough");
    }
    if (!new Set(["supported", "disputed"]).has(value.applicabilityState)) {
        fail("APPLICABILITY_INPUT_INVALID", "$.applicabilityState");
    }
    if (
        typeof value.reasonCode !== "string" ||
        value.reasonCode.length < 1 ||
        value.reasonCode.length > 64 ||
        Buffer.byteLength(value.reasonCode, "utf8") > 64 ||
        !REASON_CODE_PATTERN.test(value.reasonCode)
    ) {
        fail("APPLICABILITY_INPUT_INVALID", "$.reasonCode");
    }
    return Object.freeze({
        assignmentId: requireId(value.assignmentId, "$.assignmentId"),
        programId: requireId(value.programId, "$.programId"),
        facilityId: requireId(value.facilityId, "$.facilityId"),
        templateId: requireId(value.templateId, "$.templateId"),
        selection: Object.freeze({
            mode: value.selection.mode,
            targetId: requireId(value.selection.targetId, "$.selection.targetId")
        }),
        validFrom,
        validThrough,
        applicabilityState: value.applicabilityState,
        replacesApplicabilityId: requireNullableId(
            value.replacesApplicabilityId,
            "$.replacesApplicabilityId"
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

function requireNullableDatabaseDate(value, path) {
    if (value === null) return null;
    if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
        fail("DATABASE_TYPE_DRIFT", path);
    }
    return value;
}

function requireDatabaseString(value, path) {
    if (typeof value !== "string") fail("DATABASE_TYPE_DRIFT", path);
    return value;
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

function normalizeReplacement(row, input) {
    if (input.replacesApplicabilityId === null) {
        const replacementFields = [
            row.replacement_id,
            row.replacement_assignment_id,
            row.replacement_program_id,
            row.replacement_facility_id,
            row.replacement_template_id,
            row.replacement_selection_mode,
            row.replacement_exact_version_id,
            row.replacement_publication_id,
            row.replacement_valid_from,
            row.replacement_valid_through,
            row.replacement_applicability_state,
            row.replacement_ended_at,
            row.replacement_lifecycle_generation
        ];
        if (replacementFields.some(field => field !== null)) {
            fail("DATABASE_RESULT_INVALID", "$.database.replacement");
        }
        return null;
    }
    if (
        requireNullableDatabaseId(
            row.replacement_id,
            "$.database.replacement.id"
        ) !== input.replacesApplicabilityId
    ) {
        fail("CURRENT_APPLICABILITY_CHANGED", "$.replacesApplicabilityId");
    }
    const lineage = [
        [row.replacement_assignment_id, input.assignmentId],
        [row.replacement_program_id, input.programId],
        [row.replacement_facility_id, input.facilityId],
        [row.replacement_template_id, input.templateId]
    ];
    if (
        lineage.some(
            ([actual, expected]) =>
                requireDatabaseId(actual, "$.database.replacement.lineage") !==
                expected
        ) ||
        row.replacement_ended_at !== null ||
        requireDatabaseId(
            row.replacement_lifecycle_generation,
            "$.database.replacement.lifecycleGeneration"
        ) !== 1
    ) {
        fail("CURRENT_APPLICABILITY_CHANGED", "$.replacesApplicabilityId");
    }
    const replacementSelectionMode = requireDatabaseString(
        row.replacement_selection_mode,
        "$.database.replacement.selectionMode"
    );
    const oldTargetId =
        replacementSelectionMode === "exact_version"
            ? requireDatabaseId(
                  row.replacement_exact_version_id,
                  "$.database.replacement.exactVersionId"
              )
            : replacementSelectionMode === "publication"
              ? requireDatabaseId(
                    row.replacement_publication_id,
                    "$.database.replacement.publicationId"
                )
              : fail("DATABASE_TYPE_DRIFT", "$.database.replacement.selectionMode");
    if (
        (replacementSelectionMode === "exact_version" &&
            row.replacement_publication_id !== null) ||
        (replacementSelectionMode === "publication" &&
            row.replacement_exact_version_id !== null)
    ) {
        fail("DATABASE_TYPE_DRIFT", "$.database.replacement.selectionTarget");
    }
    const oldValidFrom = requireNullableDatabaseDate(
        row.replacement_valid_from,
        "$.database.replacement.validFrom"
    );
    const oldValidThrough = requireNullableDatabaseDate(
        row.replacement_valid_through,
        "$.database.replacement.validThrough"
    );
    const replacementState = requireDatabaseString(
        row.replacement_applicability_state,
        "$.database.replacement.applicabilityState"
    );
    if (!new Set(["supported", "disputed"]).has(replacementState)) {
        fail("DATABASE_TYPE_DRIFT", "$.database.replacement.applicabilityState");
    }
    if (
        replacementSelectionMode === input.selection.mode &&
        oldTargetId === input.selection.targetId &&
        oldValidFrom === input.validFrom &&
        oldValidThrough === input.validThrough &&
        replacementState === input.applicabilityState
    ) {
        fail("APPLICABILITY_UNCHANGED", "$.replacesApplicabilityId");
    }
    return Object.freeze({
        id: input.replacesApplicabilityId,
        lifecycleGeneration: 1
    });
}

function normalizeState(result, input) {
    const rows = rowsFrom(result, "$.database.state");
    if (rows.length === 0) fail("ASSIGNMENT_LINEAGE_NOT_FOUND", "$.assignmentId");
    if (rows.length !== 1) fail("DATABASE_RESULT_INVALID", "$.database.state");
    const row = rows[0];
    const lineage = [
        [row.assignment_id, input.assignmentId],
        [row.program_id, input.programId],
        [row.facility_id, input.facilityId],
        [row.template_id, input.templateId]
    ];
    if (
        lineage.some(
            ([actual, expected]) =>
                requireDatabaseId(actual, "$.database.state.lineage") !== expected
        )
    ) {
        fail("CATALOG_LINEAGE_INVALID", "$.database.state");
    }
    if (
        requireDatabaseString(
            row.assignment_state,
            "$.database.state.assignmentState"
        ) !== "supported" ||
        row.retired_at !== null ||
        requireDatabaseString(row.program_status, "$.database.state.programStatus") !==
            "active" ||
        !new Set(["active", "renamed", "provisional"]).has(
            requireDatabaseString(
                row.facility_status,
                "$.database.state.facilityStatus"
            )
        ) ||
        requireDatabaseString(
            row.template_status,
            "$.database.state.templateStatus"
        ) !== "active"
    ) {
        fail("APPLICABILITY_PARENT_INACTIVE", "$.database.state");
    }
    const assignmentValidFrom = requireNullableDatabaseDate(
        row.assignment_valid_from,
        "$.database.state.assignmentValidFrom"
    );
    const assignmentValidThrough = requireNullableDatabaseDate(
        row.assignment_valid_through,
        "$.database.state.assignmentValidThrough"
    );
    if (
        (assignmentValidFrom !== null &&
            (input.validFrom === null || input.validFrom < assignmentValidFrom)) ||
        (assignmentValidThrough !== null &&
            (input.validThrough === null ||
                input.validThrough > assignmentValidThrough))
    ) {
        fail("APPLICABILITY_INTERVAL_OUTSIDE_ASSIGNMENT", "$.validFrom");
    }
    const selectedVersionId = requireNullableDatabaseId(
        row.selected_version_id,
        "$.database.state.selectedVersionId"
    );
    if (selectedVersionId === null) {
        fail("APPLICABILITY_SELECTION_NOT_FOUND", "$.selection");
    }
    if (
        input.selection.mode === "exact_version" &&
        selectedVersionId !== input.selection.targetId
    ) {
        fail("CATALOG_LINEAGE_INVALID", "$.selection");
    }
    if (row.selected_version_state !== "sealed") {
        fail("APPLICABILITY_VERSION_NOT_SEALED", "$.selection");
    }
    if (
        input.selection.mode === "publication" &&
        requireNullableDatabaseId(
            row.selected_publication_id,
            "$.database.state.selectedPublicationId"
        ) !== input.selection.targetId
    ) {
        fail("CATALOG_LINEAGE_INVALID", "$.selection");
    }
    if (
        input.selection.mode === "exact_version" &&
        row.selected_publication_id !== null
    ) {
        fail("DATABASE_RESULT_INVALID", "$.database.state.selectedPublicationId");
    }
    return normalizeReplacement(row, input);
}

function assertCloseResult(result, replacement) {
    const rows = rowsFrom(result, "$.database.close");
    if (
        rows.length !== 1 ||
        requireDatabaseId(rows[0].id, "$.database.close.id") !== replacement.id ||
        requireDatabaseId(
            rows[0].lifecycle_generation,
            "$.database.close.lifecycleGeneration"
        ) !==
            replacement.lifecycleGeneration + 1
    ) {
        fail("CURRENT_APPLICABILITY_CHANGED", "$.database.close");
    }
}

function normalizeInserted(result, input) {
    const rows = rowsFrom(result, "$.database.insert");
    if (rows.length !== 1) {
        fail("APPLICABILITY_INSERT_INVALID", "$.database.insert");
    }
    const row = rows[0];
    const lineage = [
        [row.assignment_id, input.assignmentId],
        [row.program_id, input.programId],
        [row.facility_id, input.facilityId],
        [row.template_id, input.templateId]
    ];
    if (
        lineage.some(
            ([actual, expected]) =>
                requireDatabaseId(actual, "$.database.insert.lineage") !== expected
        ) ||
        row.selection_mode !== input.selection.mode ||
        requireNullableDatabaseId(
            input.selection.mode === "exact_version"
                ? row.exact_version_id
                : row.publication_id,
            "$.database.insert.selectionTargetId"
        ) !== input.selection.targetId ||
        (input.selection.mode === "exact_version"
            ? row.publication_id !== null
            : row.exact_version_id !== null) ||
        row.valid_from !== input.validFrom ||
        row.valid_through !== input.validThrough ||
        row.applicability_state !== input.applicabilityState ||
        requireDatabaseId(
            row.lifecycle_generation,
            "$.database.insert.lifecycleGeneration"
        ) !== 1 ||
        typeof row.recorded_at !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(
            row.recorded_at
        )
    ) {
        fail("APPLICABILITY_INSERT_INVALID", "$.database.insert");
    }
    return Object.freeze({
        id: requireDatabaseId(row.id, "$.database.insert.id"),
        assignmentId: input.assignmentId,
        programId: input.programId,
        facilityId: input.facilityId,
        templateId: input.templateId,
        selection: input.selection,
        validFrom: input.validFrom,
        validThrough: input.validThrough,
        applicabilityState: input.applicabilityState,
        recordedAt: row.recorded_at,
        lifecycleGeneration: 1
    });
}

export async function transitionCatalogApplicability(pool, value) {
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
        const replacement = normalizeState(
            await client.query(STATE_SQL, [
                input.assignmentId,
                input.programId,
                input.facilityId,
                input.templateId,
                input.selection.mode,
                input.selection.targetId,
                input.replacesApplicabilityId
            ]),
            input
        );
        if (replacement !== null) {
            assertCloseResult(
                await client.query(CLOSE_SQL, [
                    replacement.id,
                    input.assignmentId,
                    input.templateId,
                    input.actorSubjectId,
                    input.reasonCode,
                    replacement.lifecycleGeneration
                ]),
                replacement
            );
        }
        const applicability = normalizeInserted(
            await client.query(INSERT_SQL, [
                input.assignmentId,
                input.programId,
                input.facilityId,
                input.templateId,
                input.selection.mode,
                input.selection.targetId,
                input.validFrom,
                input.validThrough,
                input.applicabilityState,
                input.actorSubjectId,
                input.reasonCode
            ]),
            input
        );
        await client.query("COMMIT");
        transactionOpen = false;
        return Object.freeze({
            transitionVersion: CATALOG_APPLICABILITY_TRANSITION_VERSION,
            replacedApplicabilityId: replacement?.id ?? null,
            applicability
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
                ? new Error("storecalc_catalog_applicability_connection_uncertain")
                : undefined
        );
    }
}
