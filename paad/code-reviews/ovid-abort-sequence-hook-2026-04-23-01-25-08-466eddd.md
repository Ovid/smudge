# Agentic Code Review: ovid/abort-sequence-hook

**Date:** 2026-04-23 01:25:08
**Branch:** ovid/abort-sequence-hook -> main
**Commit:** 466eddd212082e4f3e2a045193757fc7eaaef2bd
**Files changed:** 20 | **Lines changed:** +2186 / -211
**Diff size category:** Large

## Executive Summary

Phase 4b.2's `useAbortableSequence` primitive and the migration of four consumers remain mechanically sound; the six suggestions from the prior review (2026-04-22, commit f41c03b) are all addressed or explicitly pinned with rationale. Two Important findings surfaced in this pass — one is a newly-introduced concurrency gap in `handleDeleteChapter` (a user's mid-delete chapter click can be silently overridden by delete's auto-select-first), and one is a scope-of-this-branch regression in the two-part project-slug drift guard (defeated once cross-project navigation completes, corrupting the new project's chapter list in memory). Four additional Suggestions are mostly pre-existing robustness gaps the refactor did not touch. Nothing blocks merging, but the two Important items warrant a follow-up before the branch lands.

## Critical Issues

None found.

## Important Issues

### [I1] handleDeleteChapter overrides the user's mid-delete chapter click
- **File:** `packages/client/src/hooks/useProjectEditor.ts:504, 532-536`
- **Bug:** During `await api.chapters.delete()` at line 513, if the user clicks another chapter, `handleSelectChapter` calls `selectChapterSeq.start()` (token_user) and fires its GET. When the delete resolves, line 532 calls `selectChapterSeq.start()` again (token_delete), which bumps the epoch and stales token_user. The user's GET is discarded regardless of which response lands first; delete's "first_remaining" GET then pins the sidebar to `first_remaining` instead of the chapter the user explicitly clicked.
- **Impact:** Silently discards explicit user intent. The comment at lines 526-531 documents only the *opposite* timing (user clicks after delete resolves), which the guard does handle — the during-POST ordering is an unhandled race.
- **Suggested fix:** Capture the select epoch at delete entry (right after the `selectChapterSeq.abort()` at line 504): `const entryToken = selectChapterSeq.capture();`. After the POST resolves, before line 532's `selectChapterSeq.start()`, check `if (entryToken.isStale()) return true;` — the user issued a newer select; honor their choice and skip the auto-select-first.
- **Confidence:** High
- **Found by:** Concurrency & State

### [I2] Project-slug drift guard defeated after cross-project navigation completes
- **File:** `packages/client/src/hooks/useProjectEditor.ts:362-363, 369-370, 580-581, 594-595, 623-624`
- **Bug:** The two-part guard `projectSlugRef.current !== slug && projectSlugRef.current !== projectRef.current?.slug` is designed to distinguish a concurrent rename (both refs move together) from a concurrent navigation (refs diverge). After A→B navigation finishes and the loaded project is swapped in, BOTH refs equal `"b"`. An in-flight response captured with `slug = "a"` passes the guard (`"b" !== "a"` is true AND `"b" !== "b"` is false → overall false) and writes project A's response into project B's state. Worst case: `handleReorderChapters` line 582-591 runs project A's ordered id list against project B's chapters array — every id lookup misses, `reordered` becomes `[]`, and project B's sidebar silently empties until refresh.
- **Impact:** Visible corruption of the destination project's chapter list in memory. No server-side data loss, but the user sees their project as empty. Narrow trigger (requires the in-flight POST/PUT/PATCH to still be pending when the new project's GET finishes), but reproducible on a sufficiently fast network.
- **Suggested fix:** Capture the project's stable `id` (not the slug) at handler entry and compare against `projectRef.current?.id` — rename-safe and cross-project-safe. Alternatively, a dedicated `projectSeq = useAbortableSequence()` bumped on every project-change effect would be symmetric with the other axes in this refactor.
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases

## Suggestions

- **[S1] ViewResult type is not a discriminated union** — `packages/client/src/hooks/useSnapshotState.ts:70-76` declares `{ ok: boolean; reason?: ViewFailureReason; superseded?: ViewSupersededReason }` with both optionals attached regardless of branch. The consuming `onView` prop at `packages/client/src/components/SnapshotPanel.tsx:38-49` declares the proper union `{ ok: true; superseded?: ... } | { ok: false; reason?: string }`. TypeScript cannot narrow the hook's own return inside the ok:true branch, inviting silent drift. Fix: rewrite `ViewResult` as the same discriminated union. Found by Contract & Integration.

- **[S2] VALIDATION_ERROR cache clear wipes newer typed content** — `packages/client/src/hooks/useProjectEditor.ts:292-297`. The null-out of `latestContentRef.current` is gated only on id match, not content match. If the user typed newer content C2 during the PATCH flight for C1, `latestContentRef.current.content === C2` and the error-branch wipes C2 too. Invariant #3 ("cache is the last line of defense") argues for a tighter gate: `latestContentRef.current.content === postedContent`, paralleling the `stillLatest` check at line 232-234. Found by Concurrency & State.

