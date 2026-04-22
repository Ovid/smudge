# Agentic Code Review: ovid/architecture

**Date:** 2026-04-20 07:56:32
**Branch:** ovid/architecture -> main
**Commit:** e7fad1a2d16fa0d4e91249281a648940f82a5bde
**Files changed:** 19 | **Lines changed:** +3811 / -329
**Diff size category:** Large

## Executive Summary

Phase 4b.1 extracts `useEditorMutation` and migrates three call sites to it — the orchestration hook itself is well-constructed and correctly enforces CLAUDE.md save-pipeline invariants 1–4 by design. No Critical findings. Five Important findings concentrate on two themes: (1) failure-mode parity across the restore and replace flows (missing NETWORK branch, missing bare-404 refresh, lock banner with no recovery path) and (2) untracked `selectChapterSeqRef` bumps in `handleCreateChapter` and the secondary GET inside `handleDeleteChapter`, both of which can let an in-flight reload clobber newer state. Suggestions cover duplicated stage-dispatch boilerplate, a scope-creep note (error-mapping utility belongs to Phase 4b.3), and a narrow synchronous-throw edge in the hook's outer try.

## Critical Issues

None found.

## Important Issues

### [I1] Restore flow lacks NETWORK branch; offline restore shows generic copy
- **File:** `packages/client/src/pages/EditorPage.tsx:296-308`
- **Bug:** `handleRestoreSnapshot`'s `stage: "mutate"` branch maps `RestoreFailedError.reason` ∈ {corrupt_snapshot, cross_project_image, not_found} to reason-specific copy and falls through to generic `STRINGS.snapshots.restoreFailed` for everything else. `useSnapshotState.ts` surfaces `reason: "network"` for offline/DNS failures, but this ladder has no `"network"` arm. Meanwhile `mapReplaceErrorToMessage` (findReplaceErrors.ts:65-67) does branch on NETWORK — so a network-failed replace invites the user to check their connection, but a network-failed restore tells them "restore failed" and invites a retry.
- **Impact:** S4's stated goal (self-diagnose offline failures) is inconsistently applied. Two sibling flows give divergent guidance for the same root cause.
- **Suggested fix:** Add an `else if (result.error.reason === "network") setActionError(STRINGS.snapshots.restoreNetworkFailed)` arm (introduce the string), or factor a shared "network-classified" helper used by both mappers.
- **Confidence:** High
- **Found by:** Logic & Correctness (F3), confirmed by Error Handling (via V4)

### [I2] `editorLockedMessage` has no recovery path on subsequent successful mutation
- **File:** `packages/client/src/pages/EditorPage.tsx:658-660`
- **Bug:** The banner clears only when `activeChapter.id` or `chapterReloadKey` changes. After a `stage:"reload"` failure sets the lock banner, `useEditorMutation`'s `isLocked` predicate correctly keeps the editor read-only on subsequent `run()`s — but a subsequent *successful* mutation on the same chapter cannot clear the banner. The only recovery is manual refresh or chapter switch.
- **Impact:** A user who triggers a second successful replace/restore on the same chapter remains stuck under a "refresh the page" banner with `setEditable(false)`. May be intentional per the I1 design ("the user was told to refresh"), but the behavior is not documented and feels like a trap.
- **Suggested fix:** Either (a) document this explicitly in the hook and banner design so reviewers don't "fix" it later, or (b) clear `editorLockedMessage` when `run()` returns `ok: true` AND the reload step actually re-fetched (i.e. a successful reload proves the server state is now visible). (b) is safer UX.
- **Confidence:** Medium (behavior is confirmed; intent is ambiguous)
- **Found by:** Logic & Correctness (F8)

