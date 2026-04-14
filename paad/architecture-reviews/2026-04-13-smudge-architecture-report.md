# Architecture Report — smudge

**Date:** 2026-04-13
**Commit:** 6791f0ee2ecb57701086d073aa5dc8c9b1179c22
**Languages:** TypeScript (React 19, Express 4.x, Vite, TipTap v2, better-sqlite3, Knex.js)
**Key directories:** `packages/shared/`, `packages/server/`, `packages/client/`, `e2e/`
**Scope:** Full repository

## Repo Overview

Smudge is a web-based writing application for long-form fiction and non-fiction, organized as projects containing chapters. It is a TypeScript monorepo with three npm workspace packages: `shared` (types, Zod schemas, `countWords()`), `server` (Express REST API with SQLite via better-sqlite3/Knex), and `client` (React SPA with TipTap rich text editor). Single-user, no auth by design. Architecture follows Routes -> Services -> Repositories with a `ProjectStore` abstraction layer. ~128 source files (65 source, 53 test, 3 e2e specs).

This is the fourth architecture analysis. Prior reports exist from 2026-03-31, 2026-04-09, and 2026-04-12. The current branch (`ovid/architecture`) shows recent intentional fixes for F-05, F-08, F-10, and F-13 from the 2026-04-12 report. This analysis surfaces new or surviving findings not covered by those fixes.

## Strengths

### [S-01] Consistent domain module structure
- **Category:** S1 (Clear modular boundaries)
- **Impact:** High
- **Explanation:** Every server domain (projects, chapters, velocity, settings, chapter-statuses) follows an identical four-file layout: `routes.ts`, `service.ts`, `repository.ts`, `types.ts`. The division is crisp: routes translate HTTP, services own business logic, repositories own SQL.
- **Evidence:** `packages/server/src/chapters/chapters.routes.ts` delegates to `ChapterService`; `chapters.service.ts` calls only `getProjectStore()`; `chapters.repository.ts` is pure Knex.
- **Found by:** Structure & Boundaries

### [S-02] ProjectStore as clean cross-cutting abstraction
- **Category:** S14 (Simple, pragmatic abstractions)
- **Impact:** High
- **Explanation:** The `ProjectStore` interface is the single seam for all data access. Services call `getProjectStore()` and are fully decoupled from Knex. The injectable pattern provides production and test initialization paths. The transaction API hides Knex mechanics behind a well-typed closure.
- **Evidence:** `packages/server/src/stores/project-store.types.ts:18` (38 method signatures); `sqlite-project-store.ts:201-209` (transaction creates scoped child store preventing nesting).
- **Found by:** Structure & Boundaries, Coupling & Dependencies

### [S-03] Focused shared package with zero reverse dependencies
- **Category:** S2 (High cohesion)
- **Impact:** High
- **Explanation:** The shared package is a pure leaf: `wordcount.ts`, `slugify.ts`, `schemas.ts`, `types.ts`, `constants.ts`, and a barrel `index.ts`. Zero imports from server or client. Single Zod dependency. Every export has an obvious place.
- **Evidence:** `packages/shared/src/index.ts` — barrel re-export; `package.json` dependencies: only `zod`.
- **Found by:** Structure & Boundaries, Coupling & Dependencies

### [S-04] Stable dependency direction across all layers
- **Category:** S4 (Dependency direction is stable)
- **Impact:** High
- **Explanation:** No repository imports a service. No service imports a route. Shared is imported by both client and server with no reverse dependency. Cross-domain calls on the server happen exclusively through `ProjectStore`.
- **Evidence:** Import analysis of all route, service, and repository files confirms no upward or skip-level imports. The one cross-domain import (`projects.service.ts` -> `chapters/chapters.types.ts`) is for type definitions only.
- **Found by:** Structure & Boundaries, Coupling & Dependencies

### [S-05] Robust error handling with typed error taxonomy
- **Category:** S7 (Robust error handling)
- **Impact:** High
- **Explanation:** Services define named error classes (`ProjectTitleExistsError`, `ParentPurgedError`, `ChapterPurgedError`) and use discriminated union return types. Routes translate these to HTTP codes explicitly. Unhandled errors propagate to `globalErrorHandler` via `asyncHandler`'s `.catch(next)`.
- **Evidence:** `packages/server/src/chapters/chapters.service.ts:14-27` (typed returns); `packages/server/src/app.ts:10-16` (`asyncHandler`); all route files use consistent error-to-HTTP mapping.
- **Found by:** Error Handling & Observability

