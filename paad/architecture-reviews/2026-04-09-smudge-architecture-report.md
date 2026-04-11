# Architecture Report -- smudge

**Date:** 2026-04-09
**Commit:** 58a84c14048564060caab3b009deb8fc3ea9091a
**Languages:** TypeScript (frontend + backend + shared)
**Key directories:** `packages/shared/`, `packages/server/`, `packages/client/`, `e2e/`
**Scope:** Full repository

## Repo Overview

Smudge is a single-user web-based writing application for long-form fiction and non-fiction. It is organized as an npm workspaces monorepo with three packages: `shared` (types, schemas, utilities), `server` (Express + better-sqlite3 + Knex), and `client` (React + TipTap + Tailwind). Architecture follows Routes -> Services -> Repositories layering. 121 source files (medium scope), 5 server domain modules, actively in MVP development.

## Strengths

### [S-01] Consistent four-file domain modules
- **Category:** S1 -- Clear modular boundaries
- **Impact:** High
- **Explanation:** Every server domain (projects, chapters, velocity, settings, chapter-statuses) consistently has `routes.ts`, `service.ts`, `repository.ts`, and `types.ts`. No module skips a layer. Routes call services, services call repositories, repositories own SQL.
- **Evidence:** `packages/server/src/projects/`, `packages/server/src/chapters/`, `packages/server/src/velocity/`, `packages/server/src/settings/`, `packages/server/src/chapter-statuses/` -- all follow the same pattern
- **Found by:** Structure & Boundaries

### [S-02] Shared package as stable dependency root
- **Category:** S4 -- Dependency direction is stable
- **Impact:** High
- **Explanation:** The shared package exports Zod schemas, TypeScript interfaces, and pure utilities (`countWords`, `generateSlug`). Both server and client depend on `@smudge/shared`; shared depends on neither. Exports are explicit and curated -- no wildcard re-exports.
- **Evidence:** `packages/shared/src/index.ts` (27 lines) -- named exports only
- **Found by:** Structure & Boundaries, Coupling & Dependencies

### [S-03] Stable dependency direction: routes -> services -> repositories
- **Category:** S4 -- Dependency direction is stable
- **Impact:** High
- **Explanation:** Dependencies flow strictly downward across all five domain modules. No repository imports a service. No route file imports a repository directly. This is consistent and well-enforced.
- **Evidence:** Verified across all server domain modules -- routes import services, services import repositories
- **Found by:** Coupling & Dependencies

### [S-04] Transaction-agnostic repository signatures
- **Category:** S3 -- Loose coupling
- **Impact:** High
- **Explanation:** Every repository function accepts `Knex.Transaction | Knex` as the first parameter, letting callers decide the transaction boundary. Repositories never call `getDb()` themselves.
- **Evidence:** `packages/server/src/chapters/chapters.repository.ts:51` and pattern throughout all repositories
- **Found by:** Coupling & Dependencies

### [S-05] Consistent error envelope and Zod validation
- **Category:** S6 -- Consistent API contracts
- **Impact:** High
- **Explanation:** Every API endpoint returns errors in a uniform `{ error: { code, message } }` envelope. All input validation uses shared Zod schemas. Error codes are specific and machine-readable (NOT_FOUND, VALIDATION_ERROR, PROJECT_TITLE_EXISTS, CORRUPT_CONTENT, REORDER_MISMATCH, etc.). The global error handler normalizes unhandled errors to the same shape.
- **Evidence:** `packages/server/src/app.ts:46-58` (global handler), all route files use `res.status(N).json({ error: { code, message } })`
- **Found by:** Integration & Data, Error Handling & Observability

### [S-06] Shared types prevent client/server contract drift
- **Category:** S6 -- Consistent API contracts
- **Impact:** High
- **Explanation:** The `@smudge/shared` package defines both Zod schemas (runtime) and TypeScript interfaces (compile-time) imported by both server and client. Schema changes automatically flag mismatches at compile time in both packages.
- **Evidence:** `packages/shared/src/types.ts`, `packages/shared/src/schemas.ts` -- client's `api/client.ts` imports types from shared
- **Found by:** Integration & Data

