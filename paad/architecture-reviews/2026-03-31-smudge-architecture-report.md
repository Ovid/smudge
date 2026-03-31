# Architecture Report — smudge

**Date:** 2026-03-31
**Commit:** 40ca3ad62217101e684542cff556641f2505106b
**Languages:** TypeScript (frontend + backend + shared)
**Key directories:** `packages/shared/`, `packages/server/`, `packages/client/`, `e2e/`
**Scope:** Full repository

## Repo Overview

Smudge is a single-user web-based writing application for long-form fiction and non-fiction, organized as projects containing chapters. It is a TypeScript monorepo with three npm workspace packages (shared, server, client) plus Playwright e2e tests. The backend uses Express 4.x with better-sqlite3 (synchronous) via Knex.js. The frontend uses React 18+ with TipTap v2 for rich text editing, Tailwind CSS for styling, and @dnd-kit for drag-and-drop chapter reordering. ~71 source files, small-to-medium codebase. Single Docker container deployment, no authentication by design.

## Strengths

### [S-1] Clean monorepo dependency architecture
- **Category:** S1 (Clear modular boundaries) + S4 (Dependency direction is stable)
- **Impact:** High
- **Explanation:** The three-package monorepo has strictly unidirectional dependency flow: `shared` has zero internal dependencies (only `zod`), while both `server` and `client` depend on `@smudge/shared`. No reverse imports exist. The shared package exports a curated public API of types, Zod schemas, `countWords()`, and `generateSlug()`.
- **Evidence:** `packages/shared/src/index.ts` — 8 named exports. `packages/shared/package.json` — only dependency is `zod`. No import from `@smudge/server` or `@smudge/client` in shared source.
- **Found by:** Structure & Boundaries, Coupling & Dependencies

### [S-2] Factory-function dependency injection for testability
- **Category:** S14 (Simple, pragmatic abstractions)
- **Impact:** High
- **Explanation:** `createApp(db)` accepts a Knex instance and passes it to router factory functions (`projectsRouter(db)`, `chaptersRouter(db)`, `chapterStatusesRouter(db)`). No DI framework, no service classes — just function parameters. Tests create isolated app instances with in-memory databases.
- **Evidence:** `packages/server/src/app.ts:16` (`createApp(db: Knex)`), `packages/server/src/__tests__/test-helpers.ts:29` (`createApp(testDb)`)
- **Found by:** Structure & Boundaries, Coupling & Dependencies

### [S-3] Multi-layered save pipeline resilience
- **Category:** S12 (Resilience patterns)
- **Impact:** High
- **Explanation:** The auto-save pipeline — the app's core trust promise — implements three complementary resilience strategies: (1) exponential backoff retry (3 attempts at 2s/4s/8s, with early abort on 4xx); (2) localStorage draft cache preserving unsaved content across reloads; (3) `beforeunload` guard. Sequence counters prevent stale saves from overwriting data during chapter switches.
- **Evidence:** `packages/client/src/hooks/useProjectEditor.ts:67-104` (retry), `packages/client/src/hooks/useContentCache.ts` (cache), `packages/client/src/components/Editor.tsx:46-55` (beforeunload), `useProjectEditor.ts:19-20` (sequence counters)
- **Found by:** Integration & Data, Error Handling & Observability

### [S-4] Consistent error envelope across all API endpoints
- **Category:** S6 (Consistent API contracts)
- **Impact:** High
- **Explanation:** Every error response follows `{ error: { code, message } }` with specific machine-readable codes (`NOT_FOUND`, `VALIDATION_ERROR`, `PROJECT_TITLE_EXISTS`, `REORDER_MISMATCH`, `PROJECT_PURGED`, `RESTORE_CONFLICT`). The client's `apiFetch` wrapper uniformly parses this envelope.
- **Evidence:** Error responses in `chapters.ts`, `projects.ts`, `chapter-statuses.ts` all use identical structure. Global fallback in `app.ts:29-43`. Client parser at `client.ts:30-37`.
- **Found by:** Integration & Data, Error Handling & Observability

