# Agentic Code Review: find-replace-abort-migration

**Date:** 2026-05-01 17:46:29
**Branch:** find-replace-abort-migration -> main
**Commit:** 2a7297d8e0123f4d8104bd89f755d0eee5b26e8e
**Files changed:** 8 | **Lines changed:** +1503 / -39
**Diff size category:** Small (code-wise: ~74 source lines + ~200 test lines + ~32 structural-check lines; the bulk of the diff is plan/design/roadmap docs)

## Executive Summary

The migration is implemented faithfully against `docs/plans/2026-05-01-find-replace-abort-migration-{design,plan}.md`: every row of the design's §Behaviour mapping (rows 1–9) and both Plan-vs-Design Notes ([D1] and [D2]) are reflected in source, the four prescribed new tests + one tightening + two structural-check assertions all landed, and the post-Task-3 follow-up commits (typed mock, fixture-shape fixes, regex broadening, plan-doc verification commands) are quality fixes rather than deviations. No Critical or Important issues; four Suggestion-grade observations relating to test hygiene, the structural-check regex's coverage of `| undefined` drift, and two latent-trap observations the author already partly defends against.

## Critical Issues

None found.

## Important Issues

None found.

## Suggestions

- **[S1]** `migrationStructuralCheck.test.ts:117` — regex `/useRef\s*<\s*AbortController\s*(?:\|\s*null\s*)?>/` does not match `useRef<AbortController | undefined>` or `useRef<AbortController | null | undefined>`. Per CLAUDE.md §Save-pipeline rule 4, lint enforcement is deferred, so this regex is the only mechanical floor against drift. Tighten to `/useRef\s*<\s*AbortController\b[^>]*>/` or list union variants explicitly. (Found by: Error Handling — confirmed by Verifier.)
- **[S2]** `useFindReplaceState.ts:265-269` — the `finally` clears loading only when `!token.isStale()`. Today's seq-bump paths (closePanel:155, project-change:119, empty-query:194) all defend by setting `loading=false` *before* bumping; a future fifth path that misses this would leave the spinner stuck. Add a comment at the `finally` site documenting the contract, OR invert to gate on `signal.aborted` in the success/error branches and clear unconditionally in `finally`. (Found by: Error Handling — confirmed-as-latent by Verifier.)
- **[S3]** `useFindReplaceState.test.ts:825-876` — the success-path-gate test admits in its own comment (829-833) it cannot distinguish `signal.aborted` from `token.isStale`. The hook-side "Do NOT delete as redundant" comment at lines 216-222 is the actual enforcement; the design explicitly disclaims gate-isolation testing as out of scope. Optional: a unit test that aborts via `op.abort()` only (without bumping the seq) — feasible only if a future refactor exposes such a path. (Found by: Error Handling — confirmed-as-acknowledged-gap by Verifier.)
- **[S4]** `useFindReplaceState.test.ts:731,768,803` — never-resolving mock promises (`new Promise<SearchResult>(() => {})`) never settle even after unmount aborts the controller (the mock ignores the signal). All three are consumed; Vitest does not warn about unsettled-pending promises. Hygiene observation only: pair the mock with `signal.addEventListener("abort", () => reject(...))` for cleaner teardown. (Found by: Error Handling — downgraded-to-hygiene by Verifier.)

## Plan Alignment

**Implemented (every row):**

