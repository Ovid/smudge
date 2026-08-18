---
date: 2026-07-19
phase: "Phase 4c.2: Scratchpad / Outtakes"
model: claude-opus-4-8
design_file: docs/plans/2026-07-19-scratchpad-outtakes-design.md
plan_file: docs/plans/2026-07-19-scratchpad-outtakes-plan.md
pushback:
  total: 6
  critical: 0
  important: 2
  minor: 4
alignment:
  total: 5
  critical: 0
  important: 2
  minor: 3
---

# Phase 4c.2: Scratchpad / Outtakes — Decision Log

Both pushback and alignment were run in isolated, fresh-context subagents (per
the `/roadmap` skill), so neither was anchored by this session's brainstorming
rationale.

## Pushback Findings

### 1 Roadmap 4c.2 spec still describes the old design

- **Severity:** Important
- **Category:** Contradiction
- **Summary:** The roadmap's 4c.2 detail still specified `deleted_at`, a
  soft-delete `DELETE` endpoint, and listed outtakes among image-bearing content,
  all three of which the design reverses. The design's §11 only planned CLAUDE.md
  edits, leaving the roadmap describing a feature the code would not build.
- **Resolution:** fixed-in-design — added roadmap reconciliation to §11 and edited
  the roadmap's 4c.2 bullets (struck `deleted_at`/`word_count`, hard-deleted the
  DELETE bullet, qualified the image line) in commit `5da4c9b`.

### 2 Hard-delete posture is inherited by 4c.2a where the outtake is the sole copy

- **Severity:** Important
- **Category:** Omission (forward-risk)
- **Summary:** The "an outtake is its own recovery mechanism" rationale holds only
  for v1's non-destructive capture (the original still lives in the chapter).
  After 4c.2a's destructive cut the outtake becomes the only copy, so committing
  no-`deleted_at` now pre-decides 4c.2a's safety posture.
- **Resolution:** fixed-in-design — user chose to keep hard-delete for v1 (Option
  A) and a forcing note was added to §2/§3 requiring 4c.2a's design to re-evaluate
  delete-safety before enabling the destructive cut; the later `ADD COLUMN` is a
  trivial nullable migration.

### 3 Plain-text extraction for Copy + filter was unspecified

- **Severity:** Minor
- **Category:** Omission
- **Summary:** Copy and the filter both need TipTap-JSON → plain text, but the
  only such walker (`wordcount.ts` `extractText`) is private.
- **Resolution:** fixed-in-design — specified a shared, exported, tested
  `toPlainText(doc)` with defined newline inter-block separation, used by both.

### 4 "Insert into editor" inserted a whole `doc` node with undefined edges

- **Severity:** Minor
- **Category:** Feasibility / Ambiguity
- **Summary:** Inserting a `{type:"doc"}` node mid-paragraph is ill-defined and
  the edge cases (inline cursor, active selection, empty doc) were unspecified.
- **Resolution:** fixed-in-design — insert the block array `content.content`; edge
  behavior specified and tested (§8, §10).

### 5 Persisted `word_count` column was redundant

- **Severity:** Minor
- **Category:** Scope (over-engineering)
- **Summary:** The list returns full `content` and the client ships `countWords()`,
  so a stored per-outtake count, its server compute step, and its migration cost
  buy nothing.
- **Resolution:** fixed-in-design — dropped the column; the count is computed
  client-side from loaded content.

### 6 List endpoint returns full content with no bound

- **Severity:** Minor
- **Category:** Scope / Omission
- **Summary:** The list returns full content per row ("dozens × up to 5 MB") with
  no cap or pagination.
- **Resolution:** accepted-as-is — recorded the single-user "dozens × short"
  assumption and a content-elided list as the future escape hatch (§5), matching
  Smudge's other single-user trade-offs.

## Alignment Findings

### 1 No REFACTOR step in any task

- **Severity:** Important
- **Category:** tdd-format
- **Summary:** Every code task was RED → GREEN → commit with no explicit REFACTOR
  phase, the phase most reliably skipped unless written down.
- **Resolution:** fixed-in-plan — added a mandatory standing REFACTOR step to the
  conventions block plus concrete refactor targets on A2 and B5; noted the
  type-only/doc tasks as the accepted TDD exemptions.

