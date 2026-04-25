# Agentic Code Review: ovid/unified-error-mapper

**Date:** 2026-04-24 19:23:05
**Branch:** ovid/unified-error-mapper → main
**Commit:** 244933d0198e6192c18c39a86a38e9aa3f53e52b
**Files changed:** 59 | **Lines changed:** +8391 / -974
**Diff size category:** Large

## Executive Summary

Phase 4b.3 (unified API error mapper) is materially implemented: the `mapApiError(err, scope) → { message, possiblyCommitted, transient, extras? }` core, the `SCOPES` registry, and transport normalization in `api/client.ts` are all in place, with 765 lines of mapper tests pinning the contract. After many prior review rounds the core is clean — prototype-pollution is handled, ABORTED is silent, raw `err.message` is contained to the transport layer. The remaining issues cluster into three themes: (1) several call sites declare `committed:` copy in their scope but don't branch on `possiblyCommitted` at the call site, so the user sees the wrong UI on 2xx BAD_JSON; (2) an AbortController gap — multiple mutation transports don't accept a signal at all, and some call sites that could pass one don't; and (3) a load-bearing contradiction between the design/CLAUDE.md ("2xx BAD_JSON is unconditionally `possiblyCommitted`") and the implementation (which gates it on `scope.committed` being defined).

## Critical Issues

### [C1] Design/CLAUDE.md vs code disagree on the "2xx BAD_JSON is always possiblyCommitted" invariant
- **File:** `packages/client/src/errors/apiErrorMapper.ts:88-92`; `docs/plans/2026-04-23-unified-error-mapper-design.md:95`; `CLAUDE.md:98`
- **Bug:** Design and CLAUDE.md state the rule is unconditional: "2xx BAD_JSON is always `possiblyCommitted: true`. No scope can forget this." Implementation gates `possiblyCommitted` on `scope.committed !== undefined` with an inline "S7" comment justifying the change. The rule is the most load-bearing cross-cutting contract of the mapper; doc drift here means every future scope author will consult the wrong source.
- **Impact:** A GET scope has no `committed:` string, so 2xx BAD_JSON on a GET correctly returns `possiblyCommitted: false`. But the rule as written in the design/CLAUDE.md would pass review for any future mutation scope that forgets `committed:` — and the mapper silently returns `possiblyCommitted: false` for it. The rule must match reality so reviewers can rely on it.
- **Suggested fix:** Either restore the unconditional rule in code (and make every GET scope consult `possiblyCommitted: false` explicitly at call sites — which is load-bearing for invariant reasons, not just UI nicety), or update the design and CLAUDE.md to say "2xx BAD_JSON is `possiblyCommitted: true` when `scope.committed` is defined; otherwise `false`." Decide before Phase 4b.4 lint work.
- **Confidence:** High
- **Found by:** Plan Alignment

### [C2] `ProjectSettingsDialog.saveTimezone` ignores `possiblyCommitted`; reverts UI on a committed save
- **File:** `packages/client/src/components/ProjectSettingsDialog.tsx:278-284`
- **Bug:** Catch unconditionally calls `setTimezone(confirmedTimezoneRef.current)` and never consults `mapApiError`'s `possiblyCommitted`. On 2xx BAD_JSON the server has committed the new timezone but the UI reverts to the previous value. Sibling `saveField` (line 206-227) correctly branches on `possiblyCommitted` and promotes the optimistic value.
- **Impact:** User sees "your timezone is X" while the server persists Y. Next session picks up Y and the user is confused why their change "took" after they thought it didn't.
- **Suggested fix:** Mirror `saveField`: read `possiblyCommitted` from the mapper, and on `true` skip the revert, advance `confirmedTimezoneRef.current = value`, and surface the committed copy.
- **Confidence:** High
- **Found by:** Logic-B

