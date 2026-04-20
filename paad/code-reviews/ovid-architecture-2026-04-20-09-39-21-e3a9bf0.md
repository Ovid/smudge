# Agentic Code Review: ovid/architecture

**Date:** 2026-04-20 09:39:21
**Branch:** ovid/architecture -> main
**Commit:** e3a9bf0770df95405311c9bb75b35865675eafbe
**Files changed:** 23 | **Lines changed:** +4268 / -338 (production code: roughly +1923 / -334)
**Diff size category:** Large

## Executive Summary

Since the prior review at commit `944ba6d` (2026-04-20 08:33:55), only the roadmap and the prior review file itself have been added — the production code under review is unchanged. Two Critical findings from that review still stand: the 2xx `BAD_JSON` data-loss paths on replace and restore. Several Important findings remain, clustered around two themes: (1) hand-composed flush/cancel sequences at sidebar/keyboard entry points still bypass `mutation.isBusy()`, and (2) `reloadActiveChapter`'s boolean return conflates "superseded" with "failed", producing spurious lock banners. The F1 finding from the prior review (stale `expectedChapterId` skip) was re-examined and rejected this round — the chapter-switch useEffect does clear the banner. Two Critical, six Important, six Suggestion findings.

## Critical Issues

### [C1] 2xx BAD_JSON on replace leaves editor editable; auto-save silently reverts committed replace
- **File:** `packages/client/src/hooks/useEditorMutation.ts:133-137`, `packages/client/src/api/client.ts:86-92`, `packages/client/src/pages/EditorPage.tsx:425-427, 650-657`, `packages/client/src/utils/findReplaceErrors.ts:26-28`
- **Bug:** `apiFetch` throws `ApiRequestError(status=2xx, code="BAD_JSON")` when a 2xx body fails to parse (client.ts:91). Thrown inside the mutate callback, this routes to `stage:"mutate"`; the hook's finally re-enables the editor and `directive` was never returned so `clearAllCachedContent` is skipped. `mapReplaceErrorToMessage` shows the `replaceResponseUnreadable` banner advisorily. Server-side, the replace committed and an auto-snapshot was written. With the editor editable over pre-replace content, the 1.5s auto-save debounce PATCHes pre-replace content back over the server's committed replacement.
- **Impact:** Silent loss of a committed project-wide replace.
- **Suggested fix:** In both `executeReplace` and `handleReplaceOne` stage:"mutate" branches, detect `err instanceof ApiRequestError && err.code === "BAD_JSON" && err.status >= 200 && err.status < 300` and call `setEditorLockedMessage(STRINGS.findReplace.replaceSucceededReloadFailed)` — same treatment as stage:"reload". Alternatively, introduce a dedicated `stage:"committed_but_unreloaded"` (matches Phase 4b.5 roadmap intent) and lock in the hook.
- **Confidence:** High
- **Found by:** Logic, Error Handling, Security

### [C2] 2xx BAD_JSON on snapshot restore misclassified as "network"; committed restore silently reverted
- **File:** `packages/client/src/hooks/useSnapshotState.ts:259-275`, `packages/client/src/pages/EditorPage.tsx:303-309`
- **Bug:** `restoreSnapshot`'s catch ladder returns `reason:"network"` for any `ApiRequestError` not matching `CORRUPT_SNAPSHOT`/`CROSS_PROJECT_IMAGE_REF`/404. A 2xx BAD_JSON (server committed the restore and auto-snapshot but response body unreadable) falls through to "network". `handleRestoreSnapshot` surfaces `restoreNetworkFailed` (invites retry) and the hook re-enables the editor. Auto-save then reverts the committed restore.
- **Impact:** Silent loss of a committed restore; misdirected recovery guidance.
- **Suggested fix:** Add a branch in `restoreSnapshot`'s catch: `if (err.code === "BAD_JSON" && err.status >= 200 && err.status < 300) return { ok: false, reason: "possibly_committed" }`. Extend `RestoreFailureReason` accordingly and route it through `setEditorLockedMessage(...)` in `handleRestoreSnapshot` with copy equivalent to `replaceSucceededReloadFailed`.
- **Confidence:** High
- **Found by:** Logic, Error Handling, Security

## Important Issues

