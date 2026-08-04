# StoreCalc migration 0010: V1 catalog warnings

This package adds the warning content required before a catalog version can be
sealed or resolved honestly. It implements the engine-supported portion of
SC-CAT-008: template-wide and exact-item warnings whose normalized shape is
`warningCode`, `severity`, and `messageKey`.

The migration requires the exact verified `0009_constraints` state. It creates
only `storecalc.version_warnings`, creates no data rows, and advances the closed
`anonymous.calculation` schema marker from 6 to 7. The capability remains
unavailable and unverified.

## V1 boundary

- `warning_code` uses the calculation core's 64-byte stable-key grammar.
- Severity is exactly `warning` or `informational`.
- Scope is exactly `template` or `item`.
- Item targets use a composite foreign key to prove same-version lineage.
- Template and item warning identities are independently unique and match the
  calculation core's warning identity tuple.
- `message_key` uses the core's bounded dotted-key grammar.
- `category_version_id` is retained for the authoritative schema shape but must
  remain null until category-warning composition is reviewed.
- `bounded_details` must be the empty JSON object in V1. This preserves a
  forward-compatible bounded field without allowing details that the current
  calculation contract cannot canonicalize or expose.

This slice creates no warning, catalog, facility, applicability, evidence, or
acceptance claim. Empty warnings mean only that no warning row has been stored;
they do not prove that a future catalog is complete or ready.

## Mutation, verification, and access

The table reuses the version topology and content-mutability triggers. Every
insert, update, move, or delete serializes with template-version sealing and is
rejected once the parent version is sealed or its template is closed.

The verifier checks the full inherited schema plus the exact new relation,
columns, defaults, every check body, indexes, foreign keys, identity sequence,
triggers, owners, persistence/RLS state, ACL allowlist, grants, and capability
state. `PUBLIC`, the web role, and the worker role receive no table or sequence
privilege. The backup role receives read-only access.

Rollback is allowed only while the table is empty and its identity sequence has
never been used. It verifies the complete current state before mutation, drops
only this migration's table and triggers, restores the closed schema marker to
`0009_constraints`, and verifies that exact baseline afterward. Any drift,
later dependency, inserted row, or sequence use fails before mutation.

## Explicit deferrals

Category warnings, nonempty typed details, warning translations, source
evidence, later context-evidence events, canonical catalog sealing, template
publication, applicability, deterministic database resolution, profiles,
orders, real catalog rows, runtime catalog grants, and production execution all
remain absent.

This migration is not authorized for production execution. SC-OPS-002 rehearsal
and an independently reviewed SC-OPS-004 execution path are still required.