### [S-07] Auto-save with retry, backoff, and local cache
- **Category:** S12 -- Resilience patterns
- **Impact:** High
- **Explanation:** The save pipeline retries up to 3 times with exponential backoff (2s/4s/8s), breaks early on 4xx (no point retrying validation), maintains localStorage cache of unsaved content, shows persistent error state on total failure, and uses sequence counters to cancel stale retries on chapter switch.
- **Evidence:** `packages/client/src/hooks/useProjectEditor.ts:67-123` -- `BACKOFF_MS`, `MAX_RETRIES`, `setCachedContent`
- **Found by:** Integration & Data, Error Handling & Observability

### [S-08] Best-effort velocity never blocks saves
- **Category:** S12 -- Resilience patterns
- **Impact:** High
- **Explanation:** Velocity tracking (save events, daily snapshots) is explicitly best-effort. Failures in velocity recording never propagate to the save response -- the user's content is always persisted first within the transaction.
- **Evidence:** `packages/server/src/chapters/chapters.service.ts:98-105` -- try/catch with comment "Velocity tracking is best-effort; save must still succeed"
- **Found by:** Integration & Data

### [S-09] Comprehensive error taxonomy in routes
- **Category:** S7 -- Robust error handling
- **Impact:** High
- **Explanation:** Chapter routes handle 7 distinct error codes (NOT_FOUND, UPDATE_READ_FAILURE, VALIDATION_ERROR, CORRUPT_CONTENT, PROJECT_PURGED, RESTORE_CONFLICT, RESTORE_READ_FAILURE). Project routes add PROJECT_TITLE_EXISTS, REORDER_MISMATCH, READ_AFTER_CREATE_FAILURE. Every error path is explicitly handled.
- **Evidence:** `packages/server/src/chapters/chapters.routes.ts:1-129`, `packages/server/src/projects/projects.routes.ts`
- **Found by:** Error Handling & Observability

### [S-10] Content corruption detection and safe handling
- **Category:** S7 -- Robust error handling
- **Impact:** High
- **Explanation:** When stored chapter content fails JSON.parse, it is logged, content is set to null, and a `content_corrupt` flag is set. The service layer propagates this as a typed sentinel to routes, which return a 500 with CORRUPT_CONTENT. This prevents a malformed row from crashing the app.
- **Evidence:** `packages/server/src/chapters/chapters.repository.ts:13-25` (`parseContent`)
- **Found by:** Error Handling & Observability

### [S-11] Helmet with strict CSP
- **Category:** S10 -- Security built-in
- **Impact:** High
- **Explanation:** Helmet configured with `defaultSrc: ['self']`, `scriptSrc: ['self']`, `objectSrc: ['none']`, `frameAncestors: ['none']`. Only `styleSrc` allows `'unsafe-inline'` (typical for CSS-in-JS/Tailwind).
- **Evidence:** `packages/server/src/app.ts:20-34`
- **Found by:** Security & Code Quality

### [S-12] Zod validation on all write endpoints
- **Category:** S10 -- Security built-in
- **Impact:** High
- **Explanation:** Every mutation endpoint validates input through Zod schemas with field-level constraints (min, max, regex, uuid). TipTapDocSchema validates document structure before acceptance.
- **Evidence:** `packages/shared/src/schemas.ts:1-71` -- CreateProjectSchema, UpdateProjectSchema, UpdateChapterSchema, etc.
- **Found by:** Security & Code Quality

### [S-13] DOMPurify sanitization of generated HTML
- **Category:** S10 -- Security built-in
- **Impact:** High
- **Explanation:** The only `dangerouslySetInnerHTML` usage is wrapped in `DOMPurify.sanitize()`. Defense-in-depth even though the source HTML comes from Zod-validated TipTap JSON.
- **Evidence:** `packages/client/src/components/PreviewMode.tsx:76`
- **Found by:** Security & Code Quality

