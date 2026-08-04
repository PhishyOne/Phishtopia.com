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

This package does not read database rows, perform the sealing transaction,
create evidence records, judge source independence, publish a version, resolve
facility applicability, activate a route, or authorize production execution.
Those remain separately reviewed slices.