### [C3] `ImageGallery.handleDelete` ignores `possiblyCommitted`; UI stays stale after a committed delete
- **File:** `packages/client/src/components/ImageGallery.tsx:240-255`
- **Bug:** Catch doesn't branch on `possiblyCommitted`. On 2xx BAD_JSON the server deleted the image but `selectedImage` stays set, `confirmingDelete` stays true, and `incrementRefreshKey()` is not called. Sibling `handleFileSelect` (line 157-170) does refresh on committed.
- **Impact:** User clicks delete → server deletes → unreadable body → detail view still shows the image → user retries → server 409s because the image is already gone. The `uploadCommittedRefresh` scope copy ("Check the image gallery — refresh if needed") is broadcast to the wrong surface area.
- **Suggested fix:** On `possiblyCommitted`, clear the detail view, close the confirmation, and bump the refresh key before announcing the committed copy.
- **Confidence:** High
- **Found by:** Logic-B

### [C4] `ExportDialog` cover-image fetch silently swallows every non-abort failure
- **File:** `packages/client/src/components/ExportDialog.tsx:106-114`
- **Bug:** `const { message } = mapApiError(err, "image.list");` is computed; ABORTED is silenced; every other failure unconditionally calls `setCoverImages([])` and never surfaces `message`.
- **Impact:** On a real 4xx/5xx the cover-image dropdown is silently empty. The user assumes the project has no images and exports without a cover, not knowing the list load failed.
- **Suggested fix:** Set an error state via `setError(message)` (mirroring `handleExport` at the same component) or render an inline retry row. Either way the user must see that the list failed.
- **Confidence:** High
- **Found by:** Error-B

### [C5] `handleReorderChapters` has no AbortController or sequence guard
- **File:** `packages/client/src/hooks/useProjectEditor.ts:690-756`
- **Bug:** Rapid drag-drop reorders issue overlapping PUTs to `/api/projects/:slug/chapters/order`. There's no sequence token and no abort — the SQLite writer-lock ordering at the server, not the user's last drop, determines the persisted order. Siblings `handleStatusChange` and `handleUpdateProjectTitle` got the I11 `*ChangeAbortRef` treatment in this branch; reorder was missed.
- **Impact:** Silent persistence of a stale order. After reload the user sees the old order and assumes drag-drop "didn't work." Same failure class as the one I11 was written to fix.
- **Suggested fix:** Mirror `statusChangeAbortRef` — add `reorderAbortRef`, abort prior controller on entry, thread `controller.signal` through `api.projects.reorderChapters` (transport already accepts it for other calls; extend if needed), and short-circuit the response branches on `controller.signal.aborted`.
- **Confidence:** High
- **Found by:** Error-B, Concurrency-B

## Important Issues

### [I1] `HomePage.handleDelete` ignores `possiblyCommitted`
- **File:** `packages/client/src/pages/HomePage.tsx:56-69`
- **Bug:** `project.delete` declares `committed:` copy but the catch doesn't branch on `possiblyCommitted`. On 2xx BAD_JSON the project is gone at the server but the row still shows locally.
- **Suggested fix:** On `possiblyCommitted`, optimistically drop the row from `projects` state and surface the committed copy.
- **Confidence:** High
- **Found by:** Logic-B

### [I2] `useProjectEditor.handleSave` doesn't `setEditable(false)` on committed save-fail paths
- **File:** `packages/client/src/hooks/useProjectEditor.ts:267-308`
- **Bug:** Terminal `BAD_JSON`/`UPDATE_READ_FAILURE`/`CORRUPT_CONTENT` branches break out and set `saveStatus="error"` + surface committed copy, but never call `setEditable(false)`. CLAUDE.md save-pipeline invariant #2 requires the editor to be locked around any mutation that can leave the server committed while the user cannot see the state. Current behavior: the banner says "your save may have gone through — don't keep typing," and the editor is still editable. Next auto-save PATCHes over committed content.
- **Suggested fix:** Route these terminal paths through `applyReloadFailedLock` (the invariant-pair helper already used by snapshot-restore / find-replace), or at minimum call `setEditable(false)` + surface `editorLockedMessage`.
- **Confidence:** Medium
- **Found by:** Logic-B, Contract-B

### [I3] `restoreSnapshot` and its follow-up list fetch have no AbortSignal
- **File:** `packages/client/src/hooks/useSnapshotState.ts:345, 370`
- **Bug:** `api.snapshots.restore(snapshotId)` and the success-branch `api.snapshots.list(restoringChapterId)` omit signals though the transport accepts them. EditorPage at line 490 even admits "no path triggers ABORTED on restore today." Chapter switch during restore leaves the server fetching/writing for a caller that has already discarded the response.
- **Suggested fix:** Thread a `restoreAbortRef` through restore + follow-up list; abort in the unmount effect.
- **Confidence:** Medium
- **Found by:** Error-B, Concurrency-B

