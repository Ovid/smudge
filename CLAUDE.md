# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

When you have finished reading this file, announce "CLAUDE.md loaded"

## Project Overview

Smudge is a web-based writing application for long-form fiction and non-fiction, organized as projects containing chapters. It replaces Google Docs for book-length work. Single-user, no auth. The full MVP spec lives in `docs/plans/mvp.md`.

**Current status:** Greenfield — spec complete, no source code yet.

## Tech Stack

- **Monorepo:** npm workspaces with three packages: `shared`, `server`, `client`
- **Language:** TypeScript everywhere (frontend + backend + shared)
- **Backend:** Node.js 20 LTS, Express 4.x, better-sqlite3 (synchronous), Knex.js (migrations/queries), Zod (validation)
- **Frontend:** React 18+, Vite, TipTap v2 (rich text editor, stores content as JSON not HTML), Tailwind CSS, @dnd-kit/sortable v10
- **Testing:** Vitest (unit + integration with Supertest), Playwright (e2e + aXe-core a11y)
- **Deployment:** Single Docker container, Express serves API + static frontend on port 3456, SQLite persisted via Docker volume

## Target Project Structure

```
packages/
  shared/       # Types, Zod schemas, countWords() — imported by both server and client
  server/       # Express API, routes/, db/, migrations/
  client/       # React SPA, components/, hooks/, pages/, api/, strings.ts
e2e/            # Playwright tests
```

## Build & Run Commands (Target)

```bash
# Development
make dev                             # Start both server + client dev servers
npm install                          # Install all workspace dependencies

# Testing & Quality
make test                            # Run full test suite (all packages)
make lint                            # Lint with autofix
make format                          # Format code
make all                             # Lint + format + test (full CI pass)
make cover                           # Generate code coverage report

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
- `PUT /api/projects/{id}/chapters/order` — full chapter ID list required, 400 on mismatch
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

- Warm earth tones: off-white background (#FAF8F5), dark charcoal text (#2D2D2D), warm amber/ochre accent
- Sans-serif UI chrome (Inter), serif writing area (Libre Baskerville/Lora/Merriweather, 18-20px)
- Editor max-width 720px; preview max-width ~680px centered
- Sidebar ~260px, collapsible

## Data Model

Two tables: **Project** (id, title, mode, created_at, updated_at, deleted_at) and **Chapter** (id, project_id, title, content as TipTap JSON, sort_order, word_count, created_at, updated_at, deleted_at). Both use UUID primary keys.

## Testing Philosophy

The save pipeline gets the most rigorous coverage — it's the core trust promise. Integration tests run against real SQLite (not mocks). E2e tests cover all user stories including save-failure recovery via network interception. aXe-core runs in Playwright for automated a11y checks. ALL CODE MUST USE RED-GREEN-REFACTOR if feasible.

**Coverage thresholds are enforced in `vitest.config.ts` (95% statements, 85% branches, 90% functions, 95% lines).** If coverage drops below these thresholds, the goal is always to increase coverage as much as possible by writing meaningful tests for the uncovered code — never simply adjust the thresholds downward or write minimal/trivial tests just to meet the minimum. Aim to push coverage higher, not coast at the floor.
