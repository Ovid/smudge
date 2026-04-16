# Phase 4b: Snapshots & Find-and-Replace — Design Document

**Date:** 2026-04-16
**Phase:** 4b (split into 4b-i and 4b-ii)
**Status:** Design complete
**Depends on:** MVP (TipTap editor), Phase 4a (slide-out panel pattern)

---

## Overview

Phase 4b delivers two features in two sub-phases shipped independently:

**4b-i: Snapshots** — Manual point-in-time copies of chapter content. Writers create labeled snapshots, browse history via a slide-out panel (clock icon in editor toolbar), view snapshots in the editor viewport (read-only with banner), and restore with one click. Every restore auto-creates a "before restore" snapshot. No hard limits on snapshot count; the UI shows the count so writers can self-manage.

**4b-ii: Find-and-Replace** — Project-wide search and replace, opened via Ctrl/Cmd+H in a right slide-out panel. Literal search by default with match-case, whole-word, and regex toggle options. Results grouped by chapter with surrounding context. Replace one, replace all in chapter, replace all in manuscript. Server executes replacements in a single transaction. Before any replace-all, auto-snapshots every affected chapter. If the current chapter was affected, the editor reloads from the server.

The dependency is one-way: find-and-replace depends on snapshots (for the auto-snapshot safety net), but snapshots are independently useful.

**Also included:** Ctrl/Cmd+S interception to prevent the browser's "Save Page" dialog and flush any pending auto-save.

---

## Data Model

### New table: `chapter_snapshots`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `chapter_id` | UUID | FK -> chapters, NOT NULL |
| `label` | TEXT | Nullable. Manual snapshots get writer-provided labels; auto-snapshots get generated labels like "Before restore to 'v2 — after structural edit'" or "Before find-and-replace: 'suddenly' -> 'quietly'" |
| `content` | TEXT | TipTap JSON at time of snapshot |
| `word_count` | INTEGER | Computed at snapshot creation via shared `countWords()` |
| `is_auto` | BOOLEAN | `false` for manual, `true` for auto-generated (restore, find-and-replace). Auto-snapshots are styled differently in the UI. |
| `created_at` | TEXT | ISO timestamp |

**Indexes:**
- `(chapter_id, created_at)` — snapshot listing is always per-chapter, ordered by date

**Soft delete:** Snapshots do NOT use soft delete. When a chapter is hard-purged (30-day trash expiry), its snapshots are cascade-deleted. Snapshots of soft-deleted chapters remain in the DB so they survive if the chapter is restored.

**No additional migration needed for find-and-replace** — it operates on existing chapter content and uses the snapshot table for safety.

---

## API: Snapshots (4b-i)

### `POST /api/chapters/:id/snapshots`

Create a manual snapshot from the chapter's current content.

- **Body:** `{ "label"?: string }`
- **Returns:** 201 with the created snapshot (id, label, word_count, created_at, is_auto: false)
- **Errors:** 404 if chapter not found or soft-deleted

### `GET /api/chapters/:id/snapshots`

List all snapshots for a chapter, newest first.

- **Returns:** Array of snapshots (id, label, word_count, is_auto, created_at). Content excluded for list performance.
- **Errors:** 404 if chapter not found

### `GET /api/snapshots/:id`

Get a single snapshot including full content (for viewing).

- **Returns:** Full snapshot object with content
- **Errors:** 404 if not found

### `DELETE /api/snapshots/:id`

Hard-delete a snapshot. Writers manage their own history.

- **Returns:** 204 on success
- **Errors:** 404 if not found

### `POST /api/snapshots/:id/restore`

Restore a snapshot to its chapter. In a single transaction:
1. Auto-snapshot the chapter's current content with label "Before restore to '[snapshot label/date]'"
2. Replace chapter content with snapshot content
3. Recalculate word_count
4. Diff old vs. new image IDs and adjust image reference counts (same pattern as `updateChapter`)

- **Returns:** 200 with the updated chapter
- **Errors:** 404 if snapshot or its chapter not found

---

## API: Find-and-Replace (4b-ii)

### `POST /api/projects/:id/search`

Search across all chapters in a project.

- **Body:** `{ "query": string, "options"?: { "case_sensitive"?: boolean, "whole_word"?: boolean, "regex"?: boolean } }`
- **Returns:**
  ```json
  {
    "total_count": 17,
    "chapters": [
      {
        "chapter_id": "...",
        "chapter_title": "The Arrival",
        "matches": [
          {
            "index": 0,
            "context": "...she suddenly realized...",
            "position": { "node_path": [...], "offset": 12 }
          }
        ]
      }
    ]
  }
  ```
