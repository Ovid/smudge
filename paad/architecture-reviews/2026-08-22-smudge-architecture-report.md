# Architecture Report — smudge

**Date:** 2026-08-22
**Commit:** 572f7a6673846cabc2a711c8f09af9158ddfb9b1
**Languages:** TypeScript (Node.js 22 / Express 4 backend, React 19 / Vite / TipTap v2 frontend), better-sqlite3 + Knex, Zod, Vitest + Playwright
**Key directories:** `packages/shared/`, `packages/server/`, `packages/client/`, `e2e/`, `scripts/`
**Scope:** Full repository (`.devcontainer/` excluded per project policy; `packages/*/dist/` excluded as build output except where the emitted artifact is itself the finding — F-12)

## Repo Overview

Smudge is a single-user, no-auth, single-process web application for writing
long-form fiction and non-fiction, organized as projects containing chapters.
It is an npm-workspaces monorepo of three packages: `shared` (types, Zod
schemas, `countWords()`, TipTap JSON utilities, imported isomorphically),
`server` (Express API layered `Routes → Services → ProjectStore facade →
Repositories`, better-sqlite3 through Knex, a typed `AppError` taxonomy, and
domain modules for projects, chapters, chapter-statuses, settings, velocity,
snapshots, images, search, export, outtakes and backup), and `client` (a React
SPA whose editor save-pipeline is built from purpose-built hooks —
`useEditorMutation`, `useEditorMutationMachine`, `useAbortableSequence`,
`useAbortableAsyncOperation` — plus centralized error-mapping and
string-externalization layers). 176 non-test source files, 382 including tests;
159 test files across the three packages plus 14 Playwright specs; 15 Knex
migrations; coverage thresholds enforced at 95/85/90/95.

This report is a fresh pass on the tree **after** the `ovid/architecture` fix
branch landed against the 2026-08-11 report. It is not a re-read of that
report.

