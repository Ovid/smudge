# Agentic Code Review: ovid/unified-error-mapper

**Date:** 2026-04-25 10:32:46
**Branch:** ovid/unified-error-mapper -> main
**Commit:** a68afd16d9dba025cd210e011453c7ed1014a551
**Files changed:** 63 | **Lines changed:** +11,373 / -1,061
**Diff size category:** Large

## Executive Summary

The unified-error-mapper migration is solid at the contract layer: the scope registry is exhaustive and TS-enforced, prototype-pollution defenses (`byCode` and `extras`) hold, raw `err.message` no longer leaks to UI, and `mapApiError` is reliably used at every UI surface. Save-pipeline invariants from CLAUDE.md (markClean / setEditable / cache-clear / sequence-bump / status-allowlist) are upheld at the load-bearing call sites. **No Critical findings.** The 15 Important findings cluster in three areas: (1) several scopes that fall back to generic copy when they should map specific codes/statuses (REORDER_MISMATCH, chapter.save 404, snapshot.create's unused possiblyCommitted), (2) consistent gaps where mutation endpoints (`projects.create`, `projects.delete`, `chapters.create`, `chapterStatuses.list`) and call sites (`Editor.tsx` paste upload, `loadProject`, `executeReplace`, `ExportDialog` unmount, HomePage recovery) skip AbortSignal threading despite the rest of the branch's discipline, and (3) one PR-shape concern: the sanitizer hardening + CONTRIBUTING.md + Node-engines pin appear bundled in a single PR with the error-mapper migration, which violates CLAUDE.md's one-feature rule.

## Critical Issues

None found.

## Important Issues

### [I1] `chapter.reorder` scope is missing `REORDER_MISMATCH` byCode
- **File:** `packages/client/src/errors/scopes.ts:134-138`
- **Bug:** Server emits `400 + code: "REORDER_MISMATCH"` from `packages/server/src/projects/projects.routes.ts:132-138` when the chapter id list mismatches. The scope has no `byCode` or `byStatus` entry, so the user gets the generic `STRINGS.error.reorderFailed` fallback after a deterministic id-list mismatch.
- **Impact:** Sibling scopes (image.upload `VALIDATION_ERROR`, project.create `PROJECT_TITLE_EXISTS`) all surface specific actionable copy. Same shape as I1/I12/I13 fixes already landed for image.upload and chapter.create — REORDER_MISMATCH was missed.
- **Suggested fix:** Add `byCode: { REORDER_MISMATCH: STRINGS.error.reorderMismatch }` and a matching string. The error tells the user the chapter list is out of sync and to refresh.
- **Confidence:** High
- **Found by:** Logic-Core, Contract

### [I2] `chapter.save` lacks `network:` field and 404 byStatus mapping
- **File:** `packages/client/src/errors/scopes.ts:87-108`
- **Bug:** Every sibling mutation declares `network:` separately from `fallback:`; chapter.save uses `STRINGS.editor.saveFailed` ("Unable to save — check connection") as both. When a chapter is soft-deleted in another tab and the user keeps typing, the auto-save PATCH 404s, falls to fallback, and the user sees a network theory while typing into never-persisting content.
- **Impact:** chapter.save is the most load-bearing mutation. The conflated copy actively misleads. Same anti-pattern this PR explicitly fixed for image.upload (I1, 404 → uploadProjectGone) and chapter.create (I13, 404 → createChapterProjectGone).
- **Suggested fix:** Add `network: STRINGS.editor.saveFailedNetwork` and `byStatus: { 404: STRINGS.editor.saveFailedChapterGone }` (introduce both new strings); reword `saveFailed` fallback to be neutral.
- **Confidence:** Medium
- **Found by:** Logic-Core, ErrorHandling

### [I3] `snapshot.create` declares `committed:` but call site never consumes `possiblyCommitted`
- **File:** `packages/client/src/components/SnapshotPanel.tsx:305-309` against `packages/client/src/errors/scopes.ts:242-246`
- **Bug:** snapshot.create declares `committed: STRINGS.error.possiblyCommitted`, so the mapper returns `possiblyCommitted: true` on 2xx BAD_JSON. The call site only destructures `{ message }` and shows `createError`. Sibling possiblyCommitted call sites (snapshot.restore, chapter.create, trash.restoreChapter, image.delete) all branch on the flag.
- **Impact:** After a 2xx BAD_JSON the just-committed snapshot is invisible until the next user-triggered fetch; the user retries, gets the duplicate-detection 200, but the panel still shows the original count.
- **Suggested fix:** In the `handleCreate` catch, branch `if (possiblyCommitted) { setShowCreateForm(false); setCreateLabel(""); setDuplicateMessage(false); await fetchSnapshots(); }` before surfacing the message.
- **Confidence:** High
- **Found by:** Logic-Core

### [I4] `useTrashManager.handleRestore` possiblyCommitted only mutates trash list
- **File:** `packages/client/src/hooks/useTrashManager.ts:117-138`
- **Bug:** Success path adds the restored row to `project.chapters` AND seeds `confirmedStatusRef`. The `possiblyCommitted` branch (lines 134-137) only filters from trash; the restored chapter is gone from trash but missing from the sidebar/editor until the user refreshes. A subsequent status PATCH on that row also bypasses the local-revert fallback (no seed entry).
- **Impact:** The user is told to refresh, so workflow is recoverable, but a user who clicks elsewhere without refreshing operates in a half-state. seedConfirmedStatus gap is a real mini-bug per the comment at `useProjectEditor.ts:1174-1182` documenting why seeding is load-bearing.
- **Suggested fix:** On `possiblyCommitted`, run a project refresh (`api.projects.get(project.slug, signal)`) and re-seed the confirmed-status cache, mirroring `handleCreateChapter`'s recovery branch.
- **Confidence:** Medium
- **Found by:** Logic-Consumers

### [I5] `useTrashManager.confirmDeleteChapter` silently dismisses dialog on unexpected throw
- **File:** `packages/client/src/hooks/useTrashManager.ts:147-156`
- **Bug:** `try/catch` wraps `handleDeleteChapter`, and on throw it silently `setDeleteTarget(null)` and returns. User sees the confirm dialog disappear with no banner.
- **Impact:** Exactly the silent-failure UX the unified mapper migration is meant to eliminate. The user could plausibly think the delete succeeded.
- **Suggested fix:** In the catch, route through `mapApiError(err, "chapter.delete")` (or surface `STRINGS.error.deleteChapterFailed`) into `setActionError` before dismissing.
- **Confidence:** Medium
- **Found by:** ErrorHandling

### [I6] `Editor.tsx` paste/drop image upload does not thread AbortSignal
- **File:** `packages/client/src/components/Editor.tsx:281`
- **Bug:** `api.images.upload(uploadProjectId, file)` is called without a signal. `api.images.upload` accepts an optional signal (`api/client.ts:415`); ImageGallery's handleFileSelect threads one through. ABORTED branch unreachable here.
- **Impact:** On Editor unmount or chapter switch the upload runs to completion against a torn-down editor instance. Combined with [I7], the success announcement fires on the wrong chapter.
- **Suggested fix:** Allocate a per-handler AbortController stored on a ref, thread `controller.signal`, abort on Editor unmount or on chapter switch.
- **Confidence:** Medium
- **Found by:** Contract, Concurrency

### [I7] `api.projects.create` and `api.projects.delete` don't accept AbortSignal
- **File:** `packages/client/src/api/client.ts:241-245, 273-274`
- **Bug:** Asymmetric API surface: every other mutation accepts `signal?: AbortSignal`. HomePage's `handleCreate` (line 46) and `handleDelete` (line 76) cannot abort on unmount.
- **Impact:** ABORTED branch unreachable; user types title in HomePage dialog, clicks Create, presses back — POST continues, response lands on torn-down component. Also blocks fix for [I9] (recovery list-fetch) since it cannot abort cleanly through the parent operation.
- **Suggested fix:** Add `signal?: AbortSignal` to both endpoints; thread through HomePage handlers via a per-handler controller.
- **Confidence:** Medium
- **Found by:** Contract

### [I8] `api.chapters.create` does not accept AbortSignal
- **File:** `packages/client/src/api/client.ts:368-369` + caller `useProjectEditor.ts:508`
- **Bug:** chapter.create POST runs with no signal. `useProjectEditor.handleCreateChapter` calls `cancelInFlightSave()` and `selectChapterSeq.abort()` for abort discipline but the create POST itself is uncancellable.
- **Impact:** chapter.create is non-idempotent; a stranded POST after navigation can create a phantom chapter the user can't see until they next load the project. The scope already declares possiblyCommitted recovery, which assumes the chance is real.
- **Suggested fix:** Add `signal?: AbortSignal` to `chapters.create`; install `createAbortRef` in `useProjectEditor` and thread the signal.
- **Confidence:** Medium
- **Found by:** Contract

### [I9] `api.chapterStatuses.list` does not accept AbortSignal
- **File:** `packages/client/src/api/client.ts:407` + `EditorPage.tsx:1228-1244`
- **Bug:** The retry-with-backoff fetch in EditorPage uses a `cancelled` flag and `setTimeout` queue; cannot sever in-flight network requests on unmount.
- **Impact:** Same anti-pattern Copilot flagged for HomePage and DashboardView. Lower-impact than [I10] (statuses payload is small) but still inconsistent with the rest of the transport.
- **Suggested fix:** Add signal parameter; refactor the EditorPage effect to AbortController (mirror HomePage's pattern).
- **Confidence:** Medium
- **Found by:** Contract

### [I10] `loadProject` uses `cancelled` flag instead of AbortController
- **File:** `packages/client/src/hooks/useProjectEditor.ts:198-262`
- **Bug:** The project-load effect uses `let cancelled = false`; the two GETs (`api.projects.get` line 214, `api.chapters.get` line 239) skip the signal entirely. HomePage and DashboardView were both migrated to AbortController; this is the loudest project-level GET inconsistency. Combined with [I12], the active-chapter GETs across loadProject/handleSelectChapter/reloadActiveChapter all skip the signal.
- **Impact:** Stranded multi-KB GETs continue running after navigation; ABORTED branch unreachable; `mapApiError` cannot route to silent. CLAUDE.md "zero warnings in test output" relies on the cancelled gate running before console.warn.
- **Suggested fix:** AbortController, thread `controller.signal` through both GETs, abort in the effect cleanup.
- **Confidence:** High
- **Found by:** Concurrency

### [I11] `api.search.replace` issued without AbortSignal
- **File:** `packages/client/src/pages/EditorPage.tsx:775-781, 1018-1028`
- **Bug:** Both replace POSTs run inside `mutation.run` with no `signal` argument. `api.search.replace` accepts a signal (`api/client.ts:557`). `mutation.inFlightRef` only gates JS state, not the network request.
- **Impact:** A long replace (project-scope on a large manuscript) plus a navigation event leaves the server-side replace running for a vanished caller. setActionInfo fires on torn-down component; `finalizeReplaceSuccess` runs `findReplace.search` against state that has been reset.
- **Suggested fix:** Allocate AbortController inside both call sites (or an EditorPage-level `replaceAbortRef`), pass `controller.signal`, abort on EditorPage unmount.
- **Confidence:** Medium
- **Found by:** Concurrency

### [I12] `ExportDialog` no unmount cleanup for in-flight export blob
- **File:** `packages/client/src/components/ExportDialog.tsx:38-57`
- **Bug:** `useEffect` only aborts on `open: true → false` transition (lines 51-55). If the parent unmounts while the dialog is open and an export is mid-stream (a real path: `EditorPage.tsx:1551-1554` navigates away on settings-update 404), the cleanup runs but `if (!open && prevOpenRef.current)` is false. No unmount-time cleanup.
- **Impact:** Multi-MB export keeps streaming on the wire; setError fires on torn-down component.
- **Suggested fix:** Add a separate `useEffect(() => () => abortRef.current?.abort(), [])` for unmount, distinct from the open-transition effect.
- **Confidence:** Medium
- **Found by:** Concurrency

### [I13] `HomePage.handleCreate` recovery list-fetch lacks AbortSignal and unmount guard
- **File:** `packages/client/src/pages/HomePage.tsx:62-67`
- **Bug:** On `possiblyCommitted` create, `api.projects.list().then(setProjects).catch(() => {})` has no signal and no unmount cleanup.
- **Impact:** Combined with [I7], rapid click + navigate leaves a late `setProjects` on a torn-down HomePage. The whole rest of HomePage was migrated to AbortController for exactly this race.
- **Suggested fix:** AbortController at the top of `handleCreate`, thread through both `create` (after [I7]) and `list`, gate the `.then` on `signal.aborted`.
- **Confidence:** Medium
- **Found by:** Concurrency

### [I14] `sanitizer.ts` does not pin `ALLOWED_URI_REGEXP`
- **File:** `packages/client/src/sanitizer.ts:40-42`
- **Bug:** DOMPurify's default URI regex permits `data:` URIs in `img` tags. The threat model that motivates this file is a hostile snapshot/server payload bypassing the editor (S11 comment lines 3-12). SVG `data:` URI is a textbook XSS vector, and is not blocked by `ALLOWED_TAGS`/`ALLOWED_ATTR` alone.
- **Impact:** Smudge's only legitimate `<img src>` value is `/api/images/{uuid}`. Any other value in a snapshot's content blob is by definition not user-authored. Defense-in-depth that closes a real attack class for the file's stated purpose.
- **Suggested fix:** `const ALLOWED_URI_REGEXP = /^\/api\/images\//i;` and pass to `sanitize` options. Add a regression test for `data:image/svg+xml;…` and `javascript:`.
- **Confidence:** Medium
- **Found by:** Security

### [I15] One-feature rule violation: sanitizer + CONTRIBUTING/Makefile/engines bundled in this PR
- **Files:** `packages/client/src/sanitizer.ts` (new, 42 lines + 107 lines of tests), `CONTRIBUTING.md` (new, 196 lines), `Makefile` (DEP0040 target, +5 lines), `package.json` (engines.node pin)
- **Bug:** Bundled with the unified-error-mapper PR. CLAUDE.md's "one-feature rule" is explicit: a PR delivers a single feature or refactor, never both. The DOMPurify hardening is a security feature; the contributor docs + DEP0040 workaround are dev-environment housekeeping. Neither has anything to do with API error mapping.
- **Impact:** The phase-boundary rule reinforces this. The current branch is the same shape that gave the snapshots/find-and-replace branch its 16 rounds of review.
- **Suggested fix:** Split into two follow-up PRs: (1) sanitizer hardening, (2) dev-environment housekeeping. Update `docs/roadmap.md` to split the bundled phase first, per the rule.
- **Confidence:** High
- **Found by:** PlanAlignment

## Suggestions

- **[S1]** `trash.restoreChapter` lacks 404/NOT_FOUND mapping — falls through to fallback when chapter has been hard-purged. Add `byStatus: { 404: STRINGS.error.restoreChapterAlreadyPurged }`. (`scopes.ts:297-319`) — *Logic-Core*
- **[S2]** CLAUDE.md "Unified API error mapping" doesn't mention `committedCodes` extension. Update doc to describe both possiblyCommitted mechanisms. (`CLAUDE.md` vs `apiErrorMapper.ts:11-28`) — *PlanAlignment*
- **[S3]** `useProjectEditor.handleSave` non-2xx BAD_JSON locks editor with generic copy. Add `BAD_JSON` to chapter.save's byCode (also addresses [S6]). (`useProjectEditor.ts:357-369, 441-448`) — *Logic-Consumers*
- **[S4]** `handleStatusChange` possiblyCommitted drops message when caller omits `onError`. Mirror handleReorderChapters' `if (onError) onError(message); else setError(message);` (`useProjectEditor.ts:1032-1040`) — *Logic-Consumers*
- **[S5]** `restoreSnapshot` synthesizes 200 BAD_JSON for ALL non-ApiRequestError throws including pre-send bugs. Add a `dispatched` flag. (`useSnapshotState.ts:421-434`) — *Logic-Consumers*
- **[S6]** `import.meta.env?.DEV` access can throw in some test environments — `safeExtrasFrom` must-never-throw guard inverted by its own dev-log. Wrap dev-log in try/catch. (`apiErrorMapper.ts:173`) — *ErrorHandling*
- **[S7]** `chapter.save` CORRUPT_CONTENT scope/call-site duplication — call site hardcodes the byCode allowlist. Add `terminalCodes` or extend `committedCodes` semantics; move dispatch to scope. (`useProjectEditor.ts:357-369`) — *ErrorHandling*
- **[S8]** `image.delete` extrasFrom returns `undefined` when ANY chapter element is malformed. Return `{ chapters: valid }` whenever `valid.length > 0`. (`scopes.ts:195-206`) — *ErrorHandling*
- **[S9]** `ImageGallery` casts `extras.chapters` bypassing mapper's narrowed shape. Drop the cast; introduce `ScopeExtras<S>` type in Phase 4b. (`ImageGallery.tsx:334-338`) — *ErrorHandling, Contract*
- **[S10]** Silent recovery-catches in `handleStatusChange` (line 1079-1081) and `handleCreateChapter` (line 604-607) hide observability. Add dev-only `console.warn` gated on `!signal.aborted`. (`useProjectEditor.ts`) — *ErrorHandling*
- **[S11]** `chapter.create` 404 surfaces correct copy ("Navigate to Home") but no UI affordance navigates. Gate `isNotFound(err)` and call `navigate("/")`. (`useProjectEditor.ts:530-613`) — *Contract*
- **[S12]** `api.chapters.get` calls in loadProject/handleSelectChapter/reloadActiveChapter skip signal — partial migration (handleDeleteChapter at line 780 does pass it). Thread controllers into all three call sites. (`useProjectEditor.ts:239, 635, 688`) — *Contract*
- **[S13]** `confirmDeleteChapter` duplicates `openTrash` body almost verbatim. Extract `refreshTrashList()` helper or call `openTrash()` directly. (`useTrashManager.ts:53-71` vs `:158-178`) — *Contract*
- **[S14]** `SnapshotPanel` mount effect duplicates `fetchSnapshots`. Have effect call `fetchSnapshots()` directly; move `chapterSeq.abort()` into it. (`SnapshotPanel.tsx:139-159` vs `:164-189`) — *Contract*
- **[S15]** Consumer ladder duplication 30+ times: `if (message === null) return; if (message) setX(message)`. Add `applyMappedError(mapped, { onMessage, onTransient?, onCommitted? })` helper. — *Contract*
- **[S16]** `handleSelectChapterWithFlush` uses `chapter.load` scope for flush failure. Add `chapter.flushBeforeNavigate` scope. (`EditorPage.tsx:1481-1485`) — *Contract*
- **[S17]** `createRecoveryAbortRef` not nulled on success — latent leak/staleness. `if (createRecoveryAbortRef.current === recoveryController) createRecoveryAbortRef.current = null;` after merge. (`useProjectEditor.ts:566-608`) — *Concurrency*
- **[S18]** `Editor.tsx` paste upload announcement fires on cross-chapter switch — guard catches cross-project but not same-project chapter switch. Capture editor instance at upload-start; gate announcement on `editor === editorInstanceRef.current`. (`Editor.tsx:269-312`) — *Concurrency*
- **[S19]** `useSnapshotState.viewSnapshot` `viewAbortRef` not nulled on success — latent. `if (viewAbortRef.current === controller) viewAbortRef.current = null;` (`useSnapshotState.ts:265-345`) — *Concurrency*
- **[S20]** `handleReorderChapters` possiblyCommitted branch lacks epoch re-check before setProject. Move setProject into the projectId-match guard or duplicate it. (`useProjectEditor.ts:868-889`) — *Concurrency*
- **[S21]** `extrasFrom` validates `chapters[].title` is string but not length bounds. Cap chapters at e.g. 50 entries; truncate per-title length to e.g. 200 chars. (`scopes.ts:195-206`) — *Security*
- **[S22]** `vitest.config.ts` worker cap (maxForks/maxThreads: 4) — performance tuning unrelated to error mapping. Justify in PR description or split. — *PlanAlignment*
- **[S23]** ESLint sequence-rule test infra adjustments (`eslintSequenceRule.test.ts`, +32 lines). Acceptable as adjacent fix; called out for transparency. — *PlanAlignment*

## Plan Alignment

Plan/design docs consulted: `docs/plans/2026-04-23-unified-error-mapper-design.md`, `docs/plans/2026-04-23-unified-error-mapper-plan.md`, `docs/roadmap.md`.

- **Implemented:** Five planned commits exist (`90d3f30`, `1274ebe`, `5e76da5`, `6669458`, `2c3b9d7`) plus 80+ follow-up review-fix commits. All DoD signals verified: no remaining `findReplaceErrors` imports, no `RestoreFailureReason`/`ViewFailureReason`, no inline `mapSearchErrorToMessage`/`mapReplaceErrorToMessage`. CLAUDE.md "Unified API error mapping" block added at lines 92-102 verbatim from the plan; `errors/` listed under §Target Project Structure (line 35). `ImageGallery.handleDelete` migrated to throw-based contract atomically with the transport change (commit `1274ebe`).
- **Not yet implemented:** None of the explicit plan tasks appear deferred. Items in `docs/TODO.md` "Deferred from unified-error-mapper code review (2026-04-24)" are explicitly tagged as not-blocking follow-ups.
- **Deviations:** (1) Resolver renamed `resolveError` → `_resolveErrorInternal` (cosmetic). (2) Added `committedCodes` field to `ScopeEntry` — extends `possiblyCommitted` mechanism beyond 2xx BAD_JSON to specific byCode hits (`UPDATE_READ_FAILURE`, `READ_AFTER_CREATE_FAILURE`, `RESTORE_READ_FAILURE`). Aligns with design intent; CLAUDE.md doc lags ([S2]). (3) Four extra scopes beyond plan task 1.9 enumeration: `projectList.load`, `project.updateFields`, `image.list`, `image.references` — improvements consistent with "every API surface gets a scope". (4) Added `isApiError`/`isAborted`/`isNotFound`/`isClientError` predicates in `errors/index.ts` — extends public API. (5) Prototype-pollution + bounded-extras hardening in `extractExtras` — defensive delta the plan didn't anticipate.
- **Phase-boundary check:** PR maps to a single phase (4b.3). roadmap.md:33 lists 4b.3 "In Progress." No spillover into 4b.4 (raw-strings ESLint rule, deferred per plan) or 4b.5 (Editor State Machine, planned). However: the sanitizer ([I14]/[I15]) and CONTRIBUTING/Makefile/engines pin ([I15]) are not part of any roadmap phase — they are pure scope drift, not a phase-boundary violation per se but a one-feature-rule violation.

## Review Metadata

- **Agents dispatched:**
  - Logic-Core (mapper/api/sanitizer/strings/types)
  - Logic-Consumers (hooks/pages/components)
  - ErrorHandling (cross-cutting error paths)
  - Contract (signatures, scope coverage, duplication)
  - Concurrency (state, abort, sequence)
  - Security (DOM-XSS, prototype pollution, info leak)
  - PlanAlignment (design/plan/roadmap vs diff)
- **Scope:** 63 changed files, ~11k insertions / ~1k deletions. Full diff tree reviewed; adjacent server routes spot-checked for contract correctness.
- **Raw findings:** 50 (pre-verification, across 7 specialists)
- **Verified findings:** 38 (15 Important + 23 Suggestion)
- **Filtered out:** 12 — see "Rejected findings" below
- **Steering files consulted:** `CLAUDE.md` (project root)
- **Plan/design docs consulted:** `docs/plans/2026-04-23-unified-error-mapper-design.md`, `docs/plans/2026-04-23-unified-error-mapper-plan.md`, `docs/roadmap.md`, `docs/TODO.md`

### Rejected findings

- **C1** (committedCodes uses `Array.prototype.includes` without own-property gate) — REJECTED. `committedCodes` is a `string[]` literal authored statically in `scopes.ts`, not an attacker-influenced object indexed by `err.code`. `Array.prototype.includes` isn't vulnerable to prototype-pollution attacks the way `obj[err.code]` is.
- **C3** (`Object.hasOwn(scope.byCode, err.code)` doesn't guard against `err.code === ""`) — REJECTED. The check at line 126 already includes `err.code !== undefined && Object.hasOwn(scope.byCode, err.code)`. An empty-string code passing `Object.hasOwn` requires a scope literally to declare `byCode: { "": ... }`. Plus the `string` value-type guard at line 129 is the second line of defense.
- **D11** (`_resolveErrorInternal` JSDoc lacks warning that it accepts raw ScopeEntry) — REJECTED. Function has a 7-line comment block explicitly explaining test-only use.
- **D12** (Type-test gap on `image.delete` extras cast) — DUPLICATE of [S9].
- **D13** (`findReplace.search` byStatus 404 lacks SCOPE_NOT_FOUND code-specific entry) — REJECTED. Latent today (server's search route doesn't emit it); speculative.
- **F3** (`console.warn` echoes attacker-influenced err.code to dev console) — REJECTED. Bounded by control flow guards; finding self-labels as informational.
- Several discarded mid-review by individual specialists: `Editor.tsx` paste upload no-abort-signal silent drop on response (intentional behavior); `EditorPage` snapshot-view onView translator running mapper redundantly (acknowledged Phase 4b.4 cleanup); `EditorPage.handleRestoreSnapshot` `clearCachedContent(activeChapter.id)` (closure-captured target is correct); `useFindReplaceState.search` ignoring `transient` field (logic-equivalent gating on status); `useProjectEditor.handleUpdateProjectTitle` recovery 404 ABORTED handling (status===404 correctly false for ABORTED with status 0).
