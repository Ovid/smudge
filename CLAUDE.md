# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

When you have finished reading this file, announce "CLAUDE.md loaded"

Always address me as "Ovid" in your responses. This lets me know that you have read this file, even if I don't see the previous announcement.

## Ignore `.devcontainer/`

`.devcontainer/` is **third-party content** managed out-of-band
(devcontainer template). Any local change is **wiped on the next update
of the template** — including changes the maintainer applies from the
host or edits the maintainer makes by hand. The directory is also
bind-mounted read-only inside the running devcontainer, so edits cannot
land from inside the container anyway. There is no path by which a
`.devcontainer/`-targeted change persists across a template update.

Concretely, this means:
- **Do not read** files under `.devcontainer/` (Dockerfile,
  devcontainer.json, post_install.py, .zshrc, etc.).
- **Do not edit or suggest edits** to anything under `.devcontainer/`,
  and do not stage changes elsewhere intended for the maintainer to
  apply to `.devcontainer/`. The maintainer's only path to changing
  `.devcontainer/` is upstream of the template itself.
- **Do not flag findings inside `.devcontainer/` for fixing.** A bug,
  hardening opportunity, or hygiene issue in `.devcontainer/` is out
  of scope for this project. Skip the directory in code search, in any
  "explore the repo" passes, in `/paad:agentic-review` runs, and in
  the out-of-scope-findings backlog.

Override only if the user explicitly asks about a specific
`.devcontainer/` file in this conversation.

## Project Overview

Smudge is a web-based writing application for long-form fiction and non-fiction, organized as projects containing chapters. It replaces Google Docs for book-length work. Single-user, no auth. The full MVP spec lives in `docs/plans/mvp.md`.

**Current status:** Active development — MVP implementation in progress.

## Tech Stack

- **Monorepo:** npm workspaces with three packages: `shared`, `server`, `client`
- **Language:** TypeScript everywhere (frontend + backend + shared)
- **Backend:** Node.js 22 LTS (Jod; see CONTRIBUTING.md for the DEP0040 workaround), Express 4.x, better-sqlite3 (synchronous), Knex.js (migrations/queries), Zod (validation)
- **Frontend:** React 18+, Vite, TipTap v2 (rich text editor, stores content as JSON not HTML), Tailwind CSS, @dnd-kit/sortable v10
- **Testing:** Vitest (unit + integration with Supertest), Playwright (e2e + aXe-core a11y)
- **Deployment:** Single Docker container, Express serves API + static frontend on port 3456, SQLite persisted via Docker volume

## Target Project Structure

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
  client/       # React SPA, components/, hooks/, pages/, api/, errors/, strings.ts
