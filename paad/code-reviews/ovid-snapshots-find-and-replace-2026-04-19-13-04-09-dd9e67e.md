# Agentic Code Review: ovid/snapshots-find-and-replace

**Date:** 2026-04-19 13:04:09
**Branch:** ovid/snapshots-find-and-replace → main
**Commit:** dd9e67e7af5f76f3a95b6c096ef241ee044da30c
**Files changed:** 99 | **Lines changed:** +16,107 / -211
**Diff size category:** Large

## Executive Summary

This branch delivers Phase 4b (snapshots + find-and-replace) and has already been through multiple prior PAAD passes — roughly 200 commits, many labelled `fix(S*)`, `fix(I*)`, or `chore(review)`. The remaining findings are concentrated around orchestration seams between the editor, find-replace, and snapshot features (not the core algorithms). No critical bugs found; four Important findings involve silent state drift when failures happen at specific orchestration boundaries. Deferred items in `notes/TODO.md` (I3 ReDoS, S3/S6/S9/S10/S11) were excluded from reporting.

## Critical Issues

None found.

## Important Issues

### [I1] `reloadActiveChapter` failure after successful replace triggers full-page error overlay

- **File:** `packages/client/src/hooks/useProjectEditor.ts:269-273` via `packages/client/src/pages/EditorPage.tsx:298, 454, 644-662`
- **Bug:** On a post-replace reload, transient GET failures route into `setError(...)` which renders the full-screen error branch in EditorPage. Unlike `handleRenameChapter` and `handleStatusChange`, `reloadActiveChapter` has no non-fatal error callback path.
- **Impact:** User runs a replace-all, server completes it successfully, local network blips on the follow-up GET, and the user lands on a terminal "Failed to load chapter" overlay with no retry path and no indication the replace landed. They may re-run the replace, duplicating auto-snapshots.
- **Suggested fix:** Thread an `onError?` callback into `reloadActiveChapter` (mirroring the pattern used by status/rename failures) and have `executeReplace` / `handleReplaceOne` surface the miss via `setActionError("Replace succeeded — refresh to see changes")` rather than the full-page overlay.
- **Confidence:** Medium
- **Found by:** Logic & Correctness (client), Contract & Integration (client)

### [I2] `switchToView` ignores the boolean returned by `flushSave`

- **File:** `packages/client/src/pages/EditorPage.tsx:585-595`
- **Bug:** `EditorHandle.flushSave` now returns `Promise<boolean>` (`false` means save failed). Every other orchestration path that awaits `flushSave` — `handleRestoreSnapshot`, `executeReplace`, `handleReplaceOne`, `SnapshotPanel.onView` — checks the boolean and aborts on failure. `switchToView` unconditionally proceeds to `setViewMode(mode)` regardless.
- **Impact:** User types, server temporarily unavailable, user switches to Preview/Dashboard via Ctrl+number. `flushSave` returns false but the view switch proceeds. Preview renders the LAST server-confirmed content, not what the user just typed, with no save-failure indicator. The draft stays cached locally so switching back restores it — but in the interim the user believes they saw their latest state in preview.
- **Suggested fix:** Check the flush result and either abort the view change with an error banner (matching the restore/replace discipline) or explicitly document that preview/dashboard are allowed to show pre-flush state.
- **Confidence:** High
- **Found by:** Contract & Integration (client)

### [I3] `handleReplaceOne` reads `findReplace.replacement` live after the `flushSave` await