### [I4] `handleUpdateProjectTitle` committed-recovery silently absorbs 404 and leaves the slug dead
- **File:** `packages/client/src/hooks/useProjectEditor.ts:800-812`
- **Bug:** On `possiblyCommitted`, recovery GET is `try { api.projects.get(slug) } catch {}`. A rename changes the slug — the GET 404s — catch is silent. `projectSlugRef.current` is never updated. All subsequent saves/creates/reorders POST to the dead slug and 404 until the user refreshes.
- **Suggested fix:** On 404 in the recovery GET, set `editorLockedMessage` via the existing banner mechanism, disable auto-save, and tell the user to refresh.
- **Confidence:** Medium
- **Found by:** Error-B

### [I5] `useTrashManager.openTrash` has no AbortController; `console.error` fires unconditionally
- **File:** `packages/client/src/hooks/useTrashManager.ts:18-29`
- **Bug:** `api.projects.trash(project.slug)` does not accept a signal at the transport layer (`api/client.ts:249`), so no call site can thread one. The catch logs `console.error("Failed to load trash:", err)` with no abort/aborted gate — test output gets polluted the same way DashboardView/HomePage were fixed.
- **Suggested fix:** (a) extend `api.projects.trash` to accept `signal?: AbortSignal`; (b) create a controller at mount, abort on unmount; (c) gate the log behind `!controller.signal.aborted && message !== null`.
- **Confidence:** High
- **Found by:** Error-B, Concurrency-B

### [I6] `SnapshotPanel.handleCreate` / `handleDelete` don't thread AbortSignal
- **File:** `packages/client/src/components/SnapshotPanel.tsx:281, 299`
- **Bug:** Transport accepts a signal; call sites don't pass one. On rapid chapter-switch after click, POST/DELETE still run to completion; `.then/.catch` calls `setShowCreateForm(false)` / `setConfirmDeleteId(null)` after the `resetKey` transition reset the panel, leaking stale state.
- **Suggested fix:** Add a `mutateAbortRef` (distinct from `fetchAbortRef`), thread into create/delete, cover in unmount cleanup.
- **Confidence:** High
- **Found by:** Error-B, Concurrency-B

### [I7] `handleDeleteChapter` / `handleRenameChapter` have no AbortSignal / sequence guard
- **File:** `packages/client/src/hooks/useProjectEditor.ts:612-688, 929-956`
- **Bug:** `api.chapters.delete`, the follow-up `api.chapters.get`, and `api.chapters.update(chapterId, { title })` all lack signals. Rapid renames race at the server; delete completes after user has moved on. Sibling `handleUpdateProjectTitle` got `titleChangeAbortRef`; chapter versions were missed.
- **Suggested fix:** Add `renameChapterAbortRef` and `deleteChapterAbortRef` (or extend existing controllers); thread into the PATCH/DELETE; token-guard setState.
- **Confidence:** Medium-High
- **Found by:** Error-B, Concurrency-B

### [I8] `Editor.tsx` paste-upload doesn't refresh gallery on `possiblyCommitted`
- **File:** `packages/client/src/components/Editor.tsx:268-271`
- **Bug:** `ImageGallery.handleFileSelect` fires `incrementRefreshKey()` on `possiblyCommitted` — but the Editor's paste/drop path only destructures `{ message }`. User pastes → 2xx BAD_JSON → message shown → user pastes again (no visible uploaded image) → duplicate server row. The scope's `image.upload.committed` copy literally says "Check the image gallery — refresh if needed," but the gallery isn't notified.
- **Suggested fix:** Expose a callback from EditorPage (or a shared refresh event) that Editor can invoke from its paste catch on `possiblyCommitted`.
- **Confidence:** Medium
- **Found by:** Contract-B

