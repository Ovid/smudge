# Agentic Code Review: ovid/architecture

**Date:** 2026-04-21 11:41:52
**Branch:** ovid/architecture -> main
**Commit:** d9df3d69df59ce9504ad3f8cbce1d06e10917cf8
**Files changed:** 47 | **Lines changed:** +9,459 / -371
**Diff size category:** Large

## Executive Summary

The branch introduces `useEditorMutation` as the central orchestration hook for server-mutating editor flows (snapshot restore, project-wide replace, replace-one), plus a wave of lock-banner / busy-gating hardening across the editor surface. Save-pipeline invariants 1–4 are correctly enforced inside the hook, but the surrounding call sites and several pre-existing flows have divergent discipline that produces three **critical** data-loss paths and several **important** UX issues. Confidence in the core hook is high; confidence in the surrounding hardening is medium — the migrated paths are solid, but pre-existing handlers (`handleCreateChapter`, `handleReorderChapters`, `saveProjectTitle`, the panel-toggle escape) have gaps that the hook doesn't cover.

## Critical Issues

### [C1] Ctrl+. / Ctrl+H during a `possibly_committed` restore lock banner bypasses the editor read-only state and silently reverts the restore
- **File:** `packages/client/src/pages/EditorPage.tsx:258-282`
- **Bug:** `handleToggleReferencePanel` and `handleToggleFindReplace` call `exitSnapshotView()` unconditionally, without checking `editorLockedMessageRef.current`. `restoreSnapshot` only nulls `viewingSnapshot` on the success path (`useSnapshotState.ts:276`), so after a `possibly_committed` / `unknown` restore the snapshot view stays up under the lock banner. Pressing Ctrl+. or Ctrl+H exits the snapshot view, React mounts the live `<Editor>` which defaults to `editable=true` (`components/Editor.tsx:195-203`), and user keystrokes land in `handleContentChange` which writes to `useContentCache` (`useProjectEditor.ts:316-326`). `handleSaveLockGated` blocks the PATCH, but `getCachedContent` overrides server content on next load (`useProjectEditor.ts:153-154`).
- **Impact:** After the user follows the banner's instructions and refreshes, the cached typed-over content re-hydrates and the next auto-save PATCHes it, silently reverting the server-committed restore. This is the exact data-loss path invariants 1–3 and the lock banner exist to prevent.
- **Suggested fix:** Gate both toggle handlers on `editorLockedMessageRef.current !== null` (surface `STRINGS.editor.lockedRefusal`); do NOT call `exitSnapshotView()` while the lock is active. Alternately, have `possibly_committed` / `unknown` restore branches call `exitSnapshotView()` themselves so the lock banner is rendered over the live editor (which is `setEditable(false)`).
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases

### [C2] `handleCreateChapter` / `handleReorderChapters` merge Project A's server response into Project B's React state when the user navigates mid-POST
- **File:** `packages/client/src/hooks/useProjectEditor.ts:328-357` (`handleCreateChapter`), `:538-557` (`handleReorderChapters`)
- **Bug:** Both handlers capture `slug = projectSlugRef.current` at entry and fire a POST/PUT that may take 50–500ms. The prev-slug sentinel at `:54-60` rewrites `projectSlugRef.current` synchronously during render when the URL slug changes, but there is NO sequence guard between the await and the response handler — `setActiveChapter(newChapter)` / `setProject((prev) => ...)` run unconditionally. When the response lands, `prev` is Project B's state and the new chapter from Project A is merged into Project B's `chapters` array.
- **Impact:** A phantom chapter (belonging to Project A) appears in Project B's sidebar; subsequent edits PATCH the wrong project's chapter id. Refresh heals the sidebar, but until refresh the user can edit a chapter that belongs elsewhere. `handleReorderChapters` writes a reordered list from Project A's chapter ids into Project B's project state — the result is a mix of ids that will fail server reconciliation.
- **Suggested fix:** Introduce a `projectSlugSeqRef` (or reuse the pattern in `cancelInFlightSelect`) that bumps on slug change, capture the seq at entry, and check `seq !== projectSlugSeqRef.current` before each `setProject` / `setActiveChapter`. Or simpler: compare the captured `slug` with `projectSlugRef.current` at response time and discard stale responses.
- **Confidence:** High
- **Found by:** Concurrency & State

