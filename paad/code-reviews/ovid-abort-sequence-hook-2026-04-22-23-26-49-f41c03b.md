# Agentic Code Review: ovid/abort-sequence-hook

**Date:** 2026-04-22 23:26:49
**Branch:** ovid/abort-sequence-hook -> main
**Commit:** f41c03bba46494b7cac0b7a527faa0887dff3eeb
**Files changed:** 16 | **Lines changed:** +1664 / -178 (≈472 production lines; remainder is planning docs)
**Diff size category:** Medium

## Executive Summary

Phase 4b.2's `useAbortableSequence` primitive is mechanically sound, semantically faithful to the four ad-hoc sequence-ref patterns it replaces, and its unit tests pin the contract explicitly. No Critical or Important issues were found. Six confirmed Suggestions surfaced: two are pre-existing behaviors preserved unchanged by the refactor, two are doc-claim-vs-reality imprecisions around post-unmount `start()`, one is a defense-in-depth gap in the ESLint selector, and one is cosmetic duplication across four test files. Nothing blocks merging.

## Critical Issues

None found.

## Important Issues

None found.

## Suggestions

- **[S1] ESLint `no-restricted-syntax` rule misses the mirrored-operand form.** `eslint.config.js:54-55` — selector is `[left.type='Identifier'][right.type='MemberExpression'][right.property.name='current']`, so `someRef.current !== seq` slips through. The legitimate pattern the design cites as the reason to skip MemberExpression-on-left is `activeChapterRef.current?.id === savingChapterId` — its property name is `id`, not `current`, so a mirrored selector `[left.type='MemberExpression'][left.property.name='current'][right.type='Identifier']` would close the bypass without false-positives. Add it as a second rule entry plus a mirrored fixture test. Confidence: Medium. Found by: Contract & Integration, Error Handling.

- **[S2] Four-way duplicated "migration structural check" tests.** `useProjectEditor.test.ts:1795-1806`, `useSnapshotState.test.ts:471-481`, `useFindReplaceState.test.ts:691-700`, `SnapshotPanel.test.tsx:630-639` — each reimplements the same `readFileSync` / `fileURLToPath` / `not.toMatch(/<file>SeqRef/)` / `toMatch(/useAbortableSequence/)` pattern. Redundant with the ESLint rule + its fixture test, and when the selector changes (e.g. after applying S1), four files need lockstep updates. Consider (a) removing them and trusting the lint rule, or (b) consolidating into one `migrationStructuralCheck.test.ts` that asserts `grep -rn 'SeqRef|seqRef|sequenceRef' packages/client/src/**/*.{ts,tsx}` (excluding test fixtures) returns zero matches. Confidence: Medium. Found by: Contract & Integration.

- **[S3] Design-claim imprecision: `useAbortableSequence` auto-abort protects only PRE-unmount tokens.** `useAbortableSequence.ts:20-37` and test at `useAbortableSequence.test.ts:60-65`. The hook's internal `useEffect(() => () => counterRef.current += 1, [])` invalidates tokens created before unmount, but `start()` and `capture()` called AFTER unmount return fresh tokens (explicitly tested and labelled "harmless"). The design doc at `docs/plans/2026-04-22-abortable-sequence-hook-design.md:49` says "every outstanding token becomes stale when the owning component unmounts"; CLAUDE.md §Save-Pipeline Invariants rule 4 says "component unmount auto-aborts." Both read as stronger than the actual semantic. Either (a) add a `mountedRef` to make post-unmount tokens always stale, or (b) tighten the design-doc and CLAUDE.md wording to say "tokens created before unmount are invalidated by unmount." Confidence: Medium. Found by: Error Handling.