The dominant finding is a change in character rather than in quality. The
codebase's internal discipline remains very high — 29 verified strengths, 12 of
them High impact, and several of them (the note-mark strip, the containment
path guard, the restore ordering, the import-cycle detector's own tripwire) are
better than what most production codebases ship. But **the two High-impact
flaws are both at the edges the internal discipline does not reach**: one is a
data-identity defect in slug resolution that can make a writer's own trashed
chapters unreachable until they are purged, and the other is that the server
binds every network interface with no authentication, no `Host` check and no
`Origin` check. Neither is a failure of the layering, the error taxonomy, or
the test discipline. Both sit just outside them.

The secondary theme, consistent with the previous report, is **a good pattern
applied to some sibling sites and not others**: shared error-code constants for
three domains and bare literals for the rest (F-05), a transaction-wrapped
liveness check on four read paths and not the five biggest (F-28), a
schema-to-400 helper used at three of eleven sites (F-33). Twenty-two of the
thirty-eight confirmed flaws are Low impact and most are of this shape.

---

## Strengths

### [S-01] The error-status allowlist is enforced from both ends of the taxonomy, and the second end exists because the first was insufficient
- **Category:** S6 (consistent API contracts) / S7 (robust error handling) / S14 (simple, pragmatic abstractions)
- **Impact:** High
- **Explanation:** `ERROR_STATUS_ALLOWLIST` is a single machine-readable `ReadonlySet` with two enforcement points covering disjoint cases — the `AppError` constructor *throws* on an off-allowlist status, and `globalErrorHandler` *clamps* anything that is not an `AppError`. Both are needed because the clamp runs after the handler's `instanceof AppError` early return.
- **Evidence:** `packages/server/src/errors/appError.ts:41` (`ERROR_STATUS_ALLOWLIST`), `:50-73` (constructor), `packages/server/src/app.ts:140-145` (`globalErrorHandler`), excerpt: `if (!ERROR_STATUS_ALLOWLIST.has(status)) { throw new TypeError(...outside ERROR_STATUS_ALLOWLIST — reuse an allowed status with a discriminating code...) }` and `const status = ERROR_STATUS_ALLOWLIST.has(rawStatus) ? rawStatus : rawStatus >= 400 && rawStatus < 500 ? 400 : 500;`
- **Found by:** Integration & Data, Error Handling & Observability, Structure & Boundaries (three-way agreement)
- **Note:** The throw-rather-than-clamp choice in the constructor is deliberate and documented ("an off-allowlist status is a programming error, not a runtime condition to paper over"); `rawStatus` is preserved in the log so the clamp never hides the original. The same "make the bad state unrepresentable in ~10 lines" shape recurs at `packages/client/src/hooks/usePersistedState.ts`, where `parse` is the single validator for **both** read and write directions (the setter normalizes via `parse(serialize(next))`), so the two paths structurally cannot drift.

### [S-02] The editor-only note mark is stripped at four independent layers, and `renderEditorHtml` really is the only route from TipTap JSON to HTML
- **Category:** S10 (security built-in)
- **Impact:** High
- **Explanation:** The steering file's central rendering claim was verified rather than assumed: a grep for `generateHTML(` across all of `packages/*/src` returns exactly one production call site, inside `renderEditorHtml`, which strips note marks first.
- **Evidence:** `packages/shared/src/editorExtensions.ts:61` (`renderEditorHtml`), `packages/server/src/export/docx.renderer.ts:486` (`tipTapToParagraphs`), `packages/server/src/export/export.renderers.ts:80-82` (`stripNoteSpans`), `packages/client/src/sanitizer.ts:31-40` (`ALLOWED_TAGS`), excerpt: "Do NOT add `span` to this list to support a future mark without first confirming its marks are stripped before render; DOMPurify's ALLOW_DATA_ATTR defaults to true, so `data-note` would ride in with it."
- **Found by:** Security & Code Quality
- **Note:** The strip walker fails **closed** in three separate ways — array child dropped, over-depth subtree dropped, non-array `content` container dropped — each with the concrete leak it prevents recorded inline. Note text lives in `mark.attrs.text`, not a text node, so plaintext walkers structurally cannot emit it.

### [S-03] The path-traversal guard is containment-based rather than shape-based, and covers every DB-string-to-filesystem join
- **Category:** S10 (security built-in)
- **Impact:** High
- **Explanation:** `containedPath` resolves and asserts the result stays under the root, and refuses equality with the root so an empty segment cannot resolve to "the whole image store" and be handed to a recursive delete.
- **Evidence:** `packages/server/src/config/paths.ts:61-68` (`containedPath`), excerpt: `const full = path.resolve(resolvedRoot, ...segments); if (!full.startsWith(resolvedRoot + path.sep)) { throw new Error(...) }`
- **Found by:** Security & Code Quality
- **Note:** Every filesystem join in `packages/server/src` was audited against it. The two unguarded joins (`images.reaper.ts:62,82`) take both operands from `fs.readdir` entries, which structurally cannot contain a separator. The doc comment traces the actual attack chain — restore writes `smudge.db` verbatim, next boot runs `purgeOldTrash`, which recursive-`rm`s what it is handed — rather than asserting a rule.

### [S-04] Restore never deletes, and every precondition that can refuse runs before the first destructive step
- **Category:** S12 (resilience patterns) / S10 (security built-in)
- **Impact:** High
- **Explanation:** Seven independent checks — central-directory parse without decompressing, zip-slip validation, declared-size and compression-ratio caps, running-server probe, typed-filename confirmation, per-partition free-space precheck, and full JSZip entry resolution — all complete before the live data dir is renamed aside, and it is renamed rather than removed.
- **Evidence:** `packages/server/src/backup/backup-core.ts:169-370` (`runRestore`), excerpt at `:245-268`: "loadAsync itself throws on an archive that was never openable at all ... opening after the rename destroyed the live data dir before discovering the archive was unusable (OOSS1)."
- **Found by:** Integration & Data, Security & Code Quality (agreement)
- **Note:** Two details show reasoning rather than copying: every refusal `JSON.stringify`s the offending entry name before printing, because the name is up to 65535 attacker-controlled bytes going straight to an operator's terminal where an embedded CR or ANSI erase-line could overwrite the abort notice itself (CWE-117); and directory classification asks JSZip `entry.dir` rather than testing `name.endsWith("/")`, because central-directory and local-header names are separate attacker-controlled key spaces.

### [S-05] The export image allowlist is simultaneously an SSRF guard, and the third-party behaviour that makes it one was verified
- **Category:** S10 (security built-in)
- **Impact:** High
- **Explanation:** `stripDisallowedImages` drops any `<img>` whose `src` is not a relative `/api/images/<uuid>`, and it runs before the HTML reaches `epub-gen-memory`, which fetches every image URL in the content it is given.
- **Evidence:** `packages/server/src/export/export.renderers.ts:62` (`ALLOWED_IMAGE_SRC`), `:85-89` (`chapterContentToHtml`), excerpt: `return stripNoteSpans(stripDisallowedImages(renderEditorHtml(content)));`
- **Found by:** Security & Code Quality
- **Note:** The reachability premise holds — `TipTapDocSchema` is `.passthrough()` and DB reads bypass Zod entirely, so an absolute `src` can enter chapter JSON through a hand-edited DB or a restored backup. The code's own comment frames this as XSS and tracking-pixel defence; the SSRF closure appears to be real but unstated. DOCX, which never renders HTML, carries the same anchored allowlist at its own walker entry.

### [S-06] Dual-store write ordering is deliberate in both directions, with a startup reaper closing the loop
- **Category:** S12 (resilience patterns)
- **Impact:** High
- **Explanation:** Upload writes the file first then inserts the row and unlinks on insert failure — except for the one error that means the insert actually committed. Delete removes the row inside the transaction and unlinks after commit, so a failure yields a harmless orphan rather than a ghost row.
- **Evidence:** `packages/server/src/images/images.service.ts:99-118` (upload catch), `:250-265` (delete), `packages/server/src/images/images.reaper.ts:41-89` (`reapOrphanImages`), excerpt: "F-12: this used to unlink unconditionally ... That assumption is false for exactly one error: READ_AFTER_INSERT_FAILURE means the INSERT *succeeded* ... turning a recoverable glitch into permanent corruption."
- **Found by:** Integration & Data
- **Note:** The reaper matches only `<uuid>.<ext>` filenames the app itself writes, so an operator's `.bak` sharing a uuid prefix is never touched.

### [S-07] The save pipeline's retry ladder classifies terminal versus transient from the scope registry rather than a hand-coded list
- **Category:** S12 (resilience patterns)
- **Impact:** High
- **Explanation:** One `saveOp.run()` owns the whole retry cycle, so a single `abort()` severs both the in-flight PATCH and the backoff sleep; the break decision reads `terminalCodes` / `committedCodes` / `terminalStatuses` from the scope registry, so a write that may have committed is never blindly retried.
- **Evidence:** `packages/client/src/hooks/useProjectEditor.ts:395-589`, `:514`, excerpt: `if (isApiError(err) && (mapped.terminal || mapped.possiblyCommitted)) { ... break; }`
- **Found by:** Integration & Data
- **Note:** Each attempt re-reads `latestContentRef`, so a backoff retry posts keystrokes typed during the wait. The underlying `PATCH /chapters/:id` is a genuinely idempotent full-content replace, which is what makes retry safe at all.

### [S-08] The client's error layer is a single owner, and the "raw `err.message` never reaches the UI" invariant holds under audit
- **Category:** S7 (robust error handling)
- **Impact:** High
- **Explanation:** Every message synthesized inside the transport carries a `[dev]` prefix so a leak is recognisable on sight; all 52 non-test `mapApiError` call sites use a registered scope; no ad-hoc code ladder produces user-facing copy.
- **Evidence:** `packages/client/src/api/client.ts:36` (prefix convention), `:69`, `packages/client/src/errors/apiErrorMapper.ts:129-133` (`byCode` hardening), excerpt: ``return new ApiRequestError(`[dev] ${raw}`, 0, "NETWORK");``
- **Found by:** Error Handling & Observability
- **Note:** The hardening is unusually careful for its threat model: `byCode` uses `Object.hasOwn` plus a `typeof === "string"` check because `err.code` is attacker-influenced and a naive index on `"toString"` would render a function's source into the UI; `extractExtras` builds onto `Object.create(null)` while stripping `__proto__`/`constructor`/`prototype`.

### [S-09] Zero import cycles, and the cycle detector is itself protected against silently going quiet
- **Category:** S3 (loose coupling) / S5 (dependency management hygiene)
- **Impact:** High
- **Explanation:** `import/no-cycle` on TypeScript needs two `settings` entries and **each fails silently on its own** — the rule reports nothing, indistinguishable from clean. A fixture test plants a real two-file cycle on disk and requires it to be reported.
- **Evidence:** `eslint.config.js:26-49`, `packages/client/src/__tests__/eslintImportCycleRule.test.ts`, excerpt: "Both entries are load-bearing for `import/no-cycle` on TypeScript, and each fails SILENTLY when missing — the rule reports nothing and looks like a clean bill of health (F-09)."
- **Found by:** Coupling & Dependencies
- **Note:** Independently re-measured during verification: `madge` over 330 files reports no circular dependency, and a hand-built relative-import graph (161 production modules, 454 edges) agrees. The comment records that this is not hypothetical — an earlier ad-hoc probe reported "0 cycles" purely because the plugin could not resolve extensionless relative TypeScript imports.

### [S-10] The documented layering rule holds exactly, and is mechanically checkable in one grep
- **Category:** S1 (clear modular boundaries)
- **Impact:** High
- **Explanation:** CLAUDE.md states that services never import a repository directly. Every `from "…repository"` in the server — all eight — lives in the store facade. No service, route, or helper imports a repository.
- **Evidence:** `packages/server/src/stores/sqlite-project-store.ts:26-33`, excerpt: eight `import * as <x>Repo from "../<domain>/<domain>.repository";` lines, all in this one file
- **Found by:** Structure & Boundaries, Coupling & Dependencies (agreement)
- **Note:** `project-store.types.ts:158-165` composes `ProjectStore` from eight per-domain slices, and its F-16 note records a method being *moved* between slices when its caller set grew — the boundary is maintained, not merely declared.

### [S-11] Dependency direction is stable where it counts — every hub is a sink
- **Category:** S4 (dependency direction is stable)
- **Impact:** High
- **Explanation:** The highest-fan-in modules in both packages have instability I = 0, so the invariants they encode cannot be perturbed by a change anywhere else.
- **Evidence:** `packages/client/src/strings.ts` (Ca 34, Ce 0), `packages/client/src/api/client.ts` (Ca 23, Ce 0), `packages/server/src/logger.ts` (Ca 19, Ce 0), `packages/server/src/errors/appError.ts` (Ca 17, Ce 0), excerpt: `appError.ts` has no import statement at all; `client.ts`'s only import is `import type {…}`
- **Found by:** Coupling & Dependencies
- **Note:** The two abstractions CLAUDE.md leans on hardest — the editor state machine and the two abortable primitives — are pure sinks. `server/src/errors`, `config` and `utils` import nothing. `packages/shared` imports nothing from server or client at runtime.

### [S-12] "The server committed but we cannot confirm the screen" is a first-class modeled outcome, not a boolean
- **Category:** S13 (domain modeling strength)
- **Impact:** High
- **Explanation:** Mutation outcomes are a discriminated union whose members were each derived from a real failure, and the ambiguous member carries the drift decision the seam already acted on so a consumer cannot recompute it and contradict the machine.
- **Evidence:** `packages/client/src/hooks/useEditorMutation.ts:78-101` (`MutationResult`), `:72-76` (`committedLock` required), `packages/client/src/hooks/useProjectEditor.types.ts:20` (`ReloadOutcome`), excerpt: `| { ok: false; stage: "committed_but_unreloaded"; data: T; drifted: boolean }`
- **Found by:** Structure & Boundaries
- **Note:** `flush` and `mutate` are deliberately separate members so each consumer's stage-discriminated `if` chain narrows the residual to `never`. `ReloadOutcome` replaced a boolean and its comment names the bug the boolean caused (a spurious persistent lock banner on a chapter the mutation never touched).

### [S-13] `config/paths.ts` is a genuine single owner of every persistence location, with the traversal guard at the same seam
- **Category:** S1 (clear modular boundaries)
- **Impact:** Medium
- **Explanation:** One module owns `getDataDir`, `getDbPath`, `getImagesDir`, `getBackupsDir` and `containedPath`, so "where do we write" and "prove it stays inside" cannot drift apart.
- **Evidence:** `packages/server/src/config/paths.ts`, excerpt at `:40-60`: "runRestore validates the backup *archive* ... and then writes smudge.db to disk verbatim with zero payload inspection, after which index.ts runs purgeOldTrash unconditionally on the next boot."
- **Found by:** Structure & Boundaries
- **Note:** Each helper's comment names the duplication it collapsed. `getImagesDir(dataDir?)` takes an explicit override precisely so backup, restore, purge and the reaper never read the environment.

### [S-14] `chapter-content-write.ts` owns one invariant in 25 lines and documents what it deliberately excludes
- **Category:** S2 (high cohesion)
- **Impact:** Medium
- **Explanation:** It co-locates the three writes that must move together (content bytes, `word_count`, image reference-count diff) and enumerates what it will not absorb, naming the tripwire test for each exclusion.
- **Evidence:** `packages/server/src/chapters/chapter-content-write.ts:1-50`, excerpt: "Deliberately NOT included ... `restoreSnapshot` bumps once per chapter, but `replaceInProject` bumps once per *replace* ... `search.service.test.ts` ('bumps the project's updated_at exactly once, not once per chapter') fails if that happens."
- **Found by:** Structure & Boundaries
- **Note:** It also states what it does *not* guarantee — `nextContent` and `nextDoc` are independent parameters and nothing asserts they describe the same document — and writes down the one legitimate non-user rather than leaving it to be rediscovered.

### [S-15] Per-workspace extraneous-dependency enforcement, anchored against its own false-green
- **Category:** S5 (dependency management hygiene)
- **Impact:** Medium
- **Explanation:** One rule block per workspace with `packageDir: [repo root, that workspace]`, so a package declared only in a sibling workspace still errors.
- **Evidence:** `eslint.config.js:52-98`, excerpt: `packageDir: [REPO_ROOT, resolve(REPO_ROOT, "packages", workspace)]` with "That cross-workspace precision is the point."
- **Found by:** Coupling & Dependencies
- **Note:** The comment carries its own bug history honestly — `packageDir` resolves against `process.cwd()`, so with `throwAtRead` off, any ESLint run from a non-root cwd silently found no manifest and reported nothing — and states the scope limit: the rule reports undeclared imports, never the mirror image of a declaration nothing imports.

### [S-16] Consumers depend on the narrowest shape the language allows
- **Category:** S3 (loose coupling)
- **Impact:** Medium
- **Explanation:** Three distinct narrowing idioms applied consistently: `Pick` against a large hook return, `Pick` against a 60-method facade, and child-prop-type indexing so a child's signature change is a compile error at the parent.
- **Evidence:** `packages/client/src/hooks/useEditorMutation.ts:105-108`, `packages/server/src/chapters/chapter-content-write.ts:70`, excerpt: `projectEditor: Pick<UseProjectEditorReturn, "cancelPendingSaves" | "reloadActiveChapter" | "getActiveChapter">`
- **Found by:** Coupling & Dependencies
- **Note:** F-08 is precisely where this instinct was applied but could not carry the contract — the same `Pick` idiom is used for the transaction seam, and it cannot express transaction scope because the discriminating field is `private`.

### [S-17] Duplication that must not be unified is pinned by executable parity checks
- **Category:** S5 (dependency management hygiene) / S11 (testability & coverage)
- **Impact:** Medium
- **Explanation:** Where an accepted trade-off forbids a shared module, the repo substitutes a machine check rather than a comment: a test reads all three source files, extracts the regex literals textually, and runs one corpus through them.
- **Evidence:** `packages/shared/src/__tests__/image-src-allowlist-parity.test.ts:38-40`, plus `upload-cap-label-parity.test.ts` and `vite-config-default-port.test.ts`, excerpt: "ALLOWED_URI_REGEXP literal not found (or found more than once) in sanitizer.ts — was it renamed, or is it no longer a plain regex literal? Update this test."
- **Found by:** Coupling & Dependencies, Security & Code Quality (agreement)
- **Note:** The third column was added after a `?query` suffix was accepted by the allowlist, missed by the scanner, and then silently deleted from the export by the unresolved-image catch-all. See F-20 for the residual this technique creates.

### [S-18] Both init-order seams fail loudly and symmetrically
- **Category:** S4 (dependency direction is stable)
- **Impact:** Medium
- **Explanation:** The service-locator's temporal contract is enforced at runtime in both directions — get-before-init and init-twice both throw, on both the DB handle and the store.
- **Evidence:** `packages/server/src/db/connection.ts:41-77` (`initDb`), `packages/server/src/stores/project-store.injectable.ts:30-35` (`initProjectStore`), excerpt: "SqliteProjectStore captures the handle in its constructor, so a second initDb() with no intervening resetProjectStore() left getProjectStore() returning a store over a destroyed connection, with nothing failing at the seam."
- **Found by:** Coupling & Dependencies
- **Note:** `initDb` builds into a local and publishes only on success, so a rejected PRAGMA or migration cannot strand a half-built handle. The residual is test-only: `setDb()` replaces the handle without touching the store, so the test helper pairs the two calls by hand.

### [S-19] The uniform 204-no-body contract is real across all seven sites
- **Category:** S6 (consistent API contracts)
- **Impact:** Medium
- **Explanation:** Five DELETEs plus the two body-less non-DELETE mutations all return 204 with no body, and the property this buys is load-bearing rather than cosmetic.
- **Evidence:** `chapters.routes.ts:69`, `projects.routes.ts:91` and `:126`, `images.routes.ts:173`, `settings.routes.ts:32`, `snapshots.routes.ts:122`, `outtakes.routes.ts:87`; consumed at `packages/client/src/api/client.ts:201`, excerpt: `if (res.status === 204) return undefined as T;`
- **Found by:** Integration & Data
- **Note:** Because a 204 carries no body, `apiFetch` short-circuits before the body read, so the 2xx-`BAD_JSON` "possibly committed" path structurally cannot fire on a successful delete. The documented exception (a blocked image delete is a 409 carrying the referencing-chapter list) is at `images.routes.ts:166`.

### [S-20] Two parity nets guard contracts a type system alone would miss
- **Category:** S6 (consistent API contracts)
- **Impact:** Medium
- **Explanation:** One test asserts each server row type still satisfies the shared wire type after the documented narrowing **and** asserts the raw rows do *not*, so the intentional persistence-boundary widening cannot silently disappear either. A second pins the status enum against seeded migration rows.
- **Evidence:** `packages/server/src/__tests__/wire-type-parity.test.ts:39-63`, `packages/server/src/__tests__/schema-parity.test.ts`, excerpt: `it("the narrowing is the ONLY divergence — the raw rows do not satisfy the wire types", ... expectTypeOf<ProjectRow>().not.toExtend<Project>(); )`
- **Found by:** Integration & Data
- **Note:** The status column carries neither a CHECK nor an FK, so the schema-parity test is the only thing standing between a migration edit and a 400 the client's types say is impossible. Its acknowledged holes are F-30.

### [S-21] Reads degrade instead of returning 500, and the one irreversible path fails closed
- **Category:** S12 (resilience patterns)
- **Impact:** Medium
- **Explanation:** Three read paths substitute a safe value and flag it rather than failing; the single place where a read failure would cause an irreversible write refuses instead.
- **Evidence:** `packages/server/src/outtakes/outtakes.repository.ts:66-67` (`content_corrupt`), `packages/server/src/snapshots/snapshots.service.ts:208-244` (`dropped_image_count`), `packages/server/src/images/images.service.ts:212-226`, excerpt: "OOSI2: an UNREADABLE chapter blocks the delete rather than counting as a non-reference ... failing open here converts a recoverable chapter into a permanently broken image."
- **Found by:** Integration & Data
- **Note:** The failure *direction* is chosen consciously at each site and the reasoning is recorded there, which is what distinguishes this from incidental leniency.

### [S-22] Snapshot creation is idempotent by content hash, and says so on the wire
- **Category:** S12 (resilience patterns)
- **Impact:** Medium
- **Explanation:** The chapter read, the content-hash dedup check and the insert are one transaction, so a repeat POST for unchanged content returns `200 { status: "duplicate" }` rather than minting a second row.
- **Evidence:** `packages/server/src/snapshots/snapshots.service.ts:38-72` (`createSnapshot`), excerpt: `if (!isAuto) { const contentHash = canonicalContentHash(content); const latestHash = await txStore.getLatestSnapshotContentHash(chapterId); if (latestHash === contentHash) return "duplicate"; }`
- **Found by:** Integration & Data
- **Note:** The route's comment works through the three rejected alternatives and names where the type-level guarantee ends (a non-TypeScript consumer gets none of it). This is the exact shape the chapter-restore endpoint lacks — see F-27.

### [S-23] Every async route handler is wrapped, closing the Express 4 unhandled-rejection crash
- **Category:** S7 (robust error handling)
- **Impact:** Medium
- **Explanation:** All 35 async handlers across the ten routers are wrapped; the one that looks like a gap is wrapped at its definition instead.
- **Evidence:** `packages/server/src/asyncHandler.ts:10`, `packages/server/src/velocity/velocity.routes.ts:5`, `packages/server/src/app.ts:78-79`, excerpt: "Express 4 does not await handlers, so an async arrow here rejects unhandled and Node 22 terminates the process — every mistyped URL would crash the server."
- **Found by:** Error Handling & Observability
- **Note:** That comment sits at the exact line where someone would fall into the trap, on the `/api` catch-all that must stay synchronous.

### [S-24] Request correlation is assigned before body parsing, sanitised inbound, echoed outbound, and bound as a child logger
- **Category:** S8 (observability present)
- **Impact:** Medium
- **Explanation:** The middleware mounts before `express.json()` so even a malformed-JSON 400 is traceable, and an inbound `X-Request-Id` is honoured only if it matches a bounded, control-character-free pattern.
- **Evidence:** `packages/server/src/requestContext.ts:38-56`, mounted at `packages/server/src/app.ts:38`, excerpt: "a non-empty inbound id that fails the pattern is rejected silently by default — misconfigured upstreams ... lose correlation invisibly. Emit a debug-level diagnostic so LOG_LEVEL=debug surfaces the discard with the raw value."
- **Found by:** Error Handling & Observability
- **Note:** The pattern bound means a hostile proxy cannot inject newlines into log lines. `globalErrorHandler` prefers `req.log` with a documented fallback for errors thrown before the middleware runs.

### [S-25] Best-effort side effects log rather than swallow, and the narrowing is per-errno rather than blanket
- **Category:** S7 (robust error handling)
- **Impact:** Medium
- **Explanation:** There are no empty catch blocks in server production source. Where a failure *is* swallowed it is narrowed to a specific errno with the reason recorded, and the sharpest case fails the whole operation loudly.
- **Evidence:** `packages/server/src/images/images.reaper.ts:52-54`, `packages/server/src/backup/backup-core.ts:129-135` (`walkFiles`), `:441-446` (`rotateAutoBackups`), excerpt: "S4: only swallow ENOENT (legitimate fresh install ...). Any other code (EACCES, EIO, ENOTDIR, …) is an operator-actionable signal"
- **Found by:** Error Handling & Observability
- **Note:** In the backup case, anything other than ENOENT re-throws and fails the backup, because a permission error would otherwise silently omit real images from an archive reported as successful. `fireDailySnapshot`'s doc enumerates all five of its call sites and states "Never throws" with the reason — though see F-21 for a false claim inside that same block.

### [S-26] Every environment variable is documented, and the forcing test states what it cannot see
- **Category:** S9 (configuration discipline)
- **Impact:** Medium
- **Explanation:** A bidirectional test fails when a `process.env` read has no documentation row and when a row has no reader; the doc states per variable whether it fails fast or degrades quietly.
- **Evidence:** `docs/configuration.md`, `scripts/__tests__/configuration-doc.test.mjs`, excerpt: "An unrecognised value prints a warning and falls back to `info` rather than failing — so a typo here degrades quietly, and the warning on stderr is your only signal. **This is the knob to reach for when diagnosing a live problem.**"
- **Found by:** Error Handling & Observability
- **Note:** The most valuable property is that the test documents its own blind spots (destructured reads, computed reads, deployment tooling) and closes with "Do not read a green run as 'every environment variable is documented.'" A forcing test that overstates its guarantee is how the guarantee gets deleted. Pair with F-14, which is the same discipline absent on the client side.

### [S-27] Cross-package constants that must agree are either shared or parity-tested, including the derived user-facing label
- **Category:** S9 (configuration discipline)
- **Impact:** Medium
- **Explanation:** The upload cap is one shared constant imported by all three enforcement points, and the human-readable label is *derived* from it rather than restated.
- **Evidence:** `packages/shared/src/constants.ts:41` (`MAX_IMAGE_UPLOAD_BYTES`), `:57` (`MAX_IMAGE_UPLOAD_LABEL`), excerpt: ``export const MAX_IMAGE_UPLOAD_LABEL = `${MAX_IMAGE_UPLOAD_BYTES / 1024 / 1024} MB`;``
- **Found by:** Error Handling & Observability
- **Note:** Deriving the label is the part usually missed — converting the checks while leaving three messages saying "10 MB" as literals would have reproduced the divergence one layer up. Where sharing is genuinely impossible (Vite's config cannot resolve the shared package's extensionless re-exports under bare Node ESM), the literal is mirrored with the module-resolution error recorded and a parity test holding the two together.

### [S-28] Prototype pollution is closed at each site with the concrete failure it prevents recorded
- **Category:** S10 (security built-in)
- **Impact:** Medium
- **Explanation:** Three independent sites use null-prototype accumulators and `Object.hasOwn` lookups, each documenting the specific silent failure that motivated it rather than citing a general rule.
- **Evidence:** `packages/server/src/settings/settings.service.ts:25-35`, `packages/server/src/snapshots/content-hash.ts:22-30`, `packages/shared/src/tiptap-safety.ts:104-113`, excerpt: "`errors[\"__proto__\"] = msg` on a plain object literal is a SILENT no-op — the rejection would vanish and the request would fall through to the upsert below with 204 (OOSS1)"
- **Found by:** Security & Code Quality
- **Note:** No unguarded dynamic-key assignment or deep merge exists anywhere in `packages/server/src` or `packages/shared/src`.

### [S-29] Measured coverage on the security-relevant server modules is 94–100%, with a narrow, individually justified exclusion list
- **Category:** S11 (testability & coverage)
- **Impact:** Medium
- **Explanation:** Statement coverage on the eight modules that carry the traversal, upload, export and search surfaces sits at or near the enforced thresholds, and the coverage exclusions are thin IO shells whose testable logic was extracted into siblings that stay measured.
- **Evidence:** `coverage/coverage-final.json` (generated 2026-08-22 15:47, verified newer than every source file it describes), `vitest.config.ts:43-48`, excerpt: `backup-zip-format.ts` 97.5%, `images.service.ts` 97.5%, `image-resolver.ts` 97.6%, `images.references.ts` 96.4%, `search.service.ts` 96.6%, `docx.renderer.ts` 94.3%, `images.reaper.ts` 95.7%, `config/paths.ts` 91.3%
- **Found by:** Security & Code Quality
- **Note:** Recomputed independently during verification and matching to the decimal. The two modules below the 95% statement threshold are exactly the two that F-06 and F-37 describe, which is coherent rather than contradictory.

---

## Flaws/Risks

### [F-01] `GET /api/projects/{slug}/trash` resolves a slug to a soft-deleted project, hiding the live project's own trashed chapters
- **Category:** 17 (no clear ownership of data), secondarily 24 (inconsistent API contracts)
- **Impact:** High
- **Explanation:** The trash endpoint is the only one that resolves a project through `findProjectBySlugIncludingDeleted`, which is an unordered `.first()` over a column that is unique only among live rows — so when a soft-deleted project and a live project share a slug, the trash view addresses the deleted one while every sibling endpoint addresses the live one.
- **Evidence:** `packages/server/src/projects/projects.service.ts:320-326` (`getTrash`), `packages/server/src/projects/projects.repository.ts:39-44` (`findBySlugIncludingDeleted`), `:122-143` (`resolveUniqueSlug`), `:46-56` (`findByTitle`), `packages/server/src/db/migrations/002_add_project_slugs.js:60-68`, excerpt: `export async function findBySlugIncludingDeleted(trx, slug) { return (await trx("projects").where({ slug }).first()) ?? null; }`
- **Found by:** Integration & Data
- **Status:** Fixed
- **Status reason:** `getTrash` now resolves the LIVE project only, via `findProjectBySlug`. Because `getTrash` was its sole caller, the unfiltered `findBySlugIncludingDeleted` was removed from the repository, the `ProjectStore` slice interface, the `SqliteProjectStore` delegation and the method-surface guard — so the ambiguous lookup no longer exists for a future caller to rediscover. The sibling `findProjectByIdIncludingDeleted` / `updateProjectIncludingDeleted` stay: `restoreChapter`'s parent-restore branch genuinely needs them. Behaviour change: a soft-deleted project's slug now yields 404 on `/trash`, which is unreachable from the client — the trash view is only reachable for a project already loaded through the live-only `GET /api/projects/:slug`. Reproduced red first: the pre-fix endpoint returned the *soft-deleted* project's chapter id rather than the live project's own.
- **Status date:** 2026-08-22 15:29 UTC
- **Status commit:** e51b36f4
- **Note:** Every link was confirmed independently during verification. Migration 002 creates the uniqueness index `WHERE deleted_at IS NULL` and its own comment says "This allows reuse of slugs after soft-deleting a project." `createProject`'s duplicate-title guard filters `whereNull("deleted_at")`, so a trashed project's title is reusable; `resolveUniqueSlug`'s collision probe does the same at both of its queries, so its slug is reclaimable. The resolution was reproduced in memory against better-sqlite3 with the real index: both rows insert, and the lookup returns the **soft-deleted** row, because a partial index cannot serve a query that does not constrain `deleted_at`, so SQLite table-scans in rowid order and the older row wins. The reachable sequence is ordinary UI use — trash a project, then create a new one with the same title. The consequence the original finding named (the trash view lists another project's chapters) is real but secondary; the sharper one is that the live project's **own** trashed chapters become unreachable through the UI for the whole 30-day recovery window, after which `purgeOldTrash` hard-deletes them. Restoring from the wrongly-listed set also un-deletes the other project, via `restoreChapter`'s parent-restore branch. No end-to-end integration test was written; the chain is confirmed link by link against the executing code path.

