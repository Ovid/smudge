# Architecture Report — smudge

**Date:** 2026-07-11
**Commit:** b042df7a62f87da502318dcc8ed7e29b5d6532f2
**Languages:** TypeScript (Node.js 22 / Express 4 backend, React 18 / Vite / TipTap v2 frontend), better-sqlite3 + Knex, Zod, Vitest + Playwright
**Key directories:** `packages/shared/`, `packages/server/`, `packages/client/`, `e2e/`
**Scope:** Full repository (`.devcontainer/` excluded per project policy)

## Repo Overview

Smudge is a single-user, no-auth, single-process web application for writing long-form fiction and non-fiction, organized as projects containing chapters — a self-hosted replacement for Google Docs for book-length work. It is an npm-workspaces monorepo with three packages: `shared` (types, Zod schemas, `countWords()`, TipTap utilities — imported isomorphically by both server and client), `server` (Express API with a `Routes → Services → Store → Repositories` layering, better-sqlite3 accessed synchronously through Knex, a typed `AppError` taxonomy, and domain modules for projects, chapters, chapter-statuses, settings, velocity, snapshots, images, search, export, and backup), and `client` (a React SPA whose editor save-pipeline is built from a family of purpose-built hooks — `useEditorMutation`, `useEditorMutationMachine`, `useAbortableSequence`, `useAbortableAsyncOperation` — plus a centralized error-mapping and string-externalization layer). Approximately 288 TypeScript/TSX files, ~24k non-test lines, with coverage thresholds enforced (95% statements / 85% branches / 90% functions / 95% lines) and 19 architecture-decision logs under `docs/roadmap-decisions/`.

The codebase is notably disciplined: the data layer wraps every multi-step mutation in a single transaction, the security-sensitive surfaces (zip restore, image filesystem paths, TipTap→HTML rendering) are explicitly guarded and tested, and error handling is centralized on both sides of the wire. The architectural findings below skew heavily toward strengths; the confirmed flaws are dominated by one High-impact orchestration hotspot (`EditorPage.tsx`) and a long tail of Low-impact, single-user-acceptable smells, several of them already documented in-code.

## Strengths

### [S-1] Consistent API error contract with a single owner
- **Category:** S6 (Consistent API contracts)
- **Impact:** High
- **Explanation:** Every route signals domain failure by `throw`ing a typed `AppError` subclass, and one `globalErrorHandler` renders the uniform `{error:{code,message,...extras}}` envelope; a grep for direct `res.status(4xx/5xx).json` across all route files returns zero hits. Status codes never leave the documented allowlist (200/201/204/400/404/409/413/500); discriminating `code` strings extend semantics without minting new statuses.
- **Evidence:** `packages/server/src/errors/appError.ts`, `packages/server/src/app.ts:59-111` (`globalErrorHandler`); 201 for creates, 204 uniform for all deletes, 409+`chapters` list for the referenced-image conflict.
- **Found by:** Integration & Data, Error Handling & Observability (agreement)

### [S-2] Layered, tested security on untrusted-input surfaces
- **Category:** S10 (Security built-in)
- **Impact:** High
- **Explanation:** The riskiest boundaries are each explicitly guarded and unit-tested: backup restore rejects zip-slip (null-byte, absolute, drive-letter, `..`, `resolve()`-containment) and decompression bombs (declared-size/ratio caps parsed *without* decompressing, zip64 refusal, never-delete move-aside); image filesystem paths are built only from UUID-validated params or trusted DB rows; TipTap→HTML uses a private hardened DOMPurify instance that closes DOMPurify 3.x's `data:`-URI carve-out.
- **Evidence:** `packages/server/src/backup/backup-core.ts` (`ZipSlipError`, `DecompressionBombError`, `validateEntryPaths`, shared-with-tests `walkCentralDirectory`); `packages/server/src/images/images.paths.ts:69-71` (`getImagePath`) + `images.routes.ts` `requireUuidParam`; `packages/client/src/sanitizer.ts:12-115` (`uponSanitizeAttribute` hook, frozen `ALLOWED_ATTR`, URI regex pinned to `/api/images/<uuid>`).
- **Found by:** Security & Code Quality

### [S-3] Robust two-sided error handling taxonomy
- **Category:** S7 (Robust error handling)
- **Impact:** High
- **Explanation:** Server domain failures route exclusively through `AppError` subclasses; the client classifies every fetch/DOMException/TypeError into `ABORTED`/`NETWORK`/`BAD_JSON` and funnels all user-facing copy through a single `mapApiError(err, scope)` owner, so raw `err.message` never reaches the UI. Mapper guards include an own-property check on attacker-influenced `err.code` and a prototype-pollution filter on extras.
- **Evidence:** `packages/client/src/api/client.ts` (`classifyFetchError`), `packages/client/src/errors/apiErrorMapper.ts:157` (`Object.hasOwn(scope.byCode, err.code)`), `packages/client/src/errors/scopes.ts`.
- **Found by:** Error Handling & Observability, Structure & Boundaries

