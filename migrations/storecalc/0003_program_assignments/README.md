# StoreCalc migration 0003: shared programs and assignments

This package adds the bounded program identity and facility applicability spine
required before StoreCalc can attach a template to a facility and audience. It
implements SC-APP-001 and the assignment subset of SC-APP-002, while preserving
the database, privacy, data, and operations controls in SC-DAT-001 through
SC-DAT-004, SC-DB-001 through SC-DB-004, SC-SEC-001, SC-OPS-001 through
SC-OPS-004, and SC-DEF-002.

## Scope

The migration requires an exact, verified `0002_directory_lineage` baseline.
It creates only:

- shared public or private program identities that are not owned by a facility;
- explicit program/facility/audience/effective-date assignments;
- serialized assignment-integrity triggers that reject overlapping supported
  intervals, cross-country agency assignments, and mismatched private owners;
- protective triggers that prevent assigned program, agency-country, or
  facility ownership/country lineage from being rewritten in place; and
- indexes needed for later viewer-scoped assignment resolution.

The package creates no program, assignment, country, facility, catalog,
template, version, price, rule, order, evidence, applicability, profile, or
publication row. `source_evidence_id` is deliberately present but constrained
to `NULL` until the evidence aggregate and its real foreign key are added by a
later reviewed migration. The `public.directory` capability advances to schema
version 2 but remains unavailable and unverified.

The web and worker roles receive no privilege on the new program or assignment
tables, sequences, or functions. The backup role receives read-only table and
sequence access. `PUBLIC` receives nothing. No route, resolver, feature switch,
generic SQL runner, extension, or production action is added.

## Assignment semantics

`supported` is the only resolver-eligible assignment state in this slice.
Supported intervals for the same program, facility, and audience cannot
overlap, including open-ended intervals and shared endpoints. Adjacent periods
remain valid when the earlier interval ends the day before the next begins.

An agency-owned program may be assigned only to a facility in the agency's
country. A private program and private facility may be related only when they
have the same owner. Public programs may be selected privately for a private
facility, and a user may keep a private program for a public facility; those
relationships remain invisible because runtime roles have no table access and
later services must apply viewer scope.

Once an assignment exists, the program's owning agency/scope/owner, the
facility's physical country/scope/owner, and the owning agency's country cannot
be rewritten in place. Later reconciliation uses explicit history rather than
silently changing the assignment's ancestry.

## Lock and runtime behavior

Forward, verification, and rollback SQL use the same fixed transaction-scoped
advisory lock as migrations 0001 and 0002, a 3-second lock timeout, and a
30-second statement timeout. Program and assignment creation takes catalog
locks only for new StoreCalc objects and the one capability-row update.

Statement-level topology triggers take a `SHARE ROW EXCLUSIVE` lock on the
small assignment table before assignment rows or referenced parent rows are
locked. This deliberately serializes rare applicability topology changes,
closes the concurrent overlapping-row race, and gives assignment and parent
updates one lock order rather than relying on a deadlock-prone row-trigger lock
upgrade.

## Verification and rollback

`verify.sql` checks the exact new object inventory, columns/defaults,
constraints, indexes, identity sequences, functions, triggers, owners, grants,
and capability state. The PostgreSQL 17 harness exercises shared programs,
separate audiences/facilities, inclusive and open interval overlap,
cross-country assignments, private-owner isolation, deferred evidence,
lineage rewrite protection, runtime isolation, same-name drift, unexpected
grants, disabled triggers, capability drift, reruns, and rollback refusal.

`down.sql` is safe only while both new tables are empty, both new identity
sequences remain unused, the capability row is unchanged, every protected
baseline object remains exact, and no later StoreCalc object exists. It removes
only the four protective functions, eight triggers, two tables, and their
owned indexes/sequences. It uses no `CASCADE`. Once program data or a later
migration exists, recovery is forward-only.

## Production boundary

This package is not authorized for production execution by this pull request.
Production still requires the backup/restore rehearsal and a separately
reviewed exact repository-owned or bounded manually supervised path required by
SC-OPS-002 and SC-OPS-004. Generic SQL or shell input remains forbidden.
