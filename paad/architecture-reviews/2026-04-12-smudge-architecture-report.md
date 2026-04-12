# Architecture Report -- smudge

**Date:** 2026-04-12
**Commit:** 30239a0c936a8bf6f74e1ca3a3ccf9d107a48a86
**Languages:** TypeScript (frontend + backend + shared)
**Key directories:** `packages/shared/`, `packages/server/`, `packages/client/`, `e2e/`
**Scope:** Full repository

## Repo Overview

Smudge is a single-user web-based writing application for long-form fiction and non-fiction, organized as projects containing chapters. It is a monorepo with three npm workspace packages (shared, server, client). The backend uses Express + better-sqlite3 + Knex.js; the frontend uses React + TipTap + Tailwind CSS. Architecture follows Routes -> Services -> Repositories with a ProjectStore abstraction layer. 125 source files, medium codebase. MVP in active development.

## Strengths

### [S-01] Consistent domain module structure
- **Category:** S1 (Clear modular boundaries)
- **Impact:** High
- **Explanation:** Every server domain module (projects, chapters, velocity, settings, chapter-statuses) follows an identical four-file pattern: `routes.ts`, `service.ts`, `repository.ts`, `types.ts`. Routes handle HTTP, services handle business logic and transactions, repositories encapsulate SQL.
- **Evidence:** `packages/server/src/chapters/` (`chapters.routes.ts`, `chapters.service.ts`, `chapters.repository.ts`, `chapters.types.ts`); identical pattern in all five domain modules.
- **Found by:** Structure & Boundaries

### [S-02] ProjectStore abstraction with injectable pattern
- **Category:** S3 (Loose coupling)
- **Impact:** High
- **Explanation:** The `ProjectStore` interface cleanly abstracts all data access for projects, chapters, and statuses. Services depend on the interface via `getProjectStore()`, not on concrete implementations. The injectable pattern (`setProjectStore()`) provides a clean test seam. `SqliteProjectStore` is instantiated in one place.
- **Evidence:** `packages/server/src/stores/project-store.types.ts` (30+ interface methods), `project-store.injectable.ts:18` (injection point), `sqlite-project-store.ts` (sole implementation).
- **Found by:** Structure & Boundaries, Coupling & Dependencies

### [S-03] Stable dependency direction
- **Category:** S4 (Dependency direction is stable)
- **Impact:** High
- **Explanation:** The dependency graph flows consistently: Routes -> Services -> Stores/Repositories. No repository imports a service. No route implements business logic beyond HTTP translation. The shared package is a pure leaf dependency imported by both server and client with zero reverse dependencies. No circular dependencies found.
- **Evidence:** All route files import only their corresponding service; all services import only store/injectable; `packages/shared/` has zero imports from server or client.
- **Found by:** Coupling & Dependencies

### [S-04] Consistent API contracts
- **Category:** S6 (Consistent API contracts)
- **Impact:** High
- **Explanation:** Every endpoint returns errors in the `{ error: { code: "MACHINE_READABLE", message: "Human-readable" } }` envelope. HTTP status codes are correctly applied (201 for creation, 200 for reads/updates, 400 for validation, 404 for not-found, 409 for conflicts, 500 for server errors). Zod schemas in `@smudge/shared` validate all write endpoints, ensuring client-server contract alignment.
- **Evidence:** `packages/server/src/app.ts:46-58` (global error handler), `packages/shared/src/schemas.ts` (shared Zod schemas), all route files return consistent error envelopes.
- **Found by:** Integration & Data

### [S-05] Typed error taxonomy with discriminated unions
- **Category:** S7 (Robust error handling)
- **Impact:** High
- **Explanation:** Services use custom error classes (`ParentPurgedError`, `ChapterPurgedError`, `ProjectTitleExistsError`) caught explicitly in route handlers. Service functions return discriminated unions (e.g., `{ chapter } | { validationError } | { corrupt } | null | "read_after_update_failure"`) that force exhaustive handling at the route level. The double-restore race is handled gracefully with an `alreadyActive` check.
- **Evidence:** `packages/server/src/chapters/chapters.service.ts:19-31` (error classes), `chapters.service.ts:58-67` (discriminated union return), `chapters.service.ts:186-189` (idempotent restore).
- **Found by:** Error Handling & Observability