### [S-5] Zod validation on all mutation endpoints
- **Category:** S10 (Security built-in)
- **Impact:** High
- **Explanation:** Every POST/PATCH/PUT endpoint validates input through shared Zod schemas before any database interaction. `UpdateChapterSchema` enforces `type: "doc"` on TipTap content. All schemas live in the shared package ensuring client-server agreement.
- **Evidence:** `CreateProjectSchema.safeParse` in `projects.ts:21`, `UpdateChapterSchema.safeParse` in `chapters.ts:36`, `ReorderChaptersSchema.safeParse` in `projects.ts:288`
- **Found by:** Security & Code Quality

### [S-6] Parameterized queries throughout — no SQL injection surface
- **Category:** S10 (Security built-in)
- **Impact:** High
- **Explanation:** All database queries use Knex's query builder with parameterized values. The only `db.raw()` calls use static strings (PRAGMA statements and a COALESCE aggregate). No user input is ever interpolated into raw SQL.
- **Evidence:** `projects.ts:108` — `db.raw("COALESCE(SUM(chapters.word_count), 0) as total_word_count")` (static string). All other queries use `.where()`, `.insert()`, `.update()`.
- **Found by:** Security & Code Quality

### [S-7] DOMPurify sanitization on HTML output
- **Category:** S10 (Security built-in)
- **Impact:** High
- **Explanation:** When rendering TipTap JSON as HTML for preview, the output is sanitized through DOMPurify before injection via `dangerouslySetInnerHTML`, preventing XSS.
- **Evidence:** `packages/client/src/components/PreviewMode.tsx:71` — `dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}`
- **Found by:** Security & Code Quality

### [S-8] Client components use callback props, not direct API coupling
- **Category:** S3 (Loose coupling)
- **Impact:** High
- **Explanation:** All leaf components (Sidebar, Editor, TrashView, etc.) receive behavior via typed callback props and never import the API client or hooks directly, keeping them pure presentational components.
- **Evidence:** `Sidebar.tsx:180-193` — `SidebarProps` with 12 callback/data props. `Editor.tsx:8-12` — `onSave`/`onContentChange` callbacks. `TrashView.tsx:4-8` — `onRestore`/`onBack`.
- **Found by:** Coupling & Dependencies

### [S-9] Save pipeline multi-layer test coverage
- **Category:** S11 (Testability & coverage)
- **Impact:** High
- **Explanation:** The save pipeline is tested at three layers: server integration tests validate PATCH with valid/invalid content; hook tests cover retry, backoff, 4xx bail-out, and cross-chapter cancellation; Editor component tests validate debounced auto-save and blur-triggered save.
- **Evidence:** `useProjectEditor.test.ts:119-200` (retry tests), `chapters.test.ts:183-204` (content preservation), `Editor.test.ts` (debounce/blur)
- **Found by:** Security & Code Quality

### [S-10] Integration tests use real SQLite, not mocks
- **Category:** S11 (Testability & coverage)
- **Impact:** High
- **Explanation:** All server tests run against in-memory SQLite with real migrations applied. This catches schema/query issues that mocked tests would miss.
- **Evidence:** `packages/server/src/__tests__/test-helpers.ts:10` — `{ filename: ":memory:" }`, line 12: `testDb.migrate.latest()`
- **Found by:** Security & Code Quality

### [S-11] Race condition handling with sequence counters
- **Category:** S7 (Robust error handling)
- **Impact:** Medium
- **Explanation:** Save and chapter-select operations use sequence counters to discard stale responses, preventing race conditions when the user switches chapters during in-flight saves.
- **Evidence:** `useProjectEditor.ts:19-20` (`saveSeqRef`, `selectChapterSeqRef`), checked at lines 72, 75, 136, 142
- **Found by:** Error Handling & Observability

### [S-12] String externalization fully implemented
- **Category:** S9 (Configuration discipline)
- **Impact:** Medium
- **Explanation:** All user-facing strings are centralized in a single `STRINGS` constant organized by feature domain. All 7 component files import `STRINGS` — no raw string literals in render output.
- **Evidence:** `packages/client/src/strings.ts` — 148 lines, `as const`. All components reference `STRINGS.*`.
- **Found by:** Structure & Boundaries, Error Handling & Observability

### [S-13] Shared editorExtensions prevents rendering divergence
- **Category:** S13 (Domain modeling strength)
- **Impact:** Medium
- **Explanation:** A single `editorExtensions` array is imported by both Editor (editing) and PreviewMode (`generateHTML()`), preventing silent rendering divergence between edit and preview modes.
- **Evidence:** `editorExtensions.ts` imported by `Editor.tsx:4` and `PreviewMode.tsx:5`. Comment: "Keeping these in sync prevents silent rendering divergence."
- **Found by:** Structure & Boundaries, Coupling & Dependencies