### [S-06] Client save pipeline with exponential backoff and resilience
- **Category:** S7 (Robust error handling)
- **Impact:** High
- **Explanation:** The save handler implements: sequence numbers to abort stale retries, 3-attempt exponential backoff (2s/4s/8s) for 5xx/network errors, immediate fast-fail for 4xx, persistent error status that cannot be overwritten until a new save succeeds, and `beforeunload` guard.
- **Evidence:** `packages/client/src/hooks/useProjectEditor.ts` — `BACKOFF_MS = [2000, 4000, 8000]`; `MAX_RETRIES = BACKOFF_MS.length`.
- **Found by:** Error Handling & Observability

### [S-07] Corrupt content handled at repository layer
- **Category:** S7 (Robust error handling)
- **Impact:** High
- **Explanation:** JSON parse failures on chapter content are caught, logged with structured context, and marked with `content_corrupt: true`. This propagates as a typed sentinel through services and routes, resulting in a 500 with code `CORRUPT_CONTENT` rather than an uncaught exception.
- **Evidence:** `packages/server/src/chapters/chapters.repository.ts:14-30` (parseContent); `chapters.routes.ts` (CORRUPT_CONTENT response).
- **Found by:** Error Handling & Observability

### [S-08] Consistent API error envelope
- **Category:** S6 (Consistent API contracts)
- **Impact:** High
- **Explanation:** The error envelope `{ error: { code: "MACHINE_READABLE", message: "Human-readable" } }` is applied uniformly across all routes and the global error handler. Every route file uses explicit status codes and machine-readable codes.
- **Evidence:** `packages/server/src/app.ts:52-83` (globalErrorHandler); all route files use same pattern.
- **Found by:** Integration & Data

### [S-09] Helmet with explicit, restrictive CSP
- **Category:** S10 (Security built-in)
- **Impact:** High
- **Explanation:** CSP is fully specified: `defaultSrc 'self'`, `scriptSrc 'self'` (no unsafe-eval), `objectSrc 'none'`, `frameAncestors 'none'`. Integration-tested.
- **Evidence:** `packages/server/src/app.ts:21-35`; `__tests__/health.test.ts:21-29` verifies CSP directives.
- **Found by:** Security & Code Quality

### [S-10] Parameterized queries via Knex — zero SQL injection surface
- **Category:** S10 (Security built-in)
- **Impact:** High
- **Explanation:** All queries use Knex's fluent API. The only `db.raw()` calls are for `PRAGMA` and `COALESCE` with no user-supplied values. No template-literal queries anywhere.
- **Evidence:** All repository files use `.where({ id })`, `.insert(data)`, `.update(data)`.
- **Found by:** Security & Code Quality

### [S-11] Injectable architecture enables deterministic tests
- **Category:** S11 (Testability & coverage)
- **Impact:** High
- **Explanation:** Both `ProjectStore` and `VelocityService` singletons have explicit test-injection APIs with set/reset guards. Tests use `:memory:` SQLite, wire up real stores, and clean state `beforeEach`.
- **Evidence:** `packages/server/src/stores/project-store.injectable.ts`; `velocity/velocity.injectable.ts`; test helpers wire `:memory:` DB per test.
- **Found by:** Security & Code Quality

### [S-12] Save pipeline has multi-layer test coverage
- **Category:** S11 (Testability & coverage)
- **Impact:** High
- **Explanation:** Auto-save critical path tested at unit, integration, and E2e levels including failure recovery via network interception.
- **Evidence:** `__tests__/save-side-effects.test.ts`; `__tests__/chapters.service.test.ts:52-74` (velocity failure isolation); `e2e/editor-save.spec.ts:62-101` (network abort -> "Unable to save" -> recovery).
- **Found by:** Security & Code Quality

### [S-13] String externalization fully realized
- **Category:** S1 (Clear modular boundaries)
- **Impact:** Medium
- **Explanation:** All user-facing text lives in `STRINGS` as `as const`, including function-valued entries for parameterized strings. Components reference `STRINGS.*`, no raw string literals for user-facing copy.
- **Evidence:** `packages/client/src/strings.ts` — comprehensive coverage; all components import from `strings.ts`.
- **Found by:** Structure & Boundaries, Error Handling & Observability

