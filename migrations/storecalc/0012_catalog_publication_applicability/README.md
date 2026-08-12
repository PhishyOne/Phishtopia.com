# StoreCalc migration 0012: catalog publication and applicability

This package adds the first closed database bridge between a sealed catalog and
the facility/audience context that may eventually use it. It implements the
bounded publication-history subset of SC-CAT-009 and the base applicability
relationship in SC-APP-003. It creates no rows and advances the unavailable
`anonymous.calculation` marker from schema version 8 to 9.

## Two separate claims

`storecalc.template_publications` records when one exact sealed version is
globally published for its template. `storecalc.assignment_template_applicability`
records the separate claim that either one exact sealed version or one exact
publication row applies to one program/facility assignment and template during
an effective-date interval. Publishing a replacement therefore does not
silently switch every facility.

Composite foreign keys bind publication to version/template and applicability
to assignment/program/facility/template. The selection mode enforces exactly
one exact-version or publication target. Insert triggers recheck sealed state,
active parent state, assignment containment, and non-overlap while the topology
is locked.

## Time and immutable history

Publication uses a non-overlapping `[started_at, ended_at)` system-time
interval. Applicability keeps its independent inclusive valid-date interval and
an additional system-time closure. Only currently unclosed applicability rows
must be non-overlapping for one assignment/template key, allowing a later
correction to preserve rather than rewrite the closed claim it replaces.

Rows start open at lifecycle generation 1. Their identities, lineage, selected
version/publication, actor, reason, and effective interval never change. The
only update is one attributable, non-backdated close that increments the
generation exactly once. Closed rows and all rows on delete are immutable.

## Lock order and concurrency

Every assignment, publication, or applicability mutation acquires the same
global administrative topology locks in this order:

1. `template_versions`;
2. `program_facility_assignments`;
3. `template_publications`;
4. `assignment_template_applicability`.

The existing sealing service already starts with `template_versions`. A new
statement trigger makes assignment mutations enter the cross-topology order
before their inherited assignment-only lock. Concurrent current switches then
serialize, and the unique/current and overlap checks remain final defenses.

## Access, rollback, and deferrals

`PUBLIC`, the web role, and the worker role receive no table, sequence, or
trigger-function privileges. The backup role receives read-only access. The
anonymous capability remains unavailable and unverified, so no route or
resolver can consume these records.

Rollback first verifies the exact complete schema. It is allowed only when both
new tables are empty and neither identity sequence has ever been used. It then
removes only this slice, restores the closed 0011 capability marker, and
re-verifies that exact baseline. Any data, sequence use, drift, or later
dependency fails before mutation.

Publication/applicability transition services, state/review/evidence events,
the deterministic resolver, scoped profiles, calculation integration, real
catalog or assignment rows, runtime grants, routes/UI, production migration,
deployment, activation, and Ops work remain explicitly deferred.

This migration is not authorized for production execution. SC-OPS-002
rehearsal and an independently reviewed SC-OPS-004 execution path are still
required.
