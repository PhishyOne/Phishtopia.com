# StoreCalc migration 0008: tax rules

This package adds immutable scoped tax-treatment rules beneath template
versions. It implements SC-CAT-006 while preserving SC-DAT-001 through
SC-DAT-007, SC-DB-001 through SC-DB-004, SC-CAL-001, SC-CAL-004,
SC-SEC-001, SC-STM-001 through SC-STM-003, SC-OPS-001 through SC-OPS-004,
and SC-DEF-002.

## Scope

The migration requires the exact verified `0007_buckets` state. It creates
only `storecalc.version_tax_rules`. Every rule belongs to one version and has
exactly one supported scope:

- `template` has no category or item target;
- `category` has one same-version category target and no item target; or
- `item` has one same-version item target and no category target.

Partial unique indexes prevent two rules with the same scope target and
priority. A later resolver may therefore apply specificity and priority
without silently stacking ambiguous equal-priority rules.

The stored treatment vocabulary is deliberately identical to the calculation
core:

- treatment state is `known`, `not_applicable`, `unknown`, or `unsupported`;
- only `known` carries a rate, inclusion flag, rounding mode, and rounding
  scope;
- rates are integer parts per million from 0 through 1,000,000;
- rounding mode is `half_up`, `floor`, or `ceiling`;
- the first contract supports line rounding only; and
- priority is bounded from 0 through 1,000,000.

The reviewed version header already fixes USD with two minor decimal places.
This package creates no data rows and makes no real tax, facility, catalog,
applicability, or acceptance claim.

## Mutation and sealing semantics

The table's statement trigger takes the existing template-version topology
lock before row work. Its row trigger reuses the reviewed version-content
mutability function, which checks old and new parents under lock. A tax rule
cannot be inserted into, moved into, updated under, or deleted from a sealed
version. Draft content also cannot change after its template leaves the
draft/active lifecycle.

This lock order serializes tax mutation with version sealing and template
lifecycle changes. Draft rows remain mutable only through a later authorized
aggregate service; no runtime role receives access here.

## Verification and rollback

`up.sql` runs the complete `0007` verifier before mutation. `verify.sql` checks
the full inherited schema plus the exact relation, columns/defaults,
constraints, indexes, null-target patterns, composite foreign keys,
identity-sequence shape, triggers, owners, grants, closed capability state,
and calculation vocabulary.

`down.sql` requires the table to be empty and its identity sequence to be
unused. It drops only this slice's two triggers and table, uses no `CASCADE`,
restores the prior closed capability marker, and runs the complete `0007`
verifier after mutation. Once a tax rule has existed, recovery is forward-only
unless the never-used test state is explicitly restored in a disposable
database.

## Deferred work

The effective-rule resolver, typed constraints, warnings, source evidence,
canonical content serialization and sealing services, forks, publication,
applicability, profiles, orders, translations, and real facility/catalog data
remain absent. The anonymous-calculation capability advances to schema version
5 but remains unavailable and unverified.

## Production boundary

This package is not authorized for production execution by this pull request.
Production still requires the backup/restore rehearsal and separately reviewed
execution path required by SC-OPS-002 and SC-OPS-004. Generic SQL or shell
input remains forbidden.
