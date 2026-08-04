# StoreCalc migration 0007: spending buckets

This package adds parallel pre-tax spending-limit buckets beneath immutable
template versions. It implements SC-CAT-005 while preserving SC-DAT-001
through SC-DAT-007, SC-DB-001 through SC-DB-004, SC-CAL-001, SC-CAL-004,
SC-SEC-001, SC-STM-001 through SC-STM-003, SC-OPS-001 through SC-OPS-004,
and SC-DEF-002.

## Scope

The migration requires the exact verified `0006_version_content` state. It
creates only `storecalc.version_spending_buckets` and
`storecalc.version_item_bucket_memberships`.

Every membership carries `version_id` and uses composite foreign keys to prove
that its item and bucket belong to the same immutable version. An item may
count toward zero, one, or many buckets. Bucket results are parallel pre-tax
constraints and are never summed to derive the item subtotal or order total.

The database vocabulary is deliberately identical to the calculation core:

- limit state is `known`, `unlimited`, `not_applicable`, `unknown`, or
  `unsupported`;
- only a known limit carries a nonnegative signed-64-bit minor-unit value;
- membership type is `counts_toward`, `excluded`, or `informational_only`;
- version and item primary-display flags are bounded to at most one true row;
- the reviewed v1 measure currency is `USD`, matching the version header; and
- stable keys, display labels, and sort order are strictly bounded.

The package creates no data rows and makes no real facility, catalog, price,
limit, applicability, or acceptance claim.

## Mutation and sealing semantics

Statement-level triggers on both new tables take the existing template-version
topology lock before row work. Row triggers reuse the reviewed version-content
mutability function, which checks old and new parents under lock. A bucket or
membership cannot be inserted into, moved into, updated under, or deleted from
a sealed version. Draft content also cannot change after its template leaves
the draft/active lifecycle.

This lock order serializes bucket and membership mutation with version sealing
and template lifecycle changes. Draft rows remain mutable only through a later
authorized aggregate service; no runtime role receives access here.

## Verification and rollback

`up.sql` runs the complete `0006` verifier before mutation. `verify.sql` checks
the full inherited schema plus exact new relations, columns, constraints,
indexes, composite foreign keys, identity-sequence shape, triggers, owners,
grants, closed capability state, and calculation vocabulary.

`down.sql` requires both new tables to be empty and the bucket identity
sequence to be unused. It drops only this slice's four triggers and two tables,
uses no `CASCADE`, restores the prior closed capability marker, and runs the
complete `0006` verifier after mutation. Once a bucket has existed, recovery is
forward-only unless the never-used test state is explicitly restored in a
disposable database.

## Deferred work

Taxes, typed constraints, warnings, source evidence, canonical content
serialization and sealing services, forks, publication, applicability,
profiles, orders, translations, and real facility/catalog data remain absent.
The anonymous-calculation capability advances to schema version 4 but remains
unavailable and unverified.

## Production boundary

This package is not authorized for production execution by this pull request.
Production still requires the backup/restore rehearsal and separately reviewed
execution path required by SC-OPS-002 and SC-OPS-004. Generic SQL or shell
input remains forbidden.
