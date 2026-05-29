# Architecture Report — smudge

**Date:** 2026-05-29
**Commit:** 2141b3c1a9e917f6e3bc912295fb35cbe63ff767
**Languages:** TypeScript (Node.js 22 / Express 4 backend, React 18 + Vite + TipTap frontend), SQLite via Knex + better-sqlite3
**Key directories:** `packages/shared/`, `packages/server/`, `packages/client/`, `e2e/`
**Scope:** Full repository (118 non-test source files). `.devcontainer/` excluded per project policy.

## Repo Overview

Smudge is a single-user, no-auth web application for long-form writing (projects → chapters), intended to replace Google Docs for book-length work. It is a **monolith**, not a distributed system: a single Express process serving a REST API, backed by a single SQLite file (synchronous better-sqlite3, Knex for migrations/queries, Zod for validation), with a React SPA client. Chapter content is stored as TipTap JSON (source of truth), and `countWords()` is shared between client and server so counts always agree.

The codebase is organized as an npm-workspaces monorepo:

- **`packages/shared`** — types, Zod schemas, `countWords()`, `slugify`, TipTap text helpers. A true leaf: imports nothing from server or client.
- **`packages/server`** — Express API following a strict **Routes → Services → Repositories** layering, organized by domain (`projects`, `chapters`, `chapter-statuses`, `velocity`, `settings`, `snapshots`, `images`, `search`, `export`). Plus `db/` (connection singleton, migrations, purge), `stores/` (a `ProjectStore` abstraction + sqlite implementation + injectable), `logger.ts` (pino), `constants.ts`, `timezone.ts`.
- **`packages/client`** — React SPA with `components/`, `hooks/`, `pages/`, `api/client.ts`, a unified `errors/` mapper layer, `utils/`, `sanitizer.ts`, and externalized UI strings in `strings.ts`.

The project is mid-MVP with an unusually mature engineering discipline for its stage: documented save-pipeline invariants, a unified API-error mapper, externalized strings enforced by ESLint, transactional write boundaries, and adversarial security tests. The architectural risks that exist are concentrated in two oversized client modules and in the absence of a _server-side_ counterpart to the disciplined client error layer — not in correctness or data integrity.

Five specialist agents analyzed structure, coupling, integration/data, error-handling/observability, and security/quality in parallel; a verifier then re-read every referenced line. 28 raw findings were verified (two pairs merged), 0 dropped — several with factual corrections noted below.

## Strengths

### [S-1] Routes → Services → Repositories layering is enforced in practice

