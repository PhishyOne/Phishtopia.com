# StoreCalc Eighth-Pass Product-Surface Review

Issues: #111, #109

Status: mandatory accessibility, mobile-resilience, attribution, localization, and output corrections found during the eighth independent design review.

These requirements are not all database columns, but they affect route contracts, state handling, privacy, message keys, snapshots, and release acceptance. They belong in the consolidated implementation contract before the page shell and calculation workflows are built.

## 1. Accessibility is a release requirement

StoreCalc contains long catalogs, quantity controls, rule warnings, comparison diffs, evidence, and administrative forms. These surfaces must remain usable without relying on color, fine motor precision, or a particular visual layout.

Requirements:

- semantic headings, landmarks, labels, lists, tables, buttons, and form controls;
- full keyboard navigation and visible focus;
- screen-reader announcements for quantity changes, recalculated totals, errors, warnings, and successful saves without excessive repetition;
- minimum practical touch targets and spacing for phone use;
- status/confidence/validation information conveyed through text and structure, never color alone;
- quantity controls with accessible direct numeric input in addition to plus/minus buttons;
- error summaries linked to affected fields;
- comparison views with a linear/readable alternative to side-by-side visual diffs;
- evidence images/documents with meaningful descriptions or extracted structured alternatives where available;
- reduced-motion behavior for nonessential animation;
- contrast and zoom/reflow testing;
- no inaccessible custom control where a native HTML control is sufficient.

Automated checks help but do not replace keyboard and screen-reader testing of the core order and review workflows.

## 2. Design for unreliable mobile connections

A phone-first product must assume interrupted LTE, duplicate taps, app suspension, and pages restored from stale state.

Requirements:

- small deterministic paginated payloads;
- progressive rendering of large catalogs rather than one enormous response;
- idempotency keys and optimistic revisions on retried mutations;
- clear pending/saved/failed states;
- no success message before the server transaction commits;
- retry actions that do not duplicate orders, reviews, requests, uploads, or evidence links;
- resumable or safely restartable uploads where supported, with checksum verification;
- local draft recovery that follows the previously defined shared-device privacy rules;
- an explicit stale-version message when a resumed page references replaced content;
- no dependency on a long-lived open request while the user reviews or edits a large proposal;
- printable/downloadable output generated from a sealed server result, not an unfinished client preview.

## 3. Public attribution must support unlinkability across sensitive scopes

A separate public handle is safer than the normal account username, but reusing one public pseudonym across several named facilities can still reveal a sensitive pattern.

Public attribution modes should support at least:

- generic community attribution;
- scope-specific pseudonym, such as separate public identity per facility/program or another reviewed boundary;
- deliberately reusable public handle only after the user understands the linking effect;
- no public author display where policy permits while retaining internal contributor-subject integrity.

Requirements:

- generic or unlinkable attribution is the privacy-preserving default for facility-specific activity;
- changing attribution does not alter internal review/audit identity;
- public pages do not expose a cross-facility contribution graph unless the user deliberately chooses reusable attribution;
- URLs, HTML metadata, feeds, notifications, and APIs do not leak the internal contributor subject;
- moderators can still detect duplicate positions and abuse internally;
- public attribution settings receive clear previews and apply consistently to requests, reviews, evidence, comments, directory changes, and applicability proposals.

## 4. Separate translations from canonical factual content

Global support requires translated interface and display text without allowing translation changes to rewrite catalog facts.

Use versioned translation records or an equivalent model for:

- item and category display text;
- facility/program/template descriptions;
- warning and validation message keys;
- evidence summaries where permitted;
- structured rule explanations.

Requirements:

- canonical identities, prices, quantities, rules, dates, hashes, and source text remain unchanged by translation;
- each translation records language tag, source content/version, translation method, contributor/system actor, state, and review status;
- machine-translated text is visibly identified until confirmed where accuracy matters;
- stale translations are detected when source text changes;
- user comments remain stored in their original language, with optional derived translation kept separately;
- a translation cannot make an unsupported or disputed rule appear confirmed;
- bidirectional and Unicode-safety controls from the prior review apply.

## 5. Seal output provenance for print, download, and sharing

Users may print, save, screenshot, or later share an order. Output must explain what it represents.

A generated order document or export should include bounded provenance such as:

- generation time;
- facility/program display snapshots;
- exact template/resolved-configuration version identifiers or human-friendly version label;
- source/effective date;
- validation and warning summary;
- currency and totals;
- statement that StoreCalc does not guarantee live stock or facility acceptance;
- a non-secret integrity/reference value when useful.

Privacy rules:

- personal available funds are omitted from public/share output by default;
- account email, username, internal user ID, current-facility setting, and contributor subject are omitted unless explicitly needed and chosen;
- exports never contain raw tokens, private evidence keys, internal audit notes, or hidden analytics fields;
- a share/export is generated from a sealed server snapshot and cannot change when current catalog data changes;
- revocable web shares and permanent downloaded files are treated as different privacy models.

## 6. Search and selection must disambiguate safely

Facility and template search can return similar or identical names.

Requirements:

- show enough public context to distinguish results, such as jurisdiction, agency, locality, status, former-name indicator, and program audience;
- do not expose private provisional records in another user's search results or counts;
- aliases and fuzzy matches are labeled rather than presented as exact official names;
- closed, renamed, and merged records direct the user to current canonical context without hiding history;
- automatic selection never chooses among ambiguous facilities/templates solely from name similarity;
- search-result ordering is deterministic and does not imply confidence or official endorsement without explanation.

## 7. Required eighth-pass acceptance tests

Before the page shell and public workflows are accepted, tests must include:

- keyboard-only completion of facility selection, item entry, validation review, and save;
- screen-reader checks for recalculation and error summaries;
- no status conveyed through color alone;
- duplicate mobile retries creating only one intended mutation;
- interrupted/resumed drafts detecting stale versions safely;
- public attribution in one facility not automatically linking the same account's activity at another facility;
- a source-text update marking dependent translations stale without changing canonical facts;
- printed/downloaded output reproducing the sealed order and omitting private funds by default;
- ambiguous facility names requiring clear user selection;
- private records remaining absent from public search counts and pagination metadata.

## Eighth-pass result

The product must be trustworthy not only in storage but in use:

```text
Correct data
  + accessible interaction
  + resilient mobile state
  + unlinkable public attribution
  + versioned translation
  + sealed output provenance
```

No production database, runtime route, or executable migration is changed by this review.