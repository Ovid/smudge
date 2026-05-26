# Agentic Code Review: consumer-recovery-completeness

**Date:** 2026-05-26 12:32:46
**Branch:** `consumer-recovery-completeness` -> `main`
**Commit:** `aad9cb117f46f0693cebe028cf9c6b2d302f7428`
**Files changed:** 29 | **Lines changed:** +5,393 / -311
**Diff size category:** Large (production code ~500 lines, the bulk is plan/design documentation)

## Executive Summary

Phase 4b.3c.1 lands the consumer-recovery foundation — `applyMappedError` + `STOP` + `MappedError<S>` phantom + `ScopeExtras<S>` + `devWarn` — and mechanically migrates ~15 ladder consumers. The mechanical migration itself is clean: Logic, Error Handling, Concurrency, and Security specialists all returned zero findings, confirming the migrations preserve pre-migration semantics. The most actionable issue is a **missing migration** (Important): `useSnapshotState.viewSnapshot` was promised in the plan's Task 10 and the design's "all ~16 simple-ladder sites migrated" DoD, but the file has no diff against `main`. Remaining findings are Suggestion-tier: a `terminalCodes` contract gap in the post-loop lock-banner block, the `chapter.flushBeforeNavigate` scope attached to an unreachable catch, a commented-out `ScopeExtras<S>` negative test, an `S15`/`S18` commit-tag drift, and two latent type-asymmetry notes. One out-of-scope addition (unrelated planning docs for Phase 4b.14 + 8b in commit `a1eb3a4`).

## Critical Issues

None found.

## Important Issues

### [I1] Task 10 (useSnapshotState.viewSnapshot ladder migration) not landed
- **File:** `packages/client/src/hooks/useSnapshotState.ts:334`
- **Bug:** The plan (`docs/plans/2026-05-26-consumer-recovery-completeness-plan.md:1063`) lists Task 10 as a 4b.3c.1 simple-ladder migration (`viewSnapshot` abort gate → `applyMappedError`), and the design DoD (`design.md:443`) declares "All ~16 simple-ladder sites migrated to applyMappedError". `git diff main..HEAD -- packages/client/src/hooks/useSnapshotState.ts` returns empty; no commit in `git log main..HEAD` matches the file; line 334 still uses the unmigrated `if (mapApiError(err, "snapshot.view").message === null) { return ... }` form.
- **Impact:** Binary DoD is contradicted. The migration sweep is the entire premise of S15, and the omission is silent — no decision-log entry, no roadmap deferral. A future ladder-style regression in `viewSnapshot` won't be caught by review against the new convention.
- **Suggested fix:** Land the missing Task 10 commit in this PR before merge (mechanical Pattern P1 swap, ~10 lines). If the work is being deferred to 4b.3c.2/.3, update the design's "All ~16" DoD line and the plan's Task 10 row to reflect the deferral so the spec stops promising what the PR doesn't deliver.
- **Confidence:** High
- **Found by:** Spec Compliance (`claude-opus-4-7[1m]`)

## Suggestions

