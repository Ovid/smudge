# Agentic Code Review: ovid/architecture

**Date:** 2026-04-09
**Branch:** ovid/architecture -> main
**Commit:** 15a71a8bb1ecd9c32db36568ef33332fa11466db
**Files changed:** 8 | **Lines changed:** +921 / -348
**Diff size category:** Large

## Executive Summary

This branch decomposes the `EditorPage` god component (F-01 from the architecture report) into 5 focused hooks and 1 new component. The refactoring is well-executed and aligns precisely with the architecture report's recommendation. Three important issues were found: a chapter rename failure that triggers a full-page error overlay (instead of an inline error), an unhandled promise rejection in the Ctrl+Shift+P keyboard shortcut, and a potential save-loss race between `flushSave` and chapter switching. No critical issues found.

## Critical Issues

None found.

## Important Issues

### [I-1] Chapter rename failure triggers full-page error overlay
- **File:** `packages/client/src/hooks/useProjectEditor.ts:341-343`
- **Bug:** `handleRenameChapter` catches errors and calls `setError` (line 342), which drives the full-page error overlay in EditorPage. By contrast, `handleUpdateProjectTitle` explicitly avoids `setError` (comment on line 243: "Don't call setError -- that triggers the full-page error overlay") and uses `setProjectTitleError` for inline display. Chapter rename has no such protection -- a transient network error while renaming destroys the entire editor view.
- **Impact:** A transient network error during chapter rename (1) closes the title input, (2) reverts to the old title, and (3) replaces the editor with a full-page error overlay, forcing the user to navigate back.
- **Suggested fix:** Follow the `handleUpdateProjectTitle` pattern: catch the error in `handleRenameChapter`, surface it via a dedicated `setChapterTitleError` state or an `onError` callback (like `handleStatusChange` does), and avoid calling `setError`.
- **Confidence:** High
- **Found by:** Logic & Correctness, Error Handling
- **Status:** FIXED (87e5ebf) -- `handleRenameChapter` now accepts optional `onError` callback; `useChapterTitleEditing` handles errors inline and keeps edit mode open for retry.

### ~~[I-2] Ctrl+Shift+P flushSave rejection causes silent no-op~~
- **Status:** FALSE POSITIVE -- `flushSave()` (Editor.tsx:133-147) has its own `.catch()` that swallows rejections; the returned promise always resolves. The missing `.catch()` in useKeyboardShortcuts is harmless.

### ~~[I-3] flushSave / handleSelectChapter sequencing race may lose content~~
- **Status:** FALSE POSITIVE -- `flushSave()` returns `onSaveRef.current(...).then(...).catch(...)`, which resolves only after the full `onSave` API call settles. The `await flushSave()` in `handleSelectChapterWithFlush` correctly waits for completion before `handleSelectChapter` increments `saveSeqRef`.

## Suggestions

- **[S-1]** Logic duplication between `useChapterTitleEditing` and `useProjectTitleEditing` -- identical state machines (escapePressedRef, isSavingRef, start/cancel/save) with already-diverged error handling. Extract a shared `useTitleEditing` hook. (Contract & Integration)
- **[S-2]** `setProject` parameter in `useTrashManager` typed as functional-updater-only but actual value is `React.Dispatch<SetStateAction>` -- widen the type to match. (Contract & Integration)
- **[S-3]** `activeChapterRef` in `useProjectEditor` synced via `useEffect` (after paint) rather than inline during render, creating a one-render lag window where save callbacks read stale ref. (Concurrency & State)
- **[S-4]** `useTrashManager` captures `slug` as a plain parameter, not a ref -- if slug changes (project rename), `handleRestore` uses stale slug for navigation comparison. (Contract & Integration, Concurrency & State)
- **[S-5]** `restored.project_slug` relies on a local type intersection in `client.ts`, not the shared `Chapter` type -- fragile contract that breaks silently if the return type is widened. (Contract & Integration)
- **[S-6]** `saveTitle` silently discards empty title with no validation feedback -- closes edit mode without telling the user why. (Error Handling)
- **[S-7]** `ShortcutHelpDialog` `onClose` fires twice on Escape (native dialog close event + keydown handler) -- idempotent today but fragile if `onClose` gains side effects. (Logic & Correctness, Error Handling)
- **~~[S-8]~~** ~~`toggleSidebar` in `useKeyboardShortcuts` called directly from mount-time closure, not via ref like other callbacks.~~ FIXED (1f63064) -- moved to ref pattern.
- **[S-9]** `confirmDeleteChapter` in `useTrashManager` closes over `project` via `useCallback` deps -- adequate for React's update model but could be tightened with a ref for the slug. (Contract & Integration, Concurrency & State)
- **[S-10]** `editorRef` typed as `RefObject` in `useKeyboardShortcuts` vs `MutableRefObject` in `Editor` -- cosmetic type inconsistency. (Contract & Integration)
- **[S-11]** Velocity `useEffect` can fire two concurrent fetches on initial load + fast save -- benign (idempotent GET), fix by setting `lastVelocityFetch.current` synchronously before the fetch. (Logic & Correctness)
- **[S-12]** `setProject(data)` plain-value call in `ProjectSettingsDialog.onUpdate` could use functional updater for consistency with other callers. (Logic & Correctness)

## Plan Alignment

- **Implemented:** F-01 (EditorPage god component decomposition) -- fully addressed. EditorPage reduced from ~859 to ~587 lines. All 5 extracted hooks are under 140 lines. Incidentally addresses part of F-13 (sidebar magic numbers now exported as named constants from `useSidebarState`).
- **Not yet implemented:** F-02 through F-15 remain open (peer service coupling, velocity fan-out, stringly-typed discriminated unions, misplaced `createChapter`, shotgun surgery for chapter statuses, no structured logging, velocity error swallowing, STATUS_COLORS magic strings, no UUID validation on routes, dead backward-compat exports, `.catch(() => {})` patterns, sidebar magic number imports in `Sidebar.tsx`, temporal coupling on `getDb()`, global mutable DB singleton).
- **Deviations:** None. The diff is fully consistent with the architecture report's F-01 recommendation.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** 8 changed files + adjacent hooks (useProjectEditor.ts), components (Editor, Sidebar, TrashView), shared types, API client
- **Raw findings:** 21 (before verification)
- **Verified findings:** 15 (after verification)
- **Filtered out:** 6 (false positives or below threshold)
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** paad/architecture-reviews/2026-04-09-smudge-architecture-report.md
