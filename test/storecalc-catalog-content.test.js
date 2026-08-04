import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
    CATALOG_CONTENT_BOUNDS,
    CATALOG_SOURCE_EVIDENCE_RELATIONSHIPS,
    sealCatalogVersionContent,
    StoreCalcCatalogContentError,
    verifyCatalogVersionContent
} from "../src/storecalc/catalog/content.js";
import {
    buildSyntheticCatalogContent,
    buildUnsealedSyntheticCatalogContent
} from "./fixtures/storecalc-catalog-content-fixture.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const GOLDEN_HASH =
    "1226f26de7c3e80dbc4cd2fbf2c2f2b30bea5055a0d66e14a821a705e2ea1d44";

function expectCatalogError(action, code, pathPattern = /^\$\./) {
    assert.throws(action, error => {
        assert.ok(error instanceof StoreCalcCatalogContentError);
        assert.equal(error.code, code);
        assert.match(error.path, pathPattern);
        return true;
    });
}

function reverseRepeatedFields(content) {
    content.requiredCapabilities.reverse();
    content.categories.reverse();
    content.items.reverse();
    content.spendingBuckets.reverse();
    content.bucketMemberships.reverse();
    content.taxRules.reverse();
    content.constraints.reverse();
    content.warnings.reverse();
    content.sourceEvidence.reverse();
}

function shuffled(values, random) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
        const selected = Math.floor(random() * (index + 1));
        [result[index], result[selected]] = [result[selected], result[index]];
    }
    return result;
}

function deterministicRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
        return state / 0x1_0000_0000;
    };
}

test("StoreCalc seals one exact immutable V1 catalog document", () => {
    const sealed = buildSyntheticCatalogContent();

    assert.equal(sealed.contentHash, GOLDEN_HASH);
    assert.equal(sealed.contentSchemaVersion, "storecalc.catalog-content.v1");
    assert.equal(
        sealed.canonicalizationVersion,
        "storecalc.canonical-json.v1"
    );
    assert.equal(sealed.calculationContractVersion, "storecalc.calculation.v1");
    assert.equal(sealed.hashAlgorithm, "sha256");
    assert.deepEqual(
        sealed.categories.map(category => category.categoryKey),
        ["food", "hygiene"]
    );
    assert.deepEqual(
        sealed.items.map(item => item.itemKey),
        ["sample_soap", "sample_soup"]
    );
    assert.ok(Object.isFrozen(sealed));
    assert.ok(Object.isFrozen(sealed.items));
    assert.ok(Object.isFrozen(sealed.items[0]));
    assert.ok(Object.isFrozen(sealed.sourceEvidence[0]));
});

test("StoreCalc catalog hashing is independent of input field and row order", () => {
    const reordered = buildUnsealedSyntheticCatalogContent(content => {
        reverseRepeatedFields(content);
    });
    const reversedFields = Object.fromEntries(
        Object.entries(reordered).reverse()
    );

    assert.equal(sealCatalogVersionContent(reversedFields).contentHash, GOLDEN_HASH);
    assert.deepEqual(
        sealCatalogVersionContent(reversedFields),
        buildSyntheticCatalogContent()
    );
});

test("StoreCalc catalog hashing stays stable across deterministic shuffles", () => {
    const random = deterministicRandom(0x5ea1c0de);
    for (let iteration = 0; iteration < 250; iteration += 1) {
        const content = buildUnsealedSyntheticCatalogContent();
        for (const field of [
            "requiredCapabilities",
            "categories",
            "items",
            "spendingBuckets",
            "bucketMemberships",
            "taxRules",
            "constraints",
            "warnings",
            "sourceEvidence"
        ]) {
            content[field] = shuffled(content[field], random);
        }
        assert.equal(sealCatalogVersionContent(content).contentHash, GOLDEN_HASH);
    }
});

test("StoreCalc verifies exact hashes and rejects stale documents", () => {
    const sealed = buildSyntheticCatalogContent();
    assert.deepEqual(verifyCatalogVersionContent(structuredClone(sealed)), sealed);

    const malformed = structuredClone(sealed);
    malformed.contentHash = "not-a-digest";
    expectCatalogError(
        () => verifyCatalogVersionContent(malformed),
        "HASH_INVALID",
        /^\$\.catalog\.contentHash$/
    );

    const stale = structuredClone(sealed);
    stale.items[0].displayName = "Changed after sealing";
    expectCatalogError(
        () => verifyCatalogVersionContent(stale),
        "CONTENT_HASH_MISMATCH",
        /^\$\.catalog\.contentHash$/
    );
});

