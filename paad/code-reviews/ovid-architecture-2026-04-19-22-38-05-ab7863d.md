# Agentic Code Review: ovid/architecture

**Date:** 2026-04-19 22:38:05
**Branch:** ovid/architecture -> main
**Commit:** ab7863dc433dd03d97a6bbcdf67ce6cd6b851b74
**Files changed:** 13 | **Lines changed:** +2792 / -258
**Diff size category:** Large (docs + plan documents dominate; code change is concentrated in `useEditorMutation.ts` + three migrated call sites in `EditorPage.tsx` + the `reloadActiveChapter` signature extension in `useProjectEditor.ts`)

## Executive Summary

Phase 4b.1 (editor-orchestration helper) is substantively complete: `useEditorMutation` extracts the save-pipeline-invariant sequence into a single hook, three call sites are migrated, and the earlier review's I1–I6 have follow-up fix commits. **One Critical issue is outstanding**: `inFlightRef` can get stuck `true` for the session if `setEditable(false)` throws synchronously, because both statements sit outside the hook's `try`/`finally`. Two Important UX-discipline issues remain — a dismissible "editor is read-only" banner that hides its own semantic once dismissed, and unguarded `flushSave` entry points (`switchToView`, `SnapshotPanel.onView`) that race with an in-flight `mutation.run`. Six suggestions follow.

## Critical Issues

### [C1] `inFlightRef` can get stuck true if `editor.setEditable(false)` throws synchronously
- **File:** `packages/client/src/hooks/useEditorMutation.ts:53-64`
- **Bug:** The `try` block starts at line 64. Before it, lines 53–55 run: `inFlightRef.current = true` → `const editor = args.editorRef.current` → `editor?.setEditable(false)`. If `setEditable` throws synchronously (TipTap can throw in destroyed-editor / mid-remount edge states), the `finally` that clears `inFlightRef.current = false` never executes. Every subsequent `mutation.run` for the rest of the session returns `{ok: false, stage: "busy"}` — which all three callers display as `STRINGS.editor.mutationBusy` and then early-return.
- **Impact:** Session-long lock-out of snapshot restore, replace-one, and replace-all. User must refresh the page to recover. The defense-in-depth flag itself becomes a latch.
- **Suggested fix:** Move `inFlightRef.current = true` and `editor?.setEditable(false)` inside the `try` block, so the `finally` always runs. The `let reloadFailed = false` can stay at the top since it cannot throw.
- **Confidence:** High
- **Found by:** Concurrency & State (verified by reading current code)

## Important Issues

### [I1] Dismissible "editor is read-only" banner leaves the user silently unable to type
- **File:** `packages/client/src/hooks/useEditorMutation.ts:104-107` + banners at `packages/client/src/pages/EditorPage.tsx:255` (`restoreSucceededReloadFailed`) and `:351, 501` (`replaceSucceededReloadFailed`)
- **Bug:** The I1 fix (from the prior review round) correctly keeps `editor.setEditable(false)` when reload fails — the editor is holding pre-mutation content and must not be typed into. The fix routes the failure through `setActionError(...)` which renders in `ActionErrorBanner` with a dismiss `✕`. Once the user dismisses the banner, the editor stays read-only but the only user-visible signal of that state is gone — keystrokes are swallowed silently and the user cannot tell whether the app is broken, stuck, or just not receiving input.
- **Impact:** UX trap. No data loss (the read-only state is load-bearing — re-enabling would cause the stale-content revert the I1 fix was designed to prevent), but the user's recovery path is implicit (navigate to another chapter or refresh) and not signposted anywhere once the banner is dismissed.
- **Suggested fix:** Either (a) remove `onDismiss` on the banner when the cause is a reload failure (keep it persistent), (b) make the banner a "Refresh now" action that reloads the page, or (c) surface a persistent footer indicator (e.g. a "Editor locked — refresh to resume" state in `EditorFooter` tied to a new `saveStatus === "locked"`).
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases, Concurrency & State (two specialists independently)

