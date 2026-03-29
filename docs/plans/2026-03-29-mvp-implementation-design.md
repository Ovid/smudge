# MVP Implementation Design

**Date:** 2026-03-29
**Approach:** Vertical slices with TDD (red/green/refactor) throughout
**Spec:** `docs/plans/mvp.md`

---

## Cross-Slice Constraints

**CSS custom properties for all visual values.** All colors, backgrounds, and borders must be defined as CSS custom properties (mapped to Tailwind theme tokens), not hardcoded values. Dark mode is Phase 7, but retrofitting hardcoded colors across every component is days of work. Defining tokens from the start costs one or two hours of setup in slice 0 and zero user-facing cost. This is a discipline constraint, not a feature.

---

## Slice 0: Monorepo Scaffold & Tooling

npm workspaces with three packages: `shared`, `server`, `client`. Root `package.json` defines workspace layout. Each package gets its own `tsconfig.json` extending a shared base config at the root.

**Shared** is built first (both server and client depend on it). Contains TypeScript types and Zod schemas. Ships ESM (`"type": "module"` in package.json) — Vite consumes it natively, Node 20 handles ESM, no CJS/ESM friction.

**Server** uses Express 4.x, better-sqlite3, Knex. Vitest + Supertest for testing.

**Client** uses Vite + React 18 + TypeScript + TipTap v2 + Tailwind CSS. Vitest for testing. React Router for client-side navigation (`/`, `/projects/:id`, `/projects/:id/preview`, `/trash`). Vite `server.proxy` forwards `/api/*` to Express in dev (no CORS middleware needed).

**Tailwind theme:** Define all colors, backgrounds, and borders as CSS custom properties in a theme file, mapped to Tailwind tokens. All components use tokens, never raw color values.

**Dev workflow:** `npm run dev` at root starts both server (tsx watch) and client (Vite dev server with API proxy to Express). Single command.

