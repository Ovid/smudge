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

The project is mid-MVP with an unusually mature engineering discipline for its stage: documented save-pipeline invariants, a unified API-error mapper, externalized strings enforced by ESLint, transactional write boundaries, and adversarial security tests. The architectural risks that exist are concentrated in two oversized client modules and in the absence of a *server-side* counterpart to the disciplined client error layer — not in correctness or data integrity.

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
- **Explanation:** Every operation that touches more than one row/table runs inside `store.transaction()` — soft-delete + image-refcount decrement, reorder + project-timestamp bump, restore-chapter + restore-parent-project + slug regen, replace + auto-snapshot + refcount diff. The transaction wrapper explicitly rejects nesting, and velocity side-effects fire *after* commit as best-effort. This is why transactional-boundary flaws are largely absent.
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
- **Evidence:** `packages/client/src/pages/EditorPage.tsx:83-2373` (`export function EditorPage()`, render `return (` at line 1734). *(Correction: hook count is 51, not the 74 originally reported.)*
- **Found by:** Structure & Boundaries
- **Status:** Partially fixed
- **Status reason:** Decomposed the two largest cohesive *imperative orchestration* clusters into dedicated hooks (the same hook-extraction seam the F-2 fix used). Extracted the find-and-replace flow (`finalizeReplaceSuccess` / `executeReplace` / `handleReplaceAllInManuscript` / `handleReplaceAllInChapter` / `handleReplaceOne` + the `replaceConfirmation` state and the `replaceOp` / slug latest-ref used only by these handlers) into a new `useFindReplaceController`, and the snapshot flow (`handleRestoreSnapshot`, the `RestoreAbortedError`/`RestoreFailedError` sentinels, `renderSnapshotContent`, and the `onView`/`onBeforeCreate` handlers) into a new `useSnapshotController`. The single `useEditorMutation` instance, the cross-caller `actionBusyRef`/`isActionBusy`, the editor-lock refs, the action banners, and the snapshot count/panel handles stay owned by `EditorPage` and are threaded into both hooks as deps — so the load-bearing "single mutation instance shared by every caller" invariant (CLAUDE.md save-pipeline §) holds by construction, and the 16-rounds-of-review handler bodies moved verbatim. `EditorPage.tsx` dropped from 2373 to 1394 lines (979 extracted). The ~640-line render and the trivial UI-state wiring were deliberately left in place per the chosen scope (Option A: orchestration hooks only) — hence **Partially fixed**: the god-object orchestration is resolved, but a follow-up session could further extract render sub-components (`EditorHeader` / `EditorMainContent` / dialog cluster) to approach F-2's end-state size. Safety net committed first (`b7880d7`) pinning the under-covered export-dialog / settings-dialog / word-count-announcement wiring; full suite stays green (2234 tests, +3 safety-net). Related flaws: F-7's hand-composed save-pipeline ordering was *relocated* into `useSnapshotController` (co-located, no longer scattered in the render) but **not resolved** — it remains hand-composed rather than routed through `useEditorMutation`, so F-7 stays open. F-17 (global editor registry, lives in `Editor.tsx`) is untouched.
- **Status date:** 2026-05-29
- **Status commit:** f5787586c6848cb2c8d56679357d0b3b1d5e3afe

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

### [F-4] ProjectStore: 54-method god interface across 7 domains
- **Category:** Flaw 2/9 (God object / Shotgun surgery) / Flaw 7 (Over-abstraction)
- **Impact:** Medium
- **Explanation:** One `ProjectStore` interface aggregates 54 methods spanning projects, chapters, statuses, settings, velocity, images, and snapshots, with exactly one production implementation (`SqliteProjectStore`, all thin one-line delegates) and no real mock. Two costs converge: every new data operation requires a synchronized three-file edit (repository + interface + delegating class), and the swappable-backend payoff that would justify the abstraction is speculative.
- **Evidence:** `packages/server/src/stores/project-store.types.ts:24` (interface), `stores/sqlite-project-store.ts:33` (impl). *(Flagged independently by two specialists — god-object and over-abstraction facets.)*
- **Found by:** Structure & Boundaries, Coupling & Dependencies

### [F-5] Configuration sprawl: data-directory default duplicated, DATA_DIR↔DB_PATH unvalidated
- **Category:** Flaw 22 (Configuration sprawl)
- **Impact:** Medium
- **Explanation:** Unlike the well-centralized numeric limits, the filesystem-config defaults are copy-pasted: `getDataDir()` and `purgeOldTrash` each independently default `process.env.DATA_DIR ?? path.join(__dirname, "../../data")`, while `knexfile.ts` derives a separate `DB_PATH` fallback to a *different* subpath. No module owns "where Smudge stores data," and the relationship between the image `DATA_DIR` and the SQLite `DB_PATH` is implicit — they can point at unrelated locations with no validation.
- **Evidence:** `packages/server/src/images/images.paths.ts:56`, `db/purge.ts:15`, `db/knexfile.ts:11`.
- **Found by:** Error Handling & Observability