e2e/            # Playwright tests
```

**Architecture:** Routes → Services → Repositories. Routes handle HTTP; services handle business logic and transactions; repositories encapsulate all SQL/Knex.

## Build & Run Commands (Target)

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
make e2e                             # Run Playwright e2e tests (starts dev servers)
make e2e-clean                       # Wipe the isolated e2e data dir (next `make e2e` starts fresh)
make ensure-native                   # Verify better-sqlite3 native binding loads; rebuild from source on dlopen failure

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

**`make e2e-clean`** wipes the isolated e2e data dir (under
`os.tmpdir()/smudge-e2e-data-<UID>/`) so the next `make e2e` starts
against a fresh SQLite DB and image store. The recipe refuses to wipe
while a live `make e2e` is running (it probes 127.0.0.1:3457 and
::1:3457 for the e2e server), so it's safe to run in a stray terminal.
**Do not** run `make e2e-clean` concurrently with the start-up phase of
`make e2e` (the first 1–3s while Knex migrations are running and
`app.listen` has not yet bound) — the probe sees ECONNREFUSED, proceeds
to rm, and the about-to-bind server then migrates against an empty DB.
Wait for `make e2e` to finish (or kill it) before running cleanup.

**`make ensure-native`** is a prerequisite of `make test/cover/e2e/dev`; you rarely invoke it directly. It probes whether better-sqlite3's `.node` binary loads under the active platform/Node ABI, and on failure rebuilds from source in place (no remote `.node` binary fetched). The rebuild path needs a working C++ toolchain — `build-essential` on Linux, Xcode Command Line Tools on macOS, plus `python3` for node-gyp. Common reason to need it: switching between host (macOS) and a Linux container/VM that share `node_modules` via a bind mount, leaving a wrong-platform binary in place. Direct `npm test` / `npm test -w packages/{shared,server,client}` / `npx playwright test` invocations bypass this check; prefer the `make` entry points after a host↔guest crossing.

## Key Architecture Decisions

**TipTap JSON as source of truth.** Chapter content is stored as TipTap's native JSON, not HTML. HTML is generated on-demand via `generateHTML()` for preview/export. This enables structured operations (word counting walks the JSON tree) and future custom node types.

**Shared `countWords()` function.** Lives in `packages/shared/`, used by both client (live display) and server (persisted `word_count` column). Uses `Intl.Segmenter` with `granularity: 'word'` for correct CJK and Unicode handling. Client and server word counts must always agree.

**Chapter titles are DB metadata**, not part of TipTap content. Prevents word count inflation and accidental deletion.

**Soft delete everywhere.** Projects and chapters use a `deleted_at` timestamp. All queries must filter `deleted_at IS NULL`. Trash view allows 30-day recovery; background purge on server startup.

**Auto-save with retry.** 1.5s debounce, 3 retries with exponential backoff (2s/4s/8s), persistent "Unable to save" warning on total failure, `beforeunload` guard, client-side cache holds unsaved content until server confirms. On chapter switch, immediate save bypasses debounce.

**Save-pipeline invariants.** The following rules are load-bearing — the snapshots/find-and-replace branch required 16 rounds of review because they were applied inconsistently. Any code that triggers a server mutation affecting editor content must obey them:

1. **`markClean()` before any server call that invalidates editor state.** If you call the server *and* the response will overwrite what's on screen (restore, replace, reload), mark the editor clean first so the unmount/auto-save cleanup cannot fire a stale PATCH afterwards.
2. **`setEditable(false)` around any mutation that can fail mid-typing.** The user must not be able to type into content that is about to be overwritten or is in an error state. Restore this *after* success or failure.
3. **Cache-clear happens after server success, never before.** The client-side draft cache is the last line of defense against data loss. Clearing it before the server confirms violates the contract that unsaved content is held until persistence succeeds.
4. **Bump the sequence ref before the request, not after.** Any in-flight response for an older sequence is discarded on return. Bumping after creates a window where stale responses land. Use `useAbortableSequence` (`packages/client/src/hooks/useAbortableSequence.ts`): `start()` bumps and returns a token, `capture()` snapshots the current epoch for cross-axis checks, `abort()` invalidates outstanding tokens, and component unmount auto-aborts. Hand-rolled `useRef<number>` sequence counters are rejected by ESLint.
5. **Error codes stay inside the allowlist.** HTTP status codes are 200, 201, 400, 404, 409, 413, 500 (see §API Design). New conditions get an existing code plus a discriminating `error.code` string — never a new status.

For mutation-via-server flows (snapshot restore, project-wide replace, and future similar operations), route through `useEditorMutation` in `packages/client/src/hooks/useEditorMutation.ts` — it enforces invariants 1–4 by construction. Hand-composing these steps is reserved for flows outside its scope (e.g. snapshot view, which does not mutate content). For any client flow whose response must be discarded when superseded by a newer request or an external epoch change (chapter switch, project switch, unmount), route through `useAbortableSequence` — it encodes the "bump before, check after" contract as tokens, auto-aborts on unmount, and is enforced by ESLint.

**Unified API error mapping.** All client code that surfaces a user-visible
message from an API error must route through `mapApiError(err, scope)` in
`packages/client/src/errors/`. The mapper returns `{ message,
possiblyCommitted, transient, extras? }`; it is the single owner of
code/status-to-string translation and of the cross-cutting rules (ABORTED
is silent, 2xx BAD_JSON is `possiblyCommitted: true` when the scope declares
`committed:` copy and `false` for read scopes that do not, NETWORK is
`transient`). Raw `err.message` must never reach the UI. New API surfaces
add a scope entry to `scopes.ts`; they do not write ad-hoc ladders at call
sites. This invariant will be enforced by ESLint in Phase 4b.4; until then,
it is enforced by review.

**String externalization.** All UI strings in `packages/client/src/strings.ts` as constants, never raw literals in components. Prepares for future i18n without architectural changes.

## API Design

REST endpoints under `/api/`. Error envelope: `{ "error": { "code": "MACHINE_READABLE", "message": "Human-readable" } }`. HTTP status codes: 200, 201, 400, 404, 409, 413, 500. The allowlist governs codes the Smudge server itself emits; client error scopes may additionally map proxy-only codes (502/503/504, etc.) for resilience under reverse-proxy deployments.

- **409** is used for conflict cases where the request is well-formed but violates a constraint the client needs to resolve (e.g. attempting to delete an image still referenced by chapters — the `{ error: { code, message, chapters: [...] } }` shape carries the referencing chapter list so the UI can route the user to them).
- **413** is emitted when a request body exceeds the size guard (e.g. a chapter PATCH whose content would break the per-row limit). Clients should present a "too large" message rather than a generic retry prompt.

Key endpoints:
- `PATCH /api/chapters/{id}` — auto-save target; recalculates word count server-side; rejects invalid JSON with 400 (preserves previous content)
- `PUT /api/projects/{id}/chapters/order` — full chapter ID list required, 400 on mismatch
- `POST /api/chapters/{id}/restore` — restoring a chapter whose project is deleted also restores the project

## Accessibility (WCAG 2.1 AA — Mandatory)

This is a first-class design constraint, not optional:
- Semantic HTML (`<nav>`, `<main>`, `<aside>`, `<button>`, `<dialog>`) — no `<div>`/`<span>` as interactive elements
- ARIA landmarks on all major regions; `aria-live="polite"` for save status; word count announced on demand via Ctrl+Shift+W
- Full keyboard navigation; visible focus indicators (3:1 contrast)
- Chapter reordering via Alt+Up/Down as drag-and-drop alternative, with live region feedback
- `prefers-reduced-motion` respected; text readable at 200% zoom
- Color never the sole information carrier

## Visual Design

- Warm earth tones: off-white background (#F7F3ED), dark charcoal text (#1C1917), warm amber/ochre accent (#6B4720)
- Sans-serif UI chrome (DM Sans), serif for the writer's words (Cormorant Garamond, 18-20px)
- **Serif = the manuscript:** editor content, chapter titles, project titles, preview mode, logo
- **Sans-serif = the tool:** navigation, buttons, dialogs, labels, status indicators
- Fonts are self-hosted via `@fontsource` packages (no external CDN) for offline reliability
- Editor max-width 720px; preview max-width ~680px centered
- Sidebar ~260px, collapsible

## Data Model

Five tables, all using UUID primary keys (except `settings` and `chapter_statuses`):

- **projects** — id, title, slug, mode, target_word_count, target_deadline, created_at, updated_at, deleted_at
- **chapters** — id, project_id (FK), title, content (TipTap JSON), sort_order, word_count, status, created_at, updated_at, deleted_at
- **chapter_statuses** — status (PK), sort_order, label. Seed data; defines the chapter workflow statuses.
- **settings** — key (PK), value. Key-value store for app settings (e.g., timezone).
- **daily_snapshots** — id, project_id (FK), date, total_word_count, created_at. One row per project per day; upserted on each save.

## Testing Philosophy

The save pipeline gets the most rigorous coverage — it's the core trust promise. Integration tests run against real SQLite (not mocks). E2e tests cover all user stories including save-failure recovery via network interception. aXe-core runs in Playwright for automated a11y checks. ALL CODE MUST USE RED-GREEN-REFACTOR if feasible.

**Coverage thresholds are enforced in `vitest.config.ts` (95% statements, 85% branches, 90% functions, 95% lines).** If coverage drops below these thresholds, the goal is always to increase coverage as much as possible by writing meaningful tests for the uncovered code — never simply adjust the thresholds downward or write minimal/trivial tests just to meet the minimum. Aim to push coverage higher, not coast at the floor.

**Zero warnings in test output.** Tests must not produce noisy `console.warn`, `console.error`, or logger output in stderr. When a test deliberately triggers an error path that logs a warning, spy on the output, suppress it, and assert the expected message — e.g. `const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {}); ... expect(warnSpy).toHaveBeenCalledWith(...); warnSpy.mockRestore();`. Noisy test output masks real problems; if every test run has 30 "expected" warnings, developers stop reading them and miss the 31st that signals a real bug.

The only thing worse than a failing test is a reduction in test coverage.

## Pull Request Scope

The `ovid/snapshots-find-and-replace` branch (merged 2026-04-19) bundled two features across 17,000 insertions and required 16 rounds of review. To prevent recurrence, PRs must obey two rules:

**One-feature rule.** A PR delivers a single feature *or* a single refactor — never both, and never two features. A bug fix alongside the feature it affects is fine; a second unrelated bug fix is not. When in doubt, split.

**Phase-boundary rule.** Each roadmap phase (`docs/roadmap.md`) is a PR. Splitting a phase into multiple PRs is allowed and often preferable; merging phases into one PR is not. Every PR must reference the roadmap phase(s) it implements in its description. A PR that implements more than one phase must be closed and split — update the roadmap to split the bundled phase first, then open separate PRs.

Line count is not a hard limit — a 3,000-line migration can be fine, a 500-line cross-cutting refactor may not be. The shape of the change matters more than the size.

## Dependency Licenses

**All dependencies must be compatible with commercial use.** A full audit lives in `docs/dependency-licenses.md`. When adding a new dependency or updating an existing one:

1. Check its license in `node_modules/{package}/package.json`
2. **Acceptable licenses:** MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, OFL-1.1, 0BSD, CC0-1.0
3. **Acceptable with care:** MPL-2.0 (weak copyleft — fine for dev-only; if production, document the file-level copyleft scope)
4. **Not acceptable:** GPL, AGPL, SSPL, EUPL, or any strong-copyleft license. These would impose licensing requirements on Smudge itself. Flag immediately if encountered.
5. **Dual-licensed packages:** Explicitly elect the permissive option and document the election in `docs/dependency-licenses.md`
6. Update `docs/dependency-licenses.md` with the new dependency, its license, and any notes