### [I2] `flushSave` is callable from multiple entry points without consulting `mutation.inFlightRef`
- **File:** `packages/client/src/pages/EditorPage.tsx:640` (`switchToView`), `:1049` / `:1074` (`SnapshotPanel.onView` / `onBeforeCreate`)
- **Bug:** The cross-caller busy guard (single `useEditorMutation()` instance at `:149`) works only for callers that route through `mutation.run`. `switchToView`, `SnapshotPanel.onView`, and `SnapshotPanel.onBeforeCreate` hand-compose `setEditable(false)` + `flushSave()` + `cancelPendingSaves()` without checking the hook's `inFlightRef`. During an in-flight `mutation.run` (say, a Replace-All mid-roundtrip), the user can still click a sidebar chapter or a snapshot's View button. Two races surface:
  1. `switchToView` → `handleSelectChapterWithFlush` calls `editorRef.current?.flushSave()`. The hook's `handleSave` aborts the previous save controller (`useProjectEditor.ts:133`). The mutation hook's awaited `flushSave()` then resolves `false`, and the hook returns `stage: "flush"`. The caller surfaces "Replace failed because save failed first" — while the content actually persisted via the new save cycle triggered by the view switch.
  2. `onView`'s error branch calls `editorRef.current?.setEditable(true)` (`:1054, 1065, 1069`), which can re-enable the editor mid-mutation while `mutation.run` expects it disabled. The user could type during the replace's server window.
- **Impact:** False-negative save-failure banners on benign races; a brief window where invariant #2 (`setEditable(false)` around any mid-flight mutation) is violated from the outside. Narrow timing but reproducible — the exact shape of race the hook was designed to eliminate.
- **Suggested fix:** Expose `mutation.isBusy()` on the hook's return (a simple `() => inFlightRef.current` read) and early-return from `switchToView`, `onView`, `onBeforeCreate`, and `handleSelectChapterWithFlush` when busy, surfacing `STRINGS.editor.mutationBusy` the same way the existing callers do.
- **Confidence:** Medium (race window is narrow; user has to click a second control during the hook's ~100–14000ms flush window)
- **Found by:** Logic & Correctness, Contract & Integration, Concurrency & State (three specialists)

## Suggestions

- **`packages/client/src/pages/EditorPage.tsx:313-332` vs `:468-502`** — `executeReplace` and `handleReplaceOne` duplicate ~18 lines of post-mutation bookkeeping across four near-identical branches (`ok` and `stage:"reload"` × two callers). Extract a `finalizeReplaceSuccess({ replacedCount, reloadFailed })` helper to eliminate the divergence risk the prior review also flagged.
- **`packages/client/src/__tests__/EditorPageFeatures.test.tsx`** — grep returns zero hits for `mutationBusy`. The `STRINGS.editor.mutationBusy` banner is the user-visible surface for I3 (surfacing busy instead of silent-drop). Extend the existing rapid-double-click test at `:1373` to assert `screen.findByText(STRINGS.editor.mutationBusy)` so the banner can't silently regress.
- **`packages/client/src/pages/EditorPage.tsx:287-288, 443-444, 203-204`** — the I5 fix clears `setActionError` and `setActionInfo` on mutation-caller entry but does NOT clear `findReplace.error`. A failed prior search's panel-local error co-displays with a new success banner (e.g. "Replaced 3 occurrences" at top + "Search timed out" inside the panel). Add a `findReplace.clearError?.()` to the caller-entry clears or have the replace callers explicitly reset the panel error before running.
- **`packages/client/src/api/client.ts:86-92` + `packages/client/src/utils/findReplaceErrors.ts:46`** — `apiFetch` tags 2xx responses with unreadable bodies as `ApiRequestError(..., status=200, "BAD_JSON")`. The mapper falls through all status checks and returns `STRINGS.findReplace.replaceFailed`. On a malformed 2xx replace response the server-side replace already succeeded; the user retries and the replace duplicates (or creates a second auto-snapshot). Rare, but add a `code === "BAD_JSON"` branch that surfaces "replace committed but response unreadable — reload before retrying" copy.
- **`packages/client/src/pages/EditorPage.tsx:222-229`** — the `staleChapterSwitch` comment at `:219-222` reads correctly for a reader who knows `useSnapshotState.ts:231-234` only clears cache on the true-stale branch. But `handleRestoreSnapshot` uses the closure `activeChapter.id` for `clearCacheFor` / `reloadChapterId`, while `executeReplace` (`:303, 308`) and `handleReplaceOne` (`:454, 463`) use `getActiveChapter()` live. Document the intentional difference inline so a future reader doesn't "fix" the inconsistency the wrong way (the restore flow IS tied to the chapter that opened the snapshot — that's the correct semantics).
- **PR scope: `.claude/skills/roadmap/SKILL.md`** — the prior review already flagged this as scope drift (+42/-2 unrelated to Phase 4b.1). Still present in this branch. Per CLAUDE.md §Pull Request Scope (one-feature rule), split into its own PR.

