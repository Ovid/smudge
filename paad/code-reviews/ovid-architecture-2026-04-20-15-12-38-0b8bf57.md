# Agentic Code Review: ovid/architecture

**Date:** 2026-04-20 15:12:38 UTC
**Branch:** ovid/architecture -> main
**Commit:** 0b8bf57f6a37ffa5e7d4e469d61216b0d3251820
**Files changed:** 30 | **Lines changed:** +5912 / -333
**Diff size category:** Large

## Executive Summary

Phase 4b.1 extracts `useEditorMutation` and migrates three EditorPage callers (snapshot restore, replace-all, replace-one) onto it. The hook itself is carefully built and honors the five save-pipeline invariants in CLAUDE.md. The remaining defects are concentrated in the edges the hook cannot own — the restore error branches in `EditorPage.tsx` and two hand-composed SnapshotPanel callbacks that still pre-date the shared discipline. Most severe: the restore handler sets a "refresh the page" lock banner on `possibly_committed`/`unknown` outcomes without dismissing the SnapshotBanner, leaving a live Restore button that can issue a second server-side restore.

## Critical Issues

### [C1] SnapshotBanner stays active after `possibly_committed`/`unknown` restore — user can double-restore
- **File:** `packages/client/src/pages/EditorPage.tsx:353-384,404-416`
- **Bug:** The `possibly_committed` and `unknown` restore error branches set `editorLockedMessage` but never call `exitSnapshotView()`. The sibling `not_found` branch (line 396) does. SnapshotBanner renders unconditionally on `viewingSnapshot` with `onRestore={handleRestoreSnapshot}`. After `actionBusyRef.current = false` runs in the finally (line 439), a second click passes `isActionBusy()` (no gate on `editorLockedMessage`) and re-enters `mutation.run` → another `api.snapshots.restore(...)` against a snapshot the server almost certainly already committed.
- **Impact:** Server-side double-restore + double auto-snapshot on a user retry. The lock banner suggests refreshing the page, but the visible Restore button invites clicking again first — a reasonable user action.
- **Suggested fix:** Call `exitSnapshotView()` in both branches, or gate SnapshotBanner's Restore button on `editorLockedMessage === null`. Prefer the latter so the user still sees what snapshot was being restored.
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases, Contract & Integration (both independently)

## Important Issues

### [I1] Restore success + `stage:"reload"` paths miss `refreshSnapshotCount()` — stale toolbar badge
- **File:** `packages/client/src/pages/EditorPage.tsx:317-321,335-343`
- **Bug:** (a) Success happy-path (317-321) calls only `snapshotPanelRef.current?.refreshSnapshots()` (no-op when panel is closed — the common SnapshotBanner-initiated case). The server wrote a pre-restore auto-snapshot; the toolbar count is now stale. (b) The `stage:"reload"` branch (335-343) has the same gap. Both `possibly_committed` (382) and the error catch-all (434) do call `refreshSnapshotCount()` — asymmetric treatment.
- **Impact:** After a successful restore (the happy path!), the toolbar snapshot badge understates the count by one until the user opens the panel or switches chapters.
- **Suggested fix:** Add `refreshSnapshotCount()` to both branches. Consider generalizing `finalizeReplaceSuccess` into a shared "post-mutation UI sync" helper that restore also routes through.
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases, Contract & Integration

### [I2] `handleStatusChange` revert lacks seq re-check after `api.projects.get` await
- **File:** `packages/client/src/hooks/useProjectEditor.ts:570`
- **Bug:** On a failed status PATCH, the revert path re-fetches the project via `api.projects.get(slug)` and writes the surgical `status` field to `setProject`/`setActiveChapter`. The seq guard at line 564 covers only the first await (`api.chapters.update`). There is no `seq !== statusChangeSeqRef.current` re-check after the second await at line 570 before the writes at 575-586.
- **Impact:** Rapid A→B then B→C click where A→B fails mid-`api.projects.get` → the late revert stomps C's optimistic update back to A, losing the user's intent silently. Recovery requires another click.
- **Suggested fix:** Add `if (seq !== statusChangeSeqRef.current) return;` immediately after the `api.projects.get(slug)` await and again before the local-revert fallback at line 593.
- **Confidence:** High
- **Found by:** Logic & Correctness