### [F-6] Circular dependency: `app.ts` ↔ every `*.routes.ts`
- **Category:** Flaw 5 (Circular dependencies)
- **Impact:** Medium
- **Explanation:** `asyncHandler` — a generic Express helper with zero dependency on app composition — is exported from the composition root `app.ts` and imported back by all nine route modules, while `app.ts` imports all nine routers. This is a genuine runtime cycle that resolves only because routers are invoked lazily inside `createApp()`.
- **Evidence:** `packages/server/src/app.ts:15` (`export function asyncHandler`); `chapters/chapters.routes.ts:2` (`import { asyncHandler } from "../app"`), same across all routers.
- **Found by:** Coupling & Dependencies

### [F-7] Temporal coupling: snapshot handlers hand-compose the save-pipeline ordering
- **Category:** Flaw 27 (Temporal coupling)
- **Impact:** Medium
- **Explanation:** The snapshot `onView` / `onBeforeCreate` handlers manually sequence `setEditable(false)` → `flushSave()` → `cancelPendingSaves()` → `markClean()` → re-enable, replicating the invariant ordering that `useEditorMutation` enforces by construction. CLAUDE.md sanctions these as outside the hook's scope (they don't overwrite editor content), but the ordering is load-bearing and duplicated, so a future edit can silently desync it.
- **Evidence:** `packages/client/src/pages/EditorPage.tsx:2095-2231`.
- **Found by:** Coupling & Dependencies

### [F-8] Hidden side effects in `chapters.service` mutations
- **Category:** Flaw 12 (Hidden side effects)
- **Impact:** Medium
- **Explanation:** `updateChapter` reads like a row update but also bumps the parent project's `updated_at`, diffs image reference counts, and fires `velocityService.recordSave` (writing a `daily_snapshots` row); `deleteChapter` and `restoreChapter` similarly fire `updateDailySnapshot`. The behaviors are intentional and the velocity calls are best-effort, but nothing in the signatures discloses them — a discoverability/naming flaw, not a correctness one.
- **Evidence:** `packages/server/src/chapters/chapters.service.ts:86-124,143-174,258-265`.
- **Found by:** Error Handling & Observability

### [F-9] Client console logging is not production-gated or convention-consistent
- **Category:** Flaw 21 (No observability plan / log noise) / Flaw 34 (Inconsistent conventions)
- **Impact:** Low
- **Explanation:** A `devWarn(context, signal, err)` helper exists (DEV-gated, abort-aware) and is the intended canonical client log path, yet ~50 bare `console.warn`/`console.error` sites remain (43 warn / 7 error). None are wrapped in `import.meta.env.DEV`, so they log raw error objects to the production browser console on every failure; the `.warn`-vs-`.error` choice is inconsistent across analogous siblings, and abort-gating is hand-rolled unevenly. *(Two originally-separate findings — "not DEV-gated" and "inconsistent/ad-hoc" — merged here as facets of the same call-site cluster.)*
- **Evidence:** `packages/client/src/errors/devWarn.ts` (gated) vs `hooks/useProjectEditor.ts:374-379,824`, `hooks/useTrashManager.ts:127,228`, `components/DashboardView.tsx:59,77`.
- **Found by:** Error Handling & Observability

### [F-10] No server request correlation / access observability
- **Category:** Flaw 21 (No observability plan)
- **Impact:** Low
- **Explanation:** There is no request-id middleware, no access logging, and no metrics; when the global error handler logs "Unhandled request error" there is no way to correlate it to the request (method, path, id) or to other log lines from the same request. Low severity for a single-user app, but a genuine gap — the only request-path observability is the terminal error log. *(Distinct from F-9: server-side vs client-side.)*
- **Evidence:** `packages/server/src/app.ts` (routers mounted directly to `globalErrorHandler`, no logging middleware between); `logger.ts`.
- **Found by:** Error Handling & Observability

### [F-11] Leaky abstraction: `search.routes` reaches past its service into the store
- **Category:** Flaw 6 (Leaky abstraction)
- **Impact:** Low
- **Explanation:** Every other route obeys Routes→Service→Store, but `search.routes.ts` calls `getProjectStore().findProjectBySlug(slug)` directly because `SearchService.searchProject/replaceInProject` accept only a `projectId`. The route now owns a piece of data-access logic the service should encapsulate.
- **Evidence:** `packages/server/src/search/search.routes.ts:83,128`; `search.service.ts:135`.
- **Found by:** Coupling & Dependencies