- Searches the text content of TipTap JSON (walking the document tree), not the raw JSON string. For each block-level node (paragraph, heading, etc.), text node contents are concatenated into a plain string for searching — this ensures matches that span formatting boundaries (e.g., a word split across bold/non-bold text nodes) are found correctly.
- **Errors:** 404 if project not found, 400 if regex is invalid

### `POST /api/projects/:id/replace`

Replace across chapters. In a single transaction: find all affected chapters, auto-snapshot each, perform replacements in TipTap JSON text nodes (using the same flattened-text-per-block approach as search, with results mapped back onto the original node structure preserving marks), recalculate word counts. Also adjusts image reference counts for any affected chapters (same pattern as `updateChapter`).

- **Body:** `{ "search": string, "replace": string, "options"?: { "case_sensitive"?: boolean, "whole_word"?: boolean, "regex"?: boolean }, "scope": { "type": "project" } | { "type": "chapter", "chapter_id": string } }`
- **Returns:** `{ "replaced_count": 17, "affected_chapter_ids": ["...", "..."] }`
- **Errors:** 404 if project not found, 400 if regex is invalid or search is empty

### Replace-one

Handled client-side: when the writer clicks "Replace" on a match, the client locates the match in the live editor content (using the search term and surrounding context, not stored offsets) and applies the replacement there. If the match can't be found because the content has changed since the search, the client shows "Match no longer found — try searching again." The replacement is then saved via the normal auto-save PATCH path. No special API needed.

---

## UI: Snapshot Panel (4b-i)

### Entry point

A clock icon button in the editor toolbar. Badge shows snapshot count for the current chapter (e.g., a small "3" indicator). Clicking toggles a slide-out panel from the right side, same pattern as the reference panel from Phase 4a.

### Panel contents

- **Header:** "Snapshots" with a "Create Snapshot" button
- **Create flow:** Clicking "Create Snapshot" shows an inline text input for an optional label, with Save/Cancel. Empty label is fine — the snapshot just shows the date.
- **Snapshot list:** Chronological, newest first. Each entry shows:
  - Label (or "Untitled snapshot" in lighter text if none)
  - Date/time (relative: "2 hours ago", with full date on hover)
  - Word count
  - Auto-snapshots styled subtly differently (e.g., italic label, or a small "auto" tag) so writers can distinguish intentional saves from system-generated ones
  - Actions: "View" and "Delete" buttons (delete has confirmation)
- **Snapshot count** at the top: "12 snapshots (8 manual, 4 auto)" — gives writers visibility for self-managing

### View mode

Clicking "View" replaces the editor with a read-only render of the snapshot content. A banner across the top shows: "Viewing snapshot: [label] — [date]" with two buttons: "Restore" and "Back to editing". The snapshot panel stays open so the writer can flip between snapshots easily.

### Restore flow

Clicking "Restore" shows a confirmation: "Replace current chapter content with this snapshot? A snapshot of your current content will be saved automatically." Confirm executes the restore.

---

## UI: Find-and-Replace Panel (4b-ii)

### Entry point

Ctrl/Cmd+H opens a slide-out panel from the right (same pattern as snapshots and reference panel). Also accessible from a toolbar icon (magnifying glass).

### Panel layout (top to bottom)

- **Search input** — text field, autofocused on open. Typing starts searching after a short debounce (~300ms). Enter also triggers search.
- **Replace input** — text field directly below. Empty by default (search-only mode effectively).
- **Option toggles** — small icon buttons in a row: Match Case (Aa), Whole Word (ab|), Regex (.*)
- **Results summary** — "Found 17 occurrences in 8 chapters" (or "No matches found")
- **Results list** — grouped by chapter:
  - Chapter title as a header with match count: "Chapter 3: The Arrival (5 matches)"
  - Each match shows surrounding context (~40 chars each side) with the match highlighted
  - Per-match: a "Replace" button (replaces just that one via client-side PATCH)
  - Per-chapter: a "Replace All in Chapter" button
- **Footer actions** — "Replace All in Manuscript" button, visually distinct (destructive action styling). Confirmation dialog before executing: "Replace 17 occurrences of '[search]' with '[replace]' across 8 chapters? Snapshots of all affected chapters will be created automatically."

### After replace-all

Results refresh to show the new state (should be zero matches). If the currently open chapter was affected, editor content reloads from the server.

### Keyboard flow

Ctrl/Cmd+H opens panel -> cursor in search field -> type query -> Tab to replace field -> Enter triggers "Replace All in Manuscript" (with confirmation).

---

## Ctrl/Cmd+S Interception