### [S-14] Structured pino logging with safe defaults
- **Category:** S8 (Observability present)
- **Impact:** Medium
- **Explanation:** Server uses pino throughout with validated level from env, `pino-pretty` gated on `NODE_ENV=development` only. All call sites pass structured data objects.
- **Evidence:** `packages/server/src/logger.ts`; service files use `logger.error({ err, project_id }, "message")`.
- **Found by:** Error Handling & Observability

### [S-15] Configuration validated at startup
- **Category:** S9 (Configuration discipline)
- **Impact:** Medium
- **Explanation:** `SMUDGE_PORT` is parsed and range-checked with hard exit on invalid. `LOG_LEVEL` validated against an allowlist. Safe defaults for all env vars.
- **Evidence:** `packages/server/src/index.ts:8-12`; `logger.ts:3-11` (`VALID_LEVELS` allowlist).
- **Found by:** Error Handling & Observability

### [S-16] Error messages sanitized — no server internals leaked
- **Category:** S10 (Security built-in)
- **Impact:** Medium
- **Explanation:** Global error handler returns only generic client messages. Raw `err.message` never forwarded. Tests assert raw messages are NOT echoed.
- **Evidence:** `packages/server/src/app.ts:60-81`; `__tests__/error-handler.test.ts:51-59`.
- **Found by:** Security & Code Quality

### [S-17] StatusLabelProvider narrows dependency for enrichment helpers
- **Category:** S3 (Loose coupling)
- **Impact:** Medium
- **Explanation:** The `enrichChapterWithLabel` helpers accept a narrow `StatusLabelProvider` interface rather than the full `ProjectStore`, enabling independent testability.
- **Evidence:** `packages/server/src/chapters/chapters.types.ts:79-82` — two-method interface.
- **Found by:** Coupling & Dependencies

### [S-18] Best-effort velocity side effects logged and isolated
- **Category:** S7 (Robust error handling)
- **Impact:** Medium
- **Explanation:** All velocity side-effect calls are wrapped in try/catch with structured logging. Errors never propagate to the save pipeline.
- **Evidence:** `packages/server/src/chapters/chapters.service.ts:90-101,126-135,210-217`.
- **Found by:** Error Handling & Observability

## Flaws/Risks

### [F-01] No HTTP access logging
- **Category:** 21 (No observability plan)
- **Impact:** Medium
- **Explanation:** No pino-http, morgan, or equivalent request-logging middleware. Every inbound request is invisible unless it throws an uncaught error. For a writing app where the save pipeline is the core trust promise, this is a meaningful observability gap.
- **Evidence:** `packages/server/src/app.ts` mounts only helmet, `express.json`, domain routers, and `globalErrorHandler`. No logging middleware. `pino-http` not in `package.json`.
- **Found by:** Error Handling & Observability

### [F-02] Temporal coupling: getTodayDate() must precede store.transaction()
- **Category:** 27 (Temporal coupling)
- **Impact:** Medium
- **Explanation:** `getTodayDate()` reads the settings table via the root (non-transaction) store. If called inside `store.transaction()`, it would deadlock on better-sqlite3's serialized writes. This ordering constraint has no type-level enforcement — only JSDoc comments.
- **Evidence:** `packages/server/src/velocity/velocity.service.ts:44-54` — `getTodayDate()` called before `store.transaction()`, with JSDoc at lines 38-47 documenting the constraint.
- **Found by:** Coupling & Dependencies

### [F-03] ProjectStore leaks SqliteProjectStore implementation detail
- **Category:** 6 (Leaky abstractions)
- **Impact:** Medium
- **Explanation:** JSDoc in `velocity.service.ts` explicitly references `SqliteProjectStore` by name to explain why nested transactions are forbidden. The concrete implementation's constraint is documented in the service layer, puncturing the abstraction boundary.
- **Evidence:** `packages/server/src/velocity/velocity.service.ts:42` — `"SqliteProjectStore forbids nesting"`. Also at line 61.
- **Found by:** Coupling & Dependencies

