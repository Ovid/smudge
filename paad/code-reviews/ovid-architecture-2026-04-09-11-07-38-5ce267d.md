# Agentic Code Review: ovid/architecture

**Date:** 2026-04-09 11:07:38
**Branch:** ovid/architecture -> main
**Commit:** 5ce267d25f91fb98e0099b9c52e1c12eb25b9d28
**Files changed:** 13 | **Lines changed:** +1184 / -386
**Diff size category:** Large

## Executive Summary

This branch decomposes the monolithic `EditorPage` component (859 lines) into 5 focused hooks and 1 new component, addressing architecture finding F-01. The refactoring is clean and well-structured. One Important bug was found: a blur-event race condition in `useChapterTitleEditing` that can rename the wrong chapter when the user navigates away while the title input is focused. Six suggestions were also identified. Overall the decomposition is solid and the core save pipeline remains correctly guarded.

## Critical Issues

None found.

## Important Issues

### [I1] Blur race can rename the wrong chapter
- **File:** `packages/client/src/hooks/useChapterTitleEditing.ts:21-24,35-60`
- **Bug:** When a user is editing Chapter A's title and navigates to Chapter B (via keyboard shortcut or sidebar click), the title input loses focus. The `onBlur` handler fires `saveTitle()` synchronously. By this point, React has committed the `activeChapter` state update to Chapter B, but the `useEffect` that resets `editingTitle = false` (line 21-24) hasn't run yet (effects are asynchronous, post-paint). So `saveTitle()` reads `activeChapter` as Chapter B and calls `handleRenameChapter(chapterB.id, chapterA_draft)` -- renaming Chapter B with Chapter A's title text.
- **Impact:** Silent data corruption -- a chapter gets renamed with another chapter's draft title. Normal user workflow (edit title, click different chapter) triggers this.
- **Suggested fix:** Capture the chapter ID at `startEditingTitle` time into a ref, and guard `saveTitle` against it:
  ```typescript
  const editingChapterIdRef = useRef<string | null>(null);
  
  function startEditingTitle() {
    if (!activeChapter) return;
    editingChapterIdRef.current = activeChapter.id;
    // ... rest unchanged
  }
  
  async function saveTitle() {
    // ... existing guards ...
    if (!activeChapter || activeChapter.id !== editingChapterIdRef.current) {
      setEditingTitle(false);
      return;
    }
    // ... rest unchanged
  }
  ```
- **Confidence:** High
- **Found by:** Concurrency & State

## Suggestions

### [S1] confirmDeleteChapter closes dialog on failure
- **File:** `packages/client/src/hooks/useTrashManager.ts:56-59`
- **Bug:** `confirmDeleteChapter` unconditionally calls `setDeleteTarget(null)` after `await handleDeleteChapter(deleteTarget)`. Since `handleDeleteChapter` catches errors internally (sets full-page error overlay) and never re-throws, the dialog always closes -- even on failure. The user sees the full-page error overlay but can't retry from the dialog.
- **Suggested fix:** Have `handleDeleteChapter` return a success boolean, and only close the dialog on success.
- **Confidence:** Medium
- **Found by:** Logic & Correctness, Error Handling

### [S2] actionError banner not auto-cleared on subsequent success
- **File:** `packages/client/src/pages/EditorPage.tsx:180-185`
- **Bug:** `handleRenameChapterWithError` passes `setActionError` as the `onError` callback for sidebar renames. A failed rename sets the error banner, but there is no path that clears it on a subsequent successful rename. The banner persists until the user manually dismisses it.
- **Suggested fix:** Clear `actionError` on success in the wrapper, or give sidebar renames their own error channel.
- **Confidence:** Medium
- **Found by:** Contract & Integration

### [S3] Ctrl+/ fires when title input is focused
- **File:** `packages/client/src/hooks/useKeyboardShortcuts.ts:66-69`
- **Bug:** The `Ctrl+/` shortcut to toggle the help dialog has no guard for `document.activeElement` being an `<input>` or `<textarea>`. When the user is editing a chapter or project title, pressing Ctrl+/ unexpectedly opens the help dialog.
- **Suggested fix:** Add an `activeElement` check before the Ctrl+/ handler, skipping it when an input/textarea is focused.
- **Confidence:** Medium
- **Found by:** Logic & Correctness

### [S4] Duplicated flush+view-switch pattern in 3 places
- **File:** `packages/client/src/pages/EditorPage.tsx:364-385` and `packages/client/src/hooks/useKeyboardShortcuts.ts:109-117`
- **Bug:** The `flushSave + setTrashOpen(false) + setViewMode(...)` sequence is repeated in the Preview button handler, Dashboard button handler, and Ctrl+Shift+P keyboard shortcut. If the flush contract changes or a new view mode is added, all three sites must be updated in sync.
- **Suggested fix:** Extract a `switchToView(mode: ViewMode)` callback in EditorPage that encapsulates the pattern, and pass it to `useKeyboardShortcuts`.
- **Confidence:** Medium
- **Found by:** Contract & Integration

### [S5] activeChapterRef synced via useEffect instead of inline
- **File:** `packages/client/src/hooks/useProjectEditor.ts:26-28`
- **Bug:** `activeChapterRef` is synced via `useEffect` (post-paint), creating a one-render window where the ref lags behind the actual state. Other refs in the same file (e.g., `projectRef` at line 171) are synced inline during render. The inconsistency means callbacks reading `activeChapterRef.current` between render and effect could see stale data.
- **Suggested fix:** Sync the ref inline during render: `activeChapterRef.current = activeChapter;` (remove the useEffect).
- **Confidence:** Medium
- **Found by:** Concurrency & State

### [S6] Shift+letter shortcuts may not fire on non-Latin keyboard layouts
- **File:** `packages/client/src/hooks/useKeyboardShortcuts.ts:87,93,99,109`
- **Bug:** Shortcuts check `e.key === "N"`, `e.key === "W"`, `e.key === "P"`, `e.key === "\\"` while requiring `e.shiftKey`. On non-Latin layouts or some Linux configurations, `Shift+n` may produce a different character rather than uppercase `"N"`. Similarly, `Shift+\` may produce `"|"`.
- **Suggested fix:** Add case-insensitive fallbacks (e.g., `e.key.toUpperCase() === "N"`) or use `e.code` for layout-independent matching (e.g., `e.code === "KeyN"`).
- **Confidence:** Medium
- **Found by:** Logic & Correctness

## Plan Alignment

Architecture report found at `paad/architecture-reviews/2026-04-09-smudge-architecture-report.md`. This branch addresses finding **F-01** (EditorPage god component).

- **Implemented:** EditorPage decomposed into 5 focused hooks (useSidebarState, useChapterTitleEditing, useProjectTitleEditing, useTrashManager, useKeyboardShortcuts) and 1 new component (ShortcutHelpDialog). EditorPage reduced from ~859 to ~583 lines. Each extracted module is under 150 lines with a single responsibility. Also fixes handleRenameChapter to avoid full-page error overlay.
- **Not yet implemented:** F-02 through F-15 are out of scope for this branch.
- **Deviations:** None -- the decomposition follows the architecture report's recommendations.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Verifier
- **Scope:** 13 changed files + adjacent callers/callees (Editor.tsx, Sidebar.tsx, api/client.ts)
- **Raw findings:** 18 (before verification)
- **Verified findings:** 7 (after verification)
- **Filtered out:** 11 (false positives, below threshold, or subsumed)
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** paad/architecture-reviews/2026-04-09-smudge-architecture-report.md
