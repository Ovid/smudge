# Architecture Report — smudge

**Date:** 2026-05-29
**Commit:** 1e83fdabc7bb6ea7b13eaa81500a28891e762cb6
**Languages:** TypeScript (Node.js 22 / Express 4, better-sqlite3 + Knex, Zod; React 18 / Vite / TipTap v2 / Tailwind)
**Key directories:** `packages/shared`, `packages/server`, `packages/client`, `e2e/`
**Scope:** Full repository (excluding `.devcontainer/`, which is third-party/out-of-scope per CLAUDE.md)

> A prior architecture report for the same date exists at
> `2026-05-29-smudge-architecture-report.md` (committed). This run is written to a
> `-v2` filename to preserve it rather than overwrite committed work.

## Repo Overview

Smudge is a single-user, no-auth web application for writing long-form fiction
and non-fiction, organized as projects containing chapters. It is a **monolith**:
one Express process, one SQLite database (via synchronous better-sqlite3 + Knex),
and one React SPA. Chapter content is stored as TipTap JSON (source of truth);
HTML is generated on demand for preview/export.

The server is cleanly layered **Routes → Services → Repositories**, with data
access funnelled through a `ProjectStore` facade composed of per-domain interface
slices. Domain modules: `projects`, `chapters`, `chapter-statuses`, `settings`,
`velocity`, `snapshots`, `images`, `export`, `search`. The client centralizes
error handling (typed `AppError` server-side; `mapApiError`/scopes registry
client-side), externalizes all UI strings, and encapsulates the save pipeline's
ordering invariants in dedicated hooks (`useEditorMutation`, `useAbortableSequence`).

Size: medium (~85 non-test source files across three packages; ~100 test files).
The codebase shows a visible, disciplined refactor history (an "F-" finding series
referenced in code comments and commits) that has already addressed the major
god-object and temporal-coupling risks. Remaining findings are predominantly
low-to-medium residuals inherent to an otherwise sound architecture.

## Strengths

### [S-1] Clean, strictly-enforced layered boundaries
- **Category:** S1 (clear modular boundaries)
- **Impact:** High
- **Explanation:** Routes→Services→Repositories layering is real, not aspirational — no `*.routes.ts` touches `getDb`/repositories and no `*.service.ts` imports a repository module directly; all data access funnels through the `ProjectStore` facade.
- **Evidence:** `packages/server/src/*/*.routes.ts`, `*.service.ts`, `stores/` — grep confirms zero `getDb`/repository imports in route files and zero repository imports in services.
- **Found by:** Structure & Boundaries

### [S-2] Stable, acyclic dependency direction
- **Category:** S4 (dependency direction is stable)
- **Impact:** High
- **Explanation:** Zero dependency cycles; repositories import nothing from services and take `db` as a parameter, so the dependency arrow always points inward toward data primitives.
- **Evidence:** `packages/server/src/**` — repos like `projectsRepo.insert(this.db, …)`; client cross-hook cycles deliberately broken via the type-only `useProjectEditor.types.ts` (F-2, 2026-05-29).
- **Found by:** Coupling & Dependencies

### [S-3] Exemplary resilience in the save pipeline
- **Category:** S12 (resilience patterns)
- **Impact:** High
- **Explanation:** Auto-save retries with exponential backoff and a precise retry-vs-terminate classification, re-reading the latest content on each attempt and threading `AbortSignal` through every request; transport errors are normalized at the fetch boundary.
- **Evidence:** `packages/client/src/hooks/useProjectEditor.ts:34` (`SAVE_BACKOFF_MS=[2000,4000,8000]`), `:357-496` (retry classification: NETWORK/500 retry; BAD_JSON/`UPDATE_READ_FAILURE`/`CORRUPT_CONTENT`/4xx terminate); `packages/client/src/api/client.ts` (`classifyFetchError`, 204 short-circuit, prototype-pollution guard).
- **Found by:** Integration & Data