### [C3] `saveProjectTitle` PATCHes the new project with the old project's intended title when blur fires during navigation
- **File:** `packages/client/src/hooks/useProjectTitleEditing.ts:57-90`, interacting with `packages/client/src/hooks/useProjectEditor.ts:54-60`, `:559-578`
- **Bug:** When the URL slug changes, `useProjectEditor`'s prev-slug sentinel writes `projectSlugRef.current = newSlug` synchronously during render — BEFORE `project` state has been reloaded. During this window `isActionBusy()` is false, `isEditorLocked()` is false, and `project?.title` still reflects Project A. A blur on Project A's title input fires `saveProjectTitle`, which computes `trimmed !== project.title` (true), and calls `handleUpdateProjectTitle(trimmed)`. Inside, `slug = projectSlugRef.current` — now Project B's slug. The PATCH targets Project B with Project A's intended title.
- **Impact:** Silent cross-project title overwrite. Project B's title is replaced with what the user typed for Project A; Project A's rename intent is lost. The effect at `useProjectTitleEditing.ts:39-46` that cancels edit on `project.id` change fires AFTER state has reloaded — too late.
- **Suggested fix:** At `startEditingProjectTitle`, capture `editingProjectIdRef.current = project.id`; in `saveProjectTitle`, refuse when `editingProjectIdRef.current !== project?.id`. Or: refuse when `prevProjectIdRef.current !== project?.id` synchronously at the entry check.
- **Confidence:** High
- **Found by:** Concurrency & State

## Important Issues

### [I1] Replace BAD_JSON path pins the editor-lock banner to whatever chapter is active at response time, even when the user switched chapters during flush
- **File:** `packages/client/src/pages/EditorPage.tsx:749-800` (`executeReplace`), `:994-1010` (`handleReplaceOne`), routed through `finalizeReplaceSuccess` at `:577-632`
- **Bug:** `handleRestoreSnapshot`'s sibling `possibly_committed` branch (`:439-482`) and `unknown` branch (`:519-533`) check `getActiveChapter()?.id !== activeChapter.id` and surface `setActionError(STRINGS.snapshots.restoreResponseUnreadable)` (dismissible) when the active chapter drifted. The replace paths do NOT — `finalizeReplaceSuccess` unconditionally calls `setEditorLockedMessage(...)` and `safeSetEditable(editorRef, false)` at `:602-614`, pinning a persistent banner to an untouched chapter. Compounding: the useEffect at `EditorPage.tsx:1096-1098` clears `editorLockedMessage` on active-chapter change, so the banner is silently dismissed on the next chapter switch even though the mutation wants it to be non-dismissible.
- **Impact:** Misattributed "refresh the page" banner. User sees a warning on content that doesn't need refreshing and loses the signal on content that may need refreshing.
- **Suggested fix:** Thread the replace target chapter id into `finalizeReplaceSuccess` and do the stale-chapter check there, mirroring restore's branch. For project-scope replace (multi-chapter), compare against the chapter id captured at dispatch; if the user left it, prefer a dismissible `setActionError` over the persistent lock.
- **Confidence:** High
- **Found by:** Logic & Correctness, Contract & Integration (dedup across 2 specialists)

### [I2] `useFindReplaceState` project-change reset leaves `loading=true` stuck
- **File:** `packages/client/src/hooks/useFindReplaceState.ts:86-104`, with in-flight finally at `:209-217`
- **Bug:** Project-change reset bumps `searchSeqRef` at line 97 and aborts the controller; no `setLoading(false)` is called. The in-flight search's finally at `:210` only clears `loading` when `seq === searchSeqRef.current` — which fails after the bump. `closePanel` at `:124` does call `setLoading(false)`, so the bug only manifests when the user navigates to a different project without closing the panel.
- **Impact:** Stuck "Searching…" spinner on the new project's panel with no recovery except close-and-reopen.
- **Suggested fix:** Add `setLoading(false)` to the project-change reset block (and the unmount cleanup at `:79-84` for symmetry).
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases

### [I3] `useEditorMutation` second reload after `superseded` omits `expectedChapterId`, letting a failed fetch raise a lock banner on an untouched chapter
- **File:** `packages/client/src/hooks/useEditorMutation.ts:304-327` (second reload at `:306`)
- **Bug:** The first reload at `:262-265` passes `directive.reloadChapterId`, so a concurrent chapter switch returns `"superseded"` instead of `"failed"`. The supersession-retry at `:306` calls `reloadActiveChapter(() => {})` WITHOUT `expectedChapterId`. If the user switches chapters again during the retry's fetch and the fetch fails, `reloadActiveChapter` returns `"failed"` against a now-third chapter; the hook sets `reloadFailed=true`, returns `stage:"reload"`, and the caller raises a persistent lock banner on a chapter the mutation never targeted.
- **Impact:** On a double-chapter-switch + network-blip path, the lock banner pins to the wrong chapter, inducing a refresh that wipes unrelated local draft state.
- **Suggested fix:** Capture `currentId` at line 304 and pass it as `expectedChapterId` to the second reload at line 306.
- **Confidence:** Medium
- **Found by:** Logic & Correctness, Concurrency & State (dedup across 2 specialists)

### [I4] `handleCreateChapter` / `handleReorderChapters` failures trigger the full-page error overlay
- **File:** `packages/client/src/hooks/useProjectEditor.ts:353-356`, `:553-556`
- **Bug:** Both catches call `setError(STRINGS.error.*)`. Per `EditorPage.tsx:1423-1441`, `error` state produces a full-screen overlay with only a "back to projects" link. A 400 on `PUT /chapters/order` with a mismatched ID list (CLAUDE.md calls this out as recoverable) tears down the editor view and loses in-progress work visibility. Contrast: `handleStatusChange`, `handleRenameChapter`, `handleDeleteChapter` all accept an `onError` callback and route to non-fatal banners.
- **Impact:** Overreaction on recoverable client errors; destroys the editor session.
- **Suggested fix:** Adopt the `onError` callback pattern used by the other mutators and route to `setActionError`.
- **Confidence:** Medium
- **Found by:** Error Handling & Edge Cases

### [I5] Mid-remount re-lock bail with `directive.reloadActiveChapter: false` returns `ok:true` with cache cleared and editor writable
- **File:** `packages/client/src/hooks/useEditorMutation.ts:189-251` (catch block and ok:true return at `:241-243`)
- **Bug:** When `editorAfterMutate.setEditable(false)` throws at line 191 and the directive says `reloadActiveChapter: false`, the hook returns `{ ok: true, data }` at line 242 after having cleared `directive.clearCacheFor` at line 223. The new editor is writable; its displayed content may be stale (pre-mutation) if the remount was driven by a chapter switch onto a chapter that was in `clearCacheFor`. Caller sees ok:true, raises no lock banner, `handleSaveLockGated` does not short-circuit, and keystrokes PATCH stale content over the server-committed mutation.
- **Impact:** Narrow silent-reversal window (requires setEditable throw AND active chapter in clearCacheFor).
- **Suggested fix:** Before returning ok:true on the re-lock-throw path, read `projectEditorRef.current.getActiveChapter()?.id`; if it's in `directive.clearCacheFor`, escalate to `stage:"reload"` (set `reloadFailed = true`) rather than ok.
- **Confidence:** Medium
- **Found by:** Concurrency & State

### [I6] `viewSnapshot` returns `{ ok: true, staleChapterSwitch: true }` but the panel's `!res.ok` gate ignores it — silent dead click
- **File:** `packages/client/src/hooks/useSnapshotState.ts:176, 208, 213` and `packages/client/src/components/SnapshotPanel.tsx:451`
- **Bug:** On a chapter-switch race (or ABORTED), `viewSnapshot` returns `ok:true` with `staleChapterSwitch:true`. `SnapshotPanel` gates on `if (res && "ok" in res && !res.ok)` — the stale-switch case falls through with no branch: no view opens, no error, no feedback. User clicked View and nothing happened.
- **Impact:** Dead-click UX. User may click View repeatedly without understanding why nothing happens.
- **Suggested fix:** Surface a brief info banner ("Snapshot belongs to a previous chapter — select it to view") or add an explicit `staleChapterSwitch` branch in `SnapshotPanel`.
- **Confidence:** Medium
- **Found by:** Error Handling & Edge Cases

## Suggestions