test("Every canonical catalog domain contributes to the content hash", () => {
    const mutations = [
        content => {
            content.sourceEffectiveDate = "2026-08-02";
        },
        content => {
            content.categories[0].displayName = "Changed food";
        },
        content => {
            content.items[0].priceMinor = "91";
        },
        content => {
            content.spendingBuckets[0].limitMinor = "601";
        },
        content => {
            content.bucketMemberships[0].membershipType = "excluded";
        },
        content => {
            content.taxRules[0].ratePpm = "70001";
        },
        content => {
            content.constraints[0].limitValue = "4";
        },
        content => {
            content.warnings[0].messageKey =
                "storecalc.notice.synthetic_fixture_changed";
        },
        content => {
            content.sourceEvidence[0].evidenceFingerprint = "3".repeat(64);
        }
    ];

    for (const mutate of mutations) {
        const changed = buildSyntheticCatalogContent(mutate);
        assert.notEqual(changed.contentHash, GOLDEN_HASH);
    }
});

test("Database identity and operational metadata cannot enter catalog content", () => {
    for (const [field, value] of [
        ["versionId", 1],
        ["templateId", 1],
        ["versionNumber", 1],
        ["contentState", "sealed"],
        ["sealedAt", "2026-08-04T00:00:00Z"],
        ["contributorSubjectId", 1]
    ]) {
        const content = buildUnsealedSyntheticCatalogContent();
        content[field] = value;
        expectCatalogError(
            () => sealCatalogVersionContent(content),
            "OBJECT_SHAPE_INVALID",
            /^\$\.catalog$/
        );
    }

    const evidence = buildUnsealedSyntheticCatalogContent();
    evidence.sourceEvidence[0].sourceUrl = "https://example.invalid/source";
    expectCatalogError(
        () => sealCatalogVersionContent(evidence),
        "OBJECT_SHAPE_INVALID",
        /^\$\.catalog\.sourceEvidence\[0\]$/
    );
});

test("Catalog category, item, and bucket references fail closed", () => {
    const cases = [
        {
            mutate: content => {
                content.items[0].categoryKey = "missing";
            },
            code: "CATEGORY_REFERENCE_MISSING"
        },
        {
            mutate: content => {
                content.bucketMemberships[0].itemKey = "missing";
            },
            code: "ITEM_REFERENCE_MISSING"
        },
        {
            mutate: content => {
                content.bucketMemberships[0].bucketKey = "missing";
            },
            code: "BUCKET_REFERENCE_MISSING"
        },
        {
            mutate: content => {
                content.taxRules[1].itemKey = "missing";
            },
            code: "ITEM_REFERENCE_MISSING"
        },
        {
            mutate: content => {
                content.warnings[1].itemKey = "missing";
            },
            code: "ITEM_REFERENCE_MISSING"
        }
    ];

    for (const { mutate, code } of cases) {
        const content = buildUnsealedSyntheticCatalogContent(mutate);
        expectCatalogError(() => sealCatalogVersionContent(content), code);
    }
});

test("Catalog semantic identities and primary display choices are unique", () => {
    const cases = [
        {
            mutate: content => content.categories.push(content.categories[0]),
            code: "CATEGORY_KEY_DUPLICATE"
        },
        {
            mutate: content => content.items.push(content.items[0]),
            code: "ITEM_KEY_DUPLICATE"
        },
        {
            mutate: content =>
                content.spendingBuckets.push(content.spendingBuckets[0]),
            code: "BUCKET_KEY_DUPLICATE"
        },
        {
            mutate: content =>
                content.bucketMemberships.push(content.bucketMemberships[0]),
            code: "BUCKET_MEMBERSHIP_DUPLICATE"
        },
        {
            mutate: content => content.taxRules.push(content.taxRules[0]),
            code: "TAX_RULE_DUPLICATE"
        },
        {
            mutate: content => content.constraints.push(content.constraints[0]),
            code: "CONSTRAINT_KEY_DUPLICATE"
        },
        {
            mutate: content => content.warnings.push(content.warnings[0]),
            code: "WARNING_DUPLICATE"
        },
        {
            mutate: content =>
                content.sourceEvidence.push(content.sourceEvidence[0]),
            code: "SOURCE_EVIDENCE_DUPLICATE"
        },
        {
            mutate: content => {
                content.spendingBuckets[1].isPrimaryDisplay = true;
            },
            code: "PRIMARY_BUCKET_AMBIGUOUS"
        },
        {
            mutate: content => {
                content.bucketMemberships[1].primaryDisplay = true;
            },
            code: "PRIMARY_MEMBERSHIP_AMBIGUOUS"
        }
    ];

    for (const { mutate, code } of cases) {
        const content = buildUnsealedSyntheticCatalogContent(mutate);
        expectCatalogError(() => sealCatalogVersionContent(content), code);
    }
});

