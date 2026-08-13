import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
    CATALOG_CONTENT_BOUNDS
} from "../src/storecalc/catalog/content.js";
import {
    loadSealedCatalogVersionContent,
    sealCatalogVersion,
    StoreCalcCatalogSealingError
} from "../src/storecalc/catalog/sealingService.js";
import {
    buildSyntheticCatalogContent,
    buildUnsealedSyntheticCatalogContent
} from "./fixtures/storecalc-catalog-content-fixture.js";

const VERSION_ID = 42;
const TEMPLATE_ID = 7;
const ROOT = fileURLToPath(new URL("..", import.meta.url));

function marker(sql) {
    return /\/\* storecalc:catalog-seal:([a-z-]+) \*\//.exec(sql)?.[1] ?? null;
}

function buildDatabaseResponses() {
    const content = buildUnsealedSyntheticCatalogContent();
    const categoryIdentity = new Map(
        content.categories.map((category, index) => [
            category.categoryKey,
            { categoryId: 100 + index, versionCategoryId: 200 + index }
        ])
    );
    const itemIdentity = new Map(
        content.items.map((item, index) => [
            item.itemKey,
            { itemId: 300 + index, versionItemId: 400 + index }
        ])
    );
    const bucketIdentity = new Map(
        content.spendingBuckets.map((bucket, index) => [
            bucket.bucketKey,
            500 + index
        ])
    );

    const categories = content.categories.map(category => ({
        template_id: TEMPLATE_ID,
        category_id: categoryIdentity.get(category.categoryKey).categoryId,
        category_key: category.categoryKey,
        display_name: category.displayName,
        description: category.description,
        sort_order: category.sortOrder,
        active: category.active
    }));
    const items = content.items.map(item => ({
        template_id: TEMPLATE_ID,
        item_id: itemIdentity.get(item.itemKey).itemId,
        item_key: item.itemKey,
        category_version_id:
            item.categoryKey === null
                ? null
                : categoryIdentity.get(item.categoryKey).versionCategoryId,
        category_key: item.categoryKey,
        sku: item.sku,
        display_name: item.displayName,
        description: item.description,
        unit_label: item.unitLabel,
        price_state: item.priceState,
        price_minor: item.priceMinor,
        minimum_selected_quantity: item.minimumSelectedQuantity,
        maximum_order_quantity: item.maximumOrderQuantity,
        quantity_step: item.quantityStep,
        availability_state: item.availabilityState,
        sort_order: item.sortOrder
    }));
    const buckets = content.spendingBuckets.map(bucket => ({
        bucket_key: bucket.bucketKey,
        display_name: bucket.displayName,
        limit_state: bucket.limitState,
        limit_minor: bucket.limitMinor,
        measure_currency_code: bucket.measureCurrencyCode,
        is_primary_display: bucket.isPrimaryDisplay,
        sort_order: bucket.sortOrder
    }));
    const memberships = content.bucketMemberships.map(membership => ({
        item_key: membership.itemKey,
        bucket_key: membership.bucketKey,
        membership_type: membership.membershipType,
        primary_display: membership.primaryDisplay
    }));
    const taxRules = content.taxRules.map(rule => ({
        scope_type: rule.scopeType,
        category_version_id:
            rule.categoryKey === null
                ? null
                : categoryIdentity.get(rule.categoryKey).versionCategoryId,
        category_key: rule.categoryKey,
        item_version_id:
            rule.itemKey === null
                ? null
                : itemIdentity.get(rule.itemKey).versionItemId,
        item_key: rule.itemKey,
        treatment_state: rule.treatmentState,
        rate_ppm: rule.ratePpm,
        price_includes_tax: rule.priceIncludesTax,
        rounding_mode: rule.roundingMode,
        rounding_scope: rule.roundingScope,
        priority: rule.priority
    }));
    const constraints = content.constraints.map(constraint => ({
        constraint_key: constraint.constraintKey,
        display_name: constraint.displayName,
        constraint_type: constraint.constraintType,
        measure_type: constraint.measureType,
        comparator: constraint.comparator,
        value_state: constraint.valueState,
        limit_value: constraint.limitValue,
        unit_code: constraint.unitCode,
        scope_type: constraint.scopeType,
        composition_behavior: constraint.compositionBehavior,
        priority: constraint.priority
    }));
    const warnings = content.warnings.map(warning => ({
        warning_code: warning.warningCode,
        severity: warning.severity,
        scope_type: warning.scopeType,
        category_version_id: null,
        item_version_id:
            warning.itemKey === null
                ? null
                : itemIdentity.get(warning.itemKey).versionItemId,
        item_key: warning.itemKey,
        message_key: warning.messageKey,
        bounded_details_text: "{}"
    }));
    const sourceEvidence = content.sourceEvidence.map((evidence, index) => ({
        evidence_id: 600 + index,
        evidence_fingerprint: evidence.evidenceFingerprint,
        relationship_type: evidence.relationshipType,
        source_group_id: 700 + index,
        source_group_fingerprint: evidence.sourceGroupFingerprint,
        privacy_state: "metadata_safe",
        redistribution_state: "metadata_only",
        withdrawn_at: null,
        grouping_type: "source_lineage",
        independence_state: "accepted",
        superseded_at: null
    }));

    const data = {
        categories: categories.reverse(),
        items: items.reverse(),
        buckets: buckets.reverse(),
        memberships: memberships.reverse(),
        "tax-rules": taxRules.reverse(),
        constraints: constraints.reverse(),
        warnings: warnings.reverse(),
        "source-evidence": sourceEvidence.reverse()
    };

    return {
        "load-migration-lock": [{ acquired: true }],
        "load-migration-unlock": [{ unlocked: true }],
        capability: [
            {
                schema_version: 8,
                is_available: false,
                verified_at: null,
                migration_key: "0011_source_evidence"
            }
        ],
        header: [
            {
                id: VERSION_ID,
                template_id: TEMPLATE_ID,
                content_state: "draft",
                currency_code: content.currencyCode,
                currency_exponent: content.currencyExponent,
                source_effective_date: content.sourceEffectiveDate,
                source_published_date: content.sourcePublishedDate,
                calculation_contract_version:
                    content.calculationContractVersion,
                required_capabilities: [...content.requiredCapabilities],
                content_schema_version: content.contentSchemaVersion,
                canonicalization_version: content.canonicalizationVersion,
                hash_algorithm: null,
                content_hash: null,
                sealed_at: null,
                template_status: "active"
            }
        ],
        counts: [
            {
                category_count: String(data.categories.length),
                item_count: String(data.items.length),
                bucket_count: String(data.buckets.length),
                membership_count: String(data.memberships.length),
                tax_rule_count: String(data["tax-rules"].length),
                constraint_count: String(data.constraints.length),
                warning_count: String(data.warnings.length),
                source_evidence_count: String(data["source-evidence"].length)
            }
        ],
        ...data
    };
}

