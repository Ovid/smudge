# Agentic Code Review: ovid/architecture

**Date:** 2026-04-20 08:33:55
**Branch:** ovid/architecture -> main
**Commit:** 944ba6d734e3d13c0a8a58ee91efce62bfd1e15c
**Files changed:** 22 | **Lines changed:** +4105 / -338 (production code: +1923 / -334)
**Diff size category:** Large

## Executive Summary

This branch introduces the `useEditorMutation` hook that centralizes the save-pipeline invariants for snapshot-restore and find-and-replace flows. The refactor succeeds at its core goal — the hook's happy path is disciplined — but 12 findings remain, clustered around two gaps: (1) the hook's `isBusy()` guard is applied only to some external flush-composing call sites, leaving sidebar create/delete and panel toggles as race-prone bypasses; (2) the "server committed but client can't confirm" scenario (BAD_JSON on 2xx, or `expectedChapterId` skip) re-enables the editor without locking it, letting auto-save overwrite committed mutations. Three Critical data-loss paths; six Important UX/consistency issues; three Suggestions.

## Critical Issues

### [C1] Stale `expectedChapterId` skip re-enables editor with stale lock banner visible
- **File:** `packages/client/src/hooks/useEditorMutation.ts:148-161` + `packages/client/src/hooks/useProjectEditor.ts:364-366` + `packages/client/src/pages/EditorPage.tsx:659-661`
- **Bug:** When `reloadActiveChapter` skips because the user switched chapters (`current.id !== expectedChapterId`), it returns `true`. The hook sets `reloadSucceeded = true`, and the finally treats the lock as superseded — calls `setEditable(true)`. But the skip path bumps neither `activeChapter.id` nor `chapterReloadKey`, so the `useEffect` that clears `editorLockedMessage` (EditorPage.tsx:659-661) never fires. Banner stays on screen, editor becomes editable.
- **Impact:** Silent data loss. User trusts the persistent "refresh the page" banner, types or a pending save flushes, auto-save PATCHes pre-mutation content back over the server-committed mutation. This is exactly the scenario invariant #1 (`markClean` before server call) exists to prevent; the I1 banner is supposed to be the user-visible signal of that read-only state.
- **Suggested fix:** Have `reloadActiveChapter` return a tri-state (`"reloaded" | "skipped" | "failed"`) rather than a boolean. Only the `"reloaded"` case should flip `reloadSucceeded` in the hook. Alternatively, bump `chapterReloadKey` on the skip path so the banner-clearing effect runs in lockstep with re-enable.
- **Confidence:** High
- **Found by:** Logic & Correctness

### [C2] BAD_JSON on 2xx replace response leaves editor editable; auto-save overwrites committed change
- **File:** `packages/client/src/pages/EditorPage.tsx:425-427` (executeReplace) + `:577-594` (handleReplaceOne) + `packages/client/src/hooks/useEditorMutation.ts:132-140` + `packages/client/src/utils/findReplaceErrors.ts:22-28`
- **Bug:** `apiFetch` throws `ApiRequestError(status=2xx, code="BAD_JSON")` when a 2xx response body is unparseable. Inside `mutation.run()`'s mutate callback, this routes to `stage: "mutate"`. The finally re-enables the editor because `reloadFailed` and `reloadSucceeded` are both false, and `isLocked()` returns false. `mapReplaceErrorToMessage` correctly surfaces "replace may have completed — refresh to verify" copy, but the banner is advisory only — the editor is editable, and the 1.5s auto-save debounce fires before the user can read and act on the warning.
- **Impact:** Silent overwrite of a server-committed replace (potentially across many chapters). The one scenario the `replaceResponseUnreadable` string was written for is the scenario where the client must lock the editor.
- **Suggested fix:** In the `stage: "mutate"` branches of both `executeReplace` and `handleReplaceOne`, detect `err instanceof ApiRequestError && err.code === "BAD_JSON" && err.status >= 200 && err.status < 300` and call `setEditorLockedMessage(STRINGS.findReplace.replaceSucceededReloadFailed)` — same treatment as `stage: "reload"`.
- **Confidence:** High
- **Found by:** Error Handling