## Plan Alignment

**Plan/design docs consulted:**
- `docs/plans/2026-04-19-editor-orchestration-helper-design.md`
- `docs/plans/2026-04-19-editor-orchestration-helper-plan.md`
- `docs/roadmap.md`

- **Implemented:**
  - `useEditorMutation` hook with the 9-step sequence (`useEditorMutation.ts:38-114`).
  - All three call-site migrations (`handleRestoreSnapshot` at `EditorPage.tsx:197-274`, `executeReplace` at `:276-368`, `handleReplaceOne` at `:423-533`).
  - Single `useEditorMutation()` instance (`EditorPage.tsx:149`), preserving cross-caller busy guard.
  - Hook unit test (`useEditorMutation.test.tsx`, 403 lines) covers happy path, flush/mutate/reload failures, busy guard, null ref, latest-ref, and the new `reloadChapterId` (I2) path.
  - CLAUDE.md §Save-pipeline invariants closing sentence added at `CLAUDE.md:90`.
  - `replaceInFlightRef` fully removed.
- **Not yet implemented:** `docs/roadmap.md:31` still reads "In Progress" for Phase 4b.1 — acceptable pre-merge.
- **Deviations (additive, all code review follow-ups):**
  - `reloadChapterId` added to `MutationDirective` and an `expectedChapterId` param to `reloadActiveChapter` — addresses I2 race.
  - `flushSave()` returning `false` now treated as flush-stage failure (not just reject) — additive hardening.
  - `reloadFailed` local flag keeps editor `setEditable(false)` after reload fails — addresses I1 data-loss shape.
- **Scope drift:** `.claude/skills/roadmap/SKILL.md` (+42/-2) is unrelated workflow tooling still bundled in this PR. Prior review's recommendation to split was not actioned.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment (6 specialists in parallel)
- **Scope:** `packages/client/src/hooks/useEditorMutation.ts` + test, `packages/client/src/pages/EditorPage.tsx`, `packages/client/src/hooks/useProjectEditor.ts` (reloadActiveChapter signature), `packages/client/src/strings.ts`, `CLAUDE.md`, `docs/roadmap.md`, `docs/plans/2026-04-19-editor-orchestration-helper-design.md` + `-plan.md`, `.claude/skills/roadmap/SKILL.md`; adjacent reads: `useSnapshotState.ts`, `useFindReplaceState.ts`, `useContentCache.ts`, `components/Editor.tsx`, `utils/findReplaceErrors.ts`, `api/client.ts`, `__tests__/EditorPageFeatures.test.tsx`, `__tests__/useProjectEditor.test.ts`
- **Raw findings:** ~25 (across six specialists)
- **Verified findings:** 1 Critical + 2 Important + 6 Suggestions (after dedup + code re-read)
- **Filtered out:** ~8 (false alarms; theoretical paths contradicted by existing tests; behaviors explicitly sanctioned by CLAUDE.md)
- **Steering files consulted:** `CLAUDE.md` (Save-pipeline invariants; PR scope rules — one-feature violation flagged; String externalization respected by the migration)
- **Plan/design docs consulted:** `docs/plans/2026-04-19-editor-orchestration-helper-design.md`, `docs/plans/2026-04-19-editor-orchestration-helper-plan.md`, `docs/roadmap.md`
- **Security:** no findings. DOMPurify config unchanged; `renderSnapshotContent` at `EditorPage.tsx:53-60` uses `generateHTML(content, editorExtensions)` then `DOMPurify.sanitize(html)` — extension set bounded (StarterKit with heading disabled, Heading levels 3-5, Image with `allowBase64: false`). No new `dangerouslySetInnerHTML`. localStorage keys are scoped UUIDs. All user-facing errors route through `STRINGS.*`.
