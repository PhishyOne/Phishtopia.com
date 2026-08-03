# StoreCalc migration 0006: version categories and items

This package adds the first content rows beneath immutable template version
headers. It implements SC-CAT-004 while preserving SC-DAT-001 through
SC-DAT-007, SC-DB-001 through SC-DB-004, SC-CAL-001, SC-CAL-004,
SC-SEC-001, SC-STM-001 through SC-STM-003, SC-OPS-001 through SC-OPS-004,
and SC-DEF-002.

## Scope

The migration requires the exact verified `0005_template_versions` state. It
creates only `storecalc.version_categories` and
`storecalc.version_items`. Composite foreign keys prove that every version,
stable category or item identity, and category target belongs to the same
template and version lineage.

The item state vocabulary is deliberately identical to the calculation core:

- price state is `known`, `unknown`, or `unsupported`;
- only a known price carries a nonnegative signed-64-bit minor-unit value;
- availability is `available`, `unavailable`, or `unknown`;
- minimum, maximum, and step quantities are positive and bounded at 1,000,000;
- maximum is never below minimum; and
- sort order is bounded from 0 through 1,000,000.

Short display text is trimmed, control-free, and bounded by both characters
and bytes. SKU and unit labels are optional bounded source values, not stable
identities. This package creates no data rows and makes no real catalog claim.

## Mutation and sealing semantics

Statement-level triggers on both child tables take the existing template
version topology lock before row work. Row-level validation then locks the old
and new version/template parents as needed. A child cannot be inserted into,
moved into, updated under, or deleted from a sealed version. Draft content also
cannot change after its template leaves the draft/active lifecycle.

This lock order serializes child mutation with version sealing and template
lifecycle changes. Once the parent header is sealed, every category and item
row beneath it is immutable. Draft rows remain mutable only through a later
authorized aggregate service; no runtime role receives access here.

## Verification and rollback

`up.sql` runs the complete `0005` verifier before mutation. `verify.sql`
checks the full inherited schema plus exact new relations, columns,
constraints, indexes, composite foreign keys, sequence state, trigger/function
definitions, owners, grants, closed capability state, and calculation bounds.

`down.sql` requires both new tables to be empty and both identity sequences to
be unused. It drops only this slice's four triggers, one function, and two
tables, uses no `CASCADE`, restores the prior closed capability marker, and
runs the complete `0005` verifier after mutation. Once content has existed,
recovery is forward-only unless the never-used test state is explicitly
restored in a disposable database.

## Deferred work

Spending buckets and memberships, taxes, typed constraints, warnings, source
evidence, hashing/sealing services, forks, publication, applicability,
profiles, orders, translations, and real facility/catalog data remain absent.
The anonymous-calculation capability advances to schema version 3 but remains
unavailable and unverified.

## Production boundary

This package is not authorized for production execution by this pull request.
Production still requires the backup/restore rehearsal and separately reviewed
execution path required by SC-OPS-002 and SC-OPS-004. Generic SQL or shell
input remains forbidden.