### 2 Capture → panel-refresh wiring left as a TODO across three tasks

- **Severity:** Important
- **Category:** design-gap
- **Summary:** F2/D2/E1 each deferred the "new capture appears in the panel"
  mechanism to the others, leaving the one cross-component coupling unspecified
  even though the e2e asserts it.
- **Resolution:** fixed-in-plan — specified a single mechanism across F2/D2/E1,
  with an end-to-end test. **Amended during implementation (review 2026-07-26,
  S13):** the specified `refreshNonce` reload was substituted for an optimistic
  prepend (`capturedOuttake: OuttakeRow | null`), because a nonce-triggered
  reload could be staled by a concurrent card delete/rename and silently drop
  the capture. Still a single mechanism, which is what this finding asked for.

### 3 "New outtake" textarea → TipTap-doc wrapping unspecified

- **Severity:** Minor
- **Category:** design-gap
- **Summary:** A `<textarea>` yields a string, but `CreateOuttakeSchema.content`
  requires a valid doc; the string→doc adaptation was missing, so the create call
  would fail validation as written.
- **Resolution:** fixed-in-plan — added a `textToDoc` wrap-lines-into-paragraphs
  step and a test asserting the POSTed body is a valid doc.

### 4 Find-and-replace exclusion test from §9 was dropped

- **Severity:** Minor
- **Category:** missing-coverage
- **Summary:** The design promised a test that replace-all does not touch outtake
  rows, but Task B7 implemented only two of the five exclusion tests.
- **Resolution:** fixed-in-plan — restored the find-and-replace exclusion test in
  B7 (create outtake with a marker, run replace-all, assert the row is untouched).

### 5 `toPlainText` forks a second walker vs. the design's "consolidate" wording

- **Severity:** Minor
- **Category:** design-gap
- **Summary:** Design §5 said to consolidate the private `extractText`, but the
  plan forks a new walker because the separation semantics differ (space vs.
  newline) and touching `extractText` risks the client/server word-count
  agreement invariant.
- **Resolution:** fixed-in-design — kept the fork and reconciled §5 to record it as
  a deliberate deviation protecting the word-count invariant.

## Summary

- Pushback raised 6 issues (0 critical / 2 important / 4 minor); 5 resulted in
  design changes (including the roadmap reconciliation and the 4c.2a
  delete-safety forcing note) and 1 was accepted as-is (the single-user unbounded
  list). No dismissals — every finding was valid.
- Alignment raised 5 issues (0 critical / 2 important / 3 minor); 4 resulted in
  plan changes (REFACTOR steps, the capture-refresh mechanism, the textarea→doc
  wrap, the restored find-and-replace exclusion test) and 1 in a design wording
  change (the deliberate `toPlainText` fork). No dismissals.
- Net: the design and plan are now internally consistent, scope-clean (the
  destructive cut is correctly fenced into 4c.2a), and the roadmap no longer
  describes a feature the code will not build.

---

## One-Feature-Rule Exception (recorded 2026-08-04)

**Decision: granted.** Phase 4c.2 lands with sixteen out-of-scope clusters
bundled alongside the Outtakes drawer, and a tenth site on cluster OOSA2.

> **Amended 2026-08-04 (round 6).** The entry originally said ten. Round 6
> (`scratchpad-outtakes-2026-08-04-10-00-22-ef6a65a1.md`) found four more that
> the ten-cluster list did not name — recorded below as OOSA11–OOSA14 — and two
> file attributions in the original list that credit a file to a cluster it does
> not participate in. Both are corrected here. The decision on the four is
> **keep**, on the same ground the seven defect-fixing clusters were kept: they
> fix defects that are now understood, and reverting them means knowingly
> re-shipping bugs. Read §The argument against granting it before citing this —
> it applies with more force to a list that has now grown twice.