### [S-14] Parameterized queries throughout
- **Category:** S10 -- Security built-in
- **Impact:** High
- **Explanation:** All database access uses Knex query builder (auto-parameterized) or `db.raw()` with `?` placeholders. No string concatenation in SQL anywhere.
- **Evidence:** `packages/server/src/velocity/velocity.repository.ts:30-35` and all repository files
- **Found by:** Security & Code Quality

### [S-15] Integration tests against real SQLite with coverage enforcement
- **Category:** S11 -- Testability & coverage
- **Impact:** High
- **Explanation:** Server tests use in-memory SQLite with real migrations, not mocks. Coverage thresholds enforced at 95% statements, 85% branches, 90% functions, 95% lines in root `vitest.config.ts`.
- **Evidence:** `vitest.config.ts:19-24`, server test files use `initDb()` with in-memory config
- **Found by:** Security & Code Quality

### [S-16] Velocity module -- high cohesion with DI seam
- **Category:** S2 -- High cohesion
- **Impact:** Medium
- **Explanation:** All velocity concerns are grouped in one module. Pure functions (`deriveSessions`, `calculateStreaks`, `calculateProjection`) are separated from I/O operations. The injectable pattern (21 lines, no framework) cleanly isolates velocity side-effects for testing.
- **Evidence:** `packages/server/src/velocity/velocity.injectable.ts` (21 lines), `velocity.service.ts`
- **Found by:** Structure & Boundaries, Coupling & Dependencies, Security & Code Quality

### [S-17] Typed return sentinels in services
- **Category:** S13 -- Domain modeling strength
- **Impact:** Medium
- **Explanation:** `updateChapter` returns a discriminated union encoding all outcomes: `{ chapter } | { validationError } | { corrupt } | null | "read_after_update_failure"`. Routes can exhaustively match. `restoreChapter` uses the same pattern.
- **Evidence:** `packages/server/src/chapters/chapters.service.ts:45-54`
- **Found by:** Structure & Boundaries

### [S-18] Client API module -- thin typed wrapper
- **Category:** S14 -- Simple, pragmatic abstractions
- **Impact:** Medium
- **Explanation:** The `api` object provides a single `apiFetch<T>` generic with `ApiRequestError` and typed methods mapping to REST endpoints. No framework, no abstraction beyond what's needed.
- **Evidence:** `packages/client/src/api/client.ts` (149 lines)
- **Found by:** Structure & Boundaries

### [S-19] Optimistic UI with server-verified revert
- **Category:** S12 -- Resilience patterns
- **Impact:** Medium
- **Explanation:** Status changes apply optimistically for snappy UX, then verify with the server. On failure, the handler re-fetches from the server for authoritative state rather than reverting to potentially-stale local state.
- **Evidence:** `packages/client/src/hooks/useProjectEditor.ts:252-323`
- **Found by:** Integration & Data

### [S-20] Graceful shutdown with timeout
- **Category:** S7 -- Robust error handling
- **Impact:** Medium
- **Explanation:** SIGTERM/SIGINT handlers drain connections, close the DB, and force-exit after 10s. SQLite I/O errors get specific diagnostic messaging at startup.
- **Evidence:** `packages/server/src/index.ts:54-84`
- **Found by:** Error Handling & Observability

### [S-21] Settings key allowlist
- **Category:** S10 -- Security built-in
- **Impact:** Medium
- **Explanation:** The settings service validates both keys and values. Unknown keys are rejected. Known keys (currently only `timezone`) have custom validators (`isValidTimezone`).
- **Evidence:** `packages/server/src/settings/settings.service.ts:5-7`
- **Found by:** Security & Code Quality

### [S-22] WAL mode and foreign keys enabled
- **Category:** S10 -- Security built-in
- **Impact:** Medium
- **Explanation:** Database initialization enables WAL journal mode (crash safety) and foreign key enforcement, including in test `setDb()` paths.
- **Evidence:** `packages/server/src/db/connection.ts:28-29`
- **Found by:** Security & Code Quality

