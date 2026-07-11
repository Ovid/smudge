# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

When you have finished reading this file, announce "CLAUDE.md loaded"

Always address me as "Ovid" in your responses. This lets me know that you have read this file, even if I don't see the previous announcement.

## Asking Me Questions (Mandatory)

When you ask me to make a decision or choose between options, you **must**
give me what I need to actually decide. You routinely know more about the
codebase and the trade-offs than I do, so a bare list of options forces me to
do research you've already done. Every such question **must** include:

1. **The pros and cons of each option** — the real trade-offs, not just a
   neutral description of what each option does.
2. **An explicit recommendation** — say which option you would pick. Mark it
   clearly (e.g. put it first and label it "Recommended").
3. **Why you recommend it** — the reasoning, tied to the trade-offs above.
4. **Honest skepticism, including of your own recommendation** — name the
   strongest argument _against_ the option you're recommending, and any
   assumptions your recommendation depends on. Do not perform agreement; if
   the choice is genuinely close, say so.

A question that lists options without pros/cons, without a recommendation, or
without the reasoning behind it is incomplete — do not send it. This applies
to `AskUserQuestion`, prose questions, and any other way you ask me to choose.
Asking one decision at a time (not batched) still applies.

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
- **Deployment (target — not yet implemented):** Single Docker container, Express serving the API + static frontend on port 3456, SQLite persisted via Docker volume. Today `createApp()` mounts `/api/*` (+ `/api/health`) only — no `express.static`/SPA catch-all and no `Dockerfile` yet. When static serving lands it introduces a new path-traversal/unsafe-serving surface that must ship with guardrails + tests (see architecture report F-19).

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
make backup                          # On-demand backup zip under backups/ (safe while running)
make restore BACKUP=<file>           # Restore a backup zip (Smudge must be stopped; confirms by filename)

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

**`make dev` auto-backs up.** Each `make dev` writes a rotated `backups/smudge-auto-<time>.zip` of the existing DB+images before starting (best-effort — never blocks the server). Keeps the newest `SMUDGE_BACKUP_KEEP` (default 10); `SMUDGE_SKIP_AUTO_BACKUP=1` skips it. Manual `make backup` archives are never auto-pruned. See `docs/backup.md`. These are operator tools run from a source checkout, an interim stopgap until Phase 8b.

## Key Architecture Decisions

**TipTap JSON as source of truth.** Chapter content is stored as TipTap's native JSON, not HTML. HTML is generated on-demand via `generateHTML()` for preview/export. This enables structured operations (word counting walks the JSON tree) and future custom node types.

**Shared `countWords()` function.** Lives in `packages/shared/`, used by both client (live display) and server (persisted `word_count` column). Uses `Intl.Segmenter` with `granularity: 'word'` for correct CJK and Unicode handling. Client and server word counts must always agree.

**Chapter titles are DB metadata**, not part of TipTap content. Prevents word count inflation and accidental deletion.

**Chapter status is a closed type.** `ChapterStatusValue`
(`z.infer<typeof ChapterStatus>`, `packages/shared/src/schemas.ts`) is the
canonical type for a chapter's status across shared and client code — derive
from it; never re-declare status as `string`. The server's internal DB-row
types (`ChapterRow` et al.) intentionally keep `status: string` at the SQLite
persistence boundary, casting to `ChapterStatusValue` only where they cross into
a shared type (e.g. `toChapterStatus`).

**Soft delete everywhere.** Projects and chapters use a `deleted_at` timestamp. All queries must filter `deleted_at IS NULL`. Trash view allows 30-day recovery; background purge on server startup.

**Auto-save with retry.** 1.5s debounce, 3 retries with exponential backoff (2s/4s/8s), persistent "Unable to save" warning on total failure, `beforeunload` guard, client-side cache holds unsaved content until server confirms. On chapter switch, immediate save bypasses debounce.

**Save-pipeline invariants.** The following rules are load-bearing — the snapshots/find-and-replace branch required 16 rounds of review because they were applied inconsistently. Any code that triggers a server mutation affecting editor content must obey them:

