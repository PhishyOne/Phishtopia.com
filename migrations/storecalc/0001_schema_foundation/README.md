# StoreCalc migration 0001: schema foundation

This package implements the first bounded executable StoreCalc slice. It maps
SC-FND-006, SC-DAT-001, SC-DAT-003, SC-DB-001, SC-OPS-001, SC-OPS-003,
SC-OPS-004, and SC-DEF-002 from the authoritative implementation contract.

## Scope

The migration creates only:

- the `storecalc` schema, owned by the configured migration owner;
- `storecalc.schema_capabilities` and its identity sequence;
- one verified `schema.foundation` row; and
- disabled rows for every currently defined product launch gate.

It grants the configured web and worker roles only schema `USAGE` and table
`SELECT`. The configured backup role additionally receives sequence `SELECT`.
No runtime role owns an object or receives create or write access. `PUBLIC`
receives nothing.

No account, facility, template, catalog, calculation, order, evidence, review,
notification, upload, job, or owner-support table is introduced. No extension,
generic migration runner, production action, or feature route is added. Product
capabilities remain unavailable.

## Required role settings

The exact SQL reads four trusted session settings:

- `storecalc.migration_owner_role`
- `storecalc.web_role`
- `storecalc.worker_role`
- `storecalc.backup_role`

The roles must already exist, be distinct, not inherit one another, and lack
superuser, bypass-RLS, role/database creation, and replication attributes. The
migration must execute as the configured migration owner. Only that owner may
have database `CREATE` among the four configured roles.

Role names are resolved from PostgreSQL configuration at execution time. The
only dynamic statements are identifier-quoted grants to those already
validated roles; no value or SQL text comes from an application request.

## Lock and runtime behavior

Both directions use one fixed transaction-scoped advisory lock to serialize
StoreCalc migrations, a 3-second lock timeout, and a 30-second statement
timeout. The forward migration takes catalog locks only for a new schema,
table, indexes, and grants. It does not lock or rewrite an existing application
table. Expected runtime on an otherwise healthy database is well below one
second.

## Verification and rollback

`verify.sql` checks the exact relation, column/default, constraint body, index,
identity-sequence, owner, grant/grantee, and capability-state inventory. The
database test harness also exercises hostile role configuration, an unsafe
pre-existing schema, rerun rejection, effective runtime permissions, same-name
constraint drift, unexpected grantees, sequence drift, capability drift,
rollback refusal, and restoration of the original no-schema fingerprint.

`down.sql` is permitted only while this exact foundation remains untouched. It
uses no `CASCADE`; any extra object, dependency, capability row, enabled product
gate, or changed migration marker fails before mutation. The fixed foundation
rows are operational seed state, not user data. Once a later StoreCalc
migration exists or live data is possible, corrections use a new forward
migration instead of this rollback.

If the forward transaction fails, PostgreSQL rolls it back atomically. Repair
the role configuration or conflicting pre-existing object, confirm the package
checksums are unchanged, and rehearse again. Never edit an applied migration.

## Production boundary

This package is not authorized for production execution by this pull request.
Production still requires the backup/restore rehearsal and a separately
reviewed exact repository-owned or bounded manually supervised path required by
SC-OPS-002 and SC-OPS-004. Generic SQL or shell input remains forbidden.