Intercept Ctrl/Cmd+S app-wide (registered on the window/document level, not just the editor) to prevent the browser's "Save Page" dialog regardless of what has focus. Behavior:
- If there are pending unsaved changes, flush the auto-save immediately
- If content is already saved, no-op (optionally show a brief "Already saved" indication)
- Does NOT create a snapshot — save and snapshot are separate concepts

Included in 4b-i as a small addition alongside snapshot work.

---

## Error Handling & Edge Cases

### Snapshots

- **Duplicate snapshot guard** — before creating any snapshot (manual or auto), compare a content hash against the most recent snapshot for that chapter. If identical, skip creation. Prevents accidental duplicates from double-clicks or auto-snapshot when content hasn't changed.
- **Snapshot of empty chapter** — allowed. A writer might snapshot before deleting all content to start fresh.
- **Restore to a modified chapter** — the auto-snapshot captures whatever is currently saved. Force-save-before-restore (same pattern as chapter switching) ensures pending edits are flushed first.
- **Snapshot of soft-deleted chapter** — not exposed in UI (deleted chapters aren't in the editor). Snapshots survive soft-delete and are available if the chapter is restored.
- **Deleting a snapshot** — hard delete, no undo. Confirmation dialog makes this clear.

### Find-and-Replace

- **Invalid regex** — validated server-side, returns 400. Client shows inline error below the search field: "Invalid regular expression: [details]"
- **Replace with empty string** — allowed. Common use case: deleting a recurring phrase.
- **No matches** — "No matches found" message, replace buttons disabled.
- **Replace-all affects currently open chapter** — client force-saves pending edits first, then server performs replacement, then client reloads chapter content from server.
- **Large manuscripts** — search is server-side on SQLite, so even large projects should be fast. TipTap JSON walking happens in-process. No pagination needed initially.
- **Concurrent auto-save during replace-all** — the force-save before replace ensures the server has the latest content. The transaction lock prevents interleaving.

---

## Accessibility

### Snapshot panel

- Panel is an `<aside>` landmark with `aria-label="Chapter snapshots"`
- Snapshot list is a `<ul>` with each snapshot as a `<li>`
- "Create Snapshot" button and label input are properly labeled
- View mode banner uses `role="status"` so screen readers announce the state change
- Restore confirmation is a `<dialog>` with focus trapped inside
- Clock icon button has `aria-label="Snapshots (3)"` with live count

### Find-and-replace panel

- Panel is an `<aside>` with `aria-label="Find and replace"`
- Search and replace inputs have visible `<label>` elements
- Option toggles are `<button>` elements with `aria-pressed` state
- Results summary ("Found 17 occurrences in 8 chapters") is an `aria-live="polite"` region, announced when results update
- Results list uses headings per chapter for structure
- Replace confirmation dialog uses `<dialog>` with focus trap
- Ctrl/Cmd+H and Escape for open/close

### Both panels

- Full keyboard navigation: Tab through controls, Escape closes panel
- Focus moves to the panel when opened, returns to the trigger button when closed
- Visible focus indicators on all interactive elements
- `prefers-reduced-motion` respected for panel slide animation

---

## Testing Strategy

### 4b-i Snapshots — Server

- **Repository:** CRUD operations, cascade behavior on chapter purge, ordering (newest first)
- **Service:** manual snapshot creation, auto-snapshot on restore, word count calculation, content replacement on restore
- **Routes:** 201/200/204/404 responses, validation (label is optional, snapshot exists, chapter exists)
- **Integration:** restore flow end-to-end (auto-snapshot created, content replaced, word count updated, image reference counts adjusted)

### 4b-i Snapshots — Client

- Snapshot panel: renders list, create flow with optional label, delete with confirmation
- View mode: read-only render with banner, "Back to editing" returns to editor
- Restore: confirmation dialog, editor reloads after restore
- Clock icon badge shows correct count

### 4b-ii Find-and-Replace — Server

- **Search:** TipTap JSON text node walking, case/whole-word/regex options, results grouped by chapter, context extraction
- **Replace:** transaction atomicity (snapshots + replacements all-or-nothing), word count recalculation, affected chapter IDs returned
- **Edge cases:** invalid regex returns 400, empty replace string works, no-match returns zero

### 4b-ii Find-and-Replace — Client

- Panel: search triggers on input, results grouped by chapter, match highlighting
- Replace-one via client-side PATCH
- Replace-all: confirmation dialog, force-save before request, editor reloads if current chapter affected
- Option toggles: match case, whole word, regex

### Ctrl/Cmd+S

- Intercepts browser save, flushes pending auto-save

### E2e (Playwright)

- Create snapshot -> view -> restore flow
- Find-and-replace across chapters with auto-snapshot verification
- aXe audit on both panels
