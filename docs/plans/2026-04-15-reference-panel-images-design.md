# Phase 4a: Reference Panel & Images — Design Document

**Date:** 2026-04-15
**Phase:** 4a
**Status:** Design complete
**Companion to:** `docs/roadmap.md` Phase 4a, Smudge MVP PRD

---

## Overview

Phase 4a adds two features to Smudge: a collapsible, resizable reference panel on the right side of the editor, and image upload/management as the panel's first tab.

**Layout change:** The editor area becomes a three-column flexbox layout: sidebar (left) | editor content (center, `flex-1`) | reference panel (right). The reference panel mirrors the sidebar's resize implementation — pixel width stored in localStorage, drag handle on its left edge, keyboard resize with Arrow keys, constrained between 240px and 480px, default 320px.

The panel is toggled via a toolbar icon in the header bar and the keyboard shortcut Ctrl+. (period). Toggle state (open/closed) and width are persisted in localStorage under keys `smudge-ref-panel-open` and `smudge-ref-panel-width`.

**Tab infrastructure:** The panel renders a tab bar at the top and a content area below. Tabs are registered declaratively — each tab provides a label, icon, and component. In this phase, there is one tab: "Images." Future phases add tabs by registering new entries (notes, characters, scenes, etc.) without modifying the panel infrastructure itself.

**Image backend:** A new `images` table tracks uploaded images with metadata (alt text, caption, source, license, reference count). Files are stored on disk at `/app/data/images/{project_id}/{uuid}.{ext}`. API endpoints handle upload, listing, metadata updates, and deletion. Images are served by database UUID (`GET /api/images/{id}`) to eliminate path traversal risks.

---

## Image Gallery Tab

The gallery tab has three zones stacked vertically within the panel:

### Upload Zone

An upload button at the top of the gallery. Clicking opens the system file picker filtered to JPEG, PNG, GIF, and WebP. Maximum file size: 10MB (enforced client-side before upload). On upload, the file is sent to `POST /api/projects/{projectId}/images` with the current project ID, stored to disk, and a database record is created. The new image appears in the grid immediately.

**Server-side upload limits:** The upload endpoint uses multer (or equivalent) with `limits.fileSize` set to 10MB. This rejects oversized uploads mid-stream rather than buffering the entire file into memory first, preventing memory exhaustion from large or malicious uploads.

### Thumbnail Grid

A responsive grid of square thumbnails, most recent first. Each thumbnail shows the image cropped to fill via CSS `object-fit: cover`. On hover (or keyboard focus), an overlay shows the original filename and an "unused" badge if the image's `reference_count` is 0. Clicking a thumbnail opens the detail/metadata view.

### Detail View

Replaces the grid when a thumbnail is selected (back button to return to grid). Shows the image at a larger size with an editable form below:

- **Alt text** — For accessibility (WCAG requirement)
- **Caption** — Display caption for export/preview
- **Source** — Where the image came from (photographer, stock site, URL, "author's own")
- **License** — License info (CC BY 4.0, public domain, purchased, etc.)

All fields are freeform text. A "Save" button persists changes via `PATCH /api/images/{id}`. An "Insert at cursor" button inserts the image into the editor at the current cursor position, using the alt text from the database. A "Delete" button removes the image file and database record — but only if the image is not referenced in any chapter (see Deletion Safety below).

**Where-used display:** When an image has `reference_count > 0`, the detail view shows a "Used in" section listing the chapter titles where the image appears, as clickable links that navigate to that chapter in the editor.

### "Unused" Indicator

Driven by the `reference_count` column on the `images` table, updated at chapter save time (see Reference Counting below). The gallery reads this column directly — no content scanning at gallery open time. Informational only — no automatic deletion.

---

## Reference Counting

Rather than scanning all chapter content JSON when the gallery opens, image usage is tracked via a `reference_count` column on the `images` table, maintained at chapter save time.

**On chapter save:** The server diffs which image URLs (`/api/images/{uuid}`) are present in the chapter's TipTap JSON content. For each image whose presence changed (added or removed from this chapter), the server increments or decrements `reference_count`. This piggybacks on the existing save pipeline (which already recalculates word count), keeping the gallery read path fast.