**Linting:** ESLint + Prettier, shared config at root. Strict TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`).

**Test commands:** `npm test` at root runs all packages. `npm test -w packages/server` for one package. `npm run test:e2e` for Playwright (added in slice 9).

---

## Slice 1: Create Project & Write in a Chapter

First feature slice. By the end: create a project, see a chapter, type in TipTap, confirm content persists after page refresh.

### Shared (TDD)

- Zod schemas: `CreateProjectSchema` (title required, mode enum), `UpdateChapterSchema` (title optional, content optional as valid JSON).
- TypeScript types: `Project`, `Chapter`, API request/response shapes.
- Note: `countWords()` is deferred to slice 3 where it's first meaningfully displayed.

### Server (TDD with Supertest)

- Knex migration: `projects` and `chapters` tables with all columns from spec.
- `GET /api/health` — returns 200 with `{ "status": "ok" }`. Available from day one for dev checks and Docker healthcheck later.
- Routes: `POST /api/projects` (creates project + auto-creates first chapter), `GET /api/projects`, `GET /api/projects/:id` (project + chapters), `GET /api/chapters/:id`, `PATCH /api/chapters/:id` (update content).
- Validation via shared Zod schemas. Error envelope format from spec.
- Integration tests against real SQLite (in-memory).

### Client (minimal)

- Home page: project list, "New Project" button with title + mode input.
- Editor page: project title, single chapter, TipTap editor with heading levels configured as H3/H4/H5 (writer sees "Heading 1/2/3" but DOM maintains correct hierarchy under the H2 chapter title).
- No auto-save yet. Temporary save-on-blur (removed in slice 2).
- Tailwind styling with spec's color palette and typography from day one, using theme tokens (no hardcoded colors).

---

## Slice 2: Auto-Save Pipeline

The trust backbone. TDD is especially critical here.

### Client-side save manager (TDD)

- 1.5-second debounce after last keystroke triggers save.
- On failure: retry up to 3 times with exponential backoff (2s, 4s, 8s).
- Client-side cache holds unsaved content in memory until server confirms. Content never discarded on failure.
- `beforeunload` handler registered when unsaved changes exist, removed on success.
- Status state machine: `idle` -> `saving` -> `saved` / `error`. Temporary save button from slice 1 removed.

### Status indicator

- "Saving..." during request.
- "Saved" on success (brief animation, respects `prefers-reduced-motion`).
- "Unable to save -- check connection" persistent warning after all retries fail.
- Text-based, not color alone. `aria-live="polite"`.

### Server hardening

- `PATCH /api/chapters/:id` validates content is valid JSON and has a `type: "doc"` root node before overwriting. Returns 400 with `code: "INVALID_CONTENT"` if malformed. Previous content preserved. (No full ProseMirror schema validation — catches corruption without risking false rejections.)

### Tests

- Debounce fires after 1.5s of inactivity.
- Retry logic: mock fetch failures, verify 3 retries with correct timing.
- Client cache: content survives failed saves, sends on next success.
- `beforeunload` registered/unregistered correctly.
- Server rejects invalid JSON, preserves previous content.

---

## Slice 3: Chapter Management

Multiple chapters, sidebar, chapter switching.

### Shared (TDD)

- `countWords(tiptapJson)` with edge cases: English prose, CJK text, empty doc, structural-only nodes, hyphenated compounds, contractions. Uses `Intl.Segmenter`.

### Server (TDD)

- `POST /api/projects/:id/chapters` -- "Untitled Chapter", empty content, `sort_order` appended.
- `DELETE /api/chapters/:id` -- soft-delete (sets `deleted_at`). Full trash UI in slice 5, but API correct now.
- `PATCH /api/chapters/:id` now recalculates `word_count` server-side on content update using shared `countWords()`.
- `GET /api/projects/:id` excludes soft-deleted chapters, orders by `sort_order`.
- Tests: create multiple chapters, verify ordering. Delete chapter, verify excluded from list but still in DB. Word count updated on save.

### Client -- Sidebar

- Left sidebar (~260px), collapsible via Cmd/Ctrl+Shift+\\.
- Chapter list in sort order. Active chapter highlighted with `aria-current="true"`.
- "Add Chapter" button at bottom.
- Inline chapter title editing.
- Delete with confirmation dialog using `<dialog>`, focus trapping, `role="alertdialog"`.

### Chapter switching with auto-save

- On switch: unsaved changes trigger immediate save (bypass debounce). New chapter loads optimistically. Client cache holds unsaved content until confirmed.
- Tests: rapid switch doesn't lose content. Switch during failed save retains content in cache.

### Word count (status bar)

- Chapter + total manuscript word count, always visible. Client uses shared `countWords()` for live display.
- `aria-live="polite"`, updated on save (not every keystroke).

---

## Slice 4: Chapter Reordering

Focused, narrow slice. Deliberately isolated for potential library migration later.

### Server (TDD)

- `PUT /api/projects/:id/chapters/order` -- accepts `{ "chapter_ids": ["id1", "id2", ...] }`. Must contain exactly all non-deleted chapter IDs.
- Returns 400 with `code: "REORDER_MISMATCH"` on missing, extra, or duplicate IDs.
- Tests: valid reorder succeeds. Missing/extra/duplicate/soft-deleted IDs rejected.

### Client -- Drag-and-drop

- @dnd-kit/sortable on sidebar chapter list. Drag handle on hover, drop target highlighting.
- Optimistic UI update, `PUT` to server, rollback on failure.

### Client -- Keyboard alternative

- Alt+Up/Down to reorder selected chapter.
- Live region: "Chapter '[title]' moved to position 3 of 7."
- Same API call and optimistic update as drag-and-drop.

### Tests

- Drag reorder triggers correct API with correct ID order.
- Keyboard reorder triggers same API.
- Optimistic update rolls back on server error.
- Live region announces new position.

---

## Slice 5: Soft Delete & Trash

Completes the data safety story.

### Server (TDD)

- `GET /api/trash` -- all soft-deleted items with id, title, type, `deleted_at`.
- `POST /api/trash/:id/restore` -- clears `deleted_at`. Looks up UUID in projects table first, then chapters (UUIDs are globally unique, no collision risk). Restoring a chapter whose project is deleted also restores the project.
- `DELETE /api/trash/:id` -- hard delete (permanent). Same UUID lookup strategy.
- `DELETE /api/projects/:id` -- soft-deletes project and all its chapters (cascade).
- Background purge on server startup: items where `deleted_at` > 30 days.
- Tests: cascade delete. Restore chapter restores deleted parent. Hard delete removes from DB. Purge respects 30-day boundary (exactly 30 days kept, 31 purged).

### Client -- Trash view

- Accessible from home screen.
- Lists soft-deleted items with title, type, deletion date.
- "Restore" and "Delete permanently" per item. Permanent delete has irreversibility warning dialog.

### Existing UI updates

- Project delete from home screen uses soft-delete with spec's confirmation dialog.
- Chapter delete (slice 3) already uses soft-delete API.

---

## Slice 6: Preview Mode

Read-through experience for the full manuscript.

### Server (TDD)

- `GET /api/projects/:id/preview` -- all non-deleted chapters in `sort_order` with full TipTap JSON content.
- Tests: correct order, excludes soft-deleted, empty project returns empty array.

### Client -- Preview

- Triggered by "Preview" button or Cmd/Ctrl+Shift+P.
- Full-screen overlay hiding editor UI.
- Chapters rendered via TipTap `generateHTML()` with chapter title as H2. Clear visual separation.
- Serif font, ~680px max-width centered, generous line height.
- "Back to Editor" is first focusable element. Escape also exits.
- Clicking chapter heading returns to editor with that chapter open.

### Client -- Table of contents

- Fixed-position collapsible TOC with `role="navigation"`, `aria-label="Table of contents"`.
- Chapter titles as anchor links.
- Keyboard accessible.

### Client -- Keyboard shortcut help dialog

- Triggered by Cmd/Ctrl+/. Lists all Smudge shortcuts and TipTap formatting shortcuts.
- Proper `<dialog>` with focus trapping. This is the last shortcut added, so the help dialog is complete.

### Tests

- Preview renders all chapters in order. TOC links scroll correctly. Escape exits. Chapter heading click opens editor. Cmd/Ctrl+Shift+P toggles. Help dialog opens and lists shortcuts.

---

## Slice 7: Accessibility Audit (Verification Only)

Pure audit and remediation. No new features. Earlier slices build with a11y (semantic HTML, ARIA, heading hierarchy, keyboard alternatives). This slice verifies everything works together.

### Semantic structure audit

- All interactive elements are `<button>` or `<a>`. No clickable `<div>`/`<span>`.
- ARIA landmarks: `<aside aria-label="Chapters">`, `<main>`, `role="toolbar" aria-label="Formatting"`, status bar with `aria-live`.
- Heading hierarchy verified: H1 (project title), H2 (chapter titles), H3/H4/H5 (in-content headings).

### Keyboard navigation

- Tab order walkthrough of every screen: home, editor, preview, trash, dialogs.
- Visible focus indicators (3:1 contrast minimum).
- No keyboard traps except modal dialogs.

### Screen reader support

- `aria-pressed` on formatting toggles.
- `aria-current="true"` on active chapter (sidebar and TOC).
- Live regions for save status, word count, reorder feedback.
- `role="alertdialog"` with `aria-describedby` on confirmation dialogs.

### Visual checks

- All colors meet AA contrast (4.5:1 body, 3:1 large text/UI).
- All colors use theme tokens (no hardcoded values — verify cross-slice discipline).
- `prefers-reduced-motion` disables animations.
- Usable at 200% zoom without horizontal scroll.
- No information conveyed by color alone.

### TipTap audit

- Screen reader behavior in editor. Document known ProseMirror gaps.

---

## Slice 8: Docker & Deployment

### Dockerfile

- Multi-stage build. Stage 1: install deps, build all packages. Stage 2: production image with server dist, client dist, production node_modules.
- Express serves built client static files and API from one process on port 3456.
- `better-sqlite3` native compilation handled in build stage.

### docker-compose.yml

- Configurable port via `SMUDGE_PORT` (default 3456). `DB_PATH` env var. `smudge-data` named volume at `/app/data`.

### Startup

- Knex migrations run on startup (creates tables if DB is new).
- 30-day trash purge runs on startup.
- Target: usable within 10 seconds of `docker compose up`.

### Smoke test

- Build image, start container, hit health endpoint, create project, save chapter.

---

## Slice 9: E2E Test Suite

Playwright browser-level verification of all user stories.

### Setup

- `e2e/` directory with `playwright.config.ts`. Runs against Docker container or local dev server.
- aXe-core via `@axe-core/playwright` on every major page state.

### Scenarios

- Create project, add chapter, type, reload, verify persistence.
- Create multiple chapters, drag-and-drop reorder, verify order persists after reload.
- Delete chapter, verify in trash, restore, verify back in sidebar.
- Delete project, verify chapters in trash. Restore chapter, verify project also restored.
- Preview: all chapters in order, TOC links work.
- Keyboard-only: full workflow (create, add, type, preview, return) without mouse.

### Save-failure scenario

- Network interception blocks API. Verify "Unable to save" warning. Unblock. Verify save succeeds and status returns to "Saved."

### Accessibility

- aXe-core on: home, editor, preview, trash, confirmation dialogs.