1. **`markClean()` before any server call that invalidates editor state.** If you call the server _and_ the response will overwrite what's on screen (restore, replace, reload), mark the editor clean first so the unmount/auto-save cleanup cannot fire a stale PATCH afterwards.
2. **`setEditable(false)` around any mutation that can fail mid-typing.** The user must not be able to type into content that is about to be overwritten or is in an error state. Restore this _after_ success or failure.
3. **Cache-clear happens after server success, never before.** The client-side draft cache is the last line of defense against data loss. Clearing it before the server confirms violates the contract that unsaved content is held until persistence succeeds.
4. **Bump the sequence ref before the request, not after.** Any in-flight response for an older sequence is discarded on return. Bumping after creates a window where stale responses land. Use `useAbortableSequence` (`packages/client/src/hooks/useAbortableSequence.ts`): `start()` bumps and returns a token, `capture()` snapshots the current epoch for cross-axis checks, `abort()` invalidates outstanding tokens, and component unmount auto-aborts. Hand-rolled `useRef<number>` sequence counters are rejected by ESLint.

   For network-cancellation (as distinct from response-staleness), route through `useAbortableAsyncOperation` (`packages/client/src/hooks/useAbortableAsyncOperation.ts`): `run<T>(fn)` aborts the prior controller and returns `{ promise, signal }` per call (use the per-call `signal` for "did this operation abort" gates after the await — there is deliberately no hook-level `aborted` getter), `abort()` cancels the currently-tracked controller for explicit external-cancellation flows that aren't paired with starting a new operation (panel-close, project-id change), and component unmount auto-aborts. The two hooks are orthogonal: `useAbortableSequence` arbitrates response staleness via epoch tokens; `useAbortableAsyncOperation` cancels network requests via `AbortController`. Both can apply to one operation — `useFindReplaceState.search` pairs them to get both guarantees. Hand-rolled `useRef<AbortController>` allocations at consumer call sites are banned by an ESLint `no-restricted-syntax` rule (`eslint.config.js`), proven by `packages/client/src/__tests__/eslintAbortControllerRule.test.ts`. The justified second-tier-recovery survivors each carry an inline `// eslint-disable-next-line no-restricted-syntax -- <reason>` at their allocation — the disable comment is the audit record; there is no central allowlist.

5. **Error codes stay inside the allowlist.** HTTP status codes are 200, 201, 400, 404, 409, 413, 500 (see §API Design). New conditions get an existing code plus a discriminating `error.code` string — never a new status.

For mutation-via-server flows (snapshot restore, project-wide replace, and future similar operations), route through `useEditorMutation` in `packages/client/src/hooks/useEditorMutation.ts` — it enforces invariants 1–4 by construction. Hand-composing these steps is reserved for flows outside its scope (e.g. snapshot view, which does not mutate content). For any client flow whose response must be discarded when superseded by a newer request or an external epoch change (chapter switch, project switch, unmount), route through `useAbortableSequence` — it encodes the "bump before, check after" contract as tokens, auto-aborts on unmount, and is enforced by ESLint.

**Editor operational state lives in one machine.** The editor's
`{ editable, locked, busy }` operational state is owned by
`useEditorMutationMachine` (`packages/client/src/hooks/useEditorMutationMachine.ts`)
— a pure `useReducer` driven by explicit events (`MUTATION_STARTED`,
`MUTATION_SETTLED_OK` / `_SUPERSEDED`, `RELOADED`, `COMMITTED_UNRELOADED`,
`EDITOR_REMOUNTED`, `UNLOCK`) rather than independent `setState`/`setEditable`
calls kept in sync by hand. Do not reintroduce free-standing
`editorLockedMessage` / `reloadFailed` / `reloadSucceeded` refs or state; route
lock/unlock and re-enable intent through the machine. Two transitions stay
synchronous-imperative for timing safety: the lock-down `setEditable(false)`
(blocks input before the first `await`) and the `inFlightRef` re-entrancy latch.
`MutationResult` carries `committed_but_unreloaded` as the canonical "server
committed, display unconfirmed" outcome (2xx `BAD_JSON` on replace/restore,
reload-GET failure, race-only supersession); it routes to the persistent lock
banner — except the find-replace stale-chapter-drift sub-case
(`useFindReplaceController`), which re-enables the now-unrelated editor with a
dismissible notice. Invariant 2's `setEditable(false)` is now expressed as
machine intent.

**Unified API error mapping.** All client code that surfaces a user-visible
message from an API error must route through `mapApiError(err, scope)` in
`packages/client/src/errors/`. The mapper returns `MappedError<S> = { message,
possiblyCommitted, transient, extras? }`; the `<S>` phantom parameter ties
the `extras` shape to the scope, accessible via `ScopeExtras<S>`. The mapper
is the single owner of code/status-to-string translation and of the cross-
cutting rules (ABORTED is silent, 2xx BAD_JSON is `possiblyCommitted: true`
when the scope declares `committed:` copy and `false` for read scopes that do
not, NETWORK is `transient`). The `committedCodes` scope field extends
`possiblyCommitted: true` beyond the 2xx-BAD_JSON case to specific server
codes (e.g. `UPDATE_READ_FAILURE`, `READ_AFTER_CREATE_FAILURE`,
`RESTORE_READ_FAILURE`) where the write may or may not have landed. Raw
`err.message` must never reach the UI. New API surfaces add a scope entry to
`scopes.ts`; they do not write ad-hoc ladders at call sites. Consumer call
sites route through `applyMappedError(mapped, { onMessage, onTransient?,
onCommitted?, onExtras? })` from `packages/client/src/errors/applyMappedError.ts`
— its `STOP` sentinel lets a callback short-circuit the rest of the chain.
This is the canonical consumer pattern, parallel with `useEditorMutation` and
`useAbortableSequence`. This invariant will be enforced by ESLint in a future
phase; until then, it is enforced by review.

