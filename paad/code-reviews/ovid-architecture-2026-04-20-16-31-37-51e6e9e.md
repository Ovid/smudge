# Agentic Code Review: ovid/architecture

**Date:** 2026-04-20 16:31:37
**Branch:** `ovid/architecture` → `main`
**Commit:** 51e6e9e71ed0e30c5b11d435ba2fda744174baef
**Files changed:** 33 | **Lines changed:** +6507 / -344
**Diff size category:** Large

## Executive Summary

The branch extracts a `useEditorMutation` hook that centralizes the five save-pipeline invariants and migrates snapshot-restore and find/replace callers to it — a successful structural improvement that the specialists broadly confirmed. The most actionable finding is **one critical regression**: `executeReplace` and `handleReplaceOne` never got the `editorLockedMessageRef !== null` guard that `handleRestoreSnapshot` and `switchToView` apply, so a persistent "refresh the page" lock banner does not in fact prevent Replace-All / Replace-One from issuing further server writes. Beyond that, the hook leaves a handful of narrow error-path and race gaps (missing `markClean` on mid-mutate remount, un-gated `onInsertImage` / `handleProjectSettingsUpdate` / `onBeforeCreate`, uncaught `flushSave` throw) plus several honest suggestions — mostly about extracting helpers to retire four copies of the "2xx BAD_JSON" bookkeeping.

## Critical Issues

### [C1] Replace-All / Replace-One bypass the persistent lock banner

- **File:** `packages/client/src/pages/EditorPage.tsx:540, 741`
- **Bug:** `executeReplace` and `handleReplaceOne` have no `editorLockedMessageRef.current !== null` guard, unlike `handleRestoreSnapshot:260` and `switchToView:1052`.
- **Impact:** After a previous restore/replace leaves the "refresh the page..." lock banner up (reload-failure or 2xx BAD_JSON), the user can still open Ctrl+H and submit another replace. A fresh server write (plus an auto-snapshot) goes out while the UI claims nothing will touch server state until refresh — which can silently overwrite the prior ambiguously-committed mutation.
- **Fix:** As the first line of both functions, mirror `handleRestoreSnapshot:260`: `if (editorLockedMessageRef.current !== null) { setActionInfo(STRINGS.editor.mutationBusy); return; }`.
- **Confidence:** High
- **Found by:** Error Handling

## Important Issues

### [I1] `handleDeleteChapter` does not cancel an in-flight select GET

- **File:** `packages/client/src/hooks/useProjectEditor.ts:432-480`
- **Bug:** The handler calls `cancelInFlightSave()` but never `cancelInFlightSelect()` (as `handleCreateChapter` does).
- **Impact:** A chapter-GET in flight at delete time can resolve during `api.chapters.delete(...)` and `setActiveChapter` on a stale/deleted chapter — observable as a brief wrong-chapter selection before the delete effect settles.
- **Fix:** Add `cancelInFlightSelect()` at the top of `handleDeleteChapter` next to `cancelInFlightSave()`.
- **Confidence:** High
- **Found by:** Logic

### [I2] Snapshot-restore error branches leave the banner actionable

- **File:** `packages/client/src/pages/EditorPage.tsx:417-448`
- **Bug:** `corrupt_snapshot`, `cross_project_image`, and `network` branches surface an error but do not call `exitSnapshotView()`. Only `not_found` dismisses the banner; `unknown` escalates to the lock banner which disables the button via `canRestore`.
- **Impact:** For `corrupt_snapshot` especially, the snapshot is permanently broken — a `canRestore`-enabled banner invites the user to loop the same failure. `cross_project_image` has the same shape. `network` is retry-legitimate and may be intentional.
- **Fix:** Call `exitSnapshotView()` from the `corrupt_snapshot` and `cross_project_image` branches.
- **Confidence:** Medium
- **Found by:** Logic

### [I3] `onBeforeCreate` lets a `flushSave` throw escape as an unhandled rejection

- **File:** `packages/client/src/pages/EditorPage.tsx:1631-1641`, `packages/client/src/components/SnapshotPanel.tsx:193-220`
- **Bug:** `onBeforeCreate` does `await editorRef.current?.flushSave()` with no try/catch; `SnapshotPanel.handleCreate` also awaits `onBeforeCreate()` without a try/catch (the catch only wraps `api.snapshots.create`). Per `editorSafeOps.ts:4-8`, TipTap can throw synchronously during remount.
- **Impact:** User clicks "Create Snapshot" during a remount window → unhandled promise rejection → no banner, no `createError`, nothing visible.
- **Fix:** Wrap `onBeforeCreate`'s body in try/catch mirroring `onView`'s pattern, returning `false` on throw with an appropriate `setActionError`.
- **Confidence:** Medium
- **Found by:** Error Handling