### [S-23] Minimal, validated configuration
- **Category:** S9 -- Configuration discipline
- **Impact:** Medium
- **Explanation:** Only two env vars (`SMUDGE_PORT`, `DB_PATH`), both validated with sensible defaults. No configuration sprawl.
- **Evidence:** `packages/server/src/index.ts:6-11`, `packages/server/src/db/knexfile.ts:11`
- **Found by:** Error Handling & Observability

### [S-24] Generic 500 error messages / JSON body size limit
- **Category:** S10 -- Security built-in
- **Impact:** Medium
- **Explanation:** Internal error messages are masked for 500-level responses. JSON body limited to 5mb. Prevents information leakage and payload abuse.
- **Evidence:** `packages/server/src/app.ts:35,54-57`
- **Found by:** Security & Code Quality

### [S-25] String externalization
- **Category:** S2 -- High cohesion
- **Impact:** Medium
- **Explanation:** All UI strings organized by feature domain in a single `STRINGS` constant with `as const`. Components import consistently. Prepares for i18n.
- **Evidence:** `packages/client/src/strings.ts`
- **Found by:** Structure & Boundaries

## Flaws/Risks

### [F-01] EditorPage god component
- **Category:** 2 -- God object
- **Impact:** High
- **Explanation:** At 859 lines with 20+ state variables, 12+ refs, and 5+ useEffect hooks, EditorPage orchestrates sidebar, view mode switching, title editing, keyboard shortcuts, trash view, confirmation dialogs, settings dialogs, velocity data, word count announcements, and navigation announcements. Heavy business logic is extracted to `useProjectEditor`, but this component remains the largest and most complex single file.
- **Evidence:** `packages/client/src/pages/EditorPage.tsx:64-99` -- 19 state/ref declarations in sequence. `handleKeyDown` effect (lines 276-353) is 77 lines.
- **Found by:** Structure & Boundaries
- **Status:** Fixed
- **Status reason:** Extracted 5 hooks (useSidebarState, useChapterTitleEditing, useProjectTitleEditing, useTrashManager, useKeyboardShortcuts) and 1 component (ShortcutHelpDialog). EditorPage reduced from 859 to 583 lines. Each extracted module is under 140 lines with a single responsibility.
- **Status date:** 2026-04-09 12:25 UTC
- **Status commit:** 206aa2d

### [F-02] Cross-service coupling -- projects.service imports from chapters.service
- **Category:** 3 -- Tight coupling
- **Impact:** Medium
- **Explanation:** `projects.service` imports `stripCorruptFlag` directly from `chapters.service`, creating a horizontal dependency between peer services. The function is a pure data transformation that should live in a shared location, not the service layer.
- **Evidence:** `packages/server/src/projects/projects.service.ts:12` -- `import { stripCorruptFlag } from "../chapters/chapters.service"`
- **Found by:** Coupling & Dependencies

### [F-03] Velocity service has wide fan-out coupling
- **Category:** 3 -- Tight coupling
- **Impact:** Medium
- **Explanation:** `velocity.service` imports 5 repositories from 5 sibling domains (velocity, settings, chapter-statuses, chapters, projects). Changes to any of these repositories could break velocity. While the aggregate read nature of the velocity dashboard explains the coupling, it makes this the most coupled module in the server.
- **Evidence:** `packages/server/src/velocity/velocity.service.ts:3-7` -- imports VelocityRepo, SettingsRepo, ChapterStatusRepo, ChapterRepo, ProjectRepo
- **Found by:** Coupling & Dependencies

### [F-04] Leaky discriminated union from service to route
- **Category:** 6 -- Leaky abstractions
- **Impact:** Medium
- **Explanation:** Routes must check for `null`, `"read_after_update_failure"`, `{ validationError }`, `{ corrupt }`, and `{ chapter }` from `updateChapter()`, and similar multi-variant returns from `restoreChapter()`. The service's internal result taxonomy leaks into the route layer via stringly-typed sentinels rather than a `Result` type or error-class pattern.
- **Evidence:** `packages/server/src/chapters/chapters.routes.ts:43-66` -- checks `"validationError" in result`, `"corrupt" in result`, `result === "read_after_update_failure"`
- **Found by:** Coupling & Dependencies