### [F-02] The server binds every network interface, with no authentication, no `Host` check and no `Origin` check
- **Category:** 30 (security as an afterthought)
- **Impact:** High
- **Explanation:** `app.listen` is called with a port and a callback and no host, so Node binds the unspecified address; combined with the deliberate absence of auth, any host that can reach the port has full read/write/delete on the manuscript, and any page the writer visits can reach it via DNS rebinding.
- **Evidence:** `packages/server/src/index.ts:53` (`main`), excerpt: `const server = app.listen(PORT, () => { logger.info({ port: PORT }, "Smudge server running"); });`
- **Found by:** Security & Code Quality
- **Status:** Fixed
- **Status reason:** Both halves closed. (1) `index.ts` binds the host returned by `getBindHost()` in the new `packages/server/src/config/loopback.ts`, which is `127.0.0.1`. No environment variable is read — Phase 7g.1 owns `SMUDGE_BIND_ADDRESS`, and its planned `0.0.0.0` default is the state this finding exists to remove, so the unsafe value is not reachable by configuration until that phase revisits it deliberately (7g.1 amended in the same commit). The wrapper exists so the value is decidable in a unit test and so 7g.1 has one seam. (2) `createApp()` rejects any request whose `Host` is not a loopback name, with 400 + `INVALID_HOST` (403 is not on the error-status allowlist; a new condition takes an existing status plus a discriminating code). **No `Origin` check was added, deliberately**: in a DNS-rebinding attack the page is same-origin with the target from the browser's point of view, so a GET carries no `Origin` header at all and only `Host` names the attacker's domain — an `Origin` allowlist would inspect a header the attack does not send, while needing four-plus entries covering dev/production/e2e in both `localhost` and `127.0.0.1` spellings. Authentication remains absent and is out of scope: it is a feature, which the fix-session PR-scope rule excludes. Verified against the real transport — `make e2e` 58/58, unchanged from baseline, because Vite proxies `/api` with `changeOrigin: true` so the server sees the proxy target's host.
- **Status date:** 2026-08-22 15:39 UTC
- **Status commit:** 442acde2
- **Note:** The `listen` signature was read directly rather than inferred from the `Makefile` comment that also states it. A grep for `Host` / `Origin` / CORS handling across `packages/server/src` excluding tests returns zero production hits. Helmet's CSP does not address this — CSP constrains what the Smudge page may load, not who may call `/api/*`, and `frameAncestors: 'none'` blocks framing rather than rebinding. `docs/deferred-issues.md:62-64` describes this issue and is now half-stale: the four missing headers it names have all since landed via helmet, while the two items that matter for this exposure (CORS/`Origin` restriction, and "Consider `Host` header validation to defend against DNS rebinding") were never implemented and the entry was never updated. `docs/configuration.md` documents `SMUDGE_PORT` with no bind-host row; `docs/roadmap.md:79` lists configurable bind/port/data-dir as Planned under Phase 7g. Notably the *dev* tooling is protected — Vite's server defaults to loopback and ships its own `allowedHosts` rebinding protection — while the API holding the manuscript is not.