### [F-04] purge.ts bypasses ProjectStore — raw Knex access
- **Category:** 13 (Inconsistent boundaries)
- **Impact:** Medium
- **Explanation:** `purgeOldTrash()` takes a raw `Knex` instance and queries tables directly, bypassing `ProjectStore`. Every other production write goes through the store. If the store adds caching, hooks, or a different backend, purge is a silent exception.
- **Evidence:** `packages/server/src/db/purge.ts:7` — `db.transaction(async (trx) => { ... })` with raw `trx("chapters")` and `trx("projects")`; `index.ts:32` passes raw `db`.
- **Found by:** Structure & Boundaries, Coupling & Dependencies

### [F-05] Velocity service reads settings via magic string (cross-domain feature envy)
- **Category:** 10 (Feature envy / anemic domain model)
- **Impact:** Medium
- **Explanation:** `getTodayDate()` calls `store.findSettingByKey("timezone")` using a magic string. The settings module is the natural owner of timezone resolution. The string `"timezone"` appears in both velocity and settings services with no shared constant.
- **Evidence:** `packages/server/src/velocity/velocity.service.ts:24` — `store.findSettingByKey("timezone")`. Also a hidden side effect: function named as a date utility performs a DB read.
- **Found by:** Structure & Boundaries, Error Handling & Observability

### [F-06] Chapter POST non-idempotent with partial failure risk
- **Category:** 19 (Lack of idempotency)
- **Impact:** Medium
- **Explanation:** `POST /api/projects/:slug/chapters` always creates a new chapter. Server returns `READ_AFTER_CREATE_FAILURE` (500) with "Do not retry" message, but the client has no mechanism to heed it — it treats all errors generically. A user hitting retry would create duplicate chapters.
- **Evidence:** `packages/server/src/projects/projects.routes.ts:107` — "Do not retry"; `packages/client/src/hooks/useProjectEditor.ts:139-140` — generic error handling with no special case.
- **Found by:** Integration & Data

### [F-07] No DOMPurify regression test for XSS
- **Category:** 32 (Missing test coverage for critical paths)
- **Impact:** Medium
- **Explanation:** `PreviewMode` is the only component with `dangerouslySetInnerHTML`. It wraps output in `DOMPurify.sanitize()` (correct), but the test file has zero XSS payload tests. A refactor removing the sanitize call would pass all tests.
- **Evidence:** `packages/client/src/components/PreviewMode.tsx:76` — `dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}`; `__tests__/PreviewMode.test.tsx` — no `DOMPurify`, `sanitize`, or XSS references.
- **Found by:** Security & Code Quality

### [F-08] DashboardResponse not in shared — client replicates inline
- **Category:** 9 (Shotgun surgery)
- **Impact:** Low
- **Explanation:** Server defines `DashboardResponse` in `projects.service.ts`. Client has an identical inline anonymous type in `api/client.ts`. These are structurally identical but unlinked. `VelocityResponse` was correctly moved to shared; dashboard was not.
- **Evidence:** `packages/server/src/projects/projects.service.ts:28-37`; `packages/client/src/api/client.ts:86-103`.
- **Found by:** Structure & Boundaries, Coupling & Dependencies, Integration & Data

### [F-09] SqliteProjectStore is a wide facade (scaling concern)
- **Category:** 2 (God object)
- **Impact:** Low
- **Explanation:** 38 methods spanning projects, chapters, chapter-statuses, settings, velocity, and transactions. Every method is a one-liner delegation, so no logic concentration — but any new data operation grows this class. Intentional design from F-05 fix.
- **Evidence:** `packages/server/src/stores/sqlite-project-store.ts:25-210` — imports `*` from all 5 domain repositories. `project-store.types.ts` — 82-line interface.
- **Found by:** Structure & Boundaries, Coupling & Dependencies

### [F-10] ChapterStatusRow duplicated in server and shared
- **Category:** 6 (Leaky abstractions)
- **Impact:** Low
- **Explanation:** Identical 3-field interface defined in both `chapter-statuses.types.ts` and `shared/types.ts`. The `toChapterStatus()` mapper in the service merely copies all three fields — a no-op type cast.
- **Evidence:** `packages/server/src/chapter-statuses/chapter-statuses.types.ts:1-5`; `packages/shared/src/types.ts:47-51`.
- **Found by:** Coupling & Dependencies

### [F-11] ProjectTitleExistsError message hardcoded in three places
- **Category:** 9 (Shotgun surgery)
- **Impact:** Low
- **Explanation:** The string `"A project with that title already exists"` appears independently in the error constructor and two route catch blocks. The error code `"PROJECT_TITLE_EXISTS"` is similarly duplicated at two route sites.
- **Evidence:** `packages/server/src/projects/projects.service.ts:43`; `packages/server/src/projects/projects.routes.ts:25-26,66-67`.
- **Found by:** Structure & Boundaries