### [I3] `useEditorMutation.run()` does not re-read `editorRef` after `mutate()` — remount window leaves editor writable
- **File:** `packages/client/src/hooks/useEditorMutation.ts:94,117,151`
- **Bug:** `const editor = args.editorRef.current` is captured once at the top of `run()`. If null there (e.g. mid-chapter-remount), all subsequent `editor?.X` calls no-op. If TipTap finishes mounting during the `await mutate()`, the new editor at `args.editorRef.current` is never locked via `setEditable(false)`. Invariant #2 silently breaks for that window.
- **Impact:** Narrow — requires chapter switch immediately before a mutation click. User keystrokes into the freshly mounted editor during the server round-trip could race the mutation's follow-up reload and either be lost (clobbered by the reload) or overwrite the server commit on the next auto-save.
- **Suggested fix:** Re-read `args.editorRef.current` after the mutate await and apply `setEditable(false)` (plus reconcile the finally's re-enable target). Alternatively, short-circuit `run()` with a `stage:"flush"` return when the editor is null at entry.
- **Confidence:** Medium
- **Found by:** Logic & Correctness

## Suggestions

- **Replace 2xx BAD_JSON at project scope wipes ALL chapter draft caches** (`EditorPage.tsx:626-630`) — intentional per comment, but documents no mechanism to recover drafts on chapters the replace never touched. Worth noting in user-facing release notes.
- **`setEditable(false)` throw attributed to `stage:"flush"`** (`useEditorMutation.ts:116-120`) — TipTap remount throw produces "save failed" copy. Consider a dedicated `stage:"editor-unavailable"` or silent degrade.
- **`SnapshotPanel.onView` uses raw `setEditable` instead of `safeSetEditable`** (`EditorPage.tsx:1552,1556,1567`) — outer try/catch conflates flushSave/viewSnapshot throws with setEditable throws under one "save_failed" label.
- **`onView` inner catch at line 1577 is silent** — no `console.warn`, contradicting `safeSetEditable`'s logging discipline (`editorSafeOps.ts:22`).
- **`SnapshotPanel.onBeforeCreate` omits `setEditable(false)` around its flush** (`EditorPage.tsx:1585-1595`) — user keystrokes during the flush window re-dirty the editor; lower severity than `onView` since snapshot-create doesn't overwrite editor content.
- **Restore `stage:"reload"` branch does not defensively `safeSetEditable(false)`** (`EditorPage.tsx:335-343`) — replace's `finalizeReplaceSuccess` does (line 487) and documents the convergence rationale. Restore relies on the hook's reloadFailed path, which works today, but breaks the "both callers converge" principle.
- **`viewSnapshot` misclassifies 2xx BAD_JSON as `reason:"network"`** (`useSnapshotState.ts:211-218`) — should be `corrupt_snapshot`. GET-side BAD_JSON has no "maybe committed" ambiguity.
- **`possibly_committed` and `unknown` restore branches share `STRINGS.snapshots.restoreResponseUnreadable`** (`EditorPage.tsx:358,410`) — two semantically distinct paths with one string; `unknown` currently is a defensive dead branch since `useSnapshotState.restoreSnapshot` never returns `reason:"unknown"` today.
- **`handleStatusChange` zombie optimistic** when `previousStatus` is undefined AND both fallbacks fail (`useProjectEditor.ts:548,593`) — narrow, requires chapter row with undefined status; low reachability.
- **`finalizeReplaceSuccess` reloadFailed branch still awaits `findReplace.search`** (`EditorPage.tsx:476-492`) — a coincident search failure renders a second banner next to the lock banner.
- **Three caller-level entry/exit guards duplicate boilerplate** across `handleRestoreSnapshot`/`executeReplace`/`handleReplaceOne` (`EditorPage.tsx:258-271,517-531,728-741`) — the `isActionBusy`+banner-clears+`actionBusyRef`+stage-router pattern is the remaining drift surface. Consider a `runGuarded(operation, {mapStages})` helper.
- **No test covers cross-caller `actionBusyRef` window** (`EditorPageFeatures.test.tsx`) — the invariant that `actionBusyRef` extends busy past `mutation.run()` into `finalizeReplaceSuccess`'s awaited `findReplace.search` has no regression test. A future refactor removing `actionBusyRef` in favor of `mutation.isBusy()` alone would silently break it.
- **`RestoreResult.message` field is unused** (`useSnapshotState.ts:38`) — populated on several error branches, never read. Dead field invites future regression that plumbs raw server copy into UI (CLAUDE.md violation).

## Plan Alignment

All 17 tasks from `docs/plans/2026-04-19-editor-orchestration-helper-plan.md` appear implemented. The hook's API matches the design doc exactly (`run<T>(mutate)` + `isBusy()`, discriminated `MutationResult<T>`, `isLocked?` predicate, latest-ref pattern).

- **Implemented:** hook scaffold, happy path, flush/mutate/reload/busy stages, null-editor no-op, three caller migrations, `ReloadOutcome` discriminated union, `UseProjectEditorReturn` alias, CLAUDE.md cross-reference.
- **Not yet implemented:** none (plan is complete).
- **Deviations (scope creep into Phase 4b.3):** `findReplaceErrors.ts` gains NETWORK/413/2xx-BAD_JSON/SCOPE_NOT_FOUND branches and a `mapSearchErrorToMessage` twin; `useSnapshotState` gains `aborted`+`possibly_committed` reasons; seven new `strings.ts` keys; `editorSafeOps.ts` helper extracted; `useFindReplaceState.clearError` added; `actionBusyRef` caller-level guard not specified in plan. All are defensible tightenings; none contradict the plan.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment (6 specialists, 1 verifier)
- **Scope:** 9 client-side source files + 3 test files in `packages/client/src/`; plan/design docs; CLAUDE.md
- **Raw findings:** 27 (across 6 specialists)
- **Verified findings:** 17 (1 critical, 3 important, 13 suggestions)
- **Filtered out:** 10 (rejected, duplicates, below-threshold confidence, or safe-by-design on read)
- **Steering files consulted:** `CLAUDE.md` (Save-pipeline invariants, API Design, Pull Request Scope)
- **Plan/design docs consulted:** `docs/plans/2026-04-19-editor-orchestration-helper-design.md`, `docs/plans/2026-04-19-editor-orchestration-helper-plan.md`, `docs/roadmap.md`

## Model Attribution

- **Orchestrator:** claude-opus-4-7[1m] (source: system-prompt)
- **Specialists:**
  - Logic & Correctness: inherit<claude-opus-4-7[1m]> (source: dispatched+inherited)
  - Error Handling & Edge Cases: inherit<claude-opus-4-7[1m]> (source: dispatched+inherited)
  - Contract & Integration: inherit<claude-opus-4-7[1m]> (source: dispatched+inherited)
  - Concurrency & State: inherit<claude-opus-4-7[1m]> (source: dispatched+inherited)
  - Security: inherit<claude-opus-4-7[1m]> (source: dispatched+inherited)
  - Plan Alignment: inherit<claude-opus-4-7[1m]> (source: dispatched+inherited)
  - Verifier: inherit<claude-opus-4-7[1m]> (source: dispatched+inherited)
- **Probe time:** 2026-04-20T15:12:38Z