### [S-06] Best-effort velocity side effects with error isolation
- **Category:** S7 (Robust error handling)
- **Impact:** High
- **Explanation:** Velocity tracking calls (`recordSave`, `updateDailySnapshot`) are wrapped in try/catch after the main save transaction completes, with structured `console.error` output including project_id and chapter_id context. The comment "best-effort -- must not break the save" documents the intent. Velocity failures never break the save pipeline.
- **Evidence:** `packages/server/src/chapters/chapters.service.ts:107-119` (try/catch with context logging), same pattern at lines 150-158 and 234-242.
- **Found by:** Error Handling & Observability

### [S-07] Client-side save retry with exponential backoff
- **Category:** S7 (Robust error handling)
- **Impact:** High
- **Explanation:** The auto-save handler implements 3 retries with 2s/4s/8s backoff, early exit on 4xx errors, and sequence-number guards (`saveSeqRef`) that abort stale retries when the user switches chapters. A localStorage content cache (`useContentCache`) persists unsaved content until the server confirms receipt, preventing data loss on save failure.
- **Evidence:** `packages/client/src/hooks/useProjectEditor.ts:60-111` (`BACKOFF_MS = [2000, 4000, 8000]`, `MAX_RETRIES = 3`), `packages/client/src/hooks/useContentCache.ts` (localStorage persistence).
- **Found by:** Error Handling & Observability

### [S-08] Content Security Policy via Helmet
- **Category:** S10 (Security built-in)
- **Impact:** High
- **Explanation:** Helmet is configured with a restrictive CSP: `default-src: 'self'`, `object-src: 'none'`, `frame-ancestors: 'none'`. The only relaxation is `'unsafe-inline'` for styles, which is needed for TipTap/Tailwind.
- **Evidence:** `packages/server/src/app.ts:20-34` (Helmet configuration).
- **Found by:** Security & Code Quality

### [S-09] No SQL injection vectors
- **Category:** S10 (Security built-in)
- **Impact:** High
- **Explanation:** Every `db.raw()` call uses parameterized placeholders (`?`). All other queries use Knex's query builder with object-based `where` clauses. No string interpolation into SQL anywhere in application code.
- **Evidence:** All repository files (`chapters.repository.ts`, `projects.repository.ts`, `velocity.repository.ts`, `settings.repository.ts`) -- parameterized queries throughout.
- **Found by:** Security & Code Quality

### [S-10] DOMPurify sanitization on preview
- **Category:** S10 (Security built-in)
- **Impact:** High
- **Explanation:** The only use of `dangerouslySetInnerHTML` in the codebase passes HTML through `DOMPurify.sanitize()` first. Defense-in-depth even though the content source (TipTap JSON) is trusted.
- **Evidence:** `packages/client/src/components/PreviewMode.tsx:3,76`.
- **Found by:** Security & Code Quality

### [S-11] Strong test infrastructure
- **Category:** S11 (Testability & coverage)
- **Impact:** High
- **Explanation:** Coverage thresholds enforced at 95/85/90/95 (statements/branches/functions/lines). Integration tests run against real in-memory SQLite with real migrations (no mocks). E2e tests cover the save pipeline including network failure recovery via route interception. aXe accessibility audits are integrated into Playwright e2e tests. The injectable store pattern provides clean test seams.
- **Evidence:** `vitest.config.ts` (thresholds), `packages/server/src/db/knexfile.ts:21-31` (`createTestKnexConfig`), `e2e/editor-save.spec.ts` (failure recovery tests), `e2e/dashboard.spec.ts:120-151` (aXe scans).
- **Found by:** Security & Code Quality

### [S-12] Focused shared package
- **Category:** S2 (High cohesion)
- **Impact:** Medium
- **Explanation:** The shared package contains 6 single-purpose files: `wordcount.ts`, `slugify.ts`, `schemas.ts`, `types.ts`, `constants.ts`, and `index.ts` (barrel export). Each file has one reason to change.
- **Evidence:** `packages/shared/src/` -- `wordcount.ts` (25 lines, single function), `slugify.ts` (12 lines, single function).
- **Found by:** Structure & Boundaries

