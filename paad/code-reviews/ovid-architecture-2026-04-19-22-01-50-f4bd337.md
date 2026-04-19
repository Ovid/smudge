# Agentic Code Review: ovid/architecture

**Date:** 2026-04-19 22:01:50
**Branch:** ovid/architecture -> main
**Commit:** f4bd337c010bc441f5c5665bbc6b8eea07b77640
**Files changed:** 9 | **Lines changed:** +2441 / -255 (code only: ~500 net)
**Diff size category:** Medium (docs-heavy; code changes mostly confined to `EditorPage.tsx` + two new hook files)

## Executive Summary

Phase 4b.1 extracts a `useEditorMutation` hook that codifies the CLAUDE.md save-pipeline invariants, then migrates three call sites (`handleRestoreSnapshot`, `executeReplace`, `handleReplaceOne`). The refactor is well-aligned with the design doc and the hook enforces its stated contract for ordering, busy-guarding, and error routing. No bugs that block merge, but three important UX/data issues warrant attention and several smaller issues should be cleaned up. The highest-severity concern is an existing (not new) data-loss shape on `stage: "reload"` that the refactor preserves.

## Critical Issues

None found.

## Important Issues

### [I1] Reload-stage failure leaves the editor editable over stale content; next auto-save silently reverts the server-side replace/restore
- **File:** `packages/client/src/hooks/useEditorMutation.ts:69-85`, routing in `packages/client/src/pages/EditorPage.tsx:321-330` and `:468-475`
- **Bug:** When `directive.reloadActiveChapter` is true and the follow-up `reloadActiveChapter()` fails, the hook has already done (a) `markClean()` and (b) `clearAllCachedContent(directive.clearCacheFor)`, then the `finally` re-enables the editor. The UI surfaces a *dismissible* banner (`replaceSucceededReloadFailed` / `restoreSucceededReloadFailed`), but the editor still shows the **pre-mutation** TipTap document. If the user dismisses the banner and types one character, `handleContentChange` flips `saveStatus` to `unsaved`, the 1.5s debounce fires a PATCH with the *stale* content, and the server-side replace/restore is silently reverted.
- **Impact:** Data loss on exactly the "only the GET failed" partial-success case the design calls out as benign. Pre-existing shape (the pre-refactor code had the same defect), but the refactor codifies it into the hook and adds a second call site (`handleReplaceOne`).
- **Suggested fix:** On `stage: "reload"`, either (a) keep `setEditable(false)` and force a page reload / retry via the banner, (b) transition the editor into a hard-error state that gates further saves until the user acknowledges, or (c) re-attempt `reloadActiveChapter` with backoff before declaring failure. Document whichever choice is taken in the save-pipeline invariants.
- **Confidence:** High
- **Found by:** Logic & Correctness (independently verified against current code)

### [I2] `reloadActiveChapter` reads a live ref and can wipe the cached draft of a chapter the user switched to mid-mutation
- **File:** `packages/client/src/hooks/useEditorMutation.ts:74` → `packages/client/src/hooks/useProjectEditor.ts:273-308`
- **Bug:** The hook computes `directive.reloadActiveChapter` based on `getActiveChapter()` at the moment the mutate callback returns, but the hook calls `projectEditor.reloadActiveChapter()` later — and `reloadActiveChapter` reads `activeChapterRef.current` *freshly* and calls `clearCachedContent(current.id)` *before* the GET. During the mutate/reload await window, nothing prevents the user from clicking a sidebar chapter: the sidebar buttons are live (the editor is `setEditable(false)` but the sidebar is not), and `handleSelectChapterWithFlush` proceeds. If chapter C3 has a cached draft and the user selects it while replace-all is finishing, the subsequent `reloadActiveChapter` wipes `smudge:draft:C3` and remounts the editor with server content — discarding C3's cached work. The reload also spuriously pulls C3 even though C3 was not in `affected_chapter_ids`.
- **Impact:** Silent cache-wipe of an unaffected chapter's unsaved draft.
- **Suggested fix:** Have the hook pass an explicit "expected chapter id" to `reloadActiveChapter` and no-op if the active chapter no longer matches; OR disable sidebar chapter switching while `mutation.run` is in flight; OR check `affected_chapter_ids` again inside the hook before invoking reload.
- **Confidence:** Medium-High (timing-dependent but reachable)
- **Found by:** Concurrency & State

### [I3] `busy` stage is silently dropped by all three callers, with no user feedback during flush backoffs that can exceed 10s
- **File:** `packages/client/src/hooks/useEditorMutation.ts:41-45`, callers at `packages/client/src/pages/EditorPage.tsx:229`, `:315`, `:463`
- **Bug:** The `inFlightRef` guard returns `{ok: false, stage: "busy"}` immediately; every caller handles this with an unconditional `return;` (and no UI feedback). Because `mutation.run` awaits `flushSave()`, and `handleSave`'s retry backoff sleeps up to 2 + 4 + 8 = 14s, a click on "Replace One" or "Restore" while a prior mutation is stuck in backoff is silently swallowed. The editor shows read-only with no indication that the input was received.
- **Impact:** User presses a button, nothing happens, they press it again, still nothing. Classic dark-pattern.
- **Suggested fix:** Expose `inFlight` as reactive state (e.g. `mutation.inFlight` via `useState`), disable the triggering buttons while true; OR surface a brief `setActionInfo("Another operation is in progress…")` on busy.
- **Confidence:** High
- **Found by:** Concurrency & State