### [I9] `ImageGallery` list and references useEffects still use `let cancelled = false`
- **File:** `packages/client/src/components/ImageGallery.tsx:69-94, 112-137`
- **Bug:** Explicitly inconsistent with DashboardView (line 41-66) and HomePage (line 18-41) which this branch migrated to AbortController. The rationale noted in DashboardView (zero-warnings test output) applies verbatim.
- **Suggested fix:** Convert both effects to AbortController; thread signals through `api.images.list` / `api.images.references`.
- **Confidence:** High
- **Found by:** Concurrency-B

### [I10] `ImageGallery.handleSave/handleInsert` and paste upload have no AbortSignal
- **File:** `packages/client/src/components/ImageGallery.tsx:197, 215`; `api/client.ts:402` (transport)
- **Bug:** `api.images.update` does not accept a signal parameter at the transport level; the catch's ABORTED early-return at line 244 is therefore dead code, which gives false confidence the race is handled.
- **Suggested fix:** Extend transport, then wire call-site controllers; remove dead branch if the fix lands.
- **Confidence:** Medium
- **Found by:** Error-B, Concurrency-B

### [I11] `images.upload` has no AbortSignal parameter
- **File:** `packages/client/src/api/client.ts:362-376`
- **Bug:** Upload can take seconds for a multi-MB file. Gallery close or navigation mid-upload leaks the request; `.then` calls setState on an unmounted component. Every other long-running call in the branch got a signal parameter; upload was missed.
- **Suggested fix:** Add `signal?: AbortSignal` to `images.upload`, thread into `fetch` and the body-read chain; wire ImageGallery and Editor paste to pass a controller.
- **Confidence:** High
- **Found by:** Concurrency-A

### [I12] Scope network-copy gaps across many mutation scopes
- **File:** `packages/client/src/errors/scopes.ts` — `project.updateTitle`, `snapshot.create`, `snapshot.delete`, `chapter.create`, `chapter.rename`, `chapter.reorder`, `chapter.updateStatus`, `image.delete`, `image.updateMetadata`, `settings.update`, `trash.restoreChapter`
- **Bug:** These scopes declare `committed:` but no `network:` override. `mapApiError` returns `transient: true` for NETWORK unconditionally, but the message falls back to the scope's generic `fallback` string instead of the "check your connection" copy siblings like `project.updateFields` surface. Consumers that use only `message` (most do) lose the connection hint.
- **Suggested fix:** Add `network:` entries per scope (strings exist or can mirror `saveNetworkError`). Mechanical, one commit, scoped to `scopes.ts` + `strings.ts`.
- **Confidence:** Medium-High
- **Found by:** Logic-A, Contract-A

### [I13] `chapter.create` missing `byStatus.404` copy
- **File:** `packages/client/src/errors/scopes.ts:102-110`
- **Bug:** Sibling `image.upload` declares `404: uploadProjectGone` for the project-deleted-mid-click case. `chapter.create` hits the same condition (soft-deleted project) with the same server shape and surfaces generic "Failed to create a new chapter." which won't succeed on retry.
- **Suggested fix:** Add `byStatus: { 404: STRINGS.error.createChapterProjectGone }` (or reuse an existing project-gone string).
- **Confidence:** Medium
- **Found by:** Contract-A

### [I14] 2xx body-read network failure is tagged BAD_JSON, surfacing "possibly committed" for a failed body
- **File:** `packages/client/src/api/client.ts:186-198`
- **Bug:** A real TCP reset between headers and body rejects `res.json()` with a TypeError (not AbortError). The code classifies it as `BAD_JSON` with the 2xx status, driving the mapper to the committed branch. For `chapter.save` this reads: "your save may have gone through" when in fact the server never flushed a body (and may not have committed either, depending on where the drop occurred).
- **Suggested fix:** In the 2xx body-read catch, if the error is a TypeError (not DOMException AbortError), classify as `NETWORK` (transient) rather than `BAD_JSON` (possiblyCommitted).
- **Confidence:** Medium
- **Found by:** Error-A

### [I15] `mapApiError` does not wrap `scope.extrasFrom` in try/catch
- **File:** `packages/client/src/errors/apiErrorMapper.ts:131, 140, 147`
- **Bug:** A buggy `extrasFrom` throws out of `mapApiError`, which violates the de-facto "mapper never throws" contract the call sites rely on. Not exploited today because `extrasFrom` authors are careful, but the contract should be enforced.
- **Suggested fix:** Wrap each `scope.extrasFrom?.(err)` call in try/catch that returns `undefined` on throw (and, in dev, logs).
- **Confidence:** Medium
- **Found by:** Error-A