### [F-03] No request deadline anywhere in the client, including the save pipeline
- **Category:** 16 (synchronous-only integration — the applicable residue for a monolith)
- **Impact:** Medium
- **Explanation:** `apiFetch` and the two raw-`fetch` transports pass a caller-supplied `AbortSignal` for cancellation but never compose in a timeout, so a connection that is accepted and never answered produces no rejection and the save retry ladder — which is reached entirely through `catch` — never starts.
- **Evidence:** `packages/client/src/api/client.ts:150-162` (`apiFetch`), `:336`, `:444`, excerpt: ``const res = await fetch(`${BASE}${path}`, { headers: { "Content-Type": "application/json" }, ...options })`` — the caller's signal rides in `options`; `AbortSignal.timeout` appears nowhere in `packages/client/src`
- **Found by:** Integration & Data
- **Note:** The user-visible failure is silent: `saveStatus` stays `"saving"` indefinitely, the three-attempt backoff never runs, and the "Unable to save" banner — the whole point of the ladder — never appears, while the writer keeps typing. The realistic trigger is a half-open socket (laptop sleep/resume, a reverse proxy holding the connection), not a slow query; browser and OS TCP timeouts eventually fire on the order of minutes. Bounded in practice, unbounded in the code, on the path CLAUDE.md calls the core trust promise.

### [F-04] A rejected auto-save produces zero server log output at any level, on exactly the path where the client discards the draft cache
- **Category:** 20 (weak error handling strategy)
- **Impact:** Medium
- **Explanation:** `globalErrorHandler` returns early for every `AppError` and logs only at status ≥ 500, so a 400 `VALIDATION_ERROR` from the chapter PATCH emits nothing; the access log carries a status and nothing else. Meanwhile the client clears the cached draft on exactly that code.
- **Evidence:** `packages/server/src/app.ts:102-123` (`globalErrorHandler`), `packages/server/src/requestContext.ts:52-54`, `packages/client/src/hooks/useProjectEditor.ts:608-613`, excerpt: `if (terminalSaveError && terminalSaveError.code === "VALIDATION_ERROR" && !token.isStale()) { clearCachedContent(savingChapterId);`
- **Found by:** Error Handling & Observability
- **Note:** Even at `LOG_LEVEL=trace` there is no code, no message and no chapter id for the rejection. The 4xx-is-quiet rule is well reasoned for a 404 on a deleted row — those are expected outcomes, not faults — but a schema rejection of a writer's manuscript content is not that class of event, and it is the one place where the server refuses content and the client then discards the only local copy of it.

### [F-05] Error-code identifiers are shared constants for three domains and bare duplicated literals for the rest
- **Category:** 24 (inconsistent API contracts) / 28 (magic numbers and strings)
- **Impact:** Medium
- **Explanation:** Snapshots, outtakes and search publish their codes as shared constants consumed symbolically on both sides; chapters, projects and images type theirs independently as string literals on the server and again on the client, where nothing links the two.
- **Evidence:** shared at `packages/shared/src/constants.ts:64,84,100`; duplicated at `packages/server/src/chapters/chapters.routes.ts:43,99`, `packages/server/src/projects/projects.routes.ts:68,88`, `packages/server/src/images/images.routes.ts:144,166` against `packages/client/src/errors/scopes.ts:77,136,210,227,243,252,272,285,360,470`, excerpt: `const CHAPTER_PATCH_COMMITTED_CODES = ["UPDATE_READ_FAILURE"];` against `"UPDATE_READ_FAILURE",`
- **Found by:** Integration & Data, Error Handling & Observability (agreement)
- **Note:** The consequence is asymmetric and silent. Renaming a code server-side turns the server suite red, which forces the server literal to be updated; the client's `byCode` and `committedCodes` entries then stop matching with no compile error, and the user drops to generic fallback copy. `committedCodes: ["UPDATE_READ_FAILURE"]` is what drives the possibly-committed editor lock on the save path, so the failure mode is that the committed-write protection quietly stops firing. The mechanism to prevent exactly this — cross-package parity tests — already exists in `packages/shared/src/__tests__/` and was not applied to the error-code surface.

### [F-06] Five security-refusal branches in the untrusted-ZIP parser never execute in the test suite
- **Category:** 32 (missing or inadequate test coverage for critical paths)
- **Impact:** Medium
- **Explanation:** The module exists so that production restore and the security tests share one copy of the byte-offset arithmetic, but five of its rejection branches — including the containment check its own comment calls the real backstop — have an execution count of zero.
- **Evidence:** `packages/server/src/backup/backup-zip-format.ts:58,62,64,72,132`, excerpt at `:132`: ``if (dest !== root && !dest.startsWith(root + sep)) { throw new ZipSlipError(`entry escapes target dir: ${JSON.stringify(p)}`); }`` against `:122-124`: "S3: no blanket whitespace reject … The `resolve()` containment check below is the real backstop"
- **Found by:** Security & Code Quality
- **Note:** Coverage freshness was verified rather than assumed — `coverage/coverage-final.json` (2026-08-22 15:47) postdates the source file (2026-08-18), and the zero counts were re-extracted independently. The three path checks that *precede* the backstop (null byte, absolute path, `..` segment) are tested; the one they defer to is not. The zip64 gap is deliberate in the tests and untested in its own right — `backup-core.test.ts:325-326` records choosing `0xFFFFFFFE` specifically to avoid the zip64 early-exit. This matters because `runRestore` writes `smudge.db` to disk verbatim with zero payload inspection, and `config/paths.ts:44-50` builds its entire threat model on that fact.

### [F-07] The post-commit ordering contract for the velocity side effect is enforced only by a doc comment
- **Category:** 27 (temporal coupling)
- **Impact:** Medium
- **Explanation:** `fireDailySnapshot` must run after its caller's transaction commits, because it reaches the non-scoped store and would starve the single-connection pool; nothing but prose constrains a new caller.
- **Evidence:** `packages/server/src/velocity/velocity.side-effects.ts:72` (`fireDailySnapshot`); call sites `chapters.service.ts:129,182,356`, `snapshots.service.ts:331`, `search.service.ts:381`, excerpt: doc block — "Must be called AFTER the transaction commits, never inside it."
- **Found by:** Coupling & Dependencies
- **Note:** All five current call sites were read and each does sit after its transaction returns. A sixth placed inside one would starve the pool for the full 60-second acquire timeout, and `fireDailySnapshot`'s own catch would then swallow the timeout — the endpoint returns 2xx after a minute-long hang with a log line as the only trace. Shares a root cause with F-08 but is separate code, separate call sites and a separate fix.

### [F-08] Transaction scope is a parameter name, not a type
- **Category:** 27 (temporal coupling)
- **Impact:** Medium
- **Explanation:** Four helpers require a transaction-scoped store and say so by naming the parameter `txStore`, but the discriminating field is `private`, so it never participates in structural assignability and the root store satisfies the parameter type exactly as well as a scoped one.
- **Evidence:** `packages/server/src/chapters/chapter-content-write.ts:70`, `packages/server/src/snapshots/auto-snapshot.ts:37`, `packages/server/src/stores/sqlite-project-store.ts:36`, excerpt: `export class SqliteProjectStore implements ProjectStore { private readonly isTransactionScoped: boolean;` against `txStore: Pick<ProjectStore, "updateChapter" | "incrementImageReferenceCount" | "findImagesByIds">`
- **Found by:** Coupling & Dependencies
- **Note:** Two failure modes: the root store passed from *inside* a transaction queues behind the caller's own connection until the 60-second acquire timeout; passed from *outside* one, the writes autocommit separately and a failure between them leaves content updated and the image reference count stale. The blast radius is bounded and the codebase already says so — `chapter-content-write.ts` records that a stale reference count is not a data-loss path, because the reaper deletes only files with no DB row and the delete gate scans chapter content live. The residual was recognised and closed with prose (commit `f93fa80f`, "warn that writeChapterContent's txStore is unenforced") rather than with a type, and it is not among the accepted trade-offs in CLAUDE.md.

