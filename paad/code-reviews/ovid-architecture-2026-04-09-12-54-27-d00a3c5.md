# Agentic Code Review: ovid/architecture

**Date:** 2026-04-09 12:54:27
**Branch:** ovid/architecture -> main
**Commit:** d00a3c509d1c768cb536134b997f102df58e2fb2
**Files changed:** 12 | **Lines changed:** +1055 / -381
**Diff size category:** Large

## Executive Summary

This branch decomposes the monolithic `EditorPage` component into focused custom hooks (`useKeyboardShortcuts`, `useChapterTitleEditing`, `useProjectTitleEditing`, `useSidebarState`, `useTrashManager`) and adds a `ShortcutHelpDialog` component. The decomposition is clean and well-structured. Two Important bugs were found where editing state is not reset when the underlying entity changes, which can cause title saves to apply to the wrong chapter/project. Four minor suggestions were also identified. Overall confidence is high -- the core save pipeline and state management are solid.

## Critical Issues

None found.

## Important Issues

### [I1] Chapter title edit state not reset when active chapter changes
- **File:** `packages/client/src/hooks/useChapterTitleEditing.ts:12-52`
- **Bug:** The hook maintains `editingTitle`, `titleDraft`, and `isSavingTitleRef` state, but has no `useEffect` that resets these when `activeChapter` changes. If a user is editing Chapter A's title and switches to Chapter B (e.g., via Ctrl+Shift+Arrow), the `editingTitle` flag stays true, `titleDraft` still contains Chapter A's title, and `saveTitle()` will call `handleRenameChapter(activeChapter.id, ...)` with Chapter B's ID but Chapter A's draft text -- renaming the wrong chapter.
- **Impact:** User renames the wrong chapter, causing data corruption and confusion. The keyboard shortcut for chapter navigation (Ctrl+Shift+Arrow) can trigger this during normal use.
- **Suggested fix:** Add a `useEffect` that cancels editing when the chapter identity changes:
  ```typescript
  useEffect(() => {
    setEditingTitle(false);
    setTitleError(null);
  }, [activeChapter?.id]);
  ```
- **Confidence:** High
- **Found by:** Logic & Correctness

### [I2] Project title edit state not reset when project changes
- **File:** `packages/client/src/hooks/useProjectTitleEditing.ts:11-49`
- **Bug:** Same pattern as I1. No `useEffect` resets `editingProjectTitle`/`projectTitleDraft` when the `project` prop changes. If the project object changes while a title edit is in progress, `saveProjectTitle()` would use the new project's context with the old draft text.
- **Impact:** Project rename could apply to the wrong project. Lower likelihood than I1 since project changes during editing are rarer, but the code pattern is identical.
- **Suggested fix:** Add a `useEffect` that cancels editing when the project identity changes:
  ```typescript
  useEffect(() => {
    setEditingProjectTitle(false);
  }, [project?.id]);
  ```
- **Confidence:** High
- **Found by:** Logic & Correctness

## Suggestions

### [S1] Async callback passed where sync callback expected
- **File:** `packages/client/src/pages/EditorPage.tsx:173-178`
- **Bug:** `handleStatusChangeWithError` is `async` and returns `Promise<void>`, but is passed to Sidebar's `onStatusChange` which expects `(chapterId: string, status: string) => void`. The Promise is silently discarded. No practical impact since `handleStatusChange` has self-contained error handling with optimistic update/revert.
- **Suggested fix:** Remove `async`/`await` from the wrapper since the operation is fire-and-forget by design:
  ```typescript
  const handleStatusChangeWithError = useCallback(
    (chapterId: string, status: string) => {
      handleStatusChange(chapterId, status, setActionError);
    },
    [handleStatusChange, setActionError],
  );
  ```
- **Confidence:** Medium
- **Found by:** Contract & Integration

### [S2] Keyboard handler async return values unhandled
- **File:** `packages/client/src/hooks/useKeyboardShortcuts.ts:89,130`
- **Bug:** `handleCreateChapterRef.current()` and `handleSelectChapterWithFlushRef.current()` return Promises that are not awaited or caught. Mitigated by internal try/catch in both functions, but an unexpected error outside those blocks would produce an unhandled rejection.
- **Suggested fix:** Add `.catch()` handlers or void the return values explicitly.
- **Confidence:** Medium
- **Found by:** Error Handling

### [S3] No .catch() on flushSave in preview toggle
- **File:** `packages/client/src/hooks/useKeyboardShortcuts.ts:111`
- **Bug:** `flushSave()` rejection would be unhandled. The `.then()` callback (which switches view mode) wouldn't execute on rejection, but no `.catch()` exists to handle or log the error.
- **Suggested fix:** Add `.catch(() => { /* log or no-op */ })` to the promise chain.
- **Confidence:** Medium
- **Found by:** Error Handling

### [S4] Silent failure on project re-fetch after settings update
- **File:** `packages/client/src/pages/EditorPage.tsx:583-586`
- **Bug:** `.catch(() => {})` silently swallows errors when re-fetching the project after a settings update. Local project state may be stale until next page load. The settings themselves were already saved successfully; only the local state refresh fails.
- **Suggested fix:** Surface the error via `setActionError` so the user knows to refresh.
- **Confidence:** Medium
- **Found by:** Error Handling

## Plan Alignment

Architecture report found at `paad/architecture-reviews/2026-04-09-smudge-architecture-report.md`. This branch addresses finding **F-01** (EditorPage god component) from that report.

- **Implemented:** EditorPage decomposed into 5 focused hooks + 1 new dialog component. Keyboard shortcuts extracted with ref-based stale closure avoidance. Sidebar state, trash management, and title editing all separated.
- **Not yet implemented:** Other architecture report findings (F-02 through F-06) are not in scope for this branch.
- **Deviations:** None -- the decomposition follows the architecture report's recommendations.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security
- **Scope:** 12 changed files + adjacent callers/callees (EditorPage.tsx, 5 new hooks, ShortcutHelpDialog, test file, docs)
- **Raw findings:** 20 (before verification)
- **Verified findings:** 6 (after verification)
- **Filtered out:** 14
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** paad/architecture-reviews/2026-04-09-smudge-architecture-report.md