- **Duplicated 2xx BAD_JSON classification at 5 sites** (`EditorPage.tsx:749-754`, `:994-998`, `utils/findReplaceErrors.ts:26`, `useSnapshotState.ts:223`, `useSnapshotState.ts:308`) — extract `is2xxBadJson(err)` into `api/client.ts` where `ApiRequestError` lives. Reported by Contract & Integration. Confidence 85.
- **`isEditorLocked` helper bypassed by 13 inline `editorLockedMessageRef.current !== null` checks** across `EditorPage.tsx`. Reported by Contract & Integration. Confidence 75.
- **Duplicated `isActionBusy() || isEditorLocked()` busy-guard at 20+ entry points** in `EditorPage.tsx` — consider a `refuseIfBlocked()` helper. Reported by Contract & Integration. Confidence 70.
- **`handleRestoreSnapshot` bookkeeping duplicates `finalizeReplaceSuccess` across three branches** (`EditorPage.tsx:399-427, :455-482, :526-552`) — extract a `finalizeRestoreLock` helper. Reported by Contract & Integration (both agents). Confidence 80.
- **`useEditorMutation` open-codes three setEditable try/catch blocks while `safeSetEditable` exists** for the same pattern (`useEditorMutation.ts:140-144, :190-200, :386-397`). Reported by Contract & Integration. Confidence 85.
- **`RestoreFailureReason` / `ViewFailureReason` consumers use else-branch fallback for `"unknown"` rather than exhaustive switch** — future reason additions slip past the type check (`EditorPage.tsx:513`, `SnapshotPanel.tsx:472`). Reported by Contract & Integration. Confidence 70.
- **`handleStatusChange` revert uses stale optimistic `previousStatus` when the server-reload revert also fails** (`useProjectEditor.ts:584, :640`). Narrow window; no data corruption. Reported by Error Handling. Confidence 60.
- **`handleStatusChange`'s inner `catch {}` on revert-reload loses 404 specificity** (`useProjectEditor.ts:632-634`). Reported by Error Handling. Confidence 60.
- **`INVALID_REGEX` mapping only matches inside `err.status === 400` branch** (`findReplaceErrors.ts:29-35`). Defensive-only today. Confidence 55.
- **`restoreSnapshot` list-refresh silently catches, leaving `snapshotCount` understated by one until panel refresh** (`useSnapshotState.ts:282-289`). Confidence 60.
- **`mapReplaceErrorToMessage` has no 409 branch** (`findReplaceErrors.ts:11-69`). Defensive-only today. Confidence 60.
- **Three hand-composed flushSave+setEditable sequences** (`switchToView`, `SnapshotPanel.onView`, `SnapshotPanel.onBeforeCreate`) duplicate the invariant-1-and-2 preamble — could share a `prepareEditorForReadOnly` helper. Reported by Contract & Integration (both agents). Confidence 60.
- **`onView` return type is `{ ok: boolean; reason?: string }` (weakly typed) while the panel branches on a closed set of literal strings** (`SnapshotPanel.tsx:41, :451-474`). Reported by Contract & Integration. Confidence 65.

## Plan Alignment

Design and plan documents: `docs/plans/2026-04-19-editor-orchestration-helper-design.md`, `docs/plans/2026-04-19-editor-orchestration-helper-plan.md`. Roadmap phase: 4b.1.

