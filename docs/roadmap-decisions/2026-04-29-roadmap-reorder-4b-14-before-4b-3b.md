---
date: 2026-04-29
phase: "Roadmap edit: reorder 4b.14 (now 4b.3a.1) before 4b.3b"
kind: roadmap-edit
model: claude-opus-4-7
commit: bf4f08b
followup_commit: pending (this commit)
pushback:
  total: 8
  critical: 0
  important: 2
  minor: 6
alignment:
  total: pending
severity_note: |
  The /roadmap decision-log schema uses Critical/Important/Minor; the
  paad:pushback skill uses Critical/Serious/Moderate/Minor. This run
  produced 0 Critical, 2 Important (= pushback "Important"), 3 Moderate,
  and 3 Minor findings. For schema conformance, Moderate is folded into
  Minor (3 + 3 = 6); the body of this entry preserves the four-tier
  labels for fidelity. INDEX.md uses the schema-conformant counts.
---

# Roadmap reorder — 4b.3a.1 (originally 4b.14) before 4b.3b — Decision Log

**Schema note.** This is a non-standard decision-log entry: a /roadmap
brainstorming run on 2026-04-28 was aborted before producing a design
or plan, in favour of editing the roadmap to reorder a future phase.
The standard schema (`design_file`, `plan_file`) does not apply here —
the artifacts under review are the roadmap edit commits themselves.
The `kind: roadmap-edit` frontmatter field flags this. If similar
"roadmap reorder without phase brainstorming" runs recur, a follow-up
edit to the /roadmap skill should formalize this kind.

## Context

The /roadmap brainstorming pass on 2026-04-28 picked up Phase 4b.3b
(AbortSignal Threading Completion) as the next unplanned phase. During
brainstorming, two questions surfaced:

1. *Is the problem real?* (Asked by the user.) Most of the seven
   scope items in 4b.3b are not user-visible bugs today — existing
   `cancelled` flags and `token.isStale()` checks already prevent
   stale setState. The strongest argument for the phase is bytes-on-
   wire cleanup plus a downstream dependency from Phase 4b.3c [S10]'s
   `signal.aborted` gate.

2. *Are we creating duplicated code that's hard to keep in sync?*
   (Also asked by the user.) Yes — the recently-merged
   experimental-dedup pass (`paad/duplicate-code-reports/ovid-experimental-
   dedup-2026-04-28-08-13-33-4129d99.md` finding I3) explicitly examined
   the eight client AbortController sites that 4b.3b would touch and
   classified them as deferred pending per-site evaluation *after* the
   new `useAbortableAsyncOperation` hook (Phase 4b.14) lands. The
   dedup author also explicitly classified [I6] as a false positive
   with respect to dedup-set membership (Editor.tsx does not currently
   use an AbortController). Doing 4b.3b first would have added seven
   new hand-rolled instances of exactly the pattern 4b.14 was created
   to consolidate.

The brainstorming session was aborted in favour of resequencing the
roadmap. Commit `bf4f08b` made the initial reorder edits. This
follow-up commit applies the pushback review's resolutions.

## Pushback Findings

### [F1] /roadmap scan-order contract is implicit; reorder relies on it
- **Severity:** Important
- **Category:** ambiguity / contradiction
- **Summary:** The /roadmap skill text says "Scan phases in order
  (Phase 1, 2, 3, … 7)," wording that suggests numeric order. The
  actual implementation is document order. The reorder deliberately
  diverged the two by moving Phase 4b.14's section before 4b.3b while
  preserving the number 4b.14. If a future contributor reads the
  skill text literally and "fixes" it to parse phase numbers, the
  reorder breaks silently.
- **Resolution:** `fixed-in-design` — chose A: renumber `4b.14` →
  `4b.3a.1` so its number sorts between `4b.3a` and `4b.3b` under any
  parser, AND added a §Phase Numbering and Order subsection to
  roadmap.md formalizing the document-order = execution-order contract
  with phase numbers as stable identifiers. Separately flagged: the
  /roadmap skill text at `.claude/skills/roadmap/SKILL.md` should be
  updated to match (its current wording leaks the old confusion).

### [F2] [S10] reordering note speculates wrongly about hook's `aborted` getter
- **Severity:** Important
- **Category:** feasibility / contradiction
- **Summary:** The added [S10] note claimed the gate "may be
  re-expressible via the hook's internal `aborted` getter." But
  `useAbortableAsyncOperation`'s suggested API has both a per-call
  `signal` (returned from `run()`) and a component-scoped
  `get aborted(): boolean`. The [S10] gate is per-call (gates a
  console.warn on a specific recovery-catch); using the
  component-scoped `aborted` would over-suppress the warn — firing
  silent for catches whose own operation hadn't aborted. The note
  invited a future contributor to use the wrong abort source.
- **Resolution:** `fixed-in-design` — chose A: rewrote the [S10] note
  to point explicitly at `run(...).signal.aborted` (per-call) and to
  warn against using the component-scoped `aborted` getter, with
  rationale.

### [F3] Cross-confirmed-site count inconsistent across artifacts (5 vs 4)
- **Severity:** Moderate
- **Category:** ambiguity / contradiction
- **Summary:** The dedup report I3 header says "4 cross-confirmed
  sites (~7 refs)," its body lists five migration points
  (`useTrashManager.openTrash`, `useTrashManager.handleRestore`,
  `useFindReplaceState.search`, `ImageGallery.handleFileSelect`,
  `ImageGallery.handleSave`), and the actual code in those three
  files contains 11 AbortController allocations of which 5 are
  in-scope per the body. The Phase Structure row I wrote in the
  initial reorder said "~7 refs across 3 files" — none of these
  reconcile.
