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

**Where the trade-offs go.** Write the pros and cons **as prose in the chat
message itself**, laid out option by option, before I am asked to pick. Do not
bury them in `AskUserQuestion` option `description` fields — the UI truncates
those, so I see bare labels and cannot evaluate anything. `AskUserQuestion` is
for capturing the _choice_ once I already understand it; the explaining happens
in the message above it. A question whose reasoning is only visible inside the
picker widget has not been asked.

## Explaining Things to Me

You finish a task holding the whole codebase in working memory. I don't
have that, and I often can't tell whether I'm confused or you're being
unclear. Before sending, check:

1. **Name it before you abbreviate it.** First mention in a message is
   "the restore bug (OOSI1)" — never a bare `OOSI1`, `F-36`, `I2`.
   Same for hooks, files, and any term from a report I'd have to open.
2. **One inference per sentence.** If a sentence carries two causal
   steps ("X, so Y, which means Z"), split it. The step you dropped is
   usually the one I needed.
3. **No jargon without its referent.** "the lock", "the machine",
   "drift", "the seam", "the arm" — say what it locks, what it models,
   what drifted.
4. **The thing before the judgment.** "This code never checks whether
   the user switched chapters" comes before "this is the asymmetry
   that matters."

Setup sentences are part of the answer, not padding. If I have to ask
"what does that mean?", the message failed regardless of length.

**This overrides terseness modes for chat prose.** Ponytail (and any
similar "shortest explanation wins" instruction) governs what you
BUILD — the code, the diff, the number of files. It does not govern
how you explain finished work to me. Compressing a four-step causal
chain into one clause is not laziness, it is a message I have to
decompress by hand.

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
- **Frontend:** React 19, Vite, TipTap v2 (rich text editor, stores content as JSON not HTML), Tailwind CSS, @dnd-kit/sortable v10
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
      snapshots/          # routes, service, repository, types + auto-snapshot, content-hash, labels
      outtakes/           # routes, service, repository, types
      images/             # routes, service, repository + fs store, paths, reaper, reference scan
      search/             # routes, service (find + project-wide replace)
      export/             # routes, service + per-format renderers (html, epub, docx), image-resolver
      backup/             # backup-core lifecycle + dependency-free backup-zip-format
      stores/             # SqliteProjectStore facade over the repositories (getProjectStore); injectable + tx seam
      errors/             # AppError taxonomy (appError.ts), readAfterInsert
      config/             # paths.ts — DATA_DIR/DB_PATH resolution + containedPath guard
      utils/              # grapheme.ts
      db/                 # connection singleton, migrations/
  client/       # React SPA, components/, hooks/, pages/, api/, errors/, strings.ts
