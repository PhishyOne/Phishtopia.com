# StoreCalc migration 0005: template version headers

This package adds the immutable version-header boundary required before catalog
content can be represented. It implements SC-CAT-003 against the exact
calculation vocabulary already shipped in the pure engine, while preserving
SC-DAT-001, SC-DAT-003, SC-DAT-004, SC-DAT-006, SC-DB-001 through SC-DB-004,
SC-CAL-001, SC-CAL-004, SC-SEC-001, SC-STM-001 through SC-STM-003,
SC-OPS-001 through SC-OPS-004, and SC-DEF-002.

## Scope

The migration requires the exact verified `0004_template_identity` state. It
creates only immutable-lineage template version headers. The reviewed version
vocabulary is deliberately identical to the current calculation core:

- currency `USD` with exponent `2`;
- calculation contract `storecalc.calculation.v1`;
- content schema `storecalc.catalog-content.v1`;
- canonicalization `storecalc.canonical-json.v1`;
- hash algorithm `sha256`; and
- the five capabilities exported by the current engine.

Required capabilities are bounded, unique, and stored in canonical C-locale
order. A later migration is required to expand any reviewed vocabulary.

This package creates no version category, item, bucket, tax, constraint,
warning, evidence, fork, publication, applicability, profile, order, or data
row. The `anonymous.calculation` capability advances to schema version 2 but
remains unavailable and unverified. Web and worker roles receive no access;
backup receives read-only access. No route or production action is added.

## Draft, ancestry, and sealing semantics

Version numbers are positive and unique within a template. An optional base
version must belong to the same template and already be sealed. Base lineage
is immutable, so a parent that predates its child cannot later point back to
that child.

Every header must be inserted as a draft. Draft headers may change only while
their template is draft or active. Sealing requires the exact reviewed hash
metadata and is one-way; every sealed header field is immutable and a sealed
row cannot be deleted. Draft rows may be deleted by a later authorized private
lifecycle. Child-content migrations and the sealing service must enforce the
same aggregate lock and hash transaction.

Statement-level locks serialize version allocation, sealing, deletion, and
template lifecycle changes before row locks are taken. This closes competing
same-number inserts and template-archive races without lock upgrades.

## Verification and rollback

`up.sql` runs the complete `0004` verifier before mutation. `verify.sql` checks
the exact relation, column, constraint, index, foreign-key, sequence, function,
trigger, owner, grant, engine-vocabulary, and capability state. PostgreSQL 17
tests cover same-template sealed ancestry, cross-template and draft-parent
rejection, canonical capabilities, sealing immutability, concurrent version
allocation, runtime isolation, hostile drift, reruns, and the full rollback
chain.

`down.sql` requires the version table to be empty, its identity sequence to be
unused, the capability row to be unchanged, and no later StoreCalc object to
exist. It drops only the three new triggers, two functions, and version table
with owned indexes/sequence. It uses no `CASCADE`. Once a version exists,
recovery is forward-only unless the never-used test-only empty state is
restored under controlled conditions.

## Production boundary

This package is not authorized for production execution by this pull request.
Production still requires the backup/restore rehearsal and a separately
reviewed exact repository-owned or bounded manually supervised path required
by SC-OPS-002 and SC-OPS-004. Generic SQL or shell input remains forbidden.