### [F-09] The knex `{min: 1, max: 1}` pool is load-bearing at seven correctness arguments, comes from a third-party default under a caret range, and is asserted by no test
- **Category:** 4 (high/unstable dependencies)
- **Impact:** Medium
- **Explanation:** Smudge's own knex config sets neither `pool` nor `acquireConnectionTimeout`, yet the single-connection property is cited as the *reason* a correctness argument holds at seven production sites.
- **Evidence:** `packages/server/src/db/knexfile.ts:8-20` (`createKnexConfig`); cited at `auto-snapshot.ts:30`, `snapshots.service.ts:84`, `images.repository.ts:15`, `images.service.ts:131`, `chapters.service.ts:273`, `chapter-content-write.ts:62`, `projects.service.ts:243`, excerpt: the config is `{ client: "better-sqlite3", connection: { filename: dbPath ?? getDbPath() }, useNullAsDefault: true, migrations: {...} }`
- **Found by:** Coupling & Dependencies
- **Note:** The effective values were measured read-only during verification (instantiating knex with this exact client yields `pool.min 1`, `pool.max 1`, `acquireTimeoutMillis 60000`) rather than by mutating the config. The `min: 1` half is separately load-bearing and mentioned nowhere: `initDb` issues `PRAGMA journal_mode = WAL`, `foreign_keys = ON` and `busy_timeout` on the single pooled connection, and those are per-connection session settings that survive only because the pool never reaps below `min`. A knex minor that changes its dialect defaults would silently invalidate seven documented safety arguments and could hand out a connection with foreign keys off.

### [F-10] The two newest content-mutating service entry points carry no doc comment, which is the mitigation F-19 was accepted on
- **Category:** 12 (hidden side effects)
- **Impact:** Medium
- **Explanation:** CLAUDE.md accepts hidden side effects in chapter mutations **on the condition** that each is enumerated in the function's doc comment, and states that new mutations with non-obvious side effects must keep it. Two mutations added since do not.
- **Evidence:** `packages/server/src/snapshots/snapshots.service.ts:143` (`restoreSnapshot`), `packages/server/src/search/search.service.ts:209` (`replaceInProject`), excerpt: in `snapshots.service.ts` the preceding `/** */` block binds to `export interface RestoreSuccess {` at `:138`, leaving `export async function restoreSnapshot(` at `:143` with nothing attached; in `search.service.ts`, `searchProjectBySlug`'s JSDoc closes at `:198` and `replaceInProject` begins at `:209` with no comment
- **Found by:** Error Handling & Observability
- **Note:** Both halves were verified. The three originally-named functions **do** still comply — `updateChapter`, `deleteChapter` and `restoreChapter` each carry an intact side-effect enumeration abutting the declaration — so the premise holds where it was written. It does not hold for the two newer mutations, which both fire the same `fireDailySnapshot` side effect the trade-off names, plus (for `restoreSnapshot`) a pre-restore auto-snapshot write, an image reference-count diff, a project timestamp bump, and the silent dropping of references to images that no longer exist.

### [F-11] Two startup jobs bypass the repository layer and open a second transaction owner
- **Category:** 6 (leaky abstractions) / 3 (tight coupling)
- **Impact:** Medium
- **Explanation:** CLAUDE.md states that repositories encapsulate all SQL and that the store facade hosts the transaction boundary. The purge job writes raw Knex query-builder calls against three domains' tables and opens its own transaction alongside the store seam; the image reaper reads a table directly.
- **Evidence:** `packages/server/src/db/purge.ts:14-48` (`purgeOldTrash`), `packages/server/src/images/images.reaper.ts:57` (`reapOrphanImages`), excerpt: `const { chapters, projects, images, purgedProjectIds } = await db.transaction(async (trx) => { ... await trx("chapters").where("deleted_at", "<", cutoff).delete();` and `const rows = await db("images").select("id");`
- **Found by:** Coupling & Dependencies
- **Note:** These are the only two non-repository production files touching the Knex query builder — re-grepped during verification. The consequence is that the soft-delete filter rule and the cascade assumptions now live in two places, and the single-owner transaction seam that the accepted F-4 trade-off calls "genuinely load-bearing" has an undocumented second owner. Both jobs receive the bare Knex handle from `index.ts` before or around store initialization.

### [F-12] The server's declared production entrypoint cannot be executed
- **Category:** 4 (high/unstable dependencies) / 6 (leaky abstractions)
- **Impact:** Medium
- **Explanation:** `moduleResolution: "bundler"` makes TypeScript emit relative import specifiers without file extensions, which Node's ESM loader rejects in a `"type": "module"` package — so the `start` script's `node dist/index.js` fails immediately.
- **Evidence:** `packages/server/package.json` (`"start": "node dist/index.js"`), `tsconfig.base.json:5`, `packages/shared/package.json` (`"main": "./src/index.ts"`), `Makefile:81-82`, excerpt (run during verification): `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/ovid/projects/smudge/packages/server/dist/db/connection' imported from .../dist/index.js`
- **Found by:** Coupling & Dependencies
- **Note:** The staleness question was checked explicitly: `dist/index.js` is dated 2026-08-21, newer than its source, so this artifact is current rather than left over. More importantly the failure is structural — extensionless relative specifiers are what these compiler settings emit for *any* build, so a fresh build fails identically. A fresh build was not run, because that would write to the repository; that conclusion rests on reading the emitted specifiers plus the two configuration settings. Behind the first failure sits a second: the shared package's `main` points at raw TypeScript, binding every consumer to a TypeScript-aware runtime. This is invisible today because development runs through `tsx`, `make build` builds only the client, and there is no `Dockerfile` — it becomes blocking on the day the documented single-container deployment is attempted.

### [F-13] Mutable, reclaimable slugs address five destructive write routes; the steering file records only the read consequence
- **Category:** 17 (no clear ownership of data)
- **Impact:** Medium
- **Explanation:** CLAUDE.md documents that renaming a project releases its slug and that the hazard is reachable through a bookmark, a history entry or a shared link — then states the consequence purely as a read that opens a different project.
- **Evidence:** `packages/server/src/projects/projects.routes.ts:31` (PATCH), `:58` (POST chapters), `:75` (PUT order), `:117` (DELETE), `packages/server/src/search/search.routes.ts:88` (POST replace), `packages/server/src/projects/projects.repository.ts:122-143` (`resolveUniqueSlug`), excerpt: CLAUDE.md — "an old `/projects/my-novel` URL then opens a _different_ project, silently, with no 404."
- **Found by:** Integration & Data
- **Note:** This is not a re-opening of the accepted F-24 route-shape split; it is a gap in that trade-off's *recorded impact*. The same reachability applies unchanged to project rename, whole-project soft delete, chapter creation, chapter reordering and manuscript-wide find-and-replace. A stale second tab left open across a rename, then resubmitted, trashes or rewrites a different manuscript with no error. The writes are recoverable — trash retains 30 days, replace leaves auto-snapshots — but they land on the wrong manuscript silently, and a reader of the steering file would not know to look for it.

### [F-14] The client emits no diagnostic output in a production build and has no knob to enable any
- **Category:** 21 (no observability plan)
- **Impact:** Medium
- **Explanation:** `clientWarn` and `clientError` are gated on `import.meta.env.DEV`, which Vite statically resolves to `false` in a production build, so all 41 non-test call sites compile to no-ops in the artifact that is actually served.
- **Evidence:** `packages/client/src/errors/clientLog.ts:31-38`, `packages/client/src/hooks/useContentCache.ts:11,21,30`, excerpt: `export function clientWarn(...args: unknown[]): void { if (isDev()) console.warn(...args); }`
- **Found by:** Error Handling & Observability
- **Note:** The framing matters: the production no-op is deliberate and documented, so this is not "client logging is missing." It is that the client has no counterpart to the server's `LOG_LEVEL`, which `docs/configuration.md` calls the knob to reach for when diagnosing a live problem — no query parameter, no `localStorage` flag, no debug build variant exists. The concrete case is `useContentCache`'s three failure sites, which cover `localStorage` quota exhaustion on the draft cache that CLAUDE.md calls the last line of defence against data loss: the user sees a footer banner, and the operator gets no error object, no key and no exception. The decision to have no production client observability appears nowhere as a recorded decision.

### [F-15] The TipTap node-type registry is spread across five sites and the in-repo cross-reference covers three of them
- **Category:** 9 (shotgun surgery)
- **Impact:** Medium
- **Explanation:** Registering a node type in `editorExtensions.ts` requires coordinated edits in four other enumerations, each with a different silent failure mode, and the comment that names the hazard enumerates only the three that live in `shared`.
- **Evidence:** `packages/shared/src/editorExtensions.ts:21` (registration), `packages/shared/src/tiptap-plaintext.ts:14` (`BLOCK_TYPES`), `packages/shared/src/tiptap-text.ts:69` (`LEAF_BLOCKS`), `packages/client/src/sanitizer.ts:40` (`ALLOWED_TAGS`), `packages/server/src/export/docx.renderer.ts:269-364` (`blockToParagraphs`), excerpt: "S9: THREE independent encodings of \"what separates text\" live in shared, and nothing forces a joint update when a node type is registered in editorExtensions.ts"
- **Found by:** Structure & Boundaries
- **Note:** Neither `sanitizer.ts` nor `docx.renderer.ts` mentions the S9 note or any of the shared tables, and `editorExtensions.ts` — the file an author actually edits — points at none of them. The forcing test asserts the extension list and asks one question ("does this extension render into output?"), not which of the five tables need updating. The result would be a divergence rather than a uniform omission: a new block-level node renders in HTML and EPUB export while being stripped from preview and snapshot view by DOMPurify and dropped from DOCX by the switch's log-and-skip default. Live risk given the roadmap: paragraph tags (4c.3), citations (6a) and import (7e) are all plausibly node-adding.

### [F-16] `ImageGallery` holds two screens, all image server access, and eight concerns over one state bag
- **Category:** 2 (god object) / 11 (low cohesion)
- **Impact:** Medium
- **Explanation:** A single 668-line component owns 11 pieces of state, a refresh counter, five async handlers, a live-region announcer with its own timer, two in-effect network loaders, and two complete view implementations sharing one state bag.
- **Evidence:** `packages/client/src/components/ImageGallery.tsx:37-51` (11 `useState`), `:94` (`useReducer`), `:69,:78` (`useAbortableAsyncOperation`), `:118,:169` (in-effect loaders), grid view `:410-482`, detail view `:483-668`, excerpt: `:118 const controller = new AbortController(); api.images.list(projectId, controller.signal)`
- **Found by:** Structure & Boundaries
- **Note:** Every comparable flow in this client has been extracted into a hook (`useSnapshotState`, `useFindReplaceState`, `useTrashManager`, `useOuttakeCapture`); the gallery has been worked on repeatedly but only on the abort and error axis, and Phase 4b.3a.4 explicitly left its two loader effects as they are. This is *not* covered by the accepted F-1 trade-off, which is scoped to `EditorPage` and rests on cross-hook busy/lock coordination the gallery does not participate in. One correction to the original finding: the two raw `AbortController` allocations are inline in `useEffect`, not `useRef` allocations, so the ESLint rule does not reach them — they are legal, merely inconsistent with the same file's two uses of the hook. The finding rests on cohesion, not on line count.

### [F-17] `useFindReplaceState.search()` advertises a parameter it discards
- **Category:** 6 (leaky abstractions)
- **Impact:** Low
- **Explanation:** The published interface takes a project slug; the implementation ignores it and reads a ref instead, because callers capture the slug in a closure that goes stale after a rename.
- **Evidence:** `packages/client/src/hooks/useFindReplaceState.ts:41` (interface) versus `:348-362` (implementation); call sites `useFindReplaceController.ts:251,640,710`, excerpt: interface `search: (projectSlug: string) => Promise<void>;` against `async (_slug: string) => { ... const current = latestSlugRef.current; if (!current) return; await search(current); }`
- **Found by:** Coupling & Dependencies
- **Note:** The discard is deliberate and documented at the implementation. There is no user-visible failure mode — the guard is correct. The residual is a signature that advertises a parameter it must ignore, and two of the three call sites pass the exact stale closure value the ref exists to avoid, so a reader auditing them cannot tell they are safe.