- **File:** `packages/client/src/pages/EditorPage.tsx:419` (replacement read at ~line 435)
- **Bug:** Per-match Replace is the only replace path with no confirmation dialog. `handleReplaceOne` captures `frozenQuery` and `frozenOptions` at entry but passes `findReplace.replacement` (the LIVE hook value) to `api.search.replace`. Between capture and POST there is an `await editorRef.current?.flushSave()` that can take seconds during save backoff — during which the user can edit the replacement input.
- **Impact:** Silent correctness bug with no UI to catch it. User clicks Replace on match N expecting "foo" → during the flush window, types over "foo" → "bar" → the POST sends "bar". The replace is committed, the panel refreshes, success banner shows correct count. No way for the user to notice.
- **Suggested fix:** Capture `findReplace.replacement` into `frozenReplacement` at entry (alongside `frozenQuery` / `frozenOptions`) before the flush await, and pass that to the POST.
- **Confidence:** High
- **Found by:** Contract & Integration (client)

### [I4] Cross-project navigation leaves stale `activeChapter` visible under the new project's shell

- **File:** `packages/client/src/hooks/useProjectEditor.ts:45-75`
- **Bug:** The `loadProject` effect fires on slug change and fetches the new project, but only loads the first chapter when `!activeChapterRef.current`. Nothing in the slug-change path clears `activeChapterRef.current`, so when the user navigates between two projects without a full remount, the ref still holds project A's chapter and the guard skips loading project B's first chapter. Project state shows B while `activeChapter` still reflects A.
- **Impact:** On any client-side navigation between two projects (in-place slug change, future `<Link>`-based project nav, back/forward across two project URLs), the editor can render project A's title and content under project B's sidebar. Today the only in-place slug change is project rename, which preserves the chapter set so the mismatch happens to work out; any other cross-project navigation would surface the bug.
- **Suggested fix:** When the effect detects `activeChapterRef.current` belongs to a chapter NOT in the newly-loaded `data.chapters`, reset it (`setActiveChapter(null)`, `activeChapterRef.current = null`) and then load the first chapter of the new project. Equivalently, key the effect on the server-returned project id and reset on change.
- **Confidence:** High
- **Found by:** Concurrency & State (client)

## Suggestions

- `packages/client/src/hooks/useProjectEditor.ts:227-251` — `handleSelectChapter` resets `saveStatus` but not `saveErrorMessage`; sibling `handleCreateChapter` does clear it. Asymmetry that will bite a future refactor. (LC7)
- `packages/server/src/snapshots/labels.ts:16` + `packages/server/src/search/search.service.ts:287` — auto-snapshot labels render as `Before find-and-replace: '' → ''` if `sanitizeSnapshotLabel` strips the search/replace strings entirely. Add an `(empty)` placeholder fallback. (ES1)
- `packages/client/src/api/client.ts:33-66` — only the initial `fetch()` call is wrapped for AbortError; aborts during `res.json()` (headers already received) surface as raw DOMExceptions that bypass `ApiRequestError` classification, causing generic network-error copy in callers. Wrap the body reads too. (EC1)
- `packages/client/src/components/SnapshotBanner.tsx:69-72` — ConfirmDialog `onConfirm={() => { setConfirmOpen(false); onRestore(); }}` is fire-and-forget with no `.catch` / `void`. Parent's try/finally contains rejections today; still worth `void onRestore()` for safety. (EC4)
- `packages/client/src/pages/EditorPage.tsx:605-620` — `handleProjectSettingsUpdate` catch sets a generic "loadProjectFailed" banner for all errors; 404 (project deleted elsewhere) is indistinguishable from a transient blip. Branch on `ApiRequestError.status === 404` to navigate home. (EC5)
- `packages/server/src/search/search.routes.ts:157-159` — comment claims "A cross-project chapter_id would already 404 at project resolution" but project resolution only checks slug; the cross-project check is actually at `search.service.ts:213-215`. Misleading; behavior is correct. (CS2)
- `packages/server/src/app.ts:63-93` — `globalErrorHandler` emits 409 (CONFLICT) and 413 (PAYLOAD_TOO_LARGE) but CLAUDE.md documents 200/201/400/404/500. Either update CLAUDE.md to include them or remap 413 → 400 CONTENT_TOO_LARGE to stay inside the stated contract. (CS3)
- `packages/client/src/hooks/useSnapshotState.ts:179-188` — `viewSnapshot` success path re-checks `chapterSeqRef` / `viewSeqRef`; the catch branch does not. A chapter-switch during an in-flight GET can cause a stale "snapshot no longer exists" error to land on the wrong chapter's panel. Mirror the success guard in the catch. (CC1)
- `packages/server/src/chapters/chapters.service.ts:119` — `updateChapter` does the final `findChapterById` read OUTSIDE the transaction it just committed. A concurrent write between commit and read returns the other writer's content in this request's response. `restoreSnapshot` at `snapshots.service.ts:210-214` already models the correct tx-internal pattern. (KS1)
- `packages/client/src/pages/EditorPage.tsx:151-175` and panel components — toggling between panels closes siblings before opening the new one, and the focus-return-to-trigger on close can race the new panel's focus-acquire. Keyboard users may see focus flicker or land wrong. Consider differentiating "user-escape close" from "panel-exclusivity close" so the latter skips `triggerRef.focus()`. (KC1)
- `packages/client/src/hooks/useProjectEditor.ts:279-323` — `handleDeleteChapter` aborts the in-flight PATCH but doesn't reset `saveStatus`. When the user deletes the last chapter mid-save, footer stays on "Saving…" indefinitely. Add `setSaveStatus("idle")` (and mirror the cleanup pattern from `handleSelectChapter`). (KC3)