### Implemented
- Core `useEditorMutation` hook (`useEditorMutation.ts`, 407 lines) — matches design API: `MutationStage`, `MutationDirective`, `MutationResult`, `UseEditorMutationArgs`, `UseEditorMutationReturn`, `isBusy()`, discriminated `{ok:true} | {ok:false, stage}` result.
- Discriminated `MutationDirective` forces `reloadChapterId` whenever `reloadActiveChapter: true` (stronger than the plan's optional form).
- Latest-ref pattern for `projectEditor` + `isLocked` assigned during render, correctly avoiding useEffect-commit window staleness.
- Hook unit tests (`useEditorMutation.test.tsx`, 1,156 lines).
- Migrated three call sites: `handleRestoreSnapshot`, `executeReplace`, `handleReplaceOne` (all in `EditorPage.tsx`).
- `replaceInFlightRef` removed (plan Task 16 Check 3 satisfied).
- CLAUDE.md updated with the mutation-flow pointer.
- Roadmap Phase 4b.1 flipped to In Progress.

### Not yet implemented
- Task 14 (jsdom unmount-clobber test) — deferred to e2e per plan (lines 1135-1148). Intentional.
- Phase 4b.2 / 4b.3 / 4b.4 — out of scope. Honored.
- Phase 4b.5 "Editor State Machine" — added to roadmap in this branch but not implemented. Correct.

### Deviations
- **`safeSetEditable` + `utils/editorSafeOps.ts` is not in either plan document.** Added as defense-in-depth for TipTap mid-remount throws. Reasonable but undocumented scope growth.
- **`useProjectEditor.ts` changed 334 lines** (plan Task 16 Check 5 explicitly required "no material changes in `useProjectEditor.ts`"). The branch adds `ReloadOutcome = "reloaded" | "superseded" | "failed"`, changes `reloadActiveChapter`'s return from `Promise<boolean>` to `Promise<ReloadOutcome>`, and adds `cancelInFlightSave`. Load-bearing for the hook, but contradicts the plan's hands-off commitment.
- **~100+ `fix(client): …` commits tagged with C/I/S issue codes** — the 16-round-review anti-pattern that motivated Phase 4b.1 recurred within Phase 4b.1. At least 8 PAAD-review cycles are interleaved in the commit log.
- **Lock-banner / busy-gating plumbing added to chapter CRUD, title editing, snapshot viewing, image insertion, Ctrl+S, panel toggles** — not in either plan document. Looks like partial-by-hand implementation of what Phase 4b.5 ("Editor State Machine") formalizes.
- **New UI strings in `strings.ts`** (`mutationBusy`, `lockedRefusal`, `refreshButton`, `actionsUnavailableWhileLocked`, `restoreResponseUnreadable`, `restoreNetworkFailed`, `viewFailedNetwork`, `saveFailedInvalid`, `saveFailedTooLarge`) — error-mapping work the plan labels "Phase 4b.3 territory" (plan line 1292).
- **`EditorPageFeatures.test.tsx` was modified (+1,402 lines)** — design deliverable 5 required "the existing `EditorPageFeatures.test.tsx` suite unmodified and passing." At least the I4 refusal commits introduce new user-visible refusal behavior and assert it.

### PR-scope concerns
Per CLAUDE.md §"Pull Request Scope" (one-feature rule, phase-boundary rule): this branch delivers the hook + three migrations (in scope) AND `safeSetEditable` + `useProjectEditor` tri-state reshape + editor-lock gating + title-editing gating + SnapshotBanner a11y props + new strings (out of scope for Phase 4b.1). The branch is more honestly described as "Phase 4b.1 plus editor-lock hardening pass." Consider either splitting the lock-hardening into a preparatory PR or updating the Phase 4b.1 scope in `docs/roadmap.md` and the design doc to explicitly include it.

## Review Metadata

- **Agents dispatched:** Logic & Correctness (×2), Error Handling & Edge Cases (×2), Contract & Integration (×2), Concurrency & State, Security, Plan Alignment
- **Scope:** `packages/client/src/hooks/useEditorMutation.ts` (new), `useProjectEditor.ts`, `useChapterTitleEditing.ts`, `useProjectTitleEditing.ts`, `useSnapshotState.ts`, `useFindReplaceState.ts`, `pages/EditorPage.tsx`, `components/SnapshotBanner.tsx`, `components/SnapshotPanel.tsx`, `utils/editorSafeOps.ts` (new), `utils/findReplaceErrors.ts`, `strings.ts`; one level of caller/callee tracing.
- **Raw findings:** 45+ across specialists (significant overlap)
- **Verified findings:** 14 submitted to verifier; 3 Critical, 6 Important, 12 Suggestions (some dedup)
- **Filtered out:** ~30 specialist observations below 60% confidence or retracted on re-read
- **Steering files consulted:** `CLAUDE.md` (project conventions, save-pipeline invariants §"Save-pipeline invariants", pull-request-scope rules §"Pull Request Scope")
- **Plan/design docs consulted:** `docs/plans/2026-04-19-editor-orchestration-helper-design.md`, `docs/plans/2026-04-19-editor-orchestration-helper-plan.md`, `docs/roadmap.md`

### Security lens summary
Clean. No XSS, prototype pollution, ReDoS, or injection issues. `dangerouslySetInnerHTML` use at `EditorPage.tsx:1680` is fed through `DOMPurify.sanitize`; regex compilation is server-side only; JSON.parse of snapshot content flows only into the sanitized-HTML sink; no new `eval`/`Function`/`setTimeout(string)`. One sub-threshold observation: `api/client.ts` does not `encodeURIComponent` interpolated slugs/IDs — low exploitability given slugs are server-generated, but worth tracking if user-chosen slugs land in the future.