### [I16] `errors/index.ts` barrel omits `ApiRequestError`; consumers deep-import
- **File:** `packages/client/src/errors/index.ts`; `packages/client/src/hooks/useSnapshotState.ts:3`
- **Bug:** `ApiRequestError` is the instantiation point for synthetic errors the snapshot hook uses. Because the barrel doesn't re-export it, `useSnapshotState` imports from `../api/client`, weakening the boundary the barrel was designed to enforce (and blocking a future ESLint rule of the form "only errors/ or api/client may instantiate ApiRequestError").
- **Suggested fix:** Re-export `ApiRequestError` (value or type-only) from `errors/index.ts`; migrate consumers to the barrel.
- **Confidence:** Medium
- **Found by:** Contract-A

### [I17] `resolveError` is exported and used by tests, inviting ad-hoc ScopeEntry bypasses
- **File:** `packages/client/src/errors/apiErrorMapper.ts:72`; `packages/client/src/errors/apiErrorMapper.test.ts:4`
- **Bug:** The "scopes.ts is the single source of truth" invariant is weakened by an exported `resolveError(err, scopeEntry)` that takes an arbitrary ScopeEntry. Even though the barrel does not re-export it, the named export is reachable via a deep import.
- **Suggested fix:** Rename to `_resolveErrorInternal` with a comment pinning its test-only use, or exercise via the public `mapApiError` from tests.
- **Confidence:** Medium
- **Found by:** Contract-A

### [I18] `sanitizer.ts` has no tests
- **File:** `packages/client/src/sanitizer.ts`
- **Bug:** The sanitizer is the app's defense-in-depth against hostile backup/snapshot/server HTML. No regression tests pin the allowlist; a future allowlist edit (e.g. adding `<a>` without `href`) goes unnoticed. CLAUDE.md's coverage thresholds are evaded because the file is small.
- **Suggested fix:** Add tests asserting: `<script>alert(1)</script>` is stripped, `<img onerror=…>` attributes are stripped, `javascript:` URIs are stripped, `data:` URIs on `<img>` behave as intended, attribute whitelist matches the declared intent per tag.
- **Confidence:** High
- **Found by:** Error-A

### [I19] `STRINGS.snapshots.listFailed` is dead; actionable hint lost in replacement copies
- **File:** `packages/client/src/strings.ts:376`
- **Bug:** After the scope migration, `snapshot.list` uses `listFailedGeneric` / `listFailedNetwork`. The old `listFailed` ("Unable to load snapshots. Try opening the panel again.") has no remaining referent outside `strings.ts` and is strictly more informative than the replacement.
- **Suggested fix:** Delete the dead key, or restore it as `snapshot.list.fallback` to preserve the actionable hint.
- **Confidence:** High
- **Found by:** Contract-B

### [I20] `useSnapshotState.test.ts:368` carries a stale type annotation
- **File:** `packages/client/src/__tests__/useSnapshotState.test.ts:368`
- **Bug:** `let r: { ok: boolean; reason?: string } = { ok: false };` reflects the pre-refactor `RestoreResult` shape. Current shape is `{ ok: true; ... } | { ok: false; error: ApiRequestError }`. Test passes because it only asserts `r.ok`, but the annotation misleads future readers.
- **Suggested fix:** `let r: RestoreResult = { ok: false, error: new ApiRequestError("", 500, "") };` or drop the annotation.
- **Confidence:** High
- **Found by:** Contract-B

### [I21] `handleStatusChange` revert uses `previousStatus` captured from `projectRef`, which may reflect a prior optimistic update
- **File:** `packages/client/src/hooks/useProjectEditor.ts:830`
- **Bug:** Rapid status changes X→A then A→B capture `previousStatus = A` for B (B's closure reads `projectRef.current` after A's optimistic setProject landed). If B's PATCH fails AND the fallback GET at line 872 also fails (silent catch), the local revert at 906-918 restores to A — a status the server never persisted. UI shows A, server holds X, next refresh shows X.
- **Suggested fix:** Track a `confirmedStatusRef` that advances only on server-confirmed commits; revert against it. Parallels `confirmedFieldsRef`/`confirmedTimezoneRef` in ProjectSettingsDialog.
- **Confidence:** Medium
- **Found by:** Concurrency-B

