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

## Public facility/date version resolution

`resolvePublicCatalogVersion` is the first read-only database resolver over the
0012 publication/applicability schema. It accepts exact facility, program, and
template IDs plus one audience key and explicit calendar context date. It does
not infer a program from a facility name, prefer the newest row, or use the
browser clock.

One bounded PostgreSQL statement joins the public active facility, program,
and template to a supported assignment and one open supported applicability
claim. Both valid-date intervals must contain the requested context date. The
selected target must be either the claim's exact sealed version or the exact
sealed version named by its publication row. A closed publication row remains
valid lineage for an applicability claim that deliberately retained that
historical version; the result reports whether that publication is still the
global current row instead of silently switching the facility.

The query loads at most two candidates from one statement snapshot. Zero
returns an immutable unavailable result, one returns the exact assignment,
applicability, publication/version, interval, contract, capability, and content
hash metadata, and two fail as ambiguous. Future-effective versions,
unsupported calculator capabilities, noncanonical capability arrays, schema
generation drift, malformed hashes/types, private or inactive parents, and
disputed or closed applicability all fail closed.

This slice intentionally resolves only the immutable base catalog version. It
does not reconstruct content, compose scoped profiles, persist a resolved
configuration, derive a facility-local date, authorize a viewer, or calculate
an order. The exact 0012 capability remains unavailable and unverified, and no
runtime route imports the service.

## Pure zero-profile configuration projection

`projectCatalogVersionContent` is the deterministic seam between one already
verified `storecalc.catalog-content.v1` document and the existing calculation
core's sealed `storecalc.resolved-configuration.v1` input. It has no database,
clock, network, route, registry, or environment dependency.

For every item, tax selection is most-specific first (`item`, then `category`,
then `template`) and highest-priority within that exact scope. The projector
never stacks tax rules and refuses to invent a tax-free result when no rule
matches. It carries exact item values, memberships, buckets, warnings, and
all-must-pass constraints into the calculation shape, rejects capabilities the
engine does not support, and seals the output through the authoritative
calculation core. Source array order cannot affect the resolved hash.

The caller supplies one exact lineage-based configuration key. This projector
does not derive that key, load database rows, select a version, compose scoped
profiles, persist/cache a resolved configuration, authorize a viewer, register
public data, or mount the calculator. Those remain separate reviewed slices.

## Exact sealed-content loading

`loadSealedCatalogVersionContent` fills the database-loading gap between the
facility/date resolver and the pure projector. Its caller must provide the
exact version ID, template ID, and SHA-256 content hash already obtained from
trusted resolution; the loader never chooses a version or substitutes a newer
publication.

The service uses one dedicated PostgreSQL connection. Before opening its
read-only, repeatable-read transaction, it takes the shared session side of the
StoreCalc migration advisory lock; an active migration causes an immediate
fail-closed result rather than a wait followed by a stale snapshot. The lock
freezes the reviewed schema generation while the transaction checks the exact
closed 0012 capability, verifies the sealed header and caller-supplied lineage,
enforces all catalog row bounds, and reconstructs every canonical content
domain. Sealed catalog child rows are already database-immutable, while the
repeatable snapshot keeps mutable source-evidence eligibility coherent across
the bounded multi-statement read. The session lock is explicitly released
before the pooled connection is returned; uncertain cleanup destroys that
connection instead of leaking the lock to another request.

The reconstructed document is passed through the authoritative catalog
canonicalizer. Its computed hash must equal both the sealed database header and
the caller's expected hash. Missing, draft, withdrawn, type-drifted,
lineage-drifted, unsupported-schema, or hash-mismatched state fails closed.

This loader does not resolve applicability, derive a configuration key,
project or calculate an order, compose profiles, persist/cache a configuration,
grant a runtime role, or mount a route.

## Inactive catalog-request orchestration

`orchestrateCatalogRequest` composes the reviewed public resolver, exact sealed
loader, and pure zero-profile projector behind one inactive request boundary.
It accepts only the resolver's existing facility, program, template, audience,
and explicit context-date input. An unavailable resolution returns immediately
without acquiring a loader connection or projecting content.

A resolved request binds the loader to the resolver's exact version ID,
template ID, and catalog-content hash. The service verifies the exact resolver
and loader result shapes, rejects lineage or hash drift, verifies the loaded
catalog again, and derives one bounded configuration key from a versioned
SHA-256 digest of immutable assignment/applicability/selection lineage plus the
catalog-content hash. Mutable `publicationIsCurrent` status and the context date
are reported but cannot churn the key for otherwise identical lineage.

The projected configuration is verified through the authoritative calculation
core before return. The result contains that sealed configuration plus bounded
resolver, projection, context, interval, lineage, and catalog-header metadata;
it never returns the raw loaded catalog document. A strict dependency factory
exists only as a test seam for ordering, short-circuit, and drift fixtures; the
default export is permanently bound to the reviewed resolver and loader.

This slice creates no transaction spanning the two services. Safety comes from
the resolver selecting immutable exact lineage and the loader refusing any
version/template/hash mismatch while holding its existing read-only snapshot
and migration lock. It does not authorize a viewer, compose profiles, persist
or cache a configuration, calculate an order, grant a runtime role, or mount a
route.

No new database object is required for this slice: migrations 0005 through
0011 already provide the one-way header transition, immutable child guards,
and shared lock. Adding a second SQL canonicalizer or an otherwise unused
stored procedure would create another source of truth without improving the
transaction.

This package still does not create evidence records, decide source
independence, transition applicability state, compose scoped profiles, persist
a resolved configuration, calculate an order, activate a route, grant runtime
access, or authorize production execution. Apart from the narrowly bounded
template-publication service below, write orchestration remains deferred.

## Inactive template-publication transitions

`publishCatalogVersion` owns the first bounded write service over the existing
0012 publication table. It accepts one exact active template, one exact sealed
version, the caller's expected current publication ID (or `null` for an initial
publication), one owner subject ID, and one bounded reason code. The expected
current ID is a compare-and-swap boundary: a concurrent or stale caller cannot
silently replace a publication it did not observe.

The service opens one bounded read-committed transaction, applies transaction
timeouts, takes the shared StoreCalc migration advisory lock, acquires the
existing catalog-resolution topology locks in their fixed order, and requires
the exact closed 0012 capability generation. It then verifies the target's
version/template/program lineage and active sealed state. A replacement closes
the exact current row once and inserts the new open row at the same database
transaction timestamp; an initial publication inserts without a close. The
0012 triggers independently recheck sealed lineage, active parents,
non-overlap, immutable history, and lock order.

The return value contains only frozen bounded publication lineage metadata.
Rollback uncertainty destroys the pooled connection. The service deliberately
does not authorize the owner subject, create an applicability claim, publish
real data, add a route or grant, compose profiles, persist/cache a resolved
configuration, calculate an order, or activate StoreCalc. Its future caller
must establish authorization before invocation. Applicability transitions and
all runtime/production work remain separate reviewed slices.
