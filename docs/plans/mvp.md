# Smudge — Product Requirements Document (MVP)

**Version:** 0.3.0 (Phase 0 — MVP)
**Date:** 2026-03-29
**Author:** Ovid / Claude (collaborative)
**Status:** Draft — post-review

---

## 1. Vision

Smudge is a web-based writing application built for writers, not note-takers. It organizes long-form work (fiction and non-fiction) as projects composed of chapters, provides a distraction-minimal editing experience, and treats the manuscript — not the individual document — as the unit of work.

Google Docs treats every document as an island. Scrivener is powerful but desktop-bound and visually dated. Smudge occupies the space between: structured enough to manage a book-length project, simple enough that you open it and write.

### Design Principles

1. **Think like a writer, not a developer.** Every feature should answer the question: "Does this help someone write a book?"
2. **Stay out of the way.** The default state is: you're looking at your words. UI chrome exists at the edges, not in the center.
3. **Trust the save.** Auto-save is invisible and reliable. A writer should never think about saving.
4. **Structure without rigidity.** Chapters are the organizational unit, but the writer decides what a "chapter" means — it could be an actual chapter, a section, an interlude, a prologue, an appendix.
5. **One writer, one tool.** MVP is single-user. No collaboration, no sharing, no accounts. This simplifies everything.
6. **Accessible by default.** Accessibility is a design constraint, not a feature. Every interaction must work for keyboard-only users and screen reader users from day one.

---

## 2. MVP Scope

The MVP answers one question: **"Can I use Smudge instead of Google Docs to write my book, starting today?"**

That requires:

- Creating and managing projects
- Writing in chapters with rich text
- Reordering chapters
- Seeing the full manuscript in a read-through/preview mode
- Trusting that my work is saved
- Knowing my word count

That's it. No export, no character sheets, no research panel, no goals. Those come in later phases.

---

## 3. User Stories

### 3.1 Project Management

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| P1 | As a writer, I want to create a new project so I can start a new book. | Writer can create a project with a title. Project appears in a project list/home screen. |
| P2 | As a writer, I want to choose whether my project is fiction or non-fiction when I create it. | A mode selector (fiction/non-fiction) is presented at project creation. The choice is stored and displayed, but has no functional difference in MVP. |
| P3 | As a writer, I want to see all my projects on a home screen so I can switch between them. | Home screen lists all projects with title, mode (fiction/non-fiction), total word count, and last-edited date. Sorted by last-edited (most recent first). |
| P4 | As a writer, I want to rename a project. | Project title is editable from the project view. |
| P5 | As a writer, I want to delete a project I no longer need. | Deletion moves the project and all its chapters to trash (soft delete). Writer sees confirmation: "Move to trash? You can restore this within 30 days." |

### 3.2 Chapter Management

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| C1 | As a writer, I want to add a new chapter to my project. | New chapters are created with a default title ("Untitled Chapter") and empty content. They are appended to the end of the chapter list. |
| C2 | As a writer, I want to rename a chapter. | Chapter titles are editable inline in the sidebar. |
| C3 | As a writer, I want to reorder chapters by dragging them. | Drag-and-drop reordering in the sidebar. The new order persists immediately. A keyboard-accessible alternative is also available (see A11y Requirements). |
| C4 | As a writer, I want to delete a chapter. | Deletion moves the chapter to trash (soft delete). Writer sees confirmation: "Move to trash? You can restore this within 30 days." |
| C5 | As a writer, I want to see all chapters in a sidebar while I write. | The sidebar shows an ordered list of chapter titles. The currently selected chapter is visually highlighted. Clicking a chapter opens it in the editor. |
| C6 | As a writer, I want to restore accidentally deleted chapters. | A "Trash" view lists soft-deleted items with their deletion date. Writer can restore individual items or permanently delete them. Items older than 30 days are automatically purged. |

### 3.3 Writing / Editing

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| W1 | As a writer, I want a rich text editor that supports bold, italic, headings, block quotes, and ordered/unordered lists. | The editor supports at minimum: bold, italic, H1–H3 headings, block quotes, bullet lists, numbered lists, and horizontal rules. Formatting is accessible via keyboard shortcuts (Ctrl/Cmd+B, etc.) and a minimal, unobtrusive toolbar. |
| W2 | As a writer, I want my work to auto-save as I type. | Content is saved automatically after the writer stops typing (debounce: 1–2 seconds of inactivity). No manual save button exists. See §7.3 for save lifecycle details. |
| W3 | As a writer, I want to see a "Saved" indicator so I trust auto-save is working. | A small, unobtrusive status indicator (e.g., "Saved" / "Saving…" / "Unsaved changes" / "Unable to save") is always visible. Status is conveyed via text label, not color alone. |
| W4 | As a writer, I want to see the word count for the current chapter. | Word count for the active chapter is displayed persistently (e.g., in a status bar). See §4.4 for counting algorithm. |
| W5 | As a writer, I want to see the total word count for the entire manuscript. | Total manuscript word count is visible alongside the chapter word count. |
| W6 | As a writer, I want spell checking while I write. | Browser-native spell checking is enabled in the editor (via `spellcheck="true"`). This gives baseline spell check in all modern browsers with no additional implementation. |