**Live check as safety net:** Before any destructive action (image deletion, project purge), the server performs a live scan of all chapter content for that project to verify the reference count is accurate. If the live check finds references the count missed (due to drift or bugs), the count is corrected and the action is blocked or adjusted accordingly. The live check also returns the list of chapter IDs and titles where the image is referenced, which is surfaced to the writer.

---

## Deletion Safety

**Referenced images cannot be deleted.** If a writer attempts to delete an image with `reference_count > 0`, the server runs a live check to confirm, then returns 409 Conflict with the list of chapters where the image is used. The gallery surfaces this as: "This image is used in Chapter 2: The Harbor, Chapter 7: Storm Warning. Remove it from those chapters first." Chapter titles are clickable links.

**Unreferenced images are hard-deleted.** When `reference_count` is 0 (confirmed by live check), the file is removed from disk and the database record is deleted. No soft delete — there is no file to preserve behind a tombstone record.

**Images follow the project lifecycle.** When a project is soft-deleted (moved to trash), its images remain on disk — the project may be restored. When a project is permanently purged (30-day background cleanup), the server deletes the project's entire image directory (`/app/data/images/{project_id}/`) and all associated database records.

---

## Editor Integration

### Paste/Drop Into Editor

TipTap's image extension is enabled with a custom handler for paste and drop events. When a writer pastes an image from clipboard or drops a file onto the editor, the handler intercepts it, uploads to `POST /api/projects/{projectId}/images`, and on success inserts a TipTap image node with `src` set to `/api/images/{uuid}` and `alt` set from the database record. The image also appears in the gallery. If the upload fails, a toast notification shows the error and nothing is inserted.

### Insert From Gallery

When the writer clicks "Insert at cursor" in the gallery detail view, the panel communicates with the editor via a shared callback (passed as a prop or via React context). The editor inserts an image node at the current selection/cursor position with `src="/api/images/{uuid}"`. If the editor has no focus or cursor, the image is appended at the end of the document.

### Image URL Format

The canonical URL stored in TipTap JSON image nodes is `/api/images/{uuid}`, where `{uuid}` is the image's database primary key. This format is:

- **Safe** — No user-controlled path components touch the filesystem. The server looks up the file path from the database.
- **Stable** — UUIDs don't change. Renaming the original file or moving storage doesn't break existing content.
- **Parseable** — Export renderers and reference count logic extract the UUID from the URL pattern to query metadata.

### Alt Text Flow

When an image is inserted (by either path), the `alt` attribute on the TipTap image node is set from the database record's `alt_text` field. If alt text is empty, the node gets an empty alt attribute (valid for decorative images). The gallery shows a gentle "No alt text" indicator to encourage the writer to fill it in. Updating alt text in the gallery does not retroactively update already-inserted image nodes — the database is the canonical metadata store, but editor content is its own document.

### Accepted Formats

JPEG, PNG, GIF, WebP. Server-side validation rejects other MIME types with a 400 response. File size limit: 10MB, enforced both client-side (before upload) and server-side (streaming rejection via multer `limits.fileSize`).

---

## Data Model

### New Table: `images`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | text (UUID) | PK |
| `project_id` | text (UUID) | FK -> projects, NOT NULL |
| `filename` | text | NOT NULL (original upload name) |
| `alt_text` | text | default '' |
| `caption` | text | default '' |
| `source` | text | default '' |
| `license` | text | default '' |
| `mime_type` | text | NOT NULL |
| `size_bytes` | integer | NOT NULL |
| `reference_count` | integer | NOT NULL, default 0 |
| `created_at` | text | NOT NULL (ISO 8601) |

No `updated_at` — metadata edits are infrequent and we don't need to track when. No `deleted_at` — image deletion is hard delete, blocked when `reference_count > 0` (see Deletion Safety).

### File Storage