e2e/            # Playwright tests
```

**Architecture:** Routes → Services → `ProjectStore` facade → Repositories. Routes handle HTTP; services handle business logic and transactions; the `SqliteProjectStore` facade (reached via `getProjectStore()`, `stores/`) is a thin single-owner seam that delegates to the repositories and hosts the `transaction(txStore)` boundary; repositories encapsulate all SQL/Knex. Services never import a repository directly — they go through the store facade (F-5).

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

**Configuration.** Every environment variable Smudge reads is inventoried in `docs/configuration.md` — defaults, valid values, and which are validated fail-fast versus warn-and-fallback. There is deliberately **no `.env` support** (no `dotenv` dependency, no code path reads one), so variables must be set in the process environment. A new `process.env.X` read in production source turns `scripts/__tests__/configuration-doc.test.mjs` red until it has a row.

## Key Architecture Decisions

**TipTap JSON as source of truth.** Chapter content is stored as TipTap's native JSON, not HTML. HTML is generated on-demand via `generateHTML()` for preview/export. This enables structured operations (word counting walks the JSON tree) and future custom node types.

**One route from TipTap JSON to rendered HTML.** Every rendered _HTML_ surface —
preview, snapshot view, and four of the five export formats (HTML, EPUB,
markdown, plaintext, which funnel through the server's `chapterContentToHtml`) —
goes through `renderEditorHtml()` in `packages/shared/src/editorExtensions.ts`.
**DOCX is the exception:** it walks TipTap JSON directly into Word paragraphs
rather than rendering HTML, so it cannot go through `renderEditorHtml()` — it
strips editor-only marks at its own walker entry instead
(`docx.renderer.ts` `tipTapToParagraphs` calls `stripNoteMarks`), a separate
route to the same confidentiality guarantee. The **live editor is the only
surface that renders TipTap JSON without any strip**, because the editor is the
only surface allowed to show editor-only marks. `renderEditorHtml()` strips
those marks (today: `note`, Phase 4c.1) before `generateHTML`. Do not add a bare
`generateHTML()` call site: registering a mark in `editorExtensions` is what
makes it renderable, so a new render site that skips the strip silently ships
the writer's private commentary into the file they hand a beta reader — which is
exactly what happened when the note mark was registered ahead of its strip. A
new editor-only mark (Phase 4c.3 tags) strips here too — and in every non-HTML
export walker (DOCX today). The DOCX note-leak test in `export.renderers.test.ts`
guards that walker's strip; the extension-set assertion in
`editorExtensions.test.ts` is the forcing pause: it turns red when an extension
is added, so the author must decide whether it renders into output. Callers keep
their own post-processing (the server's image-src allowlist, the client's
DOMPurify pass); `renderEditorHtml` only renders.

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

5. **Error codes stay inside the allowlist.** HTTP status codes are 200, 201, 204, 400, 404, 409, 413, 500, plus 503 for `/api/health` only (see §API Design for the full list and the 503 carve-out). New conditions get an existing code plus a discriminating `error.code` string — never a new status.

For mutation-via-server flows (snapshot restore, project-wide replace, and future similar operations), route through `useEditorMutation` in `packages/client/src/hooks/useEditorMutation.ts` — it enforces invariants 1–4 by construction. Hand-composing these steps is reserved for flows outside its scope (e.g. snapshot view, which does not mutate content). For any client flow whose response must be discarded when superseded by a newer request or an external epoch change (chapter switch, project switch, unmount), route through `useAbortableSequence` — it encodes the "bump before, check after" contract as tokens, auto-aborts on unmount, and is enforced by ESLint.

**Editor operational state lives in one machine.** The editor's
`{ editable, locked }` operational state is owned by
`useEditorMutationMachine` (`packages/client/src/hooks/useEditorMutationMachine.ts`)
— a pure `useReducer` driven by explicit events (`MUTATION_STARTED`,
`MUTATION_SETTLED_OK` / `_SUPERSEDED`, `RELOADED`, `COMMITTED_UNRELOADED`,
`EDITOR_REMOUNTED`, `UNLOCK`) rather than independent `setState`/`setEditable`
calls kept in sync by hand. Do not reintroduce free-standing
`editorLockedMessage` / `reloadFailed` / `reloadSucceeded` refs or state; route
lock/unlock and re-enable intent through the machine. Two transitions stay
synchronous-imperative for timing safety: the lock-down `setEditable(false)`
(blocks input before the first `await`) and the `inFlightRef` re-entrancy latch.
**Mutation-busy is deliberately not machine state (F-08).** The machine exposes
exactly one synchronous probe, `isLocked()`; busy is `mutation.isBusy()`, backed
by `inFlightRef`, and a reducer field cannot replace it because the latch must
be readable _before_ the first `await` while reducer state is visible only after
React commits. The machine previously carried a `busy` mirror no consumer read,
giving two same-named `isBusy()` probes on sibling objects — one authoritative,
one documented as wrong. Do not re-add it; if a render-time busy indicator is
ever wanted (a `disabled` prop rather than a callback check), add the field
then, and not as a second `isBusy()`. Three events
(`MUTATION_SETTLED_SUPERSEDED`, `RELOADED`, `EDITOR_REMOUNTED`) now produce an
identical state — that is deliberate and pinned by a test; they are distinct
facts dispatched from distinct sites, so do not merge them.
`MutationResult` carries `committed_but_unreloaded` as the canonical "server
committed, display unconfirmed" outcome (2xx `BAD_JSON` on replace/restore,
reload-GET failure, race-only supersession); it routes to the persistent lock
banner — except the stale-chapter-drift sub-case, which re-enables the
now-unrelated editor with a dismissible, chapter-attributed notice. Both
controllers implement it (`useFindReplaceController`, `useSnapshotController`);
a third consumer of `committed_but_unreloaded` must too, because that outcome
leaves the machine at `editable:false` and the hook dispatches no terminal
event — skipping the lock without re-asserting strands the editor read-only
with nothing on screen to explain it. Invariant 2's `setEditable(false)` is now expressed as
machine intent.

**Machine intent reaches TipTap by two routes, and both must stay wired.**
Post-mount transitions go through the imperative `setEditable` handle;
**mount-time** editability comes from `Editor`'s `editable` prop, fed from
`editorMachine.state.editable` through `EditorMainContent` (F-36). Without the
prop, any mount that happens while the machine already intends `editable:false`
comes up writable — reachable whenever a mutation is initiated from a surface
with no editor mounted (snapshot view), because the reconcile effect cannot
re-run when none of its deps changed. The prop is **not** a second owner of
editability: `@tiptap/react` 2.27.2's per-render reconcile pins `editable:
this.editor.isEditable` (`dist/index.js:977`), which is the load-bearing
third-party guarantee here — a TipTap upgrade that drops it hands editability
back to the render path. The tripwire is `Editor.test.tsx`'s "keeps imperative
setEditable(false) authoritative across a re-render", which holds the prop at
`true` while the handle says `false` — the only combination a dropped pin can
break. Do not "simplify away" the prop pass-through.

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

**Persisted UI settings live in one hook.** Every `localStorage`-backed UI
setting (panel width, panel open, active tab, sidebar width) routes through
`usePersistedState(key, codec)`
(`packages/client/src/hooks/usePersistedState.ts`) rather than a hand-rolled
`getSaved* + try/catch` reader. The codec's `parse` is the **single validator
for both directions** — the setter normalizes via `parse(serialize(next))`, so
React state is always a fixed point of the storage round-trip and the read and
write paths cannot drift apart. Codec factories: `numberInRange` (note its
empty-string guard — `Number("")` is `0`, not `NaN`), `flag`, `text`. A codec
must satisfy two properties the hook rests on: `parse ∘ serialize` is
idempotent, and `fallback` is a fixed point of it (`numberInRange` enforces the
latter by clamping its own fallback). The codec is **pinned at mount** (a ref,
not a dep), so an inline codec cannot churn the setter identity — there is no
module-scope contract to remember, and the write path parses with the same codec
the read path already did. A write the codec cannot represent (a `NaN` width
from a torn-down rect) is **ignored** — it touches neither state nor storage,
keeping the last known-good value; the fallback is the floor for absent or
corrupt _storage_, not a reset button for a bad _live write_. Two
deliberate constraints: (1) **storage failures are silent** — no `clientWarn` —
because the data-loss path (`useContentCache`, sharing the same origin quota)
already warns loudly, and the resize path would otherwise warn at mousemove
frequency; (2) **`key` must be constant for a component's lifetime, and one
component owns it** — derive per-entity settings by remounting, not by varying
the key. There is no cross-tab `storage` listener (a deliberate non-goal). The
hook does **not** validate domain values it cannot know (e.g. tab ids); that
stays with the component that owns the domain (`ReferencePanel` degrades an
unknown tab to `tabs[0]`). `useContentCache` is deliberately _not_ a client of
this hook — it is a draft cache with JSON payloads, its own logging, and a
different failure contract.

## Accepted Architectural Trade-offs

The following patterns are recurring architecture-review flags that have been
reviewed and **deliberately accepted** for Smudge's single-user, single-process
design. They are recorded here (not just in a review report) so future reviews
treat them as decided rather than re-derived defects — a report's per-finding
"Won't fix" status does not reach a fresh review, but this steering file does.
Re-flagging one is warranted only if its stated premise changes.

- **Anemic domain model (F-18).** Domain entities are plain `*Row` record types;
  all business rules live in service free functions over those records. This is
  idiomatic functional TypeScript, not a defect — a "fix" would mean an OO
  entities-with-behavior rewrite against the grain of the codebase.
- **Hidden side effects in chapter mutations (F-19).** `updateChapter` /
  `deleteChapter` / `restoreChapter` do more than their names suggest (bump
  project `updated_at`, decrement or increment image ref counts, fire
  post-commit velocity snapshots — and `restoreChapter` additionally un-deletes
  a soft-deleted parent project and regenerates its slug). Each side effect is
  enumerated in the function's doc comment and best-effort failures are logged,
  not swallowed — the doc discipline, not decomposition, is the mitigation. New
  mutations with non-obvious side effects must keep it.
- **Image-URI rule encoded twice (F-16).** The client `ALLOWED_URI_REGEXP`
  (relative-only, fail-closed XSS allowlist) and the server `IMAGE_SRC_RE`
  (optional `https?://host` prefix, reference-count matcher) intentionally
  differ — they serve different threat models and must **not** be unified into
  `shared`. The only residual is cross-package coupling: a change to one
  warrants review of the other (cross-referencing comments exist at both sites).