### 3.4 Preview / Read-Through Mode

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| R1 | As a writer, I want to click "Preview" and see my entire manuscript as a single continuous document. | Preview mode renders all chapters sequentially, with chapter titles as headings and clear visual separation between chapters. |
| R2 | As a writer, I want the preview to use clean reading typography. | Preview uses a serif reading font (e.g., Georgia, Libre Baskerville, or similar), comfortable line length (60–75 characters), generous line height, and visually distinct from the editor. |
| R3 | As a writer, I want to easily return from preview to editing a specific chapter. | Clicking a chapter heading in preview, or pressing Escape / clicking a "Back to Editor" button, returns to the editor. If a chapter heading is clicked, that chapter is opened. |
| R4 | As a writer, I want a table of contents in preview mode so I can jump to any chapter. | A fixed-position TOC panel displays all chapter titles as anchor links. The TOC is collapsible. Scroll-aware chapter highlighting (intersection observer) is delivered as a fast-follow within Phase 0 (see §14, decision #8). |

---

## 4. Information Architecture

```
Home Screen (Project List)
│
└── Project View
    ├── Sidebar (chapter list, reorderable)
    ├── Editor (single chapter, rich text)
    ├── Status Bar (word counts, save status)
    └── Preview Mode (full manuscript, read-only, with floating TOC)
```

### 4.1 Data Model (MVP)

**Project**
- `id` — UUID, primary key
- `title` — text, required
- `mode` — enum: "fiction" | "nonfiction"
- `created_at` — timestamp
- `updated_at` — timestamp
- `deleted_at` — timestamp, nullable (soft delete; see §4.5)

**Chapter**
- `id` — UUID, primary key
- `project_id` — foreign key → Project
- `title` — text, default "Untitled Chapter"
- `content` — text (stored as TipTap JSON; see §4.2)
- `sort_order` — integer (for chapter sequencing)
- `word_count` — integer (denormalized for performance; updated on save)
- `created_at` — timestamp
- `updated_at` — timestamp
- `deleted_at` — timestamp, nullable (soft delete; see §4.5)

### 4.2 Content Storage: TipTap JSON

Chapter content is stored as **TipTap's native JSON format**, not HTML.

**Rationale:**
- **Round-trip fidelity.** JSON is TipTap's internal representation. Storing it avoids parse/serialize edge cases on every load/save cycle.
- **Extensibility.** Future phases add custom node types (inline writer's notes, fact-check flags, character tags, citation links). These are naturally modeled as nodes/marks in the JSON tree. Bolting them onto HTML via data-attributes is fragile.
- **Structured operations.** Word counting, annotation extraction, tag searching, and content analysis can walk the JSON tree directly without DOM parsing.

**Trade-off acknowledged:** JSON is TipTap-specific. If the editor is ever replaced, a one-time migration script is required. This is a bounded risk — a single conversion job, not an ongoing cost.

**HTML generation** is handled on-demand via TipTap's `generateHTML()` for preview rendering and future export (Phase 3).

### 4.3 Chapter Titles as Metadata

Chapter titles are **stored in the database as a separate field**, not embedded in the TipTap content. In the editor, the title is displayed as a styled heading above the editor area. It is editable by double-clicking it, or by editing in the sidebar. Both update the same database field.

**Rationale:**
- Titles don't inflate word count.
- Titles can't be accidentally deleted while editing content.
- Export logic cleanly separates structural headings from content.
- The sidebar and editor heading always agree because they read the same source.

### 4.4 Word Count Algorithm

Word count is computed by a single shared function (`countWords(tiptapJson)`) in the `shared` package, used by both client and server. This guarantees the editor's live word count and the server's stored word count always agree.

**Algorithm:**
1. Walk the TipTap JSON tree, extracting only text nodes (ignoring structural nodes like horizontal rules, empty headings, etc.).
2. Concatenate all text content.
3. Use `Intl.Segmenter` with `granularity: 'word'` to segment the text. Count segments where `isWordLike` is `true`.

**Why `Intl.Segmenter`:** It handles CJK languages (where whitespace splitting produces wrong results), hyphenated compounds, contractions, and Unicode punctuation correctly. It is available natively in all target browsers and in Node.js 16+.

**The denormalized `word_count` column** in the Chapter table is updated server-side on every save. The client uses the same `countWords` function for live display between saves, ensuring the two are always consistent.

### 4.5 Soft Delete and Data Recovery

Deleted projects and chapters are not removed from the database. Instead, a `deleted_at` timestamp is set.

**Behavior:**
- All standard queries filter out records where `deleted_at IS NOT NULL`.
- A "Trash" view lists soft-deleted items, showing the item title, type (project or chapter), and deletion date.
- Writers can restore individual items from trash (clears `deleted_at`).
- Writers can permanently delete items from trash (hard delete).
- A background cleanup job runs on server startup and purges items where `deleted_at` is older than 30 days.

**Rationale:** A single misclick on "delete" should never destroy months of work. Full versioning is Phase 7; soft delete provides a safety net now with minimal implementation cost (one additional column, one WHERE clause on every query).

---

## 5. Tech Stack

### 5.1 Architecture Overview

Smudge is a single-container Docker application with a backend API and a frontend SPA, served from the same container. The entire stack is TypeScript, which provides a clean path to Electron packaging for non-technical users in the future. Data is stored in SQLite, persisted via a Docker volume.

```
┌──────────────────────────────────────┐
│           Docker Container           │
│                                      │
│  ┌───────────┐   ┌────────────────┐  │
│  │  Frontend  │   │    Backend     │  │
│  │  (React +  │◄─►│  (Express +   │  │
│  │  TypeScript│   │   TypeScript)  │  │
│  │  served as │   │                │  │
│  │  static    │   │  better-sqlite3│  │
│  │  files)    │   │       ▼        │  │
│  └───────────┘   └───────┬────────┘  │
│                          │           │
└──────────────────────────┼───────────┘
                           │
                      Docker Volume
                     (smudge-data)
```

### 5.2 Why TypeScript Everywhere

The backend uses Node.js + TypeScript instead of Python for one critical reason: **Electron compatibility.** When Smudge is eventually packaged as a desktop app for non-technical writers, the entire codebase — frontend and backend — can be bundled into a single Electron app without needing to ship a Python runtime. This avoids the bloat and complexity of sidecar processes.

Additionally, a single language across the stack means shared type definitions (e.g., the `Project` and `Chapter` types are defined once and used on both sides), shared validation logic, and a single toolchain for linting, testing, and building.

### 5.3 Backend

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Node.js 20 LTS + TypeScript 5.x | LTS for stability. TypeScript for type safety across the full stack. |
| Framework | Express 4.x | Battle-tested, universally documented, enormous middleware ecosystem. For a REST API serving one user, Express is more than sufficient. Express 5 may be evaluated when it reaches unambiguous stable status. |
| Database | SQLite via better-sqlite3 | Synchronous API, fastest SQLite binding for Node.js, zero configuration, single-file DB. Persisted via Docker volume mount. |
| Schema / Migrations | Knex.js | Lightweight query builder with built-in migration and seed support. Avoids the weight of a full ORM while keeping SQL organized and migration-safe. Supports SQLite natively and provides a migration path to PostgreSQL if ever needed. |
| Validation | Zod | Runtime type validation that integrates naturally with TypeScript. Shared schemas between frontend and backend. |

**Note on `better-sqlite3` and the event loop:** The synchronous API is acceptable for a single-user application with small, fast queries (a chapter save is a single-row update, typically single-digit milliseconds). If future features require heavy queries (e.g., full-text search across an entire manuscript, bulk export processing), offloading to a Node.js worker thread should be evaluated at that point.

### 5.4 Frontend

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Framework | React 18+ with TypeScript | Component model fits the UI structure well. TypeScript catches bugs early. Massive ecosystem for future needs. |
| Build tool | Vite | Fast builds, excellent developer experience, straightforward production bundling. |
| Rich text editor | TipTap (v2) | Built on ProseMirror — the gold standard for structured rich text. Extensible (we'll need custom extensions in later phases for inline notes, annotations, etc.). Outputs JSON (structured) or HTML. Excellent keyboard shortcut support. |
| Drag-and-drop | @dnd-kit/sortable (legacy, v10) | Stable, battle-tested, excellent accessibility (built-in keyboard sorting). Used for chapter reordering in the sidebar. Note: the dnd-kit project has released a rewritten version (`@dnd-kit/react`, currently pre-1.0). Migration should be evaluated when the new version reaches 1.0 stable. The reordering logic is isolated to one sidebar component, so a library swap is a contained task. |
| Styling | Tailwind CSS | Utility-first, rapid prototyping, easy to customize. Keeps the CSS footprint small and predictable. |
| HTTP client | fetch (native) | No need for Axios or similar in MVP. Keep dependencies minimal. |

### 5.5 Infrastructure

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Containerization | Docker with Compose | Single `docker compose up` to launch. Volume mount for SQLite persistence. |
| Serving | Express serves both the API (`/api/*`) and the built frontend static files | One process, one port, no Nginx needed for MVP. |
| Port | 3456 (configurable via env) | Avoids common conflicts (3000, 8000, 8080). |
| Future packaging | Electron | When ready, the same Node.js backend and React frontend wrap into a downloadable desktop app. No rewrite required — just packaging. |

### 5.6 What's Intentionally Excluded from the Stack

- **No authentication.** Single-user app running locally or on a personal server. Auth adds complexity with zero value at this stage.
- **No WebSocket.** Auto-save is handled by debounced REST calls. WebSocket adds complexity that isn't needed until real-time collaboration (which may never come).
- **No external database.** SQLite is the right answer for single-user, single-process. If Smudge ever becomes multi-user, PostgreSQL is a straightforward migration via Knex.
- **No SSR.** This is a tool, not a content site. No SEO concerns. SPA is simpler.
- **No full ORM.** Knex as a query builder keeps us close to SQL without the abstraction overhead of Prisma or TypeORM. For a simple data model with two tables, an ORM is overkill.

---

## 6. API Design (MVP)

All endpoints return JSON. Content-type: `application/json`.

### 6.1 Error Handling

**Error response envelope:** All error responses use a consistent format:

```json
{
  "error": {
    "code": "CHAPTER_NOT_FOUND",
    "message": "The chapter you're looking for doesn't exist or has been deleted."
  }
}
```

- `code` is a machine-readable constant (e.g., `VALIDATION_ERROR`, `NOT_FOUND`, `SAVE_FAILED`, `REORDER_MISMATCH`).
- `message` is a human-readable string suitable for display to the writer. Messages are written in plain language, not developer jargon.

**HTTP status codes used:** 200 (success), 201 (created), 400 (validation error / malformed request), 404 (not found), 500 (server error).

**Auto-save failure handling (client-side):**

1. On save failure, retry up to 3 times with exponential backoff: 2s, 4s, 8s.
2. During retries, the status bar shows "Saving…" (the writer doesn't see individual retry attempts).
3. If all retries fail, the status bar shows a persistent warning: "Unable to save — check connection" (not a transient message that disappears).
4. The unsaved content is held in a client-side cache (in-memory). It is never discarded until a save is confirmed by the server.
5. A `beforeunload` event handler is registered whenever unsaved changes exist. If the writer attempts to close the tab or navigate away, the browser's native "You have unsaved changes" dialog is shown.
6. When the connection recovers (next successful save), the status bar returns to "Saved" and the `beforeunload` handler is removed.

**Chapter load failure:** If a GET for chapter content returns an error, the editor area displays a clear, non-technical error message (e.g., "Couldn't load this chapter. Please try again.") with a retry button. The editor does not display a blank writing area with no explanation.

**Data corruption guard:** If the server receives a chapter update where the content field is not valid JSON or not valid TipTap JSON structure, it returns a 400 with `code: "INVALID_CONTENT"` and does not overwrite the existing content. The previous valid version is preserved.

### 6.2 Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects` | List all projects (id, title, mode, total_word_count, updated_at). Excludes soft-deleted projects. |
| POST | `/api/projects` | Create a project (body: title, mode) |
| GET | `/api/projects/{id}` | Get project details + chapter list (ordered). Excludes soft-deleted chapters. |
| PATCH | `/api/projects/{id}` | Update project (title) |
| DELETE | `/api/projects/{id}` | Soft-delete project and all its chapters (sets `deleted_at`) |

### 6.3 Chapters

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/projects/{id}/chapters` | Create a chapter (appended to end) |
| GET | `/api/chapters/{id}` | Get chapter content (TipTap JSON) |
| PATCH | `/api/chapters/{id}` | Update chapter (title, content). Word count is recalculated server-side on content update. |
| DELETE | `/api/chapters/{id}` | Soft-delete chapter (sets `deleted_at`) |
| PUT | `/api/projects/{id}/chapters/order` | Set chapter order. Body: `{ "chapter_ids": ["id1", "id2", ...] }`. The list must contain exactly all non-deleted chapter IDs for the project — no missing, no extras, no duplicates. Returns 400 with `code: "REORDER_MISMATCH"` if the list doesn't match. |

### 6.4 Trash

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/trash` | List all soft-deleted items (projects and chapters) with id, title, type, and deleted_at |
| POST | `/api/trash/{id}/restore` | Restore a soft-deleted item (clears `deleted_at`). If restoring a chapter whose parent project is also deleted, the project is restored too. |
| DELETE | `/api/trash/{id}` | Permanently delete (hard delete) an item from trash |

### 6.5 Preview

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects/{id}/preview` | Get all non-deleted chapters in order with full content (for preview rendering) |

---

## 7. UI/UX Guidelines

### 7.1 Visual Identity

- **Tone:** Warm, calm, confident. This is a workshop, not a factory.
- **Color palette:** Muted earth tones. Warm off-white background (#FAF8F5 or similar), dark charcoal text (#2D2D2D), a single accent color for interactive elements (a warm amber/ochre, not a tech-blue). All color combinations must meet WCAG 2.1 AA contrast ratios (see §8).
- **Typography:**
  - **Editor:** A clean sans-serif for the UI chrome (Inter or similar). The writing area itself uses a serif font (Libre Baskerville, Lora, or Merriweather) at a generous size (18–20px) — writers stare at this for hours.
  - **Preview:** Same serif as the editor, but rendered at a comfortable reading width (max ~680px centered).
- **Iconography:** Minimal. Prefer text labels to icons where space allows. When icons are necessary, use simple line icons (Lucide or similar). All icons must have accessible text alternatives.

### 7.2 Layout

- **Sidebar:** Left side, ~260px wide, collapsible (Ctrl/Cmd+Shift+\\). Contains the project title, chapter list, and an "Add Chapter" button. Scrollable if the chapter list exceeds viewport height. ARIA landmark: `<aside>` with `aria-label="Chapters"`.
- **Editor:** Takes remaining horizontal space. Writing area is centered with a max-width (720px) for comfortable line lengths, even on wide screens. ARIA landmark: `<main>`.
- **Status bar:** Bottom of the editor area. Contains: word count (chapter / total), save status indicator. Subtle, not attention-grabbing. Uses `aria-live="polite"` for status changes.
- **Toolbar:** Above the editor. Minimal formatting options. Appears on focus or selection, or remains as a thin persistent bar — test both approaches. Uses `role="toolbar"` with `aria-label="Formatting"`.

### 7.3 Interactions

- **Auto-save lifecycle:**
  - Debounce of 1.5 seconds after last keystroke triggers a save.
  - Status indicator transitions: "Saving…" → "Saved" with a brief, subtle animation (respects `prefers-reduced-motion`).
  - On failure: retry 3 times (2s/4s/8s backoff), then show persistent "Unable to save — check connection" warning. See §6.1 for full failure handling.
  - **On chapter switch:** If unsaved changes exist, an immediate non-blocking save is fired (the debounce timer is bypassed). The new chapter loads optimistically while the save completes in the background. The unsaved content is held in a client-side cache until the save is confirmed by the server, so it is never lost even if the request fails mid-flight.
  - `beforeunload` handler is active whenever unsaved changes exist.
- **Chapter switching:** Instant. No page reload. Content loads from local cache when possible, with background sync.
- **Preview mode:** Triggered by a "Preview" button in the top navigation area or Ctrl/Cmd+Shift+P. Full-screen overlay or a distinct route — either way, the editor UI is fully hidden to create an immersive reading experience. Includes a floating/collapsible table of contents. The "Back to Editor" action is the first focusable element.
- **Drag-and-drop:** Chapters in the sidebar can be reordered by dragging. Visual feedback (drag handle icon on hover, drop target highlighting). A keyboard alternative is provided: select a chapter, then Alt+↑/↓ to reorder, with live region announcing the new position.
- **Confirmation dialogs:** Required for delete actions only. Implemented as proper modal dialogs with focus trapping. Phrased as human sentences: "Move 'Chapter 3: The Betrayal' to trash? You can restore it within 30 days."

### 7.4 Keyboard Shortcuts

TipTap provides standard formatting shortcuts automatically (Ctrl/Cmd+B, +I, +U, etc.).

Smudge-specific shortcuts for MVP:

| Shortcut | Action |
|----------|--------|
| Ctrl/Cmd + Shift + P | Toggle preview mode |
| Ctrl/Cmd + Shift + N | Create new chapter |
| Ctrl/Cmd + Shift + \\ | Toggle sidebar |
| Ctrl/Cmd + / | Open keyboard shortcut help dialog |

All shortcuts are discoverable via the help dialog (Ctrl/Cmd+/).

---

## 8. Accessibility Requirements

Accessibility is a first-class design constraint, not a post-hoc remediation. All requirements in this section are **mandatory for MVP**.

### 8.1 Standards

Smudge targets **WCAG 2.1 Level AA** compliance. This is the baseline, not the aspiration.

### 8.2 Semantic Structure

- Use semantic HTML elements throughout: `<nav>`, `<main>`, `<aside>`, `<header>`, `<footer>`, `<button>`, `<dialog>`.
- ARIA landmarks for all major regions: sidebar (`<aside aria-label="Chapters">`), editor (`<main>`), toolbar (`role="toolbar" aria-label="Formatting"`), status bar.
- Heading hierarchy is correct and consistent: H1 for the project/manuscript title, H2 for chapter titles, H3+ for content headings within chapters.
- No `<div>` or `<span>` used as interactive elements. All clickable/actionable elements are `<button>` or `<a>`.

### 8.3 Keyboard Navigation

- All interactive elements are reachable and operable via keyboard.
- Visible focus indicators on all focusable elements. Focus indicators must have sufficient contrast (3:1 against adjacent colors per WCAG 2.4.7).
- Tab order follows logical reading/interaction order.
- No keyboard traps except within modal dialogs (where trapping is correct behavior).
- Escape key dismisses modals, preview mode, and overlay panels.
- Chapter reordering via Alt+↑/↓ as alternative to drag-and-drop, with live region feedback ("Chapter 'The Betrayal' moved to position 3 of 7").

### 8.4 Screen Reader Support

- Editor area: `role="textbox"`, `aria-multiline="true"`, `aria-label="Chapter content"`.
- Formatting toolbar buttons: `aria-pressed` state for toggle formatting (bold on/off, italic on/off).
- Save status: `aria-live="polite"` region. Text-based status ("Saved", "Saving…", "Unsaved changes"), never conveyed by color or icon alone.
- Word count updates: `aria-live="polite"`. Updated on save, not on every keystroke (to avoid noise).
- Chapter list: `aria-current="true"` on the active chapter.
- Preview TOC: `role="navigation"` with `aria-label="Table of contents"`. Currently visible chapter marked with `aria-current="true"`.
- Confirmation dialogs: `role="alertdialog"` with `aria-describedby` pointing to the confirmation message.

### 8.5 Visual Design

- All text meets WCAG AA contrast ratios: 4.5:1 for body text, 3:1 for large text (18px+ regular or 14px+ bold) and UI components.
- No information conveyed by color alone. Save status uses text labels. Chapter status indicators (future phases) must use text or iconography in addition to color.
- Animations and transitions respect `prefers-reduced-motion: reduce`. When reduced motion is preferred, transitions are replaced with instant state changes.
- Text remains readable at 200% browser zoom without horizontal scrolling or content loss.

### 8.6 Editor-Specific Considerations

- TipTap/ProseMirror accessibility should be audited during development. Known gaps in screen reader announcement of formatting changes should be documented and mitigated where possible.
- The floating formatting toolbar (if used) must be keyboard-accessible and screen reader-discoverable, not just mouse-triggered.
- Spell check suggestions from the browser are natively accessible; no additional work required.

---

## 9. Internationalization (i18n) Strategy

### 9.1 MVP: English UI, Preparation for Future Translation

The MVP UI is English-only. However, the codebase is structured to make future localization straightforward.

### 9.2 String Externalization

All user-facing UI strings are stored in a single constants file (`packages/client/src/strings.ts`), never as raw literals in components. Every component imports strings from this file.

```typescript
// strings.ts
export const STRINGS = {
  project: {
    createNew: "New Project",
    deleteConfirm: (title: string) =>
      `Move "${title}" to trash? You can restore it within 30 days.`,
    // ...
  },
  chapter: {
    untitledDefault: "Untitled Chapter",
    addNew: "Add Chapter",
    // ...
  },
  editor: {
    saving: "Saving…",
    saved: "Saved",
    unsaved: "Unsaved changes",
    saveFailed: "Unable to save — check connection",
    // ...
  },
} as const;
```

When i18n is added in a future phase, this file is replaced by a translation loader (e.g., react-i18next) and the string keys become translation keys. The migration is mechanical, not architectural.

### 9.3 Unicode and Multilingual Content Support (MVP — Required)

While the UI is English, writers may write prose in any language. The following must work correctly from day one:

- **Unicode support:** Full Unicode text input, storage, and rendering. No assumptions about Latin characters.
- **RTL text:** Arabic, Hebrew, and other RTL scripts must render correctly in the editor and preview. TipTap/ProseMirror supports this, but it must be tested.
- **CJK word counting:** Handled by `Intl.Segmenter` in the shared `countWords` function (see §4.4).
- **`lang` attribute:** The `<html lang="en">` attribute is set for the UI. In future phases, per-project or per-chapter language settings could allow correct `lang` attributes on content regions, improving screen reader pronunciation.
- **Font coverage:** The chosen serif font (Libre Baskerville or similar) must have adequate glyph coverage, or a system font stack fallback must be defined for scripts it doesn't cover.

---

## 10. Testing Strategy

### 10.1 Philosophy

Smudge's core promise is "your work is never lost." The testing strategy is weighted accordingly: the save pipeline gets the most rigorous coverage, and everything else is tested proportionally to its risk.

### 10.2 Unit Tests

**Scope:** Pure functions and business logic in the `shared` and `server` packages.

**Key targets:**
- `countWords()` — correctness for English prose, CJK text, mixed content, empty documents, documents with only structural nodes (no text), edge cases (em dashes, hyphenated compounds, contractions).
- Zod validation schemas — accepts valid input, rejects invalid input with correct error codes.
- Chapter reorder validation — correct set of IDs accepted, missing/extra/duplicate IDs rejected.
- Soft delete and restore logic — correct `deleted_at` behavior, purge eligibility calculation.

**Framework:** Vitest (aligned with Vite, fast, TypeScript-native).

### 10.3 Integration Tests

**Scope:** API routes tested against a real SQLite database (in-memory or temp file).

**Critical path tests (auto-save pipeline):**
- Save succeeds: PATCH chapter with valid content returns 200, content is persisted, word count is updated.
- Save with invalid content: PATCH chapter with malformed JSON returns 400, previous content is preserved unchanged.
- Chapter load: GET chapter returns correct content and metadata.
- Chapter switch save: Simulating rapid PATCH (chapter A) followed by GET (chapter B) — both succeed without data loss.
- Reorder: PUT with correct chapter IDs succeeds; PUT with missing/extra/duplicate IDs returns 400.
- Soft delete: DELETE sets `deleted_at`, item no longer appears in list queries.
- Restore: POST restore clears `deleted_at`, item reappears in list queries.
- Cascade: Deleting a project soft-deletes all its chapters. Restoring a chapter whose project is deleted also restores the project.

**Framework:** Vitest + Supertest (HTTP assertions against Express).

### 10.4 End-to-End Tests

**Scope:** Full user workflows in a real browser against the running application.

**Key scenarios:**
- Create a project, add a chapter, type content, verify auto-save (content persists after page reload).
- Create multiple chapters, reorder via drag-and-drop, verify new order persists.
- Delete a chapter, verify it appears in trash, restore it, verify it's back.
- Open preview, verify all chapters render with correct titles and content.
- Keyboard-only: create a project, add a chapter, type, toggle preview, return to editor — all without mouse.
- Save failure simulation: take the API offline (e.g., network intercept), verify "Unable to save" warning appears, bring API back, verify content is saved successfully.

**Framework:** Playwright (cross-browser, excellent for accessibility testing, supports network interception for failure simulation).

### 10.5 Accessibility Testing

- **Automated:** aXe-core integrated into Playwright e2e tests. Run against home screen, editor, preview, and dialogs.
- **Manual:** Keyboard-only walkthrough of all user stories. Screen reader spot-check with VoiceOver (macOS) or NVDA (Windows) at least once before MVP launch.

---

## 11. Docker Configuration

### 11.1 docker-compose.yml (target)

```yaml
services:
  smudge:
    build: .
    ports:
      - "${SMUDGE_PORT:-3456}:3456"
    volumes:
      - smudge-data:/app/data
    environment:
      - DB_PATH=/app/data/smudge.db

volumes:
  smudge-data:
```

### 11.2 Persistence

The SQLite database file lives at `/app/data/smudge.db` inside the container. The `smudge-data` Docker volume ensures this persists across container restarts, rebuilds, and upgrades.

**Backup:** A writer's backup strategy is simple: `docker cp` the volume, or bind-mount to a host directory and include it in normal backups. Soft delete (§4.5) provides a 30-day safety net for accidental deletions, but is not a substitute for backups against disk failure or corruption.

### 11.3 Project Structure (target)

```
smudge/
├── docker-compose.yml
├── Dockerfile
├── package.json              # Root workspace config
├── packages/
│   ├── shared/               # Shared types, validation, and logic
│   │   ├── src/
│   │   │   ├── types.ts      # Project, Chapter types
│   │   │   ├── schemas.ts    # Zod validation schemas
│   │   │   └── wordcount.ts  # countWords() — used by client and server
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── server/               # Express backend
│   │   ├── src/
│   │   │   ├── index.ts      # Server entry point
│   │   │   ├── routes/       # API route handlers
│   │   │   ├── db/           # Database setup + queries
│   │   │   └── migrations/   # Knex migration files
│   │   ├── __tests__/        # Unit and integration tests
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── client/               # React frontend
│       ├── src/
│       │   ├── App.tsx
│       │   ├── strings.ts    # All UI strings (i18n-ready)
│       │   ├── components/   # UI components
│       │   ├── hooks/        # Custom React hooks
│       │   ├── pages/        # Home, Editor, Preview
│       │   └── api/          # API client functions
│       ├── index.html
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       └── tailwind.config.ts
├── e2e/                      # Playwright end-to-end tests
│   ├── tests/
│   └── playwright.config.ts
└── data/                     # SQLite DB (Docker volume mount target)
```

The monorepo uses npm workspaces. The `shared` package is the critical piece: types defined there (e.g., `Project`, `Chapter`, `CreateProjectRequest`) are imported by both `server` and `client`, ensuring API contracts are enforced at compile time. The `countWords()` function also lives here, guaranteeing client and server word counts always agree.

### 11.4 Path to Electron (Future)

The TypeScript-everywhere architecture is specifically designed so that, when the time comes, wrapping Smudge in Electron requires:

1. A new `packages/electron/` workspace that imports `server` and `client`.
2. Electron's main process starts the Express server on a random local port.
3. Electron's renderer loads the React frontend, pointed at that local server.
4. `better-sqlite3` works natively in Electron (it's a common pairing).
5. Package with electron-builder for macOS, Windows, and Linux installers.

No rewrite. No port. Just packaging.

---

## 12. Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Save latency | < 500ms from debounce trigger to confirmed save |
| Chapter load time | < 200ms for chapters up to 50,000 words |
| Preview render time | < 2 seconds for a 100,000-word manuscript |
| Browser support | Latest Chrome, Firefox, Safari, Edge. No IE. |
| Accessibility | WCAG 2.1 Level AA (see §8) |
| Data loss risk | Zero, given auto-save with retry, client-side cache, `beforeunload` guard, soft delete, and SQLite WAL mode |
| Container startup | < 10 seconds from `docker compose up` to usable UI |
| Reduced motion | All animations respect `prefers-reduced-motion` |
| Zoom | Fully usable at 200% browser zoom |
| Test coverage | Save pipeline: integration-tested. All user stories: e2e-tested. Word count: unit-tested with edge cases. |

---

## 13. Out of Scope (MVP)

These are explicitly deferred, not forgotten. Each corresponds to a future phase in the roadmap:

- Export (HTML, PDF, Word, EPUB, Markdown) — Phase 3
- Writer's dashboard with chapter status tracking — Phase 1
- Goals, deadlines, velocity tracking — Phase 2
- Inline notes / annotations — Phase 4
- Fiction mode features (character sheets, scene cards, world-building, timeline) — Phase 5
- Non-fiction mode features (research library, citations, fact-checking) — Phase 6
- Distraction-free mode, split view, dark mode, style linting, TTS, versioning — Phase 7
- UI translation / full i18n — Phase 7+
- Multi-user support, authentication, sharing
- Mobile-optimized layout (works on tablets via responsive design, but not specifically optimized)
- Offline support / PWA

---

## 14. Success Criteria

The MVP is successful if:

1. **Ovid uses it instead of Google Docs** for at least one active writing project within a week of deployment.
2. **No data loss** occurs during normal use over a 30-day period.
3. **The writing experience feels faster and more focused** than Google Docs for chapter-based work.
4. **A keyboard-only user can perform all core operations** without touching a mouse.
5. **All e2e tests pass**, including the save-failure recovery scenario.

These are subjective (except #4 and #5), and that's fine. This is a tool for one writer. The writer's judgment is the only metric that matters.

---

## 15. Resolved Design Decisions

These were evaluated during PRD development and are recorded here as decisions, not open questions.

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | TipTap content storage format | **JSON** (TipTap native) as source of truth. HTML generated on-demand for preview and export. | Round-trip fidelity, extensibility for custom nodes (inline notes, citations, fact-check flags in later phases), structured operations (word count, annotation extraction). Trade-off: TipTap lock-in; mitigated by one-time migration if editor is ever replaced. |
| 2 | Chapter title: editor, sidebar, or both? | **Metadata in DB**, displayed above editor (editable by double-click) and in sidebar. Not part of TipTap content. | Avoids inflating word count, prevents accidental deletion, cleanly separates structure from content for export. |
| 3 | Preview table of contents | **Yes, in MVP.** Floating/collapsible TOC with anchor links. | Without TOC, preview is unusable for manuscripts over ~10 chapters. |
| 4 | Keyboard shortcuts in MVP | **Three Smudge-specific shortcuts** (toggle preview, new chapter, toggle sidebar) plus help dialog. TipTap formatting shortcuts included for free. | Keeps scope small. Chapter navigation shortcuts deferred to Phase 1 to avoid auto-save timing edge cases. |
| 5 | Accessibility | **WCAG 2.1 AA from day one.** Full keyboard navigation, screen reader support, semantic HTML, color-independent status, reduced motion support. | Retrofitting a11y is always more expensive than building it in. A writing app that can't be used with a keyboard is a broken writing app. |
| 6 | Internationalization | **English UI for MVP, with string externalization for future translation.** Full Unicode/RTL/CJK content support from day one. | Zero immediate users need non-English UI. But writers may write in any language, so content handling must be universal. String externalization makes future UI translation a mechanical task. |
| 7 | Tech stack | **TypeScript everywhere** (Node.js/Express 4.x backend, React frontend). Docker for deployment now, Electron for desktop packaging later. | Unified language enables shared types, shared validation, and a clean path to Electron without rewriting the backend. Express 4.x chosen over 5 for ecosystem maturity. |
| 8 | Preview TOC scroll-aware highlighting | **Two-pass delivery.** Static TOC with anchor links ships first. Scroll-aware highlighting (intersection observer marking the current chapter) is delivered as a fast-follow within Phase 0, after the core editor and save loop are solid. | Avoids a perfectionism trap on intersection observer edge cases during the critical path of MVP development. |
| 9 | Data deletion model | **Soft delete with 30-day retention.** `deleted_at` column on projects and chapters. Trash view with restore. Background purge of items older than 30 days. | A single misclick should never destroy months of work. Full versioning is Phase 7; soft delete is the minimal safety net. |
| 10 | Word count algorithm | **Shared `countWords()` function** in the `shared` package using `Intl.Segmenter`. Used by both client (live display) and server (persisted `word_count` column). | Single source of truth prevents client/server disagreement. `Intl.Segmenter` handles CJK, hyphenated compounds, and Unicode correctly. |
| 11 | Error handling | **Defined error envelope, retry logic, and `beforeunload` guard.** See §6.1. | Auto-save failure is the highest-risk scenario in a writing app. The error strategy must be specified, not left to implementation-time decisions. |
| 12 | Auto-save on chapter switch | **Force immediate non-blocking save**, bypass debounce timer, load new chapter optimistically, hold unsaved content in client cache until confirmed. | Prevents data loss during the common workflow of switching between chapters mid-thought. |
| 13 | `better-sqlite3` event loop risk | **Acknowledged, not mitigated in MVP.** Synchronous API is acceptable for single-user small queries. Worker thread offloading evaluated if future features require heavy queries. | Over-engineering for a problem that won't manifest with the MVP's data access patterns. |
| 14 | `dnd-kit` library version | **Legacy `@dnd-kit/sortable` v10.** Evaluate migration to `@dnd-kit/react` when it reaches 1.0. | Legacy version is stable with 5M+ weekly downloads. New version is pre-1.0. Reordering logic is isolated to one component, so migration is contained. |
| 15 | Chapter reorder API semantics | **`PUT /api/projects/{id}/chapters/order`** with full list of chapter IDs. 400 on mismatch. | PUT semantics match the "full replacement" behavior. Explicit contract prevents ambiguity about omitted or extra IDs. |
| 16 | Testing strategy | **Full: unit + integration + e2e.** Save pipeline integration-tested, all user stories e2e-tested (including save failure recovery), word count unit-tested, a11y automated via aXe + manual screen reader check. | The save pipeline is too critical and its interactions too subtle for manual QA alone. |

---

## Appendix A: Future Phase Summary

| Phase | Name | Key Features |
|-------|------|-------------|
| 0 | **MVP (this document)** | Projects, chapters, rich text editor, auto-save with retry, word count, preview with TOC, soft delete/trash, a11y, string externalization, full test suite |
| 1 | Writer's Dashboard | Chapter status labels, project overview dashboard, chapter navigation shortcuts |
| 2 | Goals & Velocity | Word targets, deadlines, daily tracking, burndown, session stats (net vs. gross words) |
| 3 | Export | HTML, PDF, Word, Markdown, EPUB with chapter structure and TOC |
| 4 | Writer's Annotations | Inline notes, scratchpad/outtakes, find-and-replace across manuscript, tags/cross-references |
| 5 | Fiction Mode | Character sheets, scene cards, world-building bible, relationship maps, timeline view, "who's in the room" tracker |
| 6 | Non-Fiction Mode | Research library with tagging, citations (footnote/endnote/inline), fact-check flags, argument mapping, research side panel |
| 7 | Polish & Power | Distraction-free mode, split view, dark mode, style linting, text-to-speech, versioning/snapshots, writing journal, UI i18n |
