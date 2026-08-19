# Architecture Report — smudge

**Date:** 2026-08-11
**Commit:** b911d91e5e0e7aecdeb07cd0a2fb9a942a22573b
**Languages:** TypeScript (Node.js 22 / Express 4 backend, React 19 / Vite / TipTap v2 frontend), better-sqlite3 + Knex, Zod, Vitest + Playwright
**Key directories:** `packages/shared/`, `packages/server/`, `packages/client/`, `e2e/`, `scripts/`
**Scope:** Full repository (`.devcontainer/` excluded per project policy; `packages/*/dist/` excluded as build output)

## Repo Overview

Smudge is a single-user, no-auth, single-process web application for writing long-form fiction and non-fiction, organized as projects containing chapters — a self-hosted replacement for Google Docs for book-length work. It is an npm-workspaces monorepo with three packages: `shared` (types, Zod schemas, `countWords()`, TipTap JSON utilities, imported isomorphically), `server` (Express API layered `Routes → Services → ProjectStore facade → Repositories`, better-sqlite3 through Knex, a typed `AppError` taxonomy, and eleven domain modules: projects, chapters, chapter-statuses, settings, velocity, snapshots, images, search, export, outtakes, backup), and `client` (a React SPA whose editor save-pipeline is built from a family of purpose-built hooks — `useEditorMutation`, `useEditorMutationMachine`, `useAbortableSequence`, `useAbortableAsyncOperation` — plus centralized error-mapping and string-externalization layers). Roughly 180 non-test source files, ~24k non-test lines, ~86k lines including tests, with enforced coverage thresholds (95/85/90/95) and 19+ architecture-decision logs under `docs/roadmap-decisions/`.

242 commits have landed since the previous report (2026-07-11), dominated by Phase 4c.2 (outtakes) and its review rounds.

The codebase remains unusually disciplined, and the findings skew accordingly: the confirmed flaw list is long but 20 of 35 items are Low impact, and most are *consistency* defects — a good pattern applied to three of four sibling sites. The two High-impact flaws are a genuine security gap in the trash-purge path and a coverage hole in the snapshot-restore controller. The dominant structural theme is **the newest module teaching the older ones**: outtakes was built with a stricter corruption gate, single-transaction liveness checks, `.strict()` schemas, and a discriminating label-length error code, and in each case its older siblings were left on the weaker pattern.

---

## Strengths

### [S-01] Server layering has no repository leaks
- **Category:** S1 (Clear modular boundaries), also S4
- **Impact:** High
- **Explanation:** Exactly one production file imports a `*.repository` module; no route, service, or helper reaches past the `ProjectStore` facade. The documented `Routes → Services → Store → Repositories` rule is a fact about the tree, not an aspiration.
- **Evidence:** `packages/server/src/stores/sqlite-project-store.ts:26-33` — `import * as projectsRepo from "../projects/projects.repository";` ×8, the only non-test occurrences. `grep -rn "\.repository" packages/server/src` → 8 hits here, 11 in `__tests__/`, zero elsewhere.
- **Found by:** Structure & Boundaries, Coupling & Dependencies (independent agreement)