### [S-13] String externalization
- **Category:** S9 (Configuration discipline)
- **Impact:** Medium
- **Explanation:** All UI strings are centralized in a single `STRINGS` constant with logical grouping. No raw string literals for user-facing text in components. Dynamic strings use functions. Shared constants (e.g., `TRASH_RETENTION_DAYS`) are defined once in `@smudge/shared` and imported by both server and client.
- **Evidence:** `packages/client/src/strings.ts`, `packages/shared/src/constants.ts`.
- **Found by:** Structure & Boundaries, Error Handling & Observability, Coupling & Dependencies

### [S-14] Simple, pragmatic client API layer
- **Category:** S14 (Simple, pragmatic abstractions)
- **Impact:** Medium
- **Explanation:** The `api` object uses a single generic `apiFetch<T>` helper and organizes endpoints as a plain nested object. No class hierarchy, no middleware chain, no interceptors. `ApiRequestError` gives callers status-code discrimination.
- **Evidence:** `packages/client/src/api/client.ts`.
- **Found by:** Structure & Boundaries, Coupling & Dependencies

### [S-15] Settings whitelist validation
- **Category:** S10 (Security built-in)
- **Impact:** Medium
- **Explanation:** The settings update endpoint only accepts keys present in the `SETTING_VALIDATORS` map. Unknown keys are rejected with an error, preventing arbitrary key-value injection.
- **Evidence:** `packages/server/src/settings/settings.service.ts:5-7` (`SETTING_VALIDATORS`).
- **Found by:** Security & Code Quality

## Flaws/Risks

### [F-01] No structured logging
- **Category:** 21 (No observability plan)
- **Impact:** Medium
- **Explanation:** All server logging uses raw `console.error`/`console.log`/`console.warn`. No structured logging library, no log levels, no request IDs, no correlation between a request and its log output. The global error handler logs the error object but not the request that triggered it (method, path, params). 14 `console.error` calls across server code, none structured.
- **Evidence:** `packages/server/src/app.ts:53` (`console.error(err)` with `_req` unused), `chapters.service.ts:113-114` (velocity error logging with ad-hoc context).
- **Found by:** Error Handling & Observability

### [F-02] Client catch blocks discard error details
- **Category:** 20 (Weak error handling strategy)
- **Impact:** Medium
- **Explanation:** Multiple client-side catch blocks use bare `catch {` (no error binding) and set generic error strings from `STRINGS.error.*`. The `ApiRequestError` with status and specific message is thrown by the API client but never logged or inspected at the call site. Users see "Failed to load project" even when the server returned a specific error.
- **Evidence:** `packages/client/src/pages/HomePage.tsx:24,44,56` (bare `catch {`), `packages/client/src/hooks/useProjectEditor.ts:47` (bare `catch { setError(...) }`).
- **Found by:** Error Handling & Observability
- **Status:** Fixed
- **Status reason:** Added console.warn with error context to all catch blocks in HomePage and useProjectEditor that set error state
- **Status date:** 2026-04-12 23:18 UTC
- **Status commit:** 92f96e5

### [F-03] ProjectStore.transaction leaks Knex.Transaction
- **Category:** 6 (Leaky abstractions)
- **Impact:** Medium
- **Explanation:** The `transaction` method signature includes `trx: Knex.Transaction` as a second callback parameter, documented as an "escape hatch" for velocity/settings repos. Any code using `trx` is coupled to Knex, defeating the purpose of the `ProjectStore` interface. An alternative `ProjectStore` implementation must provide a Knex-compatible transaction object.
- **Evidence:** `packages/server/src/stores/project-store.types.ts:70` (`trx: Knex.Transaction` in signature), `velocity.service.ts:46-48` (uses raw `trx`).
- **Found by:** Coupling & Dependencies
- **Status:** Fixed
- **Status reason:** Added upsertDailySnapshot to ProjectStore interface; velocity service now uses txStore instead of raw trx; removed trx parameter from transaction callback signature
- **Status date:** 2026-04-12 23:32 UTC
- **Status commit:** a337965