### [F-12] Leaf renderers pull the global store singleton directly
- **Category:** Flaw 4 (High/unstable dependencies) / Flaw 23 (DI misuse)
- **Impact:** Low
- **Explanation:** Presentation-layer export renderers reach into `getProjectStore()` (a module-global with throw-on-unset) rather than receiving data via parameters, coupling export formatting to global initialization order and obscuring their data dependencies at the call boundary.
- **Evidence:** `packages/server/src/export/image-resolver.ts:19,144`, `export/epub.renderer.ts:85`. *(Correction: commit `71dc085` is a deferral/perf fix, not a prior init-order incident.)*
- **Found by:** Coupling & Dependencies

### [F-13] Inconsistent boundary: `images.service` does raw filesystem I/O
- **Category:** Flaw 13 (Inconsistent boundaries)
- **Impact:** Low
- **Explanation:** Every other domain reaches persistence solely through the `ProjectStore` abstraction, but `images.service` directly calls `mkdir`/`writeFile`/`readFile`/`unlink`. This is a defensible asymmetry (binary blobs vs rows; the `AssetStore` seam was added then removed as unused), but it means image persistence is the one service whose I/O has no injectable/mockable seam.
- **Evidence:** `packages/server/src/images/images.service.ts:1,80-81,124,209`.
- **Found by:** Structure & Boundaries

### [F-14] Filesystem ops on images live outside the DB transaction
- **Category:** Flaw 26 (Poor transactional boundaries)
- **Impact:** Low
- **Explanation:** Image upload writes the file before `insertImage` (unlinking on insert failure), and delete unlinks *after* the transaction commits. These FS ops cannot join the SQLite transaction, so the code accepts the safer "orphan file (harmless)" outcome over a "ghost DB record" one — but a crash between commit and unlink leaves an orphan file, and unlike soft-deleted rows there is no startup reaper for image files. Documented and by design.
- **Evidence:** `packages/server/src/images/images.service.ts:80,205`.
- **Found by:** Integration & Data

### [F-15] Auto-snapshot inserts on restore/replace are non-idempotent
- **Category:** Flaw 19 (Lack of idempotency)
- **Impact:** Low
- **Explanation:** `restoreSnapshot` and `replaceInProject` both insert an `is_auto` snapshot with no content-hash dedup (the manual-snapshot path *is* deduped). A retried restore/replace request that reaches the server creates another "Before restore…" / "Before find-and-replace…" snapshot even when content is identical — this pollutes snapshot history rather than corrupting data, since the operation is transactional.
- **Evidence:** `packages/server/src/snapshots/snapshots.service.ts:184`, `search/search.service.ts:297`.
- **Found by:** Integration & Data

### [F-16] Inconsistent response shapes across sibling endpoints
- **Category:** Flaw 24 (Inconsistent API contracts)
- **Impact:** Low
- **Explanation:** Two facets: (a) within the snapshot router, create returns a `{ status, snapshot }` envelope while restore returns a bare chapter object; (b) the four DELETE endpoints use three different success contracts — chapter/project return `{ message }`, image returns `{ deleted: true }`, snapshot returns `204` empty. None is wrong, but a generic client helper must special-case each.
- **Evidence:** `packages/server/src/snapshots/snapshots.routes.ts:56,62,119,164`; `chapters.routes.ts:82`; `projects.routes.ts:183`; `images.routes.ts:185`.
- **Found by:** Integration & Data

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

### [F-19] Doc drift: steering files claim static-frontend serving that does not exist
- **Category:** Flaw 30 (Security as afterthought — forward-looking) / documentation
- **Impact:** Low
- **Explanation:** CLAUDE.md and CONTRIBUTING describe Express serving the static frontend on port 3456, but `createApp()` mounts only `/api/*` routes + a health check — no `express.static`, no SPA catch-all, and no `Dockerfile` exists in the repo. Consistent with "MVP in progress," so not a live vuln, but flagged because (a) it contradicts steering docs and (b) when static serving is added it will be a new path-traversal/unsafe-serving surface that currently has no guardrails or tests.
- **Evidence:** `packages/server/src/app.ts:23-61`; no `Dockerfile` at repo root.
- **Found by:** Security & Code Quality

### [F-20] Circular dependency: `export.renderers.ts` ↔ `image-resolver.ts`
- **Category:** Flaw 5 (Circular dependencies)
- **Impact:** Low
- **Explanation:** `export.renderers.ts` imports `resolveImagesInHtml` from `image-resolver.ts`, while `image-resolver.ts` imports `escapeHtml` (a pure string utility that does not conceptually belong to the renderer module) back — a true bidirectional runtime cycle.
- **Evidence:** `packages/server/src/export/export.renderers.ts:4`, `export/image-resolver.ts:5`.
- **Found by:** Coupling & Dependencies

