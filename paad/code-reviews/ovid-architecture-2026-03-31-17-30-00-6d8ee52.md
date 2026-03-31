# Agentic Code Review: ovid/architecture

**Date:** 2026-03-31 17:30:00
**Branch:** ovid/architecture -> main
**Commit:** 6d8ee52295721ec10c9cb0e8f3040656ffd9c878
**Files changed:** 25 | **Lines changed:** +2450 / -179
**Diff size category:** Large

## Executive Summary

The branch adds chapter status management, a project dashboard, content corruption handling, content caching, and extensive test coverage. The code is well-structured with consistent patterns. The highest-risk file is `useProjectEditor.ts`, which contains all 4 Important-severity findings -- primarily around save error visibility, inconsistent error contracts, and state update race conditions during rapid user interactions.

## Critical Issues

None found.

## Important Issues

### [I1] Save error status immediately overwritten by typing

- **File:** `packages/client/src/hooks/useProjectEditor.ts:109-111`
- **Bug:** After a permanent save failure (4xx error breaks retry loop at line 93, `saveStatus` set to `"error"` at line 102), any subsequent keystroke triggers `handleContentChange` which unconditionally calls `setSaveStatus("unsaved")` at line 111, immediately replacing the error indicator. This directly violates the CLAUDE.md spec: "persistent 'Unable to save' warning on total failure."
- **Impact:** Users lose the save error notification the moment they type, with no persistent indication that their work isn't being saved.
- **Suggested fix:** Either guard `handleContentChange` to not overwrite `"error"` status, or track a separate persistent `saveError` flag independent of `saveStatus`.
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases

### [I2] handleStatusChange re-throws unlike all sibling handlers

- **File:** `packages/client/src/hooks/useProjectEditor.ts:280`
- **Bug:** After catching and reverting a failed status change, `handleStatusChange` re-throws with `throw err`. Every other handler in this hook (`handleSave`, `handleCreateChapter`, `handleDeleteChapter`, `handleRenameChapter`, `handleUpdateProjectTitle`) catches internally and calls `setError()`. The single call site wraps it in `handleStatusChangeWithError`, but any new consumer that doesn't catch will get an unhandled promise rejection.
- **Impact:** Inconsistent API contract. Unhandled promise rejection risk for future callers.
- **Suggested fix:** Handle the error internally with `setError()` like the other handlers, or document the throw contract.
- **Confidence:** High
- **Found by:** Contract & Integration

### [I3] handleStatusChange setActiveChapter updater does not verify chapter ID

- **File:** `packages/client/src/hooks/useProjectEditor.ts:241, 256, 277`
- **Bug:** The `setActiveChapter` updater at line 241 is `(prev) => (prev ? { ...prev, status } : prev)` -- it unconditionally sets `status` on whatever chapter is currently active without verifying `prev.id === chapterId`. The guard on line 240 checks `activeChapterRef.current?.id`, but this ref is synced via `useEffect` which runs after render. If the user changes status then rapidly switches chapters, the status update can land on the wrong chapter. Same issue in the error revert paths at lines 256 and 277.
- **Impact:** After rapid chapter switch + status change, the wrong chapter displays an incorrect status until the next data reload.
- **Suggested fix:** Add `prev?.id === chapterId` guard to all three `setActiveChapter` updaters in `handleStatusChange`.
- **Confidence:** High
- **Found by:** Concurrency & State

### [I4] 4xx save errors discard server error message

- **File:** `packages/client/src/hooks/useProjectEditor.ts:92-95`
- **Bug:** When a 4xx error occurs during save (e.g., 400 VALIDATION_ERROR), the retry loop breaks at line 93 and falls through to `setSaveStatus("error")` at line 102. The specific error message from the server's `ApiRequestError` is never captured or displayed. The user sees only the generic save failure indicator.
- **Impact:** User has no way to understand why their save failed (e.g., "Invalid status: xyz" vs generic "Unable to save").
- **Suggested fix:** Capture the error message from `ApiRequestError` and surface it via a new `saveErrorMessage` state or by including it in the save status display.
- **Confidence:** High
- **Found by:** Contract & Integration