- **[S3] 2xx BAD_JSON on save path silently retries 4 times** — `packages/client/src/hooks/useProjectEditor.ts:244-277`. The 4xx-break at line 251 gates on `err.status >= 400 && err.status < 500`; a 2xx BAD_JSON (garbled response body from an otherwise-successful PATCH) falls through into the backoff/retry loop, potentially issuing three redundant PATCHes against content the server has already committed. The sibling `restoreSnapshot` at line 329-331 treats 2xx BAD_JSON as `possibly_committed`. Pre-existing in `main`, not a regression — mark as suggestion only. Fix: add a dedicated `if (err.code === "BAD_JSON" && err.status >= 200 && err.status < 300)` branch that breaks without retry. Found by Error Handling & Edge Cases.

- **[S4] Dead `res.reason === "busy"` branch in SnapshotPanel** — `packages/client/src/components/SnapshotPanel.tsx:485`. The `"locked" || "busy"` branch is dead on the busy half: EditorPage's `onView` returns bare `undefined` on busy (not `{ ok: false, reason: "busy" }`), and `viewSnapshot` never returns that shape either. The outer `res && "ok" in res && !res.ok` guard filters `undefined` before reaching this branch. Cosmetic / doc drift only. Fix: drop `|| res.reason === "busy"` and the comment reference, OR make EditorPage return the canonical shape. Found by Error Handling & Edge Cases.

## Plan Alignment

Plan doc: `docs/plans/2026-04-22-abortable-sequence-hook-design.md` + `docs/plans/2026-04-22-abortable-sequence-hook-plan.md`.

- **Implemented:** All eight Definition-of-Done bullets. `useAbortableSequence.ts:13-67` ships with `start()`/`capture()`/`abort()` + `mountedRef`-backed auto-abort. All four migrated call sites import the primitive and expose the expected sequence names. ESLint `no-restricted-syntax` rule at `eslint.config.js:39-73` with fixture coverage at `packages/client/src/__tests__/eslintSequenceRule.test.ts` including a dedicated test pinning the intentionally-not-caught mirrored form (S1 rationale). `grep -rn 'SeqRef|seqRef|sequenceRef' packages/client/src/` returns no matches in production code. CLAUDE.md carries both rule-4 and closing-paragraph edits. Roadmap Phase 4b.2 entry present.
- **Prior-review findings (2026-04-22, f41c03b):** All six addressed. S1 explicitly pinned with rationale (`eslint.config.js:54-67` + `eslintSequenceRule.test.ts:64-94`). S2 consolidated into `migrationStructuralCheck.test.ts`. S3 fixed via `mountedRef` gate at `useAbortableSequence.ts:15, 24, 40-58`. S4 structurally closed by S3. S5 gate added at `useProjectEditor.ts:304`. S6 split shipped (`ViewSupersededReason = "chapter" | "sameChapterNewer"` at `useSnapshotState.ts:65-75`).
- **Not yet implemented:** None.
- **Deviations:** None. Two additional tests (stable-object-across-renders, zero-console-output) were added beyond the nine specified in §Testing Strategy — both consistent with the design's prose, not contradictions.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment (six specialists), plus Verifier.
- **Scope:** Changed files (`useAbortableSequence.ts` + test, four migrated hooks/components, test files, `eslintSequenceRule.test.ts`, `migrationStructuralCheck.test.ts`, `eslint.config.js`, `CLAUDE.md`, `docs/roadmap.md`, two new planning docs) plus adjacent callers (`EditorPage.tsx`, `useEditorMutation.ts`) traced one level deep.
- **Raw findings:** 13 (before verification)
- **Verified findings:** 6 (2 Important, 4 Suggestions)
- **Filtered out:** 7 — L1 (post-unmount restoreSnapshot falls to silent React 18 no-ops; follow-up list fetch stales correctly), L2 (no consumer does render-phase `start()` against `chapterSeq`; test at `useAbortableSequence.test.ts:114` pins the primitive's contract independently), L3 (no consumer calls `isStale()` in its own unmount cleanup — reverse-order cleanup irrelevant today), E3 (most "silent" catches in SnapshotPanel do surface via `setListError`; the remaining `.catch(() => {})` calls in `useSnapshotState.ts` are deliberate background-count refreshes), E4 (handleStatusChange `previousStatus === undefined` edge is pre-existing from 2026-04-01 and the optimistic update is also a no-op in the trigger scenario), CS2 (React flushes the debounce-effect cleanup on `setQuery("")` re-render before the timer fires; defense-in-depth only), and Security (no findings — narrow single-user threat model, DOMPurify sanitizes downstream snapshot render).
- **Steering files consulted:** `CLAUDE.md` (especially §Save-Pipeline Invariants — rule 4 and the closing paragraph both correctly reference `useAbortableSequence`).
- **Plan/design docs consulted:** `docs/plans/2026-04-22-abortable-sequence-hook-design.md`, `docs/plans/2026-04-22-abortable-sequence-hook-plan.md`, `docs/roadmap.md`, prior review `paad/code-reviews/ovid-abort-sequence-hook-2026-04-22-23-26-49-f41c03b.md`.