### [F-04] EditorPage component complexity
- **Category:** 2 (God object)
- **Impact:** Medium
- **Explanation:** EditorPage (607 lines) orchestrates 7 hooks, manages 9 local state variables, and renders 3 view modes inline. While most business logic is extracted into hooks, the component itself is the central coordinator for nearly every user interaction. The JSX has near-duplicate layout blocks for empty-chapter and active-chapter states.
- **Evidence:** `packages/client/src/pages/EditorPage.tsx:25-89` (hook destructuring), lines 91-99 (state declarations), 607 total lines.
- **Found by:** Structure & Boundaries
- **Status:** Fixed
- **Status reason:** Extracted ActionErrorBanner, ViewModeNav, EditorFooter components; merged duplicate empty/active layouts into one (607→450 lines)
- **Status date:** 2026-04-12 23:37 UTC
- **Status commit:** 070beba

### [F-05] Dual data access paths (getDb vs getProjectStore)
- **Category:** 13 (Inconsistent boundaries)
- **Impact:** Low
- **Explanation:** Velocity and settings services use `getDb()` directly to call their repositories, while projects/chapters/chapter-statuses go through `ProjectStore`. The velocity service explicitly acknowledges this split with a code comment. This is documented as intentional (velocity/settings are "app-level concerns outside the ProjectStore boundary") but creates two different data access patterns that diverge if the storage backend changes.
- **Evidence:** `packages/server/src/velocity/velocity.service.ts:2-7` (explicit comment and `getDb()` import), `settings.service.ts:1` (`getDb()` import). Four specialists flagged this independently.
- **Found by:** Structure & Boundaries, Coupling & Dependencies, Integration & Data, Error Handling & Observability

### [F-06] stripCorruptFlag cross-service import
- **Category:** 3 (Tight coupling)
- **Impact:** Low
- **Explanation:** `projects.service.ts` imports `stripCorruptFlag` from `chapters.service.ts`, creating a sibling-to-sibling service dependency. The function strips the `content_corrupt` field from chapter rows -- a chapters-domain concern leaking into the projects service.
- **Evidence:** `packages/server/src/projects/projects.service.ts:10` (`import { stripCorruptFlag } from "../chapters/chapters.service"`), used at lines 111, 211.
- **Found by:** Structure & Boundaries, Coupling & Dependencies
- **Status:** Fixed
- **Status reason:** Moved stripCorruptFlag and isCorruptChapter to chapters.types.ts; projects.service now imports from the types module
- **Status date:** 2026-04-12 23:02 UTC
- **Status commit:** b580bef

### [F-07] chapters.service re-exports velocity injectable symbols
- **Category:** 3 (Tight coupling)
- **Impact:** Low
- **Explanation:** `chapters.service.ts` re-exports `setVelocityService` and `resetVelocityService` from the velocity injectable, creating an indirect coupling path. Consumers importing these from `chapters.service` form an unnecessary dependency chain.
- **Evidence:** `packages/server/src/chapters/chapters.service.ts:15` (`export { setVelocityService, resetVelocityService }`).
- **Found by:** Coupling & Dependencies
- **Status:** Fixed
- **Status reason:** Removed re-exports from chapters.service; tests import directly from velocity.injectable
- **Status date:** 2026-04-12 23:05 UTC
- **Status commit:** faa7df0

### [F-08] Status label enrichment repeated across services
- **Category:** 9 (Shotgun surgery)
- **Impact:** Low
- **Explanation:** The pattern of fetching chapters then attaching `status_label` via `store.getStatusLabel()` or `store.getStatusLabelMap()` is repeated in 6+ locations across two services. If the status display model changes, all locations need updating.
- **Evidence:** `chapters.service.ts:54-55`, `chapters.service.ts:130-134`, `chapters.service.ts:250-254`, `projects.service.ts:110-115`, `projects.service.ts:211-215`, `projects.service.ts:264-267`.
- **Found by:** Structure & Boundaries

### [F-09] Temporal coupling in server startup
- **Category:** 27 (Temporal coupling)
- **Impact:** Low
- **Explanation:** `initDb()` must complete before `initProjectStore()` because `initProjectStore()` calls `getDb()` internally. The ordering is enforced by sequential code in `index.ts` but not by the type system -- reordering would produce a runtime error with no compile-time warning.
- **Evidence:** `packages/server/src/index.ts:15-29` (sequential init calls), `project-store.injectable.ts:30` (`new SqliteProjectStore(getDb())`).
- **Found by:** Coupling & Dependencies
- **Status:** Fixed
- **Status reason:** initProjectStore now takes an explicit Knex parameter; dependency is enforced by the type system
- **Status date:** 2026-04-12 23:16 UTC
- **Status commit:** b9e472d