### [F-18] A two-call snapshot refresh obligation is open-coded at seven sites
- **Category:** 27 (temporal coupling)
- **Impact:** Low
- **Explanation:** Every path that may have caused a server-side auto-snapshot must fire both the panel refresh and the count refresh; they are not interchangeable, because the panel handle is a no-op when the panel is closed.
- **Evidence:** `packages/client/src/hooks/useSnapshotController.ts:253+260, 301+302, 320+326, 384+385, 398+406, 433+440`, `packages/client/src/hooks/useFindReplaceController.ts:252+256`, excerpt: `snapshotPanelRef.current?.refreshSnapshots(); refreshSnapshotCount();`
- **Found by:** Coupling & Dependencies
- **Note:** The rationale is re-explained at six of the seven sites, and the pairs are already drifting apart in shape (two of them now straddle multi-line comment blocks). One piece of the original supporting evidence does not hold and was corrected: the final arm of `handleRestoreSnapshot` fires neither refresh, but that arm is a pre-mutation stage where no server call was made, so refreshing nothing there is correct. Worst case from a genuinely missed pairing is a stale badge or a stale list, both cleared by reopening the panel.

### [F-19] Backup restore depends on JSZip's internal source behaviour under a caret version range
- **Category:** 3 (tight coupling)
- **Impact:** Low
- **Explanation:** Restore parses the same archive bytes twice with two independent implementations, and reconciling their two key spaces rests on JSZip behaviour that is documented only in JSZip's source, not its public API.
- **Evidence:** `packages/server/src/backup/backup-core.ts:252-268`, `:285-295` (`runRestore`), `packages/server/package.json` (`"jszip": "^3.10.1"`), excerpt: "JSZip keys its map by each entry's LOCAL header name (zipEntry.js readLocalPart overwrites fileName; readCentralPart deliberately skips it)"
- **Found by:** Coupling & Dependencies
- **Note:** Two mitigations are real: the failure surfaces as a precondition error *before* the data-dir move-aside, so nothing is destroyed, and a test exercises the fallback key lookup. Worth contrasting with the TipTap coupling CLAUDE.md treats as load-bearing, which at least names an exact version.

### [F-20] The shared package's test suite reaches into both dependents' source trees by filesystem path
- **Category:** 4 (high/unstable dependencies — inverted dependency direction at test time)
- **Impact:** Low
- **Explanation:** The most-depended-upon package's tests hard-code six paths into its two dependents and regex-scrape their source for exact declaration syntax, an edge invisible to every static check in the repo because it travels through `readFileSync`.
- **Evidence:** `packages/shared/src/__tests__/image-src-allowlist-parity.test.ts:38-40`, plus `upload-cap-label-parity.test.ts` and `vite-config-default-port.test.ts`, excerpt: `const CLIENT_SANITIZER = resolve(HERE, "../../../client/src/sanitizer.ts");`
- **Found by:** Coupling & Dependencies
- **Note:** Reported as a qualified residual rather than a defect. The rationale is explicit and sound — this test lives in `shared` because it is the only package that may read both of the others — each scrape carries a "was it renamed? update this test" message, and unifying the regexes is forbidden by the accepted F-16 trade-off. The residual is that moving or reformatting a file in `client` or `server` turns the `shared` suite red with no static signal that the coupling exists. This is the cost side of strength S-17.

### [F-21] A load-bearing safety rationale rests on a false claim about the code
- **Category:** 6 (leaky abstractions — false stated rationale)
- **Impact:** Low
- **Explanation:** The justification for `fireDailySnapshot`'s options-object signature argues that a swapped positional argument would fail silently because no production path enables SQLite foreign keys. Two production paths do.
- **Evidence:** `packages/server/src/velocity/velocity.side-effects.ts:64-67` versus `packages/server/src/db/connection.ts:68` (`initDb`) and `:39` (`setDb`), excerpt: the comment claims "no production path issues `PRAGMA foreign_keys = ON` and SQLite defaults it off"; `connection.ts:68` is `await instance.raw("PRAGMA foreign_keys = ON");`
- **Found by:** Coupling & Dependencies
- **Note:** `connection.test.ts` additionally asserts the pragma is on after `initDb`. The design decision the comment defends — named fields rather than two adjacent same-typed positionals — remains correct; only the stated reason is wrong. It matters because the next reader will use that reason to judge a sibling case.

### [F-22] CLAUDE.md's F-16 entry says the image-URI rule is encoded twice; it is encoded four times, and the mitigation has changed
- **Category:** Steering-file drift
- **Impact:** Low
- **Explanation:** The accepted trade-off names two encodings and records the mitigation as cross-referencing comments. There are four encodings, and three of them are now held together by a machine check rather than by comments.
- **Evidence:** `CLAUDE.md` §Accepted Architectural Trade-offs F-16 versus `packages/client/src/sanitizer.ts:115` (`ALLOWED_URI_REGEXP`), `packages/server/src/images/images.references.ts:36` (`IMAGE_SRC_RE`), `packages/server/src/export/export.renderers.ts:62` (`ALLOWED_IMAGE_SRC`), `packages/server/src/images/images.paths.ts:44` (`IMAGE_SRC_REGEX`), excerpt: CLAUDE.md — "The only residual is cross-package coupling: a change to one warrants review of the other (cross-referencing comments exist at both sites)."
- **Found by:** Coupling & Dependencies
- **Note:** One correction to the original finding, added during verification: **the code has not drifted — the steering file has.** Both `sanitizer.ts:113` and `export.renderers.ts:61` explicitly say "This is NOT the F-16 pair," so the source already distinguishes the four. The drift is in both directions: the corpus grew from two to four, and the mitigation for three of the four was upgraded from comments to the parity test recorded as S-17. Only `IMAGE_SRC_RE`, deliberately outside that corpus because of its absolute-host arm, still rests on comments alone.

### [F-23] Seven of the eight store slice interfaces are never used as narrowing types
- **Category:** 7 (over-abstraction)
- **Impact:** Low
- **Explanation:** Each per-domain slice appears exactly twice — at its own declaration and in the composed interface's `extends` list. Only one narrows a real signature anywhere in the codebase.
- **Evidence:** `packages/server/src/stores/project-store.types.ts:37,52,83,90,96,108,137`, with the sole narrowing use at `packages/server/src/snapshots/auto-snapshot.ts:37`, excerpt: each is `export interface X {` plus one entry in the `extends` list at `:158-165`
- **Found by:** Coupling & Dependencies
- **Note:** This deliberately does not re-litigate the accepted F-4 trade-off, whose stated premise is a documentation claim about data-surface value and which holds. It is recorded as the concrete measurement a future reviewer would otherwise re-derive: the slices earn their keep as reading aids, not as narrowing types, and `project-store.types.ts` is the only server file with both high afferent and high efferent coupling.

### [F-24] Client access to server data has no single owner, and two domains are split between a component and a hook
- **Category:** 13 (inconsistent boundaries)
- **Impact:** Low
- **Explanation:** The API client is imported by 8 components and 10 hooks with no rule separating them, and for snapshots and outtakes the resulting split requires hand-written coordination to stay consistent.
- **Evidence:** `packages/client/src/components/SnapshotPanel.tsx:150` and `packages/client/src/hooks/useSnapshotState.ts:563` (both call `api.snapshots.list`); `packages/client/src/components/OuttakeCard.tsx:139,195` versus `OuttakesPanel.tsx:111` versus `useOuttakeCapture.ts:161`, excerpt: `OuttakeCard.tsx:95-104` — `const deleteInFlightRef = useRef(false); ... const updateInFlightRef = useRef(false); ... const inFlightLabelRef = useRef<string | null>(null);`
- **Found by:** Structure & Boundaries
- **Note:** Downgraded from the original Medium during verification: no failure mode was identified, and the one place it could bite — the panel and hook both fetching — is deliberately suppressed by a documented ref that mirrors the panel's open state. The concrete cost is that `OuttakeCard`, a leaf list item, re-implements a three-ref busy latch that its sibling hooks own elsewhere, and that a new endpoint has no rule telling the next author where its call belongs.

### [F-25] Velocity is the only project sub-resource not mounted as its own router
- **Category:** 13 (inconsistent boundaries)
- **Impact:** Low
- **Explanation:** Five routers mount on `/api/projects`; velocity instead exports a bare handler that the projects router imports and mounts, giving `projects.routes.ts` a cross-domain import no sibling router has.
- **Evidence:** `packages/server/src/velocity/velocity.routes.ts:5` (`velocityHandler`), mounted at `packages/server/src/projects/projects.routes.ts:45`, excerpt: `export const velocityHandler = asyncHandler(async (req, res) => {` mounted as `router.get("/:slug/velocity", velocityHandler);`
- **Found by:** Structure & Boundaries
- **Note:** The extraction commit records no rationale and no decision log mentions it. The practical cost is that this is the one project endpoint you cannot find from `app.ts`.

### [F-26] A doc comment in `useEditorMutation.ts` is orphaned in exactly the way the steering file's documentation rule forbids
- **Category:** 12 (hidden side effects — documentation discipline)
- **Impact:** Low
- **Explanation:** A comment block describing `MutationDirective` is followed not by that type but by a different function's own JSDoc and declaration; the type it describes sits 28 lines further down with nothing attached.
- **Evidence:** `packages/client/src/hooks/useEditorMutation.ts:35-44` (orphaned block), `:45-64` (`isDriftedFrom` JSDoc), `:66` (`isDriftedFrom`), `:72` (`MutationDirective`), excerpt: "// Discriminated union so the type system forces reloadChapterId whenever // reloadActiveChapter is true."
- **Found by:** Structure & Boundaries
- **Note:** `git log -L` shows the insertion came from the commit that added the shared drift predicate. CLAUDE.md §Documentation Discipline rule 3 forbids exactly this shape. One nuance: the orphaned block uses line comments rather than JSDoc, so no editor tooltip is lost — the damage is that `MutationDirective`'s rationale now reads as a preamble to an unrelated predicate.

### [F-27] `POST /api/chapters/{id}/restore` is not idempotent, and its idempotent branch is unreachable
- **Category:** 19 (lack of idempotency)
- **Impact:** Low
- **Explanation:** A guard outside the transaction returns 404 when the chapter is not currently deleted; the correct already-restored branch inside the transaction can only be reached by a race a single-writer process never produces.
- **Evidence:** `packages/server/src/chapters/chapters.service.ts:259-260` versus `:286-299`, excerpt: `const chapter = await store.findDeletedChapterById(id); if (!chapter) return null;` against the later `const alreadyActive = await txStore.findChapterById(id); if (alreadyActive) { return confirmRestore(...); }`
- **Found by:** Integration & Data
- **Note:** A user retrying after a dropped-but-committed restore is told the chapter is "no longer available" about an operation that succeeded. The codebase already describes this behaviour but treats it as a reason to avoid a 500 rather than as an idempotency gap. Downgraded from the original Medium: the restore did succeed, nothing is lost or corrupted, and a reload shows the true state — the misleading copy is the whole cost. Every other retry-exposed mutation is idempotent by construction, and S-22 is the contrasting shape.