### [F-21] Dead code: unused `getImage` service export
- **Category:** Flaw 31 (Dead code / unused dependencies)
- **Impact:** Low
- **Explanation:** `imagesService.getImage(id)` is referenced only by its own test — no route or module imports it. The serve path uses `serveImage`; resolvers use the store's `findImageById` directly. The function and the tests exercising it are dead surface (remove it, or a caller is missing).
- **Evidence:** `packages/server/src/images/images.service.ts:109-112`.
- **Found by:** Security & Code Quality

## Coverage Checklist

### Flaw/Risk Types 1–34
| # | Type | Status | Finding |
|---|------|--------|---------|
| 1 | Global mutable state | Observed | F-17 |
| 2 | God object | Observed | F-1, F-2, F-4 |
| 3 | Tight coupling | Not observed | — |
| 4 | High/unstable dependencies | Observed | F-12 |
| 5 | Circular dependencies | Observed | F-6, F-20 |
| 6 | Leaky abstractions | Observed | F-11 |
| 7 | Over-abstraction | Observed | F-4 |
| 8 | Premature optimization | Not observed | — |
| 9 | Shotgun surgery | Observed | F-4 |
| 10 | Feature envy / anemic domain model | Not observed | — |
| 11 | Low cohesion | Observed | F-2 |
| 12 | Hidden side effects | Observed | F-8 |
| 13 | Inconsistent boundaries | Observed | F-13 |
| 14 | Distributed monolith | Not applicable | single process |
| 15 | Chatty service calls | Not applicable | in-process only |
| 16 | Synchronous-only integration | Not applicable | intentional sync SQLite |
| 17 | No clear ownership of data | Not observed | — (S-9: single-owner columns) |
| 18 | Shared database across services | Not applicable | one DB, one process |
| 19 | Lack of idempotency | Observed | F-15 |
| 20 | Weak error handling strategy | Observed | F-3 |
| 21 | No observability plan | Observed | F-9, F-10 |
| 22 | Configuration sprawl | Observed | F-5 |
| 23 | Dependency injection misuse | Observed | F-12 |
| 24 | Inconsistent API contracts | Observed | F-16 |
| 25 | Business logic in the UI | Not observed | — (S-13) |
| 26 | Poor transactional boundaries | Observed | F-14 |
| 27 | Temporal coupling | Observed | F-7 |
| 28 | Magic numbers/strings everywhere | Not observed | — (S-13) |
| 29 | "Utility" dumping ground | Not observed | — (S-2) |
| 30 | Security as an afterthought | Observed (forward-looking) | F-19 |
| 31 | Dead code / unused dependencies | Observed | F-21 |
| 32 | Missing test coverage for critical paths | Not observed | — (S-12) |
| 33 | Hard-coded credentials/secrets | Not observed | — |
| 34 | Inconsistent error/logging conventions | Observed | F-3, F-9, F-18 |

### Strength Categories S1–S14
| # | Category | Status | Finding |
|---|----------|--------|---------|
| S1 | Clear modular boundaries | Observed | S-1 |
| S2 | High cohesion | Observed | S-2 |
| S3 | Loose coupling | Observed | S-6, S-10 |
| S4 | Dependency direction is stable | Observed | S-11 |
| S5 | Dependency management hygiene | Observed | S-11 |
| S6 | Consistent API contracts | Observed | S-9 |
| S7 | Robust error handling | Observed | S-4 |
| S8 | Observability present | Observed | S-5 |
| S9 | Configuration discipline | Observed | S-13 |
| S10 | Security built-in | Observed | S-7, S-8 |
| S11 | Testability & coverage | Observed | S-12 |
| S12 | Resilience patterns | Observed | S-2, S-3, S-8 |
| S13 | Domain modeling strength | Not observed | — (row-oriented by design; not a weakness) |
| S14 | Simple, pragmatic abstractions | Observed | S-6, S-10 |

## Hotspots

Top 3 files/directories to review:
1. **`packages/client/src/pages/EditorPage.tsx` + `hooks/useProjectEditor.ts`** — the two oversized client modules (2373 + 1722 lines) that concentrate nearly all application coordination and the save pipeline. Highest-leverage decomposition target; also where F-7 (hand-composed temporal coupling) lives. Review together — they are tightly intertwined.
2. **`packages/server/src/` error signaling (routes + services)** — the strongest *structural* gap: a disciplined client error layer with no server counterpart (F-3). A central hotspot of duplicated envelopes and mixed failure-signaling mechanisms; an `AppError` taxonomy would consolidate F-3 and the F-18 status drift.
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