### [F-10] Global mutable singletons with set/reset functions
- **Category:** 1 (Global mutable state)
- **Impact:** Low
- **Explanation:** Three module-level mutable singletons (`let db`, `let store`, `let velocityServiceOverride`) with public setter/resetter functions. The `set*` functions are intended for test injection but are publicly importable by any module. This is the standard injectable singleton pattern for non-DI TypeScript and is reasonable for a single-user app.
- **Evidence:** `packages/server/src/db/connection.ts:4`, `stores/project-store.injectable.ts:5`, `velocity/velocity.injectable.ts:8`.
- **Found by:** Structure & Boundaries

### [F-11] AssetStore and SnapshotStore interfaces with no implementations
- **Category:** 7 (Over-abstraction)
- **Impact:** Low
- **Explanation:** Both `AssetStore` and `SnapshotStore` interfaces are defined and exported from the stores barrel but have zero implementations, zero consumers, and no corresponding database tables or migrations. Forward declarations for unbuilt features.
- **Evidence:** `packages/server/src/stores/asset-store.types.ts`, `stores/snapshot-store.types.ts`, `stores/index.ts` (exports both).
- **Found by:** Structure & Boundaries, Coupling & Dependencies
- **Status:** Fixed
- **Status reason:** Deleted asset-store.types.ts and snapshot-store.types.ts; removed exports from stores/index.ts
- **Status date:** 2026-04-12 23:06 UTC
- **Status commit:** f9584c2

### [F-12] Global error handler maps all 4xx to VALIDATION_ERROR
- **Category:** 20 (Weak error handling strategy)
- **Impact:** Low
- **Explanation:** `const code = status < 500 ? "VALIDATION_ERROR" : "INTERNAL_ERROR"` in the global handler means a 404 or 409 reaching this handler would be mislabeled. In practice, most 4xx errors are handled by route-level code with specific codes, so this fallback rarely triggers.
- **Evidence:** `packages/server/src/app.ts:54-55`.
- **Found by:** Error Handling & Observability
- **Status:** Fixed
- **Status reason:** Error handler now maps 404→NOT_FOUND, 409→CONFLICT, other 4xx→VALIDATION_ERROR, 5xx→INTERNAL_ERROR
- **Status date:** 2026-04-12 23:14 UTC
- **Status commit:** bae0811

### [F-13] Velocity snapshot recorded outside chapter-update transaction
- **Category:** 26 (Poor transactional boundaries)
- **Impact:** Low
- **Explanation:** The chapter save transaction completes, then `velocityService.recordSave()` runs in a separate transaction. If velocity fails, the daily_snapshots table may be stale until the next successful save. This is explicitly documented as intentional ("best-effort -- must not break the save").
- **Evidence:** `packages/server/src/chapters/chapters.service.ts:98-119` (separate transaction boundaries).
- **Found by:** Integration & Data

### [F-14] Magic number msPerDay duplicated
- **Category:** 28 (Magic numbers/strings everywhere)
- **Impact:** Low
- **Explanation:** `const msPerDay = 86_400_000` appears twice in the same file, defined locally in two different functions rather than extracted to a shared constant.
- **Evidence:** `packages/server/src/velocity/velocity.service.ts:73,119`.
- **Found by:** Error Handling & Observability
- **Status:** Fixed
- **Status reason:** Extracted to module-level MS_PER_DAY constant, referenced by both functions
- **Status date:** 2026-04-12 23:11 UTC
- **Status commit:** d23b3c1

### [F-15] Dead code: useReducedMotion hook
- **Category:** 31 (Dead code / unused dependencies)
- **Impact:** Low
- **Explanation:** The `useReducedMotion` hook exists but is never imported by any component. CLAUDE.md mentions "prefers-reduced-motion respected" but this hook is not wired up, suggesting the a11y feature may not be implemented.
- **Evidence:** `packages/client/src/hooks/useReducedMotion.ts` -- zero imports found across codebase.
- **Found by:** Security & Code Quality
- **Status:** Fixed
- **Status reason:** Deleted unused hook file; can be re-implemented when actually wired into components
- **Status date:** 2026-04-12 23:07 UTC
- **Status commit:** b390f3c

