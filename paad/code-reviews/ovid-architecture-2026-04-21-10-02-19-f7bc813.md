# Agentic Code Review: ovid/architecture

**Date:** 2026-04-21 10:02:19
**Branch:** ovid/architecture -> main
**Commit:** f7bc81301d62cac72bb9003444f97ea8058083bb
**Files changed:** 46 | **Lines changed:** +8901 / -369
**Diff size category:** Large

## Executive Summary

Phase 4b.1 ("Editor Orchestration Helper") is structurally sound — the new `useEditorMutation` hook enforces the documented save-pipeline invariants for its three intended call sites (restore, replace-one, replace-all), and the hook itself has high test coverage after many rounds of iterative review. No Critical issues. Four **Important** findings remain, three of which concern gaps at the boundary between the hook and its surrounding orchestration in `EditorPage.tsx` / `useProjectEditor.ts`: specifically the delete-chapter path not being gated on the lock banner (C-3), the `possibly_committed` restore branch locking the wrong editor after a mid-flight chapter switch (E-6), `projectSlugRef` staleness during URL-driven navigation (C-1), and a narrow supersession-plus-cache-clear window in project-scope replace (C-2). Plan alignment is largely on-track, but the PR materially exceeds the design's "5-file, minimal" scope — 46 files, 8,901 insertions, and substantial behavioral changes in `useProjectEditor.ts` (mapSaveError, ReloadOutcome return, cancelInFlightSave/Select split) that the plan's DoD explicitly flagged as out-of-scope.

## Critical Issues

None found.

## Important Issues

### [I1] `projectSlugRef` not synced from the `slug` argument; URL-driven project change creates a race window

- **File:** `packages/client/src/hooks/useProjectEditor.ts:35-38`
- **Bug:** `projectSlugRef.current` is only written from `project.slug` (via in-render assignment) and manually by `handleUpdateProjectTitle` (line 544). When the `slug` argument changes for any other reason — direct URL navigation, browser back/forward, react-router navigate — the ref holds the prior project's slug until `loadProject()` resolves and sets the new `project`. During that gap, callers that read `projectSlugRef.current` (`handleCreateChapter:307`, `handleReorderChapters:517`, `handleUpdateProjectTitle:539`) operate against the previous project.
- **Impact:** A click landing in the inter-project loading window can, for example, `POST /projects/<old-slug>/chapters`, creating a chapter on the project the user just navigated away from. No data loss, but silent cross-project mutation.
- **Suggested fix:** Also write `projectSlugRef.current = slug` whenever the hook's `slug` argument changes, or gate all handlers behind a "project is loaded and matches current slug" check.
- **Confidence:** Medium (70)
- **Found by:** Concurrency & State

### [I2] `possibly_committed` / `unknown` restore branches lock the wrong editor if the user switched chapters mid-flight

- **File:** `packages/client/src/pages/EditorPage.tsx:438-468, 498-510`
- **Bug:** When `handleRestoreSnapshot`'s server call returns 2xx BAD_JSON (`possibly_committed`) or throws with `reason === "unknown"`, the handler uses the closure `activeChapter.id` for `clearCachedContent` (correct — the chapter the restore targeted) but calls `safeSetEditable(editorRef, false)` and `setEditorLockedMessage(...)` which pin the lock to the **currently-active** editor. The happy-path (stage:"reload") uses `useSnapshotState`'s stale-chapter-switch detection, but these two error branches do not.
- **Impact:** User switches chapters while a restore is in flight; response lands; the chapter they're now looking at — which was not touched by the restore — gets a persistent "refresh the page" banner and becomes non-editable.
- **Suggested fix:** Reuse the stale-chapter-switch detection from `useSnapshotState.ts:263-275`. If `activeChapter.id` no longer matches the chapter that was restored, skip the editor lock and surface a dismissible `actionError` instead.
- **Confidence:** Medium (70)
- **Found by:** Error Handling & Edge Cases

### [I3] Project-wide replace: superseded reload + cleared cache can let a keystroke on a newly-active chapter silently overwrite its committed replace

- **File:** `packages/client/src/hooks/useEditorMutation.ts:249-287` (superseded branch)
- **Bug:** In a project-scope replace that affects multiple chapters, `directive.reloadChapterId` is pinned to the chapter active at mutate-start (A). If the user switches to B (also in `clearCacheFor`) during the network round-trip, the hook clears B's cache, re-locks the newly-mounted B editor, then calls `reloadActiveChapter(..., expected=A)` which returns `"superseded"`. Under `reloadSuperseded=true`, the finally re-enables B's editor. B's on-screen content is whatever `handleSelectChapter`'s GET fetched — which may be pre-replace if that GET raced the replace POST. The next keystroke on B saves stale content over the server-committed replace.
- **Impact:** The committed replace for chapter B can be silently reverted by one keystroke. Narrow timing window (requires project-scope replace + chapter switch + GET racing POST), but the window is real and there is no existing defense.
- **Suggested fix:** When `reloadSuperseded` is true AND the current editor's chapter id is in `clearCacheFor`, either reload that chapter explicitly, or keep the editor locked and surface the refresh banner.
- **Confidence:** Medium (65)
- **Found by:** Concurrency & State