### [S-4] Deep resilience patterns in the save pipeline
- **Category:** S12 (Resilience patterns)
- **Impact:** High
- **Explanation:** Auto-save retries with abort-aware exponential backoff and a terminal-state short-circuit; content size is capped at multiple layers; find/replace regex is defended against ReDoS with a static-safety check plus a hard wall-clock deadline, a match cap, and an output-amplification guard; image writes are ordered to prefer a harmless orphan file over a ghost DB record.
- **Evidence:** `packages/client/src/hooks/useProjectEditor.ts:34` (`SAVE_BACKOFF_MS = [2000,4000,8000]`); `packages/server/src/search/search.service.ts` (`assertSafeRegexPattern`, `REGEX_DEADLINE_MS = 2000`, `MAX_MATCHES_PER_REQUEST`); `packages/server/src/app.ts:19,37` (helmet CSP, `express.json` limit); `packages/server/src/images/images.service.ts:92,198`.
- **Found by:** Integration & Data, Security & Code Quality (agreement)

### [S-5] Exemplary transactional boundaries
- **Category:** S12 (Resilience patterns) / correct transactional design
- **Impact:** High
- **Explanation:** Every multi-step mutation is wrapped in exactly one `store.transaction()` with read-after-write inside the transaction (reorder, delete-project-with-chapters, restore-chapter-restores-parent-project, snapshot restore, project-wide replace, and `updateChapter` itself). Best-effort velocity side effects are deliberately fired *after* commit and logged-and-swallowed, so a snapshot-write failure can never fail the user's save.
- **Evidence:** `packages/server/src/projects/projects.service.ts:166,248`; `packages/server/src/chapters/chapters.service.ts:98,223`; `packages/server/src/snapshots/snapshots.service.ts:139`; `packages/server/src/search/search.service.ts:210`.
- **Found by:** Integration & Data

### [S-6] Deterministic tests via injected seams; critical paths covered
- **Category:** S11 (Testability & coverage)
- **Impact:** High
- **Explanation:** Every non-deterministic dependency is an injectable seam (`freeBytes`, `sameDevice`, `probePort`, `now` in backup; a structural `ImageSource` in export), so free-space, cross-partition, running-server, and timestamp logic are tested without touching the real filesystem/clock. The riskiest code has dedicated coverage (1200+ lines of backup zip-slip/bomb tests, sanitizer XSS-vector tests, image UUID/magic-byte tests, word-count CJK tests), and client console noise is banned by the `expectConsole()` discipline.
- **Evidence:** `packages/server/src/backup/backup-core.ts` (injectable seams) + `backup-core.test.ts`; `packages/server/src/export/image-resolver.ts:14-16`; `packages/client/src/__tests__/expectConsole.ts`.
- **Found by:** Security & Code Quality

### [S-7] Fine-grained single-responsibility server domain modules
- **Category:** S1 (Clear modular boundaries) / S2 (High cohesion)
- **Impact:** Medium
- **Explanation:** Each server domain follows a consistent routes/service/repository/types split, and cross-cutting concerns are decomposed into small focused files rather than dumped together — the images domain is 8 files (fs, paths, reaper, references, repository, routes, service, types), each with one clear job.
- **Evidence:** `packages/server/src/images/*.ts` (all small, named by single responsibility); `packages/server/src/stores/project-store.types.ts:36-157` splits the store contract into 7 per-domain slice interfaces rather than one flat god-interface.
- **Found by:** Structure & Boundaries

### [S-8] Clean, acyclic package dependency direction
- **Category:** S4 (Stable dependency direction) / S5 (Dependency management hygiene)
- **Impact:** Medium
- **Explanation:** `shared` imports nothing from server or client; no client file imports server code and vice-versa (only doc-comment cross-references exist); `madge` reports zero import cycles in `server` and `shared`. Node-only helpers in `shared` are deliberately kept out of the isomorphic barrel and exposed via dedicated subpath exports so `node:fs` cannot reach the browser bundle.
- **Evidence:** `npx madge --circular packages/server/src` → none; `packages/shared/src/index.ts:41-52` (node-only helpers excluded from barrel); `@smudge/shared/node-fs-helpers` subpath export.
- **Found by:** Coupling & Dependencies

### [S-9] Centralized registries for error copy and UI strings
- **Category:** S2 (High cohesion)
- **Impact:** Medium
- **Explanation:** Code/status→message translation is owned by one declarative `SCOPES` registry (call sites never write ad-hoc ladders), and all UI copy lives in one feature-namespaced `STRINGS` catalog — both single-responsibility registries, the string catalog enforced by ESLint.
- **Evidence:** `packages/client/src/errors/scopes.ts`, `packages/client/src/strings.ts`.
- **Found by:** Structure & Boundaries

### [S-10] Structured logging with inbound request correlation
- **Category:** S8 (Observability present)
- **Impact:** Medium
- **Explanation:** Pino structured logging mints/accepts a bounded `X-Request-Id`, binds a `req.log` child logger to `{req_id,method,path}`, echoes the header back, and validates the inbound ID against a regex to prevent log injection. (Qualified by [F-2]: this correlation is not propagated into the service layer.)
- **Evidence:** `packages/server/src/requestContext.ts:50`, `packages/server/src/app.ts:82-87`.
- **Found by:** Error Handling & Observability