### [F-16] Dead code: listChapterIdTitleStatusByProject store method
- **Category:** 31 (Dead code / unused dependencies)
- **Impact:** Low
- **Explanation:** Defined in the `ProjectStore` interface and implemented in `SqliteProjectStore`, but never called by any service or route code. Only used in its own unit test.
- **Evidence:** `packages/server/src/stores/project-store.types.ts:42-44`, `sqlite-project-store.ts:109`.
- **Found by:** Security & Code Quality
- **Status:** Fixed
- **Status reason:** Removed from repository, interface, implementation, and test
- **Status date:** 2026-04-12 23:08 UTC
- **Status commit:** 00cba10

### [F-17] Dead code: test-only repository exports and unused re-exports
- **Category:** 31 (Dead code / unused dependencies)
- **Impact:** Low
- **Explanation:** `queryChapter`/`queryChapters` in `chapters.repository.ts` are exported solely for backward-compatible tests. `safeTimezone` is re-exported from `velocity.service.ts` but never imported via that path. Minor API surface bloat.
- **Evidence:** `packages/server/src/chapters/chapters.repository.ts:30-46` (comment: "Backward-compat query helpers"), `velocity.service.ts:15` (unused re-export).
- **Found by:** Security & Code Quality
- **Status:** Fixed
- **Status reason:** Removed queryChapter/queryChapters helpers and tests; removed safeTimezone re-export from velocity.service
- **Status date:** 2026-04-12 23:09 UTC
- **Status commit:** 0161a3a

### [F-18] Hardcoded locale strings
- **Category:** 28 (Magic numbers/strings everywhere)
- **Impact:** Low
- **Explanation:** Two different locale strings are used for `Intl.DateTimeFormat`: `"en-CA"` for timezone validation (produces ISO format dates) and `"en-US"` for velocity date formatting. The locale choices are functional (not user-facing) but undocumented.
- **Evidence:** `packages/server/src/velocity/velocity.service.ts:32` ("en-US"), `packages/server/src/timezone.ts:3` ("en-CA").
- **Found by:** Error Handling & Observability
- **Status:** Fixed
- **Status reason:** Extracted to named constants DATE_PARTS_LOCALE and VALIDATION_LOCALE with JSDoc explaining purpose
- **Status date:** 2026-04-12 23:12 UTC
- **Status commit:** 06f2eb0

## Steering File Discrepancies

### [D-01] CLAUDE.md omits stores/ directory
- CLAUDE.md's project structure section does not list `packages/server/src/stores/`, which contains the core `ProjectStore` abstraction. Found by 2 specialists.

### [D-02] CLAUDE.md references Docker artifacts that don't exist
- CLAUDE.md says "Deployment: Single Docker container" and lists `docker compose up`, but no `Dockerfile` or `docker-compose.yml` exists in the repo.

## Coverage Checklist

