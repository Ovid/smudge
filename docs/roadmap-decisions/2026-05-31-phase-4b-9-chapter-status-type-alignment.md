---
date: 2026-05-31
phase: "Phase 4b.9: Chapter Status Type Alignment"
model: claude-opus-4-8
design_file: docs/plans/2026-05-31-chapter-status-type-alignment-design.md
plan_file: docs/plans/2026-05-31-chapter-status-type-alignment-plan.md
pushback:
  total: 6
  critical: 2
  important: 2
  minor: 2
alignment:
  total: 5
  critical: 1
  important: 3
  minor: 1
---

# Phase 4b.9: Chapter Status Type Alignment — Decision Log

Both the pushback (on the design) and the alignment (on the plan) reviews were
run by **independent subagents** given only the document paths and the repo —
none of the orchestrating session's context — at the user's request, so their
critiques could not be anchored to the author's reasoning. Both earned their
keep: the central feasibility claim ("almost entirely mechanical, no bulk
rewrite") was wrong, and the corrected blast radius is materially larger than
the first draft represented.

## Pushback Findings

### [1] "No bulk rewrite" contradicted; the optimistic-revert path will not compile
- **Severity:** Critical
- **Category:** Feasibility
- **Summary:** The design claimed fallout was confined to off-enum literals and `status: string`-typed helpers. But `useChapterMetadata.ts`'s revert spreads `{ ...c, status: previousStatus }` where `previousStatus` comes from `confirmedStatusRef` (typed `Record<string, string | undefined>` in `useProjectEditor.ts` and twice in `useProjectEditor.types.ts`), and `seedConfirmedStatus(id, status: string)` stores into it. Tightening `Chapter.status` makes the spread a TS2322. None of those files were in the change list.
- **Resolution:** fixed-in-design — added `useProjectEditor.ts` + `useProjectEditor.types.ts` (ref + seeder retyped to `ChapterStatusValue | undefined` / `ChapterStatusValue`) to the change list.

### [2] DashboardView builds `ChapterStatusRow` from `Object.entries` — guaranteed string→union error
- **Severity:** Critical
- **Category:** Omission
- **Summary:** `DashboardView.tsx`'s fetch-failed fallback builds `effectiveStatuses: ChapterStatusRow[]` from `Object.entries(status_summary)`, whose keys are always `string`. Once `ChapterStatusRow.status` is the union this is a TS2322. The file was in the design's boundary map but not its change list.
- **Resolution:** fixed-in-design — added an explicit `status: status as ChapterStatusValue` cast at the derive-from-keys boundary.

### [3] Tightening the dashboard read type orphans defensive branches / Partial indexing unaudited
- **Severity:** Important
- **Category:** Feasibility
- **Summary:** Tightening the dashboard inline type and `status_summary` to a `Partial<Record<…>>` left several `?? null` / `?? "#999"` / `?? 0` defensive branches in `DashboardView` unaudited; some go statically dead under a closed union, and the `Partial` indexing semantics (`number | undefined`) needed confirming.
- **Resolution:** fixed-in-design — added an audit note (leave the harmless dead branches, same rationale as the Sidebar `|| "outline"` note) and confirmed `?? 0` stays live and type-clean under `Partial<Record<…>>`.

### [4] Test fixture uses an invalid `"drafting"` literal — directly contradicts "fixtures are fine"
- **Severity:** Important
- **Category:** Contradiction
- **Summary:** The design asserted bare status literals in fixtures are all fine, but `useTrashManager.test.ts` passes `status: "drafting"` — never a valid status — which the tightening (correctly) rejects.
- **Resolution:** fixed-in-design — corrected the "Expected Test Churn" section to require a grep for off-enum literals and to fix the typo to a valid status; flagged as a latent-bug fix the phase surfaces.

### [5] RED→GREEN relies on `@ts-expect-error` semantics under tsc, not vitest
- **Severity:** Minor
- **Category:** Feasibility
- **Summary:** The RED state for the closed-field assertion appears only under `tsc -b`, not under `npm test` (Vitest does not run tsc). The Definition-of-Done was ambiguous about which command demonstrates RED.
- **Resolution:** fixed-in-design — pinned `npm run typecheck` (`tsc -b`) as the RED gate explicitly; carried into every typecheck step of the plan.

### [6] Deliberate client/server type asymmetry asserted safe but not pinned
- **Severity:** Minor
- **Category:** Ambiguity
- **Summary:** The server keeps `status_summary: Record<string, number>` while the client narrows it; the design called this acceptable but nothing records the intent at the inline re-declaration.
- **Resolution:** fixed-in-design — added a code-comment requirement at the client inline type noting the asymmetry is deliberate and that the shared `ChapterStatus` enum is the contract both sides track.

## Alignment Findings

### [1] `useProjectEditor.test.ts` uses off-enum `"drafting"` in typechecked positions
- **Severity:** Critical
- **Category:** missing-coverage
- **Summary:** The plan named `useTrashManager.test.ts` as the only off-enum literal, but `useProjectEditor.test.ts` uses `"drafting"` in `handleStatusChange(..., "drafting")` calls and a `mockResolvedValueOnce({ …, status: "drafting" })` — all typechecked (client tsconfig includes `.test.ts`), all TS2322 under the tightening. The plan's grep could not catch the positional call-arg literals.
- **Resolution:** fixed-in-plan — added the file to Task 2 with a `"drafting"` → `"edited"` sweep across inputs, mock resolves, assertions, and comments.

### [2] `useTrashManager.test.ts` assertion at line 340 left referencing `"drafting"`
- **Severity:** Important
- **Category:** missing-coverage
- **Summary:** The plan changed only the fixture (line 313); the matching `toHaveBeenCalledWith("ch-restored", "drafting")` assertion (line 340) would then fail at runtime, contradicting the plan's "tests green" step.
- **Resolution:** fixed-in-plan — Step 8 now changes both lines to `"rough_draft"`.

### [3] Grep promoted to a completeness gate it cannot fulfill
- **Severity:** Important
- **Category:** design-gap
- **Summary:** The plan's Step 9 grep (`status: "…"`) was framed as "expected no output = sweep done," but it structurally misses positional call arguments — exactly where the biggest fallout lived (finding [1]). The design's own stance was to trust `tsc -b`.
- **Resolution:** fixed-in-plan — demoted the grep to a non-authoritative hint and made a clean `npm run typecheck` the sole completeness gate.

### [4] Grep false-positives include intentional invalid inputs that must not change
- **Severity:** Minor
- **Category:** missing-coverage
- **Summary:** The sweep also surfaces deliberately-invalid status literals in negative/validation tests (`schemas.test.ts` `"published"`, `chapters.test.ts` `"invalid_status"`) plus unrelated `status` discriminants and server-row literals. Blindly "fixing" these would delete negative tests or touch out-of-scope server types.
- **Resolution:** fixed-in-plan — added an explicit DO-NOT-TOUCH list to Step 9 distinguishing typed chapter-status literals from untyped negative-test inputs and unrelated `status` fields.

### [5] `useTrashManager.ts` seeder callback prop left as `status: string`
- **Severity:** Important
- **Category:** missing-coverage
- **Summary:** Presented by the subagent as Minor; upgraded to Important during discussion. `seedConfirmedStatus?: (id, status: string) => void` is a property arrow type, so under `strictFunctionTypes` its param is contravariant — wiring `useProjectEditor`'s now-`ChapterStatusValue` seeder into it is very likely a TS2322 at the wiring site, not a style nit. It also contradicts the CLAUDE.md invariant this same PR adds.
- **Resolution:** fixed-in-plan — added the prop retyping to `ChapterStatusValue` to Task 2, with the contravariance rationale recorded.

## Summary

- Pushback raised 6 issues; all 6 resulted in design changes (`fixed-in-design`). Two were Critical compile-breaks in production code (`useChapterMetadata`/`useProjectEditor` revert refs; `DashboardView` fallback) that the change list had omitted; the rest corrected an over-optimistic churn estimate, an unaudited dashboard surface, the RED-gate command, and an unpinned intentional asymmetry.
- Alignment raised 5 issues; all 5 resulted in plan changes (`fixed-in-plan`). The cluster shared one root cause — undercounting the test files carrying off-enum `"drafting"`/`"draft"` literals and over-trusting a grep that cannot see positional call arguments. One finding (`useTrashManager.ts` seeder prop) was reconciled upward from Minor to Important during discussion on the strength of the `strictFunctionTypes` contravariance analysis.