### [I22] Recovery `api.projects.get` calls have no AbortSignal
- **File:** `packages/client/src/hooks/useProjectEditor.ts:468, 802, 872`; `api/client.ts:206` (transport)
- **Bug:** Three recovery GETs (handleCreateChapter, handleUpdateProjectTitle, handleStatusChange) run past the unmount cleanup. `api.projects.get` doesn't accept a signal at the transport level, so no call site can thread one.
- **Suggested fix:** Extend `api.projects.get` to accept `signal?: AbortSignal`; wire call sites; abort in the hook's unmount cleanup.
- **Confidence:** Medium
- **Found by:** Concurrency-B

## Suggestions

- **A1** — `apiErrorMapper.ts:76-78`: ABORTED/NETWORK short-circuit keyed on `err.code` only. A buggy server envelope `{code:"ABORTED"}` would silently suppress a real 4xx/5xx. Consider requiring `err.status === 0` for the transport-code branches.
- **A3** — `scopes.ts`: `snapshot.list` missing `byStatus.404` (sibling `snapshot.view` has it).
- **A4** — `apiErrorMapper.ts`: BAD_JSON/NETWORK/ABORTED paths skip `extrasFrom` by design; document on `ScopeEntry`.
- **A5** — `api/client.ts:118, 158`: `body.error?.message` on a JSON `null` body throws `TypeError`; caught by the outer try, but `body?.error?.message` is the correct access pattern.
- **A6** — `apiErrorMapper.ts:134`: `scope.byStatus?.[err.status]` lacks the `Object.hasOwn` guard that was applied to byCode (C2). Parity, not a vulnerability.
- **A7** — `api/client.ts:166-176`: 4xx/5xx body-read failures fall through without `code=BAD_JSON`, unlike the 2xx branch. Dev-facing inconsistency.
- **A8** — `classifyFetchError`: only recognizes abort via `DOMException && name==="AbortError"`. Custom abort reasons or browser quirks could be mislabeled `NETWORK`.
- **A12** — `extractExtras`: 16-key cap applied after dangerous-key filter, not after front-loaded junk filter. Low severity (server sends 1-2 extras today).
- **A13** — Mapper: status outside the allowlist (401/403/502/503) silently falls to `scope.fallback`; consider a dev-mode warn.
- **A14** — Mapper: BAD_JSON status-range test `>= 200 && < 300` matches 204/205. Latent (upload/export paths don't return 204 today).
- **A15** — `scopes.ts` image.delete.extrasFrom: narrows to `{title, trashed?}`, dropping server-provided `id` from the type (preserved at runtime).
- **A19** — `extractExtras` vs scope `extrasFrom`: two-pass validation duplicates structural filtering; drift risk.
- **A20** — `mapApiError`: no runtime guard on unknown scope name; TS prevents today, ESLint enforcement is Phase 4b.4.
- **A21** — `useSnapshotState.ts:30-55`: hand-rolled `ApiRequestError` synthesis factories duplicate the mapper's input contract. Consider centralizing.
- **A22** — `scopes.ts`: `SCOPES` registry is mutable module-level state; not `Object.freeze`d.
- **A24** — `sanitizer.ts`: `ALLOWED_URI_REGEXP` and `ALLOW_DATA_ATTR` not pinned; posture depends on DOMPurify defaults.
- **A25** — `sanitizer.ts`: global `ALLOWED_ATTR = ["src","alt"]` is not per-tag-scoped; `<blockquote src=…>` would pass through (inert but outside the stated allowlist contract).
- **A26** — `api/client.ts:91` extractExtras: `typeof errorBody !== "object"` admits arrays; downstream filter makes it non-exploitable today.
- **B7** — `useProjectEditor.ts:343`: cache-clear gated on `VALIDATION_ERROR` only; extending to `CORRUPT_CONTENT` is arguable (keeping user's typed cache on a corrupt server row may be the right call).
- **B13** — `useTrashManager.ts:53`: `console.error` fires before ABORTED gate. "Doesn't add to project.chapters" portion of the original finding was incorrect — the happy path does add.
- **B14** — `useTrashManager.ts:95-97`: one bare `catch { }` on the trash-refresh (comment acknowledges); nit.
- **B21** — `strings.ts:373-374`: `createFailed` vs `createFailedGeneric` near-duplicates invite drift.
- **B24** — `ProjectSettingsDialog.tsx:193`: `saveField` `console.error` fires only after `controller.signal.aborted` check; window where `err.code === "ABORTED"` without local abort is narrow but not guarded.
- **B25** — `EditorPage.tsx:1980-2024`: SnapshotPanel translator double-maps errors; explicitly marked as Phase 4b.4 cleanup.

## Plan Alignment

- **Implemented:** Core mapper (`apiErrorMapper.ts`, `scopes.ts`, barrel), transport changes (`ApiError` index signature in shared, `ApiRequestError.extras`, `readErrorEnvelope`, `extractExtras`, `classifyFetchError`), `images.delete` uniform throw, centralized-already migrations (`findReplaceErrors.ts` deleted; `useFindReplaceState` and `useSnapshotState` collapsed), 30+ generic-fallback migrations across hooks/pages/components, CLAUDE.md "Unified API error mapping" invariant text, type-guard helpers (`isApiError`/`isAborted`/`isNotFound`/`isClientError`), regression tests.
- **Not yet implemented:** Phase 4b.4 ESLint enforcement of `mapApiError` (explicitly deferred in design and CLAUDE.md).
- **Deviations:**
  - Design lists ~30 scopes; registry has 33+ (new: `projectList.load`, `project.updateFields`, `image.list`, `image.references`). Additive.
  - `ScopeEntry` gained `committedCodes?: string[]` (not in design §2/§3). Resolver applies it at `apiErrorMapper.ts:128`. Additive contract expansion.
  - **2xx BAD_JSON `possiblyCommitted` is conditional on `scope.committed` being defined** (apiErrorMapper.ts:88-92) vs. design §2 and CLAUDE.md §4 which state it unconditionally. See C1.
  - `extrasFrom` validation deepened beyond the design example (per-element shape in `image.delete`, not just `Array.isArray`).
  - `apiFetch` / `images.upload` body-read failure mapping uses a dedicated `readErrorEnvelope` helper rather than the inline spread shown in design §4a. Shape consistent with intent.
  - **Branch scope:** bundles four commits tangential to Phase 4b.3: CONTRIBUTING.md (`83b1c50`), DEP0040 + Node engines pin (`a3dd69f`), vitest worker cap (`1a62283`), ESLint warm (`bbe20fb`). CLAUDE.md's one-feature rule (§Pull Request Scope) says "a bug fix alongside the feature it affects is fine; a second unrelated bug fix is not." These are DX/infra, not the feature.

## Review Metadata

- **Agents dispatched:**
  - Logic & Correctness — Partition A (core: errors/*, api/client.ts, sanitizer.ts, shared)
  - Logic & Correctness — Partition B (consumers: hooks, pages, components)
  - Error Handling & Edge Cases — Partition A
  - Error Handling & Edge Cases — Partition B
  - Contract & Integration — Partition A
  - Contract & Integration — Partition B
  - Concurrency & State — Partition A
  - Concurrency & State — Partition B
  - Security — focus on sanitizer, prototype pollution, header injection
  - Plan Alignment — design/plan/roadmap vs. implementation
  - Verifier — consolidated findings against current code
- **Scope:** 59 changed files (errors/* new, api/client.ts heavily changed, all major hooks and pages, 8 components). Expanded to callers/callees one level deep; read `useAbortableSequence`, `useEditorMutation`, `editorExtensions` for invariant context.
- **Raw findings:** 58 (across all specialists, pre-verification)
- **Verified findings:** 5 Critical, 22 Important, 25 Suggestions
- **Filtered out:** 6 duplicates collapsed; 1 finding (A27) rejected (defense is already in place); 1 finding (B4) rejected (claim not supported by code).
- **Steering files consulted:** `/Users/ovid/projects/smudge/CLAUDE.md`
- **Plan/design docs consulted:** `docs/plans/2026-04-23-unified-error-mapper-design.md`, `docs/plans/2026-04-23-unified-error-mapper-plan.md`, `docs/roadmap.md`
