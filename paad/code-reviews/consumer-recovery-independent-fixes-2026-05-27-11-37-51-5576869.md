# Agentic Code Review: consumer-recovery-independent-fixes

**Date:** 2026-05-27 11:37:51
**Branch:** `consumer-recovery-independent-fixes` -> `main`
**Commit:** `557686936debde356ef975e8230cf2f1d70590fa`
**Files changed:** 14 | **Lines changed:** +1181 / -56
**Diff size category:** Large

## Executive Summary

Phase 4b.3c.3 bundles the six original "Independent Behavioural Fixes" (I4, S5, S11, S17, S18, S19) plus the second-round review follow-ups (I1, I2, I3, T1, S1, S2, S3). The implementation matches the plan and prior-review remediation lands cleanly. Two **Important** issues remain: the chapter-create committed-recovery branch is missing the sequence-token guard that the trash-restore branch just received (a structurally identical cross-call race that is one user double-click away from silent chapter-loss in the sidebar); and the trash-restore catch lacks a project-identity drift guard before `setActionError`, so a cross-project navigation mid-restore surfaces the committed banner on the wrong project. Three further **Suggestion**-tier items are observability or doc drift. Confidence on the two Important items is high; both are reachable by routine user gestures.

## Critical Issues

None found.

## Important Issues

### [I1] handleCreateChapter committed-recovery branch lacks the sequence-token guard the new I2 fix gave handleRestore

- **File:** `packages/client/src/hooks/useProjectEditor.ts:822-865`
- **Bug:** The recovery branch awaits `api.projects.get(slug, createRecoveryAbortRef.current.signal)` and then merges via `setProject(refreshed)` after an id-only identity check (`projectRef.current?.id === projectId`). No per-call epoch token gates a *second* successful create POST that lands while controllerA's GET is in flight. Reachable scenario: user clicks Add Chapter → POST-A returns 200 BAD_JSON → catch enters recovery, fires GET-A, awaits. User clicks Add Chapter again → POST-B fires via `createChapterOp.run` (aborts the prior POST controller, but `createRecoveryAbortRef` is a *separate* hand-rolled ref and is **not** aborted) → POST-B succeeds → happy-path appends B-chapter into project state at line 753. Then controllerA's GET resolves; `recoveryController.signal.aborted` is false, the same-project id check passes, and `setProject(refreshed)` at line 844 **replaces** the whole project with the server snapshot captured before POST-B landed. B-chapter silently vanishes from the sidebar; `reseedConfirmedStatusesFromProject(refreshed)` at line 853 also drops B's confirmed-status cache entry, breaking the local-revert fallback for any later status PATCH on B. `previousChapterIds` (line 829) was captured before B existed, so `setActiveChapter(newest)` at line 862 then jumps the user back to A's row.
- **Impact:** Real silent-data-loss-and-rug-pull UX on rapid Add-Chapter clicks where the first hits 200 BAD_JSON / READ_AFTER_CREATE_FAILURE. The chapter still exists server-side; the next project reload would surface it. The S17 fix that nulls `createRecoveryAbortRef` on success makes the race *more* likely after this PR, because a successful second create can no longer abort the first's still-pending recovery GET.
- **Suggested fix:** Mirror the `useTrashManager` pattern. Allocate `createSeq = useAbortableSequence()`, call `const createToken = createSeq.start()` at the top of `handleCreateChapter` (before `cancelInFlightSave()`), and gate the recovery branch on `if (createToken.isStale()) return;` after the `await api.projects.get(...)` at line 834 — before touching `setProject`, `reseedConfirmedStatusesFromProject`, or `setActiveChapter`. Mirror `useTrashManager.ts:217`. Capturing `previousChapterIds` *before* the POST (rather than in the catch) closes the subsidiary mis-identification path; alternatively the epoch-token guard makes it moot.
- **Confidence:** High
- **Found by:** Concurrency & State + Contract & Integration (merged)

### [I2] Trash-restore catch fires `setActionError` on the wrong project after A→B navigation mid-restore

- **File:** `packages/client/src/hooks/useTrashManager.ts:163-251`
- **Bug:** EditorPage stays mounted across project navigation (`packages/client/src/App.tsx:23` uses one `<Route path="/projects/:slug" element={<EditorPage />} />` for both slugs — React Router does NOT remount on param-only changes). The handleRestore catch checks `signal.aborted` at line 169 but has no project-identity drift guard before `applyMappedError(mapped, { onMessage: setActionError })` at lines 186-251. If user clicks Restore on project A then navigates A→B before the POST settles, the catch runs while the user is on B; `setActionError(STRINGS.error.restoreChapterCommitted)` fires on B's UI for an action that happened on A. The committed sub-branch already guards `setProject` and the cache reseed via `projectRef.current?.id !== refreshed.id`, but the actionError banner is unconditional.
- **Impact:** User on project B sees "The chapter may have been restored but the server response was unreadable. Refresh to confirm." for an action that happened on a different project they navigated away from. Confusing and unactionable.
- **Suggested fix:** Capture `const restoreStartedForProjectId = projectRef.current?.id;` (or use the existing `restoreToken` from `restoreSeq.start()`) at the top of `handleRestore`, then gate the catch's `applyMappedError` on `if (projectRef.current?.id !== restoreStartedForProjectId) return;` before line 186. Mirrors the same discipline the [I1] fix added to the recovery `.then` at line 224.
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases

## Suggestions