test("Tax scope and explicit state fields match migration V1", () => {
    const categoryRule = buildSyntheticCatalogContent(content => {
        content.taxRules[1] = {
            ...content.taxRules[1],
            scopeType: "category",
            categoryKey: "hygiene",
            itemKey: null
        };
    });
    assert.equal(categoryRule.taxRules[0].scopeType, "category");

    const missingCategory = buildUnsealedSyntheticCatalogContent(content => {
        content.taxRules[1] = {
            ...content.taxRules[1],
            scopeType: "category",
            categoryKey: "missing",
            itemKey: null
        };
    });
    expectCatalogError(
        () => sealCatalogVersionContent(missingCategory),
        "CATEGORY_REFERENCE_MISSING"
    );

    const malformedCategoryTarget = buildUnsealedSyntheticCatalogContent(
        content => {
            content.taxRules[1] = {
                ...content.taxRules[1],
                scopeType: "category",
                categoryKey: null,
                itemKey: "sample_soap"
            };
        }
    );
    expectCatalogError(
        () => sealCatalogVersionContent(malformedCategoryTarget),
        "TAX_TARGET_INVALID"
    );

    const badTarget = buildUnsealedSyntheticCatalogContent(content => {
        content.taxRules[0].itemKey = "sample_soup";
    });
    expectCatalogError(
        () => sealCatalogVersionContent(badTarget),
        "TAX_TARGET_INVALID"
    );

    const missingTarget = buildUnsealedSyntheticCatalogContent(content => {
        content.taxRules[1].itemKey = null;
    });
    expectCatalogError(
        () => sealCatalogVersionContent(missingTarget),
        "TAX_TARGET_INVALID"
    );

    const hiddenKnownFields = buildUnsealedSyntheticCatalogContent(content => {
        content.taxRules[1].ratePpm = "0";
    });
    expectCatalogError(
        () => sealCatalogVersionContent(hiddenKnownFields),
        "EXPLICIT_STATE_NULLABILITY_INVALID"
    );

    const incompleteKnown = buildUnsealedSyntheticCatalogContent(content => {
        content.taxRules[0].roundingMode = null;
    });
    expectCatalogError(
        () => sealCatalogVersionContent(incompleteKnown),
        "ENUM_VALUE_INVALID"
    );

    const nonBooleanKnown = buildUnsealedSyntheticCatalogContent(content => {
        content.taxRules[0].priceIncludesTax = "false";
    });
    expectCatalogError(
        () => sealCatalogVersionContent(nonBooleanKnown),
        "BOOLEAN_REQUIRED"
    );
});

test("Warnings preserve the intentionally partial V1 contract", () => {
    const categoryWarning = buildUnsealedSyntheticCatalogContent(content => {
        content.warnings[0].categoryKey = "food";
    });
    expectCatalogError(
        () => sealCatalogVersionContent(categoryWarning),
        "WARNING_TARGET_INVALID"
    );

    const missingItem = buildUnsealedSyntheticCatalogContent(content => {
        content.warnings[1].itemKey = null;
    });
    expectCatalogError(
        () => sealCatalogVersionContent(missingItem),
        "WARNING_TARGET_INVALID"
    );

    const details = buildUnsealedSyntheticCatalogContent(content => {
        content.warnings[0].boundedDetails = { explanation: "not V1" };
    });
    expectCatalogError(
        () => sealCatalogVersionContent(details),
        "WARNING_DETAILS_UNSUPPORTED"
    );

    const hardError = buildUnsealedSyntheticCatalogContent(content => {
        content.warnings[0].severity = "hard_error";
    });
    expectCatalogError(
        () => sealCatalogVersionContent(hardError),
        "ENUM_VALUE_INVALID"
    );

    const nonObjectDetails = buildUnsealedSyntheticCatalogContent(content => {
        content.warnings[0].boundedDetails = [];
    });
    expectCatalogError(
        () => sealCatalogVersionContent(nonObjectDetails),
        "WARNING_DETAILS_INVALID"
    );
});

