# Agentic Code Review: find-replace-abort-migration

**Date:** 2026-05-24 09:35:13
**Branch:** find-replace-abort-migration -> main
**Commit:** b21c4bc
**Files changed:** 30 | **Lines changed:** +2318 / -273
**Diff size category:** Large by line count, but **Small in production code** (~89 lines in one file). Bulk is plan/design docs, the agentic-review skill rewrite, the prior-review report file, and the test-helper sweep across 10 files.

## Executive Summary

The core migration of `useFindReplaceState.search` to `useAbortableAsyncOperation` is implemented faithfully against the design's §Behaviour mapping (rows 1–9) and both Plan-vs-Design Notes [D1] and [D2]. No Critical or Important issues; all findings are Suggestion-grade and concentrate on the new `pendingUntilAbort` test helper and the cross-file test sweep that was widened beyond the design's named file scope. Two out-of-scope additions (the 10-file test sweep and the unrelated `.claude/skills/agentic-review/**` rewrite) need a per-PR scope decision.

## Critical Issues

None found.

## Important Issues

None found.

## Suggestions

- **[S1]** `packages/client/src/__tests__/helpers/abortableMocks.ts:22-28` — `pendingUntilAbort` rejects with a raw `DOMException("AbortError")`, but production `apiFetch` wraps every such DOMException into `ApiRequestError(..., 0, "ABORTED")` via `classifyFetchError`. Predicates `isAborted(err)` and `isApiError(err)` only match the wrapped form, so swept tests like `useSnapshotState.test.ts:389-410` route the raw rejection through `useSnapshotState.restoreSnapshot`'s `makeClientCommittedError()` synth-200-BAD_JSON branch — a branch production never reaches on abort. Tests still pass (they only assert `capturedSignal?.aborted === true` and never observe the wrong-branch return value), but the harness is now silently exercising code paths production cannot reach. Fix: reject with `new ApiRequestError("[dev] Request aborted", 0, "ABORTED")`, or document the helper as transport-layer-pre-classification and provide a sibling wrapped helper. (Found by: Logic & Correctness — confirmed by Verifier.)
- **[S2]** `packages/client/src/__tests__/helpers/abortableMocks.ts:22-28` — `pendingUntilAbort` hangs on a pre-aborted signal. `signal?.addEventListener("abort", ...)` only fires on future transitions; an already-aborted signal at attach time means the listener never runs and the promise stays pending. `useAbortableAsyncOperation.run()` deliberately hands the consumer a pre-aborted signal when invoked post-unmount (`useAbortableAsyncOperation.ts:38-49`), so a future post-unmount run() through the helper would hang vitest teardown. Fix: at function entry, check `signal?.aborted` and reject synchronously before registering the listener. (Found by: Logic & Correctness, Error Handling, Contract & Integration — merged by Verifier.)
- **[S3]** `packages/client/src/__tests__/useFindReplaceState.test.ts:48-50` — `captureSignal(callIndex)` uses double non-null assertions (`mock.calls[callIndex]![3]!`). If invoked before the mock has been called (test ordering bug, typo'd index), the resulting `TypeError: Cannot read properties of undefined (reading '3')` is opaque. The helper was extracted to absorb arg-order fragility — readable failure modes belong in the same envelope. Fix: guard with a defensive check that names the helper and the missing index. Optional polish. (Found by: Error Handling — confirmed by Verifier.)
- **[S4]** `packages/client/src/__tests__/helpers/abortableMocks.test.ts:28-40` — test #3 is titled `"does not resolve before abort, even after the signal is provided"` but the body never calls `controller.abort()`; it only verifies pending-while-not-aborted (functionally identical to test #2 modulo signal presence). The misleading name promises an abort-path assertion the test doesn't make. Fix: rename to `"stays pending while the signal is still un-aborted"`, or extend the body to abort and assert the resulting rejection. (Found by: Error Handling — confirmed by Verifier.)
- **[S5]** `packages/client/src/__tests__/useFindReplaceState.test.ts:52-65` — `neverResolvingSearchMock()` is a positional wrapper around `pendingUntilAbort` unique to this file; every other swept test inlines `vi.mocked(api.x.y).mockImplementation((..., signal) => pendingUntilAbort(signal))`. The wrapper provides no type-safety advantage and seeds a parallel idiom. The `7630d37` commit message framed the sweep as a uniform pattern; the find-replace file alone diverges. Fix: delete the wrapper and inline at the three call sites (`:747`, `:784`, `:819`), matching the rest of the sweep. (Found by: Contract & Integration — confirmed by Verifier.)

## Out-of-Scope Additions

> **Handoff instructions for any agent processing this report:** The entries below are code this branch added that the spec did not promise. They may be legitimate "while I'm here" fixes for issues exposed by this work, or scope creep that should live in a separate PR. Do **not** assume they should stay on this branch, and do **not** assume they should be reverted. Present them to the user **as a single batched ask**: "These 2 additions weren't promised by the spec — keep, split into a separate PR, or revert?" The user decides per item.
>
> Out-of-scope additions are flagged for this PR only — they do not persist to `paad/code-reviews/backlog.md`.

### [OOSA1] Test-helper sweep across 10 unrelated test files

- **File:** `packages/client/src/__tests__/helpers/abortableMocks.ts` (new), `packages/client/src/__tests__/helpers/abortableMocks.test.ts` (new), plus sweep edits in `ChapterTitle.test.tsx`, `DashboardView.test.tsx`, `EditorPageFeatures.test.tsx`, `HomePage.test.tsx`, `ImageGallery.test.tsx`, `ProjectSettingsDialog.test.tsx`, `SnapshotPanel.test.tsx`, `useProjectEditor.test.ts`, `useSnapshotState.test.ts`, `useTrashManager.test.ts`.
- **Addition:** The design's §3 "Files modified" names exactly three files (`useFindReplaceState.ts`, `useFindReplaceState.test.ts`, `migrationStructuralCheck.test.ts`). Design §Out of scope further excludes "Other consumers of `useAbortableAsyncOperation`" (deferred to 4b.3a.3 / 4b.3a.4). The sweep introduces a shared test helper and applies it across 10 test files — 7 of which test production code outside this PR's migration target. The prior agentic-review (`paad/code-reviews/find-replace-abort-migration-2026-05-01-17-46-29-2a7297d.md`) flagged the never-resolving-mocks issue as Suggestion [S4] "Hygiene observation only"; the response was to widen the sweep beyond the file under review.
- **Suggested intent source:** Design doc `docs/plans/2026-05-01-find-replace-abort-migration-design.md` §3 File-list and §Out of scope.
- **Per CLAUDE.md §Pull Request Scope:** "One-feature rule. A PR delivers a single feature *or* a single refactor — never both. When in doubt, split."
- **Confidence:** High
- **Found by:** Spec Compliance (`claude-opus-4-7[1m]`)

### [OOSA2] Agentic-review skill rewrite

- **File:** `.claude/skills/agentic-review/SKILL.md` (286 → 195 lines) plus 8 new files under `.claude/skills/agentic-review/references/` (concurrency-state.md, contract-integration.md, error-handling.md, logic-correctness.md, report-template.md, security.md, spec-compliance.md, verifier.md — ~500 lines total).
- **Addition:** Commit `bbd1d57` ("Update agentic-review skill to v1.17.0 with references/ pattern") refactors the agentic-review tooling itself into a SKILL.md + references/ pattern. The find-replace abort migration design/plan never mention the agentic-review skill, much less a refactor of it.
- **Suggested intent source:** Branch name `find-replace-abort-migration` + design doc — both scoped to the production-code migration, not to tooling.
- **Per CLAUDE.md §Pull Request Scope:** Same one-feature-or-one-refactor rule.
- **Confidence:** High
- **Found by:** Spec Compliance (`claude-opus-4-7[1m]`)

## Review Metadata

- **Agents dispatched:** 6 specialists in parallel — Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Spec Compliance. 1 Verifier sequentially.
- **Scope:** `packages/client/src/hooks/useFindReplaceState.ts` (post-migration), `useAbortableAsyncOperation.ts`, `useAbortableSequence.ts`, `useFindReplaceState.test.ts`, `migrationStructuralCheck.test.ts`, the new `__tests__/helpers/abortableMocks.ts` and `.test.ts`, the 10 swept test files and their production targets (`useProjectEditor.ts`, `useSnapshotState.ts`, `useTrashManager.ts`, `ImageGallery.tsx`, `SnapshotPanel.tsx`, `HomePage.tsx`, `EditorPage.tsx`, `DashboardView.tsx`, `ProjectSettingsDialog.tsx`, `ChapterTitle.tsx`), `errors/apiErrorMapper.ts`, `errors/scopes.ts`, `api/client.ts`, the design / plan / roadmap-decision docs.
- **Raw findings:** 10 (Logic 2, Error Handling 3, Contract & Integration 2, Spec Compliance 3; Concurrency clean; Security bailed)
- **Verified findings:** 5 in-scope Suggestions + 2 out-of-scope additions
- **Filtered out:** 3 (L2/E1/C1 collapsed to one finding [S2]; S3 OOSA dropped at confidence 40, below the 60% threshold; nothing else dropped)
- **Out-of-scope findings:** 0 (Critical: 0, Important: 0, Suggestion: 0)
- **Out-of-scope additions:** 2
- **Backlog:** 0 new entries added, 0 re-confirmed; 1 entry **superseded by this branch** and removed (`d0682aab` — `migrationStructuralCheck.test.ts` lacks scaffolding for `useAbortableAsyncOperation` consumers — the new tests at `migrationStructuralCheck.test.ts:96-152` provide exactly the scaffolding that entry requested).
- **Steering files consulted:** `CLAUDE.md` (§Save-pipeline invariants rule 4 — confirmed the migration realizes the `useAbortableSequence` + `useAbortableAsyncOperation` pairing pattern it documents; §Pull Request Scope's one-feature-or-one-refactor rule — drove the OOSA classification; §Testing Philosophy — confirmed coverage and warning expectations).
- **Intent sources consulted:** `docs/plans/2026-05-01-find-replace-abort-migration-design.md`, `docs/plans/2026-05-01-find-replace-abort-migration-plan.md`, `docs/roadmap-decisions/2026-05-01-phase-4b-3a-2-find-replace-abort-migration.md`, branch name, recent commit messages, `paad/code-reviews/find-replace-abort-migration-2026-05-01-17-46-29-2a7297d.md` (prior review, treated as input data not ground truth).
- **Verifier warnings:** none
