---
date: 2026-06-01
phase: "Phase 4b.13: TipTap Depth-Guard Regression Test"
model: claude-opus-4-8
design_file: docs/plans/2026-06-01-tiptap-depth-guard-regression-test-design.md
plan_file: docs/plans/2026-06-01-tiptap-depth-guard-regression-test-plan.md
pushback:
  total: 4
  critical: 0
  important: 2
  minor: 2
alignment:
  total: 0
---

# Phase 4b.13: TipTap Depth-Guard Regression Test — Decision Log

> **Run note.** This /roadmap run began targeting Phase 4b.11 (404 Route-Response
> Helper). Context exploration found 4b.11 *and* 4b.12 (Validation Error Response
> Helper) already satisfied by the F-3 `AppError` taxonomy (commit `13028ae`,
> 2026-05-29) that landed after the dedup report (2026-04-28) which spawned them.
> Both were retired (marked Done + plan-markers + reconciliation notes) on a
> separate branch `retire-4b11-4b12-superseded-by-f3`, and the run advanced to the
> first genuinely-live phase, 4b.13. The findings below are for 4b.13.

## Pushback Findings

### [1] `canonicalJSON`'s boundary assertion was non-discriminating
- **Severity:** Important
- **Category:** Contradiction
- **Summary:** The design's `canonicalJSON` fixture (a single uniform mark on a text node, replaced via `replaceInDoc`) would cause the two replacement runs to merge whether or not the depth cap existed — `marksEqual` compares the same mark to itself. Removing `canonicalJSON`'s `if (depth > MAX) return "null"` line would still pass the test, making the assertion a no-op and defeating the phase's purpose for that walker.
- **Resolution:** fixed-in-design — replaced the fixture with two adjacent marks identical for levels 1–64 but divergent at level 65+; under the cap both truncate to `"null"` and merge (one node), without the cap they differ and do not merge (two nodes), giving a signal that flips when the cap is removed.

### [2] The pathologically-deep (~20k) overflow case was not cleanly realizable
- **Severity:** Important
- **Category:** Feasibility
- **Summary:** A draft addition proposed a ~20,000-level fixture to test true stack-overflow protection. Tracing it showed V8's `JSON.parse`/`JSON.stringify` overflow at roughly the same depth an uncapped walker would, so no clean window exists; worse, `canonicalContentHash` wraps `JSON.parse` + `canonicalize` in one bare `catch`, so on very deep input `JSON.parse` overflows first → caught → `reason:"parse"` fallback, and canonicalize's cap never runs and the function never throws — the capped/uncapped difference is invisible for that walker.
- **Resolution:** fixed-in-design — dropped the deep case; nest modestly past the cap (depth 100, safe for JSON ops). The depth-65/100 cap-activation assertions already catch the real regression (deletion of a walker's `if (depth > MAX)` line).

### [3] `collectLeafBlocks` short-circuits on leaf-block node types
- **Severity:** Minor
- **Category:** Feasibility
- **Summary:** `collectLeafBlocks` returns `[node]` as soon as it hits a node in `LEAF_BLOCKS = {paragraph, heading, codeBlock}`, *before* recursing. A fixture that nests using paragraphs would return the first shallow paragraph and never reach the depth cap, so the bail would never be exercised.
- **Resolution:** fixed-in-design — the `deepDoc` fixture nests via a container (non-leaf) node type (`blockquote`), with the matchable paragraph only at the deepest level; documented as an explicit fixture constraint (exact container verified in the RED phase).

### [4] "Depth 65" means different things per walker
- **Severity:** Minor
- **Category:** Ambiguity
- **Summary:** The walkers count depth differently — tree walkers add 1 per content level, `canonicalize` adds depth on both object and array levels (~2× per visual level), and `canonicalJSON` counts mark-attribute nesting rather than the doc tree. A single "depth-65 doc" does not sit exactly at every walker's boundary.
- **Resolution:** fixed-in-design — made explicit that each walker's fixture depth is chosen for that walker's own counter, that a shared visual depth need only be ≥ every tree walker's boundary (it still activates all caps), and that exact depths are re-verified per walker in the RED phase.

## Alignment Findings

Alignment raised no issues. Every design requirement traced to a plan task (six walker tasks + scaffold + final verification), every task mapped back to a requirement (no scope creep), the plan implements the design faithfully, and the tasks are already in red/green form (an inverted cap-break dance supplies the "red" for a regression test on existing correct code), so the TDD-rewrite step was skipped. One trivial code-consistency polish was applied to the plan during the review (logger-spy mock `() => {}` to match the existing `content-hash.test.ts` pattern) — not an alignment-category finding.

## Summary

- Pushback raised 4 issues; all 4 resulted in design changes (`fixed-in-design`). Two Important findings materially strengthened the test: one would have made `canonicalJSON`'s assertion a no-op, the other would have added an infeasible/murky deep-overflow fixture. Two Minor findings corrected fixture construction (`collectLeafBlocks` container nesting) and per-walker depth-counting ambiguity.
- Alignment raised 0 issues; the plan was already well-aligned and TDD-formatted. One trivial non-finding polish applied.