## Plan Alignment

- **Implemented:** All 19 planned Phase 4b tasks are reflected in the diff — migration 014, snapshot types/schema/repository/service/routes, auto-snapshot label generation, dedup via content-hash, Ctrl/Cmd+S interception, `SnapshotPanel` + `SnapshotBanner` + `useSnapshotState`, shared `tiptap-text.ts` walker, search/replace service + routes, `FindReplacePanel` + `useFindReplaceState`, Ctrl/Cmd+H, toolbar icons, and e2e tests for both sub-features.
- **Not yet implemented:** Task 20 (final coverage/cleanup pass) is not visible as a discrete commit, though extensive test additions suggest the work is effectively underway.
- **Deviations:** Scope legitimately expanded into shared helpers not named in the plan file list — `snapshots/content-hash.ts`, `snapshots/labels.ts`, `utils/grapheme.ts`, `tiptap-depth.ts`, `client/utils/findReplaceErrors.ts`. `chapters.service.ts` (+62), `images.references.ts` (+116), and new `applyImageRefDiff` helper are REFACTOR-phase extractions consistent with the plan's stated guidance. `useProjectEditor.ts` (+241) and `useContentCache.ts` (+21) weren't called out in the plan but are necessary for the restore/replace → reload-current-chapter flow; worth a sanity check that save-pipeline behavior hasn't shifted beyond those seams.

## Review Metadata

- **Agents dispatched:** 10 parallel specialists (Logic-server, Logic-client, Error-server, Error-client, Contract-server, Contract-client, Concurrency-server, Concurrency-client, Security-combined, Plan Alignment) + 1 Verifier
- **Scope:** 99 changed files; non-test production code concentrated under `packages/server/src/{search,snapshots,chapters,images,stores,db,utils}`, `packages/shared/src/*`, `packages/client/src/{pages,hooks,components,api,utils}`
- **Raw findings:** ~52 (before verification, across all specialists)
- **Verified findings:** 15 (4 Important + 11 Suggestions)
- **Filtered out:** ~37 (duplicates, deferred items, false positives on second read, or items covered by existing guards)
- **Steering files consulted:** `CLAUDE.md`, `notes/TODO.md` (deferred items I3, S3, S6, S9, S10, S11 explicitly excluded from reporting)
- **Plan/design docs consulted:** `docs/plans/2026-04-16-snapshots-find-replace-design.md`, `docs/plans/2026-04-16-snapshots-find-replace-plan.md`