### [I1] `switchToView` flushes without `setEditable(false)` (invariant 2 violation)
- **File:** `packages/client/src/pages/EditorPage.tsx:708-743`
- **Bug:** Gates on `mutation.isBusy()` then calls `editorRef.current?.flushSave()` without first disabling the editor. The sibling `SnapshotPanel.onView` handler and all three `mutation.run()` callers cite invariant 2 and do `setEditable(false)` before flushing.
- **Impact:** During a slow flush (seconds in save backoff), keystrokes re-dirty the editor and schedule a new debounced save that fires after the view switch, desyncing editor state from the displayed view.
- **Suggested fix:** Wrap the flush in `setEditable(false)`; restore `setEditable(true)` on the refusal path. Mirror `SnapshotPanel.onView`.
- **Confidence:** High
- **Found by:** Logic, Contract

### [I2] Sidebar create/delete and panel toggles bypass `mutation.isBusy()` guard
- **File:** `packages/client/src/pages/EditorPage.tsx:798, 948-949, 1008`, `packages/client/src/hooks/useTrashManager.ts:64`, `packages/client/src/hooks/useKeyboardShortcuts.ts:143-147`
- **Bug:** `switchToView`, `SnapshotPanel.onView`, and `SnapshotPanel.onBeforeCreate` honor `mutation.isBusy()`. Sidebar `onAddChapter={handleCreateChapter}`, empty-state create, keyboard Ctrl+Shift+N, `onDeleteChapter={setDeleteTarget}` → `confirmDeleteChapter` → `handleDeleteChapter` (calls `cancelInFlightSave()` which aborts `saveAbortRef`), and panel-exclusivity toggles do not. A delete click mid-mutation aborts the hook's flushSave — hook reports `stage:"flush"` with a misattributed "save first" banner; a create click bumps `saveSeqRef` and `selectChapterSeqRef` directly, tripping the hook's reload-seq guard.
- **Impact:** A sidebar/keyboard action during a 2–14s replace/restore flush produces misattributed "save failed" banners, or — via `exitSnapshotView` in panel-toggle exclusivity logic — can remount the Editor while the hook holds the pre-remount handle, defeating the lock.
- **Suggested fix:** Wrap `handleCreateChapter`, `setDeleteTarget`, `openTrash`, the three panel toggles, and `exitSnapshotView` (or `confirmDeleteChapter` inside `useTrashManager`) with the same `if (mutation.isBusy()) { setActionInfo(STRINGS.editor.mutationBusy); return; }` guard used by `switchToView` / `onView`.
- **Confidence:** High
- **Found by:** Logic, Contract, Concurrency

### [I3] `reloadActiveChapter` clears cache BEFORE the server GET (invariant 3 violation)
- **File:** `packages/client/src/hooks/useProjectEditor.ts:367-374`
- **Bug:** `clearCachedContent(current.id)` runs before `await api.chapters.get(current.id)`. CLAUDE.md save-pipeline invariant 3 is literal: "Cache-clear happens after server success, never before." If the GET fails, the local draft cache is already gone. The hook's own cache-clear (`clearAllCachedContent(directive.clearCacheFor)` in `useEditorMutation.ts:138-140`) correctly runs after mutate success, so this primitive's pre-GET clear is both redundant and an invariant violation.
- **Impact:** Defense-in-depth weakening; on a reload GET failure, the draft cache that could serve recovery is pre-emptively erased.
- **Suggested fix:** Move `clearCachedContent(current.id)` into the success branch immediately before or after `setActiveChapter(chapter)`.
- **Confidence:** High
- **Found by:** Logic

### [I4] Reload-failed lock banner set AFTER `await findReplace.search` — UX dead zone
- **File:** `packages/client/src/pages/EditorPage.tsx:330-345` (`finalizeReplaceSuccess`)
- **Bug:** When `stage:"reload"` fires, the editor is already `setEditable(false)` but `finalizeReplaceSuccess` awaits `findReplace.search(slug)` before setting `editorLockedMessage`. The search can take hundreds of milliseconds — during that window the editor is read-only with no visible banner or explanation.
- **Impact:** "Why can't I type?" window — users see an unresponsive editor with no feedback until the banner appears.
- **Suggested fix:** When `reloadFailed === true`, set `editorLockedMessage` BEFORE awaiting the search refresh. The success banner and panel refresh can stay after.
- **Confidence:** High
- **Found by:** Logic