### [C3] BAD_JSON on 2xx snapshot restore misclassified as "network", editor stays editable
- **File:** `packages/client/src/hooks/useSnapshotState.ts:259-273` + `packages/client/src/pages/EditorPage.tsx:296-315`
- **Bug:** `restoreSnapshot`'s catch ladder (CORRUPT_SNAPSHOT / CROSS_PROJECT_IMAGE_REF / 404 / else → "network") has no BAD_JSON branch. A 2xx-with-bad-body response falls through to `reason: "network"` and the UI shows "check your connection". The underlying restore committed server-side, but the user is told they are offline — they retry (creating a spurious second auto-snapshot) or type into an editable editor whose content is stale.
- **Impact:** Same silent-overwrite class as [C2], with the added harm of misdirected recovery guidance. Distinct from [C2] because restore goes through `RestoreFailedError` → `stage: "mutate"`, not `mapReplaceErrorToMessage`, so the fix must live in `useSnapshotState`.
- **Suggested fix:** Add a `BAD_JSON && status >= 200 && status < 300` branch in `restoreSnapshot`'s catch returning `{ ok: false, reason: "possibly_committed" }` (new reason). In `handleRestoreSnapshot` route that reason through `setEditorLockedMessage(...)` with the "succeeded but can't confirm" copy.
- **Confidence:** High
- **Found by:** Error Handling

## Important Issues

### [I1] `switchToView` flushes without `setEditable(false)` — invariant #2 violation
- **File:** `packages/client/src/pages/EditorPage.tsx:708-743`
- **Bug:** Calls `editorRef.current?.flushSave()` directly without disabling the editor first. The sibling `SnapshotPanel.onView` handler (line 1164) and the three `mutation.run()` callers all use `setEditable(false)` before flushing, citing invariant #2. A slow flush (up to ~14s in save backoff) lets the user keep typing during the switch-to-Preview/Dashboard window, and the unmount fires a fire-and-forget PATCH with content they can't see.
- **Impact:** Keystrokes landing on the server during a view switch the user thinks was complete. Violates CLAUDE.md save-pipeline invariant #2.
- **Suggested fix:** Mirror the `onView` pattern: `setEditable(false)` before `await flushSave()`, restore `setEditable(true)` on refusal.
- **Confidence:** High
- **Found by:** Contract & Integration

### [I2] Sidebar create/delete and panel toggles bypass `mutation.isBusy()` guard
- **File:** `packages/client/src/pages/EditorPage.tsx:948` (`onAddChapter={handleCreateChapter}`), `:949` (`onDeleteChapter={setDeleteTarget}`), `:1008` (empty-state create), `:192-216` (panel toggles + `exitSnapshotView`)
- **Bug:** `switchToView`, `SnapshotPanel.onView`, and `SnapshotPanel.onBeforeCreate` correctly check `mutation.isBusy()` before composing their own flushSave sequences. Sidebar actions and panel-toggle handlers do not. Both `handleCreateChapter` and `handleDeleteChapter` call `cancelInFlightSave()`, which aborts the `saveAbortRef` controller currently serving the in-flight mutation's flushSave. Panel toggles that call `exitSnapshotView` can trigger a full Editor remount while the hook still holds the pre-remount `editorRef.current`.
- **Impact:** A sidebar click during a 2–8s replace/restore flush window can corrupt the mutation sequence, and a panel toggle during a mid-mutation snapshot view can leave a freshly-mounted Editor with default `editable=true` while the lock logic is pointed at the old handle.
- **Suggested fix:** Add busy-guard wrappers around `handleCreateChapter`, `onDeleteChapter`, `openTrash`, `handleToggleReferencePanel`, `handleToggleSnapshotPanel`, `handleToggleFindReplace`, and `exitSnapshotView` — each surfacing `STRINGS.editor.mutationBusy` when `mutation.isBusy()` returns true.
- **Confidence:** High
- **Found by:** Contract + Concurrency (duplicate across specialists)

