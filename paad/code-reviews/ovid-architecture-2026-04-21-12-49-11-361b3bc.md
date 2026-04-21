# Agentic Code Review: ovid/architecture

**Date:** 2026-04-21 12:49:11
**Branch:** ovid/architecture → main
**Commit:** 361b3bc8d109905c27d08e5eca950c7923cbf82b
**Files changed:** 48 | **Lines changed:** +10,210 / -421
**Diff size category:** Large

## Executive Summary

Phase 4b.1 extracts a `useEditorMutation` hook and migrates three EditorPage call sites — the core refactor is tight and well-defended (extensive review-driven iteration over ~16 rounds shows in the code). No Critical findings and no Security findings. Four Important findings, all in `useFindReplaceState` and one unwrapped keybinding — each is a realistic user-hit path. Seven Suggestions cover defense-in-depth gaps that would matter when future mutation flows (4c notes/tags, 5b scene cards) inherit the hook.

## Critical Issues

None found.

## Important Issues

### [I1] Ctrl+S flushSave not try-wrapped
- **File:** `packages/client/src/pages/EditorPage.tsx:1476-1480`
- **Bug:** The `flushSave` callback passed to `useKeyboardShortcuts` calls `editorRef.current?.flushSave()` unwrapped, while every other external flushSave entry (`switchToView` at 1291-1303, `SnapshotPanel.onView` at 1898-1925, `onBeforeCreate` at 1959-1976) wraps it in try/catch.
- **Impact:** A synchronous TipTap mid-remount throw surfaces as an unhandled rejection instead of a save-failed banner. Ctrl+S is the most-used save shortcut.
- **Suggested fix:** Wrap in try/catch matching `switchToView`'s pattern — on throw, `setActionError(...)` and swallow.
- **Confidence:** High
- **Found by:** Error Handling

### [I2] closePanel can latch loading=true
- **File:** `packages/client/src/hooks/useFindReplaceState.ts:119-150, 185, 218-226`
- **Bug:** `closePanel` calls `setLoading(false)` + `clearTimeout`, but if the 300ms debounce timer has already fired and its callback is queued on the task queue, `clearTimeout` is a no-op. The callback then runs `search()` which calls `setLoading(true)` at line 185; the seq guard at 189 skips state writes; the `finally` at 218 requires `seq === searchSeqRef.current` (which fails after the bump at 136), so `setLoading(false)` never runs.
- **Impact:** Next panel open shows a stuck "Searching…" spinner with no recovery path.
- **Suggested fix:** In the finally, clear loading unconditionally when the seq has moved; or add an early bail before `setLoading(true)`.
- **Confidence:** Medium
- **Found by:** Concurrency & State

### [I3] Debounced search captures slug at effect-setup time
- **File:** `packages/client/src/hooks/useFindReplaceState.ts:232-248`
- **Bug:** `const slug = latestSlugRef.current` is read at effect-setup and closed over by the `setTimeout` callback. Subsequent `projectSlug` changes (project rename) update the ref but don't re-run the effect, so `search(slug)` at line 241 fires against the stale slug. Contradicts the design intent documented at lines 266-280 ("always read `.current` at call time").
- **Impact:** A rename within the 300ms debounce window fires the search against the dead slug — 404 or stale results.
- **Suggested fix:** Read `latestSlugRef.current` inside the setTimeout callback instead of capturing it in the outer `slug` variable.
- **Confidence:** High
- **Found by:** Concurrency & State

### [I4] 413 leaves stale results alongside "too large" banner
- **File:** `packages/client/src/hooks/useFindReplaceState.ts:200-217`
- **Bug:** The error branch clears `results`/`resultsQuery`/`resultsOptions` only for status 400/404. Status 413 (payload too large) falls through to the else branch intended for transient 5xx/network errors, so results are preserved. But 413 is not transient — the query itself exceeded the cap.
- **Impact:** The panel shows the `contentTooLarge` banner next to the prior result rows; clicking Replace acts on stale matches the server said it cannot process.
- **Suggested fix:** Add `err.status === 413` to the clearing branch at line 200.
- **Confidence:** High
- **Found by:** Error Handling

## Suggestions