### [I4] `onInsertImage` not gated by `isActionBusy()`

- **File:** `packages/client/src/pages/EditorPage.tsx:1545-1547`
- **Bug:** `ImageGallery.onInsertImage` calls `editorRef.current?.insertImage(...)` (a focused TipTap chain) without the busy gate present on every other panel/view control.
- **Impact:** Inserting during an in-flight mutation can fire `onUpdate`, set `dirtyRef=true` on content that is about to be overwritten, and schedule an auto-save after the hook already `markClean`-ed.
- **Fix:** Gate the callback on `isActionBusy()` with the standard `setActionInfo(STRINGS.editor.mutationBusy)` path.
- **Confidence:** Medium
- **Found by:** Concurrency

### [I5] `handleProjectSettingsUpdate` not gated by `isActionBusy()`

- **File:** `packages/client/src/pages/EditorPage.tsx:1171-1196`
- **Bug:** `api.projects.get(slug).then(setProject)` runs with no busy gate.
- **Impact:** Concurrent `setProject` writes from the settings refresh and an in-flight mutation can interleave; FindReplace state resets on project id change can discard a pending search.
- **Fix:** Gate the update on `mutation.isBusy() || isActionBusy()`, or defer the GET until the busy latch clears.
- **Confidence:** Medium
- **Found by:** Concurrency

### [I6] Mid-mutate editor remount is locked but not `markClean`-ed

- **File:** `packages/client/src/hooks/useEditorMutation.ts:170-177`
- **Bug:** When a fresh `editorRef.current` is observed after `await mutate()`, the hook calls `setEditable(false)` on the new instance but does not call `markClean()` or re-run `cancelPendingSaves()`. A keystroke landing in the mount→lock window sets `dirtyRef=true`; on later unmount the Editor's cleanup fires a fire-and-forget PATCH with stale content.
- **Impact:** Narrow race that can silently revert the just-committed server mutation. Violates invariant 1 for the remount window.
- **Fix:** After `editorAfterMutate.setEditable(false)`, also call `editorAfterMutate.markClean()` and `projectEditorRef.current.cancelPendingSaves()`.
- **Confidence:** Medium
- **Found by:** Logic, Concurrency

## Suggestions

- **[S1]** `useSnapshotState.ts:272-277` — post-restore `list(...).catch(()=>{})` should `setSnapshotCount(null)` to match the initial-load branch; otherwise badge under-reports after a failed refresh.
- **[S2]** `useProjectEditor.ts:391` — `reloadActiveChapter` bumps `saveSeqRef` directly; replace with `cancelInFlightSave()` so future callers don't leak an in-flight PATCH racing the reload GET (latent).
- **[S3]** `EditorPage.tsx:385-416, 436-448, 644-669, 851-871` — four hand-composed "2xx BAD_JSON" cache-clear + lock sequences; extract a helper or widen the hook's directive to cover mutate-throw cache clearing.
- **[S4]** `EditorPage.tsx:327-334, 367-373, 406-414, 456-466` — five `refreshSnapshots + refreshSnapshotCount` pairs in `handleRestoreSnapshot`; factor `finalizeRestoreSuccess` symmetric to `finalizeReplaceSuccess`.
- **[S5]** `EditorPage.tsx:266-279, 550-563, 761-773` — entry scaffolding (`isActionBusy` + `actionBusyRef=true` + `setAction*(null)` + `findReplace.clearError()`) repeated verbatim across three callers; extract a `beginActionBusy()` wrapper.
- **[S6]** `useProjectEditor.ts:16` — `ReloadOutcome = "reloaded" | "superseded" | "failed"` on the public interface lets future boolean-coercing callers conflate "reloaded" and "superseded"; consider an object return or rename.
- **[S7]** `Editor.tsx:270-313` — the effect that assigns `editorRef.current` has no cleanup; nulling the ref on unmount makes `useEditorMutation.finally` robust against stale handles.
- **[S8]** `useFindReplaceState.ts:79-84` — unmount aborts the in-flight search but doesn't bump `searchSeqRef`; defense-in-depth for future React semantics.
- **[S9]** `EditorPage.tsx:1052-1054` — `switchToView` returns `false` silently when the lock banner is up; a transient `setActionInfo` would acknowledge keyboard-shortcut invocations.
- **[S10]** `useEditorMutation.ts:234` — `isLockedRef.current?.()` in the finally isn't try/caught; a future predicate that throws would reject `run()` across every caller (theoretical).
- **[S11]** `useEditorMutation.ts:242-255` + `EditorPage.tsx:519` — on mutate-stage 2xx BAD_JSON the hook's finally re-enables the editor, then the caller re-locks it a microtask later; narrow contract gap where the hook could accept a "commit-ambiguous → keep locked" signal.
- **[S12]** `useEditorMutation.ts:122-126, 242-255` — if entry-side `setEditable(false)` throws, the finally still calls `setEditable(true)` on the same broken editor; track the entry throw and skip the unlock retry.
- **[S13]** `EditorPage.tsx:260-270` — `handleRestoreSnapshot` entry reads `editorLockedMessageRef` / `isActionBusy()` before setting `actionBusyRef.current=true`; setting the ref first closes the (latent) same-tick double-click window.
- **[S14]** `useEditorMutation.ts:259, 262` — `run` memoized with `[args.editorRef]` while `isBusy` uses `[]`; the asymmetry is brittle if a caller ever passes a non-stable ref.