class FakeClient {
    constructor(responses, options = {}) {
        this.responses = responses;
        this.options = options;
        this.calls = [];
        this.released = false;
        this.releaseError = undefined;
    }

    async query(sql, parameters = []) {
        const queryMarker = marker(sql);
        const transaction = sql.trim().split(/\s+/, 1)[0].toUpperCase();
        this.calls.push({ sql, parameters, marker: queryMarker, transaction });

        if (queryMarker === this.options.failAt) throw this.options.failure;
        if (transaction === "ROLLBACK" && this.options.rollbackFailure) {
            throw this.options.rollbackFailure;
        }
        if (
            ["timeouts", "migration-lock", "lock"].includes(queryMarker) ||
            ["BEGIN", "COMMIT", "ROLLBACK"].includes(transaction)
        ) {
            return { rows: [], rowCount: null };
        }
        if (queryMarker === "update") {
            const rowCount = this.options.updateRowCount ?? 1;
            return {
                rowCount,
                rows:
                    rowCount === 1
                        ? [
                              {
                                  id: VERSION_ID,
                                  template_id: TEMPLATE_ID,
                                  content_state: "sealed",
                                  hash_algorithm: parameters[1],
                                  content_hash: parameters[2]
                              }
                          ]
                        : []
            };
        }
        const responseKey =
            queryMarker === "load-header"
                ? "header"
                : queryMarker === "load-capability"
                  ? "capability"
                  : queryMarker;
        const rows = this.responses[responseKey];
        assert.ok(rows, `unexpected query marker: ${queryMarker}`);
        return { rows, rowCount: rows.length };
    }

