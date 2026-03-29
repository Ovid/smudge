# UAT Report — 2026-03-29

Tested against: MVP spec (`docs/plans/mvp.md`)
Branch: `ovid/mvp`

## PASSED (14)

1. **P1** — Create project with title: Works, navigates to editor with first chapter auto-created
2. **P2** — Fiction/non-fiction mode selector at creation: Present, fiction pre-selected
3. **P3** — Home screen shows title, mode, word count, last-edited date (sorted by most recent)
4. **P4** — Project title editable via double-click in editor header, saves on Enter
5. **C1** — New chapter created with default "Untitled Chapter" title, appended to end
6. **C2** — Chapter title editable via double-click in editor, saves on Enter, cancels on Escape
7. **W1** — Formatting toolbar: Bold, Italic, H1-H3, Quote, List, Numbered, Horizontal Rule
8. **W2** — Auto-save with 1.5s debounce: content survives full page reload without blur
9. **W3** — Save status indicator in status bar: "Saving...", "Saved", error state
10. **W4** — Chapter word count in status bar, updates live as you type
11. **W5** — Total word count correct on home page (server-side recalculation via shared `countWords`)
12. **W6** — Browser-native spell check active in editor
13. **Visual** — Warm earth tones (#FAF8F5 background), serif editor font, amber accent buttons, centered 720px editor
14. **A11y** — Status bar uses `role="status"` + `aria-live="polite"`, toolbar has `role="toolbar"`, editor has correct ARIA attributes

## FAILED / NOT IMPLEMENTED (8)

1. **P5** — No project delete button or UI (soft delete not exposed)
2. **C3** — No chapter reorder (no sidebar exists for drag-and-drop or Alt+Up/Down)
3. **C4** — No chapter delete button
4. **C5** — No sidebar with chapter list or "Add Chapter" button. Only one chapter per project is accessible.
5. **C6** — No trash/restore UI (server supports soft delete but no frontend for it)
6. **R1-R4** — No preview mode at all (no preview button, no manuscript read-through, no TOC)
7. **Keyboard shortcuts** — None of the 4 Smudge-specific shortcuts are implemented (Ctrl+Shift+P, Ctrl+Shift+N, Ctrl+Shift+\, Ctrl+/)
8. **A11y (minor)** — Project and chapter title headings have `title="Double-click to edit"` which leaks into the accessible name via the `title` attribute. `aria-label` was added to chapter title but screen readers may still announce the tooltip.

## Fixes Applied During UAT

All fixes followed RED/GREEN/REFACTOR via `paad:vibe`:

1. **Auto-save debounce** — Added `onUpdate` handler to TipTap editor with 1.5s debounce timer. Blur triggers immediate save (cancels pending debounce). Content no longer lost on reload.
2. **Status bar** — Added `<footer role="status" aria-live="polite">` to EditorPage with word count (left) and save status (right). Fixed position at bottom of viewport.
3. **Shared `countWords()` function** — Created `packages/shared/src/wordcount.ts` using `Intl.Segmenter` with `granularity: 'word'`. Walks TipTap JSON tree to extract text nodes.
4. **Live word count** — Added `onContentChange` callback to Editor component, EditorPage uses it with `countWords()` for real-time display.
5. **Server-side word count** — Updated chapter PATCH route to recalculate `word_count` using shared `countWords()` on every content save.
6. **Project title editable** — Added double-click editing on project title in header, with Enter to save and Escape to cancel. Added `PATCH /api/projects/:id` server route.
7. **Home page last-edited date** — Added `lastEdited()` string formatter, displays "Edited 29 Mar 2026" style dates.
8. **Horizontal Rule button** — Added HR button to editor toolbar (uses StarterKit's built-in HorizontalRule extension).
9. **`aria-label` on chapter title** — Ensures screen readers announce the actual title, not the tooltip text.

## Test Results

- 106 tests pass across 16 test files (shared: 19, server: 40, client: 47)
- 0 test failures
- Pre-existing lint issues (16 errors, unrelated to UAT changes)

## Recommended Next Steps (priority order)

1. **Sidebar** — Chapter list, Add Chapter button, chapter delete, drag-and-drop reorder. This is the biggest blocker for multi-chapter writing.
2. **Preview mode** — Full manuscript read-through with TOC. Writers need to read what they've written.
3. **Trash/restore UI** — The server already supports soft delete; just needs a frontend view.
4. **Keyboard shortcuts** — The 4 Smudge-specific shortcuts from the spec.