### [S-4] Robust, centralized error handling (server taxonomy + client mapper)
- **Category:** S7 (robust error handling)
- **Impact:** High
- **Explanation:** A typed `AppError` hierarchy (status pinned to the 400/404/409/413/500 allowlist, never 2xx) is the single owner of domain→HTTP mapping; the client mirrors it with `mapApiError` as the sole code/status→string translator, hardened against prototype pollution.
- **Evidence:** `packages/server/src/errors/appError.ts:25-72`, `packages/server/src/app.ts:59-111` (central envelope render); `packages/client/src/errors/apiErrorMapper.ts:108-220`, `packages/client/src/api/client.ts:41-231`.
- **Found by:** Error Handling & Observability

### [S-5] Consistent API contracts
- **Category:** S6 (consistent API contracts)
- **Impact:** High
- **Explanation:** A single `{error:{code,message,...extras}}` envelope is rendered centrally; the status allowlist is honored everywhere, DELETE is uniformly 204-no-body, and 409 `IMAGE_IN_USE` carries the referencing chapter list per the documented shape.
- **Evidence:** `packages/server/src/app.ts:59-111`; `packages/server/src/images/images.routes.ts:151-159` (409 + `chapters`, 204 DELETE — F-16).
- **Found by:** Integration & Data (Error Handling agreed)

### [S-6] Observability: correlation IDs + structured logging
- **Category:** S8 (observability present)
- **Impact:** High
- **Explanation:** Every request gets a validated/minted `req_id` bound into a pino child logger; inbound `X-Request-Id` is regex-bounded against log injection, and critical lifecycle paths (purge, reaper, velocity best-effort failures, corruption throttle) emit structured events.
- **Evidence:** `packages/server/src/requestContext.ts:38-56`, `packages/server/src/app.ts:82-87`, `packages/server/src/index.ts:44-73`.
- **Found by:** Error Handling & Observability

### [S-7] Strong domain modeling of failure / partial-commit states
- **Category:** S13 (domain modeling strength)
- **Impact:** High
- **Explanation:** The error system models genuinely hard concepts — `possiblyCommitted`, `transient`, `terminal`, `committedCodes`, `terminalStatuses` — in one `SCOPES` registry guarded by a `satisfies` exhaustiveness check.
- **Evidence:** `packages/client/src/errors/scopes.ts` (513 lines, e.g. `committedCodes:["UPDATE_READ_FAILURE"]`), `apiErrorMapper.ts`.
- **Found by:** Structure & Boundaries

### [S-8] Fully server-controlled filesystem paths (no traversal surface)
- **Category:** S10 (security built-in)
- **Impact:** High
- **Explanation:** Image paths are assembled only from non-user segments — data dir + Zod/regex-validated UUID project id + server-generated image id + an extension from a fixed MIME map; `originalname` is `path.basename`-stripped and used only as a metadata label, never in a path join.
- **Evidence:** `packages/server/src/images/images.paths.ts:69-71` (`getImagePath`), `images.service.ts:78,116`, `images.routes.ts:20-29` (`requireUuidParam`).
- **Found by:** Security & Code Quality

### [S-9] Defense-in-depth client sanitizer
- **Category:** S10 (security built-in)
- **Impact:** High
- **Explanation:** A private `DOMPurify(window)` instance with frozen tag/attr allowlists and a URI regexp permitting only `/api/images/<uuid>`, plus an `uponSanitizeAttribute` hook that closes DOMPurify 3.x's `data:` carve-out; applied at both `dangerouslySetInnerHTML` sinks (preview + snapshot view).
- **Evidence:** `packages/client/src/sanitizer.ts:12,30-115`; sinks at `PreviewMode.tsx:76` and `useSnapshotController.ts:50`.
- **Found by:** Security & Code Quality

### [S-10] Parameterized SQL + restrictive CSP + Zod + Trojan-Source defense
- **Category:** S10 (security built-in)
- **Impact:** High
- **Explanation:** All `db.raw` calls bind values with `?` placeholders (the only interpolated raw is `PRAGMA busy_timeout` with a hardcoded constant); helmet CSP is restrictive; every write route validates with Zod; `sanitizeSnapshotLabel` strips control/bidi/zero-width code points. Uploads add a MIME allowlist + magic-byte verification + dual-layer size cap.
- **Evidence:** `packages/server/src/app.ts:19-37`, `settings.repository.ts:21-24`, `db/connection.ts:13,47`, `packages/shared/src/schemas.ts:133-181`, `images.paths.ts:43-67` (`validateMagicBytes`).
- **Found by:** Security & Code Quality

