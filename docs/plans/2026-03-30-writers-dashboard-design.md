# Phase 1: Writer's Dashboard — Design Document

**Date:** 2026-03-30
**Phase:** Roadmap Phase 1
**Status:** Design complete, ready for implementation planning

---

## Overview

Give the writer a bird's-eye view of where their manuscript stands. Three features: chapter status labels in the sidebar, a project dashboard view, and keyboard shortcuts for chapter navigation. Also includes a resizable sidebar and a refactor of Preview from an overlay into a peer tab alongside Editor and Dashboard.

**Important conventions:** All new UI strings must be added to `packages/client/src/strings.ts` — no raw string literals in components.

---

## 1. Data Model & Migration

### New table: `chapter_statuses`

A reference table enforcing valid status values via foreign key constraint.

| Column     | Type    | Constraints              |
|------------|---------|--------------------------|
| status     | text    | primary key              |
| sort_order | integer | not null                 |
| label      | text    | not null                 |

Seed rows:

| status      | sort_order | label       |
|-------------|------------|-------------|
| outline     | 1          | Outline     |
| rough_draft | 2          | Rough Draft |
| revised     | 3          | Revised     |
| edited      | 4          | Edited      |
| final       | 5          | Final       |

### Alter `chapters` table

Add column:

| Column | Type | Constraints                                       |
|--------|------|---------------------------------------------------|
| status | text | not null, default "outline" |

Backfill: all existing chapters receive `"outline"`.

**Note on FK enforcement:** SQLite cannot add FK constraints to existing columns via ALTER TABLE (would require recreating the table). Validation is enforced at the application layer: Zod schema validation in the shared package, plus a server-side check against the `chapter_statuses` table before accepting a status value. This matches the existing pattern used for title uniqueness.

### Shared package updates

- `ChapterStatus` TypeScript union type
- Updated Zod schemas to include `status` in chapter validation
- Status list derived from API response (`GET /api/chapter-statuses`); display labels also in `strings.ts` for i18n readiness

---

## 2. API Changes

### Modified endpoints

**`PATCH /api/chapters/:id`** — accepts `status` in request body. FK constraint rejects invalid values; Zod catches them early with a friendly error message. Returns updated chapter with `status` included.

**`GET /api/projects/:slug`** — each chapter in the response now includes `status` and `status_label` fields.

### New endpoints

**`GET /api/chapter-statuses`** — returns all rows from `chapter_statuses` ordered by `sort_order`. Used by the client to populate status dropdowns.

**`GET /api/projects/:slug/dashboard`** — returns:

```json
{
  "chapters": [
    {
      "id": "uuid",
      "title": "string",
      "status": "rough_draft",
      "status_label": "Rough Draft",
      "word_count": 4200,
      "updated_at": "2026-03-28T...",
      "sort_order": 1
    }
  ],
  "status_summary": {
    "outline": 3,
    "rough_draft": 5,
    "revised": 2,
    "edited": 1,
    "final": 0
  },
  "totals": {
    "word_count": 47320,
    "chapter_count": 11,
    "most_recent_edit": "2026-03-28T...",
    "least_recent_edit": "2026-02-14T..."
  }
}
```

Dashboard endpoint computes summary server-side to keep the client simple and avoid stale-data inconsistencies.

---

## 3. Sidebar — Status Badge

### Visual design

- Badge sits between chapter title and delete button (right side of row)
- Small colored dot (8px) + abbreviated text label in a compact pill shape
- Text is 11-12px, muted — visible but not competing with the chapter title

### Status colors (warm earth tones)