test("Sealed content requires bounded fingerprint-only source evidence", () => {
    assert.deepEqual(CATALOG_SOURCE_EVIDENCE_RELATIONSHIPS, [
        "supports_catalog"
    ]);

    const absent = buildUnsealedSyntheticCatalogContent(content => {
        content.sourceEvidence = [];
    });
    expectCatalogError(
        () => sealCatalogVersionContent(absent),
        "ARRAY_BOUND_EXCEEDED",
        /^\$\.catalog\.sourceEvidence$/
    );

    const badFingerprint = buildUnsealedSyntheticCatalogContent(content => {
        content.sourceEvidence[0].evidenceFingerprint = "ABC";
    });
    expectCatalogError(
        () => sealCatalogVersionContent(badFingerprint),
        "HASH_INVALID"
    );

    const unknownRelationship = buildUnsealedSyntheticCatalogContent(content => {
        content.sourceEvidence[0].relationshipType = "mentions_catalog";
    });
    expectCatalogError(
        () => sealCatalogVersionContent(unknownRelationship),
        "ENUM_VALUE_INVALID"
    );

    const duplicateIdentity = buildUnsealedSyntheticCatalogContent(content => {
        content.sourceEvidence.push({
            ...content.sourceEvidence[0],
            sourceGroupFingerprint: "3".repeat(64)
        });
    });
    expectCatalogError(
        () => sealCatalogVersionContent(duplicateIdentity),
        "SOURCE_EVIDENCE_DUPLICATE"
    );
});

test("Catalog required capabilities are canonical and structurally inferred", () => {
    const capabilities = [
        "money.minor_units.v1",
        "quantity.bounded_integer.v1",
        "spending_buckets.parallel_pretax.v1",
        "tax.single_treatment.line_rounding.v1",
        "constraints.order_aggregate.v1"
    ];
    for (const capability of capabilities) {
        const content = buildUnsealedSyntheticCatalogContent(value => {
            value.requiredCapabilities = value.requiredCapabilities.filter(
                candidate => candidate !== capability
            );
        });
        expectCatalogError(
            () => sealCatalogVersionContent(content),
            "CAPABILITY_DECLARATION_MISSING",
            /^\$\.catalog\.requiredCapabilities$/
        );
    }

    const duplicate = buildUnsealedSyntheticCatalogContent(content => {
        content.requiredCapabilities.push(content.requiredCapabilities[0]);
    });
    expectCatalogError(
        () => sealCatalogVersionContent(duplicate),
        "CAPABILITY_DUPLICATE"
    );

    const future = buildSyntheticCatalogContent(content => {
        content.requiredCapabilities.push("future.reviewed_rule.v2");
    });
    assert.notEqual(future.contentHash, GOLDEN_HASH);

    const malformed = buildUnsealedSyntheticCatalogContent(content => {
        content.requiredCapabilities.push("future rule");
    });
    expectCatalogError(
        () => sealCatalogVersionContent(malformed),
        "CAPABILITY_INVALID"
    );
});

test("Catalog numeric strings fail before unbounded BigInt parsing", () => {
    const oversized = "9".repeat(100_000);
    for (const mutate of [
        content => {
            content.items[0].priceMinor = oversized;
        },
        content => {
            content.items[0].maximumOrderQuantity = oversized;
        },
        content => {
            content.spendingBuckets[0].limitMinor = oversized;
        },
        content => {
            content.taxRules[0].ratePpm = oversized;
        },
        content => {
            content.constraints[0].limitValue = oversized;
        }
    ]) {
        const content = buildUnsealedSyntheticCatalogContent(mutate);
        expectCatalogError(
            () => sealCatalogVersionContent(content),
            "UNSIGNED_INTEGER_BOUND_EXCEEDED"
        );
    }
});