## Suggestions

- **[S1] Dashboard queries `chapter_statuses` table twice** (`packages/server/src/routes/projects.ts:361-364`): Line 361 queries `chapter_statuses` into `allStatuses`, then line 364 calls `getStatusLabelMap(db)` which runs the identical query. Build the label map from `allStatuses` directly. Found by: Contract & Integration.

- **[S2] Status sort direction ignored for unknown statuses** (`packages/client/src/components/DashboardView.tsx:106-107`): When one status is known and the other unknown, hardcoded `-1`/`1` returns ignore the `dir` multiplier. Multiply by `dir`. Found by: Logic & Correctness.

- **[S3] Optimistic status update doesn't update `status_label`** (`packages/client/src/hooks/useProjectEditor.ts:233-238`): `handleStatusChange` updates `status` but not `status_label` in the optimistic update. DashboardView renders `status_label`, showing stale text until server response. Found by: Contract & Integration.

- **[S4] No security headers (helmet)** (`packages/server/src/app.ts`): No `helmet()` middleware or equivalent. Missing X-Content-Type-Options, X-Frame-Options, CSP. Add `helmet()` middleware. Found by: Security.

- **[S5] Double save race between debounce timer and flushSave** (`packages/client/src/components/Editor.tsx:36-39, 121-134`): When the debounced timer fires and clears `debounceTimerRef` before the async save completes, a concurrent `flushSave` sees no pending timer and starts a second save. Can cause false `beforeunload` warning. Track in-flight save promise to prevent concurrent saves. Found by: Concurrency & State.

- **[S6] Error revert overwrites project state with stale server data** (`packages/client/src/hooks/useProjectEditor.ts:249-252`): On status change error, `api.projects.get()` replaces the entire project state, potentially overwriting unsaved content that PreviewMode reads from `project.chapters`. Selectively update only status fields. Found by: Concurrency & State.

- **[S7] apiFetch headers replaced not merged** (`packages/client/src/api/client.ts:24-26`): Spread `{ headers: {...}, ...options }` replaces default Content-Type if callers pass custom headers. No current callers do this, but the API shape allows it. Found by: Error Handling & Edge Cases.

- **[S8] handleDeleteChapter computes remaining from stale projectRef** (`packages/client/src/hooks/useProjectEditor.ts:158`): Rapid consecutive deletes can read `projectRef.current` before React re-renders, selecting an already-deleted chapter for fallback navigation. Use functional `setProject` updater to derive remaining chapters. Found by: Concurrency & State.

- **[S9] Slug collision returns misleading error message** (`packages/server/src/routes/projects.ts:74-83`): Catch block returns "A project with that title already exists" for any UNIQUE constraint failure, but the constraint could be on `slug` (two different titles generating the same slug). Differentiate constraint sources. Found by: Contract & Integration.

- **[S10] Trash endpoint omits status_label enrichment** (`packages/server/src/routes/projects.ts:424-439`): Unlike all other chapter-returning endpoints, the trash endpoint does not enrich chapters with `status_label`. Found by: Contract & Integration.

- **[S11] Unmount flush may call getJSON on destroyed TipTap editor** (`packages/client/src/components/Editor.tsx:57-71`): TipTap's `useEditor` destroys the editor on unmount; the cleanup effect may fire after destruction. The `.catch()` swallows the error, but the flush save silently fails. Content is cached via `handleContentChange`, mitigating data loss. Found by: Error Handling & Edge Cases.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security
- **Scope:** 25 changed files + adjacent callers/callees (resolve-slug.ts, status-labels.ts, chapterQueries.ts, app.ts, api/client.ts, useContentCache.ts)
- **Raw findings:** 22 (before verification)
- **Verified findings:** 15 (after verification)
- **Filtered out:** 7
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** docs/deferred-issues.md
