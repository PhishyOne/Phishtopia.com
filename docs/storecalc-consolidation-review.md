# StoreCalc Consolidation Fresh Review

Issues: #111, #109

## Review result

The consolidated StoreCalc design is internally consistent and ready for
review as a design gate. No executable SQL, application behavior, deployment,
or production change is authorized by this result.

The sole normative implementation sources are now:

- `storecalc-implementation-contract.md`;
- `storecalc-traceability-matrix.md`.

All earlier architecture, roadmap, schema, addendum, and review-pass documents
are retained as historical rationale and carry a supersession notice.

## Review method

The fresh pass re-read the product architecture, roadmap, original schema
design, integrity addendum, hostile review, final clarifications, triple-check,
and fourth through twelfth review passes against the consolidated model. It did
not assume that copying a prior conclusion made that conclusion coherent with
the final whole.

The pass checked five dimensions:

1. domain lineage and nullability across facility, assignment, applicability,
   template, version, profile, resolved configuration, and order;
2. visibility, ownership, attribution, analytics, deletion, holds, and public
   non-enumeration;
3. immutability, state transitions, concurrency, idempotency, queued work, and
   non-resurrection;
4. calculation exactness, unknown states, composition, provenance, and
   unsupported capabilities;
5. owner powers, migration privilege, backup/restore, feature gates, and launch
   ordering.

Every normative heading was then compared mechanically with the traceability
matrix. The final set contains 118 unique contract IDs and 118 unique matrix
IDs, with no missing, duplicate, or unknown entry. Markdown structure,
historical notices, and whitespace were also checked.

## Findings corrected during the fresh pass

| Finding | Risk if left unresolved | Contract correction |
|---|---|---|
| Private settings and follows had behavior but no final relational shape | Cross-user selection or facility-transfer errors | Added SC-USR-001 and SC-USR-002 with private ownership, composite selection lineage, merge classification, and deletion coverage |
| Demand analytics was discussed only indirectly | Connection/location signals could become identity or confidence evidence | Added SC-PRV-003: opt-out, coarse first-party events, no raw IP/private context, deduplication, and a non-blocking country mismatch rule |
| Public attribution used an abstract scope pair | A pseudonym could be attached to the wrong facility/program/template | SC-PRV-002 now uses explicit scope foreign keys and a checked global/scoped null pattern |
| Scoped profiles lacked their complete publication and contribution lifecycle | A facility override could bypass evidence, version, review, or hash rules | Expanded SC-APP-006 and SC-APP-007 with immutable versions/deltas, evidence, publications, applicability components, proposals/reviews, exact dependencies, visibility intersection, and withdrawal behavior |
| Global template publication wording conflicted with facility-specific resolution | Updating one publication could appear to switch every facility | SC-CAT-009 now keeps one global publication history while applicability selects the exact facility/audience version independently |
| Translation, content-report, and hold targets were too polymorphic | Orphan or wrong-kind targets could pass application-only validation | SC-CAT-010, SC-REV-004, and SC-DEL-004 now require explicit nullable foreign keys and checked target patterns |
| Correction reports and editable comments lacked enough event detail | Corrections could rewrite history or redactions could retain unrestricted text | SC-REV-003 and SC-REV-004 now separate version/applicability aggregates, bind structured reasons and hashes, append state/comment audit events, and preserve only bounded hashes after redaction |
| Product and security notifications had no final data boundary | Optional preferences could suppress security mail, or address snapshots could leak through generic queues | Added SC-NOT-001 and SC-NOT-002 for private product notifications/preferences, outbox-time revalidation, and separately encrypted purpose-specific security recipients |
| Owner capabilities were described as a broad dashboard | An implementation could accidentally create a generic account/entity editor | SC-ROU-004 now enumerates account and StoreCalc exception actions, ties each to a domain service and feature gate, and forbids generic patches, password setting, impersonation, and arbitrary SQL |
| Fee output was present without a fee-rule domain | Zero could falsely mean that no fee applies | SC-CAL-002 and SC-DEF-001 remove fee authority from the initial core and require a later explicit capability |
| Numeric sign and quantity rules were implicit | Negative inputs or fractional selections could enter authoritative results | SC-DAT-002, SC-CAT-004, and SC-CAL-006 now define nonnegative monetary inputs, bounded integer quantities, and signed derived remaining/overage values |
| A confidence score could obscure one unsafe component | A high aggregate could produce a false ready label | SC-CAT-009 requires critical weak, disputed, withdrawn, or missing component states to remain visible and block readiness |
| Country coverage could become a selector dead end | Unsupported regions might be hidden or fabricated | SC-DIR-001 requires every reviewed country to show an honest support state plus a private provisional/request path |

## Adversarial outcome by boundary

### Lineage and deterministic resolution

No name, timestamp, row order, or independently valid set of IDs is enough to
select or join content. Composite keys and foreign keys prove each parent pair.
Assignment, applicability, base version, profile components, and dependencies
resolve deterministically for viewer, audience, and context date; ambiguity or
unsupported composition fails closed.

### Privacy and visibility

Anonymous calculation creates no server order. Private facilities, templates,
orders, uploads, settings, follows, notifications, and funds are viewer scoped.
Public attribution is unlinkable by default in sensitive facility scopes.
Counts, errors, caches, analytics, referrers, jobs, email previews, and exports
have explicit non-leakage rules.

### Historical truth and deletion

Sealed versions, completed order contents, publications, proposals, reviews,
applicability decisions, evidence relationships, and high-impact audit events
are immutable or append-only. Account deletion removes private state and direct
account links without collapsing distinct retained contributor histories.
Fixed-target bounded holds and restore-time deletion/withdrawal replay prevent
over-retention and resurrection.

### Calculation authority

One pure, versioned server core owns every authoritative calculation. Money is
exact integer minor units, quantities are bounded integers, unknown is never
zero/unlimited, overlapping buckets remain parallel, composition is explicit,
and unsupported tax/profile/constraint/fee capabilities cannot produce a false
ready result.

### Administration, asynchronous work, and operations

Every mutation has viewer/owner authorization, CSRF or an equivalent reviewed
origin control, bounded input, state validation, and scoped idempotency where
retries matter. Workers revalidate authority and generation at execution time.
Owner actions are named exceptions, not direct data editing. Migrations remain
repository-owned, checksum-bound, rehearsed against a restored backup,
feature-gated, and unavailable through generic SQL or shell input.

## Remaining gates, not unresolved design contradictions

- The first SQL slice must translate only its mapped requirements into exact
  migration definitions and database tests in a separate pull request.
- Strong owner-factor enrollment, backup, and recovery details need their own
  reviewed design before SC-GAT-005 can enable owner support routes.
- Uploads, public evidence, contribution, profiles, notifications, and official
  source import remain disabled until their respective gates pass.
- Deferred capabilities in SC-DEF-001 and SC-DEF-002 are absent, not partially
  implemented.
- No StoreCalc production migration may run until the bounded Ops execution
  path required by SC-OPS-004 is available and independently verified.

Within those explicit gates, the fresh pass found no remaining contradiction
in lineage, nullability, visibility, state, deletion, calculation authority, or
launch ordering.