test("Catalog explicit numeric and currency states fail closed", () => {
    const unknownPriceWithValue = buildUnsealedSyntheticCatalogContent(content => {
        content.items[1].priceMinor = "0";
    });
    expectCatalogError(
        () => sealCatalogVersionContent(unknownPriceWithValue),
        "EXPLICIT_STATE_NULLABILITY_INVALID"
    );

    const invertedQuantity = buildUnsealedSyntheticCatalogContent(content => {
        content.items[0].minimumSelectedQuantity = "5";
    });
    expectCatalogError(
        () => sealCatalogVersionContent(invertedQuantity),
        "QUANTITY_RULE_INVALID"
    );

    const bucketCurrency = buildUnsealedSyntheticCatalogContent(content => {
        content.spendingBuckets[0].measureCurrencyCode = "EUR";
    });
    expectCatalogError(
        () => sealCatalogVersionContent(bucketCurrency),
        "BUCKET_CURRENCY_MISMATCH"
    );

    const hiddenBucketLimit = buildUnsealedSyntheticCatalogContent(content => {
        content.spendingBuckets[0].limitState = "unknown";
    });
    expectCatalogError(
        () => sealCatalogVersionContent(hiddenBucketLimit),
        "EXPLICIT_STATE_NULLABILITY_INVALID"
    );

    const unsupportedCurrency = buildUnsealedSyntheticCatalogContent(content => {
        content.currencyCode = "EUR";
    });
    expectCatalogError(
        () => sealCatalogVersionContent(unsupportedCurrency),
        "CURRENCY_CODE_UNSUPPORTED"
    );

    const invalidCurrency = buildUnsealedSyntheticCatalogContent(content => {
        content.currencyCode = "usd";
    });
    expectCatalogError(
        () => sealCatalogVersionContent(invalidCurrency),
        "CURRENCY_CODE_INVALID"
    );

    const mismatchedExponent = buildUnsealedSyntheticCatalogContent(content => {
        content.currencyExponent = 3;
    });
    expectCatalogError(
        () => sealCatalogVersionContent(mismatchedExponent),
        "CURRENCY_EXPONENT_MISMATCH"
    );

    const unboundedExponent = buildUnsealedSyntheticCatalogContent(content => {
        content.currencyExponent = 4;
    });
    expectCatalogError(
        () => sealCatalogVersionContent(unboundedExponent),
        "CURRENCY_EXPONENT_UNSUPPORTED"
    );

    const invalidInteger = buildUnsealedSyntheticCatalogContent(content => {
        content.categories[0].sortOrder = 1.5;
    });
    expectCatalogError(
        () => sealCatalogVersionContent(invalidInteger),
        "INTEGER_BOUND_EXCEEDED"
    );

    const negativeZero = buildUnsealedSyntheticCatalogContent(content => {
        content.categories[0].sortOrder = -0;
    });
    const normalized = sealCatalogVersionContent(negativeZero);
    assert.equal(Object.is(normalized.categories[0].sortOrder, -0), false);

    const invalidUnsigned = buildUnsealedSyntheticCatalogContent(content => {
        content.items[0].priceMinor = "01";
    });
    expectCatalogError(
        () => sealCatalogVersionContent(invalidUnsigned),
        "UNSIGNED_INTEGER_INVALID"
    );

    const boundedUnsigned = buildUnsealedSyntheticCatalogContent(content => {
        content.items[0].priceMinor = "9223372036854775808";
    });
    expectCatalogError(
        () => sealCatalogVersionContent(boundedUnsigned),
        "UNSIGNED_INTEGER_BOUND_EXCEEDED"
    );
});

test("Catalog version and primitive representation guards fail closed", () => {
    const versionCases = [
        [
            "contentSchemaVersion",
            "future.catalog.v2",
            "CONTENT_SCHEMA_VERSION_UNSUPPORTED"
        ],
        [
            "canonicalizationVersion",
            "future.canonical.v2",
            "CANONICALIZATION_VERSION_UNSUPPORTED"
        ],
        [
            "calculationContractVersion",
            "future.calculation.v2",
            "CALCULATION_CONTRACT_VERSION_UNSUPPORTED"
        ],
        ["hashAlgorithm", "sha512", "HASH_ALGORITHM_UNSUPPORTED"]
    ];
    for (const [field, value, code] of versionCases) {
        const content = buildUnsealedSyntheticCatalogContent();
        content[field] = value;
        expectCatalogError(() => sealCatalogVersionContent(content), code);
    }

    const nonBooleanCategory = buildUnsealedSyntheticCatalogContent(content => {
        content.categories[0].active = 1;
    });
    expectCatalogError(
        () => sealCatalogVersionContent(nonBooleanCategory),
        "BOOLEAN_REQUIRED"
    );

    const nonBooleanBucket = buildUnsealedSyntheticCatalogContent(content => {
        content.spendingBuckets[0].isPrimaryDisplay = 1;
    });
    expectCatalogError(
        () => sealCatalogVersionContent(nonBooleanBucket),
        "BOOLEAN_REQUIRED"
    );

    const nonBooleanMembership = buildUnsealedSyntheticCatalogContent(
        content => {
            content.bucketMemberships[0].primaryDisplay = 1;
        }
    );
    expectCatalogError(
        () => sealCatalogVersionContent(nonBooleanMembership),
        "BOOLEAN_REQUIRED"
    );

    const forbiddenConstraint = buildUnsealedSyntheticCatalogContent(content => {
        content.constraints[0].comparator = "greater_than_or_equal";
        content.constraints[0].valueState = "unlimited";
        content.constraints[0].limitValue = null;
    });
    expectCatalogError(
        () => sealCatalogVersionContent(forbiddenConstraint),
        "CONSTRAINT_STATE_INVALID"
    );

    const hiddenConstraintValue = buildUnsealedSyntheticCatalogContent(content => {
        content.constraints[0].valueState = "unknown";
    });
    expectCatalogError(
        () => sealCatalogVersionContent(hiddenConstraintValue),
        "EXPLICIT_STATE_NULLABILITY_INVALID"
    );
});