**String externalization.** All UI strings in `packages/client/src/strings.ts` as constants, never raw literals in components. Enforced by `no-restricted-syntax` selectors in `eslint.config.js` (Phase 4b.4) that flag **word-bearing** literals (text containing a Unicode letter, `\p{L}`) in JSX text children and the user-facing attributes `aria-label`, `aria-description`, `aria-roledescription`, `title`, `placeholder`, `alt`. The rule is intentionally letters-only: glyphs, separators, and punctuation are language-neutral (not i18n surface), and bare-glyph accessible-name coverage is owned by aXe-core, not this rule. A decorative word-bearing glyph (e.g. the `Aa`/`ab|` find-replace toggles) is **named** — extracted to a constant and rendered as `{GLYPH}`, which the rule does not flag — keeping the visible symbol paired with its `STRINGS`-sourced `aria-label`. Test fixtures take an inline `// eslint-disable-next-line no-restricted-syntax -- test fixture (not user-facing)` (the description separator is two hyphens `--`; an em-dash silently disables nothing). ESLint reports a JSXText violation at the opening tag's line, so a disable comment must sit above the _opening tag_ (or use the block `eslint-disable`/`eslint-enable` form) — a comment directly above the visible text does not suppress it. The exemption-reason string is load-bearing — `git grep "eslint-disable-next-line no-restricted-syntax" packages/client/` is the audit surface. Prepares for future i18n without architectural changes.