    release(error = undefined) {
        this.released = true;
        this.releaseError = error;
    }
}

function buildPool(mutator = () => {}, options = {}) {
    const responses = buildDatabaseResponses();
    mutator(responses);
    const client = new FakeClient(responses, options);
    const pool = {
        connectCalls: 0,
        async connect() {
            this.connectCalls += 1;
            return client;
        }
    };
    return { pool, client, responses };
}

function buildLoadPool(mutator = () => {}, options = {}) {
    const expected = buildSyntheticCatalogContent();
    return buildPool(responses => {
        responses.capability[0] = {
            schema_version: 9,
            is_available: false,
            verified_at: null,
            migration_key: "0012_catalog_publication_applicability"
        };
        Object.assign(responses.header[0], {
            content_state: "sealed",
            hash_algorithm: "sha256",
            content_hash: expected.contentHash,
            sealed_at: new Date("2026-08-13T00:00:00.000Z")
        });
        mutator(responses);
    }, options);
}

async function expectSealingError(action, code, causeCode = undefined) {
    await assert.rejects(action, error => {
        assert.ok(error instanceof StoreCalcCatalogSealingError);
        assert.equal(error.code, code);
        if (causeCode !== undefined) assert.equal(error.cause?.code, causeCode);
        return true;
    });
}

test("StoreCalc atomically extracts and seals the exact canonical database catalog", async () => {
    const { pool, client } = buildPool();
    const expected = buildSyntheticCatalogContent();

    const result = await sealCatalogVersion(pool, { versionId: VERSION_ID });

    assert.deepEqual(result.catalog, expected);
    assert.equal(result.contentHash, expected.contentHash);
    assert.equal(result.versionId, VERSION_ID);
    assert.equal(result.templateId, TEMPLATE_ID);
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.catalog));
    assert.equal(
        client.calls[0].sql,
        "BEGIN ISOLATION LEVEL READ COMMITTED"
    );
    assert.deepEqual(
        client.calls.map(call => call.marker ?? call.transaction),
        [
            "BEGIN",
            "timeouts",
            "migration-lock",
            "lock",
            "capability",
            "header",
            "counts",
            "categories",
            "items",
            "buckets",
            "memberships",
            "tax-rules",
            "constraints",
            "warnings",
            "source-evidence",
            "update",
            "COMMIT"
        ]
    );
    const update = client.calls.find(call => call.marker === "update");
    assert.deepEqual(update.parameters, [VERSION_ID, "sha256", expected.contentHash]);
    assert.equal(client.released, true);
    assert.equal(client.releaseError, undefined);
});

