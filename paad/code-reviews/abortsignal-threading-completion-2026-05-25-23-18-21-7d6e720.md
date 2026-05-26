# Agentic Code Review: abortsignal-threading-completion

**Date:** 2026-05-25 23:18:21
**Branch:** abortsignal-threading-completion -> main
**Commit:** 7d6e720
**Files changed:** 29 | **Lines changed:** +4085 / -533
**Diff size category:** Large

## Executive Summary

Phase 4b.3b's AbortSignal threading completion is in good shape at HEAD. The eight follow-up commits since the prior review at `63c3049` (I1, I2, I3 fixes plus the S1–S5/S6/S7/S8/S10 cleanups) all landed correctly — six of the seven specialists came back with zero findings, including independent verification that every signal-bearing catch is gated before `console.warn`, that `isAborted()` now matches both `ApiRequestError{ABORTED}` and `DOMException{AbortError}`, that the `sleep()` helper has no listener leak, that the shared `selectChapterOp` race is closed, and that the structural test's tightened regexes catch what they claim. One remaining residual: the new "import-implies-call" structural assertion's `/\.run\s*\(/` is matched by `useEditorMutation`'s `mutation.run(...)` calls, so the assertion silently green-passes for the two files (`EditorPage.tsx`, `useProjectEditor.ts`) that import both hooks.

## Critical Issues

None found.

## Important Issues

None found.

## Suggestions

- **[S1]** `packages/client/src/__tests__/migrationStructuralCheck.test.ts:215` — the new "import-implies-call" assertion uses `const runPattern = /\.run\s*\(/;` (after comment-stripping). `EditorPage.tsx` and `useProjectEditor.ts` import both `useAbortableAsyncOperation` AND `useEditorMutation`; the latter's `mutation.run<...>(...)` callsites satisfy the regex independently. Removing every `useAbortableAsyncOperation`-derived `.run(` from those files (the exact drift this assertion exists to catch) silently green-passes because `mutation.run(` remains. Mock-call assertions in plan Tasks 11/13/14/23/24 provide a behavioral backstop, but the stated structural guarantee fails for the two highest-density hook importers. Fix: match identifier-prefixed `.run(` against names bound from the hook import (e.g. `/\b\w*Op\.run\s*\(/`), or strip-and-reparse to count call sites whose receiver was returned from `useAbortableAsyncOperation()`. (Contract & Integration, conf 75)

## Out of Scope

> **Handoff instructions for any agent processing this report:** The findings below are
> pre-existing bugs that this branch did not cause or worsen. Do **not** assume they
> should be fixed on this branch, and do **not** assume they should be skipped.
> Instead, present them to the user **batched by tier**: one ask for all out-of-scope
> Critical findings, one ask for all Important, one for Suggestions. For each tier, the
> user decides which (if any) to address. When you fix an out-of-scope finding, remove
> its entry from `paad/code-reviews/backlog.md` by ID.

### Out-of-Scope Critical

None found.

### Out-of-Scope Important

None found.

### Out-of-Scope Suggestions

- **[OOSS1]** `packages/client/src/hooks/useSnapshotState.ts:408-410, 473-478` — `restoreFollowupAbortRef` allocation could in theory leak a controller past unmount in a microtask/commit interleaving (cleanup at 475 fires once on tear-down; new controller is assigned at 408-410 after `await promise` resumes at 376). In practice the window is essentially closed because microtasks run before React's macrotask-scheduled commit phase, and the consuming `.then` is `mountedRef`-gated via `freshToken.isStale()` so no setState-on-unmounted-component occurs even in the hypothetical case. Documents a theoretical hole in the S-16 hand-rolled-survivor contract that Phase 4b.4's inline-justification ESLint rule will inherit. **Reclassification note:** the prior review on this branch (`63c3049`) raised the same finding as in-scope Suggestion S9; the touched-lines map for this re-review shows the functional anchors at 408-410 and 473-478 are NOT touched by this branch (only adjacent comment-expansion lines 403-407 and 471-472 are), so the verifier reclassified to out-of-scope per the blame-default rule. backlog id: `20eccaf3` (first logged 2026-05-25 on branch `abortsignal-threading-completion`).

## Review Metadata

- **Agents dispatched:** Logic & Correctness (×2 — Logic-A: api/utils/dialogs/HomePage; Logic-B: useProjectEditor/useSnapshotState/EditorPage), Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Spec Compliance
- **Scope:** packages/client/src/api/client.ts, utils/abortable.{ts,test.ts}, hooks/useProjectEditor.ts, hooks/useSnapshotState.ts, hooks/useAbortableAsyncOperation.{ts,test.ts}, components/{ExportDialog,ProjectSettingsDialog,SnapshotPanel}.tsx, pages/{EditorPage,HomePage}.tsx, errors/apiErrorMapper.{ts,test.ts}, __tests__/{api-client,EditorPageFeatures,HomePage,KeyboardShortcuts,migrationStructuralCheck,useProjectEditor,useSnapshotState}.test.{ts,tsx}, docs/plans/2026-05-25-abortsignal-threading-completion-{design,plan}.md, docs/roadmap-decisions/2026-05-25-phase-4b-3b-abortsignal-threading-completion.md, docs/roadmap.md, docs/roadmap-decisions/INDEX.md, CLAUDE.md
- **Raw findings:** 2 (before verification, across 7 specialists)
- **Verified findings:** 2 (1 in-scope Suggestion + 1 out-of-scope Suggestion)
- **Filtered out:** 0 (no duplicates; no specialist-reported "no bug" entries to filter)
- **Out-of-scope findings:** 1 (Critical: 0, Important: 0, Suggestion: 1)
- **Out-of-scope additions:** 0
- **Backlog:** 1 new entry added (`20eccaf3`), 0 re-confirmed (see `paad/code-reviews/backlog.md`)
- **Steering files consulted:** /workspace/CLAUDE.md
- **Intent sources consulted:** docs/plans/2026-05-25-abortsignal-threading-completion-design.md, docs/plans/2026-05-25-abortsignal-threading-completion-plan.md, docs/roadmap-decisions/2026-05-25-phase-4b-3b-abortsignal-threading-completion.md, docs/roadmap.md, branch name, commit messages, prior review at 63c3049
- **Verifier warnings:** none