### [F-05] Inconsistent boundaries -- chapter creation in projects.service
- **Category:** 13 -- Inconsistent boundaries
- **Impact:** Medium
- **Explanation:** `createChapter()` lives in projects.service, not chapters.service. All other chapter mutations (update, delete, restore) live in chapters.service. The placement is driven by URL structure (chapters created under a project slug), but creates a surprising split in where chapter business logic lives.
- **Evidence:** `packages/server/src/projects/projects.service.ts:198-232` imports from ChapterRepo and chapters.service
- **Found by:** Structure & Boundaries

### [F-06] Shotgun surgery -- adding a new chapter status
- **Category:** 9 -- Shotgun surgery
- **Impact:** Medium
- **Explanation:** Adding a new chapter status requires changes in 4+ files across 3 packages: `ChapterStatus` enum in schemas.ts, `CompletionThreshold` enum in schemas.ts (duplicated values), `STATUS_COLORS` in statusColors.ts, seed migration for `chapter_statuses` table, and potentially strings.ts. The two Zod enums are independent declarations of the same concept.
- **Evidence:** `packages/shared/src/schemas.ts:5` and `schemas.ts:12` -- identical but separate enum definitions. `packages/client/src/statusColors.ts` -- hardcoded status keys.
- **Found by:** Structure & Boundaries, Error Handling & Observability

### [F-07] No structured logging or observability
- **Category:** 21 -- No observability plan
- **Impact:** Medium
- **Explanation:** All logging is bare `console.error`/`console.log`/`console.warn` with no structure. No log levels, no request correlation IDs, no metrics, no health check beyond `{ status: "ok" }`. For a single-user app this is acceptable but limits production debugging.
- **Evidence:** `packages/server/src/app.ts:53` -- `console.error(err)`. `packages/server/src/velocity/velocity.service.ts:222-226` -- unstructured strings
- **Found by:** Error Handling & Observability

### [F-08] Velocity errors silently swallowed at multiple layers
- **Category:** 20 -- Weak error handling strategy
- **Impact:** Medium
- **Explanation:** `recordSave` has three layers of try/catch that only `console.error` and continue. The caller in `chapters.service` catches velocity errors silently. Best-effort is the correct design, but persistent failures (e.g., disk full) produce console noise with no alerting mechanism. The two inner operations (`insertSaveEvent`, `upsertDailySnapshot`) run as independent writes without a shared transaction, so partial failures create inconsistent velocity data.
- **Evidence:** `packages/server/src/velocity/velocity.service.ts:215-235` (3 nested try/catch), `packages/server/src/chapters/chapters.service.ts:98-105`
- **Found by:** Error Handling & Observability, Integration & Data

### [F-09] STATUS_COLORS duplicates status knowledge
- **Category:** 28 -- Magic numbers/strings everywhere
- **Impact:** Medium
- **Explanation:** The client hardcodes `"outline"`, `"rough_draft"`, `"revised"`, `"edited"`, `"final"` as magic string keys in `statusColors.ts`. If a status is added/renamed on the server, this map silently falls back to a generic color with no compile-time or runtime warning.
- **Evidence:** `packages/client/src/statusColors.ts:1-7` -- hardcoded status-to-color mapping
- **Found by:** Error Handling & Observability

### [F-10] No UUID validation on route parameters
- **Category:** 30 -- Security as an afterthought
- **Impact:** Low
- **Explanation:** Chapter IDs from `req.params.id` are passed directly to database queries without UUID format validation. Arbitrary strings travel to the DB layer (returning 404), though no injection is possible due to parameterized queries. `ReorderChaptersSchema` validates UUIDs, but individual route params don't.
- **Evidence:** `packages/server/src/chapters/chapters.routes.ts:11` -- `const id = req.params.id as string`
- **Found by:** Security & Code Quality