test("StoreCalc loads one exact sealed catalog in a read-only repeatable snapshot", async () => {
    const { pool, client } = buildLoadPool();
    const expected = buildSyntheticCatalogContent();

    const result = await loadSealedCatalogVersionContent(pool, {
        versionId: VERSION_ID,
        templateId: TEMPLATE_ID,
        contentHash: expected.contentHash
    });

    assert.deepEqual(result.catalog, expected);
    assert.deepEqual(result, {
        versionId: VERSION_ID,
        templateId: TEMPLATE_ID,
        contentHash: expected.contentHash,
        catalog: expected
    });
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.catalog));
    assert.equal(
        client.calls[1].sql,
        "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
    );
    assert.deepEqual(
        client.calls.map(call => call.marker ?? call.transaction),
        [
            "load-migration-lock",
            "BEGIN",
            "timeouts",
            "load-capability",
            "load-header",
            "counts",
            "categories",
            "items",
            "buckets",
            "memberships",
            "tax-rules",
            "constraints",
            "warnings",
            "source-evidence",
            "COMMIT",
            "load-migration-unlock"
        ]
    );
    assert.equal(
        client.calls.some(call => ["lock", "update"].includes(call.marker)),
        false
    );
    const loadCapability = client.calls.find(
        call => call.marker === "load-capability"
    );
    assert.doesNotMatch(loadCapability.sql, /\bFOR\s+(?:SHARE|UPDATE)\b/i);
    assert.equal(client.released, true);
    assert.equal(client.releaseError, undefined);
});

test("StoreCalc validates exact sealed-load lineage before opening or reading", async () => {
    const expected = buildSyntheticCatalogContent();
    const { pool } = buildLoadPool();
    for (const value of [
        undefined,
        null,
        {},
        {
            versionId: VERSION_ID,
            templateId: TEMPLATE_ID,
            contentHash: expected.contentHash,
            extra: true
        },
        {
            versionId: 0,
            templateId: TEMPLATE_ID,
            contentHash: expected.contentHash
        },
        {
            versionId: VERSION_ID,
            templateId: 0,
            contentHash: expected.contentHash
        },
        {
            versionId: VERSION_ID,
            templateId: TEMPLATE_ID,
            contentHash: "not-a-sha256-hash"
        }
    ]) {
        await assert.rejects(
            () => loadSealedCatalogVersionContent(pool, value),
            error => error instanceof StoreCalcCatalogSealingError
        );
    }
    assert.equal(pool.connectCalls, 0);
});

test("StoreCalc sealed loading rejects capability, lineage, and hash drift", async () => {
    const expected = buildSyntheticCatalogContent();
    for (const [mutator, code] of [
        [
            responses => {
                responses.capability[0].schema_version = 10;
                responses.capability[0].migration_key = "9999_future_test_schema";
            },
            "SCHEMA_CAPABILITY_UNSUPPORTED"
        ],
        [
            responses => (responses.header[0].content_state = "draft"),
            "VERSION_NOT_SEALED"
        ],
        [
            responses => (responses.header[0].template_id = TEMPLATE_ID + 1),
            "CATALOG_LINEAGE_INVALID"
        ],
        [
            responses => (responses.header[0].content_hash = "0".repeat(64)),
            "VERSION_SEALED_HASH_STATE_INVALID"
        ],
        [
            responses => (responses.items[0].display_name = "Hostile drift"),
            "CATALOG_CONTENT_HASH_MISMATCH"
        ],
        [
            responses => (responses["source-evidence"][0].withdrawn_at = new Date()),
            "SOURCE_EVIDENCE_INELIGIBLE"
        ]
    ]) {
        const { pool, client } = buildLoadPool(mutator);
        await expectSealingError(
            () => loadSealedCatalogVersionContent(pool, {
                versionId: VERSION_ID,
                templateId: TEMPLATE_ID,
                contentHash: expected.contentHash
            }),
            code
        );
        assert.equal(client.calls.at(-2).transaction, "ROLLBACK");
        assert.equal(client.calls.at(-1).marker, "load-migration-unlock");
    }
});

test("StoreCalc sealed loading fails closed before snapshot when migration locking is unavailable", async () => {
    const expected = buildSyntheticCatalogContent();
    const { pool, client } = buildLoadPool(responses => {
        responses["load-migration-lock"][0].acquired = false;
    });

    await expectSealingError(
        () => loadSealedCatalogVersionContent(pool, {
            versionId: VERSION_ID,
            templateId: TEMPLATE_ID,
            contentHash: expected.contentHash
        }),
        "MIGRATION_LOCK_UNAVAILABLE"
    );
    assert.deepEqual(
        client.calls.map(call => call.marker ?? call.transaction),
        ["load-migration-lock"]
    );
    assert.equal(client.released, true);
    assert.equal(client.releaseError, undefined);
});

