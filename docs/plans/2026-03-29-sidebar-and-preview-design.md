# Sidebar + Chapter Management & Preview Mode Design

Date: 2026-03-29
Status: Approved (updated after pushback review)
Addresses: UAT failures C3, C4, C5, C6, R1-R4, Ctrl+Shift+\, Ctrl+Shift+P

## Overview

Two workstreams to resolve the remaining UAT failures. Sidebar comes first because preview depends on the chapter list data flow that sidebar establishes.

## Workstream 1: Sidebar + Chapter Management

### Layout Change

EditorPage changes from single-column to two-panel:

- **Sidebar (`<aside>`)** -- ~260px, left side, collapsible via Ctrl+Shift+\. Contains: project title, ordered chapter list, "Add Chapter" button at bottom. Scrollable when chapters exceed viewport. ARIA landmark with `aria-label="Chapters"`.
- **Editor (`<main>`)** -- takes remaining width, same centered 720px content area as today.

Collapsing hides the sidebar completely and gives the editor full width. State is kept in React state (not persisted -- always starts expanded).

### New Server Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/chapters/:id` | DELETE | Soft delete (sets `deleted_at`) |
| `/api/projects/:id/chapters/order` | PUT | Accepts full ordered array of chapter IDs, rejects on mismatch |
| `/api/projects/:id/trash` | GET | Returns soft-deleted chapters for the project |
| `/api/chapters/:id/restore` | POST | Restores a chapter (and parent project if also deleted) |

The chapter create route (`POST /api/projects/:id/chapters`) already exists.

Note: restore uses `/api/chapters/:id/restore` (not `/api/trash/:id/restore`) to stay consistent with the existing chapters router and make the target entity unambiguous.

### Prerequisites

The following dependencies must be installed before implementation:

- **`@dnd-kit/sortable` v10** (legacy, stable) -- for drag-and-drop chapter reordering. The spec explicitly chose this over the newer `@dnd-kit/react` (pre-1.0) due to stability. Migration to the new version should be evaluated when it reaches 1.0.

### Sidebar Component

`Sidebar.tsx` receives props from EditorPage:

- `project: ProjectWithChapters`
- `activeChapterId: string`
- `onSelectChapter: (id: string) => void`
- `onAddChapter: () => void`
- `onDeleteChapter: (chapter: Chapter) => void`
- `onReorderChapters: (orderedIds: string[]) => void`

Chapter list uses **@dnd-kit/sortable** (v10). Each chapter item shows:
- Drag handle icon (visible on hover)
- Chapter title (clickable to select)
- Active chapter highlighted with accent background
- Delete button (trash icon, right side)

**Keyboard reordering:** When a chapter is focused, Alt+Up/Down moves it in the list. A live region announces the new position: "Chapter 'The Betrayal' moved to position 3 of 7".

**Chapter switching and auto-save:** When the user clicks a different chapter, EditorPage flushes any pending auto-save immediately (bypass debounce) before loading the new chapter. Non-blocking -- fire the save, load the new chapter optimistically. The Editor component tracks a dirty flag so it only saves when content has actually changed, avoiding redundant PATCH requests on chapter switch.

**Delete confirmation:** Opens a `<dialog>` with focus trapping: "Move 'Chapter 3: The Betrayal' to trash? You can restore it within 30 days." Same pattern as existing project delete confirmation on HomePage.

### Trash/Restore UI

A "Trash" link at the bottom of the sidebar, below the chapter list. Clicking it replaces the editor area with a trash view (state toggle within EditorPage, not a new route).

Trash view shows:
- List of soft-deleted chapters for the current project, with deletion date
- "Restore" button per item (calls `POST /api/chapters/:id/restore`)

No manual permanent delete for MVP. Auto-purge on server startup handles items older than 30 days.

### Auto-Purge

On server startup (after `initDb()`), run cleanup queries:
- `DELETE FROM chapters WHERE deleted_at < datetime('now', '-30 days')`
- `DELETE FROM projects WHERE deleted_at < datetime('now', '-30 days')`

This fulfills the spec's 30-day auto-purge requirement and completes the trash story without manual permanent delete.

## Workstream 2: Preview Mode

### Approach

Preview replaces the entire editor area as a full-screen overlay -- no sidebar, no toolbar, no status bar. Two ways to enter: Ctrl+Shift+P or a "Preview" button in the editor header.