- **[S1] `useProjectEditor.handleSave` lock-banner block duplicates the scope's `terminalCodes` contract.** `packages/client/src/hooks/useProjectEditor.ts:624-632` — the post-loop lock-banner branch still hand-codes `terminalSaveError.status === 404 || code === "BAD_JSON" || code === "UPDATE_READ_FAILURE" || code === "CORRUPT_CONTENT"` even though the in-loop break at line 486 already routes through `mapped.terminal || mapped.possiblyCommitted`. The scope's own comment at `scopes.ts:161-162` claims "adding a fourth terminal code is a one-line scope edit" — that promise is false for the lock-banner. Route 624-632 through `mapped.terminal || mapped.possiblyCommitted` (re-derive `mapped` from `lastErr` or thread `mapped` out of the loop). Confidence: Medium. Found by: Contract & Integration (`claude-opus-4-7[1m]`).
- **[S2] `chapter.flushBeforeNavigate` scope attached to a catch that does not catch flush failures.** `packages/client/src/pages/EditorPage.tsx:1517-1525` — `switchToView` was refactored to no longer throw on flush failure (returns `false` and surfaces `STRINGS.editor.viewSwitchSaveFailed` itself), and `handleSelectChapter` catches all its own errors internally via `applyMappedError(mapApiError(err, "chapter.load"), …)`. The outer try/catch in `handleSelectChapterWithFlush` is unreachable under normal control flow; the new "Unable to save your changes before switching chapters" copy only fires defensively. Either move the `applyMappedError(..., "chapter.flushBeforeNavigate")` call inside `switchToView`'s `catch` branch (line 1402-1411) where a flush failure is observable, or revert the scope swap on line 1522 to `chapter.load` and remove `chapter.flushBeforeNavigate` from `scopes.ts`. Confidence: Medium. Found by: Contract & Integration (`claude-opus-4-7[1m]`).
- **[S3] `ScopeExtras<S>` negative compile-time test is commented out.** `packages/client/src/errors/scopeExtras.test.ts:30-38` — the plan/design DoD promises the negative test "passes" ("`mapApiError(err, "chapter.load")` paired with `onExtras` fails to type-check"); the implementation keeps it only as a code comment with justification "the `@ts-expect-error` form is noisy". A regression in the `never` conditional would no longer be caught by the suite. Enable the test with `@ts-expect-error`, or amend the DoD to admit prose-only enforcement. Confidence: High. Found by: Spec Compliance (`claude-opus-4-7[1m]`).
- **[S4] `ScopeExtras<S>` distributes over scope unions; bare `MappedError` widens `onExtras` silently.** `packages/client/src/errors/scopeExtras.ts:7-8` — `MappedError`'s default parameter is the full `ApiErrorScope` union, so a future `const m: MappedError = mapApiError(...)` (without `<S>`) types `onExtras` as the union of every scope's extras shape, defeating the phantom narrowing claim. No consumer in the diff exhibits the widening today, but the latent surface degrades as more scopes add `extrasFrom`. Either drop the default parameter (`MappedError<S extends ApiErrorScope>` with no default) so bare uses become typecheck errors, or document the widening in the type's docblock. Confidence: Medium. Found by: Contract & Integration (`claude-opus-4-7[1m]`).
- **[S5] `mapApiErrorMessage` accepts bare `ApiErrorScope`; asymmetric with `mapApiError<S>`.** `packages/client/src/errors/apiErrorMapper.ts:213-215` — the convenience wrapper still has signature `(err, scope: ApiErrorScope, fallback)` while its sibling `mapApiError<S>` (line 200) gained the phantom this branch. Since `mapApiErrorMessage` only returns `string`, the missing `<S>` has no current downstream impact, but the codebase now has two access patterns with diverging type contracts. Add `<S extends ApiErrorScope>` for symmetry, or document why it intentionally stays unparameterized. Confidence: Medium. Found by: Contract & Integration (`claude-opus-4-7[1m]`).
- **[S6] SnapshotPanel commit message tag is `S18`; plan promised `S15`.** Commit `2629dbe` — the plan (`plan.md:1071`) prescribes `(4b.3c.1 S15)`; the actual commit reads `(4b.3c.1 S18)`. The tagging convention is how the PR is audited against the plan's commit table; a grep-by-tag audit would undercount S15 by 1 and overcount S18 (which 4b.3c.1 was supposed to leave alone). Re-tag the commit, or update the plan's commit table to admit the SnapshotPanel migration also covers S18. Confidence: Medium. Found by: Spec Compliance (`claude-opus-4-7[1m]`).

## Out-of-Scope Additions