### [F-11] Dead backward-compat query helpers
- **Category:** 31 -- Dead code / unused dependencies
- **Impact:** Low
- **Explanation:** `queryChapter()` and `queryChapters()` are exported with the comment "Backward-compat query helpers (used by existing tests)" but are only imported in one test file. No production code uses them.
- **Evidence:** `packages/server/src/chapters/chapters.repository.ts:32-46`
- **Found by:** Security & Code Quality

### [F-12] Client-side .catch(() => {}) patterns
- **Category:** 20 -- Weak error handling strategy
- **Impact:** Low
- **Explanation:** Several fire-and-forget operations use `.catch(() => {})` which completely swallows errors -- not even console.error. While these are intentionally non-blocking operations, they provide zero feedback for debugging.
- **Evidence:** `packages/client/src/pages/EditorPage.tsx:795`, `packages/client/src/components/Editor.tsx:80`
- **Found by:** Error Handling & Observability

### [F-13] Sidebar magic numbers duplicate EditorPage constants
- **Category:** 28 -- Magic numbers/strings everywhere
- **Impact:** Low
- **Explanation:** Sidebar resize uses inline `180`/`480` min/max values that duplicate `SIDEBAR_MIN_WIDTH`/`SIDEBAR_MAX_WIDTH` constants defined in EditorPage.tsx. If limits change in one place but not the other, behavior diverges.
- **Evidence:** `packages/client/src/components/Sidebar.tsx:472-482` vs `packages/client/src/pages/EditorPage.tsx:20-21`
- **Found by:** Error Handling & Observability

### [F-14] Temporal coupling -- getDb() requires prior initDb()
- **Category:** 27 -- Temporal coupling
- **Impact:** Low
- **Explanation:** `getDb()` throws if called before `initDb()`. Nothing in the type system guarantees initialization order. In production this is safe due to linear startup, but in tests it relies on `beforeAll` hooks.
- **Evidence:** `packages/server/src/db/connection.ts:6-9`
- **Found by:** Coupling & Dependencies

### [F-15] Global mutable state -- Database singleton
- **Category:** 1 -- Global mutable state
- **Impact:** Low
- **Explanation:** `let db: Knex | undefined` is module-level mutable state. Standard pattern for server singletons, well-managed with init/close lifecycle, but prevents parallel test suites against different DB instances.
- **Evidence:** `packages/server/src/db/connection.ts:4`
- **Found by:** Structure & Boundaries

## Coverage Checklist

### Flaw/Risk Types 1-34
| # | Type | Status | Finding |
|---|------|--------|---------|
| 1 | Global mutable state | Observed | #F-15 |
| 2 | God object | Observed | #F-01 |
| 3 | Tight coupling | Observed | #F-02, #F-03 |
| 4 | High/unstable dependencies | Not observed | -- |
| 5 | Circular dependencies | Not observed | -- |
| 6 | Leaky abstractions | Observed | #F-04 |
| 7 | Over-abstraction | Not observed | -- |
| 8 | Premature optimization | Not observed | -- |
| 9 | Shotgun surgery | Observed | #F-06 |
| 10 | Feature envy / anemic domain model | Not observed | -- |
| 11 | Low cohesion | Not observed | -- |
| 12 | Hidden side effects | Not observed | -- |
| 13 | Inconsistent boundaries | Observed | #F-05 |
| 14 | Distributed monolith | Not applicable | Single-process monolith |
| 15 | Chatty service calls | Not applicable | Single-process monolith |
| 16 | Synchronous-only integration | Not applicable | Single-process monolith |
| 17 | No clear ownership of data | Not observed | -- |
| 18 | Shared database across services | Not applicable | Single-process monolith |
| 19 | Lack of idempotency | Not observed | -- |
| 20 | Weak error handling strategy | Observed | #F-08, #F-12 |
| 21 | No observability plan | Observed | #F-07 |
| 22 | Configuration sprawl | Not observed | -- |
| 23 | Dependency injection misuse | Not observed | -- |
| 24 | Inconsistent API contracts | Not observed | -- |
| 25 | Business logic in the UI | Not observed | -- |
| 26 | Poor transactional boundaries | Not observed | -- |
| 27 | Temporal coupling | Observed | #F-14 |
| 28 | Magic numbers/strings everywhere | Observed | #F-09, #F-13 |
| 29 | "Utility" dumping ground | Not observed | -- |
| 30 | Security as an afterthought | Observed | #F-10 |
| 31 | Dead code / unused dependencies | Observed | #F-11 |
| 32 | Missing or inadequate test coverage for critical paths | Not observed | -- |
| 33 | Hard-coded credentials or secrets in source | Not observed | -- |
| 34 | Inconsistent error/logging conventions across services | Not observed | Subsumed by #F-07 |