- **Stale `slug` closure in handleCreateChapter recovery GET** — `useProjectEditor.ts:700, 834`. The captured `slug` is read for the recovery GET; a rename via `handleUpdateProjectTitle` (which writes `projectSlugRef.current = updated.slug` at line 1277) between POST and recovery GET leaves the recovery 404'ing against the old slug. The 404 routes through the local catch's `devWarn` (not through `isNotFound`), so it doesn't navigate the user home — but the recovery is silently abandoned and the post-recovery banner from line 886 surfaces with no sidebar refresh. Pairs with the [S2] fix already applied in `useTrashManager.ts:201` (`const currentSlug = slugRef.current;`). Same one-liner fix here: `const recoverySlug = projectSlugRef.current;` immediately before the GET.

- **Snapshot follow-up list error silently swallowed** — `useSnapshotState.ts:466` uses `.catch(() => {})` with no logging, while sibling recovery paths (`useTrashManager.ts:229`, `useProjectEditor.ts:881`) route through `devWarn`. Inconsistent observability; also, the S19 ref-nulling at line 462 only runs inside `.then`, so a real list-fetch failure leaves the ref dangling until the next restore replaces it (benign — abort on a settled controller is a no-op, but inconsistent with the T1/S17 pattern elsewhere in this diff). Replace with `.catch((err) => devWarn("snapshot follow-up list failed", followupController.signal, err))` and move the identity-checked null into `.finally`.

- **CLAUDE.md says three justified-survivor files; allowlist now has four** — `CLAUDE.md:132` reads "three justified-survivor files (HomePage.tsx, useProjectEditor.ts, useSnapshotState.ts)"; `packages/client/src/__tests__/migrationStructuralCheck.test.ts:186-195` enumerates four (the three named plus the newly-added `useTrashManager.ts`). The CLAUDE.md sentence was not updated when the diff added the fourth entry. Update the prose to "four justified-survivor files" and add `useTrashManager.ts` to the parenthetical list with a one-line justification (mirrors the inline comment at `useTrashManager.ts:60-69`).

## Plan Alignment

- **Implemented:** All six original task items (I4, S5, S11, S17, S18, S19) match the plan's task descriptions. The new e2e spec and helper extraction (Task 49) ship as specified. The migrationStructuralCheck allowlist update (Task 38) lands with the ref allocation in a single commit (`a35c8c8`), then the pin test (`36b9c4e`), then the behavioural fix (`562afd3`) — consistent with the 2026-05-26 pushback decision's intent.
- **Not yet implemented:** None — every plan task is in the diff.
- **Deviations:**
  - `reseedConfirmedStatusesFromProject` helper extraction (S1) was added in response to the first agentic review's suggestion (commit `2404822`), not the original plan. Scope-coherent with the I4 fix that would otherwise add a fourth duplicate; CLAUDE.md one-feature rule satisfied.
  - Commits `c1f564c` (I1+S2), `2642697` (I2 sequence-token), `fdc563a` (T1), `3a26ae7` (I3), `5576869` (S3) are review-driven corrections to the same six task surfaces. Each lands with its own pinning test where appropriate.
  - I1's implemented fix is broader than the first review suggested: instead of a captured-at-catch `startedForProjectId`, the diff uses sync-on-render `projectRef`/`slugRef` so the recovery `.then` gates on the *latest* identity. Strictly stricter than the first review's recommendation.

## Review Metadata

- **Agents dispatched:**
  - Logic & Correctness (`general-purpose`) — ordering, identity guards, state transitions
  - Error Handling & Edge Cases (`general-purpose`) — catch paths, dispatched flag, isAborted/isNotFound classification
  - Contract & Integration (`general-purpose`) — new hook options, caller wiring, signature drift, helper extraction
  - Concurrency & State (`general-purpose`) — abort lifecycle, sequence tokens, sync-on-render refs, cross-handler races
  - Security (`general-purpose`) — slug routing, XSS, information disclosure (no findings)
  - Plan Alignment (`general-purpose`) — design/plan vs implementation, decision-log alignment, test coverage
  - Verifier (`general-purpose`) — confirmed/refuted each candidate finding against current code
- **Scope:** all files in the diff (`packages/client/src/{hooks,components,pages,errors,__tests__}`, `e2e/`), one level of callers/callees (`packages/client/src/App.tsx`, `apiErrorMapper.ts`, `applyMappedError.ts`, `useAbortableSequence.ts`, `useAbortableAsyncOperation.ts`, `packages/server/src/projects/projects.routes.ts`), and the prior review at `paad/code-reviews/consumer-recovery-independent-fixes-2026-05-27-08-03-50-be39c67.md`.
- **Raw findings:** 21 (across all specialists, before verification)
- **Verified findings:** 5 (2 Important + 3 Suggestions)
- **Filtered out:** 16 — including three findings the verifier refuted (microtask-gap race that isn't real, `react-hooks/refs` lint rule that does exist in `eslint-plugin-react-hooks` v7, `isNotFound` over-broad classification bounded by the actual server's single 404 path), one finding subsumed by [I1] (`previousChapterIds` capture timing), and twelve test-fragility/style/already-documented items below the importance bar.
- **Steering files consulted:** `CLAUDE.md` (Save-pipeline invariants, PR Scope rules, dependency licenses), prior review report at `paad/code-reviews/consumer-recovery-independent-fixes-2026-05-27-08-03-50-be39c67.md`.
- **Plan/design docs consulted:** `docs/plans/2026-05-26-consumer-recovery-completeness-design.md`, `docs/plans/2026-05-26-consumer-recovery-completeness-plan.md`, `docs/roadmap.md`.