### [S-14] Optimistic update with multi-layer revert
- **Category:** S7 (Robust error handling)
- **Impact:** Medium
- **Explanation:** Status changes apply an optimistic update, then on failure attempt server-side reload, and fall back to local revert from saved previous state — a three-tier approach.
- **Evidence:** `useProjectEditor.ts:226-280` — optimistic (231-239), server reload (247-261), local revert (264-277)
- **Found by:** Error Handling & Observability

### [S-15] Save status communicated via aria-live region
- **Category:** S8 (Observability present)
- **Impact:** Medium
- **Explanation:** An `aria-live="polite"` region displays save state transitions (unsaved/saving/saved/error), providing user-facing observability of the save pipeline.
- **Evidence:** `EditorPage.tsx:597` — `<div role="status" aria-live="polite">`
- **Found by:** Error Handling & Observability

### [S-16] E2e tests include automated aXe accessibility audits
- **Category:** S11 (Testability & coverage)
- **Impact:** Medium
- **Explanation:** Playwright e2e tests run `@axe-core/playwright` on dashboard and sidebar views, asserting zero accessibility violations.
- **Evidence:** `e2e/dashboard.spec.ts:123-143` — `new AxeBuilder({ page }).analyze(); expect(results.violations).toEqual([])`
- **Found by:** Security & Code Quality

### [S-17] Small focused utility modules
- **Category:** S2 (High cohesion)
- **Impact:** Medium
- **Explanation:** Utility modules are narrowly scoped: `wordcount.ts` (25 lines), `slugify.ts` (12 lines), `purge.ts` (23 lines), `parseChapterContent.ts` (10 lines), `resolve-slug.ts` (28 lines), `status-labels.ts` (13 lines), `useContentCache.ts` (27 lines). None show signs of growing into dumping grounds.
- **Evidence:** File line counts range 10-28. Each exports 1-2 functions. Git history confirms intentional extraction.
- **Found by:** Structure & Boundaries

### [S-18] API client as typed facade
- **Category:** S14 (Simple, pragmatic abstractions)
- **Impact:** Medium
- **Explanation:** A single `api` object groups methods by domain (`projects`, `chapters`, `chapterStatuses`). A generic `apiFetch<T>` handles error parsing and type narrowing. No class hierarchy or interceptor chains.
- **Evidence:** `packages/client/src/api/client.ts:44-118` — complete API surface as a plain object literal
- **Found by:** Structure & Boundaries

### [S-19] Minimal purpose-driven dependencies
- **Category:** S5 (Dependency management hygiene)
- **Impact:** Medium
- **Explanation:** Each package declares only the dependencies it uses. Shared has 1 runtime dep (zod), server has 5 essential deps, client has React ecosystem + TipTap + DOMPurify. No bloat.
- **Evidence:** `packages/shared/package.json`, `packages/server/package.json`, `packages/client/package.json`
- **Found by:** Coupling & Dependencies

## Flaws/Risks

### [F-1] No e2e test for core editing/saving user story
- **Category:** 32 (Missing test coverage for critical paths)
- **Impact:** High
- **Explanation:** The most fundamental user story — type text, auto-save, reload, verify persistence — has no end-to-end test. The e2e directory contains a single spec focused on dashboard/status features. The save pipeline's debounce, blur-save, and content cache are only tested at unit/integration level with mocked APIs.
- **Evidence:** `e2e/` contains only `dashboard.spec.ts` (5 tests, none exercise content saving)
- **Found by:** Security & Code Quality
- **Status:** Fixed
- **Status reason:** Added e2e/editor-save.spec.ts with two tests: auto-save persistence after reload, and content persistence across chapter switches
- **Status date:** 2026-03-31 11:22 UTC
- **Status commit:** 5329631

