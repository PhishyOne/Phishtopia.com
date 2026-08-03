# StoreCalc migration 0004: template identity

This package adds the stable template identity spine required before immutable
catalog versions can exist. It implements the identity subset of SC-CAT-001
and SC-CAT-002 while preserving SC-DAT-001, SC-DAT-003, SC-DAT-004,
SC-DB-001 through SC-DB-004, SC-SEC-001, SC-OPS-001 through SC-OPS-004,
and SC-DEF-002.

## Scope

The migration requires the exact verified `0003_program_assignments` state.
It creates only:

- public or private template identities bound to one shared program;
- stable category identities within a template; and
- stable item identities within a template.

It creates no template fork, catalog identity event, version, version content,
price, rule, evidence, publication, applicability, profile, order, or data row.
Version headers are intentionally deferred until reviewed currency,
calculation-contract, content-schema, and canonicalization allowlists can be
introduced as one exact boundary.

The `anonymous.calculation` capability advances to schema version 1 but stays
unavailable and unverified. Web and worker roles receive no access to the new
tables, sequences, or functions. The backup role receives read-only access.
`PUBLIC` receives nothing. No route, resolver, feature switch, generic SQL
runner, workflow, or production action is added.

## Identity and ownership semantics

A public template must belong to a public program and cannot have an owner. A
private template requires an owner. It may extend a public program or a private
program owned by that same user, but cannot cross private owners.

Template program, visibility, owner, creator, and creation identity are
immutable in this slice. Program scope and owner cannot be rewritten after a
template exists. Template archiving is one-way. Stable category and item keys,
parents, creators, and creation times are immutable; retirement is one-way and
the retained retired row continues to reserve its key. Later sealed-version
foreign keys make every used identity non-deletable; unused private-draft
deletion remains a separate authenticated lifecycle concern.

Statement-level topology triggers serialize template creation and relevant
program or child-identity changes before row locks are taken. That gives parent
and child mutations one lock order and closes the insert-versus-parent-rewrite
race without a row-trigger lock upgrade.

## Verification and rollback

`up.sql` runs the complete `0003` verifier before mutation. `verify.sql` checks
the exact new relation, column, constraint, index, foreign-key, sequence,
function, trigger, owner, grant, and capability state while preserving the
known `0003` baseline. The PostgreSQL 17 harness exercises public/private
coherence, cross-owner rejection, stable-key uniqueness and immutability,
one-way retirement and archive behavior, serialized parent races, role
isolation, same-name drift, unexpected grants, disabled triggers, reruns, and
rollback refusal.

`down.sql` is safe only while all three new tables are empty, their identity
sequences remain unused, the capability row is unchanged, and no later object
exists. It removes only the eight new triggers, four functions, and three
tables with their owned indexes and sequences. It uses no `CASCADE`. Once
identity data or later schema exists, recovery is forward-only.

## Production boundary

This package is not authorized for production execution by this pull request.
Production still requires the backup/restore rehearsal and a separately
reviewed exact repository-owned or bounded manually supervised path required
by SC-OPS-002 and SC-OPS-004. Generic SQL or shell input remains forbidden.