> **Handoff instructions for any agent processing this report:** The entries below are code this branch added that the spec did not promise. They may be legitimate "while I'm here" fixes for issues exposed by this work, or scope creep that should live in a separate PR. Do **not** assume they should stay on this branch, and do **not** assume they should be reverted. Present them to the user **as a single batched ask**: "These M additions weren't promised by the spec — keep, split into a separate PR, or revert?" The user decides per item.
>
> Out-of-scope additions are flagged for this PR only — they do not persist to `paad/code-reviews/backlog.md`.

### [OOSA1] Unrelated planning docs for Phase 4b.14 + Phase 8b bundled into 4b.3c.1
- **Files:**
  - `docs/plans/2026-05-26-bundle-export-roundtrip-design.md` (Phase 8b, NEW — 360 lines)
  - `docs/plans/2026-05-26-operational-backup-stopgap-design.md` (Phase 4b.14, NEW — 240 lines)
  - `paad/pushback-reviews/2026-05-26-bundle-export-roundtrip-pushback.md` (Phase 8b, NEW — 118 lines)
  - `docs/roadmap.md` (edits adding Phase 4b.14 and expanding Phase 8b)
- **Addition:** A single commit on this branch lands ~880 lines of design/planning documentation for two unrelated phases (4b.14 Operational Backup Stopgap; 8b Bundle Export Roundtrip). Neither phase is part of Phase 4b.3c.1's plan, design, or decision log — they target a different roadmap area (backup/export, not consumer recovery).
- **Suggested intent source:** Treated as the spec: `docs/plans/2026-05-26-consumer-recovery-completeness-plan.md`, `docs/plans/2026-05-26-consumer-recovery-completeness-design.md`, `docs/roadmap-decisions/2026-05-26-phase-4b-3c-consumer-recovery-completeness.md`. CLAUDE.md §Pull Request Scope: "A PR delivers a single feature *or* a single refactor — never both, and never two features." The 2026-05-25 Phase 4b.3b allowlist sweep is documented as "the first such recorded exception"; this is a second exception with no decision-log entry justifying it.
- **Confidence:** High
- **Found by:** Spec Compliance (`claude-opus-4-7[1m]`)

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Spec Compliance (6 specialists, all `claude-opus-4-7[1m]`).
- **Scope:** Changed files — `packages/client/src/errors/{apiErrorMapper,applyMappedError,scopeExtras,devWarn,index,scopes}.ts` + tests, `packages/client/src/hooks/{useProjectEditor,useFindReplaceState,useTrashManager}.ts`, `packages/client/src/components/{ImageGallery,SnapshotPanel,DashboardView,ExportDialog}.tsx`, `packages/client/src/pages/{HomePage,EditorPage}.tsx`, `packages/client/src/strings.ts`, `e2e/chapter-create-recovery.spec.ts`. Adjacent traced: `packages/client/src/hooks/useSnapshotState.ts`, `packages/client/src/hooks/useEditorMutation.ts`, `packages/client/src/components/EditorFooter.tsx`, `packages/server/src/images/images.service.ts`.
- **Raw findings:** 10 (Logic 0, Error Handling 0, Contract 6, Concurrency 0, Security 0, Spec 4).
- **Verified findings:** 8 (1 Important, 6 Suggestion, 1 Out-of-Scope Addition).
- **Filtered out:** 2 (specialist-acknowledged non-defects at confidence 60).
- **Out-of-scope findings:** 0 (Critical: 0, Important: 0, Suggestion: 0).
- **Out-of-scope additions:** 1.
- **Backlog:** 0 new entries added, 0 re-confirmed (see `paad/code-reviews/backlog.md`).
- **Steering files consulted:** `CLAUDE.md`.
- **Intent sources consulted:** `docs/plans/2026-05-26-consumer-recovery-completeness-plan.md`, `docs/plans/2026-05-26-consumer-recovery-completeness-design.md`, `docs/roadmap-decisions/2026-05-26-phase-4b-3c-consumer-recovery-completeness.md`, recent commit messages on the branch.
- **Verifier warnings:** none.