### [F-2] No e2e test for save-failure recovery (contradicts CLAUDE.md)
- **Category:** 32 (Missing test coverage for critical paths)
- **Impact:** High
- **Explanation:** CLAUDE.md explicitly states "E2e tests cover all user stories including save-failure recovery via network interception." This is not implemented. The steering file is stale with respect to e2e coverage.
- **Evidence:** CLAUDE.md testing section vs. actual `e2e/dashboard.spec.ts` — no network interception tests exist
- **Found by:** Security & Code Quality
- **Status:** Fixed
- **Status reason:** Added save-failure recovery e2e test using Playwright route interception: blocks PATCH, verifies error state, unblocks, verifies recovery and persistence after reload
- **Status date:** 2026-03-31 11:24 UTC
- **Status commit:** f1798e7

### [F-3] parseChapterContent silently swallows JSON parse errors
- **Category:** 20 (Weak error handling strategy)
- **Impact:** High
- **Explanation:** If chapter content stored in SQLite becomes corrupted JSON, the parse error is silently caught and the content becomes `null`. The user sees an empty chapter with no error message, no server-side alert, and no indication data was lost. The original corrupted data remains in the DB but is invisible.
- **Evidence:** `packages/server/src/routes/parseChapterContent.ts:4-5` — `try { ... JSON.parse(chapter.content) } catch { return { ...chapter, content: null } }`
- **Found by:** Error Handling & Observability
- **Status:** Fixed
- **Status reason:** Added console.error logging with chapter ID and error details on corrupt JSON parse failure
- **Status date:** 2026-03-31 11:16 UTC
- **Status commit:** 6098193

### [F-4] EditorPage.tsx is a large page-level orchestrator
- **Category:** 2 (God object)
- **Impact:** Medium
- **Explanation:** At 668 lines, EditorPage manages ~15 useState variables, ~7 useRef variables, a 66-line keydown handler, 3 view modes plus trash, title editing state machines, and sidebar resize logic. It already delegates business logic to `useProjectEditor`, but remains the highest-growth-risk file — any new feature will further inflate it.
- **Evidence:** `packages/client/src/pages/EditorPage.tsx:57-88` (state declarations), lines 193-258 (keydown handler), 4 conditional rendering blocks
- **Found by:** Structure & Boundaries, Coupling & Dependencies

### [F-5] Adding a chapter status requires edits across 7+ files
- **Category:** 9 (Shotgun surgery)
- **Impact:** Medium
- **Explanation:** The valid status set is defined independently in three places: Zod enum in `schemas.ts`, DB `chapter_statuses` table via migration, and `STATUS_COLORS` mapping. The server explicitly guards against drift between the Zod enum and DB table. Adding a new status (e.g., "proofread") requires coordinated changes across all three packages.
- **Evidence:** `schemas.ts:5` — `z.enum(["outline", "rough_draft", "revised", "edited", "final"])`. `statusColors.ts` — same 5 keys. `chapters.ts:73-75` — comment acknowledging drift risk.
- **Found by:** Structure & Boundaries

### [F-6] parseChapterContent is a leaky abstraction at the route level
- **Category:** 6 (Leaky abstractions)
- **Impact:** Medium
- **Explanation:** Every route handler that reads chapters must remember to call `parseChapterContent()` to convert SQLite-stored JSON strings to objects. There are 7 manual call sites. Missing a call would serve raw JSON strings to the client. The storage detail leaks into every endpoint.
- **Evidence:** Call sites in `projects.ts:212,265,421` and `chapters.ts:27,105,195,205`
- **Found by:** Coupling & Dependencies
- **Status:** Fixed
- **Status reason:** Extracted queryChapter/queryChapters helpers that encapsulate JSON parsing. Routes now use these instead of raw queries + manual parseChapterContent. Only chapterQueries.ts imports parseChapterContent.
- **Status date:** 2026-03-31 11:20 UTC
- **Status commit:** 56dc1c1

### [F-7] flushSave must be called manually before chapter/mode switch
- **Category:** 27 (Temporal coupling)
- **Impact:** Medium
- **Explanation:** Before selecting a new chapter or switching view modes, the current editor content must be flushed via `editorRef.current?.flushSave()`. This ordering requirement is manually enforced in 4 places. Missing a call site causes silent data loss.
- **Evidence:** `EditorPage.tsx:132` (chapter switch), line 225 (keyboard shortcut), line 471 (preview toggle), line 486 (dashboard toggle)
- **Found by:** Coupling & Dependencies

