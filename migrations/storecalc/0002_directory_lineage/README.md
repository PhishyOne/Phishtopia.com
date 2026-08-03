# StoreCalc migration 0002: directory lineage

This package adds the bounded directory identities required before StoreCalc can
attach programs, catalog templates, applicability, or saved orders to a real
facility. It maps the database controls in SC-PRV-001, SC-DIR-001,
SC-DIR-002, the alias/source subset of SC-DIR-003, SC-DB-001 through
SC-DB-004, and SC-OPS-001 through SC-OPS-004 from the authoritative
implementation contract.

## Scope

The migration requires an exact, verified `0001_schema_foundation` baseline
and an existing integer-keyed `public.users` table. It creates only:

- internal contributor subjects needed for facility provenance;
- an initially empty reviewed IANA-timezone allowlist;
- countries, country-coherent jurisdiction hierarchy, and agencies;
- public/private facility identities with exact owner and physical-lineage
  constraints;
- facility aliases and official source records; and
- three fixed-search-path trigger functions that reject unknown timezones,
  jurisdiction cycles, and facility-merge cycles.

The package intentionally creates no country, facility, alias, source,
program, template, catalog, price, rule, order, request, evidence, proposal,
fact-version, merge-event, import, or user-setting seed row. Historical
facility facts and merge events remain deferred until their evidence and actor
lineage exists. The `public.directory` capability records schema version 1 but
remains unavailable and unverified.

The web and worker roles receive no privilege on the new directory tables,
sequences, or functions. The backup role receives read-only table and sequence
access. `PUBLIC` receives nothing. No route, resolver, feature switch, generic
SQL runner, extension, or production action is added.

## Required baseline and roles

The exact `0001_schema_foundation/verify.sql` must pass immediately before this
migration. The four trusted role settings remain:

- `storecalc.migration_owner_role`
- `storecalc.web_role`
- `storecalc.worker_role`
- `storecalc.backup_role`

They must still be distinct, non-inheriting, non-privileged role classes. The
migration executes as the configured migration owner. `public.users.id` must
be a non-null integer primary key, and the migration owner must hold
`REFERENCES` on that column. The migration does not alter `public.users`.

## Lock and runtime behavior

Forward, verification, and rollback SQL use the same fixed
transaction-scoped advisory lock as migration 0001, a 3-second lock timeout,
and a 30-second statement timeout. Directory creation takes catalog locks only
for new StoreCalc objects and the one capability-row update. It neither rewrites
an application table nor reads user rows. Expected runtime on an otherwise
healthy database is below one second.

The cycle triggers take `SHARE ROW EXCLUSIVE` locks only when a non-null parent
or merge pointer is inserted or changed. Directory writes are intentionally
low-volume; serializing these rare topology changes closes the concurrent
two-row cycle race that a plain recursive check would miss.

## Verification and rollback

`verify.sql` checks the exact object inventory, columns/defaults, constraints,
indexes, identity sequences, functions, triggers, owners, grants, and
capability state. The PostgreSQL 17 harness exercises wrong baselines,
cross-country references, owner/scope null patterns, invalid timezones,
jurisdiction and merge cycles, source/alias bounds, runtime isolation,
same-name drift, unexpected grants, capability drift, and rollback refusal.

`down.sql` is safe only while every new table is empty, every new identity
sequence remains unused, the capability row is unchanged, and no later
StoreCalc object exists. It uses no `CASCADE`. Once any directory data or later
migration exists, recovery is forward-only: disable dependent capabilities,
repair with a new reviewed migration, and preserve lineage.

## Production boundary

This package is not authorized for production execution by this pull request.
Production still requires the backup/restore rehearsal and a separately
reviewed exact repository-owned or bounded manually supervised path required by
SC-OPS-002 and SC-OPS-004. Generic SQL or shell input remains forbidden.
