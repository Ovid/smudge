# Phase 3a: Export Foundation — Design Document

**Date:** 2026-04-14
**Phase:** 3a (Export Foundation)
**Status:** Design complete
**Depends on:** Phase 1 (chapter statuses)

---

## Overview

Phase 3a adds server-side export of manuscripts as HTML, Markdown, or plain text. The client presents a minimal export dialog; the server gathers chapters, renders to the chosen format, and returns a file download.

The export pipeline is built as simple functions — no plugin architecture or composable step system. When Phase 3b adds PDF/DOCX/EPUB, we'll refactor with concrete requirements to guide the abstraction.

---

## Data Model Changes

**projects table** — add one column:

- `author_name` — text, nullable. Used on the export title page. Editable in project settings.

No new tables. No new settings.

---

## API Design

### Export Endpoint

`POST /api/projects/{id}/export`

**Request body:**

```json
{
  "format": "html",
  "include_toc": true,
  "chapter_ids": ["uuid-1", "uuid-2"]
}
```

**Validation (Zod):**

- `format` — required, one of `html`, `markdown`, `plaintext`
- `include_toc` — optional boolean, defaults to `true`
- `chapter_ids` — optional array of UUIDs. If provided, must be non-empty and all IDs must belong to the project. Soft-deleted chapters in the list are silently omitted. If no chapters remain after filtering, return 400.

**Zero-chapter export:** If the project has no chapters (or all are deleted) and no `chapter_ids` were specified, the export succeeds with a title-page-only file — a manuscript is a manuscript even before the first chapter.

**Success response:**

- `200` with the file body
- `Content-Type`: `text/html`, `text/markdown`, or `text/plain`
- `Content-Disposition: attachment; filename="{project-slug}.html"`
- Filename derived from the project's existing `slug` field (already sanitized and unique). Falls back to `"export"` if slug is somehow empty.

**Error responses:**

- `400` — invalid format, empty chapter list after filtering (only when `chapter_ids` explicitly provided), invalid JSON
- `404` — project not found or soft-deleted

### Project Settings Update

`PATCH /api/projects/{id}` — extend to accept `author_name` in the body (nullable string, trimmed).

---

## Server Architecture

### Module Structure

New `packages/server/src/export/` module:

- **`export.routes.ts`** — Route handler for `POST /api/projects/{id}/export`. Validates request, calls the service, sends the response with appropriate headers.
- **`export.service.ts`** — Orchestrates export: gathers chapters via ProjectStore, calls the appropriate renderer, returns the result.
- **`export.renderers.ts`** — Three pure functions: `renderHtml()`, `renderMarkdown()`, `renderPlainText()`. Each takes a project (title, author) and an ordered list of chapters, returns a string.

### Dependencies

- **`@tiptap/html`** + shared editor extensions — for `generateHTML()` on the server.
- **`turndown`** (MIT) — for HTML-to-Markdown conversion.

### Flow

1. Route validates request body with Zod
2. Service fetches project (404 if missing/deleted)
3. Service fetches chapters — all or filtered by `chapter_ids`, ordered by `sort_order`, excluding soft-deleted
4. Service passes project + chapters to the format-specific renderer
5. Renderer returns a string
6. Route sets headers and sends the response

No streaming needed — even a 200k-word novel is a few hundred KB of text.

---

## Renderers

### HTML