### [F-8] "Untitled Chapter" default duplicated across packages
- **Category:** 28 (Magic numbers/strings everywhere)
- **Impact:** Medium
- **Explanation:** The default chapter title "Untitled Chapter" appears as raw strings in the server (`projects.ts:66,247`) and as `STRINGS.chapter.untitledDefault` in the client. Also hardcoded in the initial migration. These independent sources could drift.
- **Evidence:** `projects.ts:66` and `:247` — `title: "Untitled Chapter"` (raw). `strings.ts:26` — `untitledDefault: "Untitled Chapter"` (externalized). `001_create_projects_and_chapters.js:15`.
- **Found by:** Error Handling & Observability
- **Status:** Fixed
- **Status reason:** Extracted UNTITLED_CHAPTER constant to @smudge/shared/constants.ts; server and client both import from shared
- **Status date:** 2026-03-31 15:46 UTC
- **Status commit:** 66f102e

### [F-9] 30-day purge cutoff duplicated across packages
- **Category:** 28 (Magic numbers/strings everywhere)
- **Impact:** Medium
- **Explanation:** The 30-day soft-delete retention period is independently computed as `30 * 24 * 60 * 60 * 1000` in both the server purge logic and the client's trash display. No shared constant exists.
- **Evidence:** `packages/server/src/db/purge.ts:4`, `packages/client/src/strings.ts:76` — identical computation
- **Found by:** Error Handling & Observability
- **Status:** Fixed
- **Status reason:** Extracted TRASH_RETENTION_MS constant to @smudge/shared/constants.ts; server purge and client strings both import from shared
- **Status date:** 2026-03-31 15:56 UTC
- **Status commit:** 76edd9a

### [F-10] No structured server-side logging
- **Category:** 21 (No observability plan)
- **Impact:** Medium
- **Explanation:** The server uses only bare `console.log` and `console.error` with no timestamps, request IDs, log levels, or request logging middleware. When diagnosing issues, there is no way to correlate errors to specific requests.
- **Evidence:** `app.ts:38` — `console.error(err)`. `index.ts:25,33,38-41,54-57` — `console.log(...)`. No request logging middleware.
- **Found by:** Error Handling & Observability

### [F-11] Client error handling inconsistency: handleStatusChange re-throws
- **Category:** 34 (Inconsistent error/logging conventions)
- **Impact:** Medium
- **Explanation:** `handleStatusChange` is the only handler in `useProjectEditor` that re-throws its error. All other handlers catch and call `setError()`. The caller in EditorPage must wrap it specially in `handleStatusChangeWithError`. A developer adding a new handler could easily choose the wrong pattern.
- **Evidence:** `useProjectEditor.ts:278` — `throw err`. Compare with `handleDeleteChapter` at line 181 — `setError(...)`. `EditorPage.tsx:118-128` — special wrapper.
- **Found by:** Error Handling & Observability
- **Status:** Fixed
- **Status reason:** handleStatusChange now accepts optional onError callback instead of returning error; aligns with other handlers' catch-and-handle pattern while preserving non-fatal semantics
- **Status date:** 2026-03-31 17:42 UTC
- **Status commit:** 7e0ba50

### [F-12] useContentCache silently swallows localStorage errors
- **Category:** 20 (Weak error handling strategy)
- **Impact:** Medium
- **Explanation:** All three functions in useContentCache have empty catch blocks. If `setCachedContent` fails (storage full, corrupted), the safety net for unsaved content — a core spec requirement — silently stops working with no user indication.
- **Evidence:** `packages/client/src/hooks/useContentCache.ts:8-9,17-18,24-25` — empty catch blocks
- **Found by:** Error Handling & Observability
- **Status:** Fixed
- **Status reason:** Added console.warn logging in all three catch blocks with function name prefix for dev tools filtering
- **Status date:** 2026-03-31 17:48 UTC

### [F-13] No security headers middleware
- **Category:** 30 (Security as an afterthought)
- **Impact:** Medium
- **Explanation:** The Express app has no Helmet middleware, no Content-Security-Policy, no X-Frame-Options, no X-Content-Type-Options. The app is designed for Docker deployment which implies network exposure.
- **Evidence:** `packages/server/src/app.ts:17-23` — middleware chain is only `express.json()` followed by routes. No `helmet` import anywhere.
- **Found by:** Security & Code Quality

