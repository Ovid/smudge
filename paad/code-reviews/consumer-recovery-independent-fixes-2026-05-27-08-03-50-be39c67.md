# Agentic Code Review: consumer-recovery-independent-fixes

**Date:** 2026-05-27 08:03:50
**Branch:** `consumer-recovery-independent-fixes` -> `main`
**Commit:** `be39c67d18ba2f01334f2fd039493efff087b84b`
**Files changed:** 14 | **Lines changed:** +781 / -48
**Diff size category:** Medium

## Executive Summary

Phase 4b.3c.3 bundles six independent consumer-recovery fixes ([I4], [S5], [S11], [S17], [S18], [S19]) plus a new e2e spec. The implementation matches the plan one-for-one, but verification surfaced three Important issues: the new [I4] recovery branch's confirmed-status reseed runs outside the project-identity guard (L1+CS1), the deliberately long-lived `restoreRecoveryAbortRef` lets a stale recovery GET overwrite a newer successful restore (CS2), and the new [S11] 404 navigate-home short-circuit fires before the existing cross-project drift guard (CS3). Confidence is high on all three; each is reachable by a normal cross-flow user sequence.

## Critical Issues

None found.

## Important Issues

### [I1] Cross-project status-cache corruption — `replaceConfirmedStatusesFromProject` fires outside the I4 identity guard
- **File:** `packages/client/src/hooks/useTrashManager.ts:175`
- **Bug:** In the I4 recovery branch at lines 168-175, `setProject((prev) => { if (prev.id !== refreshed.id) return prev; return refreshed; })` correctly bails when the user has navigated to a different project mid-recovery-GET. But the next line, `replaceConfirmedStatusesRef.current?.(refreshed)`, runs unconditionally — and `replaceConfirmedStatusesFromProject` (useProjectEditor.ts:1537-1541) wipes and replaces the entire `confirmedStatusRef` table. After an A→B nav during A's recovery GET, project B's confirmed-status cache is destroyed and replaced with project A's chapter→status mapping.
- **Impact:** A subsequent status PATCH on a B chapter that double-fails (PATCH + recovery GET) reads `previousStatus = undefined` (no entry for B's chapter ids in the now-A-keyed cache) and silently skips the local-revert fallback. The optimistic status stays on screen even though the server never accepted it — the exact data-integrity hazard the C2 (review 2026-04-25) cache was added to prevent. The analogous handleCreateChapter recovery branch at useProjectEditor.ts:824-836 correctly guards BOTH `setProject(refreshed)` and the cache reseed inside the same `if (projectRef.current?.id === projectId)` block.
- **Suggested fix:** Capture project id at recovery-start and re-check inside the `.then` before the reseed:
  ```ts
  const startedForProjectId = project?.id;
  // …
  .then((refreshed) => {
    if (recoveryController.signal.aborted) return;
    if (startedForProjectId !== refreshed.id) return;
    setProject((prev) => (prev?.id === refreshed.id ? refreshed : prev));
    replaceConfirmedStatusesRef.current?.(refreshed);
  })
  ```
- **Confidence:** High
- **Found by:** Logic & Correctness + Concurrency & State (`claude-opus-4-7[1m]`) — merged from L1 and CS1

### [I2] Cross-restore race — Restore-A's recovery GET clobbers Restore-B's successful state
- **File:** `packages/client/src/hooks/useTrashManager.ts:161-175`
- **Bug:** `restoreRecoveryAbortRef` is deliberately separate from `restoreOp` so a recovery GET from a prior failed restore survives the next `handleRestore`'s `restoreOp.abort()` (per the comment at lines 59-68). Exploitable sequence: (1) Restore-A returns 200 BAD_JSON → catch fires `api.projects.get(slug, recoveryController.signal)`. (2) Before that GET resolves, user clicks Restore-B; `restoreOp.run` aborts only A's primary POST (already complete) — the recovery GET is left in flight. B's POST succeeds and lines 105-116 merge B's chapter into project state. (3) A's recovery GET finally resolves with a server snapshot captured BEFORE B's restore landed; `setProject((prev) => prev.id !== refreshed.id ? prev : refreshed)` matches on id and REPLACES `prev` with A's stale snapshot. B's restored chapter disappears from the sidebar.
- **Impact:** Real silent data-loss UX: B appears restored, then vanishes when A's recovery GET lands. If the user retries B they hit 409 RESTORE_CONFLICT (server still has B restored). The "survive the next abort" design intent is correct in spirit but the wholesale-replace merge strategy doesn't respect newer mutations that have landed since.
- **Suggested fix:** Either (a) sequence-version the recovery GET via `useAbortableSequence` so a newer successful restore stales A's response; OR (c) abort A's recovery on B's success path. Option (a) composes more cleanly with the existing per-handler epoch tokens.
- **Confidence:** Medium-High
- **Found by:** Concurrency & State (`claude-opus-4-7[1m]`)

### [I3] `onProjectNotFound` fires before the cross-project drift guard — yanks user out of project B after stale A POST returns 404
- **File:** `packages/client/src/hooks/useProjectEditor.ts:767-774`
- **Bug:** The new S11 short-circuit at lines 767-774 (`if (isNotFound(err)) { onProjectNotFoundRef.current?.(); return; }`) fires BEFORE the drift guards at lines 776-778 (`if (projectRef.current?.id !== projectId) return;` and the slug variant). If the user navigated A → B while A's `handleCreateChapter` POST was in flight, and A returns 404, the catch lands with the user actively viewing B; the existing drift guard would have suppressed the message, but `onProjectNotFoundRef.current()` (wired to `navigate("/")` in EditorPage.tsx:126) runs first and yanks them back to the project list.
- **Impact:** Loses the user's editing context after a routine cross-project nav whose only crime was a stale POST returning 404. The drift-guard pattern at 776-778 exists exactly for this case.
- **Suggested fix:** Move the drift guards above the 404 branch:
  ```ts
  if (isAborted(err)) return;
  if (projectRef.current?.id !== projectId) return;
  if (projectSlugRef.current !== slug && projectSlugRef.current !== projectRef.current?.slug) return;
  if (isNotFound(err)) {
    if (onProjectNotFoundRef.current) { onProjectNotFoundRef.current(); return; }
    // fall through to dismissable banner
  }
  console.warn("Failed to create chapter:", err);
  ```
- **Confidence:** High
- **Found by:** Concurrency & State (`claude-opus-4-7[1m]`)

## Suggestions

- **[S1] Three copies of the confirmed-status reseed formula** (`packages/client/src/hooks/useProjectEditor.ts:317, 834-836, 1537-1541`) — the new `replaceConfirmedStatusesFromProject` helper sits alongside two pre-existing duplicates of the same `confirmedStatusRef.current = Object.fromEntries(...)` body. Hoist a single private function and have all three callers delegate. Found by Contract & Integration. Confidence: Medium.
- **[S2] `slug` closure-staleness on the I4 recovery GET** (`packages/client/src/hooks/useTrashManager.ts:160-189`) — `handleRestore` captures `slug` in its useCallback closure; if a parent-project restore changes the slug between user clicks, a subsequent recovery branch targets the stale slug. Bounded impact (silent recovery failure on 404), but pairs naturally with the [I1] capture-id fix. Found by Concurrency & State. Confidence: Medium.
- **[S3] `dispatched` flag's mental model doesn't match the existing test fixture** (`packages/client/src/hooks/useSnapshotState.ts:395-406`) — the S5 comment frames `dispatched=true` as "request landed → server likely committed", but in current code no post-`await promise` step throws synchronously. The `dispatched=true && !isApiError` route is effectively a dead path; the test fixture (`mockRejectedValue`) exercises a structurally pre-send shape. Either tighten the comment to call the branch a future-proofing reserve, or update the S5 test's comment to describe what the fixture actually simulates. Found by Contract & Integration. Confidence: Medium.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Spec Compliance
- **Scope:** packages/client/src/hooks/{useTrashManager,useSnapshotState,useProjectEditor}.ts; packages/client/src/components/Editor.tsx; packages/client/src/pages/EditorPage.tsx; packages/client/src/__tests__/{Editor,migrationStructuralCheck,useProjectEditor,useSnapshotState,useTrashManager}.test.ts; e2e/{chapter-create-recovery,snapshot-create-recovery,trash-restore-recovery}.spec.ts; e2e/helpers/interceptWith200BadJson.ts
- **Raw findings:** 7 (L1, C1, C2, CS1, CS2, CS3, CS4; Error/Security/Spec returned no findings)
- **Verified findings:** 6 (L1 merged into CS1 — same bug from two lenses)
- **Filtered out:** 1 (deduplicated by merge)
- **Out-of-scope findings:** 0 (Critical: 0, Important: 0, Suggestion: 0)
- **Out-of-scope additions:** 0
- **Backlog:** 0 new entries added, 0 re-confirmed (see `paad/code-reviews/backlog.md`)
- **Steering files consulted:** `/workspace/CLAUDE.md`
- **Intent sources consulted:** `docs/roadmap.md` (Phase 4b.3c.3 entry at line 1101); `docs/plans/2026-05-26-consumer-recovery-completeness-design.md`; `docs/plans/2026-05-26-consumer-recovery-completeness-plan.md` (Tasks 38-48); commit messages on the branch
- **Verifier warnings:** 1
  - `verifier-warning: spec-compliance ref-token-missing` (no findings to drop)