Images are stored at `/app/data/images/{project_id}/{uuid}.{ext}`, scoped by project for clean separation and easier Phase 8a migration.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/projects/{projectId}/images` | Multipart upload via multer with 10MB streaming limit. Validates MIME type. Stores file to disk. Returns the created image record. |
| `GET` | `/api/projects/{projectId}/images` | Lists all images for a project, most recent first. |
| `GET` | `/api/images/{id}` | Serves the image file by database UUID. Used as the `src` URL in TipTap image nodes. |
| `PATCH` | `/api/images/{id}` | Updates metadata fields (alt_text, caption, source, license). |
| `DELETE` | `/api/images/{id}` | Live-checks reference count, returns 409 with chapter list if referenced, otherwise deletes file and record. |

---

## Accessibility

### Panel Landmarks

The reference panel uses `<aside aria-label="Reference panel">` as its landmark. The tab bar uses `role="tablist"` with individual `role="tab"` and `role="tabpanel"` for ARIA-compliant tab navigation. Arrow keys navigate between tabs (when more are added in future phases).

### Panel Toggle

The toolbar icon button has `aria-expanded` reflecting panel state and `aria-controls` pointing to the panel element. The Ctrl+. shortcut is documented in the existing shortcut help dialog.

### Image Gallery

The thumbnail grid uses a list (`<ul>`) with `role="list"`. Each thumbnail is a `<button>` with `aria-label` set to the image's filename (or alt text if available). The "unused" badge is included in the aria-label (e.g., "sunset.jpg, unused"). The detail view form uses proper `<label>` elements for all fields.

### Insert Feedback

When an image is inserted into the editor, an `aria-live="polite"` region announces "Image inserted: {filename}" so screen reader users get confirmation.

### Upload Feedback

Upload success and failure are announced via the same live region pattern used by save status. "Image uploaded: {filename}" on success, "Upload failed: {reason}" on failure.

### Keyboard Navigation

The panel is reachable via tab order (after the editor, before the end of the page). The resize handle supports Arrow Left/Right. All interactive elements in the gallery (upload button, thumbnails, form fields, action buttons) are keyboard accessible with visible focus indicators.

---

## Export Integration

The existing export pipeline (Phase 3a/3b) renderers need to resolve image URLs (`/api/images/{uuid}`) to actual file bytes by extracting the UUID and querying the database for the file path:

- **HTML** — Images are embedded as base64 data URIs for portability.
- **Markdown** — Images become `![alt text](embedded or path)` references.
- **Plain text** — Images are represented as `[Image: {alt text or filename}]`.
- **DOCX** — Images are embedded as binary media in the document package.
- **EPUB** — Images are added to the EPUB manifest and referenced from chapter XHTML.
- **PDF** — Images are embedded inline.

### Caption and Source in Export

When an image has a caption, it renders as a figure caption below the image in HTML, DOCX, EPUB, and PDF. Source and license are appended to the caption in parentheses if present (e.g., "A quiet street at dusk (Photo: Jane Doe, CC BY 4.0)").

### EPUB Cover Image

The export dialog includes a dropdown to select a project image as the EPUB cover. The list is populated from the project's images (via `GET /api/projects/{projectId}/images`). The selected image ID is passed to the EPUB renderer, which adds it as the cover image in the EPUB package. This completes the EPUB cover image support deferred from Phase 3b.

---

## Testing Strategy

- **Integration tests** for all API endpoints against real SQLite, including deletion-blocked (409) and project purge cascading.
- **Unit tests** for reference count diffing logic (add/remove image URLs from chapter content, verify count changes).
- **Unit tests** for live check accuracy — verify it catches reference count drift.
- **E2e tests** for: upload via gallery, paste into editor, insert from gallery, metadata editing, deletion with confirmation (both blocked and allowed), panel resize and toggle persistence, EPUB cover image selection.
- **aXe-core checks** on the panel in open state.
- **Export tests** verify image embedding for each format, including caption/source rendering and EPUB cover image.

---

## Scope Boundaries

The following are explicitly **out of scope** for this phase:

- **Drag from gallery to editor** — Click-to-insert only. Drag-and-drop insertion is a future refinement.
- **Inline image popover/toolbar** — No bubble menu when clicking images in the editor. All metadata editing happens in the gallery.
- **Image cropping or resizing** — Images are inserted at their natural size, constrained by the editor's max-width CSS. No client-side image manipulation.
- **Image compression or thumbnailing** — Server stores the original file as-is. Thumbnails in the gallery use CSS `object-fit: cover` on the full image. Server-side thumbnailing is a future optimization if needed.
- **Bulk upload** — One file at a time via the upload button. Paste/drop handles one image at a time.
- **Image reuse across projects** — Images are scoped to a single project. No shared library. Aligns with Phase 8a's per-project package direction.