### [F-14] useProjectEditor.ts concentrates all project mutations
- **Category:** 2 (God object)
- **Impact:** Low
- **Explanation:** At 321 lines, this hook manages 8 distinct operations and returns 18 fields. The mutations are related and share state, so splitting is debatable, but it is a change magnet for any new project/chapter operation.
- **Evidence:** `useProjectEditor.ts:302-320` — return statement with 18 values
- **Found by:** Structure & Boundaries

### [F-15] Repeated error envelope construction (~16 times)
- **Category:** 9 (Shotgun surgery)
- **Impact:** Low
- **Explanation:** The same `res.status(N).json({ error: { code, message } })` pattern is repeated inline ~16 times across route handlers with no shared helper function. Changing the error envelope format would require touching every handler.
- **Evidence:** `NOT_FOUND` response appears ~8 times in `projects.ts`, ~5 times in `chapters.ts`
- **Found by:** Structure & Boundaries

### [F-16] Module-level singleton + dead getDb() in connection.ts
- **Category:** 1 (Global mutable state) + 27 (Temporal coupling)
- **Impact:** Low
- **Explanation:** `let db: Knex | undefined` at module scope creates a global mutable singleton, and `getDb()` throws if called before `initDb()`. However, production code uses DI via `createApp(db)` — the singleton is vestigial dead code that could invite misuse.
- **Evidence:** `packages/server/src/db/connection.ts:4` — `let db: Knex | undefined`. `getDb()` only referenced in tests.
- **Found by:** Structure & Boundaries, Coupling & Dependencies

### [F-17] Dashboard API response type inline, not in shared types
- **Category:** 3 (Tight coupling)
- **Impact:** Low
- **Explanation:** The dashboard endpoint's response type is defined inline in the client as an anonymous type literal, breaking the established pattern of shared types for API contracts.
- **Evidence:** `packages/client/src/api/client.ts:74-91` — complex inline type. No corresponding type in `packages/shared/src/types.ts`.
- **Found by:** Coupling & Dependencies

### [F-18] Chapter creation lacks transaction
- **Category:** 26 (Poor transactional boundaries)
- **Impact:** Low
- **Explanation:** Chapter INSERT and project `updated_at` UPDATE are two separate statements outside a transaction, inconsistent with other multi-table operations in the same file (project creation, chapter reordering, project deletion) which all use `db.transaction()`.
- **Evidence:** `packages/server/src/routes/projects.ts:244-255` — no transaction wrapper. Compare with line 51 (project creation uses `db.transaction`).
- **Found by:** Integration & Data

### [F-19] Chapter delete skips project timestamp update
- **Category:** 26 (Poor transactional boundaries)
- **Impact:** Low
- **Explanation:** Chapter soft-delete does not update the parent project's `updated_at`, inconsistent with chapter creation and chapter update which both update the project timestamp.
- **Evidence:** `packages/server/src/routes/chapters.ts:127-128` — only updates chapter `deleted_at`. Compare with PATCH at lines 91-96.
- **Found by:** Integration & Data

### [F-20] STATUS_COLORS duplicates status values from Zod enum
- **Category:** 6 (Leaky abstractions)
- **Impact:** Low
- **Explanation:** The client's `STATUS_COLORS` mapping hardcodes the same 5 status strings as the Zod enum, with a `#999` fallback for unrecognized statuses. Not derived from or validated against the canonical list.
- **Evidence:** `statusColors.ts` keys match `schemas.ts:5` enum values. Fallback at `DashboardView.tsx:183`.
- **Found by:** Coupling & Dependencies

### [F-21] Slug vs UUID identifier asymmetry + CLAUDE.md spec drift
- **Category:** 24 (Inconsistent API contracts)
- **Impact:** Low
- **Explanation:** Projects use `:slug` identifiers while chapters use `:id` (UUID). CLAUDE.md documents `/api/projects/{id}` but the actual code uses `/api/projects/:slug`. The asymmetry is an intentional design choice but the spec is stale.
- **Evidence:** `projects.ts` — `req.params.slug`. `chapters.ts` — `req.params.id`. CLAUDE.md says `PUT /api/projects/{id}/chapters/order`.
- **Found by:** Integration & Data

