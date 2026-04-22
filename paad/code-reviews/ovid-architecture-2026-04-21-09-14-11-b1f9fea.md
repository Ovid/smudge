# Agentic Code Review: ovid/architecture

**Date:** 2026-04-21 09:14:11
**Branch:** ovid/architecture -> main
**Commit:** b1f9fea
**Files changed:** 42 | **Lines changed:** +8180 / -365
**Diff size category:** Large

## Executive Summary

This branch introduces `useEditorMutation` — a hook that encapsulates the five save-pipeline invariants from CLAUDE.md — and routes snapshot-restore and find-and-replace through it. The core hook and its three call sites are structurally correct; no Critical bugs found. Two **Important** gaps appear in adjacent title-editing paths that were *not* migrated to the hook: the chapter-inline title rename bypasses `isActionBusy`, and neither title-editing hook gates on the lock banner — both can race in-flight replace/restore mutations and violate the lock-banner contract. The remaining findings are accessibility polish and dead-code/asymmetry nits.

## Critical Issues

None found.

## Important Issues

### [I1] Chapter inline title editing bypasses `isActionBusy` gate
- **File:** `packages/client/src/hooks/useChapterTitleEditing.ts:45` (consumer at `packages/client/src/pages/EditorPage.tsx:1010`)
- **Bug:** `useChapterTitleEditing` receives raw `handleRenameChapter` with no busy predicate. The sidebar rename path wraps it with `handleRenameChapterWithError` (EditorPage.tsx:1102) which gates on `isActionBusy()`; the inline title editor (Enter/blur inside `onKeyDown` at ~1609) calls the raw `saveTitle` and skips that gate.
- **Impact:** During a 2–14s save-backoff window or an in-flight replace, double-clicking the chapter title, typing, and pressing Enter issues a `PATCH /chapters/{id}` that races the mutation writing the same row — the I4 regression class the project-title path was recently hardened against.
- **Suggested fix:** Inject an `isActionBusy?: () => boolean` parameter into `useChapterTitleEditing` and short-circuit `saveTitle` when busy (mirror `useProjectTitleEditing.saveProjectTitle` lines 63–65, keep edit mode open so the draft survives retry).
- **Confidence:** High
- **Found by:** Error Handling — Group B

### [I2] Title editing hooks do not gate on lock banner
- **File:** `packages/client/src/hooks/useProjectTitleEditing.ts:50-65`, `packages/client/src/hooks/useChapterTitleEditing.ts:45-72`
- **Bug:** Neither hook consults `editorLockedMessageRef`. When the lock banner is raised (possibly-committed restore/replace — "refresh; typing would overwrite the server commit"), pressing Enter on a title field still fires a PATCH.
- **Impact:** A title rename during the lock window can race a possibly-committed restore/replace, re-introducing the exact save-pipeline violation the lock banner exists to prevent. `handleSaveLockGated` catches auto-save but not title PATCHes.
- **Suggested fix:** Extend both hooks' save guards to `isActionBusy() || editorLockedMessageRef.current !== null`. Easiest path: pass a combined `isLocked` predicate from EditorPage alongside `isActionBusy`.
- **Confidence:** High
- **Found by:** Error Handling — Group B

## Suggestions

- **[S1] Snapshot view/create don't gate on lock banner** — `packages/client/src/pages/EditorPage.tsx:1695-1808`. `onView`/`onBeforeCreate` check `isActionBusy()` but not the lock banner; when locked, `flushSave` returns `false` via `handleSaveLockGated` and the panel shows `viewFailedSaveFirst`/`createFailed` ("connection/save failed") — contradicts the refresh banner. Early-return `{ ok: false, reason: "locked" }` and add a matching branch in SnapshotPanel. (Error Handling — Group B, Medium)
- **[S2] Info banner dismiss button mislabeled** — `packages/client/src/pages/EditorPage.tsx:1518-1532`, string at `strings.ts:127`. The `actionInfo` banner (`role="status"`) uses `aria-label={STRINGS.a11y.dismissError}` ("Dismiss error") on its close button. Add `STRINGS.a11y.dismissInfo` and use it here. (Error Handling — Group B, High)
- **[S3] "Back to editing" remains enabled while lock banner showing** — `packages/client/src/pages/EditorPage.tsx:1575-1590` + handler at `483-494`. In the restore `unknown`-reason branch, the editor is locked and the cache cleared but `exitSnapshotView()` is not called; clicking Back drops into a locked editor showing pre-restore content while the banner says "editing would overwrite." Disable the Back button (mirror the `canRestore` gate) when `editorLockedMessage !== null`. (Error Handling — Group B, Medium)
- **[S4] `SnapshotPanel.onView` has no `network` reason branch** — `packages/client/src/components/SnapshotPanel.tsx:442-452`. Network-failed snapshot views fall through to generic `viewFailed` copy; replace and restore both have dedicated network messages. Add `network` branch + `viewFailedNetwork` string. (Contract & Integration, High)
- **[S5] Restore mutation-busy path is silent; replace paths announce** — `packages/client/src/pages/EditorPage.tsx:287` vs `608-611` and `851-854`. `handleRestoreSnapshot` returns silently when locked; the other two fire `setActionInfo(mutationBusy)`. Restore button is visually disabled so user-visible impact is nil, but the defense-in-depth asymmetry is worth aligning (either all three announce or all three stay silent with a comment). (Contract & Integration, Medium)
- **[S6] `RestoreFailureReason` declares unreachable `"aborted"` and `"unknown"` members** — `packages/client/src/hooks/useSnapshotState.ts:14-33`. `api.snapshots.restore` passes no `AbortSignal` and no code path produces `"unknown"`. Either remove them from the union (and tighten the `?? "unknown"` fallback at EditorPage:318 with an exhaustiveness check) or wire AbortController. Low priority — currently documented future-proofing. (Contract & Integration, Medium)
- **[S7] `isActionBusy` is optional in `useProjectTitleEditing`** — `packages/client/src/hooks/useProjectTitleEditing.ts:19,63`. The I4-guard parameter defaults to "no guard"; a test double or future caller that omits it silently disables the load-bearing protection. Make the parameter required. (Contract & Integration, Medium)