Produces a single self-contained `.html` file with embedded CSS:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>{Project Title}</title>
  <style>
    body { font-family: Georgia, 'Times New Roman', serif; max-width: 680px; margin: 0 auto; padding: 2rem; line-height: 1.8; color: #1C1917; }
    h1 { text-align: center; margin-bottom: 0.5em; }
    .author { text-align: center; color: #555; margin-bottom: 3em; }
    h2 { margin-top: 3em; }
  </style>
</head>
<body>
  <h1>{Project Title}</h1>
  <p class="author">{Author Name}</p>
  <!-- TOC if include_toc -->
  <!-- Chapters as <section> elements with <h2> titles -->
</body>
</html>
```

- Each chapter's TipTap JSON converted via `generateHTML()` (no sanitization needed — content is authored by the single user via TipTap, and the exported file is a static download, not rendered in the app)
- Chapter titles as `<h2>` elements
- Chapters separated by a decorative divider
- If `author_name` is null, the author line is omitted entirely
- Web-safe serif fonts (Georgia, Times New Roman) — no bundled font files

### Markdown

```markdown
# Project Title

*By Author Name*

## Table of Contents
- [Chapter 1: The Beginning](#chapter-1-the-beginning)
- [Chapter 2: The Middle](#chapter-2-the-middle)

---

## Chapter 1: The Beginning

{chapter content converted from HTML via turndown}

---

## Chapter 2: The Middle
```

Pipeline: TipTap JSON -> `generateHTML()` -> `turndown` -> Markdown. TOC uses anchor links. Chapters separated by `---`.

### Plain Text

```
PROJECT TITLE
by Author Name


Chapter 1: The Beginning

{stripped text content}



Chapter 2: The Middle

{stripped text content}
```

- Title page at top
- Three blank lines between chapters
- Content extracted via `generateHTML()` then stripping HTML tags — same pipeline as the other renderers, no custom JSON tree walker needed
- If `author_name` is null, the "by" line is omitted

---

## Editor Extensions

The TipTap extension list currently lives in `packages/client/src/editorExtensions.ts`. The server needs the same list for `generateHTML()`.

**Approach:** Duplicate the extension list in the server package (`packages/server/src/export/editorExtensions.ts`). It's 7 lines of code that rarely changes. A test asserts both lists produce identical output for a reference TipTap document, catching any divergence.

This keeps `packages/shared/` lean (types, schemas, utilities only) and avoids adding TipTap as a shared dependency.

---

## Client UI

### Export Dialog

A modal dialog triggered from a new "Export" button in the project view (project header or toolbar area).

The dialog is minimal:

- **Format selector** — three radio buttons or button group: HTML, Markdown, Plain Text
- **Include table of contents** — checkbox, default checked
- **Chapter selection** — defaults to "All chapters." A "Select specific chapters..." link expands a checklist of chapter titles (in sort order), all checked by default
- **Export button** — triggers POST, receives blob, triggers browser download via `URL.createObjectURL`

Loading state on the button during the request. Toast or inline message on error.

### Project Settings

Add an **Author Name** text field to the project settings UI. Optional, persisted via `PATCH /api/projects/{id}`.

### Strings

All labels in `packages/client/src/strings.ts`. No hardcoded text.

### Accessibility

- `<dialog>` element with proper focus management
- Standard form controls with `<label>` elements
- Loading state announced via `aria-busy`
- Chapter checklist keyboard navigable
- aXe audit in e2e tests

---

## Testing Strategy

### Server — Renderer Unit Tests

Test each renderer function in isolation with known TipTap JSON + project metadata:

- Empty chapter content (null/empty JSON)
- Chapter with no title
- Project with no author name (author line omitted)
- TOC generation on/off
- Chapter ordering matches sort_order
- Soft-deleted chapters excluded even if in chapter_ids

### Server — Integration Tests

Export service with real SQLite:

- Chapter gathering, filtering, ordering
- 400 on invalid requests
- 404 on missing/deleted project

### Server — Route Tests

Supertest for `POST /api/projects/{id}/export`:

- Correct Content-Type and Content-Disposition headers per format
- Correct filename from project title
- Validation error responses

### Extension Divergence Test

- Verify client and server extension lists produce identical HTML output for a reference TipTap document

### Client

- Export dialog renders, form controls work
- Loading and error states
- Download trigger on success

### E2E (Playwright)

- Create project with chapters, export, verify file downloads
- Export with chapter selection
- aXe audit on the export dialog

---

## Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Rendering location | Server-side | Centralized, testable, extensible for Phase 3b's heavier formats |
| Download mechanism | POST + programmatic blob download | Request body handles complex config cleanly |
| Status filter | Dropped | Writers know which chapters to select; status filter is an engineering abstraction |
| Author name location | Project settings, not export dialog | Rarely changes; avoids repetitive input |
| Chapter selection UI | Collapsed by default | "Export all" is the common case; keep it to one click |
| TipTap-to-Markdown | JSON -> HTML -> turndown | Two mature libraries, no custom serializer |
| HTML export style | Self-contained with embedded CSS | Single file, web-safe fonts, portable |
| Plain text extraction | HTML pipeline + tag stripping | Same pipeline as other renderers; no custom JSON tree walker |
| Pipeline architecture | Simple functions, no abstraction | YAGNI; refactor when Phase 3b provides concrete requirements |
| Editor extensions | Duplicate in server, test for divergence | Keeps packages/shared lean; 7 lines of code, rarely changes |
| HTML sanitization | Skipped | Single-user authored content in a downloaded file; no XSS surface |
| Export filename | Use project slug | Already sanitized and unique; no re-slugification needed |
| Zero-chapter export | Title-page-only file | A manuscript is a manuscript even before the first chapter |
