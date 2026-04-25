# Agentic Code Review: ovid/unified-error-mapper

**Date:** 2026-04-24 17:09:26
**Branch:** ovid/unified-error-mapper -> main
**Commit:** bb8412f1d8b45185a6b833b3c8f4fe8f4916e72f
**Files changed:** 59 | **Lines changed:** +8,391 / -974
**Diff size category:** Large

## Executive Summary

The branch achieves its primary goal: every UI-visible error message routes through `mapApiError(err, scope)` with the `MappedError` shape the design specified, and the mapper itself is well-hardened (prototype-pollution defenses, `[dev]` prefix discipline, `Object.hasOwn` guards). Six specialists found one Critical issue — `chapter.save` ignores the mapper's `possiblyCommitted` signal it itself opted into via `committedCodes: ["UPDATE_READ_FAILURE"]`, leaving the editor writable so user keystrokes can overwrite a server-committed save. The remaining ten Important findings are mostly omissions of the discipline established elsewhere in this branch (missing `network:` scope arms, AbortControllers not threaded into a few call sites, three-hop error translator the in-code comment already flags as deferred work).

## Critical Issues

### [C1] `chapter.save` does not lock the editor on `possiblyCommitted` — user can overwrite server state
- **File:** `packages/client/src/hooks/useProjectEditor.ts:281-294, 355-358`
- **Bug:** `handleSave`'s catch for terminal codes (`BAD_JSON`, `UPDATE_READ_FAILURE`, `CORRUPT_CONTENT`) and 4xx fallback calls `mapApiError(err, "chapter.save")` but only destructures `message`. `possiblyCommitted` is never read. There is no `setEditable(false)`, no `markClean()`, no plumbing to `editorLockedMessage`. `handleContentChange` keeps recording new keystrokes; the next debounced cycle calls `handleSave` again and can succeed — overwriting the server-committed content the prior save already persisted.
- **Impact:** Data loss on the most load-bearing mutation in the app. The chapter.save scope explicitly defines `committedCodes: ["UPDATE_READ_FAILURE"]` and a save-specific `committed: STRINGS.editor.saveCommittedUnreadable` precisely so callers can switch to lock UX — but the call site never consumes the signal. Every other mutation hook (chapter.create, chapter.reorder, project.updateTitle, chapter.updateStatus) DOES read `possiblyCommitted`. CLAUDE.md's save-pipeline invariant #2 ("`setEditable(false)` around any mutation that can fail mid-typing") is violated by construction here.
- **Suggested fix:** Read `possiblyCommitted` from the mapped result; on true, expose it via `handleSave`'s return shape (or a callback) so EditorPage can call `applyReloadFailedLock(message)` — same pattern `handleStatusChange` already uses at lines 849-866.
- **Confidence:** High
- **Found by:** Logic, Contract & Integration (×2 separate findings — converged on same root cause)

## Important Issues

