# StoreCalc Schema Fourth-Pass Review

Issues: #111, #109

Status: mandatory corrections found during the fourth independent design review.

This pass reviews the corrected model from the perspective of applicability, public contribution privacy, anonymous use, operational deployment, withdrawal, and disaster recovery. Executable SQL still must not begin until one consolidated implementation contract incorporates every accepted correction.

## 1. Separate catalog correctness from facility applicability

A template version can be completely accurate while still being the wrong catalog for a particular facility, population, or date.

The design therefore has at least two independently reviewable factual claims:

1. **Content claim:** this immutable template version correctly represents a catalog and its rules.
2. **Applicability claim:** this program/template/version applies to this facility and audience during this period.

Template confidence must never be reused as assignment confidence.

Facility pages should display both, for example:

```text
Catalog confidence: Community-confirmed
Facility applicability: Source-backed, effective July 2026
```

A disputed facility assignment does not automatically make the underlying statewide catalog incorrect. A disputed catalog does not erase historical evidence that it was assigned to a facility.

## 2. Add reviewable applicability records rather than one global current version

`program_facility_assignments` alone is not sufficient when a program contains multiple templates, audiences, or rollout schedules.

One acceptable normalized shape separates:

```text
program_facility_assignments
  id
  program_id
  facility_id
  audience_key
  valid_from
  valid_through
  assignment_state

assignment_template_applicability
  id
  assignment_id
  template_id
  version_id nullable when applicability follows a scoped publication
  publication_id nullable
  valid_from
  valid_through
  applicability_state
```

The final implementation may choose an equivalent shape, but it must satisfy these rules:

- one global template publication must not silently force every assigned facility to switch versions at the same instant;
- a facility may continue using an older version while another facility adopts the replacement;
- a facility may expose only a subset of a shared program's templates;
- audience or privilege context is explicit data, not inferred from template names;
- overlapping records that would produce two equally valid automatic choices for one facility/audience/time are rejected or surfaced as an unresolved ambiguity;
- when more than one legitimate program is available, the interface asks the user rather than guessing;
- completed orders snapshot the exact assignment and applicability/publication context used.

Source effective dates on a catalog version and facility applicability dates remain separate facts.

## 3. Facility applicability needs its own proposal and review lifecycle

Users must be able to report:

- the correct catalog is attached to the wrong facility;
- a facility stopped using a catalog;
- a new facility began using a shared program;
- the audience or privilege label is wrong;
- an effective date is wrong;
- a facility-specific fork is required;
- two applicability records conflict.

Applicability changes create evidence-backed proposals or events. They do not mutate history silently.

Required behavior:

- structured `Accurate` and `Needs correction` feedback can target applicability as well as template content;
- correction reasons identify facility, program/template, audience, affected dates, proposed replacement, and evidence;
- active applicability has confidence/dispute state independent from the catalog version;
- previous applicability periods remain available to historical orders;
- routine applicability corrections remain community-driven under the same evidence-over-popularity principle;
- severe manipulation or unresolved identity conflicts may escalate to the owner exception workflow.

## 4. Public contribution must not imply a user's incarceration or facility association

A public proposal, review, or correction tied to a named facility can reveal or strongly suggest where a user is incarcerated, where a family member is incarcerated, or another sensitive relationship.

Public attribution must therefore be separate from account identity.

One acceptable approach uses an internal contributor subject plus a bounded public display policy:

```text
contributor_subject
  id
  user_id private nullable
  public_attribution_mode
  public_handle nullable
  created_at
```

Requirements:

- review integrity, duplicate-position controls, abuse investigation, and scoped trust use the internal subject;
- public pages do not automatically link facility-specific contributions to the user's normal Phishtopia profile or username;
- public attribution may be a separate pseudonymous handle, generic community attribution, or another reviewed privacy-preserving mode;
- changing public display does not rewrite the underlying audit subject;
- contribution lists on ordinary profiles do not expose facility associations by default;
- aggregate displays use minimum thresholds where small counts could identify a contributor;
- current facility, followed facilities, orders, and private templates are never inferred or displayed from contribution activity;
- account deletion and retained public history follow the previously defined pseudonymous-subject policy.

The owner and abuse systems may resolve the internal account relationship only for a legitimate bounded purpose. Routine account-support screens should not expose private facility or order context.

## 5. Usage is demand evidence, not accuracy evidence

The architecture currently mentions successful repeated use as a possible confidence factor. Ordinary use of a catalog does not prove the catalog is correct. Users may use the only available version despite known errors.

Rules:

- page views, calculations, saved drafts, and completed orders may measure demand or prioritize maintenance;
- those events do not independently increase factual accuracy confidence;
- explicit post-use accuracy feedback may be a weak community signal, but it remains distinct from documentary evidence;
- a high-traffic inaccurate catalog must still become disputed or replaced;
- confidence explanations must not present usage volume as corroborating source count;
- private order contents and facility selections never enter public confidence calculations.

The consolidated architecture should remove or narrowly redefine `successful repeated use` as an accuracy factor.