test("StoreCalc destroys a pooled connection if its session migration lock cannot be released", async () => {
    const expected = buildSyntheticCatalogContent();
    const { pool, client } = buildLoadPool(responses => {
        responses["load-migration-unlock"][0].unlocked = false;
    });

    await expectSealingError(
        () => loadSealedCatalogVersionContent(pool, {
            versionId: VERSION_ID,
            templateId: TEMPLATE_ID,
            contentHash: expected.contentHash
        }),
        "SESSION_LOCK_RELEASE_FAILED"
    );
    assert.equal(client.released, true);
    assert.match(
        client.releaseError.message,
        /storecalc_catalog_loading_connection_uncertain/
    );
});

test("StoreCalc rejects invalid service inputs before opening a connection", async () => {
    const { pool } = buildPool();
    for (const versionId of [undefined, null, 0, -1, 1.5, 2_147_483_648]) {
        await expectSealingError(
            () => sealCatalogVersion(pool, { versionId }),
            "VERSION_ID_INVALID"
        );
    }
    assert.equal(pool.connectCalls, 0);
    await expectSealingError(
        () => sealCatalogVersion({}, { versionId: VERSION_ID }),
        "DATABASE_POOL_INVALID"
    );
});

test("StoreCalc rejects missing, sealed, and closed versions and rolls back", async () => {
    for (const [mutator, code] of [
        [responses => responses.header.splice(0), "VERSION_NOT_FOUND"],
        [responses => (responses.header[0].content_state = "sealed"), "VERSION_NOT_DRAFT"],
        [responses => (responses.header[0].template_status = "archived"), "TEMPLATE_NOT_SEALABLE"]
    ]) {
        const { pool, client } = buildPool(mutator);
        await expectSealingError(
            () => sealCatalogVersion(pool, { versionId: VERSION_ID }),
            code
        );
        assert.equal(client.calls.at(-1).transaction, "ROLLBACK");
        assert.equal(client.released, true);
    }
});

test("StoreCalc refuses an unreviewed database capability generation", async () => {
    for (const mutator of [
        responses => responses.capability.splice(0),
        responses => {
            responses.capability[0].schema_version = 9;
            responses.capability[0].migration_key = "future_unreviewed_migration";
        }
    ]) {
        const { pool, client } = buildPool(mutator);
        await expectSealingError(
            () => sealCatalogVersion(pool, { versionId: VERSION_ID }),
            "SCHEMA_CAPABILITY_UNSUPPORTED"
        );
        assert.equal(
            client.calls.some(call => call.marker === "header"),
            false
        );
        assert.equal(client.calls.at(-1).transaction, "ROLLBACK");
    }
});

test("StoreCalc enforces row bounds before loading catalog arrays", async () => {
    const { pool, client } = buildPool(responses => {
        responses.counts[0].item_count = String(
            CATALOG_CONTENT_BOUNDS.maxItems + 1
        );
    });

    await expectSealingError(
        () => sealCatalogVersion(pool, { versionId: VERSION_ID }),
        "CATALOG_COUNT_BOUND_EXCEEDED"
    );
    assert.equal(
        client.calls.some(call => call.marker === "items"),
        false
    );
    assert.equal(client.calls.at(-1).transaction, "ROLLBACK");
});