### Prerequisites

- **`@tiptap/html`** -- must be installed for `generateHTML()`.
- **Shared extension config** -- extract the editor's TipTap extension list into a shared constant (e.g., `editorExtensions.ts`) that both `Editor.tsx` and the preview component import. This prevents silent rendering bugs if the extension lists diverge.

### Content Rendering

All non-deleted chapters fetched from `ProjectWithChapters`, rendered sequentially as HTML. Each chapter gets its title as an `<h2>` heading with clear visual separation (generous spacing between chapters). TipTap's `generateHTML()` converts stored JSON to HTML on the client side, using the shared extension config.

### Typography

Serif font (same family as editor), distinct styling: ~680px max-width, generous line-height (1.8-2.0), clean background without chrome. Goal: feel like reading a printed manuscript.

### TOC Panel

Fixed-position on the right side, collapsible. Lists all chapter titles as anchor links. Uses `IntersectionObserver` to highlight the chapter currently in view as the user scrolls.

### Returning to Editor

- "Back to Editor" button is the first focusable element
- Escape key closes preview
- Clicking any chapter heading in the preview body returns to editor with that chapter active

## Architecture: EditorPage Refactor

Before adding the sidebar, extract EditorPage's state management into a custom hook:

**`useProjectEditor(projectId)`** encapsulates:
- Project and chapter loading
- Active chapter selection and switching
- Save status and dirty tracking
- Chapter CRUD callbacks (create, delete, reorder)
- Word count

EditorPage becomes a thin layout shell that wires the hook to Sidebar, Editor, Preview, and TrashView. This keeps each phase manageable and makes the sidebar/preview work cleaner to test.

## Implementation Order

### Phase 1: Server Routes + Prerequisites

No frontend dependencies between these -- can be built and tested independently.

1. Install `@dnd-kit/sortable` v10 and `@tiptap/html`
2. `DELETE /api/chapters/:id` (soft delete)
3. `PUT /api/projects/:id/chapters/order` (reorder)
4. `GET /api/projects/:id/trash` (list trashed chapters)
5. `POST /api/chapters/:id/restore` (restore from trash)
6. Auto-purge on server startup (30-day cleanup)
7. API client methods for all new routes

### Phase 2: Sidebar + Chapter Management

8. Extract `useProjectEditor` hook from EditorPage
9. Add dirty flag to Editor component (skip save when content unchanged)
10. Extract shared TipTap extension config (`editorExtensions.ts`)
11. Sidebar component with chapter list, selection, and "Add Chapter"
12. EditorPage layout change (two-panel with sidebar)
13. Chapter switching with auto-save flush
14. Drag-and-drop reorder (@dnd-kit/sortable)
15. Alt+Up/Down keyboard reorder with live region announcements
16. Chapter delete with confirmation dialog
17. Trash view in sidebar
18. Ctrl+Shift+\ toggle sidebar

### Phase 3: Preview Mode

19. Preview page component with sequential chapter rendering via `generateHTML()`
20. Reading typography and layout
21. TOC panel with IntersectionObserver scroll tracking
22. Click-chapter-heading to return to editor
23. Ctrl+Shift+P toggle preview

### Phase 4: Cleanup

24. Update Ctrl+/ help dialog to show all shortcuts as functional
25. Verify all UAT failures resolved

Each phase is independently testable.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Permanent delete in trash | No (auto-purge only) | Simpler, less risk of accidental data loss, auto-purge covers cleanup |
| Sidebar collapse persistence | Not persisted (always starts expanded) | YAGNI for single-user MVP |
| Preview as overlay vs route | Overlay (state toggle) | Avoids navigation complexity, keeps chapter data in memory |
| Trash as view vs route | State toggle within EditorPage | Same rationale as preview |
| dnd-kit version | @dnd-kit/sortable v10 (legacy) | Stable, battle-tested, good a11y. Evaluate new @dnd-kit/react when it reaches 1.0 |
| Restore route path | `/api/chapters/:id/restore` | Stays in existing chapters router, entity type is unambiguous |
| generateHTML dependency | `@tiptap/html` with shared extension config | Prevents silent rendering divergence between editor and preview |
| Editor save-on-blur | Add dirty flag, only save when changed | Avoids redundant PATCH on every chapter switch |
| EditorPage complexity | Extract `useProjectEditor` hook before sidebar work | Keeps phases manageable, improves testability |