### [F-12] chapters.types.ts mixes types with runtime async helpers
- **Category:** 11 (Low cohesion)
- **Impact:** Low
- **Explanation:** The types file contains four exported functions alongside type definitions, including async functions that perform DB calls. Cross-domain dependency through the types file.
- **Evidence:** `packages/server/src/chapters/chapters.types.ts:66-99` — `enrichChapterWithLabel`, `enrichChaptersWithLabels` (async, call `provider.getStatusLabel()`). `projects.service.ts` imports these from the types file.
- **Found by:** Structure & Boundaries

### [F-13] Client uses unstructured console.* vs server pino
- **Category:** 34 (Inconsistent error/logging conventions)
- **Impact:** Low
- **Explanation:** Server uses pino with structured JSON. Client has 22+ scattered `console.warn/error` calls with unstructured strings. No common error-reporting wrapper, no consistent format. Severity assignment appears arbitrary (some use `warn`, others `error`).
- **Evidence:** 22 `console.warn/error` calls across 8 client source files; zero structured logging.
- **Found by:** Error Handling & Observability

### [F-14] Trash typed as Chapter[] but server sends DeletedChapterRow[]
- **Category:** 24 (Inconsistent API contracts)
- **Impact:** Low
- **Explanation:** Client types the trash endpoint as `Chapter[]` but server returns `DeletedChapterRow[]`, which differs: `content` is always `null`, `status_label` is absent. Benign at runtime today because `TrashView` only accesses safe fields.
- **Evidence:** `packages/client/src/api/client.ts:83` — `apiFetch<Chapter[]>`; server `getTrash()` returns `DeletedChapterRow[]`.
- **Found by:** Integration & Data

### [F-15] STATUS_COLORS keys duplicate shared ChapterStatus enum
- **Category:** 28 (Magic numbers/strings)
- **Impact:** Low
- **Explanation:** `STATUS_COLORS` uses raw string keys (`"outline"`, `"rough_draft"`, etc.) without referencing the `ChapterStatus` Zod enum from shared. Adding a new status to the enum would silently receive no color.
- **Evidence:** `packages/client/src/statusColors.ts:1-7` — raw string keys; `packages/shared/src/schemas.ts` — `ChapterStatus` enum not referenced.
- **Found by:** Error Handling & Observability

### [F-16] Default status "outline" hardcoded in Sidebar
- **Category:** 25 (Business logic in the UI)
- **Impact:** Low
- **Explanation:** `Sidebar.tsx` uses `chapter.status || "outline"` as a fallback. The canonical default lives in the server's seeded `chapter_statuses` table. If the default changes server-side, the client would show a mismatched color/label.
- **Evidence:** `packages/client/src/components/Sidebar.tsx:36,39` — `const currentStatus = chapter.status || "outline"`.
- **Found by:** Error Handling & Observability

### [F-17] Magic numbers: 7/30 day velocity windows
- **Category:** 28 (Magic numbers/strings)
- **Impact:** Low
- **Explanation:** Rolling average window sizes are bare integers with no named constants.
- **Evidence:** `packages/server/src/velocity/velocity.service.ts:111-112` — `daysAgoDate(today, 7)` and `daysAgoDate(today, 30)`.
- **Found by:** Error Handling & Observability

### [F-18] Magic numbers: client status-fetch retry delay
- **Category:** 28 (Magic numbers/strings)
- **Impact:** Low
- **Explanation:** `EditorPage` status-fetch retry uses `2000 * attempts` as inline backoff delay. Unlike the save pipeline's named `BACKOFF_MS`, this is undocumented and inconsistent.
- **Evidence:** `packages/client/src/pages/EditorPage.tsx:120` — `timerId = setTimeout(fetchStatuses, 2000 * attempts)`.
- **Found by:** Error Handling & Observability

### [F-19] DB_PATH resolved independently in two places
- **Category:** 22 (Configuration sprawl)
- **Impact:** Low
- **Explanation:** `index.ts` and `knexfile.ts` both read `process.env.DB_PATH` independently. The two code paths are mutually exclusive in production but the duplication is real.
- **Evidence:** `packages/server/src/index.ts:13,20`; `packages/server/src/db/knexfile.ts:11`.
- **Found by:** Error Handling & Observability