### [I3] `handleCreateChapter` does raw `++saveSeqRef.current` instead of `cancelInFlightSave`
- **File:** `packages/client/src/hooks/useProjectEditor.ts:301`
- **Bug:** Inconsistent with `handleSelectChapter` (line 328) and `handleDeleteChapter` (line 410) which both call `cancelInFlightSave()`. The seq bump alone short-circuits the retry loop on its next iteration but leaves the in-flight `AbortController` intact and leaves a sleeping `saveBackoffRef` timer dangling up to 8s. This is the exact pattern S3 removed from the select/delete paths.
- **Impact:** Create-chapter race: an in-flight PATCH for the old chapter can still land server-side after the new chapter is created; the backoff sleeps uselessly in memory.
- **Suggested fix:** Replace `++saveSeqRef.current;` with `cancelInFlightSave();` — identical pattern to delete/select.
- **Confidence:** High
- **Found by:** Concurrency & State

### [I4] `reloadActiveChapter` clears cache before the server GET — invariant #3 violation
- **File:** `packages/client/src/hooks/useProjectEditor.ts:367-368`
- **Bug:** `clearCachedContent(current.id)` runs before `await api.chapters.get(current.id)`. If the GET fails, the local draft cache is already gone. CLAUDE.md invariant #3 says "cache-clear happens after server success, never before" — this function violates that literally. The user-visible impact is small today (callers show the lock banner on GET failure), but the invariant is load-bearing and this is the only function in the branch that violates it.
- **Impact:** Defense-in-depth lost: on a reload failure, the draft cache that could have served recovery is pre-emptively erased.
- **Suggested fix:** Move `clearCachedContent(current.id)` into the success branch after `setActiveChapter(chapter)` and `setChapterReloadKey(...)`.
- **Confidence:** Medium
- **Found by:** Logic & Correctness

### [I5] `handleRestoreSnapshot` success path does not refresh find-replace results
- **File:** `packages/client/src/pages/EditorPage.tsx:267-272`
- **Bug:** `executeReplace` and `handleReplaceOne` both route their success paths through `finalizeReplaceSuccess`, which calls `findReplace.search(slug)` to refresh panel results against the post-mutation content. `handleRestoreSnapshot` mutates chapter content just as thoroughly but only refreshes the snapshot list — `findReplace.results` stays pinned to pre-restore matches.
- **Impact:** If the Find panel is open during a restore, every row remains clickable with stale offsets; clicking routes through `handleReplaceOne` and either hits the `matchNotFound` path (one confusing banner per click) or — if the restore left the text at an offset that now matches again — replaces the wrong match.
- **Suggested fix:** In the `if (result.ok)` branch of `handleRestoreSnapshot` (and the `stage === "reload"` branch), call `await findReplace.search(slug)` when `findReplace.panelOpen`.
- **Confidence:** Medium
- **Found by:** Logic & Correctness

### [I6] Reload-failed lock banner set AFTER `await findReplace.search` resolves
- **File:** `packages/client/src/pages/EditorPage.tsx:330-345` (`finalizeReplaceSuccess`)
- **Bug:** When `stage === "reload"` fires, `finalizeReplaceSuccess` does `await findReplace.search(slug)` first, then `setActionInfo(...)`, then `setEditorLockedMessage(...)`. The editor is already `setEditable(false)` at this point (reloadFailed path). The search round trip can take hundreds of milliseconds — during that window the editor is read-only with no visible explanation.
- **Impact:** "Why can't I type?" UX window. User sees no banner, no feedback, concludes the app is broken or their keyboard failed.
- **Suggested fix:** Set `editorLockedMessage` BEFORE awaiting the search when `reloadFailed === true`. The success banner can stay after.
- **Confidence:** Medium
- **Found by:** Logic & Correctness

## Suggestions