> **Amended 2026-08-04 (round 7).** Fourteen clusters became sixteen. Round 7
> (`scratchpad-outtakes-2026-08-04-11-44-09-8d0b5f7.md`) found two additions
> that landed _after_ the round-6 amendment closed the list — recorded below as
> OOSA15 and OOSA16 — and the review response added a third, OOSA17, on an
> explicit decision by the maintainer. The decision on all three is **keep**, on
> the same ground as before. Note what the growth pattern itself says: the list
> has now been reopened at every round that looked for it, twice _after_ being
> declared final. §The argument against granting it is the part of this record
> that predicted that, and it should be read as the live half of the decision,
> not the archived dissent.

This reverses design §12, which stated "No exception to the one-feature rule is
needed." That was true when written and stopped being true as the branch grew.
CLAUDE.md §Pull Request Scope requires the exception to be explicit and recorded
in this log rather than inferred from the diff, so it is recorded here — with
the argument against it, because a decision log that only records the winning
side is not a record.

Raised as **[I3]** by `paad/code-reviews/scratchpad-outtakes-2026-08-04-08-13-06-4138b47.md`.

### What is carried, and why

Seven clusters fix real defects the feature work surfaced. Reverting them means
knowingly re-shipping bugs that are now understood:

- **OOSA4** — body-parser's 415 escaped the unclamped global error handler on
  _every_ body-accepting endpoint, mislabelled `VALIDATION_ERROR` and mapped by
  no client scope. Also amends the CLAUDE.md §API Design contract.
- **OOSA5** — `validateUuidParam` rollout; malformed ids 404'd instead of 400'ing.
  **Client-observable contract change** on `GET/PATCH/DELETE /api/chapters/:id`
  and `POST /api/chapters/:id/restore`.
- **OOSA6** — a reachable `MAX_TIPTAP_DEPTH` bypass via nested `content: [[…]]`
  through `PATCH /api/chapters/:id`, and a note-mark leak through array children.
- **OOSA7** — cross-project image bytes embedded into exports; DOCX honouring an
  unanchored src match, so `https://evil.example/api/images/<uuid>` embedded
  local bytes into a file handed to a beta reader.
- **OOSA8** — the upload cap's user-facing figure could drift from the constant.
- **OOSA9** — grapheme-vs-code-unit truncation, auto-snapshot extraction.
- **OOSA10** — nine independent cleanups.

Five clusters are load-bearing for the feature and cannot be split mechanically:

- **OOSA6** — `toPlainText` IS a 4c.2 walker; the `isTipTapNode` consolidation
  exists because outtakes added the seventh hand-written copy of the predicate.
- **OOSA9** — `truncateUnits` / `LABEL_MAX_UNITS` are what `OuttakeCard`'s
  preview and `buildOuttakeLabel` are built on.
- **OOSA1** — `OuttakesPanel` lives inside the `ReferencePanel` frame the
  `ResizeSeparator` extraction touched.
- **OOSA2** — the capture handler needs the stale-project guard.
- **OOSA3** — `e2e/outtakes.spec.ts` needs the shared project fixture.

### Added by the round-6 amendment

Four clusters the ten-cluster list did not name. All four fix defects; none is
a feature. Each is carried on the same ground as the seven above.

- **OOSA11** — two new server parity test files (`wire-type-parity.test.ts`,
  `schema-parity.test.ts`, commit `f3b88834`). Test-only, no production change.
  `chapters.status` has neither a CHECK constraint nor an FK to
  `chapter_statuses`, so nothing but these assertions holds the enum and
  migration 003's seed rows together. Half of `schema-parity.test.ts` is
  feature-motivated rather than out of scope at all: migration 015 adds outtakes
  as a **third** `project_id`-bearing child table, and the project-purge path
  had no assertion covering it.
- **OOSA12** — the `ResizeSeparator` drag-lifecycle fix (backlog `c9fce6ab`,
  commit `0e3ffc95`). A behaviour change to pointer resizing in both the Sidebar
  and the ReferencePanel: a drag self-terminates when no button is held, and a
  second mousedown reclaims the previous drag's document listeners. **This is
  distinct from cluster OOSA1 above**, which covers the _extraction_
  (`c7bba0ab`) and whose source report states that the extraction gives
  `c9fce6ab` a single owner _without_ fixing it. Carried because the bug is
  real — a mouseup delivered outside the document (release over an iframe, a
  native menu, off-window) leaves the panel following the bare pointer and
  writing to localStorage on every mousemove, and an orphaned listener resizes
  the panel for the rest of the session. Giving it a single owner was what made
  the one-place fix possible.
