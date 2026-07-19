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
- **Resolution:** fixed-in-plan — specified a single mechanism (a `refreshNonce`
  lifted to `EditorPage`, passed to `OuttakesPanel`, re-triggering its abortable
  load) across F2/D2/E1, with an end-to-end test.

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