- **Category:** S1 (Clear modular boundaries)
- **Impact:** High
- **Explanation:** The documented layering is not aspirational — it holds across the entire server. No `*.service.ts` contains SQL/query-builder calls, no `*.repository.ts` touches HTTP (`req`/`res`), services never import another domain's repository, and `getDb()` appears only in `db/connection.ts`.
- **Evidence:** server-wide; e.g. `packages/server/src/chapters/chapters.service.ts`, `packages/server/src/db/connection.ts`. All data access flows through `getProjectStore()`.
- **Found by:** Structure & Boundaries (corroborated by Security's parametrized-SQL finding)

### [S-2] Every multi-write mutation is wrapped in a single DB transaction

- **Category:** S12 (Resilience patterns)
- **Impact:** High
- **Explanation:** Every operation that touches more than one row/table runs inside `store.transaction()` — soft-delete + image-refcount decrement, reorder + project-timestamp bump, restore-chapter + restore-parent-project + slug regen, replace + auto-snapshot + refcount diff. The transaction wrapper explicitly rejects nesting, and velocity side-effects fire _after_ commit as best-effort. This is why transactional-boundary flaws are largely absent.
- **Evidence:** `packages/server/src/projects/projects.service.ts:62,165,209,247`; `chapters.service.ts:86,147,187`; `snapshots.service.ts:27,84,139`; `search.service.ts:208`; `images.service.ts:163`; nesting guard at `stores/sqlite-project-store.ts:284`.
- **Found by:** Integration & Data

### [S-3] Idempotency designed in at the points that need it

- **Category:** S12 (Resilience patterns)
- **Impact:** High
- **Explanation:** The `daily_snapshots` upsert uses `ON CONFLICT(project_id, date) DO UPDATE`, so retried auto-saves are naturally idempotent; chapter restore handles `restoredCount === 0` as success (double-restore safe); reorder is idempotent by construction (sets `sort_order = i` from the full ID list); manual snapshots dedup by content hash inside the transaction.
- **Evidence:** `packages/server/src/velocity/velocity.repository.ts:10`; `chapters.service.ts:195`; `projects.service.ts:258`; `snapshots.service.ts:38`.
- **Found by:** Integration & Data

### [S-4] Unified client API-error mapper with single-owner translation

- **Category:** S7 (Robust error handling)
- **Impact:** High
- **Explanation:** All 38 API scopes route through one `mapApiError(err, scope)` with a clear precedence ladder (ABORTED → 2xx BAD_JSON → NETWORK → byCode → byStatus → fallback). Raw `err.message` never reaches JSX (grep confirms 0 hits in non-test `.tsx`), and a guard defends against prototype-chain `code` injection. The mapper never throws — `safeExtrasFrom` sandboxes user-supplied `extrasFrom` in try/catch.
- **Evidence:** `packages/client/src/errors/apiErrorMapper.ts:107-219` (`mapApiError`, `safeExtrasFrom` at 202-215), `errors/scopes.ts:59-513`.
- **Found by:** Error Handling & Observability

### [S-5] Structured pino logging; zero `console.*` in server source

- **Category:** S8 (Observability present)
- **Impact:** High
- **Explanation:** All server logging goes through a structured pino logger with object-first fields (`{ err, project_id, chapter_id }`), and the global error handler logs every unhandled request error with its resolved status. A deliberate hardening pass (commit `57f6bb9`) replaced all `console.*` with pino.
- **Evidence:** `packages/server/src/logger.ts:1-24`, `app.ts:69` (`logger.error({ err, status }, "Unhandled request error")`).
- **Found by:** Error Handling & Observability

### [S-6] Save-pipeline invariants enforced by construction in `useEditorMutation`

- **Category:** S3 (Loose coupling) / S14 (Pragmatic abstractions)
- **Impact:** High
- **Explanation:** The load-bearing save-pipeline ordering (cancel → lock → flush → markClean → mutate → cache-clear → reload → unlock) is encoded once, with a busy guard, a discriminated-union directive forcing `reloadChapterId`, and re-reads of the editor ref across every await window. This is the correct structural answer to the temporal coupling the save pipeline inherently carries. The hook also depends only on a `Pick<>` slice of the project editor, not the whole hook.
- **Evidence:** `packages/client/src/hooks/useEditorMutation.ts:18-21,37-40,78-80,144-194,489-556`.
- **Found by:** Coupling & Dependencies

### [S-7] Layered, fail-closed input/file/content security

- **Category:** S10 (Security built-in)
- **Impact:** High
- **Explanation:** Despite being a no-auth app, the genuine trust boundaries are well-defended: image upload validates empty → MIME allowlist → magic bytes → size cap, and stores `path.basename(originalname).replace(/\0/g,"")` (path-traversal + null-byte safe); image storage paths are built from UUID-only segments + a fixed MIME→ext map, with `requireUuidParam` anchored-regex validation before any filesystem access; the client sanitizer uses a scoped DOMPurify instance with a tag/attr/URI triple allowlist that closes the DOMPurify 3.x `data:`-URI carve-out.
- **Evidence:** `packages/server/src/images/images.service.ts:43-99`, `images/images.paths.ts:59-61`, `client/src/sanitizer.ts:91-115`.
- **Found by:** Security & Code Quality

### [S-8] ReDoS / amplification guards on project-wide search-replace

- **Category:** S10 (Security built-in) / S12 (Resilience)
- **Impact:** High
- **Explanation:** Find-and-replace defends multiple independent budgets: `assertSafeRegexPattern` rejects catastrophic-backtracking shapes, a 2-second wall-clock deadline, a max-matches cap, and a post-replace `Buffer.byteLength` check inside the transaction that rolls back to defeat `$'`/`` $` `` splice amplification.
- **Evidence:** `packages/server/src/search/search.service.ts:32,82,102,150,270-313`.
- **Found by:** Security & Code Quality

### [S-9] Consistent error envelope and single-owner column writes

- **Category:** S6 (Consistent API contracts)
- **Impact:** Medium
- **Explanation:** Every error response across all nine route files uses `{ error: { code, message } }`; the global handler maps status→code consistently and never leaks raw `err.message` for 5xx. Each mutable column (`reference_count`, `word_count`, `daily total`, `deleted_at`, `slug`, `sort_order`) has exactly one owning code path — no competing writers (flaw type 17 absent).
- **Evidence:** `packages/server/src/app.ts:63-94`; refcount via `images.references.ts`/`images.service.ts`; word counts via `countWords()` in three writers.
- **Found by:** Integration & Data

### [S-10] Disciplined singletons with explicit init/reset seams

- **Category:** S14 (Simple, pragmatic abstractions)
- **Impact:** Medium
- **Explanation:** The module-level mutable singletons (`db`, `store`, `velocityServiceOverride`) are all guarded: getters throw if uninitialized, init refuses double-init, and reset/set are clearly marked test-only. This is the well-managed form of global state — one documented seam rather than scattered mutables. `velocity.injectable` is justified DI: it lets `chapters.service` tests verify resilience when velocity throws.
- **Evidence:** `packages/server/src/db/connection.ts`, `stores/project-store.injectable.ts`, `velocity/velocity.injectable.ts`; `__tests__/chapters.service.test.ts:57`.
- **Found by:** Structure & Boundaries, Coupling & Dependencies

### [S-11] Clean acyclic package layering

- **Category:** S4 (Stable dependency direction)
- **Impact:** Medium
- **Explanation:** `shared` imports nothing from `server` or `client`; both depend only on `shared`; neither server nor client import each other (cross-references exist only as comments). A `parsePort` duplication forced by a bare-Node-ESM constraint in `vite.config.ts` is acknowledged and guarded by a parity test rather than left to drift silently.
- **Evidence:** `grep "from .*server|client" packages/shared/src` → empty; `packages/shared/src/__tests__/parsePort-body-parity.test.ts`.
- **Found by:** Coupling & Dependencies

### [S-12] Critical paths have meaningful, adversarial test coverage

- **Category:** S11 (Testability & coverage)
- **Impact:** Medium
- **Explanation:** The sanitizer suite covers `<script>`, event handlers, `javascript:`/`data:` URIs, path-traversal in image URLs, mXSS namespaces, and singleton non-pollution; integration tests run against real SQLite; save/restore, image dereference, export rendering, and the full migration chain all have dedicated suites. Coverage thresholds (95/85/90/95) are enforced in config.
- **Evidence:** `packages/client/src/__tests__/sanitizer.test.ts` (24 cases); server `__tests__/` for images, export, snapshots, migrations.
- **Found by:** Security & Code Quality

### [S-13] Magic numbers are named where they matter; word-count/slug logic lives in shared/server, not the UI

- **Category:** S9 (Configuration discipline)
- **Impact:** Medium
- **Explanation:** Load-bearing timing/limit values are extracted constants (`SAVE_BACKOFF_MS = [2000,4000,8000]`, `MAX_RETRIES`, `AUTO_SAVE_DEBOUNCE_MS`, `REGEX_DEADLINE_MS`, `MAX_TIPTAP_DEPTH`). Business logic (word counting in `@smudge/shared`, slug generation server-side, soft-delete rules) is correctly placed — flaw type 25 (business logic in UI) is absent.
- **Evidence:** `packages/client/src/hooks/useProjectEditor.ts:27`, `components/Editor.tsx:58`, `server/src/search/search.service.ts:32`; `countWords` in `packages/shared/src/wordcount.ts`.
- **Found by:** Error Handling & Observability

## Flaws/Risks

### [F-1] God object: `EditorPage.tsx`

- **Category:** Flaw 2 (God object)
- **Impact:** High
- **Explanation:** A single 2373-line component orchestrates the entire application UI — ~51 `useState/useCallback/useEffect/useMemo/useRef` calls followed by a ~640-line render wiring 27 distinct child components, plus inline sentinel error classes and a `renderSnapshotContent` helper. It is the central coordination point for nearly every feature.
- **Evidence:** `packages/client/src/pages/EditorPage.tsx:83-2373` (`export function EditorPage()`, render `return (` at line 1734). _(Correction: hook count is 51, not the 74 originally reported.)_
- **Found by:** Structure & Boundaries
- **Status:** Fixed
- **Status reason:** Two sessions. **Session 1 (orchestration hooks, `f578758`):** Decomposed the two largest cohesive _imperative orchestration_ clusters into dedicated hooks (the same hook-extraction seam the F-2 fix used). Extracted the find-and-replace flow (`finalizeReplaceSuccess` / `executeReplace` / `handleReplaceAllInManuscript` / `handleReplaceAllInChapter` / `handleReplaceOne` + the `replaceConfirmation` state and the `replaceOp` / slug latest-ref used only by these handlers) into a new `useFindReplaceController`, and the snapshot flow (`handleRestoreSnapshot`, the `RestoreAbortedError`/`RestoreFailedError` sentinels, `renderSnapshotContent`, and the `onView`/`onBeforeCreate` handlers) into a new `useSnapshotController`. The single `useEditorMutation` instance, the cross-caller `actionBusyRef`/`isActionBusy`, the editor-lock refs, the action banners, and the snapshot count/panel handles stay owned by `EditorPage` and are threaded into both hooks as deps — so the load-bearing "single mutation instance shared by every caller" invariant (CLAUDE.md save-pipeline §) holds by construction, and the 16-rounds-of-review handler bodies moved verbatim. `EditorPage.tsx` dropped from 2373 to 1394 lines (979 extracted). **Session 2 (render decomposition, this entry — Option "all three seams" per developer):** the remaining ~456-line render was split into three purely presentational sub-components — `EditorHeader` (logo + inline project-title editing + `EditorToolbar` + `ViewModeNav` + export/reference/settings buttons), `EditorMainContent` (sidebar + lock/error/info banners + the trash|empty|preview|dashboard|editor|snapshot view-switch + footer + reference/snapshot/find-replace panels), and `EditorDialogs` (delete + replace confirmation dialogs, the three nav/word-count/image live regions, and the project-settings/shortcut-help/export dialogs). `EditorPage`'s `return` is now ~5 lines composing the three children; the file dropped 1394 → 1061 lines. The JSX moved **verbatim** (only free variables renamed to props); `tsc` validated every prop, and the three image closures (`onImageAnnouncement` / `onImageUploadCommitted` / `onInsertImage`) stay defined at the `EditorPage` call site so the timer ref, refresh-key setter, busy guard, and editor handle remain body-owned. **Why "Fixed" now:** the god render is gone and (Session 1) the orchestration/CRUD clusters are already in hooks, so the residual 1061 lines is the genuine page-coordination layer — hook composition, the load-bearing cross-cutting invariant helpers (`applyReloadFailedLock`, `switchToView`, the busy/lock-guarded sidebar handlers, `handleProjectSettingsUpdate`), state declarations, and keyboard-shortcut wiring — not a god render or bundled CRUD. **Trade-off (honest):** the extraction produces wide presentational prop interfaces (`EditorMainContent` ~50 props, `EditorHeader` ~22, `EditorDialogs` ~17). This is one-level prop-drilling into single-consumer, fully type-checked components — the expected and accepted cost of presentational decomposition (it introduces no shared mutable state, no new import cycle), not a substitute god object. **Safety net:** Session 1's `b7880d7` (export/settings/word-count wiring) plus this session's `28bddb8` extending it with reference-panel-open/`ImageGallery`-mount, logo→navigate-home, and nav-announcement-region characterization tests — committed before any extraction. Full suite green (2277 tests; the +3 are this session's safety-net additions), `tsc` + `lint:check --max-warnings 0` clean. **Related flaws:** F-7 (snapshot temporal coupling) was independently resolved into `quiesceEditorForServerOp` (`ccd9915`) and is unaffected by this move. F-17 (global mutable editor registry, lives in `Editor.tsx`, not `EditorPage.tsx`) remains open and out of scope here.
- **Status date:** 2026-05-29
- **Status commit:** 08f6cdcd474d6d320e5175063758f74963e27458

### [F-2] God object / low cohesion: `useProjectEditor.ts`

- **Category:** Flaw 2 (God object) / Flaw 11 (Low cohesion)
- **Impact:** High
- **Explanation:** One 1722-line hook bundles the retry/debounce save pipeline with chapter create/select/delete/reorder, project-title editing, status changes, and content-cache coordination, exposing a 38-key return object. The save pipeline is load-bearing and justifiably central, but the chapter-CRUD and title/status concerns are separable.
- **Evidence:** `packages/client/src/hooks/useProjectEditor.ts:57-1722`; handlers `handleSave` (386), `handleCreateChapter` (717), `handleSelectChapter` (980), `handleDeleteChapter` (1135), `handleReorderChapters` (1265), `handleUpdateProjectTitle` (1365), `handleStatusChange` (1442), `handleRenameChapter` (1609).
- **Found by:** Structure & Boundaries
- **Status:** Fixed
- **Status reason:** Decomposed along the two separable seams the explanation names. Extracted the chapter-CRUD handlers (`handleCreateChapter`/`handleSelectChapter`/`reloadActiveChapter`/`handleDeleteChapter`/`handleReorderChapters`) into a new `useChapterCrud` hook and the title/status handlers (`handleUpdateProjectTitle`/`handleStatusChange`/`handleRenameChapter`) into a new `useChapterMetadata` hook, each owning the ops + recovery refs used only by its handlers. `useProjectEditor` retains the load-bearing save pipeline + project/chapter state + the shared sync-on-render refs + the confirmed-status cache + `loadProject`, and now composes the two sub-hooks behind an unchanged public return object (pinned by a new return-shape contract test). The file dropped from 1722 to ~660 lines; `EditorPage.tsx` and all other consumers are untouched. All 1420 client tests + the full 2231-test suite stay green; the `useRef<AbortController>` structural allowlist was updated to track the migrated recovery refs. F-1 (`EditorPage.tsx`) and F-7 (temporal coupling, lives in `EditorPage.tsx`) were deliberately deferred to a future session.
- **Status date:** 2026-05-29
- **Status commit:** 247e7b6e96a3ec81caf15cbc0394fbe4db820b34

### [F-3] No server-side error taxonomy

- **Category:** Flaw 34 (Inconsistent error/logging conventions) / Flaw 20 (Weak error handling strategy)
- **Impact:** Medium
- **Explanation:** The client has an elegant single error-scope registry; the server has the opposite. There is no `AppError` base class — each route inlines its own `res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found." } })` (duplicated 7× in `projects.routes.ts` alone), and services signal failure through a grab-bag of mechanisms: thrown ad-hoc subclasses (`ParentPurgedError`, `ProjectTitleExistsError`, `ContentTooLargeError`), magic-string returns (`"read_after_create_failure"`, `"corrupt"`), `{ validationError }` objects, and `null`. The domain-failure → HTTP-code mapping lives in routes, not a taxonomy.
- **Evidence:** `packages/server/src/projects/projects.routes.ts:14-141`, `app.ts:63-94`; failure types in `chapters.service.ts:16,23`, `projects.service.ts:38,106`, `search.service.ts:128`.
- **Found by:** Error Handling & Observability
- **Status:** Fixed
- **Status reason:** Introduced `packages/server/src/errors/appError.ts` — an `AppError` base class plus `NotFoundError` / `BadRequestError` / `ConflictError` / `PayloadTooLargeError` / `InternalError` helpers that are the single owner of the domain-failure → (status, code, message) mapping. All nine route modules now `throw` a typed `AppError` instead of inlining `res.status().json({ error })` envelopes (the "Project not found." literal previously duplicated 7× in projects.routes alone is gone), and the global handler in `app.ts` renders the envelope from the thrown `AppError` (`{ code, message, ...extras }` — `extras` carries e.g. the IMAGE_IN_USE `chapters` list). `ProjectTitleExistsError` now extends `BadRequestError`, eliminating the route try/catch. Logging behavior is preserved exactly: `AppError`s are intentional/classified and render WITHOUT error-level logging (these paths emitted via in-route `res.json()` before and logged nothing); only genuinely-unhandled non-`AppError` errors are logged. Every status/code/message is byte-preserved — verified by the safety net (`error-taxonomy-contract.test.ts` + inline message assertions, committed `9e3041b`) and the full 632-test server suite; `appError.ts` is 100%/100%/100%/100% covered and overall coverage stays above thresholds (95.82/88.06/95.03/95.82). **Scope (route-side taxonomy, per the chosen Option):** services still signal failure via return values (`null` / magic-strings / `validationError` objects), which routes now translate uniformly into thrown `AppError`s. Normalizing the service _return-value_ signaling to throw `AppError` directly (changing service signatures + their unit tests) was deliberately deferred as a separate refactor — the core flaw (no taxonomy, duplicated envelopes, mapping-in-routes) is resolved. Consolidated F-18 (see its entry).
- **Status date:** 2026-05-29
- **Status commit:** 13028ae9b58fdb57accc116ee91796109487bbc7

### [F-4] ProjectStore: 54-method god interface across 7 domains

- **Category:** Flaw 2/9 (God object / Shotgun surgery) / Flaw 7 (Over-abstraction)
- **Impact:** Medium
- **Explanation:** One `ProjectStore` interface aggregates 54 methods spanning projects, chapters, statuses, settings, velocity, images, and snapshots, with exactly one production implementation (`SqliteProjectStore`, all thin one-line delegates) and no real mock. Two costs converge: every new data operation requires a synchronized three-file edit (repository + interface + delegating class), and the swappable-backend payoff that would justify the abstraction is speculative.
- **Evidence:** `packages/server/src/stores/project-store.types.ts:24` (interface), `stores/sqlite-project-store.ts:33` (impl). _(Flagged independently by two specialists — god-object and over-abstraction facets.)_
- **Found by:** Structure & Boundaries, Coupling & Dependencies
- **Status:** Fixed
- **Status reason:** Split the single 54-method `ProjectStore` interface into seven cohesive per-domain sub-interfaces in `project-store.types.ts` — `ProjectsStore`, `ChaptersStore`, `ChapterStatusesStore`, `SettingsStore`, `VelocityStore`, `ImagesStore`, `SnapshotsStore` — with `ProjectStore` now `extends`-ing all seven and adding only the cross-domain `transaction()` seam (the tx callback still receives the full composite, since a transaction routinely spans domains). This is a **type-level reorganization with zero runtime or implementation change**: the sole impl `SqliteProjectStore` still satisfies the composite `ProjectStore`, and all 17 consumers import the unchanged composite type — so no consumer edits were needed (verified by `tsc`, which would fail if the impl dropped any method or a consumer referenced a now-missing one). Each domain's data surface is now readable in isolation, and the sub-interfaces are exported so future code can type against a narrower slice. **Scope honesty (chosen Option: split by domain now, per developer):** this resolves the **god-object / low-cohesion facet** — the 54-method aggregate is now seven named domain contracts. It does **not** eliminate the other two facets the finding bundles: the **shotgun-surgery** cost (a new data op still edits repository + the relevant interface slice + impl — three files, though now the slice edit is localized to one domain) and the **over-abstraction** cost (still one production implementation, no second backend). Fully removing those would require either collapsing the interface/impl indirection or introducing a real second backend — a larger, separate decision (the report's Next-Question 1). **Safety net (committed first, `87a676d`):** the `sqlite-project-store.test.ts` method-surface guard pins all 54 methods grouped by the seven split domains, so migrating methods into slices cannot silently drop one; full server suite + `tsc` + `lint:check` (`--max-warnings 0`) clean.
- **Status date:** 2026-05-29
- **Status commit:** 91d9d5c65a1245c0c5e417202849e102be1a1473

### [F-5] Configuration sprawl: data-directory default duplicated, DATA_DIR↔DB_PATH unvalidated

- **Category:** Flaw 22 (Configuration sprawl)
- **Impact:** Medium
- **Explanation:** Unlike the well-centralized numeric limits, the filesystem-config defaults are copy-pasted: `getDataDir()` and `purgeOldTrash` each independently default `process.env.DATA_DIR ?? path.join(__dirname, "../../data")`, while `knexfile.ts` derives a separate `DB_PATH` fallback to a _different_ subpath. No module owns "where Smudge stores data," and the relationship between the image `DATA_DIR` and the SQLite `DB_PATH` is implicit — they can point at unrelated locations with no validation.
- **Evidence:** `packages/server/src/images/images.paths.ts:56`, `db/purge.ts:15`, `db/knexfile.ts:11`.
- **Found by:** Error Handling & Observability
- **Status:** Fixed
- **Status reason:** Introduced `packages/server/src/config/paths.ts` as the single owner of "where Smudge persists data": `getDataDir()` (the previously-triplicated `DATA_DIR ?? ../../data` default) and a new `getDbPath()` that defaults the SQLite file to `smudge.db` _inside_ `getDataDir()`. `images.paths.ts` now re-exports `getDataDir` from the owner (stable import surface), `db/purge.ts` calls `getDataDir()`, and `db/knexfile.ts` calls `getDbPath()`. This removes the duplicated default and, crucially, relates `DATA_DIR` and `DB_PATH`: with `DATA_DIR` set and `DB_PATH` unset, the database now follows the data dir instead of falling back to an unrelated hard-coded path (previously they defaulted independently and could silently diverge). An explicit `DB_PATH` still wins for operators who place the DB elsewhere on purpose. Safety net committed first (`9e3041b`): `data-paths.test.ts` pins the default-DB-under-data-dir relationship and the `DB_PATH` override; a red test for the new `DATA_DIR`→DB linkage drove the change. Full server suite green (632 tests); typecheck + lint clean.
- **Status date:** 2026-05-29
- **Status commit:** 394add58344b31abc4e42b6749cdab27e7430c11

### [F-6] Circular dependency: `app.ts` ↔ every `*.routes.ts`

- **Category:** Flaw 5 (Circular dependencies)
- **Impact:** Medium
- **Explanation:** `asyncHandler` — a generic Express helper with zero dependency on app composition — is exported from the composition root `app.ts` and imported back by all nine route modules, while `app.ts` imports all nine routers. This is a genuine runtime cycle that resolves only because routers are invoked lazily inside `createApp()`.
- **Evidence:** `packages/server/src/app.ts:15` (`export function asyncHandler`); `chapters/chapters.routes.ts:2` (`import { asyncHandler } from "../app"`), same across all routers.
- **Found by:** Coupling & Dependencies
- **Status:** Fixed
- **Status reason:** Extracted `asyncHandler` from the composition root into its own leaf module `packages/server/src/asyncHandler.ts`. All nine routers now `import { asyncHandler } from "../asyncHandler"`, and `app.ts` no longer defines or references it (its `Request/Response/NextFunction` type import, used only by `asyncHandler`, was also removed). The dependency graph `app.ts → *.routes.ts → asyncHandler.ts` is now acyclic — the helper imports only Express types. Safety net committed first (`9e3041b`): `asyncHandler.test.ts`, the first direct unit test of the helper (resolved handler does not call `next`; rejected handler forwards the error to `next` exactly once), with its import retargeted to the new module as part of this fix. Full server suite green (632 tests); typecheck (which would surface any residual cycle or unused import) + lint clean.
- **Status date:** 2026-05-29
- **Status commit:** 54c6bf1df8d10cc3063bfec6d5c0dfad66e74768

### [F-7] Temporal coupling: snapshot handlers hand-compose the save-pipeline ordering

- **Category:** Flaw 27 (Temporal coupling)
- **Impact:** Medium
- **Explanation:** The snapshot `onView` / `onBeforeCreate` handlers manually sequence `setEditable(false)` → `flushSave()` → `cancelPendingSaves()` → `markClean()` → re-enable, replicating the invariant ordering that `useEditorMutation` enforces by construction. CLAUDE.md sanctions these as outside the hook's scope (they don't overwrite editor content), but the ordering is load-bearing and duplicated, so a future edit can silently desync it.
- **Evidence:** `packages/client/src/pages/EditorPage.tsx:2095-2231`.
- **Found by:** Coupling & Dependencies
- **Status:** Fixed
- **Status reason:** Extracted the load-bearing quiesce ordering into one shared helper, `quiesceEditorForServerOp` in `packages/client/src/utils/editorSafeOps.ts` (alongside `safeSetEditable`), so the two handlers no longer hand-compose it. The helper encodes the sequence once — `[disable] → flushSave → (flush failed? [re-enable] and bail) → cancelPendingSaves → [markClean]` — parameterized by `{ disableEditor, markCleanAfter }`. `onSnapshotView` calls it with `disableEditor:true` (read-only across the round trip, re-enable on flush failure; no markClean — the Editor unmounts into view); `onSnapshotBeforeCreate` calls it with `markCleanAfter:true` (no disable — create captures live content). All `setEditable` calls route through `safeSetEditable`, preserving the TipTap mid-remount throw absorption the inline code had. CLAUDE.md still correctly sanctions these as outside `useEditorMutation`'s scope (they don't overwrite editor content), so the ordering lives in a dedicated helper rather than being routed through the mutation hook. **Evidence note:** the flaw cited `EditorPage.tsx:2095-2231`, but the F-1 partial fix (`f5787586`) had already relocated these handlers verbatim into `useSnapshotController.ts` — that relocation co-located the duplication without resolving it (F-1's status entry says exactly this); this fix resolves it. **Safety net:** red/green unit tests for `quiesceEditorForServerOp` (6 cases pinning the ordering, the re-enable-on-failure path, and the null-ref `?? true` behavior) added to `editorSafeOps.test.ts`; the existing `EditorPageFeatures` onView/onBeforeCreate behavioral tests (87) stay green, confirming byte-equivalent behavior. Typecheck + `lint:check` (`--max-warnings 0`) clean.
- **Status date:** 2026-05-29
- **Status commit:** ccd9915408972d640011cc053bcc052562eff2ce

### [F-8] Hidden side effects in `chapters.service` mutations

- **Category:** Flaw 12 (Hidden side effects)
- **Impact:** Medium
- **Explanation:** `updateChapter` reads like a row update but also bumps the parent project's `updated_at`, diffs image reference counts, and fires `velocityService.recordSave` (writing a `daily_snapshots` row); `deleteChapter` and `restoreChapter` similarly fire `updateDailySnapshot`. The behaviors are intentional and the velocity calls are best-effort, but nothing in the signatures discloses them — a discoverability/naming flaw, not a correctness one.
- **Evidence:** `packages/server/src/chapters/chapters.service.ts:86-124,143-174,258-265`.
- **Found by:** Error Handling & Observability
- **Status:** Fixed
- **Status reason:** Doc-only disclosure (the chosen Option, matching the report's own framing of F-8 as "a discoverability/naming flaw, not a correctness one"). Added JSDoc to `updateChapter`, `deleteChapter`, and `restoreChapter` that names each undisclosed side effect at the signature: the parent project's `updated_at` bump (in-transaction), the image reference-count diff via `applyImageRefDiff` (in-transaction), and the best-effort post-commit velocity call (`recordSave` / `updateDailySnapshot`, whose throws are logged-and-swallowed). `restoreChapter`'s JSDoc additionally discloses the parent-project restore-and-reslug effect. No behavior change — the intentional side effects are unchanged and remain pinned by tests. **Safety net (committed first, `87a676d`):** a new `chapters.service.test.ts` case pins that `updateChapter` bumps the parent project's `updated_at` (the one side effect not previously asserted); the velocity best-effort effects and refcount diffs were already covered. Full server suite + `npm run typecheck` clean.
- **Status date:** 2026-05-29
- **Status commit:** 544021091a41d439836910529d21680bcb933c82

### [F-9] Client console logging is not production-gated or convention-consistent

- **Category:** Flaw 21 (No observability plan / log noise) / Flaw 34 (Inconsistent conventions)
- **Impact:** Low
- **Explanation:** A `devWarn(context, signal, err)` helper exists (DEV-gated, abort-aware) and is the intended canonical client log path, yet ~50 bare `console.warn`/`console.error` sites remain (43 warn / 7 error). None are wrapped in `import.meta.env.DEV`, so they log raw error objects to the production browser console on every failure; the `.warn`-vs-`.error` choice is inconsistent across analogous siblings, and abort-gating is hand-rolled unevenly. _(Two originally-separate findings — "not DEV-gated" and "inconsistent/ad-hoc" — merged here as facets of the same call-site cluster.)_
- **Evidence:** `packages/client/src/errors/devWarn.ts` (gated) vs `hooks/useProjectEditor.ts:374-379,824`, `hooks/useTrashManager.ts:127,228`, `components/DashboardView.tsx:59,77`.
- **Found by:** Error Handling & Observability
- **Status:** Fixed
- **Status reason:** Introduced DEV-gated client logging helpers `clientWarn` / `clientError` in `packages/client/src/errors/clientLog.ts` (exported from the `errors/` barrel), each gating on `import.meta.env?.DEV` so raw error objects never reach the **production** browser console while remaining visible in dev. They forward their arguments **verbatim**, making the migration a drop-in (same message, same level) — all ~40 bare `console.warn`/`console.error` call sites across 13 client modules (`utils/editorSafeOps.ts`, `components/{ProjectSettingsDialog,DashboardView}.tsx`, `hooks/{useSnapshotController,useChapterCrud,useEditorMutation,useChapterMetadata,useTrashManager,useProjectEditor,useContentCache}.ts`, `pages/{EditorPage,HomePage}.tsx`, `errors/apiErrorMapper.ts`) now route through them. The abort-aware `devWarn` (which additionally suppresses on a fired `AbortSignal`) is unchanged and remains the canonical path for superseded-async logging. **Durable enforcement:** a new `no-console` ESLint rule scoped to `packages/client/src/**` now fails the build on any direct `console.*`, with `clientLog.ts` / `devWarn.ts` (the gated implementations) and test files exempted — converting the previously review-only convention into a mechanical guard (mirrors the string-externalization rule). **Scope honesty:** the fix resolves the *not-DEV-gated* facet (the load-bearing one — production log noise) and the *bypass-the-canonical-path* facet (now lint-enforced). It deliberately does **not** re-adjudicate each site's `.warn`-vs-`.error` level or convert manually-abort-gated sites to `devWarn` — those are subjective per-site judgments whose churn (and test-spy churn) outweighs the value, and each site's existing level/guard is preserved. **Safety net:** new `clientLog.test.ts` (4 cases) pins the verbatim-forward behavior in dev **and** the production-silence branch (the gate that is the whole point); the ~existing consumer tests that spy on `console.warn`/`console.error` stay green because vitest runs with `import.meta.env.DEV === true`, so the gated calls still fire under test. Full client suite green (1436 tests, +4); typecheck + `lint:check` (`--max-warnings 0`, now including the new rule) clean.
- **Status date:** 2026-05-29
- **Status commit:** a9de51d941da1a932848a73fd7581f19e1bc5ed5

### [F-10] No server request correlation / access observability

- **Category:** Flaw 21 (No observability plan)
- **Impact:** Low
- **Explanation:** There is no request-id middleware, no access logging, and no metrics; when the global error handler logs "Unhandled request error" there is no way to correlate it to the request (method, path, id) or to other log lines from the same request. Low severity for a single-user app, but a genuine gap — the only request-path observability is the terminal error log. _(Distinct from F-9: server-side vs client-side.)_
- **Evidence:** `packages/server/src/app.ts` (routers mounted directly to `globalErrorHandler`, no logging middleware between); `logger.ts`.
- **Found by:** Error Handling & Observability

### [F-11] Leaky abstraction: `search.routes` reaches past its service into the store

- **Category:** Flaw 6 (Leaky abstraction)
- **Impact:** Low
- **Explanation:** Every other route obeys Routes→Service→Store, but `search.routes.ts` calls `getProjectStore().findProjectBySlug(slug)` directly because `SearchService.searchProject/replaceInProject` accept only a `projectId`. The route now owns a piece of data-access logic the service should encapsulate.
- **Evidence:** `packages/server/src/search/search.routes.ts:83,128`; `search.service.ts:135`.
- **Found by:** Coupling & Dependencies
- **Status:** Fixed
- **Status reason:** Added slug-addressed entry points `searchProjectBySlug(slug, ...)` / `replaceInProjectBySlug(slug, ...)` to `SearchService` that own the slug→project resolution and delegate to the existing `searchProject(projectId, ...)` / `replaceInProject(projectId, ...)` — mirroring the established `velocity.service.getVelocityBySlug` / `export.service` convention (search was the lone deviation that forced the route to resolve the slug itself). `search.routes` now calls the BySlug wrappers and no longer imports `getProjectStore`, so Routes→Service→Store holds with no route-owned data access. **Approach (chosen Option, per developer):** BySlug wrappers rather than changing the `searchProject`/`replaceInProject` signatures — keeps the ~30 heavily-tested projectId-based service unit tests untouched; only the 2 mock-based route tests retarget their spies to the wrappers. New unit tests cover the wrappers (slug→null when unresolved, slug→delegates/replaces). All 49 search tests pass; `npm run typecheck` and ESLint clean.
- **Status date:** 2026-05-29
- **Status commit:** c9045815712bc09196a258183d91b9c67501fa23

### [F-12] Leaf renderers pull the global store singleton directly

- **Category:** Flaw 4 (High/unstable dependencies) / Flaw 23 (DI misuse)
- **Impact:** Low
- **Explanation:** Presentation-layer export renderers reach into `getProjectStore()` (a module-global with throw-on-unset) rather than receiving data via parameters, coupling export formatting to global initialization order and obscuring their data dependencies at the call boundary.
- **Evidence:** `packages/server/src/export/image-resolver.ts:19,144`, `export/epub.renderer.ts:85`. _(Correction: commit `71dc085` is a deferral/perf fix, not a prior init-order incident.)_
- **Found by:** Coupling & Dependencies
- **Status:** Fixed
- **Status reason:** Introduced a narrow `ImageSource` interface (`{ findImageById(id) }`) in `image-resolver.ts` and threaded it as an explicit parameter through every leaf renderer — `resolveImage` / `resolveImagesInHtml` / `resolveImagesForEpub`, and `renderHtml` / `renderMarkdown` / `renderPlainText` / `renderDocx` (via `DocxBuildState.imageSource`) / `renderEpub` (including the cover-image lookup). The three leaf modules (`image-resolver.ts`, `epub.renderer.ts`) no longer import `getProjectStore`; the **service** (`export.service.ts`) is now the single owner of the store dependency and injects it (the store satisfies `ImageSource` structurally) — so the renderers declare their data dependency at the boundary and are decoupled from global-singleton init order. **Behavior is byte-preserved** — a pure dependency-injection refactor with no logic change. **Safety net:** the existing 97 export tests (`export.images.test.ts` directly exercises `resolveImage`/`resolveImagesInHtml` + every renderer with real images via a `SqliteProjectStore`; `export.renderers.test.ts` covers TOC/headings/lists with a no-op source) are the guard — they were updated to pass the injected source and all 97 stay green. Typecheck (which would fail if any caller dropped the now-required param) + ESLint (`--max-warnings 0`) clean. **Scope note:** `export.service.ts` legitimately calls `getProjectStore()` — it is the service layer, not a leaf renderer; F-12 targeted only the presentation-layer leaves.
- **Status date:** 2026-05-29
- **Status commit:** e9741ecd53cd97a457eaf26a9fa2bd0ac63716ea

### [F-13] Inconsistent boundary: `images.service` does raw filesystem I/O

- **Category:** Flaw 13 (Inconsistent boundaries)
- **Impact:** Low
- **Explanation:** Every other domain reaches persistence solely through the `ProjectStore` abstraction, but `images.service` directly calls `mkdir`/`writeFile`/`readFile`/`unlink`. This is a defensible asymmetry (binary blobs vs rows; the `AssetStore` seam was added then removed as unused), but it means image persistence is the one service whose I/O has no injectable/mockable seam.
- **Evidence:** `packages/server/src/images/images.service.ts:1,80-81,124,209`.
- **Found by:** Structure & Boundaries

### [F-14] Filesystem ops on images live outside the DB transaction

- **Category:** Flaw 26 (Poor transactional boundaries)
- **Impact:** Low
- **Explanation:** Image upload writes the file before `insertImage` (unlinking on insert failure), and delete unlinks _after_ the transaction commits. These FS ops cannot join the SQLite transaction, so the code accepts the safer "orphan file (harmless)" outcome over a "ghost DB record" one — but a crash between commit and unlink leaves an orphan file, and unlike soft-deleted rows there is no startup reaper for image files. Documented and by design.
- **Evidence:** `packages/server/src/images/images.service.ts:80,205`.
- **Found by:** Integration & Data

### [F-15] Auto-snapshot inserts on restore/replace are non-idempotent

- **Category:** Flaw 19 (Lack of idempotency)
- **Impact:** Low
- **Explanation:** `restoreSnapshot` and `replaceInProject` both insert an `is_auto` snapshot with no content-hash dedup (the manual-snapshot path _is_ deduped). A retried restore/replace request that reaches the server creates another "Before restore…" / "Before find-and-replace…" snapshot even when content is identical — this pollutes snapshot history rather than corrupting data, since the operation is transactional.
- **Evidence:** `packages/server/src/snapshots/snapshots.service.ts:184`, `search/search.service.ts:297`.
- **Found by:** Integration & Data
- **Status:** Fixed
- **Status reason:** Applied the manual-snapshot content-hash dedup to both `is_auto` insert sites (answering the report's open question Q4 — "should the retry path dedup them as the manual path does?" → yes). Before inserting the pre-restore / pre-replace auto-snapshot, compute `canonicalContentHash(contentToSnapshot)` and compare to `txStore.getLatestSnapshotContentHash(chapterId)` inside the existing transaction; when equal, skip the insert. This is the same guard `createSnapshot` uses for manual snapshots (`snapshots.service.ts:36-39`), now shared by restore (`snapshots.service.ts`) and project-wide replace (per affected chapter in `search.service.ts`). The restore/replace mutation itself always proceeds — only the redundant snapshot insert is skipped — so a retried request whose pre-operation content is byte-identical to the latest snapshot no longer pollutes history. **Scope note:** dedup is against the *latest* snapshot, matching the manual path's contract; it removes the identical-content noise the flaw describes, not every conceivable retry shape. The `createSnapshot(isAuto=true)` path (a separate code path with its own intentional `no dedup for auto` test) is untouched. Red tests drove both sites (committed in this fix); existing auto-snapshot-creation tests (content differs → snapshot still created) confirm no regression. All 96 snapshot+search tests pass; `npm run typecheck` and ESLint clean.
- **Correction (review I1, commit `fa776ca`):** The original fix above was mis-described. It reused `getLatestSnapshotContentHash`, which delegates to `snapshotsRepo.getLatestContentHash` — a query that filters `is_auto: false`, i.e. it only ever inspects the latest **manual** snapshot. On the auto-snapshot insert path that filter neuters the dedup: a pre-operation auto-snapshot was never deduped against a *prior auto-snapshot* left by an earlier restore/replace, so the comments' and this entry's "deduped exactly as the manual-snapshot path … a retried request no longer pollutes history" claim overstated the behavior (the guard only fired when pre-operation content matched a pre-existing *manual* snapshot). Resolved by adding `getLatestContentHashAnyKind` (same query, no `is_auto` filter, same `created_at DESC, id DESC` tie-break) and routing both auto-snapshot sites through it via `getLatestSnapshotContentHashAnyKind`; `createSnapshot`'s manual path keeps the manual-only filter so an auto-snapshot can never block a user's explicit manual marker. The auto path now dedups against the latest snapshot of **any** kind, removing the identical-content history noise the flaw describes — including a re-restore/re-replace whose pre-operation content already matches the most recent snapshot. **Scope honesty:** this dedups against the *latest* snapshot, not all history, so it does not catch every conceivable retry shape (e.g. a committed-then-retried restore whose transaction atomicity leaves the retry's pre-content differing from the prior auto-snapshot); it removes the identical-content noise, no more. Red tests added at both service sites (`snapshots.service.test.ts`, `search.service.test.ts`) and the repository (`snapshots.repository.test.ts`), each failing under the manual-only lookup and passing under the any-kind one.
- **Status date:** 2026-05-29
- **Status commit:** 7400471d130d234eab03bb1563b762b8473c92d5 (superseded by `fa776ca`)

### [F-16] Inconsistent response shapes across sibling endpoints

- **Category:** Flaw 24 (Inconsistent API contracts)
- **Impact:** Low
- **Explanation:** Two facets: (a) within the snapshot router, create returns a `{ status, snapshot }` envelope while restore returns a bare chapter object; (b) the four DELETE endpoints use three different success contracts — chapter/project return `{ message }`, image returns `{ deleted: true }`, snapshot returns `204` empty. None is wrong, but a generic client helper must special-case each.
- **Evidence:** `packages/server/src/snapshots/snapshots.routes.ts:56,62,119,164`; `chapters.routes.ts:82`; `projects.routes.ts:183`; `images.routes.ts:185`.
- **Found by:** Integration & Data
- **Status:** Fixed
- **Status reason:** **Facet (b) — DELETE success contracts — standardized on `204` No Content (developer choice: Option B "204 no-body for all DELETEs", 2026-05-29).** Chapter delete (`{ message: "Chapter moved to trash." }`), project delete (`{ message: "Project moved to trash." }`), and image delete (`{ deleted: true }`) all now `res.status(204).send()`, matching snapshot delete (already 204). A generic client helper can now treat every DELETE uniformly. The user-facing success toast is the **client's** responsibility (sourced from `strings.ts`) — consistent with the string-externalization invariant that the server should not supply UI copy; verified no consumer read the old bodies (`ImageGallery` already announces via `S.deleteSuccess`; `HomePage`/`useChapterCrud` only update local state). Client api methods `projects.delete`/`chapters.delete`/`images.delete` retyped to `apiFetch<undefined>` (apiFetch already short-circuits 204 → `undefined` at `client.ts:199`), so the 2xx-`BAD_JSON` `possiblyCommitted` path can no longer fire for a successful delete (no body to corrupt) — a small resilience improvement. The blocked-image-delete **409** (`IMAGE_IN_USE`) is unchanged (it is a conflict, not a success). **CLAUDE.md updated**: the §API Design 204 bullet now documents 204 as the uniform DELETE contract (superseding the F-18 snapshot-only note and the `{ deleted: true }` image-delete note). **Facet (a) — snapshot create envelope (`{ status, snapshot }`) vs restore bare chapter — deliberately left as-is:** the create envelope carries a `status` discriminator (`"created"` vs `"duplicate"`) that the client must branch on (two distinct success outcomes), whereas restore has a single success outcome (the chapter); the shapes differ because the *semantics* differ, so this is justified rather than a flaw. **Red→green:** the four route-level delete-shape tests (`chapters.test.ts`, `projects.test.ts`, `images.routes.test.ts`, `images.references.test.ts`) were flipped to assert `204` + empty body and confirmed red against the old routes, then green after the route change; the api-client unit tests now assert `204 → undefined` via a new `noContentResponse()` helper; consumer-test delete mocks updated to resolve `undefined`. All 494 affected server+client tests pass; typecheck (which catches any consumer that still reads `.message`/`.deleted`) + ESLint (`--max-warnings 0`) clean. The service-layer `deleteImage()` return shape (`{ deleted: true }`) is an internal contract and is unchanged — only the HTTP response shape moved.
- **Status date:** 2026-05-29
- **Status commit:** 25272fdb5be1c02f0cbe0f69accef1086ba0bb11

### [F-17] Global mutable editor registry at module scope

- **Category:** Flaw 1 (Global mutable state)
- **Impact:** Low
- **Explanation:** Because ProseMirror plugins are created once at module scope, paste/drop image handling routes through module-level mutable state: a monotonic `nextEditorId`, a `Map` of upload handlers, and a single `activeEditorId`. With the single current `<Editor>` mount this is harmless, but it is genuine shared mutable global state and a latent hazard if two editors are ever mounted simultaneously (the design comments anticipate this, but no path triggers it today).
- **Evidence:** `packages/client/src/components/Editor.tsx:63-68,85` (sole mount at `pages/EditorPage.tsx:1986`).
- **Found by:** Structure & Boundaries

### [F-18] Doc drift: HTTP status allowlist omits 204

- **Category:** Flaw 34 (Inconsistent conventions) — documentation
- **Impact:** Low
- **Explanation:** CLAUDE.md's §API status allowlist is 200/201/400/404/409/413/500, but snapshot delete and image delete return **204**. Either the allowlist should add 204 or the delete endpoints should return 200 — a real (if minor) doc-vs-code contradiction.
- **Evidence:** `packages/server/src/snapshots/snapshots.routes.ts:119`; CLAUDE.md §API Design.
- **Found by:** Error Handling & Observability
- **Status:** Fixed
- **Status reason:** Added **204** to CLAUDE.md's §API Design status allowlist (`200, 201, 204, 400, 404, 409, 413, 500`), with a bullet documenting that 204 No Content is the success contract for snapshot delete (`DELETE /api/snapshots/{id}`). The same edit documents the new `AppError` taxonomy and clarifies that the _error_-status subset (what `AppError` emits) is 400/404/409/413/500 — 204 is a success status, so it is not added to the save-pipeline invariant #5 error-code list. **Correction:** this entry's explanation says "snapshot delete and image delete return 204," but only snapshot delete returns 204 — image delete returns **200** with `{ deleted: true }` (consistent with F-16); the evidence (`snapshots.routes.ts:119` only) was correct and the CLAUDE.md note reflects the actual code. Folded into the F-3 commit as a directly-related doc-drift rider.
- **Status date:** 2026-05-29
- **Status commit:** 13028ae9b58fdb57accc116ee91796109487bbc7

### [F-19] Doc drift: steering files claim static-frontend serving that does not exist

- **Category:** Flaw 30 (Security as afterthought — forward-looking) / documentation
- **Impact:** Low
- **Explanation:** CLAUDE.md and CONTRIBUTING describe Express serving the static frontend on port 3456, but `createApp()` mounts only `/api/*` routes + a health check — no `express.static`, no SPA catch-all, and no `Dockerfile` exists in the repo. Consistent with "MVP in progress," so not a live vuln, but flagged because (a) it contradicts steering docs and (b) when static serving is added it will be a new path-traversal/unsafe-serving surface that currently has no guardrails or tests.
- **Evidence:** `packages/server/src/app.ts:23-61`; no `Dockerfile` at repo root.
- **Found by:** Security & Code Quality
- **Status:** Fixed
- **Status reason:** Doc-only. Reworded CLAUDE.md's Tech Stack > Deployment bullet from a present-fact claim ("Express serves API + static frontend on port 3456 … via Docker volume") to a **target — not yet implemented** statement: documents that `createApp()` today mounts `/api/*` (+ `/api/health`) only with no `express.static`/SPA catch-all and no `Dockerfile`, and carries forward this finding's security forward-look (when static serving lands it must ship with path-traversal/unsafe-serving guardrails + tests). No code change — implementing static serving is a separate feature (out of scope for a fix session, and would need the guardrails this note now mandates). **Correction:** the explanation says "CLAUDE.md and CONTRIBUTING describe Express serving the static frontend," but CONTRIBUTING's line ("Express serves the API; Vite proxies the client in dev") is accurate and was left unchanged; only the CLAUDE.md bullet was drift. The Build & Run > "# Build & Deploy" `docker compose up` line sits under a header already labeled "(Target)", so it was already qualified and needs no edit.
- **Status date:** 2026-05-29
- **Status commit:** 7bbdc045ccb4a5ec678a6a856d453a9decf23519

### [F-20] Circular dependency: `export.renderers.ts` ↔ `image-resolver.ts`

- **Category:** Flaw 5 (Circular dependencies)
- **Impact:** Low
- **Explanation:** `export.renderers.ts` imports `resolveImagesInHtml` from `image-resolver.ts`, while `image-resolver.ts` imports `escapeHtml` (a pure string utility that does not conceptually belong to the renderer module) back — a true bidirectional runtime cycle.
- **Evidence:** `packages/server/src/export/export.renderers.ts:4`, `export/image-resolver.ts:5`.
- **Found by:** Coupling & Dependencies
- **Status:** Fixed
- **Status reason:** Extracted `escapeHtml` — the pure HTML-entity string utility that did not conceptually belong to the renderer module — into a new leaf module `packages/server/src/export/html-escape.ts`. All three consumers (`export.renderers.ts`, `epub.renderer.ts`, `image-resolver.ts`) now import `escapeHtml` from the leaf; `image-resolver` no longer imports anything from `export.renderers`, so the back-edge is gone and the graph `export.renderers → image-resolver → html-escape` is acyclic (the leaf imports nothing). Behavior is byte-preserved: the F-20 safety-net direct unit test (committed `b144b4c`, retargeted here to the new module) pins all five entity replacements and the ampersand-first ordering, and the transitive consumers (renderHtml titles/headings/TOC, resolveImagesInHtml figcaptions) stay green. All 97 export tests pass; `npm run typecheck` and ESLint clean.
- **Status date:** 2026-05-29
- **Status commit:** 60da59e588f297c2036472e3cc769c1e3e01d33c

### [F-21] Dead code: unused `getImage` service export

- **Category:** Flaw 31 (Dead code / unused dependencies)
- **Impact:** Low
- **Explanation:** `imagesService.getImage(id)` is referenced only by its own test — no route or module imports it. The serve path uses `serveImage`; resolvers use the store's `findImageById` directly. The function and the tests exercising it are dead surface (remove it, or a caller is missing).
- **Evidence:** `packages/server/src/images/images.service.ts:109-112`.
- **Found by:** Security & Code Quality
- **Status:** Fixed
- **Status reason:** Deleted the unused `imagesService.getImage(id)` export — a one-line passthrough to `store.findImageById(id)` with no production caller (the serve path uses `serveImage`, resolvers use `findImageById` directly). Removed the dedicated `describe("getImage()")` test block, and switched the three incidental state-verification reads in the delete/reference tests (`images.service.test.ts:289,385,461`) from `imagesService.getImage(imageId)` to direct `t.db("images").where({ id }).first()` reads — the test-layer DB-access pattern already used across the suite. No new dead surface; the rest of the images.service suite (serve, delete, references) is unchanged and continues to prove those paths work without `getImage`. Server suite green; `npm run typecheck` clean.
- **Status date:** 2026-05-29
- **Status commit:** 0df7b427cc2f9cb05c5da7a253cfd9e0a82b2fbb

## Coverage Checklist

### Flaw/Risk Types 1–34

| #   | Type                                     | Status                     | Finding                       |
| --- | ---------------------------------------- | -------------------------- | ----------------------------- |
| 1   | Global mutable state                     | Observed                   | F-17                          |
| 2   | God object                               | Observed                   | F-1, F-2, F-4                 |
| 3   | Tight coupling                           | Not observed               | —                             |
| 4   | High/unstable dependencies               | Observed                   | F-12                          |
| 5   | Circular dependencies                    | Observed                   | F-6, F-20                     |
| 6   | Leaky abstractions                       | Observed                   | F-11                          |
| 7   | Over-abstraction                         | Observed                   | F-4                           |
| 8   | Premature optimization                   | Not observed               | —                             |
| 9   | Shotgun surgery                          | Observed                   | F-4                           |
| 10  | Feature envy / anemic domain model       | Not observed               | —                             |
| 11  | Low cohesion                             | Observed                   | F-2                           |
| 12  | Hidden side effects                      | Observed                   | F-8                           |
| 13  | Inconsistent boundaries                  | Observed                   | F-13                          |
| 14  | Distributed monolith                     | Not applicable             | single process                |
| 15  | Chatty service calls                     | Not applicable             | in-process only               |
| 16  | Synchronous-only integration             | Not applicable             | intentional sync SQLite       |
| 17  | No clear ownership of data               | Not observed               | — (S-9: single-owner columns) |
| 18  | Shared database across services          | Not applicable             | one DB, one process           |
| 19  | Lack of idempotency                      | Observed                   | F-15                          |
| 20  | Weak error handling strategy             | Observed                   | F-3                           |
| 21  | No observability plan                    | Observed                   | F-9, F-10                     |
| 22  | Configuration sprawl                     | Observed                   | F-5                           |
| 23  | Dependency injection misuse              | Observed                   | F-12                          |
| 24  | Inconsistent API contracts               | Observed                   | F-16                          |
| 25  | Business logic in the UI                 | Not observed               | — (S-13)                      |
| 26  | Poor transactional boundaries            | Observed                   | F-14                          |
| 27  | Temporal coupling                        | Observed                   | F-7                           |
| 28  | Magic numbers/strings everywhere         | Not observed               | — (S-13)                      |
| 29  | "Utility" dumping ground                 | Not observed               | — (S-2)                       |
| 30  | Security as an afterthought              | Observed (forward-looking) | F-19                          |
| 31  | Dead code / unused dependencies          | Observed                   | F-21                          |
| 32  | Missing test coverage for critical paths | Not observed               | — (S-12)                      |
| 33  | Hard-coded credentials/secrets           | Not observed               | —                             |
| 34  | Inconsistent error/logging conventions   | Observed                   | F-3, F-9, F-18                |

### Strength Categories S1–S14

| #   | Category                       | Status       | Finding                                    |
| --- | ------------------------------ | ------------ | ------------------------------------------ |
| S1  | Clear modular boundaries       | Observed     | S-1                                        |
| S2  | High cohesion                  | Observed     | S-2                                        |
| S3  | Loose coupling                 | Observed     | S-6, S-10                                  |
| S4  | Dependency direction is stable | Observed     | S-11                                       |
| S5  | Dependency management hygiene  | Observed     | S-11                                       |
| S6  | Consistent API contracts       | Observed     | S-9                                        |
| S7  | Robust error handling          | Observed     | S-4                                        |
| S8  | Observability present          | Observed     | S-5                                        |
| S9  | Configuration discipline       | Observed     | S-13                                       |
| S10 | Security built-in              | Observed     | S-7, S-8                                   |
| S11 | Testability & coverage         | Observed     | S-12                                       |
| S12 | Resilience patterns            | Observed     | S-2, S-3, S-8                              |
| S13 | Domain modeling strength       | Not observed | — (row-oriented by design; not a weakness) |
| S14 | Simple, pragmatic abstractions | Observed     | S-6, S-10                                  |

## Hotspots

Top 3 files/directories to review:

1. **`packages/client/src/pages/EditorPage.tsx` + `hooks/useProjectEditor.ts`** — the two oversized client modules (2373 + 1722 lines) that concentrate nearly all application coordination and the save pipeline. Highest-leverage decomposition target; also where F-7 (hand-composed temporal coupling) lives. Review together — they are tightly intertwined.
2. **`packages/server/src/` error signaling (routes + services)** — the strongest _structural_ gap: a disciplined client error layer with no server counterpart (F-3). A central hotspot of duplicated envelopes and mixed failure-signaling mechanisms; an `AppError` taxonomy would consolidate F-3 and the F-18 status drift.
3. **`packages/server/src/stores/` (`ProjectStore` + `SqliteProjectStore`)** — the 54-method god interface (F-4). A strong core seam (S-1, S-10) but the single biggest maintenance-friction surface: every new operation costs a three-file synchronized edit.

## Next Questions

1. Is the `ProjectStore` abstraction (F-4) intended to enable a future non-SQLite backend (e.g. the Phase 8 per-project file model), or is the single-implementation interface now load-bearing only as a test seam?
2. When static-frontend serving lands (F-19), what path-traversal/dotfile/SPA-fallback guardrails and tests should ship with it?
3. Should `EditorPage.tsx` / `useProjectEditor.ts` (F-1, F-2) be decomposed now, or is their size an accepted consequence of the save-pipeline invariants being centralized — and if decomposed, along which seams (chapter-CRUD vs save-pipeline vs title/status)?
4. Are the non-idempotent auto-snapshots on restore/replace (F-15) acceptable history noise, or should the retry path dedup them as the manual path does?
5. Does the single-user deployment model make server request-correlation/observability (F-10) genuinely out of scope, or is it worth a lightweight request-id child logger before multi-device/sync features arrive?

## Analysis Metadata

- **Agents dispatched:**
  - Structure & Boundaries (flaws 1,2,9,10,11,13,29; strengths S1,S2,S13,S14)
  - Coupling & Dependencies (flaws 3-8,23,27; strengths S3,S4,S5)
  - Integration & Data (flaws 14-19,24,26; strengths S6,S12)
  - Error Handling & Observability (flaws 12,20,21,22,25,28,34; strengths S7,S8,S9)
  - Security & Code Quality (flaws 30,31,32,33; strengths S10,S11)
  - Verifier (re-read every referenced line; merged duplicates; corrected figures)
- **Scope:** 118 non-test source files across `packages/shared`, `packages/server`, `packages/client`; `.devcontainer/` excluded.
- **Raw findings:** 28 (24 flaws + cross-specialist strengths)
- **Verified findings:** 21 flaws + 13 strengths (after merging F-3↔F-9 console facets and the F-4 ProjectStore double-flag; 0 dropped)
- **Filtered out:** 0 dropped; 6 corrected (hook counts, method count, commit-context reword, NOT_FOUND duplication count, console-site count, two merges)
- **By impact (flaws):** 2 High, 6 Medium, 13 Low
- **Steering files consulted:** CLAUDE.md, CONTRIBUTING.md, docs/roadmap.md. Steering accuracy was high — load-bearing conventions (layering, unified error mapper, string externalization, save-pipeline invariants, transactional boundaries) match the code. Drift found: 204 not in the status allowlist (F-18), static-frontend serving claimed but absent (F-19), and CONTRIBUTING's "where things live" tree omits several `src/` subdirs.