### [S-02] Zero import cycles across the non-test source tree
- **Category:** S3 (Loose coupling)
- **Impact:** High
- **Explanation:** The full resolved import graph — including `import type`, `export … from`, dynamic `import()`, and `@smudge/shared` subpath exports — is a DAG. The verifier rebuilt the graph independently over a *superset* of files (180 vs the specialist's 161, adding `scripts/` and `e2e/`) and found 0 unresolved specifiers and 0 cycles, counting type-only edges.
- **Evidence:** Whole repo; the only side-effect import is `packages/client/src/main.tsx:11` → `./index.css`.
- **Found by:** Coupling & Dependencies
- **Caveat:** Nothing enforces this — see [F-09].

### [S-03] Package dependency direction is strictly one-way
- **Category:** S4 (Stable dependency direction)
- **Impact:** Medium *(downgraded from High: in a three-package monorepo where `shared` is by construction the leaf, this is closer to structural than hard-won)*
- **Explanation:** `shared` has no production import of `server` or `client`; neither leaf package imports the other. The only cross-package references in production source are cross-referencing comments.
- **Evidence:** `grep -rn "@smudge" packages/shared/src` (non-test) → 7 hits, all comments. `packages/client/src/sanitizer.ts:78,103` and `packages/server/src/export/export.renderers.ts:36,58,72` are comments, not imports. Five+ shared parity tests read sibling sources as *text* via `readFileSync` — not module edges.
- **Found by:** Coupling & Dependencies

### [S-04] The `shared` barrel encodes its own browser/node boundary
- **Category:** S1 (Clear modular boundaries)
- **Impact:** Medium
- **Explanation:** The barrel deliberately does not re-export the node-only (`node:fs`) and TipTap-heavy modules; they are reachable only through named subpath exports, with the concrete failure mode written into the comment.
- **Evidence:** `packages/shared/src/index.ts:47-56` — "deliberately NOT re-exported here… the eager `import { lstatSync } from "node:fs"` throws at React-app boot time"; `packages/shared/package.json:7-20` defines `./node-fs-helpers` and `./editor-extensions`. Verified: `grep -n "editorExtensions\|findDirectoryConflict" packages/shared/src/index.ts` → zero hits.
- **Found by:** Structure & Boundaries, Coupling & Dependencies (independent agreement)

### [S-05] The `outtakes` module is a vertical slice with recorded domain reasoning
- **Category:** S13 (Domain modeling strength)
- **Impact:** Medium
- **Explanation:** Routes/service/repository/types for one bounded concept, with the domain contract stated in the service header and each decision tied to its failure mode — no word count, images stripped authoritatively on capture, notes deliberately preserved, parent-liveness on every operation.
- **Evidence:** `packages/server/src/outtakes/outtakes.service.ts:6-31` — "Images are stripped on the way in (authoritative) so the drawer never holds image references — this is what keeps outtakes out of every image-refcount and export path structurally." All four operations (`createOuttake:39`, `listOuttakes:60`, `updateOuttakeLabel:72`, `deleteOuttake:83`) open with `store.transaction(...)`, without exception.
- **Found by:** Structure & Boundaries

### [S-06] Prior finding F-17 was fixed properly, with the reasoning recorded
- **Category:** S2 (High cohesion)
- **Impact:** Medium
- **Explanation:** The ZIP byte-format/security layer was pulled out of backup lifecycle orchestration into a dependency-free module, and the header argues why a *module* rather than a region.
- **Evidence:** `packages/server/src/backup/backup-zip-format.ts:1-19` — "They live in their own module — NOT merely their own region — so both production (runRestore) and the security-critical bomb/zip-slip tests import the SAME byte-offset logic." `backup-core.ts:23,38-39` re-exports every symbol, so no importer broke.
- **Found by:** Structure & Boundaries

### [S-07] Single-owner conventions are actually single-owner
- **Category:** S14 (Simple, pragmatic abstractions)
- **Impact:** Medium
- **Explanation:** Two of the steering file's single-owner claims survive exhaustive grep: `localStorage` is touched by exactly two client modules, and every native `<dialog>` component routes through `useDialogLifecycle`.
- **Evidence:** `packages/client/src/hooks/usePersistedState.ts:70,162` and `useContentCache.ts:7,18,28,48` (the documented exception) are the only production `localStorage` sites. `grep -rln "<dialog"` and `grep -rln useDialogLifecycle` return the identical five-file set.
- **Found by:** Structure & Boundaries

### [S-08] Hook→component edges are type-only
- **Category:** S3 (Loose coupling)
- **Impact:** Low *(downgraded from Medium: three imports total)*
- **Explanation:** Components import hooks freely; hooks never import a component *value*. The three hook→component edges that exist are all `import type`, closing the one direction that would create a runtime cycle.
- **Evidence:** `packages/client/src/hooks/useEditorMutation.ts:2`, `useSnapshotController.ts:12` (`import type { EditorHandle }`), `useSnapshotState.ts:11` (`import type { SnapshotPanelHandle }`) — the only three non-test `from "../components` lines.
- **Found by:** Coupling & Dependencies

### [S-09] Supply-chain tooling is a clean pure-core / IO-shell split
- **Category:** S5 (Dependency management hygiene)
- **Impact:** Medium
- **Explanation:** The cooldown gate's decision logic is a pure, unit-tested, coverage-instrumented module; the network/fs/exit shell is thin and coverage-excluded with the exclusion justified in config.
- **Evidence:** `scripts/dep-cooldown-core.mjs` (674 lines, 19 exports) vs `scripts/dep-cooldown.mjs` (288); `vitest.config.ts:30-35` excludes only the shell. Independently verified: of 41 production dependencies across all four manifests, 39 appear in `docs/dependency-licenses.md` (the two absentees are the internal `@smudge/shared` workspace package), with two dual-license elections documented.
- **Found by:** Coupling & Dependencies

### [S-10] The API error/status contract is enforced from both ends and pinned by tests
- **Category:** S6 (Consistent API contracts), with S7
- **Impact:** High
- **Explanation:** `ERROR_STATUS_ALLOWLIST` is a single machine-readable `ReadonlySet` guarded at *both* ends — the `AppError` constructor throws on an off-allowlist status (catching taxonomy bugs the handler's `instanceof` early-return would miss) and the global handler clamps library-supplied statuses while preserving `rawStatus` in the log.
- **Evidence:** `packages/server/src/errors/appError.ts:40,64-70` — `if (!ERROR_STATUS_ALLOWLIST.has(status)) throw new TypeError(...)`; `packages/server/src/app.ts:105-110` — `const status = ERROR_STATUS_ALLOWLIST.has(rawStatus) ? rawStatus : rawStatus >= 400 && rawStatus < 500 ? 400 : 500;`. Verified independently: `grep -rn "204" packages/server/src/*/*.routes.ts` returns exactly the five DELETEs plus the two documented non-DELETE mutations, all body-less. `error-taxonomy-contract.test.ts` pins status+code+message per failure path; `wire-type-parity.test.ts` compile-asserts row/wire parity *and* that un-narrowed rows do not match.
- **Found by:** Integration & Data, Error Handling & Observability (merged — two ends of one mechanism)

### [S-11] The outtake degraded-read contract is carried on the wire and honored at every consumer
- **Category:** S6 (Consistent API contracts)
- **Impact:** Medium
- **Explanation:** A corrupt row is substituted with a doc that *passes* `TipTapDocSchema`, so "empty" cannot be read as "safe"; the flag is optional-and-omitted on the happy path (never a stale `false`), and every consumer tests the flag rather than emptiness.
- **Evidence:** `packages/server/src/outtakes/outtakes.repository.ts:64-65` — `...(corrupt ? { content_corrupt: true as const } : {})`; consumers at `OuttakeCard.tsx:233,278` (clipboard copy refuses and says why) and `EditorPage.tsx:571`.
- **Found by:** Integration & Data

### [S-12] Retry policy is partitioned by idempotency, with explicit no-retry recovery for non-idempotent mutations
- **Category:** S12 (Resilience patterns)
- **Impact:** High
- **Explanation:** The only auto-retried call in the client is the idempotent `PATCH /api/chapters/{id}`; every non-idempotent POST refetches instead of re-POSTing and says so in a comment tied to its specific data-loss risk. The retry loop re-reads the latest content each attempt and shares the request's `AbortSignal` with its backoff sleep.
- **Evidence:** `packages/client/src/hooks/useProjectEditor.ts:373-379` (`const latest = latestContentRef.current` inside the loop), `:517-519` (`await sleep(backoffMs, s)`). Non-idempotent recovery: `useChapterCrud.ts:250-266`, `OuttakesPanel.tsx:296-307`, `useFindReplaceController.ts:334`. Verified: all six `MAX_RETRIES`/`SAVE_BACKOFF_MS` hits are in one file; there is no second retry loop anywhere.
- **Found by:** Integration & Data
- **Honest gap (verified, ships with this strength):** `grep -rn "AbortSignal.timeout\|requestTimeout\|headersTimeout"` across client and server production source returns **zero hits**. A stalled connection leaves the save promise pending with `saveStatus === "saving"` — a stuck indicator, not data loss, since the draft cache and `beforeunload` guard hold the text. This is about HTTP request timeouts and does not contradict [S-13]'s `REGEX_DEADLINE_MS`, which is a CPU-time bound on one endpoint.

### [S-13] Untrusted-input defenses on the search/replace surface are layered and fail closed
- **Category:** S10 (Security built-in)
- **Impact:** High
- **Explanation:** Five independent bounds on one endpoint, each guarding a distinct amplification route, all throwing *inside* the transaction so a partial replace never persists; neighbouring TipTap walkers fail closed rather than guessing.
- **Evidence:** `packages/server/src/search/search.service.ts:33` (`REGEX_DEADLINE_MS = 2_000`, checked at `:139` and `:255`), `:66-71` (compiles with the same flags runtime uses so a `\p{L}` pattern 400s instead of 500-ing later), `:284` (`max_output_chars` applied *during* per-match expansion "so pathological `$'` amplification can't allocate gigabytes of intermediate strings"), `:319-321` (`Buffer.byteLength` vs `MAX_CHAPTER_CONTENT_BYTES`), `:346-360` (all four typed throws → 400). Fail-closed neighbours: `images.references.ts:141-147` ("aborting diff to avoid mass decrement"), `:207-222` (`scanChapterContentForImage` returns `"unreadable"`, blocking an irreversible delete).
- **Found by:** Integration & Data

### [S-14] The TypeError-vs-SyntaxError distinction is load-bearing and applied at all four body-read sites
- **Category:** S7 (Robust error handling)
- **Impact:** Medium
- **Explanation:** A `TypeError` during a body read means the stream broke post-headers (the server never flushed a body), so it routes to NETWORK/transient rather than BAD_JSON — which would otherwise raise a *false* "possibly committed" lock banner.
- **Evidence:** `packages/client/src/api/client.ts:220-222` — "a TypeError here is a stream-level network fault… Classifying it as BAD_JSON drives the 'possibly committed' UX — but the server never flushed a body". The same ladder appears at `readErrorEnvelope` (`:133-140`), `apiFetch` 2xx (`:207-231`), `projects.export` (`:359-376`), `images.upload` (`:468-483`). No fifth body-read site exists.
- **Found by:** Error Handling & Observability

### [S-15] The single-owner error mapper is empirically complied with, not just documented
- **Category:** S7 (Robust error handling)
- **Impact:** High
- **Explanation:** "Raw `err.message` must never reach the UI" holds with zero violations across the client, and the mapper is hardened against prototype-pollution and inherited-property reads on server-controlled `extras`.
- **Evidence:** `packages/client/src/errors/apiErrorMapper.ts:129-133` — `Object.hasOwn(scope.byCode, err.code)` plus a `typeof === "string"` check; `api/client.ts:93-104` — `Object.create(null)`, skips `__proto__`/`constructor`/`prototype`, caps at `MAX_EXTRAS_KEYS`. Verified: `grep -rn "err.message|error.message"` across non-test client source → 6 hits, all legitimate (four synthesizing `[dev]`-prefixed developer copy, two reading `mapApiError(...).message`). Used at 66 call sites across 23 non-test files.
- **Found by:** Error Handling & Observability
- **Caveat:** Compliance is review-enforced. Unlike [S-23]'s rules, there is no red test if a new call site skips the mapper.

### [S-16] Request correlation with a bounded inbound-id allowlist and a zero-noise access log
- **Category:** S8 (Observability present)
- **Impact:** Medium
- **Explanation:** Every request gets a correlation id — an inbound `X-Request-Id` only if it matches a bounded charset/length pattern, otherwise a fresh UUID — bound into a child logger, echoed in the response header, with the access log at `debug` so it costs nothing at the default level.
- **Evidence:** `packages/server/src/requestContext.ts:22` — `const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;`; `:45-51` — `req.log = logger.child({ req_id, method, path })`, `res.setHeader("X-Request-Id", id)`. Mounted at `app.ts:38` ahead of the routers; `globalErrorHandler` prefers `req.log` (`app.ts:111-118`) so a 500 carries the same id.
- **Found by:** Error Handling & Observability

### [S-17] Log-flood dedup on the raw-bytes fallback path
- **Category:** S8 (Observability present)
- **Impact:** Low
- **Explanation:** When canonicalization fails, the warn fires once per *unique* corrupt content (sha256-keyed) and drops to `debug` on repeats, so a corrupt chapter row hit repeatedly cannot bury unrelated warnings.
- **Evidence:** `packages/server/src/snapshots/content-hash.ts:79-91` — `const alreadyWarned = warnedFallbackDigests.has(rawDigest); … if (!alreadyWarned) logger.warn(…) else logger.debug(…)`.
- **Found by:** Error Handling & Observability
- **Adjudication note:** Coupling & Dependencies reported this same code as a *flaw* (premature optimization: a 256-entry hand-rolled LRU plus a test-only reset export, guarding against an "adversarial server" the project explicitly disclaims). The verifier traced the call graph — `canonicalContentHash` runs on manual snapshot create, restore, and project-wide replace, **not** on the auto-save PATCH path — and ruled: the strength survives but is narrow (hence Low), and the flaw does not clear the reporting bar. The ~18 lines of bounding machinery are mildly over-built for a single-user process, and the code's own "adversarial" justification does contradict the project's stated premise, but bounded, commented, test-isolated memory hygiene is not worth a reviewer's attention.

### [S-18] Best-effort side effects are logged with domain IDs, near-consistently
- **Category:** S8 (Observability present)
- **Impact:** Medium
- **Explanation:** Post-commit best-effort side effects log `{err, <domain-id>}` with a message naming the operation — which is what makes the accepted F-2 trade-off (no request correlation in the service layer) workable, since for a single writer the domain ID *is* the correlation key.
- **Evidence:** `packages/server/src/chapters/chapters.service.ts:132-135,194-197,300-303`, `search/search.service.ts:376-379`, `snapshots/snapshots.service.ts:242-245` all use `logger.error({ err, project_id, chapter_id }, "Velocity updateDailySnapshot failed … (best-effort)")`; `images.reaper.ts:53,71,85`, `db/purge.ts:65`, `images.service.ts:120` follow the same shape across ~12 sites.
- **Found by:** Error Handling & Observability
- **Exceptions that must be named for the claim to be accurate:** two unlogged deviations, both reported as flaws — `chapters.service.ts:145-155` ([F-31]) and `backup-core.ts:359-361` ([F-16]).

### [S-19] One owner for every persistence location, with the reasoning for each recorded
- **Category:** S9 (Configuration discipline)
- **Impact:** Medium
- **Explanation:** All four persistence locations derive from one module; `DB_PATH` defaults *through* `DATA_DIR` so the two cannot silently point at unrelated directories, and `getImagesDir(dataDir?)` takes an explicit override precisely so backup/restore/purge/reaper thread their own dir instead of reading env.
- **Evidence:** `packages/server/src/config/paths.ts:25` — `return process.env.DB_PATH ?? path.join(getDataDir(), "smudge.db");`; `:50-56` documents why `getBackupsDir()` is cwd-relative ("writing them inside the data directory would fold each archive into the next one"). Verified: `"../../data"` appears once, `join(process.cwd(), "backups")` once, the `"images"` segment once. Server production env reads total six lines across three files, each inside a validating owner.
- **Found by:** Error Handling & Observability

### [S-20] Shared constants make divergence unrepresentable rather than merely forbidden
- **Category:** S9 (Configuration discipline)
- **Impact:** Medium
- **Explanation:** Where two representations of one limit used to sit side by side with a comment insisting they agree, the second was *deleted* and derived instead; the unit a cap is measured in is stated because a grapheme-vs-code-unit mismatch already produced a real bug.
- **Evidence:** `packages/shared/src/constants.ts:57` — ``MAX_IMAGE_UPLOAD_LABEL = `${MAX_IMAGE_UPLOAD_BYTES / 1024 / 1024} MB` ``; `packages/server/src/constants.ts:11-19` — the `"5mb"` string twin "was deleted and the divergence made unrepresentable rather than merely forbidden"; `packages/shared/src/schemas.ts:196-202` — "the restore path really did compose to store 520 units behind a schema that rejects 501".
- **Found by:** Error Handling & Observability

### [S-21] The note-mark strip discipline holds; no third render path exists
- **Category:** S10 (Security built-in)
- **Impact:** High
- **Explanation:** Editor-only `note` marks (the writer's private commentary) cannot reach a beta-reader file: the single HTML render path strips them where the extensions are registered, DOCX strips at its own walker entry, the server adds an independent second layer, and the remaining JSON walker emits no marks by construction.
- **Evidence:** `packages/shared/src/editorExtensions.ts:60-64` — `return generateHTML(stripNoteMarks(content) as …, editorExtensions);`; `packages/server/src/export/docx.renderer.ts:480` — `const stripped = stripNoteMarks(content);`; `export/export.renderers.ts:87` — `stripNoteSpans(stripDisallowedImages(renderEditorHtml(content)))`. `toPlainText` (`tiptap-plaintext.ts:26-48`) emits only `node.text` and `"\n"`, never marks — which is why `OuttakeCard.tsx:238` writing `plainText` to the clipboard is safe on outtake JSON that deliberately retains notes.
- **Found by:** Security & Code Quality, Structure & Boundaries (the `generateHTML` clause)
- **Exception named to keep the claim accurate:** "exactly one `generateHTML` call site" is true for *production* only. Two shared test files call it directly (`editorExtensions.test.ts:81`, `noteMark.test.ts:26,33,42,49`) — deliberately, since `noteMark.test.ts:26` is the test proving an unstripped doc *does* leak.

### [S-22] One fail-closed image-src rule encoded three times, held together by a test that reads the regexes out of source
- **Category:** S10 (Security built-in)
- **Impact:** High
- **Explanation:** Where the accepted F-16 trade-off forbids unifying the client and server URI rules, the codebase substituted a mechanical parity check: a shared test extracts all three regex literals *from their source files* and runs one corpus through all three, so drift turns red instead of silently deleting images from exports.
- **Evidence:** `packages/shared/src/__tests__/image-src-allowlist-parity.test.ts:44-70` — `readFileSync(CLIENT_SANITIZER)` then `matchAll(/^const ALLOWED_URI_REGEXP =\s*\n?\s*\/(.+)\/i;$/gm)`, asserting each literal is found exactly once so a rename fails loudly rather than passing on zero regexes. Header records the real bug it caught ("exactly what a `?query` suffix did before this column existed"). Layered fail-closed behaviour confirmed at `client/src/sanitizer.ts:118-131` (private DOMPurify instance, `uponSanitizeAttribute` hook closing 3.x's `DATA_URI_TAGS` carve-out) and `export.renderers.ts:64-68` (server drops the whole `<img>`).
- **Found by:** Security & Code Quality

### [S-23] The lint rules that enforce architectural invariants are themselves unit-tested against a real ESLint instance
- **Category:** S11 (Testability & coverage)
- **Impact:** High
- **Explanation:** The `no-restricted-syntax` rules backing the save-pipeline and string-externalization invariants are not trusted to be correct — a harness boots a real `ESLint` with the repo's own config and lints synthetic fixtures, asserting each rule fires on the plain form, union form, and nested generics. This closes the "the guard silently stopped matching" failure mode that makes most lint-based invariants rot.
- **Evidence:** `packages/client/src/__tests__/eslintRuleHarness.ts:22-27` — `new ESLint({ cwd: REPO_ROOT, overrideConfigFile: resolve(REPO_ROOT, "eslint.config.js") })`. `editorEntryPointSurface.test.ts` complements it by snapshotting the editor-mutating entry-point name-set, with its failure direction deliberately chosen ("a loud false-RED … not a silent false-GREEN").
- **Found by:** Security & Code Quality
- **Verification:** The verifier *ran* the four suites read-only — 44 tests, 4 files, all passing. This is enforcement, not documentation.

### [S-24] No untested-file blind spot in the coverage gate
- **Category:** S11 (Testability & coverage)
- **Impact:** Medium
- **Explanation:** `vitest.config.ts` does not set `coverage.all`, which normally hides never-imported files from the report entirely — yet no source file is missing, so the global thresholds are measured against the true surface.
- **Evidence:** `vitest.config.ts:14-41` (exclusion list, each thin-IO-shell exclusion justified in a comment); `coverage/coverage-final.json`. The verifier enumerated every `.ts/.tsx/.mjs` under the covered roots, applied the config's exclusions independently, and diffed against the report keys: **145 expected source files, 0 missing**; the 15 remaining entries are `db/migrations/*.js`.
- **Found by:** Security & Code Quality
- **Residual weakness:** thresholds are global, not per-file — see [F-02].

### [S-25] No secrets, and a consistent (not half-built) no-auth posture
- **Category:** S10 (Security built-in)
- **Impact:** Low *(downgraded from Medium: absence-of-secrets is table stakes; the coherent posture is the part that carries weight)*
- **Explanation:** A repo-wide credential sweep is clean, `.env*` and `backups/` are gitignored with the reason stated, and the no-auth design is coherent — no partial auth scaffolding, no CORS middleware widening the origin.
- **Evidence:** `.gitignore:76-79`, `:170-173` — "Operational backups (Phase 4b.14) — never commit the writer's manuscript." An independent case-insensitive sweep for `api_key|secret|password|token|credential|private_key` across `packages/*/src`, `e2e/`, `scripts/`, `Makefile` returns only the `SequenceToken` identifier from `useAbortableSequence`. `packages/server/src/app.ts:2,22` imports `helmet`; there is no `cors` import and no `Access-Control-*` header write.
- **Found by:** Security & Code Quality

---

## Flaws/Risks

### [F-01] `purgeOldTrash` recursive-deletes a path built from an unvalidated DB-sourced project id
- **Category:** 30 (Security as an afterthought)
- **Impact:** High
- **Explanation:** The startup trash purge joins `projects.id` straight into a filesystem path and recursive-`rm`s it with no UUID check and no `resolve()`-containment assertion. A hostile backup zip — explicitly in this project's threat model, and the reason ~500 lines of zip defense exist — converts into arbitrary recursive directory deletion on the next server start.
- **Evidence:** `packages/server/src/db/purge.ts:60-67` (`purgeOldTrash`):
  ```ts
  const imageDir = path.join(getImagesDir(resolvedDataDir), projectId);
  await fs.rm(imageDir, { recursive: true, force: true });
  ```
  The full reachability chain was verified: (a) nothing touches `projectId` between the `trx("projects").select("id")` read at `:20-40` and the `fs.rm`; (b) `grep CHECK packages/server/src/db/migrations/` returns nothing — `001_create_projects_and_chapters.js:4` is `table.uuid("id").primary()`, an unconstrained `char(36)` in SQLite; (c) `runRestore` (`backup-core.ts:190-203`) validates the *archive* meticulously — `validateEntryPaths` for zip-slip, `checkDeclaredSizes` for bombs, free-space, typed-filename confirmation — then installs `smudge.db` **verbatim with zero payload inspection**; (d) `index.ts:35` runs the purge on every server start, and the crafted row controls `deleted_at`, so it fires on the first boot after restore — exactly what the restore CLI tells the operator to do next; (e) `grep "fs.rm"` across `packages/server/src` confirms this is the only recursive rm — `deleteProject` never unlinks directories and `deleteImage` (`images.service.ts:207`) unlinks a single file. Secondary sites of the same class (read/unlink, not recursive rm): `images.service.ts:115,207` and `export/image-resolver.ts` via `getImagePath(image.project_id, …)`.
- **Found by:** Security & Code Quality
- **Note:** The specialist confirmed this empirically with a harness run entirely outside the repo (a `projects` row with `id = "../../VICTIM_DIR"` deleted the victim directory; `git status --porcelain` clean afterward). What makes this more than theoretical is that the codebase's own defenses concede the vector — the archive is already treated as hostile, and the DB payload is the one part of it that gets no inspection.
- **Status:** Fixed
- **Status reason:** Added `containedPath(root, ...segments)` to `config/paths.ts` — resolves the join and refuses any result not strictly inside `root`. Routed both DB-sourced path builders through it: `purgeOldTrash`'s image-dir join (moved inside the per-project try/catch, so one hostile row degrades to a logged warning instead of aborting cleanup) and `getImagePath`, which covers the other five call sites, where 5 of 6 pass a raw `row.project_id`. Chose containment over a UUID-shape check deliberately: containment is the security property, and a shape check would have inverted two passing tests whose fixtures use safe non-UUID ids (`p-disk`, `proj-id`). Verified by `/paad:rethink`, which also established by experiment that a DB `CHECK` constraint (the third option considered) cannot work — a restored hostile `smudge.db` carries its own populated `knex_migrations`, so `migrate.latest()` runs nothing (`ran: []`) and the constraint is never created.
- **Status date:** 2026-08-15 09:45 UTC
- **Status commit:** c4a858e3

### [F-02] `useSnapshotController` has no dedicated test; its data-loss-adjacent branches are uncovered
- **Category:** 32 (Missing test coverage for critical paths)
- **Impact:** High
- **Explanation:** Snapshot restore is one of the two server-mutation flows the steering file singles out as load-bearing, yet this hook is the lowest-covered non-migration source file in the repo and has no test file of its own.
- **Evidence:** `coverage/coverage-final.json` — **68.4% statements / 48.9% branches**, versus its sibling `useFindReplaceController.ts` at 89.2 / 76.1 (which *does* have `hooks/__tests__/useFindReplaceController.test.tsx`). Zero-hit statement lines, extracted independently: `128-130, 137-139, 178-183, 212-219, 228, 238-247, 291-306, 362-368, 408-419, 483-492, 511-528, 541-554, 578-582` — i.e. the `committed_but_unreloaded` arm (`packages/client/src/hooks/useSnapshotController.ts:212-247`), the stale-chapter-switch return, flush-failure attribution, every lock/busy refusal, and the whole `snapshot.view` error ladder including `CORRUPT_SNAPSHOT` and 404. The codebase acknowledges the gap in prose rather than closing it — `EditorPageFeatures.test.tsx:3481-3493`: "That specific race is not exercised by a component test here because the surrounding busy guard … blocks every user-facing chapter-switch path." That is precisely the argument for a hook-level test, which the sibling already has. Thresholds in `vitest.config.ts` are global, so the gate cannot see one file at 48.9% branches.
- **Found by:** Security & Code Quality
- **Status:** Fixed
- **Status reason:** `packages/client/src/hooks/__tests__/useSnapshotController.test.tsx` now exists with 37 tests, taking the hook from 68.53% / 48.88% to **99.13% statements / 98.55% branches**. Every branch the finding named is covered: both entry refusals, the mutate callback's `RestoreAbortedError` and stale-chapter-switch returns, all five `MutationResult` stages including `committed_but_unreloaded`, the complete restore error ladder (aborted / network / corrupt / cross-project / 404 / codeless / possibly-committed on **and** off the restored chapter), the `snapshot.view` reason translation, and `onSnapshotBeforeCreate`.
- **Status note:** `mutation.run` is a faithful stand-in rather than a canned-result stub — it actually invokes the mutate callback and maps a throw to `stage:"mutate"` — so the callback's own branches (the `reloadChapterId` scoping, the stale-chapter early return) are exercised rather than bypassed. `mapApiError` is deliberately **not** mocked: messages and the `possiblyCommitted` / `transient` classifications come from the real scope registry, so these tests turn red if `scopes.ts` drifts from what the controller expects.
- **Status caveat:** the residual uncovered lines are the `_exhaustive: never` guard (374-375), which is a compile-time exhaustiveness check and unreachable at runtime by construction. The global thresholds in `vitest.config.ts` still cannot see a single file's coverage — this fix closes the hole but does not close the *class* of hole the finding's last sentence identifies.
- **Status date:** 2026-08-17 07:55 UTC
- **Status commit:** c9f515b3

### [F-03] The chapter-content-write obligation bundle is hand-assembled at three independent sites
- **Category:** 9 (Shotgun surgery)
- **Impact:** Medium *(down from Medium-High)*
- **Explanation:** Three writers to `chapters.content` each open-code the same obligation set — `countWords` → `txStore.updateChapter` → `txStore.updateProjectTimestamp` → `applyImageRefDiff` → post-commit `getVelocityService().updateDailySnapshot`, plus `insertAutoSnapshotIfChanged` at two of the three — each with its own ordering, try/catch, and log string. A new obligation on a content write requires grepping for all three; nothing forces it.
- **Evidence:** `packages/server/src/chapters/chapters.service.ts:99-137`; `packages/server/src/snapshots/snapshots.service.ts:209-246`; `packages/server/src/search/search.service.ts:313-381`.
- **Found by:** Structure & Boundaries
- **Why this is not a restatement of accepted F-19:** F-19's premise is that `updateChapter`/`deleteChapter`'s side effects are *enumerated in the function's doc comment*. That discipline lives only on `chapters.service.ts`; `restoreSnapshot` and `replaceInProject` carry no such enumeration and are not mentioned by F-19. The claim here is about the sequence being triplicated, not about it being undocumented in one place.

### [F-04] The outtakes feature cluster landed inline in `EditorPage` instead of the controller-hook pattern
- **Category:** 13 (Inconsistent boundaries) *(re-typed from 2/3)*
- **Impact:** Medium
- **Explanation:** Snapshots and find-replace each got a `use*Controller` hook taking a typed deps interface. Outtakes did not: `buildOuttakeLabel` (module scope), three state atoms, `captureOp`, `captureInFlightRef`, an 85-line `handleSendSelectionToOuttakes`, and `handleInsertOuttake` all sit in the page body, taking `EditorPage.tsx` to 1,356 lines.
- **Evidence:** `packages/client/src/pages/EditorPage.tsx:46-62` (`buildOuttakeLabel`), `:487-504` (state atoms), `:1004-1113` (`handleSendSelectionToOuttakes`).
- **Found by:** Structure & Boundaries, Coupling & Dependencies (independent agreement)
- **The accepted-F-1 premise genuinely changed.** F-1's load-bearing sentence is *"the residual concentration is irreducible cross-hook coordination, not accidental complexity."* The capture flow's own comment refutes that for itself — `EditorPage.tsx:1023-1025`: *"It never writes editor content, so save-pipeline invariants 1-4 do NOT apply and NO busy/lock guard is needed."* A block that explicitly participates in none of the cross-hook coordination is, by F-1's own definition, not the irreducible residual. Partially blunted: `handleInsertOuttake` sits next to `handleInsertImage` and deliberately shares `guardInsertAtCursor` (`:555-589`), so extracting it would split a deliberately-paired guard. The capture handler is the part with no such tie.
- **Status:** Fixed
- **Status reason:** The capture flow — `buildOuttakeLabel`, the `capturedOuttake` / `outtakesExternalRefreshKey` state, `captureOp`, `captureInFlightRef` and the 85-line `handleSendSelectionToOuttakes` — moved verbatim into `packages/client/src/hooks/useOuttakeCapture.ts`, taking a 9-field `OuttakeCaptureDeps` interface in the same shape as its two siblings (`SnapshotControllerDeps`, 18 fields; `FindReplaceControllerDeps`, 14). `EditorPage.tsx` 1,369 → 1,259 lines (139 deleted, 29 added). The hook takes **no** mutation/lock handles, which was verified rather than inherited from the code comment: the extracted closure captures 13 identifiers from the page and none of them is `mutation`, `editorMachine`, `isActionBusy`, `actionBusyRef` or `editorRef`, and it reaches `toolbarEditor` only through `.state`, never `.chain()`.
- **Status note (scope, and the two deliberate leftovers):** the first leftover is the scope the finding itself carves out; the second is a scope judgement this fix made on its own, and the two should not be read as one. `handleInsertOuttake` stays on the page because it shares `guardInsertAtCursor` with `handleInsertImage` — `/paad:rethink` upgraded that from a code-comment assertion to a verified one: the pairing is a reviewed fix (dedup finding I2, code-review S3/S4, commit `714a9af3`) for two insert paths whose guard sets had demonstrably drifted apart twice, and an earlier review had rejected the same complaint before it was adopted. `outtakeDraft`, by contrast, is **not** carved out by F-04 — it is one of the three state atoms the finding explicitly enumerates (its Evidence range `:487-504` terminates on that `useState`), so excluding it is a fresh judgement made by this fix and not a restatement of the finding. It stays because it belongs to the panel's compose form, not to capture; its lifetime was **not** the reason (a hook called from the page body has the page's lifetime exactly — `App.tsx:23` mounts `EditorPage` with no `key`). Both leftovers now carry a comment saying so, since the residual is exactly what invites a future re-file of this finding.
- **Status correction (the finding overstates its own line-count clause):** F-04's Explanation closes with *"taking `EditorPage.tsx` to 1,356 lines"*, but its argument (and the reason this fix is justified) is the coordination premise it borrows from F-1, not size. F-1 already accepts the file being "the largest file in the client" — conditionally, on the residual being irreducible coordination — and never names a number. Size is a symptom here; the fix was scoped to the block that provably participates in no cross-hook coordination, which is what F-04 actually argues.
- **Status note (the destructive sibling will not inherit the exemption):** roadmap Phase 4c.2a ("cut selection to outtakes", destructive) is planned and the roadmap states it *"touches the save-pipeline invariants and gets its own PR"*. Capture is exempt from invariants 1-4 only because it never writes editor content; the cut does. The hook is therefore named for the one flow it owns rather than for outtakes generally, and its header records why 4c.2a cannot simply be added alongside this handler.
- **Status caveat (what the safety net does and does not pin):** the 19 behavioural cases in `OuttakesEditorEntryPoints.test.tsx` drive a real `EditorPage` mount and passed unmodified across the move — no test was edited. One was added first (commit `4c189ada`) because coverage showed the success arm's `signal.aborted || isStaleProject()` guard partial, and it asserts on the announcement rather than the prepended row: the panel independently refuses a foreign-project row, so a row-based assertion stays green with the guard deleted. Confirmed red against that deletion. `editorEntryPointSurface.test.ts` does **not** guard this refactor — it matches prop *names*, which are unchanged; it stayed green and needed no edit.
- **Status date:** 2026-08-17 10:23 UTC
- **Status commit:** 22bfb586

### [F-05] Image delete's reference scan owns `chapters` but not `chapter_snapshots`
- **Category:** 17 (No clear ownership of data)
- **Impact:** Medium
- **Explanation:** `deleteImage` scans chapters only — deliberately including soft-deleted ones, because "restoring that chapter would produce a broken image if we allowed the delete." `chapter_snapshots` rows hold full TipTap JSON with the same `/api/images/<uuid>` srcs and are equally a restore path; nothing scans them. `restoreSnapshot` then fails closed, making the snapshot permanently unrestorable through supported endpoints.
- **Evidence:** `packages/server/src/images/images.service.ts:156-197` (`deleteImage`, whose only scan source is `listAllChapterContentByProject`); `packages/server/src/snapshots/snapshots.service.ts:172-182` — `return "cross_project_image" as const;` → 409 `CROSS_PROJECT_IMAGE_REF`. Reachable sequence, all supported endpoints: insert image into chapter → snapshot the chapter → delete the image from the chapter → `DELETE /api/images/{id}` returns 204 → restore returns 409, permanently. Aggravators: the user copy is wrong for this case (`STRINGS.snapshots.restoreFailedCrossProjectImage`, `strings.ts:448`, says the images "no longer belong to this project"), and the image delete is irreversible (`images.service.ts:209`).
- **Found by:** Integration & Data
- **Note:** Not covered by accepted F-8, which is about upload idempotency, not the delete-side reference scan. Contrast the outtakes decision recorded in the steering file: outtakes solve the same "table invisible to the ref-counter" problem by stripping images on capture. Snapshots chose neither strip nor scan.
- **Status:** Fixed
- **Status reason:** Fixed at the **restore** end rather than the delete end. `restoreSnapshot` split the two conditions that shared one refusal arm: an image that exists but belongs to another project still returns `cross_project_image` → 409 (adopting another project's asset is not ours to decide), while an image that is simply **gone** now has its node dropped and the prose restored, with `dropped_image_count` returned so the client announces it (`STRINGS.snapshots.restoreDroppedImages`). Reference counts, word count, and the persisted row all use the same stripped content, so the refcounter cannot disagree with what was written. `deleteImage` is unchanged.
- **Status note (why not the delete-side scan):** blocking the delete was the recommended option until `/paad:rethink` verified its premises. Three findings moved it: (1) the claim that it was "the smaller, safer change" was **false** — it needs the snapshot scan *plus* a new error-payload key, new scope copy, a new client branch, and an extension of the separate `/references` endpoint that powers the pre-delete confirm gate, which is otherwise snapshot-blind and would leave an enabled Delete button that 409s by surprise; (2) the 409's existing channel is announce-only and its copy is hard-coded *"Remove it from those chapters first"* — advice a user **cannot follow** for a snapshot; (3) snapshots have **no retention of any kind** (verified whole-repo: no `.limit(`, no scheduler, no reaper touching the table; the only automatic removal is the FK cascade when a chapter row is hard-purged 30 days after trashing), so blocking would pin an image permanently and the only remedy would be deleting history to delete an image.
- **Status note (why degrading is safe here):** the image bytes are already unrecoverable at this point — images have no `deleted_at` in any migration and the blob is unlinked immediately (both verified). Refusing the restore therefore cannot bring the image back; it only *also* withholds the prose. `GET /api/snapshots/:id` was verified to still return 200 with full content after the delete, so the words were provably sitting there behind a refusal. The count is announced on **both** success arms, including the stale-chapter switch — a user who navigated away is no less entitled to know their content was altered.
- **Status caveat:** this is the only path in the codebase where a restore returns something other than what was saved. That is a deliberate exception to the "restore is byte-exact" posture, justified only because the alternative is a permanent dead end, and it is guarded by the mandatory announcement. It does **not** license further content mutation on restore. Separately, F-05's delete-side asymmetry is now *intentional* rather than fixed: `deleteImage` still ignores snapshots, so a delete can still strand images inside snapshots — the difference is that the snapshot now survives it.
- **Status commit:** 3d0258b4
- **Status date:** 2026-08-17 08:20 UTC

### [F-06] Unmatched `/api/*` routes return an HTML body, not the documented error envelope
- **Category:** 24 (Inconsistent API contracts)
- **Impact:** Medium
- **Explanation:** `createApp()` mounts thirteen routers and `/api/health`, then registers `globalErrorHandler` with no catch-all in between, so Express's `finalhandler` serves its default HTML 404 for any unmatched API path.
- **Evidence:** `packages/server/src/app.ts:41-69` — no `app.use("/api", …)` fallthrough exists. Confirmed empirically by a specialist booting `createApp()` on an ephemeral port from a scratchpad script (no repo file touched): `GET /api/does-not-exist` → `404 text/html`, `<pre>Cannot GET /api/does-not-exist</pre>`. Client-side this lands in `apiFetch`'s `!res.ok` branch (`packages/client/src/api/client.ts:164-198`) where `res.json()` throws `SyntaxError`, so the error arrives with `code: undefined` — the discriminating `error.code` the whole scope registry is built on is absent. No test asserts unknown-path behavior.
- **Found by:** Integration & Data
- **Forward hazard:** when the SPA catch-all lands (flagged in the steering file's Tech Stack section), unmatched `/api/*` will start returning `index.html` with a 200 unless the API 404 is closed first.
- **Status:** Fixed
- **Status reason:** Added a synchronous `app.use("/api", …)` catch-all between `/api/health` and `globalErrorHandler`, throwing `NotFoundError("Unknown API endpoint.", "UNKNOWN_ENDPOINT")`. **The synchronous shape is load-bearing:** `/paad:rethink` established by experiment that Express 4.22.1 does not await handlers, so an `async` catch-all rejects unhandled and Node 22 terminates the process — every mistyped URL would have crashed the server. Verified by differential test (16 real endpoints byte-identical patched vs unpatched) that the catch-all shadows nothing, including the six routers sharing the `/api/projects` prefix that fall through one another. Scoped to `/api`, pinned by a test, so the future SPA catch-all must mount after it.
- **Status caveat:** `UNKNOWN_ENDPOINT` buys **less** than the original justification claimed. Verified over all 37 client scopes: `UNKNOWN_ENDPOINT` and `NOT_FOUND` map identically (no scope has a `byCode["NOT_FOUND"]` entry, so both fall to `byStatus[404]`/fallback) — the user-facing copy is byte-identical. And `globalErrorHandler` returns before logging for any `AppError`, so this code reaches **no server log**; its only visibility is the response body in a network panel. Kept because it correctly names the fault at the one moment anyone reads it, and costs nothing. It is the first 404 discriminator in the codebase with no client `byCode` entry (the other three — `PROJECT_PURGED`, `CHAPTER_PURGED`, `SCOPE_NOT_FOUND` — all have one).
- **Status date:** 2026-08-15 10:40 UTC
- **Status commit:** 7673b161

### [F-07] `useEditorMutation`'s committed path deliberately leaves the state machine mid-transition
- **Category:** 27 (Temporal coupling)
- **Impact:** Medium *(down from High)*
- **Explanation:** The `finally` block dispatches nothing when `reloadFailed` is set, leaving the machine at `{editable:false, busy:true}` and requiring every `stage === "committed_but_unreloaded"` consumer to complete the transition. Nothing in the type system or lint enforces it — a returned `MutationResult` is a plain value a caller may ignore.
- **Evidence:** `packages/client/src/hooks/useEditorMutation.ts:500-519`:
  ```ts
  if (reloadFailed) {
    // no-op: consumer owns COMMITTED_UNRELOADED
  }
  ```
  This has already produced a live defect: `useFindReplaceController.ts:150-160` documents the OOSI1 fix for the stale-chapter sub-case that stranded an unrelated chapter's editor read-only. The fix was a patch at one consumer, not at the seam.
- **Found by:** Coupling & Dependencies
- **Downgrade rationale:** both current consumers handle it correctly today, and the failure mode is a stranded read-only editor recoverable by refresh, not data loss. The risk is a future third consumer.
- **Evidence drift (2026-08-17, from the F-08 fix — this finding is still open and unfixed):** the text above describes the machine as left at `{editable:false, busy:true}`. There is no longer a `busy` field (F-08 removed it as an unread mirror), so the stranded state is `{editable:false}` with no lock. The *substance* of F-07 is unchanged — the `finally` block still dispatches nothing when `reloadFailed` is set, and the consumer still owns `COMMITTED_UNRELOADED` — but a future session should not go looking for `busy`. F-08's fix also settled a question relevant here: a seam-level fix would **not** want `busy` back, because the re-entrancy latch must be readable before the first `await` and reducer state is not.

### [F-08] `useEditorMutationMachine.busy` / `isBusy()` / `getState()` are unconsumed, and `busy` is documented as knowingly wrong
- **Category:** 31 (Dead code) *(re-typed from 7)*
- **Impact:** Medium
- **Explanation:** Two identically-named `isBusy()` probes sit on sibling objects wired into the same save-pipeline-critical component, one authoritative and one documented-incorrect — a foot-gun for the next author who autocompletes the wrong one.
- **Evidence:** `packages/client/src/hooks/useEditorMutationMachine.ts:13-22` — the `busy` doc says *"Do NOT gate on `machine.busy`; read `mutation.isBusy()` until a future phase … closes that gap."* `:85-95`, `:108-109` declare `isBusy`/`getState`; grep confirms zero production call sites for `machine.isBusy()` or `machine.getState()` — the only non-test hit is `useEditorMutationMachine.test.tsx:108`.
- **Found by:** Coupling & Dependencies
- **Status:** Fixed
- **Status reason:** All three removed. The machine's state is now `{ editable, lock }` and it exposes exactly one synchronous probe, `isLocked()` (12 production call sites). The deletion is safe because nothing read any of them: a repo-wide search — including `e2e/`, `scripts/`, `.js`/`.mjs` and test files, and covering destructured, computed and spread-then-read access — found the machine's `busy`/`isBusy`/`getState` referenced nowhere outside their own definition and one test. Every other `isBusy` hit belongs to `useEditorMutation` (backed by `inFlightRef`) or to two controller-test mocks cast as that hook. Render behaviour is unchanged: nothing keys on the whole state object, every reducer arm allocates so `Object.is` bailout was and remains impossible, and the three probes were already stable empty-dep `useCallback`s so the `useMemo` recompute timing could not shift.
- **Status note (why `busy` is not coming back, recorded at the code):** the deletion would be churn if a future phase wanted the field, so the reason it cannot is now written into the type's doc comment and into CLAUDE.md: the re-entrancy latch must be readable **before** the first `await`, and reducer state is visible only after React commits — so `inFlightRef` is not replaceable by a reducer field, and `busy` would remain a correct mirror with zero readers. `docs/roadmap.md` was checked for a planned consumer; there is none. The one scenario that would want it is a render-time busy indicator (a `disabled` prop rather than a callback check), which does not exist — every gate in the editor is callback-shaped. If that changes, the guidance is to add the field back and *not* as a second `isBusy()`.
- **Status note (a consequence the finding did not predict):** with `busy` gone, `MUTATION_SETTLED_SUPERSEDED`, `RELOADED` and `EDITOR_REMOUNTED` produce an identical state — `busy` was the only field that distinguished them. They are **not** merged: they are three distinct facts dispatched from four distinct sites, and merging them would destroy the machine's vocabulary and have to be re-split by the next field. The collapse is now explicit in a comment, pinned by a test that asserts the three agree, and stated in CLAUDE.md, so a future "simplification" has to delete an assertion rather than silently collapse them.
- **Status date:** 2026-08-17 10:55 UTC
- **Status commit:** 93a8e59b
- **Status caveat (the fix touched more than the machine):** ten sites needed updating, not the four the fix plan first named. `CLAUDE.md` and `docs/roadmap.md` both documented the state as `{ editable, locked, busy }`, and five in-code comments described the three-field shape — `useEditorMutationMachine.ts` (header, remount arm), `EditorPage.tsx` ×2, `useFindReplaceController.ts`. Missing them would have reintroduced steering-file drift in the same session that F-19 closed it. The roadmap's Done phase rows were left as shipped history with one superseded-note added at the spec, rather than rewritten. The shipped-phase design docs under `docs/plans/2026-05-29-editor-state-machine-*` and the 4b.5 decision log are deliberately **not** edited — they record what was built at the time.
- **Status caveat (coverage moved down, not up):** the fix plan claimed deleting two covered functions would raise coverage. That was arithmetically wrong. The file's only uncovered region is the unreachable `default:` arm, unrelated to `busy`, so removing covered statements takes the file from 40/43 to 38/41 (93.02% → 92.68%) and the global figure down by ~3e-6 pp. No new uncovered code appears and no threshold is near. The honest claim is "coverage is unaffected in any way that matters."

### [F-09] `eslint-plugin-import` is registered but the cycle rule is off
- **Category:** 5 (Circular dependencies — unguarded)
- **Impact:** Medium
- **Explanation:** The plugin is imported, registered, and already parsing the tree, but the only rule enabled from it is `import/first`. The repo's strongest structural property ([S-02]) and its dependency-declaration hygiene ([F-11]) are both protected by review alone.
- **Evidence:** `eslint.config.js:5` (import), `:15` (plugin registration), `:22` — `grep "import/" eslint.config.js` returns exactly one hit, `"import/first": "error"`. `import/no-cycle` and `import/no-extraneous-dependencies` are configured nowhere.
- **Found by:** Coupling & Dependencies
- **Status:** Fixed
- **Status reason:** Both rules enabled. `import/no-extraneous-dependencies` is configured per workspace, with `packageDir: [".", "packages/<ws>"]` so root tooling counts but a package declared only in a *sibling* workspace still errors — that cross-workspace precision is the point, since F-11 was exactly that drift. Production source may not import a devDependency; tests and local config may. `import/no-cycle` is on repo-wide, with the real tree re-measured at 0 cycles, confirming [S-02].
- **Status caveat — the finding's premise was wrong in a way that matters:** "the plugin is already parsing the tree" is true, but it could not *resolve* the tree. `import/no-cycle` was structurally incapable of firing on TypeScript: without an `import/resolver`, `import/no-unresolved` errors on a perfectly valid extensionless relative TS import, so the cycle walk never starts. An initial probe that reported "0 cycles across the repo" was therefore a **false green**, and simply switching the rule on — the literal fix this finding asks for — would have installed a guard that guards nothing while reading as a clean bill of health. Two `settings` entries are required and *each* fails silently alone: `import/resolver: { typescript: true }` and `import/parsers: { "@typescript-eslint/parser": [...] }` (with only the former, resolution succeeds but the plugin cannot parse the *imported* `.ts` file to read its imports, so a real two-file cycle is still missed). Both established by fixture, not by documentation.
- **Status caveat — new dependency:** required `eslint-import-resolver-typescript`, dev-only, ISC (on the acceptable list). **Pinned exact to `3.8.7`**, the last release on the pure-JS `enhanced-resolve` line: `>=3.9` switches to the native `unrs-resolver`, whose `@napi-rs/*` tree included a 4.5-day-old version that fails `make dep-cooldown`. Taking `^3.8.7` silently floats to 3.10.1 and reintroduces it, so the exact pin is load-bearing, not fussiness. `make dep-cooldown` passes (849 versions). Also declared `vitest` in the root manifest — the new rule caught it as a fourth phantom (root config and `scripts/` import it while only the workspaces declared it).
- **Status note:** two pre-existing tests (`eslintSequenceRule`, `eslintAbortControllerRule`) broke on this change: `import/no-cycle` throws on a *virtual* `lintText` path with no file on disk. Fixed in `eslintRuleHarness.ts` by disabling that one rule for the harness — no assertion or expected value in those tests was altered. Real linting is unaffected (files exist). `eslintImportCycleRule.test.ts` deliberately plants **real** files for this reason, and is the forcing pause: it was verified to go red when `import/parsers` is removed, so the rule cannot regress to silence.
- **Status date:** 2026-08-16 16:43 UTC
- **Status commit:** 945decab

### [F-10] The chapter read-path corruption gate uses a predicate its two siblings explicitly rejected
- **Category:** 13 (Inconsistent boundaries) *(re-typed from 6)*
- **Impact:** Medium
- **Explanation:** Chapters — the manuscript table, and the one with a designed `CORRUPT_CONTENT` route — gates on `isTipTapNode`, which its two siblings independently determined is insufficient. A stored `{"foo":1}` is served as healthy and that route cannot fire.
- **Evidence:** `packages/server/src/chapters/chapters.repository.ts:34` — `if (!isTipTapNode(parsed))`. `packages/server/src/outtakes/outtakes.repository.ts:22-32` says of exactly that predicate: *"gate on the SCHEMA, not on isTipTapNode … `{"foo":1}` … passed it and listed as an empty card"*, and uses `TipTapDocSchema`; `snapshots/snapshots.service.ts:149` also uses `TipTapDocSchema`. `search.service.ts:149,264` inherits the weaker gate. The outtakes comment is dated later (2026-08-05) than the chapters comment's dedup review (2026-07-26), so the in-code rationale at `chapters.repository.ts:29-33` — which argues the shared predicate is the right extraction — has since been contradicted by two of its three sites.
- **Found by:** Coupling & Dependencies
- **Status:** Fixed
- **Status reason:** `chapters.repository.ts` `parseContent` now gates on `TipTapDocSchema.safeParse(...)` instead of `isTipTapNode`, matching both siblings. The dedup review's "the predicate was the extractable part" argument was right about the shape of the fix and wrong about which predicate — that is preserved in the comment rather than deleted. The two `search.service.ts` sites the finding names as inheriting the weak gate (`:149`, `:264`) were tightened in the same change, so a chapter the reader calls corrupt is now a chapter search calls *skipped*, instead of the two disagreeing.
- **Status note:** the degrade policies stay deliberately different across the three sites (corrupt-flag here, empty-doc for outtakes, reject-restore for snapshots) — only the predicate converged. Read and write now agree: `TipTapDocSchema` is the same gate `PATCH /api/chapters/:id` already applies, so anything newly rejected could not have been written through the API and is a hand-edited row, a restored backup, or a legacy row.
- **Status caveat:** this is a **behaviour change on a read path**, and the risk it carries is the mirror of the bug — a legitimate manuscript newly reading as corrupt would be unopenable, not merely degraded. Seven safety-net cases were written first (`parseChapterContent.test.ts`, "real manuscript shapes stay readable") pinning marks, headings, images, note marks, 30-deep legal nesting, and a `{"type":"doc"}` with no content key; all passed unmodified after the swap, which is the evidence the tightening only caught genuine corruption. Five new cases pin the newly-rejected shapes, and the two search `it.each` tables gained `{"foo":1}` and a non-array `content`.
- **Status date:** 2026-08-17 08:34 UTC
- **Status commit:** b1c1164f

### [F-11] Unused `@tiptap/*` deps in server and client, plus undeclared `zod` and `@tiptap/core`
- **Category:** 31 (Dead code / unused dependencies), with the undeclared half closer to 4 (High/unstable dependencies)
- **Impact:** Medium
- **Explanation:** Two directions of drift, both unguarded because only `import/first` is enabled ([F-09]) — declared-but-unused packages, and *phantom* dependencies that resolve only through npm hoisting.
- **Evidence:**
  - `grep -rn "@tiptap" packages/server/src` → **zero matches**, yet `packages/server/package.json:14-19` declares six `@tiptap/*` runtime deps. `docs/dependency-licenses.md:42-47`'s rationale ("server-side HTML generation", "Heading extension for `generateHTML()`") is now factually stale — the server reaches TipTap only transitively via `@smudge/shared/editor-extensions`.
  - Client imports exactly `@tiptap/core`, `@tiptap/extension-placeholder`, `@tiptap/pm/state`, `@tiptap/react` but also declares `extension-heading`, `extension-image`, `html`, `starter-kit`.
  - **Phantom:** `zod` is imported by *production* server code at `validateUuidParam.ts:2` (the UUID trust boundary) and `search/search.routes.ts:2`, and is absent from `packages/server/package.json` entirely. Likewise `@tiptap/core` at `client/src/components/Editor.tsx:2` is absent from `packages/client/package.json`. Both work only because `@smudge/shared` hoists them to root `node_modules`.
  - Minor: `snapshots/content-hash.ts:1` uses bare `import { createHash } from "crypto"` rather than `node:crypto`, unlike every other site in the repo.
- **Found by:** Security & Code Quality, Coupling & Dependencies (agreed)
- **Consequence:** the same `^2.27.2` range is triplicated across three manifests that must be bumped in lockstep; a partial bump silently installs two TipTap trees, which for a ProseMirror editor means two `prosemirror-model` schemas.
- **Status:** Fixed
- **Status reason:** Dropped all six unused `@tiptap/*` from `packages/server` and the four unused from `packages/client` (`extension-heading`, `extension-image`, `html`, `starter-kit`), leaving the four the client actually imports. Declared both phantoms: `zod: ^3.24.3` in server (matching `shared`) and `@tiptap/core: ^2.27.2` in client. The third phantom the eslint probe surfaced — `prosemirror-state` in `outtakeCaptureSlice.test.ts` — was fixed by importing from the already-declared `@tiptap/pm/state` instead of adding a dependency, matching how production reaches ProseMirror. `crypto` → `node:crypto` in `snapshots/content-hash.ts`. `docs/dependency-licenses.md` updated for all of it, including a `uuid` row that was listed there but imported and declared nowhere.
- **Status caveat:** the phantom `zod` was **worse than this finding described**. Root `node_modules/zod` is **4.3.6**, hoisted there by `eslint-plugin-react-hooks` — so `validateUuidParam.ts`, the UUID trust boundary, was resolving a *dev tool's* transitive zod **a full major ahead** of the `3.25.76` that `@smudge/shared`'s schemas run on. The finding framed this as fragile-but-working; it was in fact a cross-major split. The fix pins server to shared's range. Residual: server and shared now hold separate physical copies of the same 3.25.76, which is harmless here only because nothing in the repo does `instanceof ZodError` — `outtakes.routes.ts:25` records the deliberate choice of structural checks over the invariant `ZodError<T>` generic. A future `instanceof` against a shared-thrown Zod error would silently fail.
- **Status date:** 2026-08-16 16:26 UTC
- **Status commit:** ba49f405

### [F-12] Read-after-insert failure has two taxonomies; three modules emit the generic one
- **Category:** 34 (Inconsistent error/logging conventions)
- **Impact:** Medium
- **Explanation:** `projects` converts this exact condition into a discriminating `AppError` the client's committed-UX machinery understands; three other modules throw a bare `Error` that gets clamped to a generic 500 — telling the writer their text was lost when the row is in fact committed.
- **Evidence:** `packages/server/src/projects/projects.routes.ts:65-71` → `InternalError(…, "READ_AFTER_CREATE_FAILURE")`, wired to `scopes.ts` `committedCodes`. But `packages/server/src/outtakes/outtakes.repository.ts:75` — `if (!row) throw new Error(\`Outtake ${data.id} not found after insert\`);` — plus `snapshots.repository.ts:18` and `images.repository.ts:7`. For outtakes the user sees `STRINGS.error.createOuttakeFailed` ("Failed to save outtake") while the row is committed, in a hard-delete table with no trash; `scopes.ts:496-511` (`outtake.create`) declares `committed` copy and 404/413 arms but carries **no** `committedCodes`, so the committed UX cannot fire and a re-capture mints an invisible duplicate.
- **Found by:** Error Handling & Observability
- **Status:** Partially fixed
- **Status reason:** The taxonomy half is fixed: all three modules now throw `InternalError(..., READ_AFTER_INSERT_FAILURE)` (`packages/server/src/errors/readAfterInsert.ts`) instead of a bare `Error` that `globalErrorHandler` clamped to a codeless 500. One code across all sites, because it is one condition. The **severity half of this finding is false and was not implemented** — see below.
- **Status correction (the finding's premise is wrong for two of its three sites):** F-12 states *"For outtakes the user sees `STRINGS.error.createOuttakeFailed` … while the row is committed"* and concludes `outtake.create` needs `committedCodes`. Verified false by execution: `createOuttake` performs its insert **inside `store.transaction(...)`**, so the throw rolls the insert back and no row survives (driven with a rollback probe against the real SQLite harness). `createSnapshot` is the same. Only **images** is genuinely committed — `uploadImage` calls `store.insertImage` outside any transaction, so the INSERT auto-commits before the confirming re-read runs (also verified by execution, with an `AFTER INSERT` trigger that shifts the id so the SELECT misses while the row survives). Adding `committedCodes` to `outtake.create` as the finding recommends would tell the writer "this may have saved, do not retry" for a capture that demonstrably was **not** saved and whose retry mints no duplicate. `committedCodes: ["READ_AFTER_INSERT_FAILURE"]` was therefore added to `image.upload` only, and the reasoning is recorded at the code's definition so a future refactor that moves an insert into or out of a transaction knows to move the scope membership with it.
- **Status note (a defect the finding did not report):** `uploadImage`'s cleanup unlinked the uploaded file unconditionally on any insert error, under the comment *"the DB insert failed so nothing references it"*. That comment is wrong for precisely this error — the INSERT succeeded — so the cleanup deleted the bytes belonging to a committed image row, converting a recoverable glitch into a permanently broken row. Now skipped for `READ_AFTER_INSERT_FAILURE`. The regression test was confirmed genuinely red against the pre-fix code, not merely green after it.
- **Status caveat:** left as *Partially fixed* rather than *Fixed* because the finding's own remedy was rejected on evidence. Anyone re-reading F-12 should treat its outtakes example as retracted. The residual work, if ever wanted, is deciding whether the transactional sites should surface anything more specific than ordinary retry copy — today they correctly do not.
- **Status date:** 2026-08-17 08:52 UTC
- **Status commit:** a16d5cc9

### [F-13] Keyboard chapter nav announces success that may not have happened
- **Category:** 20 (Weak error handling strategy) *(re-typed from 34)*
- **Impact:** Medium
- **Explanation:** The screen-reader announcement fires synchronously and unconditionally on a voided promise, so on the editor-lock path a screen-reader user is told "Navigated to \<chapter\>" while nothing moved and no other signal exists. WCAG 2.1 AA is a first-class constraint in this project.
- **Evidence:** `packages/client/src/hooks/useKeyboardShortcuts.ts:190-193`:
  ```ts
  void handleSelectChapterWithFlushRef.current(nextChapter.id).catch(() => {});
  deps.setNavAnnouncement(STRINGS.sidebar.navigatedToChapter(nextChapter.title));
  ```
  `handleSelectChapterWithFlush` (`EditorPage.tsx:904-936`) returns early when `switchToView("editor")` is false — the busy latch (`:755-758`, info banner), the editor lock (`:767-769`, **deliberately no banner**), and flush-save failure (`:814-818`, save-failed banner). Commit `3b95a804` fixed the gating *inside* the function and left this call site's announcement outside it. The sibling Alt+Up/Down reorder path is unaffected.
- **Found by:** Error Handling & Observability
- **Status:** Fixed
- **Status reason:** `handleSelectChapterWithFlush` now returns `Promise<boolean>` — false on every path that leaves the user on the old chapter (the `!switched` refusal and the defensive outer catch) — and the Ctrl+Shift+Arrow handler announces inside `.then()`, only when it resolves true. Fixed at the seam rather than by re-deriving the refusal conditions at the call site: the announcement's correctness now follows from the function's own return value, so a future fourth refusal path inside `switchToView` cannot desynchronise it. `.catch()` stays silent, matching a refusal. Added an `unmounted` flag to the effect because the announcement now lands after an await and the timer it sets must not outlive the hook.
- **Status caveat:** this makes the announcement *truthful*, not *complete*. On the editor-lock path the user now correctly hears nothing — but that path still shows no banner by design, so a screen-reader user gets no positive signal that the keypress was refused. Removing the false announcement was the finding's scope; giving the lock path its own announcement is a separate a11y question and was not decided here.
- **Status amendment (2026-08-16, agentic-review I1):** the caveat originally also recorded that `handleSelectChapter` swallows its own errors, so a chapter *load* failure after a successful `switchToView` still resolved true and still announced — the return value tracking "the switch was permitted and attempted" rather than "the switch happened". Review I1 correctly rejected that as the finding's own defect on a **more** reachable path than the editor-lock refusal it fixed (offline, or a 500 from `GET /api/chapters/{id}`). `handleSelectChapter` now returns `Promise<boolean>` — false on the already-active early return, on `signal.aborted`, on `token.isStale()`, and in the catch — and `handleSelectChapterWithFlush` returns that verdict instead of a hardcoded `true`. The announcement now tracks "`activeChapter` actually became this chapter". Pinned by three cases in `useProjectEditor.test.ts` ("I1: handleSelectChapter reports whether the switch happened").
- **Status note:** covered by a new hook-level test (`hooks/__tests__/useKeyboardShortcuts.test.tsx`, three cases: announces on success, silent on refusal, silent on throw) rather than through `EditorPage` — driving a refusal through the component means reproducing a busy latch or a mid-flush save failure, machinery unrelated to the announcement decision. The pre-existing success-path assertion in `KeyboardShortcuts.test.tsx:316` was the safety net and still passes untouched.
- **Status date:** 2026-08-16 16:50 UTC
- **Status commit:** bdbbbafc

### [F-14] The "lying central directory" byte-budget guard in `runRestore` is never exercised
- **Category:** 32 (Missing test coverage for critical paths)
- **Impact:** Medium
- **Explanation:** The final decompression-bomb defense — an archive whose central directory *under-declares* sizes, slipping past `checkDeclaredSizes` — is dead in the coverage report, so Smudge's own guard is verified only by inspection.
- **Evidence:** `packages/server/src/backup/backup-core.ts:292-305`. Uncovered lines computed independently from `coverage/coverage-final.json`: `239, 298-305` — precisely the `written > declaredTotal + 1MiB` branch and its `RestorePartialError` throw, while the surrounding extraction loop is covered. The targeting test (`backup-core.test.ts:891`, "T-1") concedes in its own comment that it accepts either outcome — "causes either JSZip's own size-mismatch throw **or** our byte-budget overrun" — and JSZip fires first, so the assertion passes through the catch-all at `:313`.
- **Found by:** Security & Code Quality
- **Status:** Fixed
- **Status reason:** Added `T-2 (F-14)` to `backup-core.test.ts`, which reaches the `written > declaredTotal + 1MiB` branch deterministically. Coverage for `backup-core.ts` moved from `239, 298-305, 453-455` uncovered to `239, 453-455` (statements 95.23% → 98.41%, branches 90.51% → 92.43%); lines 298-305 are the finding's exact target. Test-only — no production code changed.
- **Status note (why the existing T-1 could never have covered it):** established by execution, not inspection. JSZip checks each entry's *actual* decompressed length against the size the central directory declares and throws `"Bug : uncompressed data size mismatch"`. T-1 patches exactly that field, so JSZip fires first every time and T-1's assertion passes through the generic post-move wrapper at `:313` — which is why its own comment concedes it accepts "either outcome". **Per-entry under-declaration can therefore never reach our guard.** What does reach it is a central directory listing the same path *twice* with different declared sizes (duplicate-entry / "zip confusion"): `readCentralDirectorySizes` sums the small decoy while the extraction loop iterates those same duplicated names and extracts the real large entry on both passes. Every individual entry decompresses to exactly its declared length, so JSZip is satisfied and only the cumulative budget notices. **Precision (S2, 2026-08-18):** the duplication that matters is Smudge's own `names` array, not JSZip's map. T-2's forged record carries smudge.db's `localHeaderOffset`, so JSZip registers it under the *local* name `smudge.db` and overwrites the real entry — `zip.files` holds no duplicate at all. The guard fires because `names` (read from the central directory) lists `big.bin` twice while `declaredTotal` counted the decoy at smudge.db's size.
- **Status note (the guard is load-bearing, not redundant):** verified by mutation — with the branch neutered to `if (false)`, `runRestore` **resolves successfully** on the forged archive rather than failing some other way. Nothing else in the pipeline catches it, so without this guard the archive would extract at twice its declared size, silently. The new test asserts the guard's own message (`/extraction exceeded declared size/`) rather than merely "it threw", because asserting only that it rejects is the weakness that let the branch go uncovered inside a 76-case suite.
- **Status caveat (corrected 2026-08-18, S2):** an earlier revision of this caveat said the test depends on JSZip resolving a duplicated path to the real entry on each lookup. It does not — JSZip never sees a duplicate (see the precision note above). What the test actually depends on is the central-directory-vs-local-header key-space asymmetry, filed as OOSI1. That was fixed on the review branch by throwing on a non-directory central-directory name that `zip.file()` cannot resolve; T-2 still passes, because every name in its forged directory *does* resolve — only the count and the declared total are wrong. A future change that extracted by central-directory offsets rather than by name, or a JSZip that rejects duplicate central-directory names outright, would break this test — loudly, which is acceptable — and would mean re-deriving a reachable shape. T-1 was deliberately left untouched: it still concedes "either outcome" and so still cannot report *which* defense fired. Tightening it was offered and declined this session as a separate change.
- **Status date:** 2026-08-18 07:04 UTC
- **Status commit:** 230546cc

### [F-15] Auto-backup rotation failure is swallowed, defeating a deliberate re-throw that has its own test
- **Category:** 20 (Weak error handling strategy)
- **Impact:** Medium
- **Explanation:** `rotateAutoBackups` goes out of its way to narrow — ENOENT returns "nothing to prune", everything else is re-thrown — and its sole production caller swallows exactly that, with no log, no `warning` field, and `status: "ok"`.
- **Evidence:** `packages/server/src/backup/backup-core.ts:359-361`:
  ```ts
  await rotateAutoBackups({ backupsDir: o.backupsDir, keep: o.keep }).catch(() => {
    /* rotation is best-effort */
  });
  ```
  The re-throw it defeats is at `:373-381` — *"A permission/IO error … would otherwise be masked as 'nothing to prune'; re-throw it"* — and has a dedicated test (`backup-core.test.ts:1106`). The return type has a `warning` field one line away, used by the sibling failure arm. Reachable independently of a backup-write failure: `readdir` succeeds but a per-file `rm` at `:397` hits EACCES/EPERM, so `backups/smudge-auto-*.zip` grows on every `make dev` forever, silently. Compare the convention at `db/purge.ts:65` and `images.reaper.ts:53`.
- **Found by:** Error Handling & Observability
- **Correction to this finding:** the suggested fix ("the return type has a `warning` field one line away") is **insufficient on its own**. The sole production consumer, `scripts/auto-backup.ts`, read `warning` only in its `failed` branch, so populating it under `status: "ok"` would have changed nothing an operator ever sees. The fix necessarily spans both files. The finding's pointer to the `db/purge.ts` / `images.reaper.ts` logging convention also does not transfer: those run inside the server process, whereas `runAutoBackup` only ever runs from a standalone `tsx` script, and `backup-core.ts` contains zero logging calls by design — it reports through return values and the scripts own all operator output.
- **Status:** Fixed
- **Status reason:** Replaced the bare `.catch(() => {})` with a try/catch that captures the rotation error into `warning` while keeping `status: "ok"` (the archive genuinely landed; `"failed"` would be a lie and the caller must still exit 0). Taught `scripts/auto-backup.ts` to print it on the ok path. Red test: a stale auto-backup that is really a non-empty directory makes the per-file `rm(..., {force:true})` throw EISDIR — the same post-`readdir` failure shape as the EACCES/EPERM case the narrowing exists to preserve.
- **Status caveat:** the half that delivers the value — the message reaching a terminal — lives in `packages/server/scripts/auto-backup.ts`, which is **coverage-excluded by design** (`vitest.config.ts:36-41`, the `ensure-native.mjs` precedent), so no test guards it. Verified instead by one end-to-end run against a `backups/` directory containing an un-prunable entry: archive written, `WARNING: auto-backup rotation failed, old auto-backups were not pruned: … EISDIR …` on stderr, exit code 0, stale entry still present. A future edit to that script can silently re-break the visibility without any test going red.
- **Status date:** 2026-08-16 08:55 UTC
- **Status commit:** 3fd18b0f

### [F-16] Two chapter-domain methods live in the `ImagesStore` slice
- **Category:** 11 (Low cohesion)
- **Impact:** Low
- **Explanation:** The slice header states each slice "owns the data operations for one domain, so a new operation edits only that slice", but `ImagesStore` ends with two chapter queries whose consumers are mostly non-image code.
- **Evidence:** `packages/server/src/stores/project-store.types.ts:110-117` — `listChapterContentByProject` / `listAllChapterContentByProject` inside `interface ImagesStore`, implemented by delegating to `chaptersRepo` (`sqlite-project-store.ts:247-259`), consumed by `search.service.ts:131,245` and `projects.service.ts:169` as well as the two image callers.
- **Found by:** Structure & Boundaries
- **Note:** Distinct from accepted F-4, which accepted the slice *structure* — the slice decomposition is exactly what F-4's acceptance cites as the interface's justifying value.

### [F-17] "One create, two producers, sync by nonce" is an established idiom rather than a boundary
- **Category:** 13 (Inconsistent boundaries)
- **Impact:** Low *(down from Medium)*
- **Explanation:** `api.outtakes.create` has two call sites at two layers, each with its own project-drift guard, possibly-committed recovery, and error scope, reconciled through a nonce prop drilled `EditorPage → EditorMainContent → OuttakesPanel`. The same shape already existed for image upload, so outtakes copied it — meaning the next list-plus-outside-writer feature will copy it again.
- **Evidence:** `packages/client/src/components/OuttakesPanel.tsx:204-215` — *"Neither producer re-checks the project after its await — the capture POST lives in EditorPage and the blank-note POST in handleCreate below"* — forcing a defensive third guard in `applyServerRow`. Call sites: `OuttakesPanel.tsx:265` + `EditorPage.tsx:1070`; same shape at `Editor.tsx:354` + `ImageGallery.tsx:206`.
- **Found by:** Structure & Boundaries
- **Downgrade rationale:** the panel's `applyServerRow` funnel already catches the cross-project failure mode centrally and documents why.
- **Evidence drift (2026-08-17, from the F-04 fix — this finding is still open and unfixed):** the second producer is no longer at `EditorPage.tsx:1070`; it moved verbatim into `packages/client/src/hooks/useOuttakeCapture.ts` (`api.outtakes.create` at `:159`). The shape F-17 describes is unchanged — still one create endpoint, two producers at two layers, each with its own drift guard and error scope, reconciled through a nonce prop drilled `EditorPage → EditorMainContent → OuttakesPanel`. The extraction moved one producer behind a hook boundary; it did not reduce the count or unify the reconciliation.

### [F-18] `EditorMainContent` is a 71-prop pass-through with duplicated banner markup
- **Category:** 11 (Low cohesion)
- **Impact:** Low *(down from Medium)*
- **Explanation:** 71 props grouped into eight comment sections, most forwarded verbatim to six child components; the component's own contribution is a view-switch ternary chain and two inline banners.
- **Evidence:** `packages/client/src/components/EditorMainContent.tsx:42-138` (interface), `:233-264` — two inline banners reimplementing the shape of the extracted `ActionErrorBanner` used on the very next line.
- **Found by:** Structure & Boundaries
- **Downgrade rationale:** the prop count is the direct, *accepted* consequence of F-1's rendering extraction (state deliberately stays in `EditorPage`), and the prop list is a monitored surface (`editorEntryPointSurface.test.ts`). The residual concrete issue is the duplicated banner markup.

### [F-19] The steering file has drifted from the tree
- **Category:** 13 (Inconsistent boundaries)
- **Impact:** Low
- **Explanation:** The one artifact a newcomer reads to learn where code goes under-describes the server by more than half, and two other factual claims have gone stale. This matters more here than in most repos because `CLAUDE.md` is explicitly the mechanism by which architectural decisions reach future reviews.
- **Evidence:** `CLAUDE.md:81-97` "Target Project Structure" lists five server domain modules; `ls packages/server/src` shows eleven directories — `outtakes/`, `snapshots/`, `images/`, `search/`, `export/`, `backup/`, `errors/`, `config/`, `utils/` are all absent from the map, and client `utils/` is missing too. `CLAUDE.md:77` says "React 18+" while `packages/client/package.json` declares `react: ^19.1.0` (installed 19.2.5) and hook comments still reason about React 18 StrictMode double-invoke semantics (`useAbortableAsyncOperation.ts:37-43`). `CLAUDE.md:356` cites `EditorPage.tsx` at "~1,330 lines"; `wc -l` says 1,356.
- **Found by:** Structure & Boundaries, Coupling & Dependencies (agreed, merged)
- **Status:** Fixed
- **Status reason:** The two failure modes were separated and treated differently. The **structural** claim (the server module map) was corrected to all sixteen real directories and is now guarded by `scripts/__tests__/claude-md-structure.test.mjs`, which parses the fence and compares it to `readdirSync("packages/server/src")` in both directions — a listed directory that no longer exists fails exactly as a real one that goes unmentioned. Confirmed red first (7 documented vs 16 actual). Modelled on the existing `dependency-licenses-doc.test.mjs` forcing pause, and carries a parser self-test so a silently-matching-nothing regex cannot make it vacuous. The **volatile counts** were deleted rather than updated: "13 call sites" → "every call site", "51 one-line pass-throughs" → "entirely one-line pass-throughs", "~1,330 lines" → "the largest file in the client". Those numbers were rhetorical claims dressed as measurements — re-measuring them on every commit is a treadmill, and updating them just resets the timer that produced this finding. `React 18+` → `React 19`.
- **Status note (the finding understated the drift):** two further stale claims were found that the report did not catch, both inside §Accepted Architectural Trade-offs — the block that exists specifically so future reviews treat those decisions as settled. F-3's "13 call sites" was actually 45 and F-4's "51 one-line pass-throughs" was 61. A wrong number inside that block is worse than an incomplete module map, because it is load-bearing in an argument for *not* fixing something. Both are now non-numeric, and the F-3 wording turns the growth into support for the locator rather than leaving a number to rot.
- **Status date:** 2026-08-17 10:31 UTC
- **Status commit:** 6482221e
- **Status caveat:** only the module map is mechanically guarded. The trade-off prose is protected solely by having removed the numbers, so a future author who reintroduces a precise count reintroduces the drift with nothing to catch it. Separately out of scope and unfixed: `useAbortableAsyncOperation.ts:37-43` still reasons about React 18 StrictMode double-invoke semantics in a code comment — that is hook reasoning, not the steering file, and changing it is a different change.

### [F-20] `@types/dompurify` is a stale stub over a self-typed package
- **Category:** 31 (Dead code / unused dependencies)
- **Impact:** Low
- **Explanation:** DOMPurify 3.x ships its own typings, so the DefinitelyTyped stub for the pre-3.x API is never the resolution target — dead weight ambiently loaded into every client compilation, sitting on the codebase's most security-sensitive module.
- **Evidence:** `packages/client/package.json` devDependencies declares `@types/dompurify: ^3.0.5`; `npx tsc --traceResolution -p packages/client/tsconfig.json` shows every `dompurify` import resolving to `dompurify/dist/purify.es.d.mts@3.4.0`, with `@types/dompurify` appearing only as a type-reference directive. `node_modules/@types/dompurify/README.md`: "Last updated: Mon, 06 Nov 2023".
- **Found by:** Coupling & Dependencies, Security & Code Quality (agreed, merged)
- **Status:** Fixed
- **Status reason:** Dropped `@types/dompurify` from `packages/client` devDependencies. Verified stronger than by `--traceResolution`: after `npm install` removed the stub from `node_modules` entirely, `tsc -b --force` (non-incremental, so no stale `.tsbuildinfo` could mask it) still passes across all three packages — the pre-3.x stub was never the resolution target, `dompurify@3.4.0`'s own `./dist/purify.cjs.d.ts` is. No `docs/dependency-licenses.md` row to remove: the stub was covered by the generic `@types/*` dev-only row, and the runtime `dompurify` entry with its Apache-2.0 election is untouched.
- **Status date:** 2026-08-16 16:29 UTC
- **Status commit:** 2e4a0b10

### [F-21] `initDb` and `initProjectStore` have asymmetric re-init contracts
- **Category:** 27 (Temporal coupling)
- **Impact:** Low *(down from Medium)*
- **Explanation:** `initDb()` is silently re-callable and destroys the prior Knex handle; `initProjectStore()` throws on a second call; `SqliteProjectStore` captures `db` in its constructor. A second `initDb()` without an intervening `resetProjectStore()` leaves `getProjectStore()` bound to a destroyed connection with no error at the seam.
- **Evidence:** `packages/server/src/db/connection.ts:39-41` vs `packages/server/src/stores/project-store.injectable.ts:29-34`, with the handle captured at `sqlite-project-store.ts:37`. Symmetrically, `closeDb()` does not reset the store and `resetProjectStore()` does not close the DB — `index.ts:84-85` must call both in the right order by hand.
- **Found by:** Coupling & Dependencies
- **Note:** Distinct from accepted F-3, which describes the *locator* and its "init once" contract, not the divergent re-init semantics between the two singletons it depends on. Downgraded to Low because production has exactly one `initDb` + one `initProjectStore` call (`index.ts:31,33`); the hazard is confined to test harnesses, which use `setDb`/`setProjectStore` instead.

### [F-22] `content_corrupt` names two incompatible contracts
- **Category:** 13 (Inconsistent boundaries)
- **Impact:** Low *(down from Medium)*
- **Explanation:** For chapters, the flag pairs with `content: null`, is internal, and is stripped at the wire boundary. For outtakes, the same field name pairs with a *valid empty doc* and is part of the public wire type. A helper written against one convention is wrong for the other.
- **Evidence:** `packages/shared/src/types.ts:99-105` (`OuttakeRow.content_corrupt?: true`, checked with bare truthiness at `OuttakeCard.tsx:233,278` and `EditorPage.tsx:571`) vs `packages/server/src/chapters/chapters.types.ts:68-89` (`stripCorruptFlag`, predicate `isCorruptChapter()`).
- **Found by:** Coupling & Dependencies
- **Downgrade rationale:** both sites document the divergence and its reason, `shared/src/types.ts:99-105` cross-references chapters by name, and TypeScript keeps the two row types apart. The residual is a cognitive naming hazard, not a live defect.

### [F-23] Sub-hooks receive the parent's raw `setState` dispatchers and mutable refs
- **Category:** 3 (Tight coupling)
- **Impact:** Low *(down from Medium)*
- **Explanation:** The sub-hook can write any of the parent's state to any value, so `useProjectEditor` cannot enforce an invariant across its own state at the boundary — the compiler only checks that the setters were passed, never that they are used consistently.
- **Evidence:** `packages/client/src/hooks/useProjectEditor.types.ts:30-67` — `ChapterCrudDeps` has 15 members (8 raw `Dispatch<SetStateAction<…>>`, 5 raw `MutableRefObject<…>`, 2 callbacks); `ChapterMetadataDeps` has 9 in the same shape.
- **Found by:** Coupling & Dependencies
- **Notes:** Not covered by accepted F-1 (different decomposition). Downgraded because handing dispatchers across a hook split is the standard React idiom, and the interface's own comment records this was a deliberate byte-for-byte mechanical extraction.

### [F-24] The same `/api/projects/{x}` segment means "slug" for four sub-resources and "UUID" for two
- **Category:** 24 (Inconsistent API contracts)
- **Impact:** Low
- **Explanation:** Six routers mount on the same `/api/projects` prefix; `GET /api/projects/{slug}/dashboard` and `GET /api/projects/{uuid}/outtakes` are both valid, and swapping the identifier gives a 404 on one and a 400 on the other. Nothing in code or the steering file records this as a decision.
- **Evidence:** Slug — `projects.routes.ts` (`/:slug`, `/:slug/chapters`, `/:slug/dashboard`, `/:slug/trash`, `/:slug/velocity`), `export/export.routes.ts:10`, `search/search.routes.ts:66,89`. UUID — `images.routes.ts:38` (`requireUuidParam("projectId")`), `outtakes.routes.ts:42,72`. All mounted at `app.ts:41,45,46,50,52`.
- **Found by:** Integration & Data
- **Downgrade rationale:** the client is internally consistent (`api.outtakes.create(project.id, …)` vs `api.projects.dashboard(slug, …)`); the trap is for future route authors.

### [F-25] `.strict()` is applied to the three newest request schemas and none of the older ones
- **Category:** 24 (Inconsistent API contracts)
- **Impact:** Low
- **Explanation:** A typo'd field on the older endpoints answers 200 having changed nothing; the same stray key on an outtake answers 400.
- **Evidence:** `grep "strict()" packages/shared/src/schemas.ts` returns exactly three — `CreateSnapshotSchema:227`, `CreateOuttakeSchema:234`, `UpdateOuttakeSchema:240` (plus the inline `SearchSchema`/`ReplaceSchema` at `search.routes.ts:13-59`). Non-strict: `CreateProjectSchema:13`, `UpdateProjectSchema:18`, `UpdateChapterSchema:67`, `ExportSchema:97`, `UpdateImageSchema:104`, `UpdateSettingsSchema:116`. So `PATCH /api/projects/{slug}` with `{"taget_word_count": 50000}` silently succeeds. `outtakes.routes.ts:9-23` documents `.strict()` as "a second producer" of 400s for that surface, so the divergence is known locally but was never propagated.
- **Found by:** Integration & Data

### [F-26] `POST /api/chapters/{id}/snapshots` returns two status codes with two body shapes, and the 200 ships server-authored user copy
- **Category:** 24 (Inconsistent API contracts)
- **Impact:** Low
- **Explanation:** The only endpoint whose success response is a discriminated union the client must branch on, and its `message` field is user-facing English produced by the server — which the steering file forbids for the sibling success contract ("the client owns the toast, the server ships no success copy").
- **Evidence:** `packages/server/src/snapshots/snapshots.routes.ts:26-33` — `res.status(200).json({ status: "duplicate", message: "Snapshot skipped — content unchanged since last snapshot." })` vs `res.status(201).json({ status: "created", snapshot })`. Client branch at `api/client.ts:536-542` and `SnapshotPanel.tsx:321`; it correctly ignores the field and renders `STRINGS.snapshots.duplicateSkipped` — so today it is dead weight that invites a future caller to display it.
- **Found by:** Integration & Data
- **Status:** Fixed in part — the server-authored copy is gone; the two-shape response is **deliberately kept and remains open by choice** (see the Status note below, and the reasoning at `snapshots.routes.ts`)
- **Status reason:** The server-authored `message` is gone from the duplicate 200 body and from the response type in `api/client.ts`, bringing this endpoint in line with the steering file's rule for the sibling success contracts — *the client owns the toast, the server ships no success copy*. The client needed no behavioural change: it already rendered `STRINGS.snapshots.duplicateSkipped` and never read the field.
- **Status note (the two status codes were deliberately KEPT):** F-26's other complaint is the discriminated union itself. Every way of collapsing it is worse. Always answering 201 would claim a row was created when none was; answering 409 would turn a benign no-op — the content is unchanged, so nothing needed saving — into an error the client must treat as a failure. 201-created versus 200-nothing-happened is the honest description, and the finding's own evidence locates the real defect in the English rather than in the union ("it correctly ignores the field … dead weight that invites a future caller to display it"). The `status` discriminator is kept too: the HTTP code carries the same information, but `result.status === "duplicate"` is what the client reads and is clearer than branching on a numeric code.
- **Status note (why two shapes are not the bug they look like — added 2026-08-19):** this note originally argued only from HTTP semantics, which left the obvious objection unanswered: a response that varies in shape is a classic "caller forgets to check and reads `undefined`" hazard. It is not one here, and the reason is not a property of the design — it is a property of who consumes it. The union is `{ status: "created"; snapshot } | { status: "duplicate" }`, so `result.snapshot` without narrowing is a **compile** error (TS2339, verified against the repo's own compiler rather than assumed). Reaching `snapshot` at all requires branching on `status` first, which forces the author to state what the other case is — where the superficially safer uniform shape (`snapshot?: SnapshotRow`) can be silenced with `snapshot!` by someone who never decided what "duplicate" means. **That guarantee ends at the type**: a non-TypeScript consumer gets none of it. Today there is exactly one caller and it is typed. A fourth alternative not considered when this note was first written — always 200, always returning the *existing* snapshot on the duplicate path — is the genuinely arguable one, and still loses: the service fetches only the latest snapshot's content hash, not the row, so it costs a query, and the `status` branch survives regardless because the client must still choose between "created" and "unchanged" copy. **All of this now lives in the code** at `snapshots.routes.ts`, which is where a future review flagging this endpoint will be looking. It was deliberately NOT added to `CLAUDE.md` §Accepted Architectural Trade-offs: every entry there is a cross-cutting pattern re-flaggable from many files, and this is one endpoint in one file that cannot be flagged without reading the comment.
- **Status note (one existing assertion was inverted, with the developer's approval):** `snapshots.routes.test.ts` asserted `expect(second.body.message).toBeDefined()` — a test whose whole purpose was to pin the field this finding says should not exist. It now asserts `toBeUndefined()`, with the reason recorded at the assertion. Two further edits were mechanical: mocks in `SnapshotPanel.test.tsx` and `api-client.test.ts` supplied a property the narrowed type no longer has. The safety-net test written for this finding ("keeps the duplicate response's status discriminator at 200") was **not** touched and passed unmodified across the change — which is what it was written for.
- **Status date:** 2026-08-19 08:47 UTC
- **Status commit:** 2336da67
- **Amended:** 2026-08-19 in `99b51f2a` — status line qualified to `Fixed in part` (the kept union is open by choice, and the unqualified marker had made this entry read as closed), and the missing argument recorded at `snapshots.routes.ts`. Raised by review finding [S3] (`paad/code-reviews/ovid-architecture-2026-08-19-09-10-40-e681a52a.md`).

### [F-27] `updateImageMetadata` runs check → update → re-read as three unwrapped statements
- **Category:** 26 (Poor transactional boundaries)
- **Impact:** Low
- **Explanation:** Every structurally identical mutation in the codebase wraps this exact shape in one `store.transaction()` and says why; the image path is the lone holdout, so its response body can reflect a different writer's state.
- **Evidence:** `packages/server/src/images/images.service.ts:125-145` — `findImageById` → `updateImage` → `findImageById`, no transaction. Siblings: `outtakes.service.ts:67-78`, `chapters.service.ts:99-120` ("so the response body reflects exactly what this request wrote"), `snapshots.service.ts:226-231`.
- **Found by:** Integration & Data
- **Status:** Fixed
- **Status reason:** All three statements now run inside one `store.transaction(txStore => …)`, with a comment naming the three sibling sites it now matches. Behaviour is otherwise unchanged: the same three outcomes (`validationError`, `notFound`, `image`) in the same order, with validation still outside the transaction since it touches no store.
- **Status note:** the Safety Net phase found the `notFound`-on-re-read arm (`:141-143`) genuinely uncovered — statements 142-143 dead, branch 141 partial — inside the exact code this fix restructures, so a test was written first (commit `32938d20`). It drives the vanishing row with a SQLite `AFTER UPDATE` trigger rather than a store-method spy, specifically so it would survive the read moving from the outer store to a `txStore`. It did: it passed unmodified after this change, which is the point of having chosen that shape.
- **Status caveat:** this is consistency and future-proofing, not a live bug fix. The interleaving it prevents requires a concurrent writer, and Smudge is single-user, single-process — the same premise under which F-3 and F-2 were *accepted* as trade-offs. Justified on the narrower ground that every structurally identical mutation already does this and says why, so the holdout is a trap for the next author, not because the race is reachable today.
- **Status date:** 2026-08-16 16:52 UTC
- **Status commit:** dd1e0c39

### [F-28] Read-after-write on two write paths sits outside the transaction the codebase elsewhere insists on
- **Category:** 26 (Poor transactional boundaries)
- **Impact:** Low
- **Explanation:** Two write paths close their transaction and then re-read, which is exactly the window a sibling's comment describes as a defect — and these are the paths that produce the documented `RESTORE_READ_FAILURE` / `READ_AFTER_CREATE_FAILURE` codes.
- **Evidence:** `packages/server/src/chapters/chapters.service.ts:269` (tx closes) then `:306-312` (re-read); `packages/server/src/projects/projects.service.ts:217` then `:219-222`. The rule they diverge from is at `chapters.service.ts:93-119` — "without this, a concurrent writer landing between commit and a post-tx `findChapterById` would let the other writer's content ride back in this response" — and is repeated at `snapshots.service.ts:226-229`.
- **Found by:** Integration & Data
- **Status:** Partially fixed
- **Status reason:** The `createChapter` path (`projects.service.ts`) is fixed: the transaction callback now returns `txStore.findChapterById(...)`, so the read happens inside. `store.transaction<T>` is generic and already returned the callback's value, so this cost four lines. The **`restoreChapter` half is deliberately left open** — see below.
- **Status note (two hazards, both now commented at the code):** (1) the label enrichment stays **outside** the transaction. `enrichChapterWithLabel` reaches the store for the `chapter_statuses` label, and Knex's better-sqlite3 pool is `max: 1` — a non-scoped `store.*` call from inside a transaction starves until timeout rather than failing fast. This was verified experimentally against the installed Knex during the F-28 assessment and is a live trap for anyone tidying this function. (2) The read returns a sentinel and must **not** be changed to throw. Throwing would roll the insert back, which would make `chapter.create`'s `committedCodes: ["READ_AFTER_CREATE_FAILURE"]` (`scopes.ts:252`) actively wrong — it would tell the writer "this may have saved, do not retry" for a chapter that provably was not. That is the same inversion F-12's status correction identified and rejected for outtakes.
- **Status caveat (this change is conformance, and is not observably testable):** no test was added, because the change has **no observable behavioural delta** in this process. The S8 trigger lever (shift the row id so the confirming read misses) produces identical results before and after: the read misses either way, the row commits either way, the service returns the same sentinel either way. The only difference is invisible to a concurrent writer, which a synchronous single-connection SQLite process cannot produce. The two safety-net tests written for this fix (`chapters.test.ts` — "bumps the parent project's updated_at", "returns the new chapter enriched with its status_label", commit `4112e612`) pin the behaviour that must **not** change, and were confirmed red against a broken implementation; they do not and cannot pin the transaction boundary itself. A structural test asserting *which object* the read was called on was considered and rejected as pinning implementation rather than behaviour. Accepted on the narrower ground that this file's own sibling comment states the rule and `createChapter` was the visible exception to it.
- **Status caveat (why the restore half is still open):** `restoreChapter` is not the one-statement move this half was. Its transaction callback returns `void` and contains a bare `return;` at `chapters.service.ts:249` for the already-restored-by-another-request case, which deliberately skips the project-restore and ref-increment. Moving the read in requires hoisting a result variable, converting both exits to a returned union, and flag-gating the skipped tail — a restructure, in the restore path, which the testing philosophy names as the code that gets the most rigorous coverage. It should get a session with coverage proportionate to that, not be tacked onto a four-line change.
- **Status date:** 2026-08-17 11:02 UTC
- **Status commit:** b7cb9078

### [F-29] Parent-liveness check and child read split across two round trips
- **Category:** 26 (Poor transactional boundaries)
- **Impact:** Low
- **Explanation:** Three read paths check the parent project's liveness and then read the children outside any transaction, after the identical bug was found and fixed for outtakes.
- **Evidence:** `packages/server/src/snapshots/snapshots.service.ts:79-84` (`listSnapshots`), `:86-96` (`getSnapshot`), `packages/server/src/images/images.service.ts:100-105` (`listImages`). The fix and its reason live at `outtakes.service.ts:54-65`: *"S8: the liveness check and the read are ONE transaction… Split across two round trips, a project soft-delete landing between them answered 200-with-data where this file's own header says 404."* `deleteSnapshot` (`:98-113`) also wraps both.
- **Found by:** Integration & Data
- **Status:** Skipped
- **Status reason:** Deferred, not rejected — the finding is real and still stands. It was selected for the 2026-08-17 fix session and dropped during planning once its **value** (not its cost) was verified. Three things moved it: (1) the fix would land **untested**, because the sibling it copies — `listOuttakes` — has no transaction-membership test either (`outtakes.service.test.ts` carries only its four behavioural cases), so there is no precedent test to extend and nothing observable to assert; (2) the race requires two concurrent writers, which a single-user app with a synchronous single-connection SQLite driver does not produce in normal use — it needs the same person trashing a project in one tab while listing snapshots in another; (3) the payoff is a wrong status code (200-with-data instead of 404), not data loss. That combination makes it pure conformance. The same reasoning was applied consistently in that session to F-28's `createChapter` half, which *was* done on the narrower ground that its own file states the rule it breaks — a distinction worth re-examining rather than inheriting.
- **Status note (feasibility already established — do not re-derive):** the fix is safe and cheap whenever it is picked up. `SqliteProjectStore.transaction` throws `"Nested transactions are not supported"` when already scoped, so nesting is the hazard to check — and all three functions are called **only** from routes (`snapshots.routes.ts:42`, `:61`, `images.routes.ts:83`), never from inside an existing transaction, so the wrap is safe at every site. The driver is better-sqlite3 11.10.0 via Knex 3.2.9 with a `max: 1` pool, so the only cost is one extra BEGIN/COMMIT holding the sole connection across two trivial reads. **The trap to avoid:** every call inside the callback must go through the transaction-scoped store, never the outer one — a non-scoped `store.*` call from inside a transaction starves on that single connection until timeout rather than failing fast.
- **Status date:** 2026-08-17 11:05 UTC

### [F-30] Duplicate project title is a 400 where the codebase's other conflict cases are 409
- **Category:** 24 (Inconsistent API contracts)
- **Impact:** Low
- **Explanation:** The steering file defines 409 as "conflict cases where the request is well-formed but violates a constraint the client needs to resolve" — which describes a uniqueness collision exactly — and the sibling conflicts both use it.
- **Evidence:** `packages/server/src/projects/projects.service.ts:39-44` — `class ProjectTitleExistsError extends BadRequestError`, code `PROJECT_TITLE_EXISTS`. Compare `IMAGE_IN_USE` (`images.routes.ts:155`) and `RESTORE_CONFLICT` (`chapters.routes.ts:91`), both 409.
- **Found by:** Integration & Data (self-flagged marginal at 62 confidence)
- **Counter-argument, kept for honesty:** from the writer's view the title *field* is the invalid input and is fixed in place, which is a defensible 400; the client routes on `error.code`, so nothing is user-visibly wrong today. Kept because it is a deviation from the project's own written rule and cheap to state.

### [F-31] Bare `catch {}` on the auto-save path, where its sibling logs
- **Category:** 34 (Inconsistent error/logging conventions)
- **Impact:** Low *(down from Low-Medium)*
- **Explanation:** A persistent `chapter_statuses` lookup failure would silently degrade `status_label` on every save in the app, forever, with zero log lines — on the hottest endpoint in the app.
- **Evidence:** `packages/server/src/chapters/chapters.service.ts:145-154`:
  ```ts
  } catch {
    enriched = { ...stripCorruptFlag(updated), status_label: updated.status };
  }
  ```
  The identical degrade in `snapshots.service.ts:254-268` logs it with `{err, project_id, chapter_id}`, and [S-18] establishes that shape as near-universal.
- **Found by:** Error Handling & Observability
- **Note:** Distinct from accepted F-19, whose whole premise is that best-effort failures are "logged, not swallowed."
- **Status:** Fixed
- **Status reason:** `catch` now binds `err` and calls `logger.error({ err, project_id, chapter_id }, "enrichChapterWithLabel failed after save; returning status as label")` — the same level, field shape, and message form as the restore-path twin the finding cites, so the two degrades are now greppable as one class. The fallback behaviour is unchanged and still routed through `stripCorruptFlag` (I5): this adds a log line, it does not change what the client receives. Pinned by extending the existing `chapters.service.test.ts` fallback test rather than adding a second test of the same scenario.
- **Status caveat:** The finding was reported as fixed in an earlier session but **never landed** — no `fix(architecture)` commit and no status block existed, while `chapters.service.ts` still held the bare `catch`. Worth knowing that the report's silence, not the code, was the thing that drifted.
- **Status date:** 2026-08-16 07:26 UTC
- **Status commit:** 3284d365

### [F-32] Three different live-region clear durations, two of them inline literals
- **Category:** 28 (Magic numbers/strings)
- **Impact:** Low
- **Explanation:** Announcement dwell time is an a11y-relevant value with three uncoordinated owners — a duplicated 3000 for the same concept in two components, and an undocumented 1000 for a third.
- **Evidence:** `packages/client/src/components/ImageGallery.tsx:19,90` (`ANNOUNCEMENT_DURATION = 3000`); `packages/client/src/pages/EditorPage.tsx:1302` (`setTimeout(() => setImageAnnouncement(""), 3000)` — same image-announcement concept, different component); `packages/client/src/hooks/useKeyboardShortcuts.ts:193` (inline `1000`).
- **Found by:** Error Handling & Observability
- **Status:** Fixed
- **Status reason:** New `packages/client/src/constants.ts` owns both values — `ANNOUNCEMENT_DURATION_MS` (3000, imported by `ImageGallery` and `EditorPage`) and `NAV_ANNOUNCEMENT_DURATION_MS` (1000, imported by `useKeyboardShortcuts`). The module is a sibling of `strings.ts` / `statusColors.ts` / `sanitizer.ts`, so it follows the existing top-level-client-module pattern rather than introducing a new one. The two durations sit adjacent so the gap between them is legible in one place, which is the part a second literal in a third file would otherwise hide.
- **Status note (the 1000 is documented as UNEXPLAINED, not explained):** F-32 calls this value undocumented and it is. No recorded rationale for the 3x gap was found. A plausible reconstruction exists — arrow-key navigation repeats, so a long dwell would leave stale destinations queued — but it is a reconstruction, and the constant's doc comment says so explicitly rather than presenting the guess as a decision. The comment also warns anyone tempted to unify the two that they would be changing accessibility timing on the strength of the same missing rationale.
- **Status note (unifying all three was considered and rejected):** collapsing to a single duration would triple the nav announcement's dwell. That is an a11y behaviour change made to satisfy a tidiness finding, with no evidence about which value is correct. The finding asks for coordinated ownership, not a single value.
- **Status caveat (what the safety net does and does not pin):** six tests written before the change (commit `722c136f`) pin all three sites at the boundary — still announcing one tick before the dwell expires, cleared exactly on it. They passed **unmodified** across the refactor. They deliberately hard-code their expected durations rather than importing the constants, so they still redden if a value drifts: verified by setting the constants to 4000/1500, which produced exactly three failures, one per site. A test that imported the constant would have passed that check vacuously.
- **Status date:** 2026-08-19 08:58 UTC
- **Status commit:** 1ee1396e

### [F-33] No configuration inventory; eight runtime env vars, `LOG_LEVEL` documented nowhere
- **Category:** 22 (Configuration sprawl)
- **Impact:** Low
- **Explanation:** The *owners* are clean ([S-19]), but discoverability is not: there is no `.env.example`, no `docs/configuration.md`, and no Configuration section in `CLAUDE.md` or `CONTRIBUTING.md`.
- **Evidence:** Live set: `DATA_DIR`, `DB_PATH` (`config/paths.ts:15,25`), `LOG_LEVEL`, `NODE_ENV` (`logger.ts:6,14`), `SMUDGE_PORT` (`index.ts:17`, `scripts/restore.ts:25`, `vite.config.ts:103`), `SMUDGE_CLIENT_PORT` (`vite.config.ts:102`), `SMUDGE_BACKUP_KEEP` / `SMUDGE_SKIP_AUTO_BACKUP` (`scripts/auto-backup.ts:4,10`), `DEP_COOLDOWN_DAYS`. `docs/backup.md` covers two; `LOG_LEVEL` — the one knob an operator diagnosing a problem would reach for — appears in no doc, only in a `requestContext.ts:32` code comment.
- **Found by:** Error Handling & Observability
- **Note:** Already tracked as backlog id `afcaee1c` ("re-seen") — this is a re-confirmation, not a new discovery.
- **Status:** Fixed
- **Status reason:** Added `docs/configuration.md` — one row per variable with its default, valid values, and the fail-fast-vs-warn-and-fallback distinction that matters when a value is wrong (`SMUDGE_PORT` refuses to start; `LOG_LEVEL` degrades quietly to `info` with only a stderr warning). Because the finding is a *re*-confirmation — the gap closed once and drifted back — it is guarded rather than merely written: `scripts/__tests__/configuration-doc.test.mjs` compares literal `process.env.NAME` reads in production source against the table in both directions. Confirmed red first (ENOENT on the missing doc), with a scanner self-test so a regex matching nothing cannot make it vacuous. A pointer was added to `CLAUDE.md` §Build & Run, closing the "no Configuration section" half of the finding.
- **Status correction (the finding undercounted, and one option was unshippable):** the live set is **ten**, not eight — the scanner surfaced `BACKUP` (`packages/server/scripts/restore.ts:16`, required by `make restore`), which neither the report nor the fix plan had listed. That variable was found by the test on its first run, which is the clearest available argument for guarding this rather than hand-maintaining it. Separately, the finding names a missing `.env.example` as part of the gap: shipping one would have been **wrong**. There is no `dotenv` dependency anywhere in the tree and no code path reads a `.env` file (verified: zero `dotenv` hits in any `package.json`, no `.env*` files), so an example file would invite an operator to fill in settings nothing reads. The doc states the absence and its reason instead.
- **Status date:** 2026-08-17 10:38 UTC
- **Status commit:** c882d2b9
- **Status caveat:** the guard is weaker than F-19's and says so in its own header. Its source of truth is a regex over source, not a directory listing, so it cannot see destructured (`const { X } = process.env`) or computed (`process.env[name]`) reads. Green means "no *literal* `process.env.NAME` read is undocumented" — not "every environment variable is documented." Both the test header and the doc footer state this, so a future reader cannot mistake the green run for completeness.

### [F-34] Snapshot label cap gets none of the three treatments its sibling outtake label got
- **Category:** 34 (Inconsistent error/logging conventions)
- **Impact:** Low
- **Explanation:** Both paths share the same `LABEL_MAX_UNITS = 500`, but only the outtake path has the input cap, the discriminating server code, and the scope copy that review added because "the consumer REVERTS the visible label field on a definite failure."
- **Evidence:** Shared base at `packages/shared/src/schemas.ts:202,209-214`. Outtake: `maxLength={LABEL_MAX_UNITS}` (`OuttakeCard.tsx:263`), `OUTTAKE_LABEL_TOO_LONG` (`outtakes.routes.ts:24-35`), scope copy (`scopes.ts:524-527`). Snapshot: `SnapshotPanel.tsx:416-422` has no `maxLength`, the route emits no discriminating code, and `scopes.ts:477-481` has only fallback/network/committed — so an over-cap label fails with generic copy.
- **Found by:** Error Handling & Observability
- **Status:** Fixed
- **Status reason:** All three treatments applied, mirroring the outtake path. (1) `SnapshotPanel`'s create-label input carries `maxLength={LABEL_MAX_UNITS}`. (2) `SNAPSHOT_ERROR_CODES.LABEL_TOO_LONG` (`"SNAPSHOT_LABEL_TOO_LONG"`) is emitted by a `badRequestFromSchema` in `snapshots.routes.ts` keyed on Zod's issue shape (`too_big` on the `label` path), not on message text — so rewording the schema message cannot silently unmap the code, and a non-string label (`invalid_type` on the same path) does not get "too long" copy. (3) `scopes.ts` `snapshot.create` gains a `byCode` arm. Nine tests, each confirmed red first: the positive case plus the three negative cases (bad uuid, `.strict()` unknown key, non-string label) on the server, the positive plus three fallback cases on the mapper, and the input-cap assertion on the panel.
- **Status correction (the finding's stated rationale is half wrong):** F-34 justifies the treatment by quoting the outtake reason — *"the consumer REVERTS the visible label field on a definite failure."* That is true of outtake **update** and **false** of snapshot **create**: `SnapshotPanel.tsx:329-346` routes a definite failure through `onMessage: setCreateError` only, leaving `createLabel` intact; it clears the field solely on success (`:326`) and on the committed path (`:342`). So the "typed text vanishes under the wrong cause" harm does not exist here. The treatment was applied anyway on a **different** and still-valid ground: the generic `createFailedGeneric` copy ("Unable to create snapshot. Try again.") invites a retry that reproduces the failure forever — the doomed-retry problem the outtake scope's 413 arm exists for. Recorded at `scopes.ts` so the divergence in reasoning is not re-flattened.
- **Status note (why `byCode` and not `byStatus`):** `CreateSnapshotSchema` is `.strict()` and `validateUuidParam` throws before the schema runs, so this endpoint has at least four distinct 400 producers. A `byStatus[400]` arm would put cap copy on three failures that are not the cap — the exact mistake S8 had to undo for `outtake.update`.
- **Status note (parts 2 and 3 are unreachable from the shipped UI, deliberately):** with `maxLength` on the input the browser blocks over-cap text including on paste, so the server code and its copy defend a path this panel can no longer produce. Kept anyway, matching the precedent of `outtake.create`'s 413 arm which is documented as near-unreachable and retained: the client cap is an HTML attribute, and it is the only thing standing between a non-panel caller and copy that invites an impossible retry.
- **Status caveat (a near-duplicate was introduced, knowingly — SINCE RESOLVED, see below):** `badRequestFromSchema` now exists in both `snapshots.routes.ts` and `outtakes.routes.ts`, differing only in the constant they emit. A shared helper taking that constant would collapse them, but doing so means editing `outtakes.routes.ts` — a module F-34 does not touch — turning a fix into a cross-module refactor. The duplication is recorded at the code rather than defended, with the instruction that a third copy should be extracted instead. **This is a candidate for the out-of-scope backlog.**
- **Caveat resolution (2026-08-19):** the duplication is gone, and the caveat's prediction about where it would land was wrong. The agentic review of 2026-08-19 09:10 raised it as `[S2]` and classified it **in-scope**, not out-of-scope: the blame check reads only whether the anchor line is newly written, and these lines were — this branch created the duplication rather than inheriting it. So no backlog entry was ever minted for it. It was then collapsed into a shared `packages/server/src/badRequestFromSchema.ts` taking the code as a parameter, placed beside `validateUuidParam.ts` on the same precedent (a route-level helper throwing `BadRequestError`, lifted out of `snapshots.routes.ts`, shared with outtakes). Both routes' existing positive and negative code tests passed **unmodified** across the change, which is what made the extraction safe to do without re-deriving the predicate. The `issues[0]`-only limit was carried across deliberately and is now documented once, at the shared helper, instead of twice.
- **Status date:** 2026-08-19 08:35 UTC
- **Status commit:** 1ace7b74

### [F-35] Render-failure catches discard the error object entirely
- **Category:** 21 (No observability plan)
- **Impact:** Low
- **Explanation:** Both render-failure paths surface correct user copy but neither logs. A `renderEditorHtml` throw means a mark or node the shared extension set cannot render — exactly the class of bug the `editorExtensions.test.ts` forcing pause exists to catch — and it is invisible even in dev.
- **Evidence:** `packages/client/src/components/PreviewMode.tsx:47-54` (`catch { return null; }`) and `packages/client/src/hooks/useSnapshotController.ts:46-52` (`catch { return \`<p>${STRINGS.snapshots.renderError}</p>\`; }`). This is a deviation from the codebase's own convention — `clientWarn` is used at 64 sites — not merely an instance of the DEV-only logging policy.
- **Found by:** Error Handling & Observability
- **Status:** Fixed
- **Status reason:** Both catches now bind `err` and call `clientWarn(...)` — `renderSnapshotContent` (`useSnapshotController.ts`) and `renderChapterHtml` (`PreviewMode.tsx`). `clientWarn` is the convention the finding cites and is DEV-gated, so production behaviour is unchanged and the user-facing copy in both paths is untouched. Pinned by extending the two existing render-failure tests rather than adding new scenarios; both route through `expectConsole` per the zero-warnings rule, so the new logs both assert and stay out of the test output.
- **Status caveat:** This restores the *developer's* signal only. Neither path tells the reader why the render failed, and neither should — the finding's premise is that the user copy was already correct. Note also that `PreviewMode`'s `!content` guard still owns the empty case, so the new warn cannot fire for an untouched chapter (the I3 conflation this file already fixed).
- **Status date:** 2026-08-16 15:59 UTC
- **Status commit:** 666872ca

### [F-36] A lock-down that lands while no editor is mounted is silently dropped
- **Category:** 20 (Weak error handling strategy) / save-pipeline invariant violation
- **Impact:** Medium
- **Found by:** the F-07 safety-net pass, 2026-08-18 (not present in the original review)
- **Explanation:** `safeSetEditable` returns `false` when `editorRef.current` is null and **every caller ignores that return**, so an `editable:false` intent expressed while no editor is mounted is dropped. (Precision added 2026-08-18 by the branch review: at the time of this finding the ref was not even nulled on unmount — see OOSI2, fixed in `eb67c337` — so on this exact path `safeSetEditable` took its *non-null* branch, no-opped against a destroyed editor, and returned `true`. The intent was dropped either way; the null-ref mechanism described here only became the real one once that cleanup landed.) The reconcile effect (`EditorPage.tsx:615-617`) cannot recover it: its deps are `[state.editable, activeChapter?.id, chapterReloadKey]`, none of which change when an editor merely mounts, so a fresh TipTap comes up at its default `editable:true`. This violates save-pipeline invariant #2 — "the user must not be able to type into content that is about to be overwritten or is in an error state."
- **Evidence (reproduced, not inferred):** restore a snapshot, let the confirming `GET /api/chapters/{id}` fail. DOM probe at the settled state: `snapshotViewUp: false | lockBannerUp: true | contenteditable: true`. A 3s `waitFor` on `contenteditable="false"` times out — it never converges. The restore is initiated from snapshot view, where **no editor is mounted** (pinned by the C2 test's own assertion), so the lock-down `setEditable(false)` no-ops; the reload-failure path then leaves snapshot view and mounts a fresh editor under the persistent lock banner. The sibling replace path is immune only because its editor never unmounts, which is why this survived review.
- **Severity, checked rather than assumed:** `handleSaveLockGated` (`EditorPage.tsx:220-226`) returns `false` while `isLocked()`, so no PATCH is issued and stale content cannot overwrite the committed restore. The harm is therefore **lost typing, not server-side data loss**: the writer types into an editor that saves nothing, then follows the banner's instruction to refresh and loses it.
- **Status:** Fixed
- **Status reason:** `Editor` gained an `editable` prop applied at TipTap construction, fed from `editorMachine.state.editable` via `EditorMainContent`. A mount that happens while a lock is already up is now read-only from its first render — no editable-for-one-tick window. Ongoing transitions still flow through the imperative `setEditable` handle (Decided Q3 unchanged). Red test first: the assertion was confirmed failing against the pre-fix code.
- **Status note (an objection raised and then disproven — do not re-derive it):** this fix was reversed mid-session on the argument that a render-time `editable` prop creates a *second, asynchronous owner* of editability able to override the imperative handle. `/paad:rethink` established that argument is **false**, against the library rather than its docs: `@tiptap/react` 2.27.2's per-render reconcile does call `setOptions`, but explicitly pins `editable: this.editor.isEditable` (`dist/index.js:977`) precisely so the option cannot clobber imperative state — and Smudge takes that branch, since `useEditor` is called with no deps array. The handle stays authoritative. Two supporting claims were also false: the test cited as evidence of breakage (`EditorPageCtrlSFlush`) **mocks the Editor component out entirely**, so no TipTap instance exists in that file and the mechanism could not fire there; and the failure blamed on the change is pre-existing (see F-37). What *was* correct: the re-application is not inert — `editable` reaches ProseMirror as a live plugin prop (`@tiptap/core:3920-3932`) and `updateState` re-reads it and rewrites the DOM attribute — so had line 977 not existed, the hazard would have been real. **That guard is load-bearing:** a TipTap upgrade dropping it hands editability back to the render path. The canary is `Editor.test.tsx`'s "keeps imperative setEditable(false) authoritative across a re-render" (added 2026-08-18 for S1) — it holds the prop at `true` while the handle says `false`, the only combination a dropped pin can break. The "constructs read-only under a lock" test does **not** cover it: intent is false throughout there, so a re-applying render path pushes the identical value and stays green.
- **Status caveat (residual, accepted):** `@tiptap/react`'s `scheduleDestroy` re-applies options **unguarded** (`dist/index.js:1035`), unlike the render path. Reachability in Smudge's lifecycle is **unsettled** — both ordinary re-renders and StrictMode cancel that 1ms timer synchronously, so reaching it needs cleanup and re-attach separated across macrotasks, which could not be constructed from this codebase. Cheapest experiment if it ever matters: spy on `Editor.prototype.setOptions` while driving the real restore flow. Separately (corrected 2026-08-18): an earlier revision of this caveat claimed the fix adds a redundant per-render `setOptions` + `view.updateState` while intent and actual editability disagree. That reconcile fires **unconditionally on every render** for a pre-existing reason, so the fix adds zero churn — but the mechanism first recorded here was wrong and is corrected (2026-08-18, code-review S5): `EditorInstanceManager.compareOptions` (`@tiptap/react` 2.27.2, `dist/index.js:933-935`) opens with an explicit skip list containing `onUpdate` and `onBlur`, commented "we don't want to compare callbacks, they are always different and only registered once", so the inline closures contribute **nothing** to the mismatch. What actually defeats the comparison is the `extensions` array — compared element-by-element at `:940-951`, and `Placeholder.configure` / `imagePasteExtension.configure` mint fresh extension objects each render — plus the inline `editorProps` object literal at `Editor.tsx:337`, which is not on the skip list. (`editorProps` is the third mechanism the prior review's I1 named; the correction that closed I1 dropped it in favour of two non-mechanisms.) This matters for a future author who memoizes `editorProps` and the extension array: that is the change that would make the comparison start matching and put the `editable` option back in the reconcile path, and the old wording pointed them at callbacks instead.
- **Status caveat (the deeper cause, partly closed 2026-08-18):** the fix closes the mount path, not the root — `safeSetEditable`'s `false` return still means "not applied" and is still ignored at every call site, so any *other* future consumer of a dropped intent has no guard. Making that return observable is a separate change and was deliberately not bundled. Note the originally-named follow-up would **not** have caught this class: pre-OOSI2 the stale-handle path reported `true`, so a caller dutifully checking the boolean got a false all-clear. `eb67c337` fixes that half — the return value is now honest — which is the prerequisite for making it observable rather than a substitute for it.
- **Status date:** 2026-08-18 07:35 UTC
- **Status commit:** 464b80f7

### [F-37] `EditorPageCtrlSFlush` save-failed-banner test flakes ~10% of runs
- **Category:** 32 (Missing/unreliable test coverage for critical paths)
- **Impact:** Medium
- **Found by:** the F-36 fix pass, 2026-08-18 (not present in the original review)
- **Explanation:** `EditorPageCtrlSFlush.test.tsx` — "surfaces the save-failed banner when the editor throws synchronously mid-flush" — fails roughly one run in ten, with `Unable to find an element with the text: Save failed. Try again.`. It is **pre-existing and unrelated to F-36**: measured at **2 failures / 20 runs with the F-36 change stashed**, against a comparable ~3 / 34 with it applied. An initial 8-run sample that came back clean is what briefly made it look like a regression — a caution about small samples, not about the fix.
- **Why it matters more than an ordinary flake:** it sits in the save pipeline, which the testing philosophy names as the core trust promise and the code that gets the most rigorous coverage. A test that cries wolf 10% of the time in that area trains readers to dismiss it, which is exactly how the 11th failure — a real one — gets waved through. It also silently weakens every future architecture-fix session's baseline, since a fix can be blamed for it or excused by it.
- **Not yet diagnosed.** The likely shape is a timing race between the synchronous mid-flush throw and the banner assertion (the test is one of the slower ones in the file at ~1s), but no root cause was established — this entry records the measurement, not a theory.
- **Suggested first step:** run the single test in a loop with `--reporter=verbose` and capture the DOM at failure; compare against the passing run to see whether the banner never appears or appears after the query.
- **Status:** Not yet fixed *(investigated 2026-08-19; kept open deliberately)*
- **Status note (does not reproduce here — 60 runs, 0 failures):** measured on 2026-08-19 across three conditions: 30 isolated single-test runs (`-t` filter), 20 whole-file runs, and 10 full-suite runs. Zero failures in all 60. The full-suite condition is the only representative one and 10 runs is a small sample — at a true 10% rate there is a ~35% chance of seeing zero by luck — so this is **not** evidence the flake is gone, and the finding stays open. A larger sample was abandoned: the stress harness overloaded the development machine, and reproduction was judged not worth the cost when the mechanism could be settled by reading instead.
- **Status note (the obvious diagnosis is wrong — do not re-derive it):** the natural hypothesis is that `findByText` timed out under CPU load. Its default timeout **is** 1000 ms (`node_modules/@testing-library/dom/dist/config.js:15`, `asyncUtilTimeout: 1000`), and the reported message **is** the one a `findBy*` timeout produces (`queries/text.js:49`, wrapped in `waitFor` by `query-helpers.js:84`). But the hypothesis is still incoherent, because the path is synchronous end to end: `useKeyboardShortcuts.ts:123` invokes the callback as `flushSaveRef.current?.()` un-awaited, and inside it `await editorRef.current?.flushSave()` evaluates the call **before** the `await` suspends — so the mock's synchronous throw is caught, and `setActionError` runs, inside `pressCtrlS`'s `act()`. The banner is therefore committed before `findByText` is ever called and its first poll succeeds. **When this test fails, the banner never appears at all; it is absent, not late.** Raising the timeout would change nothing but the duration of the failure.
- **Status note (the guards are not the cause either):** `mutation.isBusy()` is backed by `inFlightRef` (`useEditorMutation.ts:538`), set only during a mutation run; the machine starts at `{editable: true, lock: null}` (`useEditorMutationMachine.ts:40-43`) and `isLocked()` is `lock !== null` (`:114`). Neither early return can fire during initial page load.
- **Status note (one silent path, unsettled):** `await editorRef.current?.flushSave()` — if `editorRef.current` is null at that instant, the optional chaining yields `undefined`, `await undefined` resolves, nothing throws, and no banner appears, failing with exactly the reported message. Whether that is reachable here was **not** settled; the mock publishes the handle from a `useEffect` and the test's mount wait should flush it. Recorded as a candidate, not a conclusion.
- **Status note (no commit explains its disappearance):** two commits touched the editor after the F-36 pass that recorded this finding. `eb67c337` (2026-08-18 14:36) adds an unmount cleanup to the real `Editor`, which this test replaces with a mock, so it cannot affect it. `dbed44a1` (2026-08-18 16:34) re-keys an `EditorPage` effect onto the machine state object. Neither is a plausible cause. No commit is claimed as the fix.
- **What was changed (2026-08-19):** the two assertions in the failing test were **reordered** so the warning-spy check runs before the banner check. Both fail when the test flakes, but they carry different information: "banner not found" is produced identically by a blocked guard, an unpublished editor handle, and a handler that never ran, whereas the warning distinguishes "the handler ran and caught the throw" from "it never reached its catch". Negative control: forcing an early return in the handler produces `expected "warn" to be called ... Number of calls: 0` instead of the ambiguous banner message. This is a **diagnostic** change, not a fix — it does not make the test less flaky, it makes the next occurrence self-explaining.

---

## Coverage Checklist

### Flaw/Risk Types 1–34

| # | Type | Status | Finding |
|---|------|--------|---------|
| 1 | Global mutable state | Not observed (decided) | — (accepted trade-off F-3 covers the process-global store/db singletons) |
| 2 | God object | Not observed (decided) | — (accepted trade-off F-1; the premise drift is [F-04], typed 13) |
| 3 | Tight coupling | Observed | [F-23] |
| 4 | High/unstable dependencies | Observed | [F-11] (the phantom-dependency half) |
| 5 | Circular dependencies | Observed (unguarded, not present) | [F-09]; actual cycles: none, see [S-02] |
| 6 | Leaky abstractions | Not observed | — (candidates re-typed to 13: [F-10], [F-22]) |
| 7 | Over-abstraction | Not observed | — ([F-08] re-typed to 31; the slice-interface candidate dropped as accepted F-4) |
| 8 | Premature optimization | Not observed | — (candidate adjudicated in favour of the strength, [S-17]) |
| 9 | Shotgun surgery | Observed | [F-03] |
| 10 | Feature envy / anemic domain model | Not observed (decided) | — (accepted trade-off F-18) |
| 11 | Low cohesion | Observed | [F-16], [F-18] |
| 12 | Hidden side effects | Not observed (decided) | — (accepted trade-off F-19) |
| 13 | Inconsistent boundaries | Observed | [F-04], [F-10], [F-17], [F-19], [F-22] |
| 14 | Distributed monolith | Not applicable | Single Express process, one SQLite handle, one SPA — verified, not assumed |
| 15 | Chatty service calls | Not applicable | No second service |
| 16 | Synchronous-only integration | Not applicable | No message bus / RPC surface |
| 17 | No clear ownership of data | Observed | [F-05] (intra-process form) |
| 18 | Shared database across services | Not applicable | One process owns the DB |
| 19 | Lack of idempotency | Not observed (decided) | — (accepted trade-off F-8; the retry partitioning is a strength, [S-12]) |
| 20 | Weak error handling strategy | Observed | [F-13], [F-15], [F-36] |
| 21 | No observability plan | Observed | [F-35] |
| 22 | Configuration sprawl | Observed | [F-33] |
| 23 | Dependency injection misuse | Not observed | — |
| 24 | Inconsistent API contracts | Observed | [F-06], [F-24], [F-25], [F-26], [F-30] |
| 25 | Business logic in the UI | Not observed | — |
| 26 | Poor transactional boundaries | Observed | [F-27], [F-28], [F-29] |
| 27 | Temporal coupling | Observed | [F-07], [F-21] |
| 28 | Magic numbers/strings everywhere | Observed | [F-32] |
| 29 | "Utility" dumping ground | Not observed | — |
| 30 | Security as an afterthought | Observed | [F-01] |
| 31 | Dead code / unused dependencies | Observed | [F-08], [F-11], [F-20] |
| 32 | Missing/inadequate test coverage for critical paths | Observed | [F-02], [F-14], [F-37] |
| 33 | Hard-coded credentials or secrets in source | Not observed | — (see [S-25]) |
| 34 | Inconsistent error/logging conventions | Observed | [F-12], [F-31], [F-34] |

### Strength Categories S1–S14

| # | Category | Status | Finding |
|---|----------|--------|---------|
| S1 | Clear modular boundaries | Observed | [S-01], [S-04] |
| S2 | High cohesion | Observed | [S-06] |
| S3 | Loose coupling | Observed | [S-02], [S-08] |
| S4 | Dependency direction is stable | Observed | [S-03], [S-01] |
| S5 | Dependency management hygiene | Observed | [S-09] |
| S6 | Consistent API contracts | Observed | [S-10], [S-11] |
| S7 | Robust error handling | Observed | [S-14], [S-15], [S-10] |
| S8 | Observability present | Observed | [S-16], [S-17], [S-18] |
| S9 | Configuration discipline | Observed | [S-19], [S-20] |
| S10 | Security built-in | Observed | [S-13], [S-21], [S-22], [S-25] |
| S11 | Testability & coverage | Observed | [S-23], [S-24] |
| S12 | Resilience patterns | Observed | [S-12] |
| S13 | Domain modeling strength | Observed | [S-05] |
| S14 | Simple, pragmatic abstractions | Observed | [S-07] |

---

## Hotspots

1. **`packages/server/src/db/purge.ts` + the `runRestore` DB-payload boundary in `packages/server/src/backup/backup-core.ts`** — the only High-impact security finding ([F-01]) lives in the seam between them: the archive is validated exhaustively, the DB inside it not at all, and the purge trusts a DB-sourced string as a filesystem path for a recursive delete. Review the two together, not separately.

2. **`packages/client/src/hooks/useSnapshotController.ts`** — 68.4% statements / 48.9% branches, no dedicated test file, and the uncovered set is precisely the `committed_but_unreloaded` / lock / stale-chapter fan that the save-pipeline invariants exist to protect ([F-02]). It is also the second consumer of the `useEditorMutation` seam whose contract is convention-only ([F-07]), so the two findings compound.

3. **`packages/server/src/outtakes/` as the reference implementation, and its five un-upgraded siblings** — outtakes is a genuine strength ([S-05], [S-11]) and simultaneously the yardstick that exposes [F-10] (chapters' weaker corruption gate), [F-25] (`.strict()` on new schemas only), [F-29] (single-transaction liveness reads), [F-34] (label-cap treatment), and [F-12] (its own read-after-insert taxonomy gap). The hotspot is not the module — it is the delta between it and `chapters/`, `snapshots/`, `images/`.

Runner-up worth naming: **`packages/client/src/pages/EditorPage.tsx`**, where the accepted F-1 trade-off's stated premise no longer describes the residual ([F-04]).

---

## Next Questions

1. Does the backup-restore threat model intend to cover a hostile `smudge.db` payload, or only a hostile archive envelope? The zip defenses are exhaustive and the DB payload is uninspected — which of those two is the deliberate line?

2. When outtakes established a stricter pattern (schema-based corruption gate, `.strict()` request schemas, single-transaction liveness reads, discriminating label-length codes), was propagating it to the older domain modules considered and deferred, or not considered?

3. `eslint-plugin-import` is installed, registered, and already parsing the tree with one rule enabled. What kept `import/no-cycle` and `import/no-extraneous-dependencies` off — a known false-positive problem, or simply that nobody reached for them?

4. Is the `useEditorMutation` → `COMMITTED_UNRELOADED` handoff meant to stay a consumer obligation, given that the one time a third code path met it (`useFindReplaceController`, OOSI1) it was patched at the consumer rather than at the seam?

5. `CLAUDE.md`'s structure diagram is now roughly half the server's modules out of date while its per-decision prose is meticulously current. Is the diagram still meant to be load-bearing, or has its role been superseded by the decision logs in `docs/roadmap-decisions/`?

---

## Analysis Metadata

- **Agents dispatched:** 5 specialists in parallel — Structure & Boundaries (flaw types 1, 2, 9, 10, 11, 13, 29; strengths S1, S2, S13, S14) · Coupling & Dependencies (3, 4, 5, 6, 7, 8, 23, 27; S3, S4, S5) · Integration & Data (14–19, 24, 26; S6, S12) · Error Handling & Observability (12, 20, 21, 22, 25, 28, 34; S7, S8, S9) · Security & Code Quality (30, 31, 32, 33; S10, S11). Followed by 2 verifier agents (flaws / strengths), split from the single-verifier default because 72 raw findings exceeded what one agent could confirm by reading code for each.
- **Scope:** ~180 non-test source files across `packages/{shared,server,client}/src`, `packages/server/scripts/`, `scripts/`, `e2e/`, plus root config. Excluded: `packages/*/dist/` (build output), `.devcontainer/` (project policy).
- **Raw findings:** 72 (43 flaws, 29 strengths)
- **Verified findings:** 60 (35 flaws, 25 strengths)
- **Filtered out:** 12 — 5 dropped (4 flaws, 1 strength) and 7 merged as cross-specialist duplicates
- **By impact:** 11 High (2 flaws, 9 strengths), 26 Medium (13 flaws, 13 strengths), 23 Low (20 flaws, 3 strengths)
- **Dropped, with reasons:** `content-hash.ts` LRU as premature optimization (adjudicated in favour of the strength, [S-17]) · `ProjectStore` slice interfaces as over-abstraction (restatement of accepted F-4) · `useContentCache` partial-clear loop (the realistic `localStorage` throw fires on the first iteration, not the k-th, so the described failure mode is unreachable) · DEV-only client logging as an observability gap (a deliberate, documented, lint-enforced decision correct for the single-user localhost threat model) · "three parallel registries keyed the same way" as a strength (the key alignment is thematic and unenforced — `outtake.update`↔`api.outtakes.updateLabel`, `findReplace.search`↔`api.search.find`, and `chapter.flushBeforeNavigate` has no `api` twin at all)
- **Steering files consulted:** `CLAUDE.md` (read in full by all seven agents, including its "Accepted Architectural Trade-offs" section — findings claiming an accepted premise had changed were scrutinized specifically), `CONTRIBUTING.md`, `docs/roadmap.md`, `docs/dependency-licenses.md`, `docs/backup.md`, `paad/architecture-reviews/2026-07-11-smudge-architecture-report.md`
- **Corrections the verifiers applied to specialist claims (claim kept, number fixed):** `getDb` has 2 production call sites, not 3 · 5+ shared parity tests read sibling sources as text, not 3 · `dep-cooldown-core.mjs` exports 19 symbols, not 20 · `mapApiError` is used at 66 call sites, not 122 · there are 2 unlogged deviations from the best-effort logging shape, not 1 · "exactly one `generateHTML` call site" is true for production only (2 test files call it directly, one deliberately to prove the leak) · the coverage-surface claim was re-derived independently (145 expected source files, 0 missing; the remaining 15 entries are `db/migrations/*.js`)