### [F-22] Sidebar dimension constants scattered
- **Category:** 28 (Magic numbers/strings everywhere)
- **Impact:** Low
- **Explanation:** Sidebar min/max widths (180/480) are defined as named constants in EditorPage but duplicated as inline magic numbers in Sidebar's resize handler.
- **Evidence:** `EditorPage.tsx:15-16` — `SIDEBAR_MIN_WIDTH = 180, SIDEBAR_MAX_WIDTH = 480`. `Sidebar.tsx:489,510` — inline `180` and `480`.
- **Found by:** Error Handling & Observability

### [F-23] DB_PATH configured in two places
- **Category:** 22 (Configuration sprawl)
- **Impact:** Low
- **Explanation:** Both `index.ts` and `knexfile.ts` independently read `process.env.DB_PATH`. When `index.ts` has a value, it constructs its own Knex config and bypasses `createKnexConfig()`, so the two code paths could diverge.
- **Evidence:** `index.ts:6` — `process.env.DB_PATH`. `knexfile.ts:10` — `process.env.DB_PATH ?? path.join(...)`.
- **Found by:** Error Handling & Observability

### [F-24] Chapter creation not idempotent
- **Category:** 19 (Lack of idempotency)
- **Impact:** Low
- **Explanation:** `POST /:slug/chapters` generates a new UUID per call with no idempotency key. A network retry after a dropped response could create duplicate chapters. Low risk for a single-user app with rare chapter creation.
- **Evidence:** `projects.ts:241` — `const chapterId = uuid()` per request. No `Idempotency-Key` header check.
- **Found by:** Integration & Data

### [F-25] TipTap schema uses .passthrough() allowing arbitrary keys
- **Category:** 30 (Security as an afterthought)
- **Impact:** Low
- **Explanation:** The `TipTapDocSchema` validates `type: "doc"` but uses `.passthrough()` and `z.record(z.unknown())` for content items, allowing arbitrary nested objects with no depth limit beyond the 5MB Express body limit.
- **Evidence:** `packages/shared/src/schemas.ts:16-21` — `.passthrough()` on the doc schema
- **Found by:** Security & Code Quality

### [F-26] Global error handler over-generalizes 4xx errors
- **Category:** 20 (Weak error handling strategy)
- **Impact:** Low
- **Explanation:** The fallback error handler maps all 4xx errors to `VALIDATION_ERROR`, even though route handlers use specific codes. In practice, route handlers send their own responses first, so this only catches unexpected errors.
- **Evidence:** `app.ts:40` — `const code = status < 500 ? "VALIDATION_ERROR" : "INTERNAL_ERROR"`
- **Found by:** Error Handling & Observability

### [F-27] Route handlers don't log 4xx errors
- **Category:** 34 (Inconsistent error/logging conventions)
- **Impact:** Low
- **Explanation:** The global error handler logs with `console.error`, but route-level 400/404 responses send JSON directly without logging. No way to track validation error frequency.
- **Evidence:** `projects.ts:27-30`, `chapters.ts:39-44` — responses sent without logging. `app.ts:38` — global handler logs.
- **Found by:** Error Handling & Observability

## Coverage Checklist

### Flaw/Risk Types 1-34
| # | Type | Status | Finding |
|---|------|--------|---------|
| 1 | Global mutable state | Observed | #F-16 |
| 2 | God object | Observed | #F-4, #F-14 |
| 3 | Tight coupling | Observed | #F-17 |
| 4 | High/unstable dependencies | Not observed | — |
| 5 | Circular dependencies | Not observed | — |
| 6 | Leaky abstractions | Observed | #F-6, #F-20 |
| 7 | Over-abstraction | Not observed | — |
| 8 | Premature optimization | Not observed | — |
| 9 | Shotgun surgery | Observed | #F-5, #F-15 |
| 10 | Feature envy / anemic domain model | Not observed | — |
| 11 | Low cohesion | Not observed | — |
| 12 | Hidden side effects | Not assessed | — |
| 13 | Inconsistent boundaries | Not observed | — |
| 14 | Distributed monolith | Not applicable | Single-service monolith |
| 15 | Chatty service calls | Not applicable | Single-service monolith |
| 16 | Synchronous-only integration | Not applicable | Single-service monolith |
| 17 | No clear ownership of data | Not observed | — |
| 18 | Shared database across services | Not applicable | Single-service monolith |
| 19 | Lack of idempotency | Observed | #F-24 |
| 20 | Weak error handling strategy | Observed | #F-3, #F-12, #F-26 |
| 21 | No observability plan | Observed | #F-10 |
| 22 | Configuration sprawl | Observed | #F-23 |
| 23 | Dependency injection misuse | Not observed | — |
| 24 | Inconsistent API contracts | Observed | #F-21 |
| 25 | Business logic in the UI | Not assessed | — |
| 26 | Poor transactional boundaries | Observed | #F-18, #F-19 |
| 27 | Temporal coupling | Observed | #F-7, #F-16 |
| 28 | Magic numbers/strings everywhere | Observed | #F-8, #F-9, #F-22 |
| 29 | "Utility" dumping ground | Not observed | — |
| 30 | Security as an afterthought | Observed | #F-13, #F-25 |
| 31 | Dead code / unused dependencies | Not observed | — |
| 32 | Missing or inadequate test coverage for critical paths | Observed | #F-1, #F-2 |
| 33 | Hard-coded credentials or secrets in source | Not observed | — |
| 34 | Inconsistent error/logging conventions | Observed | #F-11, #F-27 |