| Status      | Color                        |
|-------------|------------------------------|
| Outline     | Soft sage (#8B9E7C)          |
| Rough Draft | Warm terracotta (#C07850)    |
| Revised     | Dusty gold (#B8973E)         |
| Edited      | Slate blue (#6B7F94)         |
| Final       | Deep warm brown (#6B4E3D)    |

### Interaction

- Click badge opens a dropdown listing all five statuses with colored dots and full labels
- Selecting a status fires the `onStatusChange(chapterId, status)` callback (see below)
- Optimistic update — badge changes immediately, reverts on API failure with inline error

### Callback plumbing

The Sidebar component receives a new prop: `onStatusChange: (chapterId: string, status: ChapterStatus) => void`. The Sidebar does not call the API directly — consistent with existing patterns (`onSelectChapter`, `onDeleteChapter`, etc.). The `useProjectEditor` hook handles the `PATCH /api/chapters/:id` call, optimistic state update, and error rollback.

### Responsive behavior

- At narrow sidebar widths, text label hides; only colored dot + tooltip remains
- Dot alone is acceptable because hover/focus reveals the text label

### Accessibility

- Badge is a `<button>` with `aria-haspopup="listbox"` and `aria-label="Chapter status: Rough Draft"`
- Dropdown uses `<listbox>` with `<option>` roles
- Keyboard: Tab to badge, Enter/Space opens dropdown, arrow keys navigate, Enter selects, Escape closes
- Status change announced via `aria-live` region: "Chapter status changed to Revised"

---

## 4. Resizable Sidebar

The sidebar is currently fixed at ~260px. Make it resizable:

- Drag handle on the right edge (subtle vertical line / 4px hover zone)
- Resize between min-width 180px and max-width 480px
- Cursor changes to `col-resize` on hover
- Width persisted to `localStorage`, remembered across sessions
- Existing collapse toggle remains independent of width

### Accessibility

- Resize handle: focusable, arrow keys adjust width in 10px increments
- `aria-label="Resize sidebar"`, `role="separator"`, `aria-orientation="vertical"`

---

## 5. Dashboard View

The dashboard is the third tab alongside Editor and Preview in the top bar. It replaces the editor/preview area with a read-only overview.

### Prerequisite: Refactor to peer tabs

The current Preview mode is a full-screen overlay, not a peer tab. Before adding Dashboard, refactor Editor/Preview/Dashboard into true peer tabs in the header bar. All three share the same content area — selecting a tab swaps the content, no overlays. The Preview component moves from an overlay with "Back to Editor" to a tab panel. This creates clean architecture for future views.

### Empty state

When a project has zero chapters, the Dashboard tab is still accessible. It shows a graceful empty state: "No chapters yet" with the manuscript health bar showing zeroes. No table, no status summary bar.

### Layout (top to bottom)

**Manuscript health bar** — compact summary row:
- Total word count | Total chapters | Most recent edit (relative time + chapter name) | Least recent edit (relative time + chapter name)
- Single horizontal row, warm charcoal text, clean typographic data — no boxes or cards

**Status summary** — horizontal stacked bar:
- Proportional segments using the status color palette
- Each segment labeled with count
- Text legend below: "3 Outline / 5 Rough Draft / 2 Revised / 1 Edited / 0 Final"
- Visual bar gives quick progress feel; text legend ensures accessibility

**Chapter table** — main content:
- Columns: Title | Status (dot + label) | Word Count | Last Edited
- Default sort: manuscript order (sort_order)
- Click any column header to sort (toggle ascending/descending)
- Click a chapter title to navigate to editor with that chapter loaded
- Chapter titles styled as links (underline on hover, warm accent color)
- Zebra striping or subtle row borders for readability
- No inline editing — orientation only

### Typography

Same warm aesthetic as the rest of Smudge. Generous row padding, warm tones, no harsh grid lines. Should feel like a manuscript table of contents with metadata, not a spreadsheet.

---

## 6. Chapter Navigation Shortcuts

### Key bindings

- `Ctrl/Cmd + Shift + ArrowUp` — previous chapter (by sort_order)
- `Ctrl/Cmd + Shift + ArrowDown` — next chapter (by sort_order)
- At first/last chapter, the shortcut does nothing (no wrap-around)

Uses `Ctrl+Shift` rather than `Ctrl` alone to avoid conflicting with the standard paragraph navigation shortcuts (`Ctrl+↑/↓`) that writers use in the TipTap editor. This is consistent with the existing shortcut convention (`Ctrl+Shift+N`, `Ctrl+Shift+P`, `Ctrl+Shift+\`).

### Save-then-switch

Triggers the same forced-save behavior as clicking a chapter in the sidebar: flush pending debounced auto-save, wait for confirmation, then switch. If save fails, switch is blocked and save-failure warning appears.

### Scope

- Only active when Editor tab is selected (not Preview or Dashboard)
- Disabled when focus is inside a modal/dialog

### Discoverability

- Shortcuts documented in the existing keyboard help dialog (Ctrl+/)
- Screen reader announcement on switch: "Navigated to Chapter 4: The Marketplace"

---

## 7. Testing Strategy

### Server (Vitest + Supertest)

- Migration: `chapter_statuses` table seeded correctly, FK constraint rejects invalid status values
- `PATCH /api/chapters/:id` — accepts valid status, rejects invalid with 400
- `GET /api/projects/:slug` — chapters include `status` field
- `GET /api/projects/:slug/dashboard` — correct chapter list, status summary counts, totals
- `GET /api/chapter-statuses` — returns all statuses in sort_order
- Edge cases: dashboard with zero chapters, all chapters in one status, soft-deleted chapters excluded

### Client (Vitest)

- Sidebar status badge: renders correct color and label, dropdown opens/closes, selecting a status calls API
- Dashboard view: renders health bar, status summary bar, chapter table with sorting
- Chapter navigation: Ctrl+Shift+Arrow triggers save-then-switch, blocked at first/last, disabled outside editor tab
- Sidebar resize: drag changes width, persists to localStorage, respects min/max bounds

### E2e (Playwright)

- Change chapter status from sidebar, verify persistence after reload
- Open dashboard, verify chapter table matches sidebar, click chapter title to navigate to editor
- Use Ctrl+Shift+ArrowDown to navigate through chapters, verify content switches
- aXe-core audit on dashboard view and sidebar with status badges

### Methodology

Red-green-refactor throughout — tests written before implementation for each feature slice.