### [I4] Delete-chapter path is not gated on the editor-lock banner, and the chapter-id-change effect then clears the banner silently

- **File:** `packages/client/src/pages/EditorPage.tsx:1246-1255` (request) + `:1071-1073` (auto-clear)
- **Bug:** `requestDeleteChapter` gates on `isActionBusy()` but not on `editorLockedMessageRef`. When a lock banner is up (from a failed reload / possibly_committed response) and the user deletes the active chapter, `handleDeleteChapter` switches to another chapter, which fires the `useEffect([activeChapter?.id, chapterReloadKey])` and sets `editorLockedMessage` to null. The banner that was telling the user "refresh the page because your state is ambiguous" vanishes, and the new chapter's editor is enabled. Title-edit hooks and snapshot view already consult `isEditorLocked`; the delete path does not.
- **Impact:** Silent dismissal of a lock banner that was intentionally persistent. Whatever ambiguity triggered the lock is now invisible to the user.
- **Suggested fix:** Add a lock-banner check to `requestDeleteChapter`; for consistency, also consider `handleCreateChapterGuarded`, `handleReorderChaptersGuarded`, and `openTrashGuarded`.
- **Confidence:** Medium-High (75)
- **Found by:** Concurrency & State

## Suggestions

- **[S1]** `useEditorMutation.ts:218-247` — mid-remount re-lock failure returns `{ok: true}` with only a `console.warn` signal; callers can't distinguish from a clean success. Intentional per comments, but a `lockFailed: true` flag on the result would let callers render a non-blocking hint. (C-6/E-3/I-1/L-4 deduped, conf 60)
- **[S2]** `useEditorMutation.ts:343-356` — `setEditable(true)` throw in the finally is swallowed; if it throws on the non-remount path without a lock banner elsewhere, the editor is silently stuck read-only. (conf 60)
- **[S3]** Restore flow open-codes the `finalizeReplaceSuccess`-equivalent bookkeeping across three branches (stage:"reload", possibly_committed, unknown). DRY opportunity aligned with the 4b.1 goal. (conf 80)
- **[S4]** `useChapterTitleEditing.ts` and `useProjectTitleEditing.ts` are structurally near-identical; parameterize into one `useInlineTitleEditing`. (conf 85)
- **[S5]** The hook inlines three `try { setEditable(...) } catch` blocks while `utils/editorSafeOps.ts` exposes `safeSetEditable`. Could consolidate, though full consolidation requires extending the utility to cover the hook's stage-specific error semantics. (conf 65)
- **[S6]** Contradictory comments about whether `Editor.markClean` clears the debounce timer (`useEditorMutation.ts:186-197` vs `EditorPage.tsx` `onBeforeCreate`). Doc drift, one of them is wrong. (conf 60)
- **[S7]** `findReplaceErrors.ts:26, 36-38` — defensive future-proofing opportunities: unknown 400 codes and non-2xx BAD_JSON silently classify into generic retry copy without a `console.warn` to flag server/client version drift. (conf 55)

## Plan Alignment

Documents consulted: `docs/plans/2026-04-19-editor-orchestration-helper-design.md`, `docs/plans/2026-04-19-editor-orchestration-helper-plan.md`, `docs/roadmap.md` (Phase 4b.1).

### Implemented
- New hook `packages/client/src/hooks/useEditorMutation.ts` with the designed `MutationStage` / `MutationDirective` / `MutationResult` / `UseEditorMutationArgs` / `UseEditorMutationReturn` types.
- All three in-scope call sites route through `mutation.run(...)` — `handleRestoreSnapshot` (`EditorPage.tsx:326`), `executeReplace` (`EditorPage.tsx:647`), `handleReplaceOne` (`EditorPage.tsx:891`). Hook used exactly once.
- Invariants 1–4 enforced in the hook's stage ordering (setEditable → flushSave → cancelPendingSaves → markClean → mutate → clearAllCachedContent → reloadActiveChapter → finally re-enable).
- Latest-ref pattern for `projectEditor` via assign-during-render, per design.
- Null editor-ref graceful no-op via `editor?.` guards.
- In-flight busy guard (`inFlightRef`), `isBusy()` probe exposed.
- Reload failure surfaces `data` through `MutationResult` without closure smuggling; replace callers consume `result.data.replaced_count`.
- Sentinel errors (`RestoreAbortedError`, `RestoreFailedError`) for restore.
- `replaceInFlightRef` removed (grep: 0 hits).
- `CLAUDE.md:90` references `useEditorMutation` per design.
- `useEditorMutation.test.tsx` (1053 lines) covers happy path, stage ordering, directive honoring, flush/mutate/reload stages, busy guard, null-ref safety, latest-ref pattern.