### [F-20] EditorPage residual orchestrator complexity
- **Category:** 2 (God object)
- **Impact:** Low
- **Explanation:** Despite prior decomposition (F-04 fix), EditorPage at 444 lines still holds 9 useState calls, an inline retry effect (statuses fetch), and a direct API call bypassing hooks. The statuses fetch is a hook that was not extracted.
- **Evidence:** `packages/client/src/pages/EditorPage.tsx:104-131` (inline retry logic); `:170-184` (direct `api.projects.get` call).
- **Found by:** Structure & Boundaries

### [F-21] No network trust boundary
- **Category:** 30 (Security as an afterthought)
- **Impact:** Low
- **Explanation:** Server listens on all interfaces with no rate limiting, CORS, or IP restriction. Low-risk for a single-user local/Docker app, but if accidentally exposed, nothing prevents API enumeration.
- **Evidence:** `packages/server/src/index.ts:42` — `app.listen(PORT)` defaults to `0.0.0.0`; no `express-rate-limit` or `cors` in dependencies.
- **Found by:** Security & Code Quality

### [F-22] getDb() exported but unused in production
- **Category:** 31 (Dead code / unused dependencies)
- **Impact:** Low
- **Explanation:** After the F-05 fix routing all data access through ProjectStore, `getDb()` has no production callers. It's marked `@internal` and used by test helpers, but remains a public export that could bypass the store abstraction.
- **Evidence:** `packages/server/src/db/connection.ts:10` — only callers are in `__tests__/`.
- **Found by:** Security & Code Quality

### [F-23] Client error paths have no test assertions
- **Category:** 32 (Missing test coverage for critical paths)
- **Impact:** Low
- **Explanation:** 22 `console.warn/error` calls in production client code, but no test file spies on `console` to verify error-handling branches fire. Critical paths like "save failed" and "failed to create chapter" have no test assertion.
- **Evidence:** 22 console calls in client source; 0 `vi.spyOn(console)` calls in client tests.
- **Found by:** Security & Code Quality

### [F-24] Velocity snapshot outside save transaction
- **Category:** 26 (Poor transactional boundaries)
- **Impact:** Low
- **Explanation:** Chapter save and velocity snapshot are deliberately separate transactions. If the velocity update fails permanently, `daily_snapshots` will undercount. Intentional tradeoff — documented as best-effort.
- **Evidence:** `packages/server/src/chapters/chapters.service.ts:90-100` — `recordSave()` in separate try/catch after save transaction.
- **Found by:** Integration & Data

## Coverage Checklist

### Flaw/Risk Types 1-34
| # | Type | Status | Finding |
|---|------|--------|---------|
| 1 | Global mutable state | Not observed | Singletons exist but are injectable with test guards |
| 2 | God object | Observed | #F-09, #F-20 |
| 3 | Tight coupling | Observed | #F-04 |
| 4 | High/unstable dependencies | Observed | #F-09 (same finding — wide facade imports all repos) |
| 5 | Circular dependencies | Not observed | — |
| 6 | Leaky abstractions | Observed | #F-03, #F-10 |
| 7 | Over-abstraction | Not observed | velocity.injectable.ts considered but consistent with codebase pattern |
| 8 | Premature optimization | Not observed | — |
| 9 | Shotgun surgery | Observed | #F-08, #F-11 |
| 10 | Feature envy / anemic domain model | Observed | #F-05 |
| 11 | Low cohesion | Observed | #F-12 |
| 12 | Hidden side effects | Observed | #F-05 (getTodayDate hides DB read) |
| 13 | Inconsistent boundaries | Observed | #F-04 |
| 14 | Distributed monolith | Not applicable | Single-process monolith |
| 15 | Chatty service calls | Not applicable | Single-process monolith |
| 16 | Synchronous-only integration | Not applicable | Single-process monolith |
| 17 | No clear ownership of data | Not observed | ProjectStore provides unified ownership |
| 18 | Shared database across services | Not applicable | Single database, single service |
| 19 | Lack of idempotency | Observed | #F-06 |
| 20 | Weak error handling strategy | Not observed | Error handling is a strength (S-05 through S-08) |
| 21 | No observability plan | Observed | #F-01 |
| 22 | Configuration sprawl | Observed | #F-19 |
| 23 | Dependency injection misuse | Not observed | — |
| 24 | Inconsistent API contracts | Observed | #F-14 |
| 25 | Business logic in the UI | Observed | #F-16 |
| 26 | Poor transactional boundaries | Observed | #F-24 |
| 27 | Temporal coupling | Observed | #F-02 |
| 28 | Magic numbers/strings everywhere | Observed | #F-15, #F-17, #F-18 |
| 29 | "Utility" dumping ground | Not observed | — |
| 30 | Security as an afterthought | Observed | #F-21 |
| 31 | Dead code / unused dependencies | Observed | #F-22 |
| 32 | Missing or inadequate test coverage | Observed | #F-07, #F-23 |
| 33 | Hard-coded credentials or secrets | Not observed | Full scan negative; .gitignore excludes .env files |
| 34 | Inconsistent error/logging conventions | Observed | #F-13 |