### Strength Categories S1-S14
| # | Category | Status | Finding |
|---|----------|--------|---------|
| S1 | Clear modular boundaries | Observed | #S-01 |
| S2 | High cohesion | Observed | #S-16, #S-25 |
| S3 | Loose coupling | Observed | #S-04 |
| S4 | Dependency direction is stable | Observed | #S-02, #S-03 |
| S5 | Dependency management hygiene | Observed | #S-02 |
| S6 | Consistent API contracts | Observed | #S-05, #S-06 |
| S7 | Robust error handling | Observed | #S-09, #S-10, #S-20 |
| S8 | Observability present | Not observed | -- |
| S9 | Configuration discipline | Observed | #S-23 |
| S10 | Security built-in | Observed | #S-11, #S-12, #S-13, #S-14, #S-21, #S-22, #S-24 |
| S11 | Testability & coverage | Observed | #S-15 |
| S12 | Resilience patterns | Observed | #S-07, #S-08, #S-19 |
| S13 | Domain modeling strength | Observed | #S-17 |
| S14 | Simple, pragmatic abstractions | Observed | #S-16, #S-18 |

## Hotspots

1. **`packages/client/src/pages/EditorPage.tsx`** -- 859-line god component orchestrating 20+ state variables. Most likely file to grow unmanageably as features are added.
2. **`packages/server/src/velocity/velocity.service.ts`** -- Widest coupling fan-out (5 repositories). Best-effort error handling with 3 nested try/catch layers. Magic numbers for time windows.
3. **`packages/server/src/projects/projects.service.ts`** -- Boundary confusion: hosts chapter creation, dashboard aggregation, and reorder logic alongside project CRUD. Imports from chapters.service (peer coupling).

## Next Questions

1. Should `EditorPage.tsx` be decomposed into smaller view-mode components (editor, preview, dashboard, settings), each owning their own state?
2. Would a `Result<T, E>` type or error-class hierarchy replace the stringly-typed service return sentinels and reduce route-layer complexity?
3. Can `ChapterStatus` be defined once (e.g., derived from the DB seed or a single shared constant) to eliminate the shotgun surgery across schemas.ts, statusColors.ts, and migrations?
4. Is structured logging worth adding now (e.g., pino), or is `console.*` sufficient until multi-user or cloud deployment is considered?
5. Should `createChapter` move from projects.service to chapters.service to consolidate all chapter mutations in one module?

## Analysis Metadata

- **Agents dispatched:** Structure & Boundaries, Coupling & Dependencies, Integration & Data, Error Handling & Observability, Security & Code Quality, Verifier
- **Scope:** Full repository (121 source files across 3 packages)
- **Raw findings:** 53 (25 strengths, 28 flaws)
- **Verified findings:** 40 (25 strengths, 15 flaws)
- **Filtered out:** 13 (false positives, below threshold, subsumed)
- **By impact:** 15 high strengths + 1 high flaw, 10 medium strengths + 8 medium flaws, 6 low flaws
- **Steering files consulted:** CLAUDE.md, docs/plans/mvp.md