### [I4] `handleReplaceOne` 404 handler conflates `SCOPE_NOT_FOUND` with project `NOT_FOUND`, double-firing banner when project is gone
- **File:** `packages/client/src/pages/EditorPage.tsx:482-486`
- **Bug:** `if (err instanceof ApiRequestError && err.status === 404) await findReplace.search(slug);` — unconditional on any 404. `mapReplaceErrorToMessage` already differentiates `SCOPE_NOT_FOUND` (chapter soft-deleted; re-searching is correct) from generic `NOT_FOUND` (project gone; re-searching will also 404 and produce a second "search scope not found" banner via the search hook, overwriting `replaceProjectNotFound`).
- **Impact:** Confusing two-banner flicker; the final user-visible copy is wrong.
- **Suggested fix:** Gate the re-search on `err.code === SEARCH_ERROR_CODES.SCOPE_NOT_FOUND`.
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases

### [I5] Migrated callers do not clear a stale `actionError` banner on entry; prior error co-displays with a new success
- **File:** `packages/client/src/pages/EditorPage.tsx:196` (`handleRestoreSnapshot`), `:270` (`executeReplace`), `:421` (`handleReplaceOne`)
- **Bug:** `executeReplace` and `handleReplaceOne` clear `actionInfo` on entry (good — prevents a stale success banner flashing next to a new error). None of the three callers clear `actionError` on entry. A previous failure's banner therefore survives into the new operation's success state, showing the user "Replaced 3 occurrences" side-by-side with an unrelated "Replace failed: corrupt chapter" banner.
- **Impact:** Misleading UI — user cannot tell which operation the error refers to.
- **Suggested fix:** `setActionError(null)` at the top of each migrated caller, alongside `setActionInfo(null)`. Add `setActionInfo(null)` to `handleRestoreSnapshot` as well, to match the other two.
- **Confidence:** High
- **Found by:** Logic & Correctness, Error Handling (independent)

### [I6] Hook return `{ run }` is re-allocated on every render, defeating the latest-ref pattern's identity-stability benefit
- **File:** `packages/client/src/hooks/useEditorMutation.ts:95`
- **Bug:** `return { run };` — new object literal each render. `run` itself is memoized via `useCallback(..., [args.editorRef])` (stable, since `editorRef` is a stable ref), but the wrapping object is not. All three callers include `mutation` (not `mutation.run`) in their `useCallback` deps, so every render re-creates `handleRestoreSnapshot`, `executeReplace`, and `handleReplaceOne`. That cascades into anything memoized that takes them as props.
- **Impact:** Performance regression vs. the design's intent (the hook was introduced to *remove* render churn, not add it). Not a correctness bug.
- **Suggested fix:** `return useMemo(() => ({ run }), [run]);` at the end of the hook, OR have each caller depend on `mutation.run` rather than `mutation`.
- **Confidence:** High
- **Found by:** Contract & Integration

## Suggestions