### Strength Categories S1-S14
| # | Category | Status | Finding |
|---|----------|--------|---------|
| S1 | Clear modular boundaries | Observed | #S-01, #S-13 |
| S2 | High cohesion | Observed | #S-03 |
| S3 | Loose coupling | Observed | #S-02, #S-17 |
| S4 | Dependency direction is stable | Observed | #S-04 |
| S5 | Dependency management hygiene | Observed | #S-03 (shared as pure leaf) |
| S6 | Consistent API contracts | Observed | #S-08 |
| S7 | Robust error handling | Observed | #S-05, #S-06, #S-07, #S-18 |
| S8 | Observability present | Observed | #S-14 (server-side pino; client gap per F-13) |
| S9 | Configuration discipline | Observed | #S-15 |
| S10 | Security built-in | Observed | #S-09, #S-10, #S-16 |
| S11 | Testability & coverage | Observed | #S-11, #S-12 |
| S12 | Resilience patterns | Observed | #S-06 (client-side backoff/retry) |
| S13 | Domain modeling strength | Observed | #S-04 (layered architecture) |
| S14 | Simple, pragmatic abstractions | Observed | #S-02 |

## Hotspots

1. **`packages/server/src/velocity/velocity.service.ts`** — Highest finding density: temporal coupling (F-02), leaky abstraction (F-03), cross-domain feature envy (F-05), hidden side effect in `getTodayDate()`. Core concerns cluster around the transaction/settings interaction.

2. **`packages/client/src/pages/EditorPage.tsx`** — Residual orchestrator complexity (F-20) with inline retry logic and direct API call. Also contains magic retry numbers (F-18). Most likely file to accumulate further complexity as features are added.

3. **`packages/server/src/stores/sqlite-project-store.ts`** — Wide facade (F-09) aggregating all 5 domain repositories. Growth point for every new data operation. Current 38-method surface is manageable but will need monitoring.

## Next Questions

1. Should `getTodayDate()` in velocity be replaced by a settings-domain function (e.g., `settingsService.getCurrentTimezone()`) to eliminate the magic string and hidden side effect?

2. Should `purge.ts` be migrated to a `ProjectStore` method, or is its startup-only, pre-store context a valid exception to the "all access through ProjectStore" rule?

3. Should `DashboardResponse` and a `TrashedChapter` type be added to `@smudge/shared` to unify client-server contracts, following the `VelocityResponse` precedent?

4. What is the strategy for the `ProjectStore` facade as the domain count grows — will it remain a single interface, or will it be decomposed into domain-specific sub-interfaces?

5. Should chapter creation (`POST /chapters`) gain an idempotency key or client-side deduplication to prevent duplicate chapters on retry after partial failure?

## Analysis Metadata

- **Agents dispatched:** Structure & Boundaries, Coupling & Dependencies, Integration & Data, Error Handling & Observability, Security & Code Quality, Verifier
- **Scope:** Full repository (128 source files)
- **Raw findings:** 45 (19 strengths + 26 flaws)
- **Verified findings:** 42 (18 strengths + 24 flaws)
- **Filtered out:** 3 (merged duplicates: F-01/F-22 overlap -> single F-05; F-10 velocity.injectable dropped as consistent pattern; health endpoint telemetry dropped as trivial)
- **By impact:** 0 high flaws, 7 medium flaws, 17 low flaws; 12 high strengths, 6 medium strengths
- **Steering files consulted:** CLAUDE.md (comprehensive, no contradictions with code found)
