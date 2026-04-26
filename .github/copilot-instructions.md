# GitHub Copilot Instructions

This file provides guidance to GitHub Copilot when working with code in this repository.

## Ignore `.devcontainer/`

Do not read, edit, or suggest changes to anything under `.devcontainer/`
(Dockerfile, devcontainer.json, post_install.py, .zshrc, etc.). The
directory is bind-mounted read-only inside the running devcontainer, so
edits cannot land from inside the container anyway, and the contents
are intentionally maintained out-of-band — recommended changes go into
`paad/code-reviews/deferred/*.patch` for the maintainer to apply from
the host. Skip this directory in code search, suggestions, and any
"explore the repo" passes unless the user explicitly asks about it.

## Project Overview

Smudge is a web-based writing application for long-form fiction and non-fiction, organized as **projects** containing **chapters**. It is designed to replace Google Docs for book-length work. Single-user, no authentication. The full MVP spec lives in `docs/plans/mvp.md`.

## Tech Stack

- **Monorepo:** npm workspaces with three packages: `shared`, `server`, `client`
- **Language:** TypeScript everywhere (frontend + backend + shared)
- **Backend:** Node.js 22 LTS (Jod), Express 4.x, better-sqlite3 (synchronous), Knex.js (migrations/queries), Zod (validation)
- **Frontend:** React 18+, Vite, TipTap v2 (rich text editor, stores content as JSON not HTML), Tailwind CSS, @dnd-kit/sortable v10
- **Testing:** Vitest (unit + integration with Supertest), Playwright (e2e + aXe-core a11y)
- **Deployment:** Single Docker container, Express serves API + static frontend on port 3456, SQLite persisted via Docker volume

## Project Structure

```
packages/
  shared/       # Types, Zod schemas, countWords() — imported by both server and client
  server/       # Express API, domain modules, db/, migrations/
    src/
      projects/           # routes, service, repository, types
      chapters/           # routes, service, repository, types
      velocity/           # routes, service, repository, types, injectable
      settings/           # routes, service, repository, types
      chapter-statuses/   # routes, service, repository, types
      db/                 # connection singleton, migrations/
  client/       # React SPA, components/, hooks/, pages/, api/, strings.ts
e2e/            # Playwright tests
```

**Architecture:** Routes → Services → Repositories. Routes handle HTTP only; services handle business logic and transactions; repositories encapsulate all SQL/Knex. Services may call other domains' repositories for cross-domain data access.

## Build & Run Commands

```bash
# Development
make dev                             # Start both server + client dev servers
npm install                          # Install all workspace dependencies

# Testing & Quality
make test                            # Run full test suite (fast, no coverage)
make lint                            # Lint with autofix
make format                          # Format code
make all                             # Full CI pass: lint + format + typecheck + coverage + e2e
make cover                           # Run tests with coverage enforcement
make ensure-native                   # Verify better-sqlite3 native binding; rebuild from source on dlopen failure

# Per-package testing (when working on one package)
npm test -w packages/shared          # Unit tests (Vitest)
npm test -w packages/server          # Unit + integration tests (Vitest + Supertest)
npm test -w packages/client          # Client tests (Vitest)
npx playwright test                  # E2e tests

# Build & Deploy
make build                           # Build client for production
docker compose up                    # Full app on port 3456

# Help
make help                            # Show all available make targets
```

`make ensure-native` is a prerequisite of `dev`/`test`/`cover`/`e2e`. It probes whether better-sqlite3's `.node` binary loads under the active platform/Node ABI; on dlopen failure it rebuilds from source in place (no remote `.node` binary is fetched). The rebuild path needs a working C++ toolchain (`build-essential` on Linux, Xcode Command Line Tools on macOS) and `python3` for node-gyp. Common need: switching between a macOS host and a Linux container/VM that share `node_modules` via a bind mount.

## Key Architecture Decisions

**TipTap JSON as source of truth.** Chapter content is stored as TipTap's native JSON, not HTML. HTML is generated on-demand via `generateHTML()` for preview/export. This enables structured operations (word counting walks the JSON tree) and future custom node types.

