# Agentic Code Review: ovid/architecture

**Date:** 2026-04-20 23:18:43
**Branch:** ovid/architecture -> main
**Commit:** 97ba7e58b388066a957b2ed376a46af0f5bce149
**Files changed:** 38 | **Lines changed:** +7365 / -371
**Diff size category:** Large

## Executive Summary

Phase 4b.1 extracts the editor mutation pipeline into a new `useEditorMutation` hook — the core hook matches the design and is internally consistent. However, the verifier confirmed **two critical findings**: a data-loss path on the mid-remount re-lock bail branch (the hook returns `stage: "reload"` before the cache-clear runs, and none of the three call-site handlers compensate), and a vacuous test assertion (`clearAllSpy` is never wired to the module mock) that means this exact regression has no guard. Plus one important concurrency bug where a superseded reload combined with a pre-existing lock banner strands an unrelated chapter read-only.

## Critical Issues

### [C1] Mid-remount re-lock bail skips cache-clear on all stage:"reload" paths
- **File:** `packages/client/src/hooks/useEditorMutation.ts:197-203` + `packages/client/src/pages/EditorPage.tsx:368-393, 662-671, 894-902`
- **Bug:** When the mid-mutate remount branch (line 171-204) throws during `setEditable(false)` / `markClean()` / `cancelPendingSaves()`, the catch at line 196-203 returns `stage: "reload"` BEFORE `clearAllCachedContent(directive.clearCacheFor)` at line 205-207. The caller's stage:"reload" handlers — `handleRestoreSnapshot` (368-393) and `finalizeReplaceSuccess` (535-547, invoked from executeReplace 662-671 and handleReplaceOne 894-902) — never call `clearAllCachedContent`/`clearCachedContent` themselves on that path. Net effect: server committed the mutation, but NO chapter cache is cleared.
- **Impact:** Direct data-loss path. On refresh (which the lock banner explicitly directs the user to do), `localStorage` re-hydrates pre-mutation drafts; the first keystroke PATCHes stale content back over the server-committed change. Violates save-pipeline invariant #3 ("cache-clear is the last line of defense") exactly in the branch the hook's comment at lines 184-195 said it was closing.
- **Suggested fix:** Call `clearAllCachedContent(directive.clearCacheFor)` before the catch block returns `stage: "reload"`. Alternatively (or additionally, for defense-in-depth), have each stage:"reload" caller handler clear the relevant chapter's cache.
- **Confidence:** High
- **Found by:** Logic (L1, L3)

### [C2] Test `clearAllSpy` is never wired — L1's regression guard is inert
- **File:** `packages/client/src/hooks/useEditorMutation.test.tsx:678, 716-717`
- **Bug:** `const clearAllSpy = vi.fn()` is declared at line 678 but never replaces the module-level mock of `clearAllCachedContent`. The actual mock (from lines 9-11, `vi.mocked(clearAllCachedContent)`) is what would be invoked. The assertion `expect(clearAllSpy).not.toHaveBeenCalled()` at line 716 is therefore trivially true — nothing ever calls `clearAllSpy`. The test does not verify that `clearAllCachedContent` stayed uncalled on the throwing-post-mutate-setEditable path, which was meant to be the regression anchor for the C1 data-loss path.
- **Impact:** The most critical behavioral anchor for the hook has no real test. Today the wrong behavior (cache-clear happening before a re-lock bail) would still pass the suite, and when C1 is fixed, the post-fix behavior won't be pinned either.
- **Suggested fix:** Replace `expect(clearAllSpy).not.toHaveBeenCalled();` with `expect(vi.mocked(clearAllCachedContent)).not.toHaveBeenCalled();` (and re-evaluate the expectation after C1 is fixed — the assertion may need to flip to `.toHaveBeenCalled()` if the fix moves cache-clear above the bail).
- **Confidence:** High
- **Found by:** Concurrency (K7)

## Important Issues

### [I1] Superseded reload + prior lock banner strands unrelated chapter read-only
- **File:** `packages/client/src/hooks/useEditorMutation.ts:260-284` + `packages/client/src/hooks/useProjectEditor.ts:388-390`
- **Bug:** Scenario: a prior run left the lock banner up (`setEditorLockedMessage` non-null), the user clicks a different chapter, a new `mutation.run()` fires, and `reloadActiveChapter` returns `"superseded"` (current.id !== expectedChapterId). Because the "superseded" branch does not set `reloadSucceeded = true`, the finally's `lockedByCaller = isLocked() && !reloadSucceeded` evaluates true, and `setEditable(true)` is skipped. The new chapter's editor is left `setEditable(false)` even though it was never touched by the mutation. Meanwhile, the useEffect at `EditorPage.tsx:1010-1012` clears the lock banner on `activeChapter?.id` change — so the user ends up with no banner and no way to type until another chapter switch or refresh.
- **Impact:** Stuck "looks editable but can't type" UX on an unrelated chapter. Recovery requires another chapter switch.
- **Suggested fix:** In the `"superseded"` branch at lines 229-237, either set `reloadSucceeded = true` (treating "superseded" as "no need to honor prior lock") OR explicitly clear the lock in EditorPage before the new run starts. The cleanest fix is gating `lockedByCaller` on `outcome !== "superseded"`.
- **Confidence:** Medium (clear repro chain, but requires specific user sequence)
- **Found by:** Concurrency (K4)