- **[S1]** `MutationResult` union isn't exhaustively checked at callers (`EditorPage.tsx:267-315, 388-427, 540-594`) — add `const _exhaustive: never = result;` defaults so a future new stage can't silently route through the `stage === "mutate"` tail. (Contract & Integration)
- **[S2]** Lock-banner clearing `useEffect` at `EditorPage.tsx:659-661` fires on any `chapterReloadKey` bump; drive it off an explicit "lock cleared" state instead of piggybacking on the reload-key side effect. (Logic & Correctness)
- **[S3]** Plan alignment: design doc promised "~80–140 lines removed vs. ~45–60 added" in EditorPage.tsx but actual diff shows net +292 lines. The refactor traded simplification for explicit I1–I5 correctness guards. Consider updating the design doc retrospectively so the "net deletion" expectation doesn't mislead future phases. (Plan Alignment)

## Plan Alignment

**Plan documents consulted:**
- `docs/plans/2026-04-19-editor-orchestration-helper-design.md`
- `docs/plans/2026-04-19-editor-orchestration-helper-plan.md`

**Implemented:** All in-scope items — `useEditorMutation` hook with the prescribed surface (`MutationStage`/`MutationDirective<T>`/`MutationResult<T>`), nine-step `run()` sequence, latest-ref pattern, discriminated result types, `isBusy()` probe (added beyond design), three call-site migrations (`handleRestoreSnapshot`, `executeReplace`, `handleReplaceOne`), `finalizeReplaceSuccess` helper, CLAUDE.md "route through useEditorMutation" sentence, unit test coverage (645 lines).

**Not yet implemented:** Phases 4b.2 (seq-ref consolidation), 4b.3 (error-mapper unification), 4b.4 (raw-string ESLint rule) — all deferred by design.

**Deviations:**
1. Integration test `EditorPage.unmount-clobber.test.tsx` listed as a deliverable was reverted (commit `9ac06c3`) with e2e deferral. Design anticipates this but the Deliverables bullet still names the file — mild doc drift.
2. `isBusy()` not in original design — beneficial addition for closing I2 hand-composed-flush races. Public API and invariant enforcement list in the design should be updated.
3. `MutationResult` pruned vs plan Task 1 scaffold (removed `error` from reload branch, split `busy`). Intentional tightening during S1 refinement.
4. Net line count in `EditorPage.tsx` is +292 rather than the promised net-deletion; driven by I1–I5 correctness guards.

**CLAUDE.md invariants 1–5 compliance:** Invariants 1, 2, 3 (for `run()`-routed paths), 4, and 5 are enforced by the hook. Invariant 2 is violated by `switchToView` (see [I1]). Invariant 3 is literally violated by `reloadActiveChapter`'s pre-GET cache clear (see [I4]). Invariant 1's enforcement sits entirely on callers routing through `run()` — bypasses at the sidebar and panel-toggle layer (see [I2]) are the most concerning invariant-preservation gap.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Plan Alignment, Security
- **Scope:** `packages/client/src/hooks/useEditorMutation.ts`, `useProjectEditor.ts`, `useFindReplaceState.ts`, `useSnapshotState.ts`, `useContentCache.ts`, `packages/client/src/pages/EditorPage.tsx`, `packages/client/src/utils/findReplaceErrors.ts`, `packages/client/src/api/client.ts`, `packages/client/src/components/Editor.tsx`
- **Raw findings:** 29 (across 5 bug-hunting specialists + 1 plan alignment)
- **Verified findings:** 12 (3 Critical, 6 Important, 3 Suggestions)
- **Filtered out:** 17 (false positives, below-threshold confidence, or subsumed by other findings)
- **Steering files consulted:** `CLAUDE.md`
- **Plan/design docs consulted:** `docs/plans/2026-04-19-editor-orchestration-helper-design.md`, `docs/plans/2026-04-19-editor-orchestration-helper-plan.md`, `docs/roadmap.md`
- **Security findings:** None — the orchestration-layer changes add no new inputs, sinks, or auth surfaces; `dangerouslySetInnerHTML` usage in `EditorPage.tsx:1047` is correctly gated by `DOMPurify.sanitize()` with a safe constant-string fallback.
