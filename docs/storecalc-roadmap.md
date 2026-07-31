# StoreCalc Online Roadmap

StoreCalc Online will begin as a simple commissary-order calculator and grow into a privacy-conscious, community-maintained platform for facility store catalogs, rules, orders, evidence, and updates.

This document records the product decisions and work discussed during initial planning. It is a roadmap, not a commitment to build every item at once.

## Immediate owner and account setup

- [ ] Delete the unusable `PhishyOne` site account after confirming the target record.
- [ ] Re-register a working `PhishyOne` account and verify its email.
- [ ] Add an explicit role or permission field to the user model through a versioned database migration.
- [ ] Assign the new `PhishyOne` account the private `owner`/`admin` role.
- [ ] Include the role in authenticated session data or load it securely from the database.
- [ ] Add a reusable server-side owner/admin route guard with tests.
- [ ] Never rely on a hidden navigation link as authorization.

## Prototype foundation

- [ ] Finish the browser-only prototype with a small hardcoded catalog.
- [ ] Support item quantities with plus/minus controls and prevent negative quantities.
- [ ] Calculate line totals, total spent, starting funds, and remaining funds.
- [ ] Represent money as integer cents rather than floating-point values.
- [ ] Treat quantities as source-of-truth state and derive totals from them.
- [ ] Move items into structured data objects as the prototype grows; classes are optional.
- [ ] Keep the current StoreCalc route/controller unchanged until the server actually supplies or saves data.

## Catalogs, rules, and calculations

- [ ] Support categories and user-added items/categories.
- [ ] Support configurable prices and price history.
- [ ] Support an optional overall spending limit, including no-limit templates.
- [ ] Support configurable per-item quantity limits.
- [ ] Support configurable taxes by template, category, and item.
- [ ] Support multiple spending buckets instead of assuming every item counts toward one limit.
- [ ] Allow category defaults with item-level overrides.
- [ ] Supported limit treatment should include:
  - Counts toward the main commissary limit
  - Excluded from the main limit
  - Uses a separate named limit/bucket
  - No limit
  - Blocked for the selected template or privilege level
- [ ] Calculate and display main-limit subtotal, exempt subtotal, separate-bucket subtotals, tax total, and final order total.
- [ ] Do not infer rules from item names such as phone minutes, electronics, or photo coupons; store applicability as data.

## Facilities and directory structure

Use stable internal IDs. Names, aliases, translations, governing authorities, and statuses may change without changing the facility ID.

Directory hierarchy:

`Country -> Jurisdiction -> Agency/System -> Physical region/state/territory -> Facility -> Store program/template`

- [ ] Seed and maintain canonical facility records rather than allowing uncontrolled public additions.
- [ ] Store official name, native-language name, aliases, abbreviations, former names, facility type, governing authority, physical location, and active/renamed/closed status.
- [ ] Track the official source, source URL, last checked date, last seen date, and detected changes.
- [ ] Begin with federal and state correctional systems in the United States.
- [ ] Add county/municipal jails, immigration detention, tribal, juvenile, military, and private-contract facilities in later layers.
- [ ] Keep the schema international-ready even while U.S. coverage is the initial focus.

## Missing facility requests

Users should request a public facility rather than directly adding records to the canonical directory.

- [ ] Search aliases, similar names, nearby facilities, and closed/renamed records before accepting a request.
- [ ] Collect country, jurisdiction, authority, facility name, physical location, type, supporting official link/document, and optional notes.
- [ ] Support statuses: Pending verification, More information needed, Approved, Merged with existing facility, Rejected, Closed or renamed.
- [ ] Let other users support an existing request rather than submit duplicates.
- [ ] Notify the requester when status changes.
- [ ] Allow an immediately usable private provisional facility while public verification is pending.
- [ ] Attach private work to the canonical facility automatically after approval or merging.
- [ ] Preserve templates, orders, comments, and history when duplicate facility records are merged.

## Countries and international expansion

- [ ] List every country in the selector from the beginning so unsupported countries are not dead ends.
- [ ] Give countries a support status such as Full directory, Limited directory, Community starting, or Requested.
- [ ] Allow private provisional facilities, templates, uploads, and orders in unsupported countries.
- [ ] Automatically record demand when users meaningfully use unsupported countries.
- [ ] Expand after the United States based on user demand, source availability, similar commissary systems, and manageable language support.
- [ ] Prioritize actual usage rather than manually attempting to populate every facility worldwide.

## User accounts and private profile/dashboard