## 6. Bind anonymous drafts to an exact version without silently substituting content

Anonymous calculations may be held in ephemeral browser state, but that state must include the exact public version identity and content hash.

When an anonymous user signs in and imports a draft:

1. the server loads the exact referenced version if still permitted;
2. verifies the content hash and bounded payload;
3. recalculates from authoritative server data;
4. reports whether that version is still current, disputed, stale, or withdrawn;
5. offers an explicit comparison/migration to a newer version when appropriate.

The service must not silently replace the version and present changed totals as the same draft.

Shared-device privacy requirements:

- anonymous state defaults to memory or session-scoped storage rather than indefinite local persistence;
- longer local persistence is explicit and clearly described;
- personal available funds receive the shortest practical retention and are easy to clear;
- provide a visible `Clear this order` action;
- never place facility, item, or funds data in URLs, analytics, crash reports, or browser notification text.

## 7. Define emergency withdrawal and safe fallback

A public version or applicability record may need urgent withdrawal because it is malicious, belongs to the wrong facility, exposes personal information, or contains dangerously incorrect rules.

The system needs a bounded emergency workflow that:

- immediately prevents new orders from starting from the withdrawn publication/applicability;
- preserves sealed content, evidence tombstones, reviews, audit history, and completed orders;
- records actor, reason, time, affected scope, and follow-up requirement;
- invalidates or sharply limits public cache lifetime for the affected current view;
- never silently falls back to an older version without displaying that fallback and its date/status;
- permits `no currently verified template` as an honest state;
- does not rewrite historical publication intervals.

Dispute is not the same as emergency withdrawal. A disputed version may remain visible with warnings; unsafe publication may be removed from ordinary use immediately.

## 8. Use expand-contract deployments and feature gates

The migration sequence spans multiple releases. Application code must not assume every future table exists after the first migration.

Required deployment model:

- additive schema migration first;
- exact schema verification and disposable rehearsal;
- application release compatible with both the prior and expanded schema where rollout overlap requires it;
- StoreCalc persistence routes disabled behind server-side feature gates until required migrations and verification complete;
- readiness or capability checks expose whether a feature is safely available without leaking schema details;
- rollback disables the feature or restores compatible application code without dropping live data;
- later cleanup/removal migrations occur only after all deployed code has stopped using the old shape;
- no route partially writes an aggregate when only some migration phases are present.

Feature gates are deployment controls, not authorization controls.

## 9. Back up database and object evidence as one recoverable system

Uploads, sanitized evidence artifacts, and database metadata may live in different storage systems. A PostgreSQL backup alone cannot restore StoreCalc evidence correctly.

Before upload/evidence launch, define:

- object checksums and immutable object identifiers;
- a backup-time object manifest tied to a database recovery point;
- reconciliation for missing database rows, missing objects, and orphaned objects;
- restore tests that verify public artifacts, private-object access rules, and withdrawn tombstones;
- retry-safe deletion and quarantine workflows;
- lifecycle rules preventing a database restore from accidentally republishing withdrawn or deleted artifacts;
- retention disclosure for user-deleted data that may remain in encrypted backups until scheduled expiry.

A restore must never turn a private raw upload into public evidence merely because an older database row referenced it differently.

## 10. Do not assume uploaded evidence may be republished

Supporting evidence can validate extracted facts without granting permission to publicly redistribute the original document.

Evidence publication needs an explicit policy/state distinguishing:

- private supporting upload;
- metadata/source citation only;
- sanitized excerpt or derived structured data;
- approved public artifact;
- withdrawn/takedown artifact.

The platform should prefer publishing structured facts, source metadata, and safe citations when redistribution rights or privacy are uncertain. Legal/ownership reports and takedowns preserve a bounded audit tombstone without continuing to serve disputed bytes.

## 11. Required fourth-pass tests

Before executable migrations and services are accepted, tests must prove:

- a correct shared catalog can have independent applicability states at two facilities;
- two ambiguous automatic applicability choices for one facility/audience/time are rejected or require explicit selection;
- one facility can remain on an older version without changing another facility's active version;
- a correction to applicability does not mutate template content or historical orders;
- public contribution pages do not expose the contributor's normal username or private facility selection by default;
- usage volume does not increase documentary source count or factual confidence;
- importing an anonymous draft never silently substitutes a new template version;
- an emergency withdrawal blocks new use while preserving historical orders and events;
- a partially deployed schema leaves gated StoreCalc routes safely unavailable rather than half-functional;
- a backup/restore rehearsal detects missing or mis-scoped evidence objects;
- private evidence cannot become a public artifact without an explicit publication state transition.

## Fourth-pass result

The corrected core is not merely:

```text
Facility <-> Program -> Template -> Version
```

It is:

```text
Facility + audience + time
  -> evidence-backed applicability
      -> scoped template publication/version
          -> anonymous calculation or sealed saved order
```

And public participation requires:

```text
Private account identity
  -> internal contributor subject
      -> privacy-preserving public attribution
```

No production database, runtime route, or executable migration is changed by this review.