### Strength Categories S1-S14
| # | Category | Status | Finding |
|---|----------|--------|---------|
| S1 | Clear modular boundaries | Observed | #S-1 |
| S2 | High cohesion | Observed | #S-17 |
| S3 | Loose coupling | Observed | #S-8 |
| S4 | Dependency direction is stable | Observed | #S-1 |
| S5 | Dependency management hygiene | Observed | #S-19 |
| S6 | Consistent API contracts | Observed | #S-4 |
| S7 | Robust error handling | Observed | #S-11, #S-14 |
| S8 | Observability present | Observed | #S-15 (user-facing only) |
| S9 | Configuration discipline | Observed | #S-12 |
| S10 | Security built-in | Observed | #S-5, #S-6, #S-7 |
| S11 | Testability & coverage | Observed | #S-9, #S-10, #S-16 |
| S12 | Resilience patterns | Observed | #S-3 |
| S13 | Domain modeling strength | Observed | #S-13 |
| S14 | Simple, pragmatic abstractions | Observed | #S-2, #S-18 |

## Hotspots

1. **`packages/client/src/pages/EditorPage.tsx`** — At 668 lines, this is the largest file and the orchestration nexus. It owns keyboard shortcuts, view mode switching, title editing, sidebar resize, and the manual `flushSave` temporal coupling. Highest growth risk.
2. **`packages/server/src/routes/projects.ts`** — At 456 lines, this is the largest server file with inconsistent transaction usage (some multi-table ops wrapped, others not) and duplicated error envelope construction.
3. **`packages/server/src/routes/parseChapterContent.ts`** — A 10-line file with outsized impact: silently swallows corrupted content (F-3) and leaks storage details to every route handler (F-6).

## Next Questions

1. What happens to in-progress editing if the SQLite database becomes corrupted or the file is locked — does the localStorage cache provide enough recovery surface?
2. The chapter status system has three independent sources of truth (Zod enum, DB table, STATUS_COLORS) — was there a specific reason the DB table was introduced alongside the Zod enum, or could one derive from the other?
3. How large can a single chapter's TipTap JSON realistically grow for a book-length work, and does the 5MB body limit combined with the permissive schema pose practical risks?
4. CLAUDE.md describes e2e tests for save-failure recovery via network interception — is this planned work or was the spec written aspirationally?
5. Is there a plan for server-side observability beyond console output, particularly for diagnosing save pipeline issues in the Docker deployment?

## Analysis Metadata

- **Agents dispatched:** Structure & Boundaries, Coupling & Dependencies, Integration & Data, Error Handling & Observability, Security & Code Quality, Verifier
- **Scope:** Full repository (71 source files across packages/shared, packages/server, packages/client, e2e/)
- **Raw findings:** 53 (21 strengths + 32 flaws)
- **Verified findings:** 46 (19 strengths + 27 flaws)
- **Filtered out:** 7 (4 dropped as non-issues, 3 merged with related findings)
- **By impact:** 3 high flaws, 10 medium flaws, 14 low flaws; 10 high strengths, 9 medium strengths
- **Steering files consulted:** CLAUDE.md, docs/plans/mvp.md (referenced)
