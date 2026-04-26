# Agentic Code Review: ovid/miscellaneous-fixes

**Date:** 2026-04-26 13:20:41
**Branch:** ovid/miscellaneous-fixes -> main
**Commit:** a47b775597769b47362d9a69d4d5899b2a890e48
**Files changed:** 6 | **Lines changed:** +194 / -5
**Diff size category:** Small

## Executive Summary

Branch implements Cluster A (PR 2) of the Phase 4b.3a review-followups plan: scope-coverage gaps for I1 (chapter.reorder REORDER_MISMATCH), I2 (chapter.save NETWORK + 404), S1 (trash.restoreChapter 404), plus an unplanned but necessary I4-style fix routing post-retry-exhaustion errors in `useProjectEditor.handleSave` through `mapApiError`. Intent is sound and well-tested for the happy path; verification confirms two real UX regressions and two contract gaps that should be patched before merge: (F2) the Ctrl+S handler in `EditorPage.tsx:1601` bypasses `mapApiError` and now shows generic copy on every save failure, and (F3) the new chapter.save 404 mapping sets a "no longer exists" banner without locking the editor, leaving the user free to keep typing into a deleted chapter and triggering an infinite 404 loop. No critical issues; six lower-impact suggestions.

## Critical Issues

None found.

## Important Issues

### [I1] Ctrl+S save handler bypasses mapApiError, regresses copy after string rename
- **File:** `packages/client/src/pages/EditorPage.tsx:1599-1602`
- **Bug:** The Ctrl+S `flushSave` catch handler calls `setActionError(STRINGS.editor.saveFailed)` directly. The new branch renames `STRINGS.editor.saveFailed` from "Unable to save — check connection" to the generic "Save failed. Try again." Every Ctrl+S failure (including the common network drop) now shows the generic copy, while the parallel auto-save path now correctly differentiates NETWORK via `mapApiError`.
- **Impact:** Violates CLAUDE.md's "all user-visible API error messages route through `mapApiError`" invariant. Worse, it actively regresses UX for the most common keyboard-save failure mode, contradicting the entire point of the I2 fix.
- **Suggested fix:** Route through the same pattern used at `useProjectEditor.ts:459`: `setActionError(mapApiError(err, "chapter.save").message ?? STRINGS.editor.saveFailed)`.
- **Confidence:** High
- **Found by:** Contract & Integration

### [I2] 404 NOT_FOUND chapter.save sets banner but does NOT lock the editor
- **File:** `packages/client/src/hooks/useProjectEditor.ts:469-477`
- **Bug:** The `onRequestEditorLockRef.current?.(...)` invocation is gated on `rejected4xx.code` ∈ {BAD_JSON, UPDATE_READ_FAILURE, CORRUPT_CONTENT}. The new chapter.save `byStatus[404]` mapping carries code `"NOT_FOUND"`, which is not in that list. So when a chapter is purged between auto-saves, the user sees the "This chapter no longer exists" banner but the editor stays writable. The next debounced auto-save deterministically 404s, blinks the banner again, and so on until the user reloads.
- **Impact:** CLAUDE.md save-pipeline invariant #2 ("setEditable(false) around any mutation that can fail mid-typing") is arguably violated. The new e2e test at `e2e/editor-save.spec.ts:73-110` only asserts the banner text — it never types again after the 404 — so it passes despite this gap.
- **Suggested fix:** Add `"NOT_FOUND"` to the lock-trigger list at lines 471-473, or (cleaner) introduce a scope-level `terminalCodes` marker analogous to `committedCodes` so the lock decision is data-driven from the scope registry.
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases

### [I3] Bare 5xx retry exhaustion copy regressed from network-flavored to fully generic
- **File:** `packages/client/src/hooks/useProjectEditor.ts:445-461`
- **Bug:** Pre-branch, retry exhaustion of any non-4xx error showed the literal `STRINGS.editor.saveFailed = "Unable to save — check connection"`. Post-branch, the path now routes through `mapApiError`:
  - NETWORK exhaustion → `saveFailedNetwork` ("Unable to save — check your connection.") — intended
  - Bare 500 INTERNAL_ERROR exhaustion → `saveFailed` fallback, which is now "Save failed. Try again."
  - Non-ApiRequestError exhaustion → same generic copy
  After 4 attempts spanning ~14 seconds, telling the user "Save failed. Try again." is misleading — the action they just took has already been retried four times.
- **Impact:** UX regression for the bare-5xx case. No test pins the new copy, so a future developer doesn't know whether the change was intentional.
- **Suggested fix:** Add a `byStatus: { 500: ... }` entry on chapter.save (e.g. a new `STRINGS.editor.saveFailedServer = "Unable to save — the server is having trouble. Try again in a moment."`) and add a regression test mirroring the NETWORK exhaustion test but with `ApiRequestError("boom", 500, "INTERNAL_ERROR")`.
- **Confidence:** Medium
- **Found by:** Error Handling & Edge Cases