- Row 1 (`searchAbortRef` removed; `op = useAbortableAsyncOperation()` allocated alongside `searchSeq`) — `useFindReplaceState.ts:75-81`
- Row 2 (unmount cleanup effect REMOVED, subsumed by hook auto-abort) — confirmed absent
- Row 3 (project-change cleanup uses `op.abort()`) — `useFindReplaceState.ts:120-126`, dep array includes `op`
- Row 4 (`closePanel` uses `op.abort()`, side-effect ordering preserved) — `useFindReplaceState.ts:140-171`, dep array includes `op`
- Row 5 (empty-query branch's explicit `op.abort()` per [D2]) — `useFindReplaceState.ts:182-196` with [D2]-tagged comment
- Row 6 (`search()` uses `op.run((s) => api.search.find(slug, frozenQuery, frozenOptions, s))`, `s` not `signal` to avoid shadowing) — `useFindReplaceState.ts:211-213`
- Row 7 (NEW `if (signal.aborted) return;` gates with explanatory comments on success path AND at top of catch before `mapApiError`) — `useFindReplaceState.ts:223-224, 234-235`
- Row 8 (finally controller-equality cleanup REMOVED) — `useFindReplaceState.ts:265-269`
- Row 9 (empty-query `searchAbortRef = null` REMOVED) — confirmed absent

**Plan tasks (commits 1-4 + Task 5 correctly omitted):**

- Task 1 → commit `d34e5c2` (captureSignal helper, tests #1, #2, #4 + project-change tightening)
- Task 1 typing decision (pushback [3]) → commit `076f907` (typed-mock fork taken)
- Task 2 → commit `dc53f58` (test #3 with limitation comment)
- Task 3 → commit `ba7904d` (migration source row-by-row)
- Task 4 → commit `3554aa4` (structural check)
- Task 5 → omitted (no `searchAbortRef` references survived; per design "If nothing needs tidying, omit this commit")
- Quality-fix follow-ups: `076f907` (typed mock), `6c32b70` (fixture types match `SearchResult`), `6446dd1` (regex broadened to cover `| null` form), `2a7297d` (plan verification commands)

**Plan-vs-Design Notes:**

- [D1] (closePanel test #4 instead of §3a tightening) — implemented at `useFindReplaceState.test.ts:788-823`; existing `closePanel clears stale result state` correctly left untightened
- [D2] (explicit `op.abort()` in empty-query branch) — implemented at `useFindReplaceState.ts:189`

**Definition of Done:** all 12 bullets in the design's §Definition of Done verified against source. CLAUDE.md unchanged (correct — rule 4 already documents the pairing).

**Deviations:** None. The four follow-up commits beyond Tasks 1-4 close gaps caught during execution; none contradict the design or plan.

**Not yet implemented:** Nothing. Task 6 (final `make all` verification) is a runtime check Ovid runs locally before opening the PR.

## Review Metadata

- **Agents dispatched:** 6 specialists in parallel — Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment. 1 Verifier sequentially.
- **Scope:** `packages/client/src/hooks/useFindReplaceState.ts` (post-migration), `useAbortableAsyncOperation.ts`, `useAbortableSequence.ts`, both `__tests__` files modified, `EditorPage.tsx` consumer regions, `apiErrorMapper.ts` and `scopes.ts` for ABORTED/`findReplace.search` contract, `api/client.ts` for synchronous-throw verification, `packages/shared/src/types.ts` for `SearchResult` shape verification.
- **Raw findings:** 5 (all from Error Handling & Edge Cases; the other 5 specialists reported "no high-confidence findings")
- **Verified findings:** 4 (1 confirmed at Suggestion severity, 3 downgraded to Suggestion, 1 rejected)
- **Filtered out:** 1 (F1: synchronous-throw concern rejected — `apiFetch` is `async`, all throws are converted to rejected promises by language semantics)
- **Steering files consulted:** `CLAUDE.md` (§Save-pipeline invariants rule 4 — confirmed: documents the `useAbortableSequence` + `useAbortableAsyncOperation` pairing with `useFindReplaceState.search` as the canonical example; rule 4 also notes lint enforcement is deferred, which is what makes [S1] meaningful)
- **Plan/design docs consulted:** `docs/plans/2026-05-01-find-replace-abort-migration-design.md`, `docs/plans/2026-05-01-find-replace-abort-migration-plan.md`, `docs/roadmap-decisions/2026-05-01-phase-4b-3a-2-find-replace-abort-migration.md`