### [S-11] Composite store split into cohesive per-domain slices
- **Category:** S1 / S5 (modular boundaries / dependency hygiene)
- **Impact:** Medium
- **Explanation:** What could have been a 50+-method god-interface is decomposed into seven domain sub-interfaces that `ProjectStore` composes via `extends`; a new operation edits only its slice. A deliberate dependency-hygiene refactor (F-4).
- **Evidence:** `packages/server/src/stores/project-store.types.ts:36-157`.
- **Found by:** Structure & Boundaries, Coupling & Dependencies

### [S-12] Loose coupling via narrow interfaces and exercised DI seams
- **Category:** S3 (loose coupling)
- **Impact:** Medium
- **Explanation:** Consumers depend on small role interfaces rather than the full store (`StatusLabelProvider` 2-method; export renderers' injected one-method `ImageSource`), and the injection seams (`setProjectStore`/`setVelocityService`) are genuinely exercised by tests rather than ceremonial.
- **Evidence:** `packages/server/src/chapters/chapters.types.ts:79-91`, `packages/server/src/export/image-resolver.ts:14-16`, `velocity.injectable.ts`/`project-store.injectable.ts` (used in 4 test files).
- **Found by:** Coupling & Dependencies (Structure, Security agreed on the `ImageSource` seam)

### [S-13] Testability seams + enforced coverage
- **Category:** S11 (testability & coverage)
- **Impact:** High
- **Explanation:** Filesystem I/O is isolated behind a single mockable `images.fs` seam, export renderers take an injected `ImageSource`, and critical paths have dedicated tests (purge, reaper, references, migrations, sanitizer) under config-enforced coverage thresholds (95/85/90/95).
- **Evidence:** `packages/server/src/images/images.fs.ts`, `export/image-resolver.ts:14-16`, `packages/server/src/__tests__/` + `vitest.config.ts`.
- **Found by:** Security & Code Quality

### [S-14] Configuration discipline: single data-dir owner
- **Category:** S9 (configuration discipline)
- **Impact:** Medium
- **Explanation:** `getDataDir()`/`getDbPath()` is the documented single owner of "where Smudge persists data" (collapsing a default formerly duplicated across four files); the 5 MB chapter cap is one source of truth wired into express.json, replace, and snapshot-restore. (See F-3 for the one residual bypass.)
- **Evidence:** `packages/server/src/config/paths.ts:14-26`, `constants.ts`.
- **Found by:** Error Handling & Observability

### [S-15] Test-only singleton mutators explicitly fenced
- **Category:** S2 (high cohesion / controlled state)
- **Impact:** Medium
- **Explanation:** The module-level singletons expose `set*`/`reset*` marked `@internal` test-only, and `initDb`/`initProjectStore` throw on double-init — the mutable-state risk is real but deliberately and tightly controlled (F-09/F-10).
- **Evidence:** `packages/server/src/stores/project-store.injectable.ts` (`initProjectStore` throws at lines 31-33), `db/connection.ts:26-37`.
- **Found by:** Structure & Boundaries

## Flaws/Risks

### [F-1] No single owner of `images.reference_count`
- **Category:** 17 (no clear ownership of data) — also 3 (tight coupling) / 6 (leaky abstraction)
- **Impact:** Medium
- **Explanation:** Five flows delta-mutate the column via `applyImageRefDiff` while `images.service.deleteImage` distrusts them all and authoritatively recomputes via `setImageReferenceCount` — the recompute is itself evidence the incremental count isn't trusted; `projects.service.deleteProject` decrements directly, bypassing the shared helper's cross-project/existence guards, and the helper silently changes behavior on corrupt JSON (over-count vs abort).
- **Evidence:** `packages/server/src/images/images.references.ts:97-172` (corrupt-JSON asymmetry at `:110-114` vs `:121-132`), `images.service.ts:184` (`setImageReferenceCount`), `projects.service.ts:186-188` (direct decrement).
- **Found by:** Coupling & Dependencies, Integration & Data (merged)

### [F-2] Load-bearing temporal coupling in the save pipeline
- **Category:** 27 (temporal coupling)
- **Impact:** Medium
- **Explanation:** The save-pipeline invariants (markClean → setEditable(false) → cancelPendingSaves → mutate → cache-clear → reload, in exact order) are real temporal coupling — the hook re-reads `editorRef.current` at multiple points and branches on several boolean flags; any reordering silently breaks data-loss guarantees. It is *correctly* encapsulated in one hook (the documented mitigation), so this is a contained hazard rather than a defect.
- **Evidence:** `packages/client/src/hooks/useEditorMutation.ts` (566 lines).
- **Found by:** Coupling & Dependencies

### [F-3] `DB_PATH` consumed through two divergent config paths
- **Category:** 22 (configuration sprawl) — also 34 (inconsistent conventions)
- **Impact:** Medium
- **Explanation:** `index.ts` reads `process.env.DB_PATH` directly and hand-builds an inline Knex config (duplicating migrations dir + `useNullAsDefault` + `loadExtensions`), bypassing `createKnexConfig()`/`getDbPath()` — which already honor `DB_PATH`. This contradicts the "single owner" claim in `paths.ts`; the inline branch won't pick up future knexfile-level changes.
- **Evidence:** `packages/server/src/index.ts:25-40` vs `config/paths.ts:24-26` and `db/knexfile.ts:12`.
- **Found by:** Error Handling & Observability (verified bypass is real)

### [F-4] Export image resolvers omit the project-ownership guard
- **Category:** 30 (security as an afterthought)
- **Impact:** Medium
- **Explanation:** `resolveImage(imageId, source)` embeds any image by UUID with no `row.project_id === project.id` check, unlike `applyImageRefDiff` and the EPUB *cover* path which both enforce it. A chapter referencing another project's image UUID (e.g. via paste/import) would embed that foreign image into the export — a cross-project information bleed and an inconsistent application of the codebase's own ownership invariant.
- **Evidence:** `packages/server/src/export/image-resolver.ts:29-55` (unguarded), `docx.renderer.ts:330`, vs guarded `epub.renderer.ts:87` and `images.references.ts:154,167`. The F-12 injection commit did not add the guard; no test asserts cross-project exclusion.
- **Found by:** Security & Code Quality (impact raised Low→Medium on verification)

### [F-5] `EditorPage.tsx` remains a large orchestration hub
- **Category:** 2 (god object — residual)
- **Impact:** Medium
- **Explanation:** Despite the F-1 render decomposition, the component still owns ~23 `useState`/`useRef`, coordinates ~14 child hooks, and hand-threads shared primitives (the single `mutation` instance, busy/lock refs) into multiple controllers — the codebase's highest-fan-out file and riskiest place to change. The concentration is partly irreducible (cross-cutting save/lock/busy invariants genuinely converge here).
- **Evidence:** `packages/client/src/pages/EditorPage.tsx` (1062 lines, 23 useState/useRef occurrences).
- **Found by:** Structure & Boundaries

### [F-6] `search.service` is a cross-domain hub
- **Category:** 3 (tight coupling) — also 4 (high/unstable dependencies)
- **Impact:** Medium
- **Explanation:** A leaf-named feature imports five sibling server domains (`images.references`, `snapshots/labels`, `snapshots/content-hash`, `velocity.injectable`, `stores`) because project-wide replace-all reaches into refcount diffing, auto-snapshot labeling, hashing, and velocity recording — the most unstable/high-fan-out module (432 lines).
- **Evidence:** `packages/server/src/search/search.service.ts:16-23`.
- **Found by:** Coupling & Dependencies (finding's original "6 domains" corrected to 5 on verification)

### [F-7] Hidden side effects in mutation services
- **Category:** 12 (hidden side effects) — also 6 (leaky abstraction)
- **Impact:** Medium
- **Explanation:** `updateChapter` (a "PATCH" by signature) also bumps the parent project's `updated_at`, diffs image refcounts, and fires post-commit velocity `recordSave`; `restoreSnapshot`/`replaceInProject` additionally create auto-snapshots. Each carries an explicit `F-8` JSDoc — a known, annotated trade-off rather than a hidden one, but still exceeds what the signatures suggest.
- **Evidence:** `packages/server/src/chapters/chapters.service.ts:42-153`, `snapshots/snapshots.service.ts:96-266`, `search/search.service.ts:212-414`.
- **Found by:** Coupling & Dependencies, Error Handling & Observability (merged)

### [F-8] Inconsistent dev-logging guard between sibling helpers
- **Category:** 34 (inconsistent error/logging conventions)
- **Impact:** Low
- **Explanation:** `devWarn.ts` uses `import.meta.env?.DEV` — the exact optional-chain that `clientLog.ts` deliberately replaced (comment `[S5]`) as a "silent everywhere" failure mode — leaving two sibling helpers in the same directory using opposite conventions for the identical decision.
- **Evidence:** `packages/client/src/errors/devWarn.ts:3` vs `clientLog.ts:17-30`.
- **Found by:** Error Handling & Observability

### [F-9] Hard-coded color hex values outside any constants/theme module
- **Category:** 28 (magic numbers/strings)
- **Impact:** Low
- **Explanation:** The fallback `"#999"` is inlined three times in `DashboardView.tsx`, the brand accent `#6B4720` is duplicated as a literal in `ProgressStrip.tsx`, and `statusColors.ts` hard-codes five status→hex mappings with no link to the server's `chapter_statuses` seed table.
- **Evidence:** `packages/client/src/components/DashboardView.tsx:250,262,325`, `ProgressStrip.tsx:97`, `packages/client/src/statusColors.ts:1-7`.
- **Found by:** Error Handling & Observability

### [F-10] `SqliteProjectStore` pass-through delegator / single-implementation abstraction
- **Category:** 7 (over-abstraction) — also 10 (anemic)
- **Impact:** Low
- **Explanation:** The class is ~296 lines of one-line forwards to repo free functions, holding no behavior beyond `transaction()`, and wraps the *only* SQLite implementation with no second backend planned; adding a store method requires editing three files in lockstep. The seam still earns its keep for testing/transactions, so this is a borderline maintenance tax, not a clear defect.
- **Evidence:** `packages/server/src/stores/sqlite-project-store.ts:33-296` (e.g. `insertProject(d){return projectsRepo.insert(this.db,d)}`).
- **Found by:** Structure & Boundaries, Coupling & Dependencies (merged)

### [F-11] Liveness/migration observability gaps
- **Category:** 21 (no observability plan)
- **Impact:** Low-Medium
- **Explanation:** `/api/health` unconditionally returns `{status:"ok"}` with no DB-readiness check (an orchestrator could route to an instance with a broken SQLite handle), and `db.migrate.latest()` runs with no logging of which/that migrations applied. No metrics/traces exist — defensible for a single-user app, but an unaddressed gap with no documented plan.
- **Evidence:** `packages/server/src/app.ts:50-52`, `db/connection.ts:39-50`.
- **Found by:** Error Handling & Observability

### [F-12] New API surface requires coordinated multi-file edits (shotgun surgery)
- **Category:** 9 (shotgun surgery)
- **Impact:** Low
- **Explanation:** A single new endpoint touches `api/client.ts` + `errors/scopes.ts` + `strings.ts` + server service/routes/types + the store slice. This is the cost of the (otherwise excellent) externalized-strings + centralized-error-mapping + layered design; documented as intentional in CLAUDE.md, so flagged as a structural cost, not a defect.
- **Evidence:** `scopes.ts`, `strings.ts`, `api/client.ts`, plus server service/types.
- **Found by:** Structure & Boundaries

### [F-13] Presentation/progress math in the UI
- **Category:** 25 (business logic in the UI)
- **Impact:** Low
- **Explanation:** `ProgressStrip` computes `hasTarget`, `percentage = Math.min(100, current/target*100)`, and `aria-valuenow` client-side — a thin slice of business rule in a component. Mitigated heavily: the substantive velocity math (remaining words, required pace, projections) is correctly server-owned in `velocity.service.ts`.
- **Evidence:** `packages/client/src/components/ProgressStrip.tsx:38-40,87-96`.
- **Found by:** Error Handling & Observability

### [F-14] Module-level mutable singletons (`store`, `db`)
- **Category:** 1 (global mutable state)
- **Impact:** Low
- **Explanation:** `let store` / `let db` reached via `getProjectStore()`/`getDb()` couple every service to init order and prevent two app instances in one process. Genuine global mutable state, but standard for a single-process app and well-guarded (see S-15) — low severity.
- **Evidence:** `packages/server/src/stores/project-store.injectable.ts:5`, `db/connection.ts:4`.
- **Found by:** Structure & Boundaries

### [F-15] Server-side export HTML not run through a sanitizer
- **Category:** 30 (security as an afterthought)
- **Impact:** Low
- **Explanation:** Export HTML is produced by `generateHTML(...)` and shipped without a server-side DOMPurify pass; only the client preview/snapshot views sanitize. Titles/captions are escaped and the input is Zod-validated TipTap JSON bounded by the server extension set, so practical risk is low — but the exported `.html` becomes the unsanitized sink if a future extension widens the allowed node/attr set.
- **Evidence:** `packages/server/src/export/export.renderers.ts:33-41,100-149`.
- **Found by:** Security & Code Quality

## Coverage Checklist

### Flaw/Risk Types 1–34
| # | Type | Status | Finding |
|---|------|--------|---------|
| 1 | Global mutable state | Observed | F-14 |
| 2 | God object | Observed (residual) | F-5 |
| 3 | Tight coupling | Observed | F-6, F-1 |
| 4 | High/unstable dependencies | Observed | F-6 |
| 5 | Circular dependencies | Not observed | — (verified clean: repos never import services; client cycles broken via `.types`) |
| 6 | Leaky abstractions | Observed | F-1, F-7 |
| 7 | Over-abstraction | Observed | F-10 |
| 8 | Premature optimization | Not observed | — |
| 9 | Shotgun surgery | Observed | F-12 |
| 10 | Feature envy / anemic domain | Observed (mild) | F-10 |
| 11 | Low cohesion | Not observed | — |
| 12 | Hidden side effects | Observed | F-7 |
| 13 | Inconsistent boundaries | Not observed | — |
| 14 | Distributed monolith | Not applicable | Monolith — single process/DB |
| 15 | Chatty service calls | Not applicable | In-process sync calls; N+1 actively avoided (`whereIn` batching) |
| 16 | Synchronous-only integration | Not applicable | No external integrations/queues |
| 17 | No clear ownership of data | Observed | F-1 |
| 18 | Shared database across services | Not applicable | Single DB, single service |
| 19 | Lack of idempotency | Observed (latent) | F-1 (refcount delta-mutation; safety rests on client retry contract) |
| 20 | Weak error handling strategy | Not observed | — (strength S-4 instead) |
| 21 | No observability plan | Observed | F-11 |
| 22 | Configuration sprawl | Observed | F-3 |
| 23 | Dependency injection misuse | Not observed | — (DI is a strength S-12) |
| 24 | Inconsistent API contracts | Not observed | — (minor success-body wrinkles noted, below threshold) |
| 25 | Business logic in the UI | Observed | F-13 |
| 26 | Poor transactional boundaries | Not observed | — (verified: every multi-write flow wrapped in `store.transaction`) |
| 27 | Temporal coupling | Observed | F-2 |
| 28 | Magic numbers/strings everywhere | Observed | F-9 |
| 29 | "Utility" dumping ground | Not observed | — (`utils/` dirs narrowly scoped) |
| 30 | Security as an afterthought | Observed | F-4, F-15 |
| 31 | Dead code / unused dependencies | Not observed | — |
| 32 | Missing/inadequate test coverage | Not observed | — (strong critical-path coverage) |
| 33 | Hard-coded credentials or secrets | Not observed | — (grep clean; no `.env`/key files committed) |
| 34 | Inconsistent error/logging conventions | Observed | F-8 |

### Strength Categories S1–S14
| # | Category | Status | Finding |
|---|----------|--------|---------|
| S1 | Clear modular boundaries | Observed | S-1, S-11 |
| S2 | High cohesion | Observed | S-15 |
| S3 | Loose coupling | Observed | S-12 |
| S4 | Dependency direction is stable | Observed | S-2 |
| S5 | Dependency management hygiene | Observed | S-11 |
| S6 | Consistent API contracts | Observed | S-5 |
| S7 | Robust error handling | Observed | S-4 |
| S8 | Observability present | Observed | S-6 |
| S9 | Configuration discipline | Observed | S-14 |
| S10 | Security built-in | Observed | S-8, S-9, S-10 |
| S11 | Testability & coverage | Observed | S-13 |
| S12 | Resilience patterns | Observed | S-3 |
| S13 | Domain modeling strength | Observed | S-7 |
| S14 | Simple, pragmatic abstractions | Observed | S-11 |

## Hotspots

Top 3 to review:
1. `packages/server/src/images/images.references.ts` (+ its five callers and `images.service.ts`) — the diffuse-ownership/idempotency hotspot (F-1); the column has no single authority and the corrupt-JSON branches carry invisible semantics.
2. `packages/client/src/hooks/useEditorMutation.ts` & `packages/client/src/pages/EditorPage.tsx` — the strong but fragile core: load-bearing ordered save pipeline (F-2) concentrated in the highest-fan-out component (F-5). The trust-critical code that most rewards careful change.
3. `packages/server/src/export/` (`image-resolver.ts`, renderers) — the export surface where the project-ownership guard is missing (F-4) and server HTML is unsanitized (F-15); the one place the codebase's own security invariants are applied inconsistently.

## Next Questions

1. Should `images.reference_count` have a single authority (e.g. always recompute, or a DB trigger/derived view) rather than five delta-mutators plus one recompute path?
2. Is the export `resolveImage` path's lack of a `project_id` ownership check intentional, or should it mirror the EPUB cover guard — and is bulk/cross-project export ever on the roadmap?
3. Should the `DB_PATH` inline-config branch in `index.ts` be collapsed into `createKnexConfig()`/`getDbPath()` to restore the documented single-owner contract?
4. Does the deployment target need a readiness probe (DB-connectivity health check) and migration-applied logging before the Docker/static-serving phase lands?
5. Is the `SqliteProjectStore` pass-through layer worth its three-file edit tax given no second backend is planned, or does the transaction/test seam justify keeping it?

## Analysis Metadata

- **Agents dispatched:**
  - Structure & Boundaries (flaws 1,2,9,10,11,13,29; strengths S1,S2,S13,S14)
  - Coupling & Dependencies (flaws 3,4,5,6,7,8,23,27; strengths S3,S4,S5)
  - Integration & Data (flaws 14,15,16,17,18,19,24,26; strengths S6,S12)
  - Error Handling & Observability (flaws 12,20,21,22,25,28,34; strengths S7,S8,S9)
  - Security & Code Quality (flaws 30,31,32,33; strengths S10,S11)
  - Verifier (read-back confirmation, dedup, impact/category validation)
- **Scope:** ~85 non-test source files across `packages/{shared,server,client}`; `.devcontainer/` excluded per CLAUDE.md.
- **Raw findings:** 38 (19 strengths + 19 flaw candidates across specialists)
- **Verified findings:** 30 (15 strengths + 15 flaws)
- **Filtered/merged out:** 8 (3 merges: F-struct-2≡F-coup-7, F-coup-3≡F-integ-1, F-coup-4≡F-err-1; plus strength consolidations); 0 dropped as false positives
- **By impact (flaws):** 7 Medium, 1 Low-Medium, 7 Low
- **By impact (strengths):** 10 High, 5 Medium
- **Steering files consulted:** CLAUDE.md (root); docs/dependency-licenses.md (referenced)