**Dialog lifecycle lives in one hook.** Native `<dialog>` show/close sync,
focus-on-open, Escape-to-close, and backdrop-click-to-close route through
`useDialogLifecycle` (`packages/client/src/hooks/useDialogLifecycle.ts`)
rather than per-dialog `useEffect`/listener reimplementations. Options:
`initialFocusRef` (focus a specific element after `showModal()`) and
`blockEscapePropagation` (capture-phase Escape + `stopImmediatePropagation`,
as `ConfirmDialog` uses to shield the FindReplacePanel's Escape listener). The
hook owns the lifecycle effects and returns an opt-in `onBackdropClick`; ARIA
(`role`, `aria-*`) stays in each component's JSX. New dialogs adopt the hook
rather than copying a neighbour.

## API Design

REST endpoints under `/api/`. Error envelope: `{ "error": { "code": "MACHINE_READABLE", "message": "Human-readable" } }`. HTTP status codes: 200, 201, 204, 400, 404, 409, 413, 500, plus **503 for `/api/health` only** (the liveness probe emits 503 when the SQLite handle is unreachable — F-14; this is the single documented carve-out and does not extend to any other endpoint or to the `AppError` taxonomy). The allowlist governs codes the Smudge server itself emits; client error scopes may additionally map proxy-only codes (502/503/504, etc.) for resilience under reverse-proxy deployments. Error responses (4xx/5xx) are produced by the `AppError` taxonomy (`packages/server/src/errors/appError.ts`): routes `throw` a typed `AppError` and the global handler (`app.ts`) renders the envelope. The error-status subset is 400, 404, 409, 413, 500 — `AppError` never emits 2xx.

- **204** No Content is the uniform success contract for **every** DELETE endpoint — chapter, project, image, and snapshot deletes all return `204` with an empty body (F-16). The client owns the user-facing success toast (sourced from `strings.ts`); the server never returns a `{ message }` or `{ deleted: true }` envelope on the delete happy-path. A blocked image delete is the exception and stays a **409** (it is not a success). Because a 204 carries no body, `apiFetch` short-circuits before reading it, so the 2xx-`BAD_JSON` `possiblyCommitted` path cannot fire for a successful delete.
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

**Zero warnings in test output.** Tests must not produce noisy `console.warn`,
`console.error`, or logger output in stderr. In the **client** suite, spy on
console **only** via `expectConsole()`
(`packages/client/src/__tests__/expectConsole.ts`): it installs a suppressing
spy and registers a pending expectation, and each matcher
(`calledWith`/`notCalledWith`/`calledTimes`/`nthCalledWith`/`called`/`silent`/
`calledMatching`/`notCalledMatching`) both asserts **and** marks the
expectation resolved — e.g.
`expectConsole("warn").calledWith("…", expect.any(Error));`. Raw
`vi.spyOn(console, …)` is **banned by ESLint** (the helper file is the sole
exemption), and a global `afterEach` (`assertConsoleExpectationsSettled`) fails
any test that installs an expectation but never asserts it — so a suppressed
warning can never silently drift. Noisy test output masks real problems; if
every test run has 30 "expected" warnings, developers stop reading them and
miss the 31st that signals a real bug.

The only thing worse than a failing test is a reduction in test coverage.

## Pull Request Scope

The `ovid/snapshots-find-and-replace` branch (merged 2026-04-19) bundled two features across 17,000 insertions and required 16 rounds of review. To prevent recurrence, PRs must obey two rules:

**One-feature rule.** A PR delivers a single feature _or_ a single refactor — never both, and never two features. A bug fix alongside the feature it affects is fine; a second unrelated bug fix is not. When in doubt, split.

**Phase-boundary rule.** Each roadmap phase (`docs/roadmap.md`) is a PR. Splitting a phase into multiple PRs is allowed and often preferable; merging phases into one PR is not. Every PR must reference the roadmap phase(s) it implements in its description. A PR that implements more than one phase must be closed and split — update the roadmap to split the bundled phase first, then open separate PRs.

Line count is not a hard limit — a 3,000-line migration can be fine, a 500-line cross-cutting refactor may not be. The shape of the change matters more than the size.

**Exceptions to the one-feature rule require an explicit decision recorded in the phase's decision log; the rule defaults to enforcement.** Recorded precedents live in `docs/roadmap-decisions/` (the earliest, Phase 4b.3, is in `docs/plans/2026-04-25-4b3a-review-followups-design.md`) — consult them for precedent rather than re-deriving the policy.

## Dependency Licenses

**All dependencies must be compatible with commercial use.** A full audit lives in `docs/dependency-licenses.md`. When adding a new dependency or updating an existing one:

1. Check its license in `node_modules/{package}/package.json`
2. **Acceptable licenses:** MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, OFL-1.1, 0BSD, CC0-1.0
3. **Acceptable with care:** MPL-2.0 (weak copyleft — fine for dev-only; if production, document the file-level copyleft scope)
4. **Not acceptable:** GPL, AGPL, SSPL, EUPL, or any strong-copyleft license. These would impose licensing requirements on Smudge itself. Flag immediately if encountered.
5. **Dual-licensed packages:** Explicitly elect the permissive option and document the election in `docs/dependency-licenses.md`
6. Update `docs/dependency-licenses.md` with the new dependency, its license, and any notes

## Dependency Cooldown (Supply-Chain)

**No package version in `package-lock.json` may be younger than 7 days unless
explicitly allowlisted with a reason.** Most malicious npm releases are caught
and yanked within days; a 7-day quarantine catches the common case before it
reaches Smudge. Enforced by the `dep-cooldown` CI job (authoritative) and the
on-demand `make dep-cooldown` target — never part of `make all` (the offline
local full-pass stays network-free).

- **Scope:** every registry-resolved version in the lockfile — **direct and
  transitive** (transitive is where real attacks land). Non-registry deps
  (git/file/unrecognized) are skipped — no publish date to check. Symlinked
  workspace deps (`link: true`) are also passed over (not counted in the
  skipped tally, since they are local, not a fetched artifact).
- **Escape hatch:** `dependency-cooldown-allowlist.json` (repo root, committed).
  Add `{ "package", "version", "reason", "added" }` to adopt a sub-cooldown
  version — for an urgent CVE fix **or** any new dep needed before it is 7 days
  old. `reason` is mandatory (a blank reason is a hard error). Every waiver is a
  reviewable diff — the paper trail is the point.
- **Hygiene:** the gate warns (without failing) when a waiver is no longer
  needed (its version is now ≥7 days old) or orphaned (its version left the
  tree). Remove those entries.
- **What it does NOT do:** age is a proxy, not integrity. Tamper detection is
  the lockfile `integrity` hashes that `npm ci` already enforces — a separate
  layer. See the spec for the full threat model:
  `docs/superpowers/specs/2026-06-01-dependency-cooldown-design.md`.
- **Implementation:** pure logic in `scripts/dep-cooldown-core.mjs` (unit-tested,
  under coverage); thin IO shell in `scripts/dep-cooldown.mjs` (coverage-excluded,
  per the `ensure-native.mjs` precedent).