- **OOSA13** — the snapshot **view** corruption gate tightened to
  `TipTapDocSchema` (`useSnapshotState.ts`). The one item here that changes what
  a user sees for **existing data**: snapshot rows that previously opened in the
  read-only viewer now report "this snapshot is corrupt". Carried because view
  disagreeing with restore is the defect; approved here for the first time, the
  attribution correction below being why.
- **OOSA14** — lock-refusal copy on three pre-existing editor-mutation entry
  points (`useSnapshotController.ts`, `useFindReplaceController.ts` ×2) changed
  from `STRINGS.editor.mutationBusy` to `STRINGS.editor.lockedRefusal`. Reached
  from this branch because `guardInsertAtCursor` needed the same string. Carried
  because the old copy told the user to wait for an operation that does not
  exist and never ends.

### Added by the round-7 amendment

Two entries that landed after the round-6 amendment declared the list closed,
and one added by the review response to that round. OOSA15 and OOSA17 are new
clusters; OOSA16 is a tenth site on the existing cluster OOSA2.

- **OOSA15** — the loading gate in `ImageGallery.tsx` and `SnapshotPanel.tsx`
  (commit `8d0b5f74`, branch tip). Both panels stop rendering their "nothing
  here" empty state for the duration of every load, so a project with a full
  gallery is no longer told it has none and invited to re-upload what it
  already has. Neither component participates in the Outtakes drawer; the
  change is the `OuttakesPanel` S6 fix extended sideways to its two siblings.
  The branch's own commit `d25a8dc4` names both files as out of scope verbatim
  and defers the widening to the maintainer, and it widened before the answer
  arrived. Carried because the defect is real and now tested — and because
  round 7's highest-severity finding (I1) was a regression _inside_ this
  addition: `ImageGallery` gated one ternary arm too high, blanking the whole
  thumbnail grid on every post-mutation refresh. That fix and its regression
  test are part of this cluster. Reverting the cluster now would take the fix
  with it, since they are the same code.
- **OOSA16** — `handleUpdateProjectTitle`'s possibly-committed recovery arm in
  `useChapterMetadata.ts` upgraded from the id-only check to the full
  `isStaleProject()` guard (commit `4cecc06d`). Round 6 classified this as
  Out-of-Scope Important (backlog `dc808129`) and it was fixed on-branch
  anyway. A runtime behaviour change on project rename, a path with no
  relationship to outtakes. **This is the tenth site of cluster OOSA2, not a
  tenth cluster of its own** — see the correction below. Carried because it is
  the one surviving arm that writes back to `projectSlugRef`, the ref every
  later request reads.
- **OOSA17** — two backlog fixes taken on an explicit maintainer decision
  during the round-7 review response: `image-resolver.ts` resolving export
  image ids case-insensitively (backlog `e730ae37`), and the two
  find-and-replace parse sites recording a wrong-shape chapter in
  `skipped_chapter_ids` instead of reporting the project fully searched
  (backlog `0364ab66`). Both were logged as out of scope by round 7 and
  approved for this branch rather than a follow-up. Both entries removed from
  `paad/code-reviews/backlog.md`.

### Added by the round-8 amendment

One addition round 7 already had on the branch and did not name, plus the
out-of-scope backlog fixes taken during the round-8 review response.

- **OOSA18** — the same-timestamp tie-break rewritten `id DESC` → `rowid DESC`
  in `snapshots.repository.ts:54` and `:80` (commit `9e64c57b`). Round 7's S8
  was an in-scope finding against the _outtakes_ list ordering; the fix commit
  changed that site **and** extended the identical rewrite into the two
  chapter-snapshot dedup lookups — a different table and a different feature
  that outtakes never touch. The commit message states the widening openly, but
  `de286c34` ("record the three out-of-scope entries round 7 found") landed
  after it and still did not name it. Same shape as OOSA15.

  It is a runtime behaviour change: when two snapshots for a chapter share a
  millisecond `created_at`, the row a new snapshot's content hash is compared
  against moves from arbitrary UUID order to last-inserted, deciding whether the
  writer's manual marker is accepted or refused as a duplicate. **Kept on an
  explicit maintainer decision (2026-08-11).** The lookup's own comment already
  said the tie-break existed to keep dedup deterministic; `id DESC` over v4
  UUIDs did not achieve that, so this completes a stated invariant rather than
  adding behaviour. Covered by `snapshots.repository.test.ts` (+38).