### [F-28] The "liveness check and read in one transaction" rule is applied to four read paths and skipped on the five largest
- **Category:** 26 (poor transactional boundaries)
- **Impact:** Low
- **Explanation:** Three modules deliberately wrap "resolve the parent, then read its children" in one transaction, each with a recorded rationale; the identical two-step shape runs unwrapped in the app's primary load, the dashboard, the trash view, export and search.
- **Evidence:** applied at `packages/server/src/images/images.service.ts:125-138`, `outtakes.service.ts:54-62`, `snapshots.service.ts:87,98`; skipped at `projects.service.ts:108-118`, `:284-292`, `:320-326`, `export/export.service.ts:36-40`, `search/search.service.ts:126-130`, excerpt: "F-29: the liveness check and the read are ONE transaction ... Split across two round trips, a project soft-delete landing between them answered 200-with-data for a project the writer had just trashed."
- **Found by:** Integration & Data
- **Note:** For a single writer the observable outcome is a 200 carrying a stale or empty child list rather than a 404, so severity is genuinely low. The finding is the unmarked inconsistency: an invariant recorded four times as a rule is unapplied five times with nothing indicating the omission was a decision.

- **Citation drift (2026-08-22):** the `getTrash` site cited above as `projects.service.ts:320-326` moved to `:332` when F-01 was fixed in commit 81a87fd9. F-28 itself is **untouched** by that fix — `getTrash` still reads without a transaction-wrapped liveness check, it now just resolves the live project instead of an arbitrary one. The other four skipped sites are unverified against the current tree; re-derive every line number here before acting on them.

### [F-29] The backup archive is not a consistent cross-store snapshot, and the documentation reads as though it is
- **Category:** 26 (poor transactional boundaries, spanning two stores), secondarily 17
- **Impact:** Low
- **Explanation:** The database is captured at one instant and the image tree is walked afterwards, with live writes permitted throughout, so an image deleted between the two is present as a row in the archived database and absent as bytes.
- **Evidence:** `packages/server/src/backup/backup-core.ts:481-504` (`runBackup`), `docs/backup.md:79-80`, excerpt: ``db.exec(`VACUUM INTO '${staging...}'`)`` at `:484` then `for await (const file of walkFiles(imagesDir))` at `:492`; the doc says "Each archive contains a hot-consistent copy of the SQLite database (via `VACUUM INTO`) and the full `images/` tree."
- **Found by:** Integration & Data
- **Note:** The documentation sentence is true of each half and easy to read as a claim about the pair; the limit is stated nowhere. Restoring such an archive yields a manuscript whose text is intact and whose images 404. The mirror case (an upload between the two instants) is benign — an orphan file the startup reaper collects.

### [F-30] The wire-type parity net has two holes, and one endpoint's response shape exists in no shared file
- **Category:** 24 (inconsistent API contracts)
- **Impact:** Low
- **Explanation:** The parity test covers four server row types; the project-list row and the dashboard response are served on the wire and covered by neither, with the dashboard shape re-declared inline on the client.
- **Evidence:** `packages/server/src/__tests__/wire-type-parity.test.ts:39-63`; uncovered at `packages/server/src/projects/projects.types.ts:34-41` (`ProjectListRow`) and `packages/server/src/projects/projects.service.ts:26-35` (`DashboardResponse`) versus `packages/client/src/api/client.ts:298-320`, excerpt: ``apiFetch<{ chapters: Array<{...}>; status_summary: Partial<Record<ChapterStatusValue, number>>; totals: {...} }>(`/projects/${enc(slug)}/dashboard`)``
- **Found by:** Integration & Data
- **Note:** Downgraded on a correction: half of this is already a documented decision — the client states that narrowing the server's `Record<string, number>` to the status enum is a deliberate JSON-boundary asymmetry. The undocumented residual is that neither shape is in the parity net, and the consequence of drift is a wrong number on a read-only dashboard.

### [F-31] Search and replace are the only body-carrying endpoints whose request schema is not in `shared`, and their option triple is restated eight times
- **Category:** 24 (inconsistent API contracts)
- **Impact:** Low
- **Explanation:** Every other body-carrying route validates through a schema exported from the shared package; these two declare theirs locally, and the option object is then hand-restated across five service signatures, the API client and a client hook.
- **Evidence:** `packages/server/src/search/search.routes.ts:13-32`, with the shared counterpart at `packages/shared/src/tiptap-text.ts:32`, excerpt: `const SearchOptionsSchema = z.object({ case_sensitive: z.boolean().optional(), whole_word: ..., regex: ... }).strict().optional();`
- **Found by:** Integration & Data
- **Note:** There *is* an exported shared `SearchOptions`, but it carries a server-internal `deadline` field that the route's `.strict()` schema would reject — so the shared type cannot serve as the wire type as written. That is the real reason the duplication exists, and it is recorded nowhere, so a reader has to rediscover it.

### [F-32] Structured-log field naming splits between snake_case and camelCase, and the split falls on the image-orphan events
- **Category:** 34 (inconsistent error/logging conventions)
- **Impact:** Low
- **Explanation:** The dominant convention is snake_case domain keys, but five sites use camelCase — three of them inside a single file that uses both — and two logs carry no queryable domain id at all.
- **Evidence:** `packages/server/src/images/images.service.ts:222` versus `:154,258,261`; also `packages/server/src/db/purge.ts:66`, `packages/server/src/export/docx.renderer.ts:398` (against `epub.renderer.ts:99`), `packages/server/src/images/images.reaper.ts:85`, excerpt: `logger.warn({ chapter_id: ch.id, image_id: id, project_id: image.project_id }, ...)` beside `logger.warn({ err, imageId: id }, "Failed to delete image file from disk")`
- **Found by:** Error Handling & Observability
- **Note:** The link to the accepted F-2 trade-off is legitimate: that trade-off accepts the absence of request correlation *on the premise* that domain ids are the correlation key for a single-user app, and a query on `image_id` misses precisely the lines recording an orphaned blob and the reaper cleaning one up. Downgraded from the original Medium: the consequence is diagnosis friction for one operator running one process, not a failure.

### [F-33] The Zod-failure-to-400 conversion has three message shapes across two layers, and the helper written to own it is used at three of eleven sites
- **Category:** 34 (inconsistent error/logging conventions)
- **Impact:** Low
- **Explanation:** A helper exists specifically to own this conversion and stop copies drifting; eight other sites open-code it, some throwing from the route and some returning a sentinel the route later converts, and one joins all issues where the others take only the first.
- **Evidence:** `packages/server/src/badRequestFromSchema.ts:39` (used at `snapshots.routes.ts:19`, `outtakes.routes.ts:19,68`); open-coded at `settings.routes.ts:23`, `search.routes.ts:70,93`, `chapters.service.ts:68`, `projects.service.ts:59,129,260`, `export.service.ts:31`, `images.service.ts:163`, excerpt: `validationError: parsed.error.issues.map((i) => i.message).join("; ")` against the eight `parsed.error.issues[0]?.message ?? "Invalid input"` sites
- **Found by:** Error Handling & Observability
- **Note:** Downgraded from the original Low-Medium: the divergence is message shape only — none of these emit a discriminating code, so every one arrives at the client as a bare `VALIDATION_ERROR` regardless of which shape produced it.

### [F-34] The image reference-count decrement loop silently skips where the increment loop warns, under a comment claiming they are the same guard
- **Category:** 20 (weak error handling strategy)
- **Impact:** Low
- **Explanation:** The two loops apply an identical predicate with opposite observability — the add path logs a warning and continues, the remove path continues silently — while a comment asserts they are the same guard.
- **Evidence:** `packages/server/src/images/images.references.ts:193-205` versus `:208-215`, excerpt: the remove loop reads "// Decrement only if the image actually belongs to this project — same // cross-project guard as the add path." followed by a bare `continue;`
- **Found by:** Error Handling & Observability
- **Status:** Fixed
- **Status reason:** Both loops now call one `isOwned` closure that owns the predicate *and* the warning, so the comment's "same cross-project guard as the add path" claim is structural rather than asserted — a comment could only ever describe today's copy of a duplicated predicate, which is how this finding came to exist. The false comment is deleted rather than corrected. Fixed as graded: the observability asymmetry, not the ref-count inflation the original finding claimed and this report had already retracted. One pre-existing test needed strengthening — `does not decrement an image belonging to a different project (F-7)` in `projects.service.test.ts` exercises exactly this skip and began emitting the new warning into test output, violating §Testing Philosophy's zero-warning rule; it now asserts the warning rather than merely suppressing it, since the log is part of the contract that test describes.
- **Status date:** 2026-08-22 15:55 UTC
- **Status commit:** 94d05820
- **Note:** **The originally claimed consequence was wrong and is corrected here.** The finding claimed a skipped decrement leaves the reference count permanently inflated. Neither skip branch can produce that: if there is no row there is nothing to decrement, and if the image belongs to another project this code never incremented it either, since both loops apply the same predicate to the same data and `project_id` is immutable. What survives is a genuine observability asymmetry — a missing log line under a comment that is true of the predicate and false of the handling — which is the same reasoning that led a neighbouring arm in this file to be given a log.

### [F-35] The dashboard reconstructs server-owned status labels and workflow order in the component when the statuses fetch fails
- **Category:** 25 (business logic in the UI)
- **Impact:** Low
- **Explanation:** In its fallback branch the component derives each status's display label by title-casing the key and derives workflow order from object iteration order — both of which are columns of a server-owned table.
- **Evidence:** `packages/client/src/components/DashboardView.tsx:185-192`; server owner at `packages/server/src/db/migrations/003_add_chapter_status.js:10-14`, excerpt: `: Object.entries(status_summary).map(([status], i) => ({ status: status as ChapterStatusValue, sort_order: i, label: status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) }));`
- **Found by:** Error Handling & Observability
- **Note:** The title-casing reproduces all five seed labels today and stops matching the moment a label is not the title-cased underscore-split of its key. The ordering is correct today only through an undocumented four-link chain from the repository's `ORDER BY` through object insertion order and JSON serialization. Both divergences would be silent, because this branch runs only when the statuses fetch has already failed. It is also generated word-bearing UI text that `strings.ts` does not own, invisible to the string-externalization ESLint rule because it is computed rather than literal.

### [F-36] The chapter-statuses retry loop inlines its attempt cap and backoff where the sibling save retry uses a named exported schedule
- **Category:** 28 (magic numbers and strings)
- **Impact:** Low
- **Explanation:** One retry loop expresses its policy as two inline numbers; the other exports its schedule as a constant and derives the cap from it, so the cap and the schedule cannot drift apart.
- **Evidence:** `packages/client/src/pages/EditorPage.tsx:619,626,627` versus `packages/client/src/hooks/useProjectEditor.ts:34`, excerpt: `if (attempts >= 2) { ... } attempts++; ... await sleep(2000 * attempts, s);` against `export const SAVE_BACKOFF_MS = [2000, 4000, 8000] as const;`
- **Found by:** Error Handling & Observability
- **Note:** The inline form yields 2s and 4s, not the 2/4/8 shape CLAUDE.md documents for saves, and the cap is a second unnamed owner of the same policy. This is the only retry policy in the client not expressed as a named constant.

### [F-37] The orphan-blob cleanup on a genuinely failed image insert has no test; only the carve-out from it does
- **Category:** 32 (missing or inadequate test coverage for critical paths)
- **Impact:** Low
- **Explanation:** Both tests covering this catch block drive the one error that is *excluded* from cleanup; the rule the exclusion is carved out of never executes.
- **Evidence:** `packages/server/src/images/images.service.ts:114-116` (`uploadImage` catch), excerpt: `if (!(err instanceof AppError && err.code === READ_AFTER_INSERT_FAILURE)) { await deleteImageFile(filePath).catch(() => {}); }`
- **Found by:** Security & Code Quality
- **Note:** Coverage counts re-extracted from the same verified-fresh coverage file: the two statements are at zero and the branch is one-sided. The regression consequence is that deleting the condition and its call together would leave both existing tests green while every failed-insert upload stranded a blob on disk. Mitigated but not closed by the startup reaper, which is why this is Low. The unreachable-by-construction extension guard in the same function is likewise at zero.

