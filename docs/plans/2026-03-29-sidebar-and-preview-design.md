# Sidebar + Chapter Management & Preview Mode Design

Date: 2026-03-29
Status: Approved
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
| `/api/trash/:id/restore` | POST | Restores a chapter (and parent project if also deleted) |

The chapter create route (`POST /api/projects/:id/chapters`) already exists.

### Sidebar Component

`Sidebar.tsx` receives props from EditorPage:

- `project: ProjectWithChapters`
- `activeChapterId: string`
- `onSelectChapter: (id: string) => void`
- `onAddChapter: () => void`
- `onDeleteChapter: (chapter: Chapter) => void`
- `onReorderChapters: (orderedIds: string[]) => void`

Chapter list uses **@dnd-kit/sortable** (v10, per spec). Each chapter item shows:
- Drag handle icon (visible on hover)
- Chapter title (clickable to select)
- Active chapter highlighted with accent background
- Delete button (trash icon, right side)

**Keyboard reordering:** When a chapter is focused, Alt+Up/Down moves it in the list. A live region announces the new position: "Chapter 'The Betrayal' moved to position 3 of 7".

**Chapter switching and auto-save:** When the user clicks a different chapter, EditorPage flushes any pending auto-save immediately (bypass debounce) before loading the new chapter. Non-blocking -- fire the save, load the new chapter optimistically. The Editor component already handles immediate save on blur, so trigger blur before switching.

**Delete confirmation:** Opens a `<dialog>` with focus trapping: "Move 'Chapter 3: The Betrayal' to trash? You can restore it within 30 days." Same pattern as existing project delete confirmation on HomePage.

### Trash/Restore UI

A "Trash" link at the bottom of the sidebar, below the chapter list. Clicking it replaces the editor area with a trash view (state toggle within EditorPage, not a new route).

Trash view shows:
- List of soft-deleted chapters for the current project, with deletion date
- "Restore" button per item (calls `POST /api/trash/:id/restore`)

No manual permanent delete for MVP. Auto-purge on server startup handles items older than 30 days.

## Workstream 2: Preview Mode

### Approach

Preview replaces the entire editor area as a full-screen overlay -- no sidebar, no toolbar, no status bar. Two ways to enter: Ctrl+Shift+P or a "Preview" button in the editor header.

### Content Rendering

All non-deleted chapters fetched from `ProjectWithChapters`, rendered sequentially as HTML. Each chapter gets its title as an `<h2>` heading with clear visual separation (generous spacing between chapters). TipTap's `generateHTML()` converts stored JSON to HTML on the client side.

### Typography

Serif font (same family as editor), distinct styling: ~680px max-width, generous line-height (1.8-2.0), clean background without chrome. Goal: feel like reading a printed manuscript.

### TOC Panel

Fixed-position on the right side, collapsible. Lists all chapter titles as anchor links. Uses `IntersectionObserver` to highlight the chapter currently in view as the user scrolls.

### Returning to Editor

- "Back to Editor" button is the first focusable element
- Escape key closes preview
- Clicking any chapter heading in the preview body returns to editor with that chapter active

## Implementation Order

### Phase 1: Server Routes

No frontend dependencies between these -- can be built and tested independently.

1. `DELETE /api/chapters/:id` (soft delete)
2. `PUT /api/projects/:id/chapters/order` (reorder)
3. `GET /api/projects/:id/trash` (list trashed chapters)
4. `POST /api/trash/:id/restore` (restore from trash)
5. API client methods for all four

### Phase 2: Sidebar + Chapter Management

6. Sidebar component with chapter list, selection, and "Add Chapter"
7. EditorPage layout change (two-panel with sidebar)
8. Chapter switching with auto-save flush
9. Drag-and-drop reorder (@dnd-kit/sortable)
10. Alt+Up/Down keyboard reorder with live region announcements
11. Chapter delete with confirmation dialog
12. Trash view in sidebar
13. Ctrl+Shift+\ toggle sidebar

### Phase 3: Preview Mode

14. `generateHTML()` integration for TipTap JSON to HTML
15. Preview page component with sequential chapter rendering
16. Reading typography and layout
17. TOC panel with IntersectionObserver scroll tracking
18. Click-chapter-heading to return to editor
19. Ctrl+Shift+P toggle preview

### Phase 4: Cleanup

20. Update Ctrl+/ help dialog to show all shortcuts as functional
21. Verify all UAT failures resolved

Each phase is independently testable.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Permanent delete in trash | No (auto-purge only) | Simpler, less risk of accidental data loss, auto-purge covers cleanup |
| Sidebar collapse persistence | Not persisted (always starts expanded) | YAGNI for single-user MVP |
| Preview as overlay vs route | Overlay (state toggle) | Avoids navigation complexity, keeps chapter data in memory |
| Trash as view vs route | State toggle within EditorPage | Same rationale as preview |
