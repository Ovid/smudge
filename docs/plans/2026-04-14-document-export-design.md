# Phase 3b: Document Export — Design Document

**Date:** 2026-04-14
**Phase:** 3b (Document Export)
**Depends on:** Phase 3a (Export Foundation)
**Status:** Design complete

---

## Overview

Phase 3b adds Word (.docx) and EPUB export formats to the existing export pipeline built in Phase 3a. These are the two formats writers actually need for professional workflows: .docx for editors, agents, and publishers; EPUB for e-readers.

PDF is deferred until the deployment story (Docker, Electron, or bare Node) is settled — likely Phase 8. PDF generation requires a heavy binary dependency (Puppeteer or equivalent), and the current app runs as a bare Node process without a container to absorb that weight. Writers sending manuscripts to professionals need .docx — that's the format that matters now.

## Formats

### Word (.docx)

Generated programmatically via the `docx` npm package (MIT licensed). The renderer walks the TipTap JSON tree directly — it does not go through HTML first. This produces properly styled Word documents with real paragraph styles (Heading 1, Normal, Block Quote, List Bullet) rather than pasted-HTML inline formatting. An editor opening the file in Word can work with it structurally.

**Document structure:**

1. **Title page** — Project title (centered heading) + author name (centered subtitle) + page break
2. **Table of contents** — Word-native TOC field (if `include_toc` is true) + page break. Uses `TableOfContents` from the `docx` library with `headingStyleRange: "1-3"` and `hyperlink: true`. The Document is created with `updateFields: true` so Word populates the TOC on first open. Note: some Word versions show a prompt asking whether to update fields — this is normal and expected.
3. **Chapters** — Each chapter starts on a new page (page break before each chapter heading)

**TipTap to Word style mapping:**

| TipTap Node | Word Style |
|---|---|
| H3 | Heading 1 |
| H4 | Heading 2 |
| H5 | Heading 3 |
| Paragraph | Normal |
| Blockquote | Block Text (indented, italic) |
| Bullet list | List Bullet |
| Ordered list | List Number |
| Code block | Monospace font, light background |
| Horizontal rule | Decorative divider (centered `* * *`) |

The heading level shift (H3→Heading 1, H4→Heading 2, H5→Heading 3) is intentional. In the TipTap editor, H1–H2 are reserved for the page structure (project title, chapter titles). In the exported document, each chapter is its own top-level context, so writer headings map to Word's top-level heading styles.

**Inline marks:** Bold, italic, strikethrough, and inline code map directly to Word run-level formatting properties.

**Typography:** Serif body font (Cambria or Times New Roman — universally available in Word), clean sans-serif for headings.

### EPUB

Generated via `epub-gen-memory` (MIT licensed), which handles the EPUB packaging spec (OPF manifest, NCX navigation, container XML).

**Document structure:**

1. **Title page** — Project title + author name, rendered as the first XHTML section
2. **Table of contents** — EPUB's built-in navigation (NCX/nav document), generated automatically from chapter titles. An inline HTML TOC page is also included if `include_toc` is true.
3. **Chapters** — Each chapter is a separate XHTML file. This is the EPUB convention and naturally creates page breaks on e-readers.

**Content conversion:** TipTap JSON → HTML via the existing `chapterContentToHtml()` helper (the same one the HTML export uses). A `shiftHeadingLevels(html)` post-processing helper remaps `<h3>`→`<h1>`, `<h4>`→`<h2>`, `<h5>`→`<h3>` in the HTML output before packaging into EPUB. This helper is also used by the HTML renderer (see Heading Level Shift section below).

**Empty chapter handling:** If `chapterContentToHtml()` returns `""` for a chapter with null or empty content, the EPUB chapter renders as a title-only section (heading with no body). If `epub-gen-memory` cannot handle empty HTML content, a `<p>&nbsp;</p>` placeholder is injected as a fallback.

**Embedded stylesheet:** A minimal CSS file included in the EPUB:

- Serif font-family (Georgia, serif fallback) for body text
- Comfortable line-height (~1.6)
- Heading sizes and spacing
- Blockquote indentation and styling
- Code block monospace treatment

E-reader users can still override font and size in their device settings — the stylesheet provides a good default, not a locked-down layout.

**Metadata:**

- Title: from project title
- Author: from `author_name` (omitted if not set)
- Language: hard-coded to `en`

**Cover image:** Not supported in this phase. Deferred to Phase 4a when image upload/storage infrastructure exists. EPUB supports cover images natively, so this is a straightforward addition once the image infrastructure is in place.

## Integration with Existing Pipeline

The changes touch a small, well-defined set of files. The export dialog, chapter filtering, status filtering, soft-delete exclusion, abort handling, and download mechanism from Phase 3a all work as-is.