### Flaw/Risk Types 1-34
| # | Type | Status | Finding |
|---|------|--------|---------|
| 1 | Global mutable state | Observed | #F-10 |
| 2 | God object | Observed | #F-04 |
| 3 | Tight coupling | Observed | #F-06, #F-07 |
| 4 | High/unstable dependencies | Not observed | -- |
| 5 | Circular dependencies | Not observed | -- |
| 6 | Leaky abstractions | Observed | #F-03 |
| 7 | Over-abstraction | Observed | #F-11 |
| 8 | Premature optimization | Not observed | -- |
| 9 | Shotgun surgery | Observed | #F-08 |
| 10 | Feature envy / anemic domain model | Not observed | -- |
| 11 | Low cohesion | Not observed | -- |
| 12 | Hidden side effects | Not observed | -- |
| 13 | Inconsistent boundaries | Observed | #F-05 |
| 14 | Distributed monolith | Not applicable | Monolith architecture |
| 15 | Chatty service calls | Not applicable | No inter-service network calls |
| 16 | Synchronous-only integration | Not applicable | No external service integration |
| 17 | No clear ownership of data | Not observed | -- |
| 18 | Shared database across services | Not applicable | Single application |
| 19 | Lack of idempotency | Not observed | -- |
| 20 | Weak error handling strategy | Observed | #F-02, #F-12 |
| 21 | No observability plan | Observed | #F-01 |
| 22 | Configuration sprawl | Not observed | -- |
| 23 | Dependency injection misuse | Not observed | -- |
| 24 | Inconsistent API contracts | Not observed | -- |
| 25 | Business logic in the UI | Not observed | -- |
| 26 | Poor transactional boundaries | Observed | #F-13 |
| 27 | Temporal coupling | Observed | #F-09 |
| 28 | Magic numbers/strings everywhere | Observed | #F-14, #F-18 |
| 29 | "Utility" dumping ground | Not observed | -- |
| 30 | Security as an afterthought | Not observed | -- |
| 31 | Dead code / unused dependencies | Observed | #F-15, #F-16, #F-17 |
| 32 | Missing or inadequate test coverage | Not assessed | Cannot verify without running suite |
| 33 | Hard-coded credentials or secrets | Not observed | -- |
| 34 | Inconsistent error/logging conventions | Not observed | -- |

### Strength Categories S1-S14
| # | Category | Status | Finding |
|---|----------|--------|---------|
| S1 | Clear modular boundaries | Observed | #S-01 |
| S2 | High cohesion | Observed | #S-12 |
| S3 | Loose coupling | Observed | #S-02 |
| S4 | Dependency direction is stable | Observed | #S-03 |
| S5 | Dependency management hygiene | Observed | #S-03 (no circular deps) |
| S6 | Consistent API contracts | Observed | #S-04 |
| S7 | Robust error handling | Observed | #S-05, #S-06, #S-07 |
| S8 | Observability present | Not observed | Console-only logging |
| S9 | Configuration discipline | Observed | #S-13 |
| S10 | Security built-in | Observed | #S-08, #S-09, #S-10, #S-15 |
| S11 | Testability & coverage | Observed | #S-11 |
| S12 | Resilience patterns | Not applicable | Monolith, no external services |
| S13 | Domain modeling strength | Observed | #S-02 |
| S14 | Simple, pragmatic abstractions | Observed | #S-14 |

## Hotspots

1. **`packages/client/src/pages/EditorPage.tsx`** -- Largest component (607 lines), orchestrates the entire editing experience across 3 view modes with 9 state variables. Primary candidate for decomposition as features grow.
2. **`packages/server/src/velocity/velocity.service.ts`** -- Sits at the boundary between two data access patterns (getDb and getProjectStore), contains duplicated magic numbers, and its side effects run outside the main save transaction.
3. **`packages/server/src/stores/`** -- Core architectural strength (ProjectStore abstraction) but also contains dead code (AssetStore, SnapshotStore) and a leaky abstraction (Knex.Transaction exposed through the interface). Not documented in CLAUDE.md.

## Next Questions

1. Is the `useReducedMotion` hook supposed to be wired into components, or has the prefers-reduced-motion feature been implemented a different way?
2. Should velocity and settings eventually migrate behind the `ProjectStore` abstraction, or is the intentional split permanent?
3. What is the plan for the `AssetStore` and `SnapshotStore` interfaces -- are these scheduled for implementation or should they be removed?
4. Would structured logging (e.g., pino) be worth introducing before Docker deployment, to support production debugging?
5. Should client catch blocks surface server error messages to aid debugging, or is the generic error UX intentional?

## Analysis Metadata

- **Agents dispatched:** Structure & Boundaries, Coupling & Dependencies, Integration & Data, Error Handling & Observability, Security & Code Quality, Verifier
- **Scope:** Full repository (125 source files)
- **Raw findings:** 52 (before verification)
- **Verified findings:** 33 (15 strengths, 18 flaws)
- **Filtered out:** 19 (false positives, below threshold, duplicates merged, non-findings)
- **By impact:** 0 high flaws, 4 medium flaws, 14 low flaws; 11 high strengths, 4 medium strengths
- **Steering files consulted:** `CLAUDE.md` (2 discrepancies noted)