### [S-11] Closed-type domain modeling at the persistence boundary
- **Category:** S13 (Domain modeling strength)
- **Impact:** Medium
- **Explanation:** Chapter status is a closed union (`ChapterStatusValue = z.infer<typeof ChapterStatus>`) shared across client and server, with a deliberate, documented policy that DB-row types keep `status: string` only at the SQLite boundary and cast via `toChapterStatus` where crossing into shared types.
- **Evidence:** `packages/shared/src/schemas.ts` (`ChapterStatus`); CLAUDE.md "Chapter status is a closed type"; `ChapterRow.status` cast in enrichment.
- **Found by:** Structure & Boundaries

### [S-12] Single-source-of-truth constants with documented coupling
- **Category:** S14 (Simple, pragmatic abstractions)
- **Impact:** Low
- **Explanation:** The chapter-size cap is defined once (`MAX_CHAPTER_CONTENT_BYTES` + its paired `"5mb"` string) with an inline comment enumerating every consumer and the invariant that the number and string must agree — a minimal abstraction that prevents a class of drift bugs. The velocity injectable is a genuine 2-method seam that tests substitute with a throwing mock.
- **Evidence:** `packages/server/src/constants.ts`; `packages/server/src/velocity/velocity.injectable.ts`.
- **Found by:** Structure & Boundaries, Coupling & Dependencies

## Flaws/Risks

### [F-1] `EditorPage` is the editor's god-orchestrator
- **Category:** Flaw 2 (God object) + coupling concentration
- **Impact:** High
- **Explanation:** Despite a completed decomposition of *rendering* into `EditorHeader`/`EditorMainContent`/`EditorDialogs`, the component still declares ~20 hook subscriptions, ~10 refs, hand-threads ~80 props into `EditorMainContent`, and is the single place that creates the `useEditorMutation` instance + `actionBusyRef` + `editorMachine` + lock refs and wires the *same mutable objects* into every controller hook — so the cross-hook busy/lock invariants hold only because this one component threads them consistently.
- **Evidence:** `packages/client/src/pages/EditorPage.tsx:44-1098`; prop bundle at lines 993-1075; the guard prologue `if (isActionBusy()) {…return;} if (editorMachine.isLocked()) {…return;}` duplicated across ~9 callbacks; shared objects wired at lines 349-397.
- **Found by:** Structure & Boundaries, Coupling & Dependencies (agreement)

### [F-2] Request correlation ID is lost in the service layer
- **Category:** Flaw 21 (No observability plan)
- **Impact:** Medium
- **Explanation:** `req.log`/`req.id` exist only at the HTTP boundary and error handler; there is no `AsyncLocalStorage`, so every service, repository, reaper, and purge module logs through the bare top-level `logger` with no `req_id`. The anomalous best-effort events you would most want to trace (velocity failures, image ref-count warnings, corrupt-JSON search skips) cannot be tied back to the originating request.
- **Evidence:** `packages/server/src/requestContext.ts:50` (correlation attached) vs. `packages/server/src/chapters/chapters.service.ts:131`, `search.service.ts:144,255,382`, `images/images.references.ts:127,155` (bare `logger`).
- **Found by:** Error Handling & Observability

### [F-3] Global mutable singletons reached via a service locator with an undeclared init-order contract
- **Category:** Flaw 1 (Global mutable state) + Flaw 23 (DI misuse) + Flaw 27 (Temporal coupling)
- **Impact:** Medium
- **Explanation:** `let store`, `let db`, and `let velocityServiceOverride` are process-global mutables with `set*/reset*/init*` mutators. Services reach the store via `getProjectStore()` rather than injection, and correct operation requires `initProjectStore(db)` to have run exactly once first (the getter throws "not initialized"; init throws "already initialized") — a call-order contract enforced only at runtime, which also forces serial test setup.
- **Evidence:** `packages/server/src/stores/project-store.injectable.ts:5-35`; `packages/server/src/db/connection.ts:4,21`; `packages/server/src/velocity/velocity.injectable.ts:8`; 17 `getProjectStore()` call sites; init sequenced in `index.ts:42`. (This is also the deliberate, tested seam that makes the app injectable at all.)
- **Found by:** Structure & Boundaries, Coupling & Dependencies (agreement)

### [F-4] `ProjectStore` facade: 51 pass-through methods behind a single-implementation interface
- **Category:** Flaw 9 (Shotgun surgery) + Flaw 7 (Over-abstraction)
- **Impact:** Low
- **Explanation:** Every `SqliteProjectStore` method is a one-line delegation to a repository function, so adding one data operation requires three coordinated edits (repo fn + domain slice interface + delegation method). The `ProjectStore` interface has exactly one implementation, and both test injection points construct that same concrete class over a real DB — no fake implements it, so the "substitution seam" is unrealized. Both frictions are compiler-guided and the `transaction(txStore)` seam is genuinely load-bearing, so this nets to a mild smell.
- **Evidence:** `packages/server/src/stores/sqlite-project-store.ts:33-296` (51 delegations); `packages/server/src/stores/project-store.types.ts:36-157`; sole `new SqliteProjectStore` sites are the injectable, the tx self-construction, and two tests.
- **Found by:** Structure & Boundaries, Coupling & Dependencies (agreement)