**Shared `countWords()` function.** Lives in `packages/shared/`, used by both client (live display) and server (persisted `word_count` column). Uses `Intl.Segmenter` with `granularity: 'word'` for correct CJK and Unicode handling. Client and server word counts must always agree.

**Chapter titles are DB metadata**, not part of TipTap content. Prevents word count inflation and accidental deletion.

**Soft delete everywhere.** Projects and chapters use a `deleted_at` timestamp. All queries must filter `deleted_at IS NULL`. Trash view allows 30-day recovery; background purge on server startup.

**Auto-save with retry.** 1.5s debounce, 3 retries with exponential backoff (2s/4s/8s), persistent "Unable to save" warning on total failure, `beforeunload` guard, client-side cache holds unsaved content until server confirms. On chapter switch, immediate save bypasses debounce.

**String externalization.** All UI strings in `packages/client/src/strings.ts` as constants, never raw literals in components. Prepares for future i18n without architectural changes.

## API Design

REST endpoints under `/api/`. Error envelope: `{ "error": { "code": "MACHINE_READABLE", "message": "Human-readable" } }`. HTTP status codes: 200, 201, 400, 404, 500.

Key endpoints:
- `PATCH /api/chapters/{id}` — auto-save target; recalculates word count server-side; rejects invalid JSON with 400 (preserves previous content)
- `PUT /api/projects/{slug}/chapters/order` — full chapter ID list required, 400 on mismatch
- `POST /api/chapters/{id}/restore` — restoring a chapter whose project is deleted also restores the project

## Accessibility (WCAG 2.1 AA — Mandatory)

This is a first-class design constraint, not optional:
- Semantic HTML (`<nav>`, `<main>`, `<aside>`, `<button>`, `<dialog>`) — no `<div>`/`<span>` as interactive elements
- ARIA landmarks on all major regions; `aria-live="polite"` for save status and word count
- Full keyboard navigation; visible focus indicators (3:1 contrast)
- Chapter reordering via Alt+Up/Down as drag-and-drop alternative, with live region feedback
- `prefers-reduced-motion` respected; text readable at 200% zoom
- Color never the sole information carrier

## Visual Design

- Warm earth tones: off-white background (`#F7F3ED`), dark charcoal text (`#1C1917`), warm amber/ochre accent (`#6B4720`)
- Sans-serif UI chrome (DM Sans), serif for the writer's words (Cormorant Garamond, 18–20px)
- **Serif = the manuscript:** editor content, chapter titles, project titles, preview mode, logo
- **Sans-serif = the tool:** navigation, buttons, dialogs, labels, status indicators
- Fonts are self-hosted via `@fontsource` packages (no external CDN)
- Editor max-width 720px; preview max-width ~680px centered
- Sidebar ~260px, collapsible

## Data Model

Five tables, all using UUID primary keys (except `settings` and `chapter_statuses`):

- **projects** — id, title, slug, mode, target_word_count, target_deadline, created_at, updated_at, deleted_at
- **chapters** — id, project_id (FK), title, content (TipTap JSON), sort_order, word_count, status, created_at, updated_at, deleted_at
- **chapter_statuses** — status (PK), sort_order, label. Seed data; defines chapter workflow statuses.
- **settings** — key (PK), value. Key-value store for app settings (e.g., timezone).
- **daily_snapshots** — id, project_id (FK), date, total_word_count, created_at. One row per project per day; upserted on each save.

## Testing Philosophy

The save pipeline gets the most rigorous coverage — it's the core trust promise. Integration tests run against real SQLite (not mocks). E2e tests cover all user stories including save-failure recovery via network interception. aXe-core runs in Playwright for automated a11y checks. All code should use red-green-refactor where feasible.

**Coverage thresholds are enforced** (95% statements, 85% branches, 90% functions, 95% lines). The goal is always to increase coverage by writing meaningful tests — never adjust thresholds downward.

## Key Implementation Details

- **Single-user, no auth, synchronous SQLite (better-sqlite3).** Concurrency races between requests are not a practical concern — there is one user and SQLite serializes writes.
- **Velocity tracking is best-effort.** Daily snapshots are recorded outside the main save transaction. Failures are logged but never break the save pipeline.
- **Soft delete everywhere.** All queries must filter `deleted_at IS NULL`. Trash view allows 30-day recovery; background purge on server startup.