- **[S4] `handleDeleteChapter` post-await `selectChapterSeq.start()` lets post-unmount setState through.** `useProjectEditor.ts:526` — `start()` runs after `await api.chapters.delete(...)` at line 507. If the component unmounts during the delete await, the hook's auto-abort bumps once; the post-await `start()` then bumps again and returns a fresh token whose `isStale()` returns false. Downstream `setActiveChapter(ch)` / `setChapterWordCount(...)` / `onError?.(...)` at lines 530-544 fire on an unmounted component. React 18 silently ignores this, so there is no user-visible impact today. **Not a regression** — `main` has identical behavior with `++selectChapterSeqRef.current`. Fixing S3 would fix this structurally. Confidence: Medium. Found by: Error Handling.

- **[S5] `handleSave` error-branch `setSaveStatus("error")` lacks `token.isStale()` gate (pre-existing).** `useProjectEditor.ts:298-301` — gated only by `activeChapterRef.current?.id === savingChapterId`. On an A→B→A round-trip during a 4xx response window, A's cancelled save's error state can bleed into A's newly-active state. Not a regression — `main`'s version has the identical shape. Adding `&& !token.isStale()` parallels the cache-clear guard two lines above and would close the edge case. Confidence: Medium. Found by: Concurrency & State.

- **[S6] `viewSnapshot` returns misleading `staleChapterSwitch: true` on rapid same-chapter double-click (pre-existing).** `useSnapshotState.ts:180,212` — the `vToken.isStale()` branch returns `{ ok: true, staleChapterSwitch: true }` even when the chapter did not change (only a newer View click on the same chapter). The caller (`SnapshotPanel.tsx:463`) surfaces chapter-switch copy in that branch. Consider splitting into `superseded: "chapter" | "sameChapterNewer"` or two discrete flags. Not a regression — `main` has identical behavior. Confidence: Medium. Found by: Concurrency & State.

## Plan Alignment

Plan doc: `docs/plans/2026-04-22-abortable-sequence-hook-design.md`.

- **Implemented:** All eight Definition-of-Done bullets. Consumer migration map (`useFindReplaceState`, `useSnapshotState`, `useProjectEditor`, `SnapshotPanel`) landed with the expected new names and patterns. "What does NOT move" preserved (`useEditorMutation.inFlightRef`, `{ staleChapterSwitch: true }` contract, the `cancelInFlightSave` unmount cleanup). All four pattern translations (single-axis, cross-axis, external-trigger abort, cancel-API abort) are exercised in the code. Both CLAUDE.md edits landed verbatim. `grep -rn 'SeqRef|seqRef|sequenceRef' packages/client/src/` returns no matches in production code. The ESLint rule ships with fixture tests. The roadmap marker was added and Phase 4b.2 status bumped to "In Progress."
- **Not yet implemented:** None.
- **Deviations:** One documented, authorized deviation — the plan explicitly notes the ESLint rule ships AFTER the migrations (commit ordering), not before, to keep each intermediate commit `make lint`-green. Not a silent drift. Two test cases were added beyond the nine specified in §Testing strategy (stable-object-across-renders, zero-console-output) — both are consistent with the design's prose, not contradictions.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment (six specialists), plus Verifier.
- **Scope:** Changed files (`useAbortableSequence.ts` + test, four migrated files, `SnapshotPanel.tsx`, four test files, `eslintSequenceRule.test.ts`, `eslint.config.js`, `CLAUDE.md`, `docs/roadmap.md`, two new planning docs) plus adjacent callers (`EditorPage.tsx`, `useEditorMutation.ts`) traced one level deep.
- **Raw findings:** 9 (before verification)
- **Verified findings:** 6 (1 rejected, 2 collapsed into S1, others confirmed)
- **Filtered out:** 3 (F4 debounce-timer race — rejected; two duplicate-of-S1 framings merged)
- **Steering files consulted:** `CLAUDE.md` (especially §Save-Pipeline Invariants). One imprecision noted in S3 — rule 4's claim that unmount "auto-aborts" reads as stronger than the hook's actual semantic.
- **Plan/design docs consulted:** `docs/plans/2026-04-22-abortable-sequence-hook-design.md`, `docs/plans/2026-04-22-abortable-sequence-hook-plan.md`, `docs/roadmap.md`.