- [ ] Build a user account/profile page.
- [ ] Show saved orders, personal templates, published contributions, followed facilities, current facility, notification preferences, language, and privacy/analytics settings.
- [ ] Allow users to select a private current facility and applicable store program.
- [ ] Allow users to follow additional facilities without claiming they are currently there.
- [ ] Allow users to change facilities after a transfer.
- [ ] Keep old orders attached to their original facility, template version, rules, and prices.
- [ ] Offer to follow the new facility and its applicable store template after a transfer.
- [ ] Keep current facility, followed facilities, transfer history, saved orders, and account details private by default.
- [ ] Display a clear privacy message beside facility selection explaining that other users cannot see the selection.
- [ ] Do not require inmate numbers, housing units, GPS, or proof of incarceration to use facility-based features.

## Templates and version history

Do not model a facility's store sheet as one mutable object. Public changes should create versions so old orders remain historically correct.

- [ ] Support multiple templates per facility, including general population, segregation, special privilege, medical, and other facility-defined programs.
- [ ] Support public community templates and private personal templates.
- [ ] Allow users to copy a public template into a private template.
- [ ] Save orders per user and support order sharing with privacy controls.
- [ ] Link each saved order to the exact template version and item prices used.
- [ ] Preserve old versions and archive rather than permanently deleting them.
- [ ] Support proposed corrections, comparisons, review, replacement, and rollback.
- [ ] Support public version statuses: Unverified, Source-backed, Community-confirmed, Disputed, Stale, and Archived.

## Store-sheet uploads and evidence

- [ ] Allow users to upload store sheets or other supporting documents.
- [ ] Extract proposed items, categories, prices, taxes, limits, and eligibility rules into a draft rather than publishing blindly.
- [ ] Let the uploader review and correct extracted information before submission.
- [ ] Track source date, upload date, facility, template type, and evidence confidence.
- [ ] Detect matching independent uploads and conflicting newer evidence.
- [ ] Scan or review uploads for personal information before public publication.
- [ ] Warn users not to upload names, inmate IDs, account numbers, or personal documents.

## Community accuracy feedback

- [ ] Use `Accurate` and `Needs correction` rather than generic like/dislike controls.
- [ ] Attach votes, comments, and reports to a specific template version.
- [ ] Give a new version fresh feedback while preserving discussion on archived versions.
- [ ] Require at least one structured reason after `Needs correction`.
- [ ] Permit multiple reasons, including:
  - Prices are outdated
  - Item is missing
  - Item should be removed
  - Item name/description is wrong
  - Category is wrong
  - Tax information is wrong
  - Overall spending limit is wrong
  - Item quantity limit is wrong
  - Limit exemption is wrong
  - Template type/privilege level is mislabeled
  - Sheet is incomplete or unreadable
  - Belongs to a different facility
  - Duplicate template
  - Other, with a write-in field
- [ ] Reveal contextual fields for the affected item, category, rule, correct value, explanation, evidence date, and optional newer document.
- [ ] Aggregate structured reports into useful summaries.
- [ ] Let repeated matching reports mark a version as possibly outdated or open a proposed correction.
- [ ] Keep `Needs correction` separate from abuse/content reporting for spam, harassment, malicious uploads, or exposed personal information.
- [ ] Treat votes as informative signals rather than proof or automatic authority.

## Notifications

- [ ] Notify uploaders when their version receives a detailed correction report, direct comment, newer evidence, or replacement proposal.
- [ ] Bundle routine accuracy confirmations instead of sending one notification per vote.
- [ ] Notify prior reporters when a new version addresses the problem they reported.
- [ ] Let users choose site notifications, email, both, or neither.
- [ ] Example summary: accurate confirmations, reported problems, and newest supporting document date.
- [ ] An uploader may confirm, dispute, explain, upload evidence, or create a revision, but does not permanently own public facts.

## Automated trust and conflict handling

Principle: trust the contribution and evidence, not a globally powerful person.

- [ ] Allow all users to create private templates, publish community templates, propose changes, and upload evidence.
- [ ] Calculate confidence from source recency, multiple independent matching uploads, community confirmation, successful repeated use, contribution history, and unresolved conflicts.
- [ ] Require stronger evidence for taxes, limits, and eligibility rules than for simple spelling corrections.
- [ ] Scope reputation to a facility, program/template, or contribution type rather than granting broad global power.
- [ ] Give new or coordinated accounts little weight in automated prioritization.
- [ ] When evidence conflicts, preserve both proposals, show the evidence, select the higher-confidence active version, and keep history.
- [ ] Use owner contact for technical support, abuse, security, legal/ownership issues, and severe unresolved manipulation—not routine catalog maintenance.

## Privacy-conscious analytics and demand scoring