test("Catalog text, dates, and stable-key grammars are exact", () => {
    const cases = [
        {
            mutate: content => {
                content.categories[0].categoryKey = "food-item";
            },
            code: "IDENTITY_KEY_INVALID"
        },
        {
            mutate: content => {
                content.items[0].displayName = " trailing ";
            },
            code: "TEXT_INVALID"
        },
        {
            mutate: content => {
                content.items[0].displayName = "Cafe\u0301";
            },
            code: "TEXT_INVALID"
        },
        {
            mutate: content => {
                content.items[0].displayName = "Unsafe\u202e";
            },
            code: "TEXT_INVALID"
        },
        {
            mutate: content => {
                content.items[0].displayName = "A".repeat(513);
            },
            code: "TEXT_BOUND_EXCEEDED"
        },
        {
            mutate: content => {
                content.items[0].displayName = "A".repeat(121);
            },
            code: "TEXT_BOUND_EXCEEDED"
        },
        {
            mutate: content => {
                content.sourceEffectiveDate = "2026-02-30";
            },
            code: "DATE_INVALID"
        },
        {
            mutate: content => {
                content.warnings[0].messageKey = "not_dotted";
            },
            code: "MESSAGE_KEY_INVALID"
        }
    ];
    for (const { mutate, code } of cases) {
        const content = buildUnsealedSyntheticCatalogContent(mutate);
        expectCatalogError(() => sealCatalogVersionContent(content), code);
    }
});

test("Catalog arrays are bounded before per-row normalization", () => {
    const tooManyItems = buildUnsealedSyntheticCatalogContent(content => {
        content.items = new Array(CATALOG_CONTENT_BOUNDS.maxItems + 1).fill(
            content.items[0]
        );
    });
    expectCatalogError(
        () => sealCatalogVersionContent(tooManyItems),
        "ARRAY_BOUND_EXCEEDED",
        /^\$\.catalog\.items$/
    );

    const tooManyEvidence = buildUnsealedSyntheticCatalogContent(content => {
        content.sourceEvidence = new Array(
            CATALOG_CONTENT_BOUNDS.maxSourceEvidence + 1
        ).fill(content.sourceEvidence[0]);
    });
    expectCatalogError(
        () => sealCatalogVersionContent(tooManyEvidence),
        "ARRAY_BOUND_EXCEEDED",
        /^\$\.catalog\.sourceEvidence$/
    );

    const wrongType = buildUnsealedSyntheticCatalogContent(content => {
        content.categories = {};
    });
    expectCatalogError(
        () => sealCatalogVersionContent(wrongType),
        "ARRAY_REQUIRED",
        /^\$\.catalog\.categories$/
    );

    const sparse = buildUnsealedSyntheticCatalogContent(content => {
        content.categories = new Array(1);
    });
    expectCatalogError(
        () => sealCatalogVersionContent(sparse),
        "ARRAY_SHAPE_INVALID",
        /^\$\.catalog\.categories$/
    );

    const decorated = buildUnsealedSyntheticCatalogContent(content => {
        content.categories.extra = "not canonical JSON";
    });
    expectCatalogError(
        () => sealCatalogVersionContent(decorated),
        "ARRAY_SHAPE_INVALID",
        /^\$\.catalog\.categories$/
    );
});

test("Catalog sealing code stays pure and disconnected", () => {
    const source = readFileSync(
        `${ROOT}/src/storecalc/catalog/content.js`,
        "utf8"
    );
    assert.doesNotMatch(
        source,
        /\b(?:fetch|axios|pg|process\.env|Date\.|setTimeout|express|router)\b/
    );
    assert.doesNotMatch(source, /sourceUrl|objectKey|contributorSubjectId/);
});