- **`packages/client/src/pages/EditorPage.tsx:294-311` and `:444-460`** — duplicated post-success "refresh snapshots + count + setActionInfo" block between `executeReplace` and `handleReplaceOne`. Extract to a helper (`applyReplaceSuccess`) so the next copy-change doesn't diverge.
- **`packages/client/src/pages/EditorPage.tsx:321-330` and `:468-475`** — same duplication on the `stage: "reload"` branch; 5 near-identical lines each.
- **`packages/client/src/pages/EditorPage.tsx:997-1037` (`SnapshotPanel.onView`)** — hand-composes flush + setEditable + cancelPendingSaves outside the hook. CLAUDE.md explicitly sanctions this, but `onView` ignores the hook's `inFlightRef`, so it can race a mutation. If this path is ever modified, consider routing through `mutation.run` with a no-op directive (`clearCacheFor: [], reloadActiveChapter: false`) to get the cross-caller busy guard for free.
- **`packages/client/src/hooks/useEditorMutation.ts:46-48, 88`** — `editor` captured at start; finally calls `setEditable(true)` on the captured handle. After a successful reload, `chapterReloadKey` bumps and `<Editor>` remounts with a new handle. The old handle's `setEditable(true)` is a safe no-op (guarded by `isDestroyed` in `Editor.tsx:309`), but the stated intent ("re-enable the editor the user is looking at") is lost. Consider re-reading `args.editorRef.current` in the finally.
- **`packages/client/src/hooks/useEditorMutation.ts:33-36`** — `useEffect` without a deps array runs after commit. Extremely narrow theoretical window where a caller invoking `run` during commit would see stale `projectEditorRef.current`. Current callers only invoke `run` from event handlers, so unreachable, but `useLayoutEffect` (or a bare assignment at the top of the hook body) is the more idiomatic latest-ref pattern.
- **`packages/client/src/hooks/useEditorMutation.ts:50-57`** — `flushed === false` synthesizes `new Error("flushSave returned false")`, losing the underlying `saveErrorMessage` that `handleSave` already set on the `useProjectEditor` state. Consider surfacing the real error or referencing the banner already shown.
- **`packages/client/src/hooks/useEditorMutation.ts:50`** — null-editor treatment: `await editor?.flushSave()` returns `undefined`; `undefined === false` is false, so the pipeline proceeds. This matches the design doc's "null editor is no-op, proceed to cache/reload" intent, but the behavior is implicit — a one-line `if (!editor) { /* intentional no-op */ }` would make it self-documenting and protect against a future `flushSave` shape change returning `undefined`.
- **`packages/client/src/hooks/useEditorMutation.ts:47-90`** — the outer try/finally catches nothing. If `editor?.setEditable(false)`, `cancelPendingSaves()`, `markClean()`, or `clearAllCachedContent()` ever threw synchronously (none do today), the hook would reject rather than return a typed `MutationResult`. Low probability, but inconsistent with the "every failure has a stage" contract. Wrap in try/catch and return `{ok: false, stage: "mutate", error}` for unexpected throws.
- **CLAUDE.md:87 (save-pipeline invariant 4)** — the invariant is described as "bump the sequence ref before the request, not after." The hook satisfies invariant 4 for `reloadActiveChapter` (which bumps `selectChapterSeqRef` before its GET) but does not bump any seq ref around the `mutate()` call itself — single-flight `inFlightRef` is the guarantee. Consider updating the CLAUDE.md wording so future readers understand that a single-flight gate also satisfies this invariant.
- **Scope drift:** `.claude/skills/roadmap/SKILL.md` has +42/-2 changes unrelated to Phase 4b.1 (adds CLAUDE.md-drift check, alignment step, and renumbers sections). These are workflow improvements but violate the one-feature PR rule from CLAUDE.md §Pull Request Scope. Consider splitting into a separate PR.
- **`packages/client/src/hooks/useProjectEditor.ts:36-42, 178-189`** (pre-existing) — `saveBackoffRef` has no cleanup on `useProjectEditor` unmount. If EditorPage unmounts during a retry backoff, the timer still fires and the loop attempts `api.chapters.update` + state writes on an unmounted component. Not introduced by this PR, but relevant if anyone hardens the mutation pipeline further.

## Plan Alignment

**Plan/design docs consulted:** `docs/plans/2026-04-19-editor-orchestration-helper-design.md`, `docs/plans/2026-04-19-editor-orchestration-helper-plan.md`, `docs/roadmap.md`.

- **Implemented:** `useEditorMutation` hook with the planned types and 9-step sequence; three call-site migrations with sentinel errors (`RestoreAbortedError`, `RestoreFailedError`) and stage-to-UI routing; hook unit test covering happy path, each failure stage, busy guard, null ref, and latest-ref pattern; CLAUDE.md closing sentence added.
- **Not yet implemented:** Roadmap row for Phase 4b.1 is "In Progress" — acceptable pre-merge.
- **Deviations:**
  - `MutationResult` type is tighter than the design: `error` is required for `flush`/`mutate`, optional+string for `reload`, omitted for `busy`. Functionally equivalent.
  - Hook adds a second flush-failure trigger: `flushSave()` resolving `false` (not just reject). Test at `useEditorMutation.test.tsx:142-163` locks this in.
  - `restore.reason ?? "unknown"` uses `"unknown"` as the fallback (a valid `RestoreFailureReason`), where the design sketch used `"other"`. Not a regression — the runtime handling in the caller routes unknown reasons to the generic banner.
- **Scope drift:** `.claude/skills/roadmap/SKILL.md` (+42/-2) is unrelated workflow tooling bundled into this refactor PR.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment (6 specialists in parallel)
- **Scope:** `packages/client/src/hooks/useEditorMutation.ts` (new), `packages/client/src/hooks/useEditorMutation.test.tsx` (new), `packages/client/src/pages/EditorPage.tsx`, `packages/client/src/__tests__/EditorPageFeatures.test.tsx`, CLAUDE.md; adjacent reads: `useProjectEditor.ts`, `useSnapshotState.ts`, `useContentCache.ts`, `components/Editor.tsx`, `utils/findReplaceErrors.ts`
- **Raw findings:** 31 (before verification)
- **Verified findings:** 6 important + 10 suggestions (after dedup + code re-read)
- **Filtered out:** ~15 (defensive/theoretical paths, pre-existing issues unchanged by this PR, or behaviors explicitly sanctioned by CLAUDE.md)
- **Steering files consulted:** `CLAUDE.md` (save-pipeline invariants checked against hook implementation; invariant 4 wording noted as lagging the single-flight mechanism)
- **Plan/design docs consulted:** `docs/plans/2026-04-19-editor-orchestration-helper-design.md`, `docs/plans/2026-04-19-editor-orchestration-helper-plan.md`, `docs/roadmap.md`
- **Security:** no findings (DOMPurify config unchanged, no new sinks, error messages route through `STRINGS.*` constants, localStorage key injection not a concern in single-user app)