test("StoreCalc rejects database type and lineage drift before hashing", async () => {
    for (const [mutator, code] of [
        [responses => (responses.items[0].price_minor = 90), "DATABASE_TYPE_DRIFT"],
        [responses => (responses.items[0].item_key = null), "DATABASE_TYPE_DRIFT"],
        [
            responses => responses.header[0].required_capabilities.reverse(),
            "VERSION_CAPABILITIES_NOT_CANONICAL"
        ],
        [
            responses => (responses["tax-rules"][0].item_version_id = null),
            "CATALOG_LINEAGE_INVALID"
        ]
    ]) {
        const { pool, client } = buildPool(mutator);
        await expectSealingError(
            () => sealCatalogVersion(pool, { versionId: VERSION_ID }),
            code
        );
        assert.equal(client.calls.at(-1).transaction, "ROLLBACK");
        assert.equal(
            client.calls.some(call => call.marker === "update"),
            false
        );
    }
});

test("StoreCalc rejects evidence that is no longer seal-eligible", async () => {
    const { pool, client } = buildPool(responses => {
        responses["source-evidence"][0].privacy_state = "pending_review";
    });

    await expectSealingError(
        () => sealCatalogVersion(pool, { versionId: VERSION_ID }),
        "SOURCE_EVIDENCE_INELIGIBLE"
    );
    assert.equal(client.calls.at(-1).transaction, "ROLLBACK");
    assert.equal(
        client.calls.some(call => call.marker === "update"),
        false
    );
});

test("StoreCalc translates canonical-content rejection without losing its cause", async () => {
    const { pool, client } = buildPool(responses => {
        responses.items[0].category_key = "missing_category";
    });

    await expectSealingError(
        () => sealCatalogVersion(pool, { versionId: VERSION_ID }),
        "CATALOG_CONTENT_INVALID",
        "CATEGORY_REFERENCE_MISSING"
    );
    assert.equal(client.calls.at(-1).transaction, "ROLLBACK");
});

test("StoreCalc compare-and-set rejects a stale sealing transition", async () => {
    const { pool, client } = buildPool(() => {}, { updateRowCount: 0 });

    await expectSealingError(
        () => sealCatalogVersion(pool, { versionId: VERSION_ID }),
        "SEAL_STATE_CHANGED"
    );
    assert.equal(client.calls.at(-1).transaction, "ROLLBACK");
});

test("StoreCalc rolls back database failures and reports rollback uncertainty", async () => {
    const databaseFailure = Object.assign(new Error("synthetic database failure"), {
        code: "XX000"
    });
    const first = buildPool(() => {}, {
        failAt: "items",
        failure: databaseFailure
    });
    await assert.rejects(
        () => sealCatalogVersion(first.pool, { versionId: VERSION_ID }),
        error => error === databaseFailure
    );
    assert.equal(first.client.calls.at(-1).transaction, "ROLLBACK");
    assert.equal(first.client.released, true);

    const rollbackFailure = new Error("synthetic rollback failure");
    const second = buildPool(() => {}, {
        failAt: "header",
        failure: databaseFailure,
        rollbackFailure
    });
    await expectSealingError(
        () => sealCatalogVersion(second.pool, { versionId: VERSION_ID }),
        "TRANSACTION_ROLLBACK_FAILED"
    );
    assert.ok(second.client.calls.some(call => call.transaction === "ROLLBACK"));
    assert.equal(second.client.released, true);
    assert.match(
        second.client.releaseError.message,
        /storecalc_catalog_sealing_connection_uncertain/
    );
});

test("StoreCalc sealing remains outside every current runtime route", () => {
    const runtimeSources = [
        "src/routes/storecalc.routes.js",
        "src/controllers/storecalc.controller.js",
        "src/storecalc/anonymous/router.js",
        "src/storecalc/anonymous/service.js"
    ].map(relativePath =>
        readFileSync(path.join(ROOT, relativePath), "utf8")
    );
    for (const source of runtimeSources) {
        assert.doesNotMatch(
            source,
            /sealingService|sealCatalogVersion|loadSealedCatalogVersionContent/
        );
    }

    const serviceSource = readFileSync(
        path.join(ROOT, "src/storecalc/catalog/sealingService.js"),
        "utf8"
    );
    assert.doesNotMatch(
        serviceSource,
        /\b(?:express|router|req\.|res\.|process\.env)\b/
    );
});