### [I5] `reloadActiveChapter` returns false for both supersession AND fetch error → spurious lock banner
- **File:** `packages/client/src/hooks/useEditorMutation.ts:148-159`, `packages/client/src/hooks/useProjectEditor.ts:372-395`
- **Bug:** `reloadActiveChapter` returns `false` both when its GET was superseded by a newer select (seq bump) and when the fetch itself errored. The hook treats both identically as `reloadFailed=true` → `stage:"reload"` → the caller sets a persistent non-dismissible lock banner. When the user switches chapters during the reload GET, the supersession path fires and the banner appears on the newly-active chapter even though the mutation + reload actually succeeded as far as they ran.
- **Impact:** A spurious persistent "refresh the page" lock banner pinned on a chapter the mutation didn't touch.
- **Suggested fix:** Distinguish `"reloaded" | "superseded" | "failed"` from `reloadActiveChapter` (or throw a typed sentinel for failure). The hook should treat `"superseded"` as success-equivalent — the user's own action replaced the view; no lock is warranted.
- **Confidence:** High
- **Found by:** Contract, Concurrency

### [I6] `SnapshotPanel.onView` hand-composed `setEditable(false)` outside try/catch
- **File:** `packages/client/src/pages/EditorPage.tsx:1164-1187`
- **Bug:** `editorRef.current?.setEditable(false)` at line 1164 is outside the surrounding try/catch. `useEditorMutation` wraps this exact call in its own try/catch (S4) because TipTap can throw synchronously during remount. A sync throw here rejects the `onView` promise and bypasses the `{ok,reason}` contract SnapshotPanel expects.
- **Impact:** Uncaught promise rejection under a real but rare TipTap-remount condition.
- **Suggested fix:** Move `setEditable(false)` inside the try block; on catch return `{ok:false, reason:"save_failed"}` rather than letting the throw escape.
- **Confidence:** High
- **Found by:** Error Handling

### [I7] `handleRestoreSnapshot` `reason:"unknown"` re-enables editor with uncertain server state
- **File:** `packages/client/src/pages/EditorPage.tsx:310-315`, `packages/client/src/hooks/useSnapshotState.ts:274`
- **Bug:** `restoreSnapshot` returns `reason:"unknown"` when the caught error is not an `ApiRequestError` (anything from `TypeError` on a malformed response to a reject-before-send). The caller routes it to `setActionError(restoreFailed)` and the hook re-enables the editor. Whether the server committed is genuinely ambiguous.
- **Impact:** Potential silent data loss on a rare error path; same class as [C1]/[C2] but narrower surface.
- **Suggested fix:** Treat `"unknown"` pessimistically — raise the lock banner rather than a dismissible action error. Allowlist `corrupt_snapshot` and `cross_project_image` as "did not commit"; everything else defaults to locked.
- **Confidence:** Medium
- **Found by:** Error Handling

## Suggestions

- **[S1]** `handleCreateChapter` uses bare `++saveSeqRef.current` at `useProjectEditor.ts:301` instead of `cancelInFlightSave()`. Inconsistent with `handleSelectChapter`/`handleDeleteChapter`; leaves the `AbortController` live and the backoff timer scheduled. Replace with `cancelInFlightSave()`. (Logic, Concurrency)
- **[S2]** `MutationResult` is not exhaustively matched (no `assertNever`). Adding a new stage would silently fall into the `// stage === "mutate"` tail across three callers. Add `const _: never = result` defaults or a `switch` with exhaustive default. (Contract)
- **[S3]** Stale `editor` handle captured at `useEditorMutation.ts:91`. Remounts mid-run leave `markClean()` and `setEditable(true)` targeting the old handle; Editor's `setEditable` guards with `isDestroyed`, but `markClean` does not. Re-read `args.editorRef.current` in finally and before `markClean`. (Contract, Concurrency)
- **[S4]** Stage-dispatch ladders duplicated across `handleRestoreSnapshot`/`executeReplace`/`handleReplaceOne` (EditorPage.tsx:266-315, 388-427, 540-594). Extract `renderMutationOutcome(result, copyMap, callbacks)` alongside `useEditorMutation`. (Contract)
- **[S5]** `flushSave === false` `stage:"flush"` banner copy ("save first") overlaps the footer's more specific `saveErrorMessage` ("too large"/"invalid"). Either suppress the action banner when `saveStatus === "error"` or propagate the specific copy. (Contract)
- **[S6]** Unmount cleanup's `cancelInFlightSelect()` bumps `selectChapterSeqRef` but the hook's subsequent `++selectChapterSeqRef.current` captures the post-bump value — state writes land on an unmounted component. Add a `mountedRef` gate in `reloadActiveChapter`. (Concurrency)
- **[S7]** `handleSave` post-loop error write at `useProjectEditor.ts:277-280` is guarded only on chapter id; add the missing `seq === saveSeqRef.current` check to match the happy path. (Error Handling)

## Plan Alignment