### [I1] SnapshotPanel `api.snapshots.create` / `delete` not given AbortSignal
- **File:** `packages/client/src/components/SnapshotPanel.tsx:281, 299`
- **Bug:** Both API methods accept `signal?: AbortSignal` (`api/client.ts:438, 450`). SnapshotPanel doesn't pass one. On chapter switch / unmount during the in-flight request, `setCreateError` / `setDeleteError` (and a follow-up `fetchSnapshots`) fire on a torn-down panel or land on a different chapter's panel.
- **Impact:** Stale error banner can display on the wrong chapter; React no-op warnings in test/dev mode (violates CLAUDE.md's zero-warnings rule).
- **Suggested fix:** Add an AbortController per call (or per panel mount), abort on unmount and on chapter change. Mirror the `refreshCountAbortRef` pattern in `useSnapshotState.ts:412-414`.
- **Confidence:** High
- **Found by:** Error Handling

### [I2] Mutation scopes lack `network:` arm — offline users get generic copy
- **File:** `packages/client/src/errors/scopes.ts:111-126, 168-225, 285-288`
- **Bug:** `chapter.updateStatus`, `chapter.delete`, `chapter.rename`, `chapter.reorder`, `snapshot.create`, `snapshot.delete`, `settings.update`, `image.delete`, `image.updateMetadata` all declare `committed:` but no `network:`. `mapApiError` falls through to `scope.fallback` for NETWORK errors (`apiErrorMapper.ts:96`).
- **Impact:** User offline sees "Failed to change status" / "Failed to delete chapter" instead of "check your connection" — invites a useless retry rather than informing them of the actual cause. GET scopes consistently provide a `network:` arm; mutations were missed.
- **Suggested fix:** Add `network: STRINGS.error.<...>Network` to each mutation scope. Several network strings already exist in `strings.ts` (e.g. `STRINGS.projectSettings.saveNetworkError`).
- **Confidence:** High
- **Found by:** Error Handling, Contract & Integration (converged)

### [I3] snapshot.view three-hop error translator drops mapper message and re-translates `reason` → STRINGS in panel
- **File:** `packages/client/src/pages/EditorPage.tsx:1989-2024` + `packages/client/src/components/SnapshotPanel.tsx:498-522`
- **Bug:** EditorPage's `onView` translator calls `mapApiError`, throws `message` away, returns `{ ok: false, reason }`. SnapshotPanel then maps `reason` to its own STRINGS lookup (`viewFailedNotFound`, `viewFailedCorrupt`, `viewFailedNetwork`, `viewFailed`). Two independent translation tables for the same error set.
- **Impact:** Drift risk by construction. The translator already had to mirror byCode-vs-byStatus precedence by hand (lines 2009-2017). Any new snapshot.view error code requires touching two files instead of one. Comment lines 2000-2008 acknowledge this and defer to "Phase 4b.4".
- **Suggested fix:** Pass the mapped `MappedError` (or just the `message` string) into the panel's `onView` callback's `{ ok: false, ... }` shape. Drop the panel's STRINGS ladder. The panel's `reason` enum can collapse to a discriminator on `mapped.transient` if needed.
- **Confidence:** High
- **Found by:** Contract & Integration, Error Handling (converged)

### [I4] `useTrashManager.handleRestore` possiblyCommitted branch removes from trash list but does NOT add restored chapter to project
- **File:** `packages/client/src/hooks/useTrashManager.ts:67-69`
- **Bug:** On `possiblyCommitted` (2xx BAD_JSON or 500 RESTORE_READ_FAILURE), the chapter is removed from the trash list (line 68) but `setProject` is not called to insert it into `prev.chapters`. The happy-path branch at lines 36-47 adds the restored row; the recovery path doesn't.
- **Impact:** Chapter vanishes from trash but doesn't appear in the sidebar until manual refresh. The committed banner directs the user to refresh, so it's recoverable, but the partial-state UI is misleading.
- **Suggested fix:** On possiblyCommitted, refetch the project (mirrors `handleCreateChapter`'s recovery at lines 466-489). Acceptable alternative: leave the chapter in the trash list and accept the 409 risk on retry.
- **Confidence:** Medium
- **Found by:** Logic & Correctness

### [I5] `useTrashManager.openTrash` / `handleRestore` lack AbortController/unmount guards
- **File:** `packages/client/src/hooks/useTrashManager.ts:18-29, 31-72`
- **Bug:** Both functions issue server calls without a signal and without a token check. `setActionError` / `setTrashedChapters` / `setProject` / `navigate` can fire on a torn-down hook.
- **Impact:** `handleRestore` is the worst — if the user starts a restore, navigates to a different project mid-flight, the response lands and the `navigate(\`/projects/${restored.project_slug}\`)` at line 50 forces them back to the old project. Surprising and disruptive.
- **Suggested fix:** Add an AbortController scoped to the hook, abort on unmount, gate all setState on `!signal.aborted`. `api.projects.trash` and `api.chapters.restore` need to accept a signal first.
- **Confidence:** Medium-High
- **Found by:** Contract & Integration, Concurrency (converged)

### [I6] Editor `onUpdate` / image-paste handler do not gate on `editor.isEditable`
- **File:** `packages/client/src/components/Editor.tsx:205-209, 257-272, 300-303`
- **Bug:** `onBlur` correctly gates on `editor.isEditable` (line 219, the C2 fix). `onUpdate` does not. `insertImage` (line 300) and the image-paste plugin's upload handler (line 257) chain `setImage` with no `isEditable` check.
- **Impact:** During a snapshot restore / project-wide replace lock window, an image paste/insert dispatches `onUpdate`, marks dirty, schedules a debounced save that races the mutation — the exact race CLAUDE.md invariant #2 is meant to prevent.
- **Suggested fix:** Gate `onUpdate` on `editor.isEditable` (skip `debouncedSave`); gate the image-upload `setImage` chain on `editor.isEditable && !editor.isDestroyed`.
- **Confidence:** Medium
- **Found by:** Logic & Correctness

### [I7] Editor paste-image upload silently succeeds with no feedback when editor is destroyed mid-upload
- **File:** `packages/client/src/components/Editor.tsx:257-272`
- **Bug:** Image upload is fire-and-forget. When the chapter switches mid-upload, `editor.isDestroyed` is true on resolve, so the `setImage` chain is skipped — and there is also no `onImageAnnouncementRef` call. The image was uploaded server-side, never inserted, never announced, gallery never refreshed.
- **Impact:** Orphan uploads accumulate; user thinks the paste failed and may retry, double-uploading.
- **Suggested fix:** When `editor.isDestroyed`, still announce success ("uploaded to gallery") and trigger a gallery refresh. Keep the no-op for the editor itself.
- **Confidence:** Medium
- **Found by:** Error Handling

### [I8] Hardcoded `STRINGS.editor.saveFailed` in Ctrl+S flushSave catch instead of `mapApiError`
- **File:** `packages/client/src/pages/EditorPage.tsx:1530-1535`
- **Bug:** The Ctrl+S handler's `flushSave` catch sets `setActionError(STRINGS.editor.saveFailed)` directly, bypassing `mapApiError(err, "chapter.save")`. CLAUDE.md says raw error mapping must route through the unified mapper (the future ESLint rule will enforce this).
- **Impact:** A 2xx BAD_JSON / UPDATE_READ_FAILURE landing via Ctrl+S surfaces "Save failed" instead of the chapter.save scope's `committed` arm copy — user told to retry when the save committed.
- **Suggested fix:** Replace with `const { message } = mapApiError(err, "chapter.save"); if (message) setActionError(message);`.
- **Confidence:** Medium
- **Found by:** Contract & Integration

### [I9] `useSnapshotState.restoreSnapshot` follow-up `api.snapshots.list` is unaborted and silently swallowed
- **File:** `packages/client/src/hooks/useSnapshotState.ts:370-376`
- **Bug:** Post-restore count refresh has no AbortSignal and `.catch(() => {})`. The `freshToken.isStale()` check on line 373 prevents stale state writes, but a transient failure means the snapshot count badge stays one-behind until the next refresh.
- **Impact:** Toolbar count badge can display the wrong number until the next chapter switch / panel-open refresh.
- **Suggested fix:** Reuse the existing `refreshCount` helper (lines 407-421) which already has the AbortController plumbing — or wire a controller through directly.
- **Confidence:** Medium
- **Found by:** Error Handling, Concurrency (converged)

### [I10] `useTimezoneDetection` bare `catch {}` deviates from plan §4.7 — no `mapApiError`, no logging
- **File:** `packages/client/src/hooks/useTimezoneDetection.ts:18-31`
- **Bug:** Plan §4.7 said: "call mapApiError, log for diagnostics, but do not surface to UI." Actual code has bare `try { ... } catch {}` with neither mapper nor log. Programming bugs (e.g. a `TypeError` inside the inner try) are silently dropped.
- **Impact:** Lost diagnostic surface for first-launch timezone-detection failures; only call site that didn't carry out the literal plan instruction.
- **Suggested fix:** Replace bare catches with `catch (err) { mapApiError(err, "settings.update"); console.warn("Timezone detection failed:", err); }`.
- **Confidence:** Medium
- **Found by:** Error Handling, Plan Alignment (converged)

## Suggestions

- **[S1]** `apiErrorMapper.test.ts:281-305` — I4 BAD_JSON parameterized test omits 7 mutation scopes that declare `committed:` (chapter.create, chapter.reorder, chapter.updateStatus, project.updateTitle, project.updateFields, findReplace.replace, snapshot.restore). Either enumerate explicitly or compute dynamically by iterating `SCOPES`.
- **[S2]** `apiErrorMapper.ts:79-93` — Document the BAD_JSON-2xx-precedes-byCode precedence in the function comment (matches the S8 comment style at line 101-108) so future scope authors don't try to override BAD_JSON via byCode.
- **[S3]** `apiErrorMapper.ts:88-99, 134-148` — Inconsistent `extras` propagation: byCode/byStatus/fallback arms call `extrasFrom?.()`, BAD_JSON and NETWORK arms do not. Latent today (only `image.delete` uses extras, in byCode). Either uniform-call or document the per-arm omission.
- **[S4]** `client.ts:91-102` — `extractExtras` MAX_EXTRAS_KEYS=16 cap is positional in insertion order; a hostile/buggy server payload with 16+ junk keys before `chapters` silently drops the field. Prefer a known-key allowlist or sort keys before slicing.
- **[S5]** `client.ts:91-102` — `extractExtras` doesn't deep-strip `__proto__`/`constructor` from nested values. Defense-in-depth gap; no current consumer walks nested values.
- **[S6]** `scopes.ts:177-189` + `ImageGallery.tsx:241-252` — `image.delete` extras validator narrows to `{title, trashed?}` but server payload also has `id`. Tighten the validator or widen the type to match the wire contract.
- **[S7]** `Editor.tsx:56-99, 234-236` — Module-level `activeEditorId` and `imageUploadHandlers` Map cause cross-talk between concurrent Editor instances (StrictMode dev double-mount, parallel tests). Move to React context.
- **[S8]** `EditorPage.tsx:1171-1198` — Chapter-statuses fetch effect uses `let cancelled = false` instead of AbortController, inconsistent with HomePage / DashboardView pattern adopted in this branch.
- **[S9]** `useProjectEditor.ts:292, 306` — `rejected4xx = { message: message as string, code: err.code };` cast assumes ABORTED is the only null-message path. Replace with `message ?? STRINGS.editor.saveFailed`.
- **[S10]** `client.ts:42-51` — `ApiRequestError.code` is optional; add JSDoc enumerating the synthetic codes (`ABORTED`, `NETWORK`, `BAD_JSON`) plus a pointer to the server's error envelope catalog.
- **[S11]** `scopes.ts` — Inconsistent committed copy: some scopes use scope-specific committed strings (e.g. `saveCommittedUnreadable`), most use generic `STRINGS.error.possiblyCommitted`. Either move all to specific copy or document the criterion in scopes.ts.
- **[S12]** `scopes.ts:226-240` — `findReplace.search` scope handles 404 byStatus but not `SCOPE_NOT_FOUND` byCode (replace does, line 250). Latent — search has no chapter scope today.
- **[S13]** `useSnapshotState.ts:315-317` — Re-implements the `BAD_JSON 2xx` predicate already in the mapper. Extract a `is2xxBadJson(err)` helper in `errors/` so both sites read the same predicate.
- **[S14]** CLAUDE.md says ESLint enforcement comes in "Phase 4b.4" but roadmap's 4b.4 is the unrelated Raw-Strings rule. Either add a new roadmap phase for the mapper ESLint rule and update CLAUDE.md, or fold the mapper rule into 4b.4's scope and update its description.
- **[S15]** `useTimezoneDetection.ts:11-17` — Comment acknowledges the ProjectSettingsDialog timezone-save race remains open. Document explicitly as known-deferred in the roadmap or close it by threading a shared abort signal.

## Plan Alignment

Plan/design docs at `docs/plans/2026-04-23-unified-error-mapper-{design,plan}.md` consulted.

- **Implemented:** All 29 originally-planned scopes (plus 4 added during migration: `projectList.load`, `project.updateFields`, `image.list`, `image.references`). `MappedError` shape matches plan. Resolver precedence ABORTED → BAD_JSON(2xx) → NETWORK → byCode → byStatus → fallback matches plan. CLAUDE.md "Unified API error mapping" section added per plan §9a. The deleted `findReplaceErrors.ts` is gone. Migrations cover ~30 catch sites across hooks/components/pages. New `apiErrorMapper.test.ts` (765 lines) and `types.test.ts` (55 lines) cover the contract.
- **Not yet implemented (neutral):** Phase 4b.4 ESLint enforcement (called out as deferred in CLAUDE.md). Roadmap entry for Phase 4b.3 remains "In Progress" pending merge.
- **Deviations from plan:**
  - `ScopeEntry.committedCodes` field added (not in plan) — used by chapter.save, chapter.create, trash.restoreChapter so call sites don't need inline `possiblyCommitted || err.code === "X"` ladders. Sensible review-driven extension.
  - `possiblyCommitted` semantics on BAD_JSON tightened — gated on `scope.committed !== undefined` rather than unconditional (S7 review revision). Prevents misleading "possibly committed" on GET-only scopes.
  - Prototype-pollution + DoS hardening added (`__proto__/constructor/prototype` skip, `MAX_EXTRAS_KEYS=16`, `Object.create(null)`, `Object.hasOwn`) — superset of plan, all deliberate review hardening.
  - `isApiError`/`isAborted`/`isNotFound`/`isClientError` helpers added — implements plan's "no `instanceof ApiRequestError` at call sites" DoD that the plan didn't pre-name.
  - **`useTimezoneDetection.ts` does NOT call `mapApiError`** — only place plan's literal instruction was dropped (see [I10]).

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment (6 specialists in parallel)
- **Scope:** 59 changed files + adjacent code (~80 files inspected). Verifier read each cited file:line independently.
- **Raw findings:** 60 (across 6 specialists, with overlap)
- **Verified findings:** 26 (1 Critical + 10 Important + 15 Suggestions)
- **Filtered out:** 12 false positives or below-60% post-verification
- **Steering files consulted:** /Users/ovid/projects/smudge/CLAUDE.md (especially "Save-pipeline invariants" and "Unified API error mapping" sections — flagged 1 contradiction at [I8])
- **Plan/design docs consulted:** `docs/plans/2026-04-23-unified-error-mapper-design.md`, `docs/plans/2026-04-23-unified-error-mapper-plan.md`, `docs/roadmap.md`, `docs/TODO.md`