## Plan Alignment

Plan/design docs consulted:
- `docs/plans/2026-04-19-editor-orchestration-helper-design.md`
- `docs/plans/2026-04-19-editor-orchestration-helper-plan.md`

**Implemented:**
- `useEditorMutation` hook (`packages/client/src/hooks/useEditorMutation.ts`, +366) — all five save-pipeline invariants enforced by construction; discriminated `MutationDirective<T>` union; discriminated `ReloadOutcome`; `isBusy()` surface; `isLocked` predicate with try/catch fallback.
- Hook unit tests (`useEditorMutation.test.tsx`, +1053).
- Three call-site migrations in `EditorPage.tsx`: `handleRestoreSnapshot`, `executeReplace`, `handleReplaceOne`.
- CLAUDE.md updated with canonical-path reference (§Save-pipeline invariants, after invariant 5).
- `replaceInFlightRef` removed.
- `RestoreAbortedError` / `RestoreFailedError` sentinels added.
- `reloadActiveChapter` returns `"reloaded" | "superseded" | "failed"` tri-state.
- Phase 4b.1 marked In Progress in `docs/roadmap.md`.

**Not yet implemented** (expected — out-of-scope for this PR):
- Flip roadmap row to Merged after PR lands.
- Phases 4b.2 / 4b.3 / 4b.4 / 4b.5 cleanup work.

**Deviations** (scope creep vs design-doc §PR scope):
- Design listed roughly 5 files in scope; the branch touches 12 production files (+3,260 lines). Unplanned additions include `editorSafeOps.ts`, the `clearError` method on `useFindReplaceState`, the `isActionBusy` injection into `useProjectTitleEditing`, the `SnapshotBanner` `canRestore` prop, the `SnapshotPanel.onBeforeCreate` discriminated-reason contract, the `possibly_committed`/`aborted` failure reasons in `useSnapshotState`, and the `mapSaveError` + new `strings.ts` error copy (the latter is 4b.3 territory per design doc §Out of scope).
- CLAUDE.md §Pull Request Scope "one-feature rule": the PR bundles the refactor with 80+ `fix(client):` commits (I1–I7, C1/C2, S1–S4). Many are load-bearing regressions the refactor surfaced; others (sidebar rename/status busy-guards, title save gate, snapshot-banner a11y, 4xx save-error externalization) are incidental. A split would better honor the rule. If shipping as-is, note the bundled scope explicitly in the PR description.
- `MutationDirective<T>` tightened beyond the plan: discriminated union requires `reloadChapterId` when `reloadActiveChapter: true`. Beneficial hardening, but exceeds the planned shape.

## Review Metadata

- **Agents dispatched:** Logic & Correctness (A+B), Error Handling & Edge Cases (A+B), Contract & Integration, Concurrency & State, Security, Plan Alignment, Verifier
- **Scope:** 12 changed client source files + 2 plan docs; test files reviewed for contract drift only. Prior-review corpus (`paad/code-reviews/`) consulted for context on I1–I7/C1/C2 fixes.
- **Raw findings:** 15 (before verification)
- **Verified findings:** 9 (after verification)
- **Filtered out:** 6 — Concurrency C1 (EditorHandle is assigned in a `useEffect` with deps `[editor, editorRef]`, not on every render, so `!==` correctly detects TipTap remount); Concurrency C2 (`flushSave` awaits `handleSave` which nulls `saveAbortRef.current` before returning, so `cancelPendingSaves` cannot abort the flush); EB5 (aria-atomic polish, not a defect); EB7 (speculative stale-slug claim in `useFindReplaceState.search` — unverified, no evidence); CI4 (documentation nit, not a bug); CI6 (`ReloadOutcome` design is deliberate and documented).
- **Steering files consulted:** `CLAUDE.md` (save-pipeline invariants, PR scope rules, testing philosophy)
- **Plan/design docs consulted:** `docs/plans/2026-04-19-editor-orchestration-helper-design.md`, `docs/plans/2026-04-19-editor-orchestration-helper-plan.md`, `docs/roadmap.md`