### [I2] Restore stage:"reload" asymmetric with possibly_committed on cache-clear
- **File:** `packages/client/src/pages/EditorPage.tsx:368-393` vs `:403-433`
- **Bug:** The `possibly_committed` branch (403-433) explicitly calls `clearCachedContent(activeChapter.id)` as defense-in-depth. The stage:"reload" branch (368-393) does not — it relies on the hook having already cleared caches. Combined with C1 (hook fails to clear on the re-lock-throw path), restore has no redundant clear to catch the gap.
- **Impact:** Amplifies the C1 data-loss window specifically for snapshot restore. Also signals pattern drift between two sibling branches.
- **Suggested fix:** Add `clearCachedContent(activeChapter.id)` in the stage:"reload" branch (after line 373) to mirror the possibly_committed branch's defense-in-depth.
- **Confidence:** Medium
- **Found by:** Logic (L2)

### [I3] `isLocked()` call in finally not wrapped in try/catch
- **File:** `packages/client/src/hooks/useEditorMutation.ts:261`
- **Bug:** `isLockedRef.current?.()` is the only external callable in the hook NOT wrapped in try/catch — every other external call (setEditable entry, flushSave, cancelPendingSaves+markClean, mutate, setEditable in finally) is. A throw from the predicate escapes `run()` as a rejected promise, bypassing the discriminated `MutationResult` contract. Callers `await mutation.run(...)` without try/catch, so the rejection becomes an unhandled rejection.
- **Impact:** Today's `isLocked` closure (`() => editorLockedMessageRef.current !== null`) cannot throw. But the public type is `() => boolean` — nothing prevents a future caller from passing a predicate that reads flaky state. If it throws, every caller's stage-routing breaks.
- **Suggested fix:** `let lockedByCaller = false; try { lockedByCaller = isLockedRef.current?.() === true && !reloadSucceeded; } catch (err) { console.warn("useEditorMutation: isLocked threw", err); lockedByCaller = true; }` — conservative default (keep read-only) so unknown state can't overwrite a committed server change.
- **Confidence:** Medium
- **Found by:** Errors (E1)

## Suggestions

- **[S1] 5xx (and 409) errors fall through to retry-inviting `replaceFailed` copy** — `packages/client/src/utils/findReplaceErrors.ts:68`. A 502/503 that arrives after a successful server commit invites double-replace. Narrow — depends on infrastructure between client and server. Consider a dedicated "possibly committed — refresh to check" copy for 5xx.
- **[S2] 404 with unknown error.code routes to "project not found" copy** — `packages/client/src/utils/findReplaceErrors.ts:54-57`. Future 404 codes (chapter deleted, image gone) would be misreported as project-gone.
- **[S3] restoreSnapshot conflates 413 with network** — `packages/client/src/hooks/useSnapshotState.ts:319-322`. A 413 during restore (rare but possible) shows "check your connection".
- **[S4] Project-scope BAD_JSON with no active chapter clears no cache** — `packages/client/src/pages/EditorPage.tsx:704-709`. Edge case; `executeReplace`'s narrowed cache-clear misses when `getActiveChapter()` is undefined.
- **[S5] `restore.reason ?? "unknown"` fallback is dead code and routes to lock-banner path** — `packages/client/src/pages/EditorPage.tsx:309`. Type guarantees `reason`; the fallback silently ties unknown failures to the most destructive UX.
- **[S6] Restore stage:"mutate" default-fallthrough to generic banner is unreachable but unsafe** — `packages/client/src/pages/EditorPage.tsx:496`. If new throw types are added to the mutate callback, they fall through to a dismissible banner.
- **[S7] Pattern drift between restore and replace error handling** — EditorPage.tsx. Restore inlines an `if/else if` ladder; replace uses `mapReplaceErrorToMessage` + `finalizeReplaceSuccess`. Acknowledged as Phase 4b.3 territory.
- **[S8] `reloadActiveChapter` bumps `saveSeqRef` but doesn't call `cancelInFlightSave`** — `packages/client/src/hooks/useProjectEditor.ts:391`. Sibling paths (handleCreateChapter:316, handleSelectChapter:343) use cancelInFlightSave.
- **[S9] Inconsistent `clearCachedContent` vs `clearAllCachedContent([id])`** — EditorPage.tsx:414, 473, 706, 708, 919. Cosmetic; pick one convention.