### [F-5] Documented architecture omits the store-facade layer
- **Category:** Flaw 13 (Inconsistent boundaries vs. steering)
- **Impact:** Low
- **Explanation:** CLAUDE.md states the layering is "Routes → Services → Repositories" and its Target Project Structure lists no `stores/`, but no service imports a repository directly — the real path is Routes → Services → `getProjectStore()` (the `SqliteProjectStore` facade) → Repositories. The facade is an intermediate layer absent from the steering docs.
- **Evidence:** `grep repository packages/server/src/*/*.service.ts` → none; all services import `getProjectStore`; the only repository importer is `sqlite-project-store.ts`.
- **Found by:** Structure & Boundaries
- **Status:** Fixed
- **Status reason:** Reconciled the steering docs with the code (answers Next-Question #1 in favor of naming the layer). CLAUDE.md's Target Project Structure now lists `stores/` (the `SqliteProjectStore` facade over the repositories), and the Architecture line reads `Routes → Services → ProjectStore facade → Repositories`, noting services reach data only via `getProjectStore()` and the facade hosts the `transaction(txStore)` seam. Docs-only change; no code touched.
- **Status date:** 2026-07-11 20:10 UTC
- **Status commit:** 69220a38a3e7d424711d627f33b33b19a075d822

### [F-6] `index.ts` bypasses the DB-path single owner with an inline Knex config
- **Category:** Flaw 22 (Configuration sprawl)
- **Impact:** Low
- **Explanation:** `config/paths.ts` claims sole ownership of DB-location derivation via `getDbPath()`, and `knexfile.ts` honors it — but `index.ts` reads `process.env.DB_PATH` directly and hand-builds an inline Knex config (client/connection/migrations/`loadExtensions`) when the env var is set, duplicating the migrations block. Both paths produce the same outcome, so the cost is duplicated config and a bypassed single-owner helper (drift risk), not a live bug.
- **Evidence:** `packages/server/src/index.ts:25-40` vs. `packages/server/src/db/knexfile.ts:8-20` and `packages/server/src/config/paths.ts:24-25`.
- **Found by:** Error Handling & Observability
- **Status:** Fixed
- **Status reason:** `index.ts` now calls `initDb(createKnexConfig())`; the inline `DB_PATH ? {...} : undefined` block (duplicated migrations config, bypassed single owner) is gone. `createKnexConfig()`→`getDbPath()` honors `process.env.DB_PATH`, proven by `data-paths.test.ts`. Behavior-identical; entrypoint is coverage-excluded.
- **Status date:** 2026-07-11 19:01 UTC
- **Status commit:** 2e01462c0f5ecd92d1dd49ee06c8299ff4c1a2d3

### [F-7] `deleteProject` bypasses the shared image-ref-count guard
- **Category:** Flaw 17 (No clear ownership of data)
- **Impact:** Low
- **Explanation:** `deleteChapter` decrements image reference counts through `applyImageRefDiff` (which guards `image.project_id !== projectId`), but `deleteProject` loops raw over extracted image IDs and calls `incrementImageReferenceCount(imageId, -1)` unconditionally. A stale or foreign `/api/images/<uuid>` URL pasted into this project's content would decrement a *different* project's ref count — the exact cross-project touch the shared helper exists to prevent.
- **Evidence:** `packages/server/src/projects/projects.service.ts:186-188` vs. `packages/server/src/images/images.references.ts:97`.
- **Found by:** Integration & Data
- **Status:** Fixed
- **Status reason:** Replaced `deleteProject`'s raw `incrementImageReferenceCount(-1)` loop with the shared `applyImageRefDiff(txStore, ch.content, null, project.id)` per chapter, so the cross-project guard now applies; a stale/foreign image URL can no longer decrement another project's ref count. Red test added in `projects.service.test.ts`.
- **Status date:** 2026-07-11 18:50 UTC
- **Status commit:** 4150bafb7f4d3a4996a3e226e8daf23a48aa2bd0

### [F-8] Image upload POST is non-idempotent with no dedup
- **Category:** Flaw 19 (Lack of idempotency)
- **Impact:** Low
- **Explanation:** Each upload mints a fresh `uuidv4()` plus a new file and DB row, so a client retry after a dropped response produces a duplicate image. No idempotency key or content-hash dedup exists (unlike the manual-snapshot POST, which is content-hash deduped).
- **Evidence:** `packages/server/src/images/images.service.ts:72-91`.
- **Found by:** Integration & Data

### [F-9] Two mutation PUTs return a server-authored success string
- **Category:** Flaw 24 (Inconsistent API contracts)
- **Impact:** Low
- **Explanation:** `PUT .../chapters/order` returns `{message:"Chapter order updated."}` and `PUT /settings` returns `{message:"Settings updated"}`, whereas the F-16 principle is that the client owns the user-facing success toast. F-16 formally governs only DELETEs, so this is not a strict violation — but two endpoints ship English the client ignores, against the spirit of that principle.
- **Evidence:** `packages/server/src/projects/projects.routes.ts:91`; `packages/server/src/settings/settings.routes.ts:32`.
- **Found by:** Integration & Data
- **Status:** Fixed
- **Status reason:** Both `PUT .../chapters/order` and `PATCH /settings` now return `204` No Content with an empty body instead of a server-authored `{message}` string, fully realizing the F-16 "client owns the success toast" principle. No production caller read the message; the client `apiFetch<undefined>` type params and ~9 test mocks were updated to the 204→undefined contract, and CLAUDE.md §API Design now documents the two endpoints under the body-less-204 contract. Red tests (204 + empty body) added to `projects.test.ts` and `settings.test.ts`; 288 affected tests pass, typecheck clean.
- **Status date:** 2026-07-11 20:05 UTC
- **Status commit:** 75564103c91f0e56e64fd3efdf692d66b4661f5c

### [F-10] Three coexisting DEV-gating idioms, two of them a documented hazard
- **Category:** Flaw 34 (Inconsistent error/logging conventions)
- **Impact:** Low
- **Explanation:** `clientLog.ts` uses the guarded `typeof import.meta.env !== "undefined" && import.meta.env.DEV === true` and its own comment explains that the optional-chain form silently no-ops where `import.meta.env` is unpopulated — yet `devWarn.ts` and `apiErrorMapper.ts` still use the discouraged `import.meta.env?.DEV` form.
- **Evidence:** `packages/client/src/errors/clientLog.ts:17-30`; `packages/client/src/errors/devWarn.ts:3`; `packages/client/src/errors/apiErrorMapper.ts:211`.
- **Found by:** Error Handling & Observability
- **Status:** Fixed
- **Status reason:** `devWarn.ts` now routes through `clientWarn`, and `apiErrorMapper.ts` dropped its redundant outer `if (import.meta.env?.DEV)` around the already-guarded `clientError`. Both discouraged `import.meta.env?.DEV` idioms are gone; the only DEV gate is now `clientLog`'s safe `isDev()` (`typeof import.meta.env !== "undefined" && import.meta.env.DEV === true`), used everywhere. Behavior-preserving; covered by `devWarn.test.ts` and `apiErrorMapper.test.ts` (extrasFrom-throws).
- **Status date:** 2026-07-11 19:05 UTC
- **Status commit:** aa44c71ac51e53d438fb04f4a61175672ab42657

### [F-11] Magic-number find/replace debounce
- **Category:** Flaw 28 (Magic numbers/strings)
- **Impact:** Low
- **Explanation:** The auto-search debounce is a bare inline `setTimeout(..., 300)`, inconsistent with the named `AUTO_SAVE_DEBOUNCE_MS = 1500` and `SAVE_BACKOFF_MS` constants elsewhere; "300ms" is repeated across five comments but exists nowhere as a constant.
- **Evidence:** `packages/client/src/hooks/useFindReplaceState.ts:321` (plus comments at 62, 163, 270, 301, 316).
- **Found by:** Error Handling & Observability
- **Status:** Fixed
- **Status reason:** Extracted `SEARCH_DEBOUNCE_MS = 300` (matching the `AUTO_SAVE_DEBOUNCE_MS` idiom) and used it at the `setTimeout`; the four "300ms" comments now name the constant so the value lives in exactly one place. Behavior-identical refactor covered by the existing debounce-timing tests in `useFindReplaceState.test.ts` (35 pass).
- **Status date:** 2026-07-11 19:50 UTC
- **Status commit:** f42cf75c18f5eb4611168c7ccd44592bb666483b

### [F-12] No-op ref backfilled after a circular hook declaration
- **Category:** Flaw 27 (Temporal coupling)
- **Impact:** Low
- **Explanation:** `applyReloadFailedLockRef` is initialized to `() => {}` and only assigned its real handler further down the component body (because the handler depends on state `useProjectEditor` itself produces), creating a one-render-tick window where a lock request is silently dropped. The window is documented as doubly backstopped by the 1.5s auto-save debounce and an `isLocked()` no-op.
- **Evidence:** `packages/client/src/pages/EditorPage.tsx:52,82,328`.
- **Found by:** Coupling & Dependencies

### [F-13] Type-only circular dependency in the error module
- **Category:** Flaw 5 (Circular dependencies)
- **Impact:** Low
- **Explanation:** `apiErrorMapper.ts` value-imports `SCOPES` from `scopes.ts`, while `scopes.ts` type-imports `ScopeEntry` from `apiErrorMapper.ts`; `madge` flags the cycle, but the back-edge is `import type` (erased at compile), so there is no runtime initialization hazard — still a structural cycle that trips tooling and blocks clean module extraction.
- **Evidence:** `packages/client/src/errors/apiErrorMapper.ts:2` ↔ `packages/client/src/errors/scopes.ts:1`.
- **Found by:** Coupling & Dependencies
- **Status:** Fixed
- **Status reason:** Moved the `ScopeEntry` type definition into `scopes.ts` (its natural home — it types the `SCOPES` registry there) and dropped `scopes.ts`'s `import type ... from "./apiErrorMapper"` back-edge; `apiErrorMapper.ts` imports and re-exports `ScopeEntry` so consumers are unchanged. `madge --circular` now reports zero cycles (previously flagged `apiErrorMapper ↔ scopes`). Pure type move, behavior-identical; 401 error-module tests pass.
- **Status date:** 2026-07-11 19:03 UTC
- **Status commit:** 18c9298ea6e2bf0770628fcc75ccfa01d0b99d75

### [F-14] Health check is not a liveness probe
- **Category:** Flaw 21 (No observability plan)
- **Impact:** Low
- **Explanation:** `/api/health` returns a static `{status:"ok"}` without checking SQLite reachability, so for the (not-yet-implemented) single-container Docker target an orchestrator probing it could not detect a process whose DB handle is unusable (locked file, disk full, corrupt WAL).
- **Evidence:** `packages/server/src/app.ts:50-52`.
- **Found by:** Error Handling & Observability
- **Status:** Fixed
- **Status reason:** `/api/health` now runs a `SELECT 1` SQLite liveness probe: 200 `{status:"ok"}` when the handle is usable, 503 `{status:"error"}` when it throws (locked file / full disk / corrupt WAL). Per Ovid's decision, 503 is added to the status allowlist as a documented `/api/health`-only carve-out (CLAUDE.md §API Design). Red test in `health.test.ts`; `request-context.test.ts` given an initialized DB so its `/api/health` fixture stays quietly 200.
- **Status date:** 2026-07-11 19:00 UTC
- **Status commit:** 3d5f9ec86da145c3d837be78618078127a87a190

### [F-15] Server export renders TipTap JSON to HTML without the client's sanitizer pass
- **Category:** Flaw 30 (Security as an afterthought — defense-in-depth asymmetry)
- **Impact:** Low
- **Explanation:** The client renders TipTap→HTML through a hardened DOMPurify instance as documented defense-in-depth against a "hostile backup/snapshot/server payload," but the server export path renders the same stored JSON to a downloadable HTML file via `generateHTML(content, editorExtensions)` with no equivalent sanitize step. The backstop is real (ProseMirror schema-filtering bounds the tag/attr set, titles are `escapeHtml`'d, it is a downloaded file rather than served HTML), so exploitability is marginal — but the two paths treat the same untrusted content asymmetrically.
- **Evidence:** `packages/server/src/export/export.renderers.ts:33-41,100-149`; `packages/shared/src/schemas.ts:53` (`TipTapDocSchema` uses `.passthrough()`).
- **Found by:** Security & Code Quality

### [F-16] Image-URI accept/reject rule encoded twice across packages
- **Category:** Flaw 6 (Leaky abstraction / duplicated rule)
- **Impact:** Low
- **Explanation:** The client's `ALLOWED_URI_REGEXP` (relative `/api/images/<uuid>` only) and the server's `IMAGE_SRC_RE` (optional `https?://host` prefix) both encode "what is a valid image src." The divergence is deliberate and extensively documented — they serve different threat models (client = fail-closed XSS allowlist; server = conservative ref-count matcher) and are intentionally *not* identical — so the residual issue is only the cross-package coupling (a change to one warrants review of the other), not a rule that should be unified in `shared`.
- **Evidence:** `packages/client/src/sanitizer.ts:91-92` vs. `packages/server/src/images/images.references.ts:36-39` (each with a cross-referencing comment).
- **Found by:** Coupling & Dependencies

### [F-17] Low cohesion: ZIP wire-format parsing mixed with backup orchestration
- **Category:** Flaw 11 (Low cohesion)
- **Impact:** Low
- **Explanation:** `backup-core.ts` bundles low-level ZIP wire-format parsing (EOCD scan, central-directory walk, declared-size reads, zip-slip/bomb guards) with high-level backup lifecycle orchestration (`runBackup`/`runRestore`/`runAutoBackup`/rotation) in one 543-line file. Mitigated: the co-location is a deliberate security decision — the bomb tests must parse archives with the exact same byte-offset logic as production, so the format primitives are shared with tests to prevent offset drift.
- **Evidence:** `packages/server/src/backup/backup-core.ts:42-56` (format layer) alongside `runRestore`/`runBackup`/`rotateAutoBackups` (orchestration).
- **Found by:** Structure & Boundaries
- **Status:** Fixed
- **Status reason:** Extracted the ZIP wire-format + zip-slip/bomb primitives (`findEocdOffset`, `walkCentralDirectory`, `readCentralDirectorySizes`, `checkDeclaredSizes`, `validateEntryPaths`, `ZipSlipError`, `DecompressionBombError`, `CentralDirEntry`, `BombLimits`, `DEFAULT_BOMB_LIMITS`, sig constants) into a new `backup-zip-format.ts`. The anti-drift guarantee (S9) is preserved by a shared *module* rather than single-file co-location — both `runRestore` (production) and the bomb/zip-slip tests import the same byte-offset logic. `backup-core.ts` re-exports every symbol so all importers (tests, scripts) are unchanged. Pure move; server typecheck clean, 80 backup tests pass.
- **Status date:** 2026-07-11 21:13 UTC
- **Status commit:** (pending)

### [F-18] Anemic domain model
- **Category:** Flaw 10 (Feature envy / anemic domain model)
- **Impact:** Low
- **Explanation:** Domain entities are plain `*Row` record types with no behavior; all business rules (transactional image-ref diffing, velocity side effects, corruption fallback, slug regeneration) live in service free functions operating on those records. This is idiomatic functional TypeScript and "anemic" here is a paradigm judgment rather than a defect — the lowest-value finding in the set.
- **Evidence:** `packages/server/src/chapters/chapters.service.ts:32-314` (free functions over `ChapterRow`).
- **Found by:** Structure & Boundaries

### [F-19] Hidden side effects in chapter mutations (documented)
- **Category:** Flaw 12 (Hidden side effects)
- **Impact:** Low
- **Explanation:** `updateChapter`/`deleteChapter` do considerably more than their names suggest (bump project `updated_at`, decrement image ref counts, fire post-commit velocity snapshots), which is classic Flaw 12 territory — but each side effect is explicitly enumerated in the function's doc comment and best-effort failures are logged rather than swallowed. A mitigated watch-item; the risk is that future methods may not maintain the same doc discipline.
- **Evidence:** `packages/server/src/chapters/chapters.service.ts:54-197` (doc comments at 42-53, 155-165; logging at 131, 191).
- **Found by:** Error Handling & Observability

## Over-Engineering Audit (ponytail)

A separate whole-repo pass hunting only for what to *cut* — reinvented stdlib, unused flexibility, speculative abstraction, redundant dependencies. Ranked biggest cut first. Verdict: the tree is genuinely lean (ts-prune surfaced zero real dead code, every declared production dependency maps to real usage, and the whole codebase contains exactly one `implements`), so the list is short.

- `native:` **`uuid` dependency is redundant** — it is imported only as `v4()` for ID generation across 5 files; Node 22 (the pinned target) ships `crypto.randomUUID()`, and the separate `z.string().uuid()` validations use Zod, not this package. Replace the 5 imports + call sites with `crypto.randomUUID()`. `[packages/server/src/{snapshots/snapshots.service,images/images.service,projects/projects.service,velocity/velocity.repository,search/search.service}.ts]` — **-1 production dependency**.
- `yagni:` **The 51-method `ProjectStore` interface has exactly one implementation** and no fake ever implements it (tests construct the concrete class over a real DB). The `transaction(txStore)` seam needs a *type*, not a hand-maintained 7-slice interface duplicating the class shape — `txStore` could be typed as `SqliteProjectStore`. Soft call: the interface's documented data-surface value may justify the three-edit-per-operation tax, but it is flexibility with a single consumer. `[packages/server/src/stores/project-store.types.ts]` — see [F-4]. Not a clean cut; flagged, not recommended for removal without the doc trade-off in mind.
- `shrink:` **Two DEV-gate idioms use the `import.meta.env?.DEV` form that `clientLog.ts` documents as a silent-no-op hazard.** Collapse both to `clientLog`'s guarded `typeof import.meta.env !== "undefined" && import.meta.env.DEV === true`. `[packages/client/src/errors/{devWarn,apiErrorMapper}.ts]` — see [F-10].

**Not cuttable (deliberately reinvented, verified justified):** `backup-core.ts` hand-rolls non-decompressing ZIP central-directory parsing even though `jszip` is a dependency — this is *correct*, because decompression-bomb defense must inspect declared sizes *without* decompressing, which `jszip` cannot do (see [S-2]/[F-17]). Leave it.

net: ~0 lines, **-1 dep** possible (the `uuid` removal is line-neutral; the yagni/shrink items are shrinks, not deletions). The codebase is otherwise lean — ship.

## Coverage Checklist

### Flaw/Risk Types 1–34
| # | Type | Status | Finding |
|---|------|--------|---------|
| 1 | Global mutable state | Observed | F-3 |
| 2 | God object | Observed | F-1 |
| 3 | Tight coupling | Not observed | — |
| 4 | High/unstable dependencies | Not observed | — |
| 5 | Circular dependencies | Observed | F-13 |
| 6 | Leaky abstractions | Observed | F-16 |
| 7 | Over-abstraction | Observed | F-4 |
| 8 | Premature optimization | Not observed | — |
| 9 | Shotgun surgery | Observed | F-4 |
| 10 | Feature envy / anemic domain model | Observed | F-18 |
| 11 | Low cohesion | Observed | F-17 |
| 12 | Hidden side effects | Observed | F-19 |
| 13 | Inconsistent boundaries | Observed | F-5 |
| 14 | Distributed monolith | Not applicable | — (single process) |
| 15 | Chatty service calls | Not observed | — (single fat load per project, not chatty) |
| 16 | Synchronous-only integration | Not observed | — (better-sqlite3 sync is deliberate/correct) |
| 17 | No clear ownership of data | Observed | F-7 |
| 18 | Shared database across services | Not applicable | — (one DB, one store) |
| 19 | Lack of idempotency | Observed | F-8 |
| 20 | Weak error handling strategy | Not observed | — (strength S-3) |
| 21 | No observability plan | Observed | F-2, F-14 |
| 22 | Configuration sprawl | Observed | F-6 |
| 23 | Dependency injection misuse | Observed | F-3 |
| 24 | Inconsistent API contracts | Observed | F-9 |
| 25 | Business logic in the UI | Not observed | — (word count is shared `countWords()`; validation is server Zod) |
| 26 | Poor transactional boundaries | Not observed | — (strength S-5) |
| 27 | Temporal coupling | Observed | F-3, F-12 |
| 28 | Magic numbers/strings | Observed | F-11 |
| 29 | "Utility" dumping ground | Not observed | — |
| 30 | Security as an afterthought | Observed | F-15 |
| 31 | Dead code / unused dependencies | Not observed | — (ts-prune candidates all verified live) |
| 32 | Missing/inadequate test coverage | Not observed | — (strength S-6) |
| 33 | Hard-coded credentials or secrets | Not observed | — (no secrets; no-auth by design) |
| 34 | Inconsistent error/logging conventions | Observed | F-10 |

### Strength Categories S1–S14
| # | Category | Status | Finding |
|---|----------|--------|---------|
| S1 | Clear modular boundaries | Observed | S-7 |
| S2 | High cohesion | Observed | S-7, S-9 |
| S3 | Loose coupling | Observed | S-8, S-12 (velocity seam) |
| S4 | Dependency direction is stable | Observed | S-8 |
| S5 | Dependency management hygiene | Observed | S-8 |
| S6 | Consistent API contracts | Observed | S-1 |
| S7 | Robust error handling | Observed | S-3 |
| S8 | Observability present | Observed (qualified by F-2) | S-10 |
| S9 | Configuration discipline | Observed (qualified by F-6) | S-12 |
| S10 | Security built-in | Observed | S-2 |
| S11 | Testability & coverage | Observed | S-6 |
| S12 | Resilience patterns | Observed | S-4, S-5 |
| S13 | Domain modeling strength | Observed | S-11 |
| S14 | Simple, pragmatic abstractions | Observed | S-12 |

## Hotspots

Top 3 files/directories to review:
1. `packages/client/src/pages/EditorPage.tsx` — the one High-impact risk (F-1) and the coupling nexus (F-3, F-12 also land here); every editor concern fans through it, and its correctness rests on hand-threaded shared mutable state. Highest-leverage place to reduce concentration.
2. `packages/server/src/backup/backup-core.ts` — a strong-core hotspot: the app's most important untrusted-input defense (S-2) and its best test seams (S-6) live here, but so does the cohesion smell (F-17). Protect the security/test design; the mixing is the deliberate cost of it.
3. `packages/server/src/stores/` — the layer the docs omit (F-5), the service-locator/init-order seam (F-3), and the single-impl facade (F-4) all converge here. Not broken, but it is where three Low/Medium findings intersect and where a doc-vs-code reconciliation would pay off.

## Next Questions

1. Is the `Routes → Services → Repositories` statement in CLAUDE.md intended to hide the store facade as an implementation detail, or should the documented architecture be updated to name the `stores/` layer (F-5)?
2. For the eventual Docker deployment, will `/api/health` need a real DB-reachability check, or is process-up sufficient for the intended single-container orchestration (F-14)?
3. Is there any real retry path (network flap, proxy timeout) where a dropped image-upload response could be retried by the client, making the non-idempotent upload (F-8) a duplicate-image risk in practice?
4. Should `EditorPage`'s shared busy/lock/mutation objects be lifted into a single context/provider so the invariant stops depending on manual prop-threading (F-1), or is the current explicit wiring considered a deliberate readability trade-off?
5. Is the service-layer correlation-ID gap (F-2) worth an `AsyncLocalStorage` given the single-user, low-concurrency reality, or is inbound-boundary correlation deemed sufficient?

## Analysis Metadata

- **Agents dispatched:** Structure & Boundaries; Coupling & Dependencies; Integration & Data; Error Handling & Observability; Security & Code Quality; plus one Verifier.
- **Scope:** Full repository, 288 TS/TSX files (~24k non-test lines); `.devcontainer/` excluded per project policy.
- **Raw findings:** 22 flaw candidates + ~16 strength candidates (before verification).
- **Verified findings:** 19 flaws + 12 reported strengths (after consolidation).
- **Filtered out:** 0 flaws dropped; 3 consolidations (F-1 = R1+R12, F-3 = R4+R7, F-4 = R2+R8); 4 impacts corrected downward (F-4, F-5, F-6, F-16 Medium→Low); F-16's "must-agree/sync-by-comment" premise corrected to "intentional, documented divergence."
- **By impact:** Flaws — 1 High, 2 Medium, 16 Low. Strengths — 6 High, 5 Medium, 1 Low.
- **Steering files consulted:** CLAUDE.md; `docs/roadmap-decisions/*` (19 decision logs referenced by specialists).
- **Over-engineering audit:** folded in as its own section above — 1 dependency cut (`uuid`→native), 2 shrink/yagni items cross-referenced to F-4 and F-10; otherwise assessed lean.