### [F-38] The multipart upload endpoint caps file size but not field count or part count
- **Category:** 30 (security as an afterthought)
- **Impact:** Low standalone; Medium while F-02 stands
- **Explanation:** Only `fileSize` is configured, so the underlying parser's part, field and file limits stay unbounded, and the JSON body-size cap does not apply because this endpoint is not JSON.
- **Evidence:** `packages/server/src/images/images.routes.ts:15-18`, excerpt: `const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_UPLOAD_BYTES } });`
- **Found by:** Security & Code Quality
- **Status:** Fixed
- **Status reason:** `limits` now sets `files: 1` and `fields: 0` alongside `fileSize`, which is exactly what the client posts (one file part named `file`, no other fields). `parts` is deliberately NOT set: files + fields already bound every part type a multipart body can contain, and busboy's `parts` counter is off by one against the obvious reading — verified by execution, `parts: 1` rejects a *single* file part with LIMIT_PART_COUNT. A second, unrelated defect surfaced while fixing this and is fixed with it: the route mapped only LIMIT_FILE_SIZE, so every other multer cap breach reached `globalErrorHandler` carrying no status and was clamped to **500** — a client mistake recorded as a server fault. `multerLimitError` now maps size and count breaches to 413 and LIMIT_UNEXPECTED_FILE to 400, and returns null for non-cap errors so a genuine parser failure still propagates. **Amended by the 2026-08-22 18:29 code review, finding I1** (rule 6, `docs/roadmap-decisions/2026-08-19-architecture-fix-session-pr-scope.md`): keying on the `LIMIT_` prefix left the class open. Two client-error shapes carry no such code — multer's own `MISSING_FIELD_NAME` and busboy's constructor rejections, which carry no `code` at all — so both still reached `globalErrorHandler` and were clamped to 500. The helper is renamed `uploadRequestError`, returns an `AppError` unconditionally rather than null, and keys on "is this the client's fault?" rather than on a prefix. Count breaches also took a discriminating `UPLOAD_TOO_MANY_PARTS` code (finding S2) so the client stops telling the user to shrink a file whose size is irrelevant. Impact note: F-02 was fixed first (commit 3d6a5bbc), so the "Medium while F-02 stands" compounding no longer applies — this is now the Low standalone case it was graded as.
- **Status date:** 2026-08-22 15:46 UTC
- **Status commit:** 19f9c3a1
- **Note:** With those limits unset the parser accepts unlimited parts and fields, each field defaulting to a 1 MiB cap, and multer accumulates every non-file part into memory. `express.json`'s 5 MiB body cap covers every endpoint except this one, because it only parses `application/json`. On a loopback single-user deployment this is self-inflicted at worst; it compounds with F-02 into a remote memory-exhaustion path, and the compounding is the reason it is recorded at all.

---

## Coverage Checklist

### Flaw/Risk Types 1–34

| # | Type | Status | Finding |
|---|------|--------|---------|
| 1 | Global mutable state | Observed (decided) | — (accepted, CLAUDE.md §F-3; guards verified as S-18) |
| 2 | God object | Observed | F-16 |
| 3 | Tight coupling | Observed | F-11, F-19 |
| 4 | High/unstable dependencies | Observed | F-09, F-12, F-20 |
| 5 | Circular dependencies | Not observed | — (zero cycles across 330 files; see S-09) |
| 6 | Leaky abstractions | Observed | F-11, F-12, F-17, F-21 |
| 7 | Over-abstraction | Observed | F-23 |
| 8 | Premature optimization | Not observed | — |
| 9 | Shotgun surgery | Observed | F-15 |
| 10 | Feature envy / anemic domain model | Observed (decided) | — (accepted, CLAUDE.md §F-18; one new candidate dropped in verification) |
| 11 | Low cohesion | Observed | F-16 |
| 12 | Hidden side effects | Observed | F-10, F-26 |
| 13 | Inconsistent boundaries | Observed | F-24, F-25 |
| 14 | Distributed monolith | Not applicable | Monolith: one process, one SQLite file, one client |
| 15 | Chatty service calls | Not applicable | No service-to-service calls; client↔server swept for fan-out and N+1, none found |
| 16 | Synchronous-only integration | Not applicable (distributed sense) | Residue applicable to a monolith: F-03 |
| 17 | No clear ownership of data | Observed | F-01, F-13 |
| 18 | Shared database across services | Not applicable | One database, one owner; all SQL behind the store facade |
| 19 | Lack of idempotency | Observed | F-27 |
| 20 | Weak error handling strategy | Observed | F-04, F-34 |
| 21 | No observability plan | Observed | F-14 |
| 22 | Configuration sprawl | Not observed | — (see S-26, S-27) |
| 23 | Dependency injection misuse | Not observed | — (locator accepted, CLAUDE.md §F-3; init-order guards verified as S-18) |
| 24 | Inconsistent API contracts | Observed | F-05, F-30, F-31 |
| 25 | Business logic in the UI | Observed | F-35 |
| 26 | Poor transactional boundaries | Observed | F-28, F-29 |
| 27 | Temporal coupling | Observed | F-07, F-08, F-18 |
| 28 | Magic numbers/strings everywhere | Observed | F-05, F-36 |
| 29 | "Utility" dumping ground | Not observed | — (`utils/` holds one module per package, each single-purpose) |
| 30 | Security as an afterthought | Observed | F-02, F-38 |
| 31 | Dead code / unused dependencies | Not observed | — (all 30 runtime deps imported; every export traced to a consumer) |
| 32 | Missing/inadequate test coverage for critical paths | Observed | F-06, F-37 |
| 33 | Hard-coded credentials or secrets in source | Not observed | — (swept; only backup-filename fixtures match) |
| 34 | Inconsistent error/logging conventions | Observed | F-32, F-33 |

### Strength Categories S1–S14

| # | Category | Status | Finding |
|---|----------|--------|---------|
| S1 | Clear modular boundaries | Observed | S-10, S-13 |
| S2 | High cohesion | Observed | S-14 |
| S3 | Loose coupling | Observed | S-09, S-16 |
| S4 | Dependency direction is stable | Observed | S-11, S-18 |
| S5 | Dependency management hygiene | Observed | S-09, S-15, S-17 |
| S6 | Consistent API contracts | Observed | S-01, S-19, S-20 |
| S7 | Robust error handling | Observed | S-01, S-08, S-23, S-25 |
| S8 | Observability present | Observed | S-24 (server only — the client counterpart is F-14) |
| S9 | Configuration discipline | Observed | S-26, S-27 |
| S10 | Security built-in | Observed | S-02, S-03, S-04, S-05, S-28 |
| S11 | Testability & coverage | Observed | S-17, S-29 |
| S12 | Resilience patterns | Observed | S-04, S-06, S-07, S-21, S-22 |
| S13 | Domain modeling strength | Observed | S-12 |
| S14 | Simple, pragmatic abstractions | Observed | S-01 |

---

## Hotspots

1. **`packages/server/src/projects/`** — carries both of the identity defects. `findBySlugIncludingDeleted` is the single function behind F-01, and `resolveUniqueSlug`'s live-rows-only collision probe is what makes a slug reclaimable in the first place (F-01, F-13). The same directory holds three of the five unwrapped liveness-check-then-read paths (F-28) and both wire-type parity holes (F-30). This is the highest-value file cluster in the report.

2. **`packages/server/src/index.ts`, `db/knexfile.ts`, `db/purge.ts`** — the bootstrap seam, and the place where the codebase's own rules stop applying. The bind address (F-02), the undeclared load-bearing pool configuration (F-09), the two jobs that bypass the repository layer and open a second transaction owner (F-11), and the unrunnable production entrypoint (F-12) all live here. Notably, none of these are reachable from the layered request path that the rest of the architecture governs so carefully.

3. **`packages/server/src/backup/`** — a strong core and a coverage hole in the same directory. `runRestore`'s check-everything-before-destroying ordering (S-04) is among the best-reasoned code in the repository, and it sits directly on top of five refusal branches that never execute in the test suite, including the containment backstop the module itself calls authoritative (F-06). Also carries the JSZip internal coupling (F-19) and the cross-store snapshot limit (F-29).

---

## Next Questions

1. Is the trash endpoint's use of `findProjectBySlugIncludingDeleted` load-bearing for a case that the live-only lookup would break, or is including deleted projects there an artifact of the function's name rather than a requirement?

2. Is Smudge intended to be reachable from other hosts on the operator's network, or is loopback-only the assumption the no-auth design was made under — and if the latter, where is that assumption supposed to be recorded and enforced?

3. What is the intended deployment path for the server package given that its declared `start` script cannot run — is the single-container target expected to bundle rather than emit, or to change the module resolution settings, and which of the two does the roadmap assume?

4. Should the `{min: 1, max: 1}` connection-pool property that seven correctness arguments depend on be owned by Smudge's own configuration, or is depending on the dialect default an accepted trade-off that has simply not been written down?

5. Which of the recurring "applied at some sibling sites and not others" defects — shared error codes, transaction-wrapped liveness checks, the schema-to-400 helper — represent a pattern that should be completed, and which are cases where the unconverted sites are genuinely different and the difference should be documented instead?

---

## Analysis Metadata

- **Agents dispatched:** 5 specialists in parallel plus 1 verifier
  - Structure & Boundaries — module organization, responsibility distribution, domain modeling
  - Coupling & Dependencies — component connections, abstraction quality, dependency direction
  - Integration & Data — API contracts, data ownership, transactional boundaries, resilience
  - Error Handling & Observability — error strategies, logging, configuration, side effects
  - Security & Code Quality — trust boundaries, secrets, dead code, critical-path test coverage
  - Verifier — read every referenced site, dropped false positives, re-rated impact, merged duplicates
- **Scope:** 176 non-test source files (382 including tests) across `packages/shared/`, `packages/server/`, `packages/client/`, `e2e/`, `scripts/`
- **Raw findings:** 74 (40 flaws, 34 strengths)
- **Verified findings:** 67 (38 flaws, 29 strengths)
- **Filtered out:** 7 — 1 dropped, 6 merged as duplicates
- **By impact:** 14 high (2 flaws, 12 strengths), 31 medium (14 flaws, 17 strengths), 22 low (all flaws)
- **Cross-specialist agreement:** 4 findings were reported independently by two or more specialists — F-05 (two), S-01 (three), S-04 (two), S-10 (two), S-17 (two)
- **Dropped:** 1 — a feature-envy candidate against the chapter-CRUD hook split, refuted by the specialist's own counter-argument and contradicted by the type's documentation of why the shared state cannot move down
- **Dropped under the read-only rule:** none. One sub-claim would have required mutating the knex configuration to confirm directly; it was instead confirmed by instantiating knex read-only and reading the effective pool values, so F-09 rests on measured rather than inferred evidence
- **Independently re-verified during verification (not taken on the specialist's word):** the slug-resolution chain behind F-01, the `app.listen` signature behind F-02, the entrypoint failure behind F-12, the freshness of the coverage data behind F-06/F-37/S-29, the zero-cycles result behind S-09, and the single-`generateHTML`-call-site claim behind S-02
- **Steering files consulted:** `CLAUDE.md`, `docs/roadmap.md`, `docs/roadmap-decisions/`, `docs/configuration.md`, `docs/backup.md`, `docs/deferred-issues.md`, `docs/dependency-licenses.md`, `eslint.config.js`, `vitest.config.ts`, and the prior report `paad/architecture-reviews/2026-08-11-smudge-architecture-report.md` (consulted for context; findings are a fresh pass on the post-fix tree)