**Plan docs consulted:**
- `docs/plans/2026-04-19-editor-orchestration-helper-design.md`
- `docs/plans/2026-04-19-editor-orchestration-helper-plan.md`

**Implemented:** The `useEditorMutation` hook with the prescribed `MutationStage` / `MutationDirective<T>` / `MutationResult<T>` shapes; the nine-step `run()` sequence; latest-ref pattern for `projectEditor` and `isLocked`; per-hook `inFlightRef` guard returning `stage:"busy"`; three call-site migrations (`handleRestoreSnapshot`, `executeReplace`, `handleReplaceOne`); `finalizeReplaceSuccess` shared bookkeeping helper; CLAUDE.md "route through `useEditorMutation`" sentence; extensive unit test suite (645 lines in `useEditorMutation.test.tsx`); `RestoreAbortedError` / `RestoreFailedError` sentinel pattern; `reloadActiveChapter` `expectedChapterId` scoping.

**Not yet implemented:** Phases 4b.2 (abortable-sequence primitive), 4b.3 (error-mapper unification), 4b.4 (raw-string ESLint rule), and the newly-added Phase 4b.5 (editor state machine) — all correctly deferred per design §Out of scope.

**Deviations:**
1. `EditorPage.tsx` net delta is +380 lines, not the forecast net deletion (~80–140 removed vs. ~45–60 added). Driven by explicit stage-to-UI routing ceremony, the `finalizeReplaceSuccess` helper, and inline comments documenting I1–I5 bug references from earlier PAAD reviews. Design doc should be updated retrospectively so future phases don't carry the "net deletion expected" expectation.
2. `isBusy()` is in the final design (line 122) — matches implementation. No deviation.
3. `MutationResult` `stage:"reload"` variant dropped its `error` field (implementation comment at useEditorMutation.ts:22-27 explains the S1 refinement). Intentional tightening beyond the original design.
4. The `.unmount-clobber.test.tsx` integration test was reverted in commit `9ac06c3` with e2e deferral — the plan accepted this; no deviation.
5. Extensive follow-up fix commits landed on top of the base migration (I1–I5, S1–S5 series) addressing issues from PAAD reviews — these go beyond the plan's task list but address bugs surfaced in review rather than new features.
6. Roadmap adds Phase 4b.5 (Editor State Machine) which directly targets the Critical findings in this review ([C1]/[C2]) — introduced to capture the "committed-but-unreloaded" stage as a first-class state-machine event rather than a scattered caller-level branch.

**CLAUDE.md invariant compliance:** Invariants 1, 2, 4, 5 are enforced inside `useEditorMutation.run()` and honored by hook-routed callers. Invariant 2 is violated by `switchToView` (see [I1]). Invariant 3 is literally violated by `reloadActiveChapter`'s pre-GET cache clear (see [I3]). The cross-caller discipline that invariants 1 and 2 depend on is bypassed at sidebar and keyboard entry points (see [I2]).

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** `packages/client/src/hooks/useEditorMutation.ts`, `useProjectEditor.ts`, `useFindReplaceState.ts`, `useSnapshotState.ts`, `useContentCache.ts`, `useTrashManager.ts`, `useKeyboardShortcuts.ts`, `packages/client/src/components/Editor.tsx`, `SnapshotPanel.tsx`, `packages/client/src/pages/EditorPage.tsx`, `packages/client/src/utils/findReplaceErrors.ts`, `packages/client/src/api/client.ts`
- **Raw findings:** 34 (across 5 bug-hunting specialists + 1 plan alignment)
- **Verified findings:** 15 (2 Critical, 7 Important, 7 Suggestions — with [S7] added post-verification)
- **Filtered out:** 19 (false positives, below-threshold confidence, subsumed by other findings, or design-handled)
- **Steering files consulted:** `CLAUDE.md`
- **Plan/design docs consulted:** `docs/plans/2026-04-19-editor-orchestration-helper-design.md`, `docs/plans/2026-04-19-editor-orchestration-helper-plan.md`, `docs/roadmap.md`
- **Security findings:** None direct; [C1]/[C2] are integrity/data-loss issues that the Security specialist flagged alongside Logic and Error Handling. DOMPurify pipeline correctly gates all `dangerouslySetInnerHTML` usage; no XSS, regex-injection, prototype-pollution, or error-leak vectors found.
- **Prior review:** `paad/code-reviews/ovid-architecture-2026-04-20-08-33-55-944ba6d.md` — the production code has not changed since; the two Critical findings remain. The prior review's C1 (stale `expectedChapterId` skip) was re-examined and rejected this round.