### Not yet implemented
- jsdom unmount-clobber integration test (explicitly deferred to e2e per plan Task 14).
- Phases 4b.2 (abortable sequence hook), 4b.3 (unified API error mapper), 4b.4 (raw-strings ESLint) — out of scope.

### Deviations
These do not contradict the spirit of 4b.1 but diverge from the written plan/design:

1. **Scope exceeds the 5-file PR shape** the design specified. Actual diff is 46 files / +8901 / -369, including: new `utils/editorSafeOps.ts`, new `useChapterTitleEditing.ts`, new `useProjectTitleEditing.ts`, modifications to `SnapshotBanner.tsx` / `SnapshotPanel.tsx` / `useFindReplaceState.ts` / `findReplaceErrors.ts` / `strings.ts`, a `docs/roadmap.md` amendment, and 15 PAAD review reports committed under `.claude/skills/`.
2. **`useProjectEditor.ts` behavioral changes** the plan's DoD explicitly excluded: new `mapSaveError()` replacing raw server messages, split `cancelInFlightSave` / `cancelInFlightSelect` helpers, new unmount teardown effect, `ReloadOutcome = "reloaded" | "superseded" | "failed"` replacing a prior boolean return. +308 lines.
3. **`MutationResult.reload` variant drops the `error` field** the plan specified (`Task 7 Step 3`). Design doc also omitted it; code followed the design when plan and design disagreed.
4. **`MutationDirective` is a stricter discriminated union** than the plan (requires `reloadChapterId` when `reloadActiveChapter: true`). Positive deviation.
5. **`reloadActiveChapter` signature evolved** beyond "add an onError callback" — now returns a `ReloadOutcome` string; hook tracks three flags (`reloadFailed`, `reloadSucceeded`, `reloadSuperseded`) in function scope.
6. **`isLocked` predicate on hook args with supersession bypass** — API-level alignment with design, but internal semantics (conservative-default on predicate throw, supersession bypass rules) beyond what was enumerated.
7. **Mid-mutate remount defense** (lines 185-247) — reads `editorRef.current` post-await, attempts to re-lock the fresh editor, has its own reload bail — not in design or plan; legitimate robustness improvement arising from review (C1/I3/I6).
8. **Caller-level `actionBusyRef`** in `EditorPage.tsx` — not designed; extends busy window past `mutation.run()` release to cover post-run banner/refresh (I5).
9. Hand-composed `safeSetEditable` sites remain in `switchToView`, `SnapshotPanel.onView`, `SnapshotPanel.onBeforeCreate` — acceptable per design (§Unchanged call sites) but co-designed with the hook via `safeSetEditable` + `isBusy()` rather than independently vigilant.

## Review Metadata

- **Agents dispatched:** 6 specialists (Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment) + 1 Verifier
- **Scope:** 11 source files under `packages/client/src/` (hooks, pages, components, utils) plus design/plan/roadmap docs
- **Raw findings:** 25 bug findings (from 5 specialists; Security reported 0) + plan alignment report
- **Verified findings:** 4 Important + 7 Suggestions
- **Filtered out:** 14 rejected or deduped (see Rejected section below)
- **Steering files consulted:** `CLAUDE.md` (§Save-pipeline invariants, §API Design, §Testing Philosophy, §Pull Request Scope)
- **Plan/design docs consulted:** `docs/plans/2026-04-19-editor-orchestration-helper-design.md`, `docs/plans/2026-04-19-editor-orchestration-helper-plan.md`, `docs/roadmap.md`

### Rejected findings (for transparency)

- `actionBusyRef` TOCTOU — no await between check and latch; JS single-threaded.
- `restoreSnapshot` unconditional `setViewingSnapshot(null)` — already guarded by stale-chapter-switch detection and chapter-change effect.
- `setEditable` / `markClean` shared try/catch — flush-stage throw correctly prevents mutate from running, so the "partial state" is not reachable.
- `restoreReachedServer` assignment placement — correct today; "future code could break this" is defensive concern only.
- `"unknown"` reason drops original error — nice-to-have debuggability, not a current user-facing bug.
- 413 preserves cache — designed behavior; the persistent banner IS the user signal per CLAUDE.md §API Design.
- Inline mappers (`mapSaveError`, restore reason ladder) — subjective refactor, not bugs.
- `editor` non-null + `editorAfterMutate === null` — cannot land keystrokes on a destroyed-not-remounted editor.
- "superseded" contract ambiguity — latent; no current caller triggers it.
