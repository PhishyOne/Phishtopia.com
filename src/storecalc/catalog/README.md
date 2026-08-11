# StoreCalc V1 catalog-content sealing core

This package defines the pure `storecalc.catalog-content.v1` document that is
hashed into `template_versions.content_hash`. It is distinct from the existing
resolved-configuration hash used by the calculation engine: a template version
must preserve its raw category, item, bucket, membership, tax-rule, constraint,
warning, and source-evidence meaning before a resolver can derive per-item
calculation input.

`sealCatalogVersionContent` accepts only the exact V1 shape, normalizes every
bounded value, sorts repeated records by semantic keys, and returns an
immutable SHA-256-sealed document. `verifyCatalogVersionContent` repeats the
same normalization and rejects a malformed or stale hash. Both functions are
pure and have no database, clock, locale, filesystem, network, or route
dependency.

## Hash boundary

The content hash includes:

- content/canonicalization/calculation contract versions and hash algorithm;
- currency, source effective/published dates, and required capabilities;
- category and item content identified by stable template keys;
- spending buckets and exact item/bucket memberships;
- scoped tax-rule inputs and order-wide constraints;
- template- and exact-item-scoped V1 warnings; and
- immutable evidence and independence-group fingerprints.

Database row IDs, template/version IDs, version numbers, draft/sealed state,
timestamps, contributor identities, evidence URLs, titles, filenames, object
keys, and private metadata are deliberately absent. They are lineage or
operational state, not canonical catalog content. Evidence fingerprints bind
the reviewed source identity without copying private or mutable source fields
into the catalog document.

## Closed V1 boundary

- Identity keys use the same underscore-only grammar as the stable template
  category/item and spending-bucket tables.
- V1 warnings are template- or item-scoped, use only warning/informational
  severity, and require empty bounded details.
- V1 source evidence uses the single `supports_catalog` relationship and
  requires both an evidence fingerprint and an independence-group fingerprint.
- At least one source-evidence reference is required to seal content. An empty
  source list cannot become an apparently supported sealed catalog.
- Extra syntactically valid required capabilities may be sealed for historical
  truth, but publication, resolution, and calculation must separately reject
  unsupported capabilities.

## Atomic database sealing

`sealCatalogVersion` is the single database transition for this content shape.
It requires a dedicated `pg.Pool` connection supplied by an already authorized
caller; it grants no role access and is not imported by any route.

The service:

- begins one bounded read-committed transaction, holds the shared side of the
  StoreCalc migration advisory lock, requires the exact closed 0011 capability
  generation, and acquires the existing `template_versions`
  share-row-exclusive topology lock before reading; read committed is required
  so an in-flight mutation that held the topology lock can commit before the
  service takes its first content snapshot;
- checks every child count against the pure-content bounds before loading rows;
- extracts stable category/item keys and every canonical V1 domain with
  explicit PostgreSQL-to-JavaScript casts, including `bigint` values as
  base-10 strings and dates as calendar strings;
- rechecks source-evidence and independence-group eligibility at seal time;
- passes only the reconstructed document to `sealCatalogVersionContent`;
- compare-and-sets that same draft header to the resulting SHA-256 hash; and
- rolls the transaction back on missing, stale, malformed, ineligible,
  unsupported, type-drifted, or concurrently superseded state.

Every catalog child mutation uses the same topology lock. A mutation already
holding it finishes before extraction; a mutation that starts after sealing
owns it waits and is then rejected by the sealed-content guard. Two sealing
attempts serialize, and only the first can transition the draft.

No new database object is required for this slice: migrations 0005 through
0011 already provide the one-way header transition, immutable child guards,
and shared lock. Adding a second SQL canonicalizer or an otherwise unused
stored procedure would create another source of truth without improving the
transaction.

This package still does not create evidence records, decide source
independence, publish a version, resolve facility applicability, activate a
route, grant runtime access, or authorize production execution. Those remain
separately reviewed slices.