- [ ] Use first-party analytics for product decisions rather than sending sensitive facility activity to advertising platforms.
- [ ] Derive only the approximate connection country needed for the event and discard the raw IP from the analytics event.
- [ ] Record whether selected country matched approximate connection country as a weak confidence signal, not proof.
- [ ] Track meaningful follow-through such as facility search, provisional facility creation, request submission, sheet upload, template creation, and completed order.
- [ ] Deduplicate repeated signals within a reasonable window to limit manipulation.
- [ ] Treat VPNs, mobile routing, family members, and transfers as normal reasons for mismatches.
- [ ] Never challenge a user because the selected country differs from the approximate connection country.
- [ ] Provide clear disclosure and an analytics opt-out.
- [ ] Do not include facility names, saved orders, comments, or current-facility settings in third-party advertising analytics.

## Language support

- [ ] Use translation keys rather than hardcoded interface text where practical.
- [ ] Support translated display names while preserving official and native-language names.
- [ ] Mark machine-translated rules and templates until confirmed by a fluent contributor.
- [ ] Keep user-generated comments and evidence in their original language while optionally offering translation.
- [ ] Add interface languages and document extraction support based on real demand.

## Owner dashboard

Build this after the core database model and user workflows are defined, using the same services and validation rather than direct arbitrary SQL.

- [ ] Create an owner-only dashboard page usable from a phone.
- [ ] User tools: search users, update approved fields, change facility selection when requested, disable/reactivate accounts, and review support requests.
- [ ] Facility tools: approve requests, merge duplicates, correct names/aliases, and archive closed facilities.
- [ ] Template tools: inspect evidence, corrections, comments, disputes, proposed versions, and history.
- [ ] Notification tools: failed imports, disputed sheets, security reports, abuse reports, and support messages.
- [ ] Record every administrative change in an audit log with actor, time, reason, old value, and new value.
- [ ] Add preview/confirmation and reversible actions where practical.
- [ ] Require reauthentication for destructive or ownership-changing operations.
- [ ] Never expose password hashes or allow viewing users' passwords.
- [ ] Do not include an arbitrary SQL console in the dashboard.
- [ ] Keep a private PostgreSQL GUI through an SSH tunnel only for exceptional repairs, preferably read-only by default.

## Database and backend foundation

- [ ] Design normalized tables for users/roles, facilities, aliases, authorities, templates, template versions, categories, items, prices, rules, spending buckets, orders, order items, uploads, evidence, feedback, comments, notifications, facility requests, follows, and audit events.
- [ ] Use database constraints and foreign keys to protect relationships.
- [ ] Use versioned migrations in Git.
- [ ] Test migrations locally or in a disposable database before production.
- [ ] Back up production before schema changes and verify afterward.
- [ ] Access production PostgreSQL locally on the VM or through a private SSH tunnel; do not expose port 5432 publicly.

## U.S. facility source maintenance

- [ ] Seed the broad directory from authoritative federal, state, and national statistical sources.
- [ ] Prefer current official agency directories as the active authority; use older national datasets as seeds and reconciliation sources.
- [ ] Build source-specific importers incrementally rather than one fragile universal scraper.
- [ ] Save dated source snapshots and checksums.
- [ ] Normalize downloaded records into staging tables.
- [ ] Compare staging data against canonical facility records.
- [ ] Create reviewable changes for additions, renames, closures, authority changes, and suspected duplicates.
- [ ] Never blindly overwrite the public directory.
- [ ] Do not mark a facility closed after one missing or failed source fetch; require repeated evidence or review.
- [ ] Archive closed/renamed records instead of deleting historical records.
- [ ] After the import system exists, add a restricted monthly systemd service and timer on the VM.
- [ ] Notify the owner only when meaningful directory changes or sync failures occur.
- [ ] Give the sync job minimal network/database permissions and useful failure logs; no general infrastructure privileges.

## Suggested delivery order

1. Browser-only calculator prototype.
2. Structured item/category state and calculation rules.
3. User account re-registration and owner/admin foundation.
4. Core database schema and migrations.
5. Normal user profile/dashboard and saved orders.
6. Facility directory and versioned templates.
7. Facility selection, following, and transfer behavior.
8. Private/public templates and template versioning.
9. Facility requests and provisional facilities.
10. Uploads, evidence, assisted extraction, and community feedback.
11. Notifications and scoped automated trust.
12. Owner dashboard and audit/revert workflows.
13. U.S. official-source importers and monthly update timer.
14. Analytics-based international expansion and additional languages.

## Product guardrails

- Privacy by default.
- Historical orders must never change because a current price or rule changed.
- Evidence outranks popularity.
- Public directory records are canonical and reviewable; private provisional records remain immediately useful.
- Routine community maintenance should not require the site owner to personally choose trusted people.
- No direct public database exposure, unrestricted SQL, or improvised administrative back doors.
- Build visible, useful increments rather than attempting the entire platform at once.