### Shared package (`packages/shared`)

- Add `"docx"` and `"epub"` to the `ExportFormat` Zod enum
- Add entries to `EXPORT_FILE_EXTENSIONS`: `docx: "docx"`, `epub: "epub"`
- Add entries to `EXPORT_CONTENT_TYPES`: `docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"`, `epub: "application/epub+zip"`

### Server — renderers (`export.renderers.ts`)

- Add `renderDocx()` — walks TipTap JSON tree, builds `docx` Document with styled paragraphs, returns a Buffer
- Add `renderEpub()` — converts chapters to HTML via existing helper, passes to `epub-gen-memory` with metadata and stylesheet, returns a Buffer
- Both return binary Buffers rather than strings (unlike the text-based formats)

### Server — service (`export.service.ts`)

- Update `ExportResult.content` type from `string` to `string | Buffer`
- Update the local `content` variable type from `let content: string` to `let content: string | Buffer`
- Add two cases to the format switch statement
- `res.send()` in the route handler already handles both strings and Buffers, so `export.routes.ts` requires no changes

### Client — ExportDialog.tsx

- Add "Word (.docx)" and "EPUB" radio buttons to the format selection
- No other dialog changes needed — chapter selection, TOC toggle, and download mechanism work as-is

### Client — strings.ts

- Add `formatDocx: "Word (.docx)"` and `formatEpub: "EPUB"` format labels

### Client — api/client.ts

- Add `"docx"` and `"epub"` to the format type union

### New dependencies

- `docx` (MIT) — production dependency in `packages/server`
- `epub-gen-memory` (MIT) — production dependency in `packages/server`

Both must be added to `docs/dependency-licenses.md` per project policy. The `epub-gen-memory` license should be verified from `node_modules/epub-gen-memory/package.json` at install time — if it turns out to be GPL or similar, `epub-gen` or manual EPUB assembly with a zip library are fallbacks.

## Heading Level Shift

All export formats shift heading levels: TipTap H3→H1, H4→H2, H5→H3. In the editor, H1–H2 are reserved for page structure (project title, chapter titles). In exported documents, each chapter is its own top-level context, so writer headings map to top-level heading styles.

**Implementation:**

- **docx:** The heading shift happens naturally during the TipTap JSON tree walk — the renderer maps `heading` nodes with `level: 3` to Word's Heading 1 style, etc.
- **HTML and EPUB:** A shared `shiftHeadingLevels(html: string)` post-processing helper remaps `<h3>`→`<h1>`, `<h4>`→`<h2>`, `<h5>`→`<h3>` in the HTML output from `chapterContentToHtml()`. This is applied in the EPUB renderer before packaging, and retroactively applied in the existing HTML renderer for consistency across all formats.
- **Markdown:** The Markdown renderer uses Turndown on the HTML output. The heading shift is applied to the HTML before Turndown processes it, so Markdown headings automatically come out as `#`, `##`, `###`.
- **Plain text:** No headings in plain text output, so no shift needed.

## Testing Strategy

### Unit tests — renderers (`export.renderers.test.ts`)

**docx:**

- Title page present with project title and author name
- Chapter headings use correct Word styles (Heading 1, not Heading 3)
- Page breaks between chapters
- TOC included/omitted based on option
- Author byline present when set, absent when null
- Inline formatting applied correctly (bold, italic, strikethrough, code)
- Blockquotes, lists, code blocks, and horizontal rules render correctly

**epub:**

- Chapter count matches input
- Metadata set correctly (title, author, language)
- Stylesheet embedded
- TOC generation (both NCX and inline)
- Heading level shift (H3→H1, H4→H2, H5→H3)
- Null/empty content handled gracefully

**Both formats:**

- CJK character handling
- Null content chapters
- Malformed TipTap JSON (graceful degradation)
- Empty titles
- Chapters with no content (empty body)

### Integration tests — service (`export.service.test.ts`)

- Export with docx/epub format returns correct content type and file extension
- Chapter filtering and soft-delete exclusion work for new formats
- Zero-chapter export (title-page-only) works for both formats
- Invalid chapter IDs rejected

### E2e tests (Playwright)

- Export dialog shows all five format options
- Selecting Word or EPUB triggers download with correct file extension
- Downloaded files are valid (non-zero size, correct MIME type)

## Out of Scope

- **PDF** — Deferred until deployment story is settled (Phase 8)
- **Cover image for EPUB** — Deferred to Phase 4a (image infrastructure)
- **Rich EPUB metadata** — No ISBN, publisher, description, or custom language setting
- **Manuscript formatting options** — No font choice, margin control, or page size settings in the export dialog
- **Export preview** — No "preview what the .docx will look like" feature
- **Progress indicator** — The existing "Exporting..." button state is sufficient
