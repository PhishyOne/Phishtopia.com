# StoreCalc migration 0009: order constraints

This package adds the first executable subset of typed catalog constraints:
immutable order-wide aggregate constraints beneath template versions. It
implements the V1 order-aggregate portion of SC-CAT-007 while preserving
SC-DAT-001 through SC-DAT-007, SC-DB-001 through SC-DB-004, SC-CAL-001,
SC-CAL-003, SC-CAL-004, SC-SEC-001, SC-STM-001 through SC-STM-003,
SC-OPS-001 through SC-OPS-004, and SC-DEF-002.

## Scope

The migration requires the exact verified `0008_tax_rules` state. It creates
only `storecalc.version_constraints`. The stored vocabulary is deliberately
identical to the calculation core's `constraints.order_aggregate.v1`
capability:

- constraint type is `order_aggregate`;
- measure type is `total_quantity` or `distinct_line_count`;
- comparator is `less_than_or_equal` or `greater_than_or_equal`;
- value state is `known`, `unlimited`, `not_applicable`, `unknown`, or
  `unsupported`;
- only `known` carries a canonical nonnegative limit no greater than
  1,000,000,000;
- `greater_than_or_equal` cannot be paired with `unlimited`;
- unit code is `count`;
- scope is `order`;
- composition behavior is `all_must_pass`; and
- priority is bounded and maps to the deterministic engine sort order, with
  stable key as the tie-breaker.

Stable keys are unique inside a version. The package creates no data rows and
makes no real facility, catalog, limit, applicability, or acceptance claim.

## Deliberate partial boundary

`storecalc.constraint_memberships` is not created in this slice. The V1 engine
evaluates every order-aggregate constraint over all selected lines and has no
item/category contribution model. Creating memberships now would invent
target, contribution, and composition semantics that no resolver or
calculator can truthfully consume.

Scoped item/category/group constraints, money and weight measures, membership
contributions, mutually exclusive or grouped rules, and any time-period or
prior-purchase rule remain explicitly unsupported. A later capability and
migration must introduce those semantics together and complete the remaining
SC-CAT-007 surface.

## Mutation and sealing semantics

The table's statement trigger takes the existing template-version topology
lock before row work. Its row trigger reuses the reviewed version-content
mutability function, which checks old and new parents under lock. A constraint
cannot be inserted into, moved into, updated under, or deleted from a sealed
version. Draft content also cannot change after its template leaves the
draft/active lifecycle.

This lock order serializes constraint mutation with version sealing and
template lifecycle changes. Draft rows remain mutable only through a later
authorized aggregate service; no runtime role receives access here.

## Verification and rollback

`up.sql` runs the complete `0008` verifier before mutation. `verify.sql` checks
the full inherited schema plus the exact relation, columns, defaults,
constraints, indexes, foreign key, identity-sequence shape, triggers, owners,
grants, closed capability state, and engine-aligned vocabulary.

`down.sql` requires the table to be empty and its identity sequence to be
unused. It drops only this slice's two triggers and table, uses no `CASCADE`,
restores the prior closed capability marker, and runs the complete `0008`
verifier after mutation. Once a constraint has existed, recovery is
forward-only unless the never-used test state is explicitly restored in a
disposable database.

## Deferred work

Constraint memberships and additional constraint capabilities, warnings,
source evidence, canonical content serialization and sealing services, forks,
publication, applicability, profiles, orders, translations, and real
facility/catalog data remain absent. The anonymous-calculation capability
advances to schema version 6 but remains unavailable and unverified.

## Production boundary

This package is not authorized for production execution by this pull request.
Production still requires the backup/restore rehearsal and separately reviewed
execution path required by SC-OPS-002 and SC-OPS-004. Generic SQL or shell
input remains forbidden.