- **[S1] Re-lock-fail catch missing `cancelPendingSaves`** — `useEditorMutation.ts:189-221`. Mid-mutate remount branch can leave a keystroke-scheduled save alive if `setEditable(false)` throws before `cancelPendingSaves` runs. Call `projectEditorRef.current.cancelPendingSaves()` inside the catch. Found by Logic & Correctness.
- **[S2] flush-throw short-circuits `cancelPendingSaves`** — `useEditorMutation.ts:140-172`. When entry `setEditable(false)` throws, returns `stage:"flush"` before `cancelPendingSaves` at line 168 runs; a pre-existing save in backoff may still commit while the banner says failed. Cancel before the first setEditable, or cancel in the catch. Found by Logic & Correctness.
- **[S3] prev-slug sentinel leaves ref stale during `undefined` transition** — `useProjectEditor.ts:54-60`. `prevSlugArgRef.current = slug` runs unconditionally but `projectSlugRef.current = slug` only when `slug !== undefined`. Either clear the ref on undefined, or document why the prior slug should persist. Found by Logic & Correctness.
- **[S4] `reloadActiveChapter` calls not wrapped in try/catch** — `useEditorMutation.ts:283-294, 334-337`. Adjacent potentially-throwing operations are all wrapped; these two are bare. Today `reloadActiveChapter` catches internally, but a future refactor would escape as an unhandled rejection and bypass stage-routing. Wrap both; on catch, set `reloadFailed = true` and return `stage:"reload"`. Found by Logic & Correctness + Error Handling.
- **[S5] Re-lock skipped when post-mutate ref is null** — `useEditorMutation.ts:189`. Guard `editorAfterMutate !== null && !== editor` misses the unmount-between-mutate-and-reload window — a new editor mounting during the reload GET starts editable=true and unmarked. Consider a deferred lock or re-read before the reload. Found by Concurrency & State.
- **[S6] Rename trips slug-drift guard, silently discards valid responses** — `useProjectEditor.ts:356, 569, 610`. `handleCreateChapter`, `handleReorderChapters`, `handleUpdateProjectTitle` compare `projectSlugRef.current !== slug` after the network call. `handleUpdateProjectTitle` rewrites the ref on rename success, so a rename between another handler's dispatch and response trips the guard and silently discards a valid response. Compare project id instead of slug. Found by Concurrency & State.
- **[S7] `handleProjectSettingsUpdate` GET races mid-started mutation** — `EditorPage.tsx:1424-1452`. Busy gate at entry passes, then unguarded `api.projects.get(slug).then(setProject)`. If a mutation starts during the in-flight GET, `.then` merges pre-mutation top-level fields (target word count / deadline / mode) over post-mutation state. Re-check `mutation.isBusy()` in the `.then`, or seq-guard the GET. Found by Concurrency & State.

## Plan Alignment

Implementation of Phase 4b.1 is thorough — `useEditorMutation` hook, three call-site migrations, CLAUDE.md update, and extensive test coverage are all present.

- **Implemented:** `useEditorMutation.ts` with full API (`MutationStage`, `MutationDirective`, `MutationResult`, `run`, `isBusy`); latest-ref pattern for `projectEditor`; `isLocked` predicate consulted in `finally`; three call sites migrated (`handleRestoreSnapshot`, `executeReplace`, `handleReplaceOne`); `replaceInFlightRef` removed; CLAUDE.md §Save-pipeline invariants closing sentence added (line 90); `useEditorMutation.test.tsx` with 1,208 lines.
- **Not yet implemented:** The plan's `EditorPage.unmount-clobber.test.tsx` (consistent with Task 14's decision to drop in favor of existing e2e coverage).
- **Deviations:**
  - PR scope materially exceeds the design's §PR scope list (20+ files vs. 5 expected). Substantive behavior changes to `useProjectEditor.ts` — new `ReloadOutcome`, `cancelInFlightSave`/`cancelInFlightSelect`, `mapSaveError`, narrowed 4xx cache-wipe, new `onError` callbacks — conflict with Task 16 Check 5, which expected `useProjectEditor.handleSave` untouched.
  - Error-code mapping additions (`findReplaceErrors.ts` BAD_JSON/NETWORK branches, `mapSaveError`) overlap Phase 4b.3 out-of-scope territory.
  - New user-visible behavior (`editorLockedMessage` persistent banner, SnapshotBanner `canRestore`/`canBack` gating, title-editing `isActionBusy`/`isEditorLocked` gates) not called out in §Deliverables.
  - `reloadActiveChapter` signature changed (return type `Promise<ReloadOutcome>`, new `expectedChapterId` parameter) beyond the design's "await-a-wrapped-Promise" mitigation plan.
  - `EditorPageFeatures.test.tsx` was modified despite the design claiming it would run "unmodified."

Partial implementation is expected for a refactor-plus-review cycle; the scope expansion is consistent with the 16-round iterative review pattern visible in the commit log. Consider splitting future phases to hold to the one-feature rule more strictly.

## Review Metadata

- **Agents dispatched:** Logic & Correctness (core hooks), Logic & Correctness (EditorPage), Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** All 48 changed files; one-level-deep callers/callees traced for `useEditorMutation` consumers
- **Raw findings:** 23 (across 6 specialists; Security reported none)
- **Verified findings:** 11 (4 Important, 7 Suggestions, 0 Critical)
- **Filtered out:** 12 — false positives (documented design intent, misread code, style only, expected behavior), plus one inter-specialist duplicate merged
- **Steering files consulted:** `/Users/poecurt/projects/smudge/CLAUDE.md`
- **Plan/design docs consulted:** `docs/plans/2026-04-19-editor-orchestration-helper-design.md`, `docs/plans/2026-04-19-editor-orchestration-helper-plan.md`, `docs/roadmap.md`