## Plan Alignment

Design: `docs/plans/2026-04-19-editor-orchestration-helper-design.md`. Plan: `docs/plans/2026-04-19-editor-orchestration-helper-plan.md`. Roadmap phase: 4b.1.

- **Implemented:** The hook (`useEditorMutation.ts`), its unit test (`useEditorMutation.test.tsx`), three call-site migrations in `EditorPage.tsx`, CLAUDE.md §Save-pipeline invariants closing sentence, `replaceInFlightRef` removed, stage-to-UI routing preserved for flush/mutate/reload/busy.
- **Not yet implemented:** No new Playwright regression — consistent with the design's deferral ("production-shape regression lives in existing e2e"). The separate `EditorPage.unmount-clobber.test.tsx` called out in the design's §PR scope was written and intentionally removed (see design §Testing strategy), replaced by the hook unit-test ordering check.
- **Intentional hardenings (design deltas that are improvements):**
  - `MutationDirective` is a discriminated union requiring `reloadChapterId` when `reloadActiveChapter: true` (design said optional). Commit `edc8de0` — prevents I2 mismatch class of bugs by construction.
  - `ReloadOutcome` is tri-state (`"reloaded" | "superseded" | "failed"`) rather than the design's implied boolean — distinguishes "user switched" from "GET failed".
  - Latest-ref pattern uses render-time assignment (design called for useEffect). Correct for the hook's semantics; documented in the in-file comment.
- **Scope concerns:**
  - String-externalization work in `useProjectEditor.ts` (adds `STRINGS.editor.saveFailedInvalid` / `saveFailedTooLarge`) leaks into Phase 4b.4 territory. Commit `d5e6bce`.
  - New `utils/editorSafeOps.ts` (`safeSetEditable`) was not in the design; added defensively for hand-composed call sites.
  - `SnapshotBanner.tsx` a11y additions (disabled-Restore hint) are a minor UX change despite the "no UX changes" non-goal.
  - Diff shape is larger than planned: ~7,365 insertions, 118+ commits across many review rounds (C1/I1…I7/S1…S5), not the "net deletion in EditorPage.tsx" the design envisioned.
- **Deviations:** None contradicting the plan in a regressive way. Each delta is traceable to a review-driven hardening commit. Design document was not updated to reflect the implemented API (MutationDirective union, ReloadOutcome tri-state) — documentation drift.

## Review Metadata

- **Agents dispatched:** 6 specialists — Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment.
- **Scope:** Changed source files (~20 TS/TSX) + one level of callers/callees. Primary focus: `useEditorMutation.ts`, `EditorPage.tsx`, `useProjectEditor.ts`, `useSnapshotState.ts`, `useFindReplaceState.ts`, `findReplaceErrors.ts`, `editorSafeOps.ts`, tests.
- **Raw findings:** 30 (across specialists, pre-dedup).
- **Verified findings:** 14 (2 Critical + 3 Important + 9 Suggestions).
- **Filtered out:** 16 — rejected as false positives (E6, E7, K3, K6 — ref-during-render timing not a real race; C1, C7, C8, C9 — verified as correct or already covered; E8 — possibly_committed IS handled; K2, K5 — unreachable in practice).
- **Steering files consulted:** `CLAUDE.md` (Save-pipeline invariants §, Accessibility §, Testing Philosophy §, PR Scope §).
- **Plan/design docs consulted:** `docs/plans/2026-04-19-editor-orchestration-helper-design.md`, `docs/plans/2026-04-19-editor-orchestration-helper-plan.md`, `docs/roadmap.md`.

## Model Attribution

- **Orchestrator:** `claude-opus-4-7[1m]` (source: system-prompt)
- **Specialists:**
  - Logic & Correctness: `inherit<claude-opus-4-7[1m]>` (source: dispatched+inherited)
  - Error Handling & Edge Cases: `inherit<claude-opus-4-7[1m]>` (source: dispatched+inherited)
  - Contract & Integration: `inherit<claude-opus-4-7[1m]>` (source: dispatched+inherited)
  - Concurrency & State: `inherit<claude-opus-4-7[1m]>` (source: dispatched+inherited)
  - Security: `inherit<claude-opus-4-7[1m]>` (source: dispatched+inherited)
  - Plan Alignment: `inherit<claude-opus-4-7[1m]>` (source: dispatched+inherited)
  - Verifier: `inherit<claude-opus-4-7[1m]>` (source: dispatched+inherited)
- **Probe time:** 2026-04-20T23:18:43