### [I3] `handleReplaceOne` bare 404 (project-gone) skips stale-row refresh
- **File:** `packages/client/src/pages/EditorPage.tsx:581-591`
- **Bug:** The refresh-then-`clearError` block is gated on `err.code === SEARCH_ERROR_CODES.SCOPE_NOT_FOUND`. For a bare 404 (project deleted from another tab/request, `NOT_FOUND` code), the refresh is skipped. Stale match rows remain visible and clickable; each click loops the same error. `useFindReplaceState.search` clears `results` on 400/404 (line 191-201), so refreshing on both 404 codes would cleanly drop the dead rows.
- **Impact:** Users can click-loop on dead rows after a project-gone 404; exactly the "loop the same error" pattern the comment at lines 574-580 explicitly tried to prevent.
- **Suggested fix:** Drop the `err.code === SCOPE_NOT_FOUND` gate — refresh on any 404. The search refetch's own 404 handling will stamp the project-gone copy once, and `findReplace.clearError()` immediately after suppresses the panel-local duplicate.
- **Confidence:** High
- **Found by:** Error Handling (F4)

### [I4] `handleCreateChapter` doesn't bump `selectChapterSeqRef` — in-flight reload can clobber the new chapter
- **File:** `packages/client/src/hooks/useProjectEditor.ts:298-314`
- **Bug:** Bumps `saveSeqRef` only. If `reloadActiveChapter` has an `api.chapters.get` in flight when the user clicks "+", the create awaits POST and `setActiveChapter(newChapter)` lands — then the pending reload's GET resolves, its seq check at line 369 still passes (selectChapterSeqRef was not bumped), and it writes `setActiveChapter(oldChapter)` + `setChapterReloadKey(+1)`, overwriting the new chapter.
- **Impact:** Editor renders the old chapter's content inside the newly-created chapter row; subsequent keystrokes PATCH the stale chapter id. Silent data divergence.
- **Suggested fix:** Call `cancelInFlightSelect()` at the top of `handleCreateChapter` (mirrors what `handleSelectChapter` / `reloadActiveChapter` already do via seq bumps).
- **Confidence:** High
- **Found by:** Concurrency & State (#1)

### [I5] `handleDeleteChapter` secondary `api.chapters.get` is not seq-guarded
- **File:** `packages/client/src/hooks/useProjectEditor.ts:426-442`
- **Bug:** After the delete, the fall-forward fetch of `first.id` calls `setActiveChapter(ch)` directly with no select-seq capture/compare. If the user selects a different chapter before this GET resolves, the stale fetch overwrites the newer selection.
- **Impact:** Race pins the sidebar's "next chapter after delete" over the user's explicit click. Rare but triggerable by rapid click-then-click during delete.
- **Suggested fix:** `const seq = ++selectChapterSeqRef.current` before the inner GET; gate `setActiveChapter(ch)` / `setChapterWordCount(...)` on `seq === selectChapterSeqRef.current`.
- **Confidence:** High
- **Found by:** Concurrency & State (#2)

## Suggestions

- **[S1] `searchScopeNotFound` key name + copy duplicate `replaceProjectNotFound`** (`packages/client/src/strings.ts:347-348`, `findReplaceErrors.ts:100-105`): identical text and misleading name; search has no SCOPE_NOT_FOUND branch, so rename to `searchProjectNotFound` or add the branch to mirror replace. (Error F1 + Contract F4.)
- **[S2] Stage-dispatch boilerplate duplicated across three callers** (`EditorPage.tsx` ~274-285, ~400-408, ~554-561): extract a `handleCommonMutationFailure(result, {saveFirstCopy})` helper so a future `MutationStage` addition is a one-file change. (Contract F3.)
- **[S3] `editor` handle captured once at `run()` entry** (`useEditorMutation.ts:83`): if `args.editorRef.current` is null at that moment, all `editor?.` guards silently skip `markClean()`, violating invariant 1 while the mutation still fires. Either re-read `editorRef.current` at each use site or return `stage: "flush"` if null at entry. (Contract F1.)
- **[S4] Synchronous `setEditable(false)` throw escapes the stage taxonomy** (`useEditorMutation.ts:88-102`): the call at line 90 sits in the outer try, which has only `finally`, no `catch`. A TipTap mid-remount throw rejects the returned Promise; none of the three callers wrap `await mutation.run(...)` in try/catch. Unit test `useEditorMutation.test.tsx:329-357` tacitly acknowledges this with `rejects.toThrow()`. Wrap `setEditable(false)` in its own try/catch returning `{ok: false, stage: "flush", error}`. (Concurrency #6.)
- **[S5] `mapSearchErrorToMessage` 404 comment lies about mirroring replace** (`findReplaceErrors.ts:100-105`): the comment says "Mirrors the replace-side handling via `replaceScopeNotFound`" but replace actually has a two-arm branch. Update either the comment or the code. (Error F1.)
- **[S6] `reloadActiveChapter` / `handleSelectChapter` don't abort their GETs** (`useProjectEditor.ts:332, 368`): rapid switches leak N concurrent GETs server-side; seq check discards results but the fetches still run. Thread an AbortController through. (Concurrency #3.)

## Plan Alignment

**Plan/design docs consulted:** `docs/plans/2026-04-19-editor-orchestration-helper-design.md`, `docs/plans/2026-04-19-editor-orchestration-helper-plan.md`.

- **Implemented:** `useEditorMutation.ts` + test file, three call-site migrations (handleRestoreSnapshot, executeReplace, handleReplaceOne), CLAUDE.md §Save-pipeline invariants closing sentence pointing to the hook.
- **Not yet implemented:** `EditorPage.unmount-clobber.test.tsx` listed in design deliverables — intentionally dropped per plan Task 14 / commit `9ac06c3`, with e2e owning the production-shape regression. Consistent with the design's revised testing strategy.
- **Deviations:**
  - **Scope creep into Phase 4b.3**: design's "Out of scope" excludes error-to-UI-string centralization, but the diff adds `packages/client/src/utils/findReplaceErrors.ts` and `mapSaveError` in `useProjectEditor.ts`. This is Phase 4b.3's scope. Under CLAUDE.md §Pull Request Scope ("A PR delivers a single feature *or* a single refactor — never both"), this arguably violates the one-feature rule. Recommend splitting or documenting an amended scope in the design before merge.
  - **`reloadActiveChapter` gains an `expectedChapterId` parameter** (`useProjectEditor.ts:348`): additive and consistent with the hook's I2 guard, but not mentioned in the design. Minor.
  - **Breadth of `useProjectEditor.ts` edits** beyond the design's "handleSave untouched" constraint: new `cancelInFlightSave` / `cancelInFlightSelect` callbacks, unmount-cleanup effect, narrower 4xx cache-wipe (VALIDATION_ERROR only), backoff-ref cleanup changes. Several (I2/I3/I5/S3/S4) are behavior changes to the save-pipeline surface. Treat as bundled bug fixes — tolerable if called out in the PR description.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment — all in parallel.
- **Scope:** Changed files in `packages/client/` plus adjacent `useSnapshotState.ts`, `Editor.tsx`, `strings.ts`, and design/plan docs for cross-reference.
- **Raw findings:** 13 distinct (plus multiple "verified clean" confirmations from specialists).
- **Verified findings:** 11 kept (5 Important, 6 Suggestion).
- **Filtered out:** 2 dropped — `flushSave()` undefined-as-success is correct by design (editor?. null-ref case); `saveBackoffRef` orphan-resolve is neutralized by the existing seq check + explicit pointer-identity guard at `useProjectEditor.ts:245-247`.
- **Steering files consulted:** `CLAUDE.md` (save-pipeline invariants, PR scope rule, 413/4xx semantics, status allowlist).
- **Plan/design docs consulted:** `docs/plans/2026-04-19-editor-orchestration-helper-design.md`, `docs/plans/2026-04-19-editor-orchestration-helper-plan.md`.
- **Security findings:** none ≥ 60% confidence; DOMPurify sanitization path and error-mapping disciplines verified clean.