### [I4] PROJECT_PURGED test fixture pins HTTP 409, but server emits 404 — contract drift
- **File:** `packages/client/src/errors/apiErrorMapper.test.ts:442-445`
- **Bug:** The test constructs `new ApiRequestError("gone", 409, "PROJECT_PURGED")`, but `packages/server/src/chapters/chapters.routes.ts:97-104` emits `PROJECT_PURGED` at HTTP **404**. The test still passes (byCode resolves before byStatus), but it no longer pins what the real server emits. With the new `byStatus[404] → restoreChapterAlreadyPurged` mapping in place, if `byCode["PROJECT_PURGED"]` is ever removed or renamed, real 404+PROJECT_PURGED traffic would silently route to `restoreChapterAlreadyPurged` instead of the project-purged copy — and this test, using status 409, would NOT catch the regression.
- **Impact:** Loss of contract pinning. Combined with the new byStatus addition in the same scope, the safety net is weaker than before.
- **Suggested fix:** Change `409` to `404`. Add a precedence-pin mirror of the existing CHAPTER_PURGED test at lines 469-474.
- **Confidence:** High
- **Found by:** Contract & Integration, Error Handling & Edge Cases (independent reports)

## Suggestions

- **[S1]** `useProjectEditor.ts:454-457` comment claims `lastErr === null` can occur if "the loop exited via the seq check" — that path returns immediately and never reaches the post-loop block. Defense-in-depth ternary at lines 458-460 is fine to keep; rationale text needs correction. *(Concurrency)*
- **[S2]** Missing test combining NETWORK retry exhaustion with chapter switch landing during the 8s backoff. Sibling round-trip tests cover only the 4xx case. Defensive guard against a future refactor moving `mapApiError(lastErr, ...)` outside the `!token.isStale()` gate. *(Concurrency)*
- **[S3]** `apiErrorMapper.test.ts:464-468` comment frames the 404+CHAPTER_PURGED combo as hypothetical ("even though both ... resolve to the same string today"), but server actually emits CHAPTER_PURGED at 404 (`chapters.routes.ts:107-113`). The test is real-traffic, not contrived. Reword the comment. *(Contract & Integration)*
- **[S4]** `apiErrorMapper.test.ts:469-474` precedence-pin asserts `STRINGS.error.restoreChapterAlreadyPurged`, which both byCode and byStatus currently map to. The assertion does not actually distinguish which path resolved; the line-473 sanity check only verifies byCode is non-empty. A stronger pin would use a contrived scope where byCode and byStatus map to different strings. *(Error Handling & Edge Cases)*
- **[S5]** `useProjectEditor.test.ts:203-236` does not install a `console.warn` spy. NETWORK retries do not currently log, so the test is silent today, but a future warn addition would slip past the zero-warnings invariant. Add `vi.spyOn(console, "warn").mockImplementation(() => {})` and assert no calls. *(Error Handling & Edge Cases)*
- **[S6]** `useProjectEditor.ts:458-461` always computes `fallbackMessage` even when `rejected4xx` is set (and the value is then discarded). Negligible cost; clearer as `rejected4xx?.message ?? mapApiError(lastErr, "chapter.save").message ?? STRINGS.editor.saveFailed`. *(Error Handling & Edge Cases)*

## Plan Alignment

- **Implemented:**
  - Cluster A items I1 (chapter.reorder REORDER_MISMATCH), I2 (chapter.save NETWORK + 404 + e2e), S1 (trash.restoreChapter 404)
  - Strings additions per plan: `reorderMismatch`, `saveFailedChapterGone`, `saveFailedNetwork`; `saveFailed` reword
  - Bonus precedence-pin tests beyond plan minimum (positive deviation)
- **Not yet implemented (correctly deferred to later clusters):**
  - Cluster B: I7-I12, S12 (AbortSignal threading) — PR 3
  - Cluster C: I3-I5, S3-S20 (consumer recovery) — PR 4
  - Cluster E: S2/S6/S9/S13/S14 + CLAUDE.md updates — PR 5
- **Deviations:**
  - Commit `c098055` (post-retry-exhaustion mapApiError routing) is not enumerated as a sub-task in the plan. It is a forced follow-up to make the I2 NETWORK mapping actually reach the user on retry exhaustion, and is appropriate for Cluster A despite being unplanned at the task level.
  - Plan Task 2.4 Step 3 instructs adding a new `restoreChapterAlreadyPurged` string. The string already exists on `main` (used by the CHAPTER_PURGED byCode mapping). The branch correctly reuses it instead of duplicating with subtly different wording — silent but correct deviation.
- **PR description gate (pre-flight):** CLAUDE.md "Phase-boundary rule" requires every PR to reference its roadmap phase. No PR is open yet; whoever opens it must reference Phase 4b.3a Cluster A and the design doc per plan Task 2.5.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** All 6 changed files plus adjacent context — `apiErrorMapper.ts`, `EditorPage.tsx`, `EditorFooter.tsx`, `api/client.ts`, server-side `chapters.routes.ts` and `projects.routes.ts`, plan + design docs
- **Raw findings:** 18 (across all specialists, before dedup)
- **Verified findings:** 10 (4 Important, 6 Suggestions, 0 Critical)
- **Filtered out:** 8 (duplicates, below-threshold confidence, observations not bugs)
- **Steering files consulted:** `CLAUDE.md` (project root) — save-pipeline invariants 1-5, mapApiError invariant, HTTP code allowlist, zero-warnings rule, one-feature/phase-boundary PR rules
- **Plan/design docs consulted:** `docs/plans/2026-04-25-4b3a-review-followups-plan.md`, `docs/plans/2026-04-25-4b3a-review-followups-design.md`, `docs/roadmap.md`