- **Resolution:** `fixed-in-design` — chose A: corrected counts
  everywhere in the 4b.3a.1 section (Goal, Scope, Definition of Done)
  and the Phase Structure table row to "5 in-scope migration
  points" (or wording that resolves to 5), and added a reconciliation
  note in §Goal explicitly explaining the dedup report's "4 sites"
  framing (ImageGallery's two operations grouped into one site).

### [F4] [I6] removal text conflated dedup-set membership with need-for-fix
- **Severity:** Moderate
- **Category:** ambiguity / omission
- **Summary:** The original reorder's [I6] removal said "the dedup
  author's per-site evaluation" justified dropping it. Strictly: the
  dedup author evaluated *whether the site is currently a member of
  the AbortController dedup set* (correct: it isn't). They did not
  evaluate *whether adding one is needed*. The original code review's
  [I6] cited two underlying impacts — bytes-on-wire on
  unmount/switch, and announcement on a torn-down editor — neither
  of which the dedup author addressed. The original removal text
  was silent on what was being dropped vs. what was covered
  elsewhere. (Verified during pushback: [S18] in Phase 4b.3c at
  `roadmap.md:849` covers the announcement bug via instance capture,
  the more direct fix the original review itself suggested.)
- **Resolution:** `fixed-in-design` — chose A: rewrote the [I6]
  removal text to enumerate both underlying concerns, label the
  dedup author's finding as set-membership-only, name the deployment-
  shape grounds for deferring bytes-on-wire (single-user, localhost,
  negligible bandwidth), and cross-reference [S18] in 4b.3c for the
  announcement concern.

### [F5] 4b.3a.1 PR shape underspecified
- **Severity:** Moderate
- **Category:** ambiguity
- **Summary:** The 4b.3a.1 section commits to "do not bundle all
  four into one PR" but doesn't say whether the hook ships in its
  own PR or with the first migration, whether grouped migrations are
  allowed (e.g., ImageGallery's two ops in one PR), or how
  decision-log entries map to phases that split.
- **Resolution:** `fixed-in-design` — chose C: added a §PR Shape
  subsection acknowledging the split shape is decided at brainstorming
  time, with the "each migration is independently shippable" floor
  preserved but allowing the brainstormer to group migrations that
  share file/test-setup. Avoided preempting evaluation that hasn't
  happened yet.

### [F6] No decision-log entry for the reorder
- **Severity:** Minor
- **Category:** omission
- **Summary:** The /roadmap workflow's Step 10 promises a decision-log
  entry per run; the aborted brainstorming left a gap. Information
  exists in commit messages and in-section notes but not in the
  durable index that supports year-of-entries skim.
- **Resolution:** `fixed-in-design` — chose A: this entry. Schema
  adapted via `kind: roadmap-edit` and `commit:`/`followup_commit:`
  frontmatter fields in place of `design_file`/`plan_file`. Index row
  prepended.

### [F7] "Duplication 4b.14 was meant to remove" is technically loose wording
- **Severity:** Minor
- **Category:** ambiguity
- **Summary:** Strictly, 4b.3a.1 (formerly 4b.14) consolidates a
  pattern by extracting it into a single hook; "remove duplication"
  is loose phrasing for "consolidate footprint." Intent is clear from
  context.
- **Resolution:** `accepted-as-is` — chose B: leave the wording
  as-is; the imprecision is harmless and rewriting is busywork.

### [F8] §Out of Scope "Re-introducing [I6]" clause overlapped with [F4]'s rewrite
- **Severity:** Minor
- **Category:** ambiguity
- **Summary:** Once [F4]'s rewrite makes §Scope precise about the
  bytes-on-wire deferral conditions and the [S18] cross-reference,
  the §Out of Scope "Re-introducing [I6] without new evidence" line
  becomes a redundant normative restatement.
- **Resolution:** `fixed-in-design` — chose C: dropped the §Out of
  Scope clause; the §Scope text after [F4] does the work.

## Alignment Findings

(Pending — to be appended after the paad:alignment run.)

## Summary

- Pushback raised 8 issues; 7 resulted in roadmap edits, 1 was
  accepted as-is.
- 0 Critical, 2 Important, 3 Moderate, 3 Minor.
- Both Important findings ([F1] scan-order contract; [F2] [S10] gate
  speculation) had concrete underlying problems that would have
  surfaced as bugs at implementation time. Pushback was load-bearing.
- One follow-up identified for outside this roadmap commit: update
  `/roadmap` skill text at `.claude/skills/roadmap/SKILL.md` so its
  "Phase 1, 2, 3, … 7" wording matches the document-order contract
  documented in §Phase Numbering and Order.

## Files changed (cumulative across bf4f08b + this commit)

- `docs/roadmap.md` — section moved, renumbered, edited; new
  subsection §Phase Numbering and Order.
- `docs/roadmap-decisions/2026-04-29-roadmap-reorder-4b-14-before-4b-3b.md`
  — this entry (new file).
- `docs/roadmap-decisions/INDEX.md` — row prepended.