- **OOSA19** — three out-of-scope backlog fixes taken during the round-8 review
  response, per the standing rule that a valid defect is fixed regardless of
  scope: `validateTipTapDepth` rejecting a primitive child of a nested
  `content[]` (backlog `e66fe50c`), `deleteImage` / `scanImageReferences`
  treating an unreadable chapter as a blocking reference rather than a
  non-reference (backlog `89368329`), and `handleCreateChapter`'s
  create-recovery merge arm upgraded to the full `isStaleProject()` guard
  (backlog `ddfa2117` — an **eleventh site of cluster OOSA2**, not a cluster of
  its own). All three entries removed from `paad/code-reviews/backlog.md`.

### Attribution corrections

The original cluster list credited two files to clusters they do not
participate in, and one cluster's site count has since gone stale. Verified at
HEAD:

- Cluster **OOSA2** ("`makeStaleProjectGuard` extraction and strength upgrade at
  nine sites") is now **eleven sites** — ten as recorded below, plus
  `useChapterCrud.ts`'s create-recovery merge arm (OOSA19). `useChapterMetadata.ts`'s project-rename
  recovery arm joined it as OOSA16 above, after the cluster description was
  written. The recorded count was factually wrong about its own scope from
  commit `4cecc06d` until this amendment.
- The same cluster lists `useSnapshotState.ts`. That file imports
  `makeStaleProjectGuard` **zero** times. Its actual change on this branch is
  OOSA13 above.
- The same cluster lists `useFindReplaceController.ts`, which also imports it
  **zero** times. Its actual change is OOSA14 above.

This matters beyond bookkeeping: a reader auditing what was approved for those
two files would have found a refactor granted and a behaviour change shipped.

### The argument against granting it

Recorded because it is strong and was not dismissed.

This is the rationalization the rule was written to defeat. By the time anyone
asks, every bundled branch feels load-bearing and already-reviewed. The
"already reviewed five times" defence is partly circular — the branch needed
five rounds _because_ it is bundled, which is the failure mode the rule names
(`ovid/snapshots-find-and-replace`: 17,000 insertions, 16 rounds). Two clusters
in particular deserved their own scrutiny: **OOSA4** amends a steering-file
contract governing the whole server, and **OOSA5** changes a client-observable
contract on autosave-adjacent endpoints — and a prior review round on this very
branch already labelled OOSA5 out-of-scope, after which it was applied anyway.

The alternative considered and declined was splitting OOSA4 and OOSA5 into their
own PRs. Declined because neither is a clean cherry-pick (OOSA5's extraction
must stay for the outtakes routes, so only the chapter rollout moves — a
partial-commit split), and both would reset to zero review while delaying 4c.2.

### Precedent scope — read this before citing it

This exception is granted on the specific finding that the out-of-scope work is
**overwhelmingly bug fixes and feature prerequisites, not additional features**.
The one-feature rule remains at its default of enforcement. This entry is NOT
precedent for bundling a second _feature_, and it is not precedent for
discovering an exception after the fact as a matter of routine — the next branch
that grows this way should split while splitting is still cheap.

**Round-6 addendum.** The list has now grown twice: ten at the original
recording, fourteen after the amendment above. That is the failure mode this
section names, observed on the very branch that names it. The four additions
were kept because each fixes an understood defect and reverting means
re-shipping bugs — but "we found four more and kept them" is the argument
against the exception getting stronger, not the exception getting broader. A
list that grows after being recorded is the signal to split, and the next branch
should treat a second round of discovered out-of-scope work as the trigger,
not the third.

---

## 2026-08-18 — Blank-outtake compose form removed (scope narrowing)

**Decision:** the "New outtake" control and its textarea are removed. The
Outtakes drawer now has exactly one producer — the toolbar's "Send selection to
outtakes" — and one consumer, the card's "Insert into editor".

**Why it went.** It was never argued for. The roadmap sketch (`docs/roadmap.md`
§4c.2) lists four bullets and the capture one reads "A writer can move text from
the editor to outtakes (cut selection -> paste to outtakes) and vice versa";
there is no manual-create bullet. The design doc mentions manual create exactly
once, as a parenthetical inside the §2 scope list, while every other choice in
that document earns a numbered entry in §3 "Design Decisions (with rationale)" —
manual create is not among the four. It entered as an unexamined default: the
CRUD surface had a POST endpoint, so the panel got a create button. Everything
downstream of that treats it as settled and argues only about mechanism (this
log's item 3 is about wrapping a textarea string into a TipTap doc, not about
whether the textarea should exist).

It also contradicted a decision that *was* argued: §3 decision 3, "the panel is
not an editor" — content is deliberately not re-editable in the panel, so a
compose form let a writer create prose they then could not revise in place.

**What was deleted.** The form JSX, `handleCreate`, `textToDoc`, the panel's
`draft`/`onDraftChange` props, EditorPage's lifted `outtakeDraft` state, its two
entries in the `editorEntryPointSurface` snapshot, and six strings. Roughly 200
lines of it were safety code added by three review rounds (I6's draft lifting,
I3's un-abortable POST, the `createdElsewhere`/`createFailedElsewhere`
project-drift banners). **If blank-create is ever rebuilt, it comes back naive** —
read the I2/I3/I6/S2/S3 notes in commit `f94bd1a2`..`HEAD` before doing so,
because each closed a real data-loss path.

**What survives and why.** `POST /api/projects/{id}/outtakes` stays — the
toolbar capture is its caller. No server, schema, or migration change.

**No "there is no compose form" test was added.** See the note below; the
absence is held by the deleted code and this record, not by an assertion.

### Tests that assert an absence — when they earn their place

A negative assertion is worth keeping when a **live mechanism could still
produce the forbidden state**, so the test can fail for some reason other than
someone deliberately re-adding the feature. Smudge's good examples: the DOCX
note-leak test (a new export walker can leak notes), the outtake
word-count/export/search exclusion tests (a future "iterate all project content"
change can sweep them in), the `deleted_at IS NULL` filters.

It is **not** worth keeping when nothing can produce the state — when the only
way to turn it red is a deliberate re-implementation, whose author deletes the
test in the same commit. Such a test carries no signal and actively misleads: a
reader assumes a guarded hazard exists where none does.

For a deletion, asserting-the-absence is legitimate **scaffolding** — it proves
in the RED step that the code actually went, rather than that a file was edited
— and is removed in REFACTOR once the code is gone. Where re-addition is
plausible by accident, the tool is a forcing pause
(`editorEntryPointSurface.test.ts`, `editorExtensions.test.ts`), which
interrupts rather than forbids. Where it is plausible on purpose, the tool is a
record like this one, because only a document can carry the *why*.

**Pre-existing instance, fixed 2026-08-18 (commit `71bba74a`):**
`packages/server/src/__tests__/chapters.test.ts` — "ignores target_word_count
(column removed)" PATCHed `{ title }` without ever sending
`target_word_count`, then asserted the response lacked it. It could not fail
except by someone re-adding the column, and its name claimed an input-handling
behaviour it did not exercise. Replaced by two cases covering what was actually
untested: `UpdateChapterSchema` is `.partial()` without `.strict()`, so Zod
strips unknown keys — an unknown-only body therefore 400s (rather than
reporting a no-op success), and a mixed body still applies its known field.

The replacement carries the check the original lacked: **each case was verified
to fail under the change it guards** (`.passthrough()` breaks the first,
`.strict()` the second). That verification is worth doing whenever a test's
subject is an absence — it is the difference between a guard and a tombstone,
and it is cheap. It also caught two assertions in the first draft that survived
the `.passthrough()` run, i.e. that had reproduced the original defect; they
were dropped.

The `migration-004.test.ts` schema-shape assertions are a different case and
fine: migrations are cumulative and re-run on every new migration, so a live
mechanism can genuinely re-add a column.