- **Non-idempotent image upload (F-8).** Each upload mints a fresh UUID + file +
  DB row with no content-hash dedup. There is no automatic upload-retry path
  (unlike auto-save's backoff), so the only route to a duplicate is a manual
  user retry after a committed-but-dropped response — a harmless, user-deletable
  duplicate in a single-user app. Content-hash dedup (a schema migration +
  backfill + per-upload hashing) is disproportionate to that risk. Revisit if
  uploads ever gain an automatic retry.
- **Store reached via service locator with an init-order contract (F-3).**
  `store`, `db`, and `velocityServiceOverride` are process-global mutables with
  `set*/reset*/init*` mutators; services reach the store via `getProjectStore()`
  rather than constructor injection, and correct operation requires
  `initProjectStore(db)` to have run once first (getter throws "not
  initialized", init throws "already initialized"). This IS the deliberate,
  tested seam that makes the single-process app injectable at all — the
  runtime-enforced init-order contract is the price of a locator that stays a
  one-liner at every call site instead of threading `db`/`store` through every
  route→service→repository signature — and the call sites have multiplied since
  this was accepted, which strengthens the case rather than weakening it. "Fixing" it means a DI-container or
  parameter-threading rewrite that buys nothing for a single-process app.
- **`ProjectStore` facade is entirely one-line pass-throughs (F-4).** Each
  `SqliteProjectStore` method delegates to a repository function, and the
  `ProjectStore` interface has exactly one implementation (no fake implements
  it; tests construct the concrete class over a real DB). The three-edit-per-
  operation tax (repo fn + slice interface + delegation) is compiler-guided, and
  the `transaction(txStore)` seam is genuinely load-bearing. The per-domain slice
  interface's documented data-surface value justifies the type surface; "fixing"
  it (typing `txStore` as the concrete class, dropping the interface) trades a
  documented contract for marginally less boilerplate. Net a mild smell, left
  as-is.
- **Request correlation not propagated into the service layer (F-2).** `req.id`
  / `req.log` exist at the HTTP boundary and error handler (strength S-10, with
  an inbound `X-Request-Id` echo), but there is no `AsyncLocalStorage`, so
  services/repositories/reapers log through the bare top-level `logger` with no
  `req_id`. Accepted because the best-effort anomaly logs already carry their
  domain IDs (`project_id`/`chapter_id`/`image_id`), which for a single-user,
  single-process app _is_ the correlation key — a request ID only earns its keep
  disambiguating concurrent requests against the same entity, which a single
  writer never produces. The roadmap trajectory (7g Electron desktop bound to
  `127.0.0.1`, 8a per-project DBs) makes Smudge _more_ single-user, not less;
  this matches the line-973 roadmap precedent for deferring single-user
  optimizations. Revisit only if Smudge ever ships a cloud / multi-writer
  deployment.
- **`EditorPage` god-orchestrator, accepted with an enforcement net (F-1).**
  `packages/client/src/pages/EditorPage.tsx` (the largest file in the client)
  owns the shared
  mutable busy/lock state and threads it into every editor-mutating entry point;
  the cross-hook invariant holds because this one component wires the same
  objects consistently. Six prior decompositions already extracted rendering
  and the controller hooks — the sixth (F-04, `useOuttakeCapture`) carved out
  the outtake-capture flow precisely because it participates in _none_ of the
  coordination: it writes no editor content, so it takes no busy/lock handle.
  The residual concentration is irreducible cross-hook coordination, not
  accidental complexity — but "irreducible" is a claim about the blocks that
  genuinely thread `mutation` / `editorMachine` / `actionBusyRef`, and F-04
  showed it had been over-applied to a block that threads none of them. A
  future extraction is warranted on the same evidence and not on size alone.
  The only structural "fix" (a React
  context/provider lift) would _hide_ invariant-critical mutable state and buy
  near-zero safety: the two controllers already receive that state via
  compile-checked typed deps interfaces, so mis-wiring them is already a compile
  error. Accepted as-is. The one real residual — nothing _mechanically_ forced a
  NEW editor-mutating entry point to be guarded — is closed by
  `packages/client/src/__tests__/editorEntryPointSurface.test.ts`, a
  forcing-pause snapshot of the full entry-point surface (`EditorHeader` /
  `EditorMainContent` / `EditorDialogs` props + `useKeyboardShortcuts` keys) that
  turns red when any entry point is added or removed, forcing the author to
  consciously choose the new point's guard axis (busy latch / lock check /
  content-path machine) per §Save-pipeline invariants before updating the list.
  It converts reviewer-optional into author-mandatory acknowledgment; it does
  not verify the guard is _correct_ — the behavioral tests in
  `EditorPageFeatures.test.tsx` do that for the current handlers. Do not
  "refactor away" EditorPage's explicit wiring; keep new mutating entry points
  guarded and listed.

## API Design

REST endpoints under `/api/`. Error envelope: `{ "error": { "code": "MACHINE_READABLE", "message": "Human-readable" } }`. HTTP status codes: 200, 201, 204, 400, 404, 409, 413, 500, plus **503 for `/api/health` only** (the liveness probe emits 503 when the SQLite handle is unreachable — F-14; this is the single documented carve-out and does not extend to any other endpoint or to the `AppError` taxonomy). The allowlist governs codes the Smudge server itself emits; client error scopes may additionally map proxy-only codes (502/503/504, etc.) for resilience under reverse-proxy deployments. Error responses (4xx/5xx) are produced by the `AppError` taxonomy (`packages/server/src/errors/appError.ts`): routes `throw` a typed `AppError` and the global handler (`app.ts`) renders the envelope. The error-status subset is `ERROR_STATUS_ALLOWLIST` (400, 404, 409, 413, 500) — `AppError` never emits 2xx.

**The error-status allowlist is enforced, not just documented (I4).** `globalErrorHandler` clamps every non-`AppError` status to `ERROR_STATUS_ALLOWLIST`: an off-allowlist 4xx becomes 400, anything else becomes 500, and the original is preserved in the log as `rawStatus`. This exists because a library error can carry its own status — body-parser's `UnsupportedMediaTypeError` (415) escaped through the unclamped handler on every body-accepting endpoint, mislabelled `VALIDATION_ERROR` and mapped by no client scope. `ERROR_STATUS_ALLOWLIST` is the single machine-readable owner; do not restate the list in a comment.

- **204** No Content is the uniform success contract for **every** DELETE endpoint — chapter, project, image, and snapshot deletes all return `204` with an empty body (F-16). The client owns the user-facing success toast (sourced from `strings.ts`); the server never returns a `{ message }` or `{ deleted: true }` envelope on the delete happy-path. A blocked image delete is the exception and stays a **409** (it is not a success). Because a 204 carries no body, `apiFetch` short-circuits before reading it, so the 2xx-`BAD_JSON` `possiblyCommitted` path cannot fire for a successful delete. The same body-less-204 contract also covers two non-DELETE mutations that have nothing to return — `PUT /api/projects/{slug}/chapters/order` and `PATCH /api/settings` (F-9): the client owns the toast, the server ships no success copy.
- **409** is used for conflict cases where the request is well-formed but violates a constraint the client needs to resolve (e.g. attempting to delete an image still referenced by chapters — the `{ error: { code, message, chapters: [...] } }` shape carries the referencing chapter list so the UI can route the user to them).
- **413** is emitted when a request body exceeds the size guard (e.g. a chapter PATCH whose content would break the per-row limit). Clients should present a "too large" message rather than a generic retry prompt.

**Project sub-resources address the project by slug, except images and outtakes (F-24).** Five routers mount on `/api/projects` (`app.ts:41,45,46,50,52`). The decision on record is blanket — `docs/plans/2026-03-29-project-slugs-design.md:12`, "API uses slugs too. All project endpoints switch from `:id` to `:slug`", with exactly one carve-out (chapter endpoints stay UUID). Two later routers departed from it without recording why, and they are **not** the same case:

- **Images (`images.routes.ts:39`, `:projectId`) has a hard technical driver.** The project id doubles as a filesystem directory name — `images.paths.ts:94-96`, `containedPath(getImagesDir(), projectId, ...)` — so a mutable slug there would orphan an entire image directory on every project rename, and the UUID validator is a path-traversal guard (`5c75077e`). This departure is correct and stays.
- **Outtakes (`outtakes.routes.ts:14,44`, `:id`) has no driver.** It stores `project_id` as an ordinary FK like every other table, its design doc and decision log both state the route shape without justifying it, and it landed three months after images. Treat it as imitation, not precedent.

**Do not retro-fit a rule to this split.** An earlier reading had it as "slug where the client addresses a project from the URL, UUID where it addresses one from a held project object". That is false: find-and-replace passes a slug (`client.ts:605,619`) from a panel holding the same loaded project object the image gallery and outtakes drawer hold. Chronology does not explain it either — search (2026-04-16, slug) landed one day _after_ images (2026-04-15, UUID).

**Slugs are mutable and reclaimable.** `projects.slug` is rewritten on project rename (`projects.service.ts:155`) and on parent-project restore inside `restoreChapter` (`chapters.service.ts`, the `if (parentProject.deleted_at)` branch of its transaction callback). `resolveUniqueSlug` only avoids collisions with live projects (`projects.repository.ts:129,137`, matching migration 002's partial unique index `WHERE deleted_at IS NULL`), so renaming a project away from slug S **releases S** — and the next project whose title generates S takes it over. Verified by execution: an old `/projects/my-novel` URL then opens a _different_ project, silently, with no 404. The client updates every in-memory slug holder and the browser URL on both mutation paths (`useChapterMetadata.ts:103-118`, `useProjectTitleEditing.ts:29-33`, `useTrashManager.ts:194-207`), so this is unreachable through in-app state; it is reachable through a bookmark, a history entry, or a shared link.

**Whether the API should move off the slug entirely is open — Phase 4b.19.** Until it is settled, a new project sub-resource takes the **slug**, because that is the decision on record. If you think it should take the UUID, that is the 4b.19 conversation and it needs a decision log, not a route.

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

Core tables, all using UUID primary keys (except `settings` and `chapter_statuses`):

- **projects** — id, title, slug, mode, target_word_count, target_deadline, created_at, updated_at, deleted_at
- **chapters** — id, project_id (FK), title, content (TipTap JSON), sort_order, word_count, status, created_at, updated_at, deleted_at
- **chapter_statuses** — status (PK), sort_order, label. Seed data; defines the chapter workflow statuses.
- **settings** — key (PK), value. Key-value store for app settings (e.g., timezone).
- **daily_snapshots** — id, project_id (FK), date, total_word_count, created_at. One row per project per day; upserted on each save.
- **outtakes** — id, project_id (FK), label, content (TipTap JSON, images
  stripped on capture), created_at, updated_at. Per-project store of cut/stashed
  text. Text enters **only** by capture from a chapter (the toolbar's "Send
  selection to outtakes") — the panel has no compose form, so the drawer holds
  text taken from the manuscript and nothing composed directly into it
  (2026-08-18; rationale in
  `docs/roadmap-decisions/2026-07-19-phase-4c-2-scratchpad-outtakes.md`).
  Capture is **non-destructive**: it copies the selection and leaves the chapter
  untouched. The destructive version ("Cut selection to outtakes") is Phase
  4c.2a and has not shipped — do not describe capture as moving text out.
  **Degraded read:** a row whose stored `content` is unparseable (or parses
  to a non-node) is returned with `content` replaced by a valid empty doc and a
  `content_corrupt: true` flag on the wire type, never as a 500 — the row must
  keep listing, because listing is what keeps it deletable. The substituted doc
  **passes `TipTapDocSchema`**, so a schema check is not a corruption check: any
  code acting on outtake content (insert, copy, and the future destructive cut)
  must test the flag, and must not read "empty" as "safe to discard". **Hard delete (no `deleted_at`)** — a documented exception to "soft delete
  everywhere", matching ChapterSnapshot (a safety-net TipTap-JSON table). Images
  are stripped on capture because outtake JSON is invisible to the image
  reference-counter/reaper (which scans only `chapters`), so an image referenced
  only by an outtake would be GC'd. Outtakes are excluded from the manuscript word
  count, export, preview, and find-and-replace **by table separation** — any future
  "all project content" iteration must consciously opt them in, and must never do
  so for images without extending ref-tracking. Editor-only `note` marks are
  **deliberately preserved** on capture (unlike images): an outtake is an
  editor-trusted round-trip surface — shown only as plaintext in the panel or
  re-inserted into the editor — so stripping notes would lose the writer's private
  commentary. The stored JSON therefore holds notes, so any future code that
  renders outtake content to HTML/export **must** strip them there (§note-strip
  discipline); the forcing test in `outtakes.service.test.ts` pins the decision.

## Documentation Discipline (Mandatory)

Three hard rules. Each one exists because it was broken on the
`ovid/architecture` branch and caught in review
(`paad/code-reviews/ovid-architecture-2026-08-20-18-52-04-09aaba1e.md`).

**1. Never run a formatter over markdown.** Prose in this repo is
hand-formatted. `npm run format`'s globs exclude markdown, and `.prettierignore`
now excludes `*.md` outright — do not remove that entry, do not add markdown to
the `format` script's globs, and do not run `prettier --write` on a `.md` path
by hand. The globs alone were not enough: an editor's format-on-save or an
ad-hoc invocation bypasses them, and one such pass rewrote emphasis and inline
code spans across three findings of an architecture report (`_false_` became
`\_false*`; prose got glued into code spans). Reports and design docs are
traceability artifacts — corrupting the prose of a finding degrades the evidence
the next session starts from. If you believe markdown should be formatted, that
is a decision to record, not a command to run.

**2. Cite symbols, not line ranges — and verify every count against the
source.** A citation in a steering file earns its keep only if a reader can
follow it. `CLAUDE.md` cited `chapters.service.ts:255-263` for a block that a
later commit **on the same branch** pushed to `:308-317`; the citation was
stale before the branch even merged. Prefer `restoreChapter`'s parent-restore
branch to a line range: a symbol name survives the next edit above it. Where a
line range genuinely helps (a long file of similar-looking code), re-verify it
against the tree before the branch lands. The same discipline covers numbers:
`CLAUDE.md` said "Six routers mount on `/api/projects`" and then cited five
mount lines, and that wrong count propagated into a roadmap phase as an
actionable instruction. Run the grep; do not carry a count forward from another
document.

**3. Nothing goes between a function's doc comment and the function.** Adding a
type, helper, or comment block in that gap silently orphans the doc: editors and
TypeScript bind only the *last* comment preceding a declaration, so the original
attaches to nothing and the function shows no documentation at all. This is not
cosmetic here — §Accepted Architectural Trade-offs entry F-19 accepts the hidden
side effects in `updateChapter` / `deleteChapter` / `restoreChapter` **on the
condition** that each is enumerated in that function's doc comment. Detaching
the enumeration removes the mitigation while leaving the trade-off accepted.
Insert new declarations *above* the doc block, not between it and its function.

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

**Architecture-report fix sessions are a standing recorded exception.** A `/paad:fix-architecture` branch closes several independent findings from one `paad/architecture-reviews/` report and has no roadmap phase, so it fits neither rule and has no phase decision log to record an exception in. The bounded carve-out is recorded in `docs/roadmap-decisions/2026-08-19-architecture-fix-session-pr-scope.md` and has **six** rules — read them there rather than from this summary. The shape: one report per branch, one finding per commit, a `Status:` block per finding, and no finding whose fix is itself a feature; plus the two a session most needs and this line used to omit — the mandatory Safety Net commit is an **allowed untagged commit** at the base of the branch (rule 5), and code-review follow-up commits are traced by a **report-qualified** tag (`[r3 S2]`) instead of a `Status:` block (rule 6). Two round-4 amendments widen rule 1 and rule 6: a **backlog fix is permitted in a file the session already has open** (tagged `[backlog <id>]`), and a **mechanical follow-up that answers to no finding** — lint fallout, typecheck fallout, a report filing — is tagged by kind (`[chore]`, `[lint]`, `[typecheck]`, `[report]`) so the log stays legible.

## Merging Branches

**Land a feature branch on `main` with `git done` (`~/bin/git-done`), never a
bare `git merge`.** `git done` rebases the branch onto `main` _first_, then
merges with `--no-ff`. The rebase is the load-bearing step: it puts the merge
commit's second parent right next to the tip, so the branch shows up in
`git lg` as a small bubble that opens and closes immediately. A bare
`git merge --no-ff` of a branch that has fallen behind `main` produces a merge
commit whose second parent reaches back to the branch's original fork point,
drawing a line across every commit in between — the further behind the branch,
the worse the tangle (a 2026-07-13 merge of two stale branches, 263 and 874
commits behind, is what prompted this rule).

`git done` also pushes the rebased branch and the merged target, and prints the
branch-cleanup commands. `-l`/`--local` merges without pushing; `-y`/`--yes`
skips the confirmation prompt. It derives the target branch from
`refs/remotes/origin/HEAD` and refuses to run from the target branch itself, so
check out the feature branch before invoking it.

If a merge has _already_ landed with the wrong shape, the repair is to recreate
the branch tip from the merge commit's second parent, rewind `main` to the
pre-merge commit, then rebase-and-merge as above. Verify the repair by
comparing tree hashes (`git rev-parse <old>^{tree}` vs `HEAD^{tree}`) — they
must be identical, since only the graph shape may change, never the content.

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