## Plan Alignment

Plan docs consulted: `docs/plans/2026-04-19-editor-orchestration-helper-design.md`, `docs/plans/2026-04-19-editor-orchestration-helper-plan.md`.

- **Implemented:** The full hook surface (`run`, `isBusy`, `MutationDirective`, `MutationResult`, latest-ref pattern, null-ref safety, `isLocked` predicate), migration of `handleRestoreSnapshot`, `executeReplace`, and `handleReplaceOne`, removal of `replaceInFlightRef`, `UseProjectEditorReturn` export, CLAUDE.md update, and an 870-line test file covering ordering, directive guards, failure stages, busy guard, and latest-ref.
- **Not yet implemented:** None of the in-scope design items are missing at the file level. (`make all` / coverage pass cannot be verified from the diff alone.)
- **Deviations — likely deliberate course-corrections:**
  - `useEditorMutation.ts:19` — `MutationDirective` is a discriminated union forcing `reloadChapterId` when `reloadActiveChapter: true`; design declared it as an optional field. Strictly a strengthening; contradicts the plan's stated API.
  - `useEditorMutation.ts:106` — latest-ref assignment happens during render with a rationale comment, not in a `useEffect` as the design specified.
  - `useEditorMutation.ts:176` — `reloadActiveChapter` gained an `expectedChapterId` arg and a tri-state `ReloadOutcome`; neither is in the plan. (See [S6].)
  - `EditorPage.tsx:195` — caller-level `actionBusyRef` / `isActionBusy()` layered on top of the hook's busy guard, with `STRINGS.editor.mutationBusy` surfaced from many non-mutation entry points. Design scoped the busy guard to `run()`-routed callers.
  - `EditorPage.tsx:142` — persistent non-dismissible `editorLockedMessage` with `canRestore` gating; design called for a "dismissible banner" on reload failure.
  - `useSnapshotState.ts` / `useFindReplaceState.ts` / `useProjectEditor.ts` gained new `RestoreFailureReason` variants, a `clearError()` method, `BAD_JSON` / `NETWORK` / `searchProjectNotFound` error branches, `mapSaveError` i18n, 4xx-only cache wipe, and unmount-cleanup logic. The plan's §Out-of-scope explicitly excluded these.
  - `editorSafeOps.ts` — new utility not in the plan's deliverables list.
  - `EditorPage.tsx:488` — `finalizeReplaceSuccess` extraction; plan cautioned "resist the urge to add helpers" for the replace migration.

None of these deviations are inherently bugs — they are the precipitate of an iterative review cycle visible in the commit log (C1/I1/I2/I3/I4/I5/I6/I7 fix commits). Consider updating the plan doc or adding a follow-up note so the design and implementation re-align.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** `useEditorMutation.ts` (new), `useProjectEditor.ts`, `useSnapshotState.ts`, `useFindReplaceState.ts`, `EditorPage.tsx`, `SnapshotBanner.tsx`, `editorSafeOps.ts` (new), `findReplaceErrors.ts`, `strings.ts`, plus callers/callees and adjacent tests
- **Raw findings:** 37 (Security: 0, Contract: 11, Logic: 9, Concurrency: 10, Error Handling: 4, Plan: deviations separately)
- **Verified findings:** 21 (1 Critical, 6 Important, 14 Suggestion)
- **Filtered out:** 4 rejected (VALIDATION_ERROR status check — `rejected4xx` only assigned on 4xx; SnapshotPanel onView/onBeforeCreate invariant-1 — by design scope; `"aborted"` variant — actually emitted via `ABORTED` code at `useSnapshotState.ts:290`; reload stage missing `error` — intentional per hook contract). The balance were deduplicated between specialists (F1 Logic+ErrHandling, F2 Logic+Concurrency, F9 Logic+Concurrency, F14 Contract+Concurrency).
- **Steering files consulted:** `CLAUDE.md`
- **Plan/design docs consulted:** `docs/plans/2026-04-19-editor-orchestration-helper-design.md`, `docs/plans/2026-04-19-editor-orchestration-helper-plan.md`

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
- **Probe time:** 2026-04-20T16:31:37Z
