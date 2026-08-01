# StoreCalc Schema Integrity Addendum

Issues: #111, #109

This addendum records mandatory relational constraints discovered during review of `storecalc-schema-design.md`.

The column listings in the main design document are conceptual. Executable migrations must include the parent-identity columns, composite uniqueness constraints, and foreign keys described here even when that means repeating a parent ID in a child table.

## Why this is necessary

A simple foreign key proves only that a referenced row exists.

It does not prove that:

- a version item belongs to the same version as its category;
- a spending bucket belongs to the same version as an item;
- a tax rule targets an item in its own version;
- a published version belongs to the template being published;
- a proposal's base and candidate versions belong to its template;
- an order's facility, program, template, and version form one valid lineage;
- an order line belongs to the version used by its order.

Those failures would not merely be untidy. They could mix prices and rules across facilities, leak private-template relationships, corrupt historical orders, and make review evidence point at the wrong catalog.

Application validation is required for clear errors, but the database must reject cross-parent relationships independently.

## Parent-pair uniqueness

Tables that act as children of a larger identity should expose a composite candidate key in addition to their primary key.

Examples:

```text
store_programs:          UNIQUE (id, facility_id)
templates:               UNIQUE (id, store_program_id)
template_versions:       UNIQUE (id, template_id)
template_categories:     UNIQUE (id, template_id)
template_items:          UNIQUE (id, template_id)
version_categories:      UNIQUE (id, version_id)
version_spending_buckets: UNIQUE (id, version_id)
version_items:           UNIQUE (id, version_id)
version_rules:           UNIQUE (id, version_id)
orders:                  UNIQUE (id, template_version_id)
```

The exact column order may follow PostgreSQL indexing needs, but every required composite foreign key must have a matching unique or primary candidate key.

## Directory lineage

`store_programs` already contains `facility_id`.

`templates` should include both `store_program_id` and the facility lineage where needed for a composite constraint or should prove the facility through an immutable program relationship. A program must not be moved to another facility after public templates or orders reference it. Renames and merges use explicit history rather than reparenting facts silently.

An order containing all four identifiers must enforce:

```text
(order.store_program_id, order.facility_id)
    -> store_programs(id, facility_id)

(order.template_id, order.store_program_id)
    -> templates(id, store_program_id)

(order.template_version_id, order.template_id)
    -> template_versions(id, template_id)
```

This makes the stored lineage self-validating instead of relying on four independent foreign keys.

## Version ancestry

A version's `based_on_version_id` must belong to the same template.

Use a composite relationship equivalent to:

```text
(template_id, based_on_version_id)
    -> template_versions(template_id, id)
```

A version may not use itself as its base. The service should also reject ancestry cycles. A trigger or recursive verification is required if the database stores more than one ancestor level.

## Version category and item lineage

Stable categories and items belong to a template, while snapshot rows belong to a version of that template.

Executable tables should carry enough parent identity to enforce both facts.

One acceptable shape is:

```text
version_categories
  id
  version_id
  template_id
  category_id

(version_id, template_id)
    -> template_versions(id, template_id)

(category_id, template_id)
    -> template_categories(id, template_id)
```

And similarly:

```text
version_items
  id
  version_id
  template_id
  item_id
  category_version_id
  spending_bucket_id

(version_id, template_id)
    -> template_versions(id, template_id)

(item_id, template_id)
    -> template_items(id, template_id)

(category_version_id, version_id)
    -> version_categories(id, version_id)

(spending_bucket_id, version_id)
    -> version_spending_buckets(id, version_id)
```

A category or bucket from version 12 must therefore be impossible to attach to an item in version 13.

## Rule target lineage

Tax and general rule rows already contain `version_id`. Their optional category/item targets must use composite foreign keys tied to the same version:

```text
(category_version_id, version_id)
    -> version_categories(id, version_id)

(item_version_id, version_id)
    -> version_items(id, version_id)
```

Scope checks still enforce the correct null/non-null target combination.

A rule cannot target an item from another version even when that item ID exists.

## Publication lineage

`template_publications` must prove that the published version belongs to the published template:

```text
(version_id, template_id)
    -> template_versions(id, template_id)
```

The partial unique index allowing one row with `ended_at IS NULL` per template remains required.

Promotion must lock the template's current publication state so concurrent promotions cannot both pass preflight and race.

## Proposal lineage

A proposal's base and candidate versions must both belong to its template:

```text
(base_version_id, template_id)
    -> template_versions(id, template_id)

(candidate_version_id, template_id)
    -> template_versions(id, template_id)
```

`base_version_id` may be null only for a proposal that creates the first version of a template.

The candidate version remains unique to one proposal after submission unless a later reviewed workflow explicitly supports reused candidates.

## Review-reason lineage

A proposal review reason may point to an item, category, rule, or evidence record.

The targeted item/category/rule must belong to the candidate version or the explicitly selected comparison version. The database should store a `target_version_id` and use composite foreign keys rather than accepting any globally valid row ID.

The service also verifies that the target version is one of the proposal's allowed sides.

## Order-line lineage

An order line must belong to the exact version used by the order.

One acceptable shape is:

```text
order_items
  order_id
  template_version_id
  version_item_id
  ...snapshots

(order_id, template_version_id)
    -> orders(id, template_version_id)

(version_item_id, template_version_id)
    -> version_items(id, version_id)
```

The same rule applies to persisted order bucket totals when they reference a version bucket.

The server still stores snapshots for historical explanation, but snapshots do not excuse broken provenance.

## Evidence relationship lineage

Version evidence must point to a version the current user is allowed to view when creating the relationship. Database ownership cannot be inferred from a plain evidence ID.

Private evidence should include owner/scope metadata, and publication should create or reference only a separately approved public evidence record. A public version must never acquire an accidental reference to another user's private raw upload.

This requires a transactionally validated publication service and may justify separate private-upload and public-evidence identities, as proposed in the main design.

## Private-record ownership checks

Conditional ownership cannot be fully expressed with a simple `ON DELETE CASCADE` when public and private records share a table.

For `facilities`, `store_programs`, and `templates`:

- private scope requires `owner_user_id`;
- public scope requires `owner_user_id IS NULL`;
- private records are removed explicitly by the account-deletion service;
- public facts retain nullable creator metadata;
- ordinary delete routes are not provided for public records after use;
- archived and merged states replace destructive deletion.

The account-deletion service locks and classifies affected rows rather than depending on one broad cascade.

## Account support and deletion

Retained support/audit history must not make account deletion impossible.

Adjust the conceptual account-support relationships as follows:

```text
account_support_cases.user_id
    nullable references public.users(id) on delete set null

account_support_cases.opened_by_user_id
    nullable references public.users(id) on delete set null

account_recovery_tokens.user_id
    references public.users(id) on delete cascade

admin_audit_events.actor_user_id
    references public.users(id) on delete set null

admin_audit_events.target_user_id
    references public.users(id) on delete set null
```

Before deleting a user:

1. revoke and delete active recovery tokens;
2. redact or remove support text according to the retention policy;
3. preserve only the minimum support-case metadata required to explain retained audit events;
4. null the target/actor user relationships through the foreign keys;
5. delete the user and verify no private records remain.

A support case should include a bounded non-sensitive subject snapshot or irreversible correlation value only when needed to interpret a retained audit event after the user ID is removed. It must not retain the former email address by default.

## Immutability trigger coverage

Sealing a template version must protect:

- the `template_versions` content columns;
- version categories;
- version items;
- spending buckets;
- tax rules;
- general rules;
- the canonical content hash;
- evidence relationships included in the sealed factual package, when applicable.

Lifecycle events, assessments, publication periods, reviews, and later evidence about the version remain separately appendable.

The trigger functions must reject direct updates and deletes using the normal application database role. They should not rely on route behavior alone.

## Concurrency

The following operations require row locks or another explicit serialization mechanism:

- allocate the next version number for one template;
- seal and submit a version;
- switch the current publication;
- merge facilities;
- resolve a correction through a replacement proposal;
- perform owner-assisted recovery;
- delete an account;
- save an order when optimistic revision checks are used.

Unique constraints remain the final defense against races.

## Required constraint tests

In addition to the main design's verification list, migration tests must attempt and reject:

- an item snapshot using a category from another version;
- an item snapshot using a spending bucket from another version;
- a tax rule targeting an item from another version;
- a version using a base version from another template;
- a publication using a version from another template;
- a proposal using a candidate or base version from another template;
- an order combining a facility, program, template, or version from different lineages;
- an order line using an item from another template version;
- a review reason targeting an unrelated version;
- a public version referencing private evidence owned by another user;
- account deletion being blocked solely by retained support/audit foreign keys.

These are database tests, not merely controller tests.
