# Agentic Code Review: consumer-recovery-independent-fixes

**Date:** 2026-05-27 13:30:07
**Branch:** `consumer-recovery-independent-fixes` -> `main`
**Commit:** `f2c907ab` (round 3 review)
**Files changed:** 18 | **Lines changed:** +2167 / -60
**Diff size category:** Large

## Executive Summary

Phase 4b.3c.3 plus the round-2 follow-ups have closed the I1 sequence-token gap and the I2 trash-restore drift-guard gap that the prior review flagged, and a wider drift-guard sweep across five sibling handlers (openTrash, confirmDeleteChapter refresh, handleDeleteChapter, handleStatusChange, handleRenameChapter) generalises the same protection. Four **Important** in-scope items remain: `handleRestore`'s **success** path was overlooked by the same sweep that fixed its catch (high-impact cross-project setProject + slug rewrite + navigate yank); `handleStatusChange`'s `possiblyCommitted` early-return bypasses the new drift guard (wrong-project banner leak + status-cache corruption); `handleCreateChapter`'s recovery-GET catch falls through to `onError`/`setError` without re-checking drift; and the S18 catch branch is load-bearing but has no test coverage. Ten in-scope **Suggestion**-tier items are observability symmetry, test-fragility, or comment-vs-code mismatches. Confidence on the four Important items is high; each is a single-call-stack reproducer.

## Critical Issues

None found.

## Important Issues

### [I1] handleRestore success path lacks the drift guard added to the catch path
- **File:** `packages/client/src/hooks/useTrashManager.ts:162-185`
- **Bug:** After `await promise` (line 162) the success branch only checks `signal.aborted`. The catch path got the I2 round-2 `restoreStartedForProjectId !== projectRef.current?.id` drift guard (lines 204-209), but the success branch did not. A Restore-A whose POST resolves AFTER the user navigates A→B will: (a) splice A's restored chapter into B's `prev.chapters` via the `setProject` updater at line 165 (no inside-updater id-equality re-check), (b) overwrite B's slug with A's `restored.project_slug` (line 173) — URL desync; subsequent saves/creates/reorders 404 against the wrong slug, (c) pollute the confirmed-status cache via `seedConfirmedStatusRef.current?.(restored.id, restored.status)` (line 181), and (d) `navigate('/projects/<a-slug>', { replace: true })` (line 184) yanking the user out of B.
- **Impact:** High-impact cross-project state corruption + a hostile navigation jolt. EditorPage stays mounted across `/projects/:slug` navigation (single Route in `App.tsx`), so the in-flight restore's `signal.aborted` is false and the catch-arm guard never fires. The only protection on the success path is `signal.aborted`, which doesn't catch the A→B case.
- **Suggested fix:** Hoist the catch-arm drift guard into the success path. After `if (signal.aborted) return;` at line 163, add `if (restoreStartedForProjectId !== undefined && projectRef.current?.id !== restoreStartedForProjectId) return;`. For defense-in-depth, also add an inside-updater `if (prev?.id !== restoreStartedForProjectId) return prev;` to the `setProject((prev) => …)` block at line 165.
- **Confidence:** High
- **Found by:** Logic & Correctness + Contract & Integration + Concurrency & State (merged)

### [I2] handleStatusChange `possiblyCommitted` early-return bypasses the new drift guard
- **File:** `packages/client/src/hooks/useProjectEditor.ts:1460-1468`
- **Bug:** The wider drift-guard sweep added `isStaleProject()` (captured at handler entry, line 1409-1411) and called it before `applyMappedError` at line 1545. But the `mapped.possiblyCommitted` branch returns at line 1467 BEFORE reaching that guard. Both side effects in that branch run unconditionally on stale-project: `confirmedStatusRef.current[chapterId] = status;` (line 1465) writes A's chapter id into the confirmed-status cache, and `onError?.(mapped.message)` (line 1466) surfaces A's "Status updated but couldn't be read back" banner on B's UI via `setActionError` (wired by EditorPage) or via `setError` (full-page overlay) when `onError` is undefined (keyboard-shortcut path, line 1539's S4 fallback).
- **Impact:** The exact wrong-project banner leak the wider drift-guard sweep claims to close. The status-cache corruption is bounded by the next loadProject reset, so the cache-leak blast radius is small; the banner leak is the user-visible part. The setError variant is the worst case (full-page overlay on B for an A event).
- **Suggested fix:** Hoist `if (isStaleProject()) return;` to immediately after `if (mapped.message === null) return;` at line 1452, so it gates BOTH the possiblyCommitted branch and the trailing `applyMappedError`. The existing guard at 1545 becomes redundant; remove it or keep as defense-in-depth.
- **Confidence:** High
- **Found by:** Error Handling + Concurrency & State (merged)

### [I3] handleCreateChapter recovery-GET catch falls through to `onError`/`setError` without a drift guard
- **File:** `packages/client/src/hooks/useProjectEditor.ts:916-930`
- **Bug:** After the recovery GET's `catch (err) { devWarn(...) }` block returns (lines 916-924), control falls through to `if (onError) onError(message); else setError(message)` at lines 926-930 unconditionally. The drift checks at 797-799 ran BEFORE entering the possiblyCommitted branch; the I1 round-2 `createToken.isStale()` guard at line 876 only fires on the success arm. If the user navigates A→B mid-recovery without starting a new handleCreateChapter (so the token isn't invalidated), the failure-axis banner fires on B for an A event. The recovery branch can take seconds (full project GET), so the navigation window is realistic. `setError` (no `onError` wired, e.g. from EditorPage's `useProjectEditor` if `onProjectNotFound` is wired but not a separate generic onError) surfaces the full-page error overlay, tearing down B's editor session.
- **Impact:** Same class as I2 — wrong-project leak surfacing as either an action banner or a full-page error overlay. The S20 inside-updater guard at line 884 protects only the `setProject` happy-path call; the onError/setError fall-through is unprotected.
- **Suggested fix:** Add `if (projectRef.current?.id !== projectId) return;` immediately before line 926. Alternatively, capture an `isStaleProject` helper at function entry (mirroring handleStatusChange / handleRenameChapter / handleDeleteChapter) and call it here.
- **Confidence:** High
- **Found by:** Error Handling

### [I4] S18 catch-branch identity check is load-bearing but has no test coverage
- **File:** `packages/client/src/components/Editor.tsx:357-363`
- **Bug:** The catch-branch S18 identity check at lines 357-361 has no `editor.isDestroyed` backstop (unlike the success branch where the line-328 guard exists alongside the line-327 identity check). The diff adds an inline test for the success path (`Editor.test.tsx:943-1023`) but no test exercises the catch with `api.images.upload` rejecting. A revert of the catch-branch fix would silently re-introduce cross-chapter failure-announce on upload failure. The TipTap reconciliation confirms why this matters: `node_modules/@tiptap/react/dist/index.js:1026-1048` shows `scheduleDestroy` uses `setTimeout(..., 1)`, so the destroy is a macrotask — the catch's `.catch` microtask runs first; at the moment the success path's line-328 `!editor.isDestroyed` check fires, the editor is NOT yet destroyed. The S18 identity check is what makes the test exercise the bug. For the catch branch, there is no equivalent isDestroyed backstop at all, so a coverage gap there is more dangerous than the success-branch coverage gap would be.
- **Impact:** Silent regression risk in a load-bearing S18 fix. The only failure modes that would surface it today are manual paste-upload testing with deliberate network failures during chapter switches.
- **Suggested fix:** Add a sibling test that mocks `api.images.upload` to reject with a non-aborted ApiRequestError, performs the same same-project chapter-switch sequence as the existing S18 success test, and asserts `onImageAnnouncement` was NOT called with the failure copy.
- **Confidence:** Medium-High
- **Found by:** Error Handling

## Suggestions

- **`createRecoveryAbortRef` null-out not in `.finally`** — `useProjectEditor.ts:907-915`. The S17 null lives inside the recovery `try` body and only runs on the happy path. Sibling fixes T1 (`useTrashManager`) and S19 (`useSnapshotState` post-S2-round-2) put theirs in `.finally`. On a stale-token bail or recovery-GET reject, the ref still points at the settled controller. Harmless today (no consumer reads it after settlement) but defense-in-depth gap and inconsistent with the sibling pattern. Restructure as try/catch/finally with the identity-checked null in finally.

- **`handleCreateChapter` `recoverySlug ?? slug` re-introduces staleness on navigate-home** — `useProjectEditor.ts:860`. The `?? slug` fallback returns the handler-entry-captured (known-stale) slug when `projectSlugRef.current` is undefined, defeating the S1 round-2 intent. Drift guards prevent state corruption; the recovery GET still fires against a slug pointing at a project that may now be gone (404 → devWarn). Drop the `?? slug` fallback; bail (or skip recovery) if `projectSlugRef.current` is undefined.

- **`interceptWithSuccessBadJson` preserves original `content-length`, risks Chromium NETWORK classification** — `e2e/helpers/interceptWithSuccessBadJson.ts:27-31`. The helper keeps the original `content-length` while sending a 17-byte mangled body. Playwright/Chromium behavior on mismatched content-length is browser-version dependent; under some conditions the response surfaces as a NETWORK error (`classifyFetchError` → `NETWORK`, transient) rather than 2xx BAD_JSON (`possiblyCommitted`). Test flake risk under future toolchain upgrades. Strip the original content-length: `const { 'content-length': _drop, ...rest } = response.headers();`.

- **trash-restore-recovery e2e conflates GET dispatch + completion + UI updates; no banner-persistence assertion** — `e2e/trash-restore-recovery.spec.ts:125-138`. The 10-second timeout on `toHaveCount(2)` makes a broken recovery GET surface as a flake-shaped timeout instead of a clear failure, and the test never asserts the banner stays visible after the recovery refresh lands. Insert `await page.waitForRequest("**/api/projects/*")` between the Restore click and the chapter-count assertion, and add `await expect(banner).toBeVisible()` after the count assertion.

- **S11 test uses too-permissive `not.toHaveBeenCalledWith` matcher form** — `useProjectEditor.test.ts:2918-2924`. Silently passes if the warn shape changes but warn still fires, leaving the CLAUDE.md zero-warnings rule unenforced for the regression case. Replace with `expect(warnSpy).not.toHaveBeenCalled()` and scope the spy narrowly to this test's act block.

- **Cross-create test asserts call-count rather than call-args** — `useProjectEditor.test.ts:3737`. `expect(api.projects.get).toHaveBeenCalledTimes(2)` would still pass if a future regression fired GET against the wrong slug. Replace with `expect(api.projects.get).toHaveBeenLastCalledWith("test-project", expect.any(AbortSignal))`.

- **handleRestore I1 comment overstates the inside-updater protection** — `useTrashManager.ts:264-266`. The comment claims "single identity guard for BOTH setProject and replaceConfirmedStatuses", but only the `setProject` updater re-checks; `replaceConfirmedStatusesRef.current?.(refreshed)` at line 266 is synchronous and gated only by the statement-time check at line 264. Safe today (no awaits between 264-266); a future await insertion would silently corrupt the cache. Either inline the cache reseed inside the same `setProject` updater or add an inner `if (projectRef.current?.id === refreshed.id)` guard immediately before line 266.

- **`handleRestore` `onCommitted` silently skips recovery refresh when `slugRef` is undefined** — `useTrashManager.ts:241-242`. `const currentSlug = slugRef.current; if (!currentSlug) return;` silently skips the recovery GET with no log. The user has already seen the committed-restore banner; sidebar and trash list silently desync from server state. Add `devWarn("handleRestore committed-recovery: slugRef.current was undefined", …)` or accept the silent skip with a comment explaining why this is unreachable in practice.

- **Editor unmount cleanup ordering is load-bearing and undocumented** — `Editor.tsx:206-229, 284-297`. Today the save effect (line 206) is declared before the S18 ref-null effect (line 284), and React cleans up effects in registration order, so unmount-save still fires correctly. A future refactor that reorders or merges these effects would silently break unmount-save (the `if (dirtyRef.current && editorInstanceRef.current)` guard at line 218 would short-circuit). Snapshot `editorInstanceRef.current` into a local at the top of the save effect (so the save reads the captured pointer, not the live ref), or add an inline comment to the S18 effect noting the load-bearing ordering.

- **`replaceConfirmedStatusesFromProject` exported under a different internal name** — `useProjectEditor.ts:1646` (export alias) and `:228` (definition). Plan-mandated public name is `replaceConfirmedStatusesFromProject`; the internal definition uses `reseedConfirmedStatusesFromProject` (the S1 round-1 helper extraction chose `reseed*`). Two names for one function — `grep` for callers misses one half each time. Rename the internal definition to `replaceConfirmedStatusesFromProject` and drop the alias at line 1646.

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

- **[OOSS1]** Snapshot chapter-switch effect's `.catch(() => { /* leave count as null */ })` while the structurally identical sibling on the restore-followup snapshot list was upgraded to `devWarn` in S2 round-2 (`useSnapshotState.ts:241-244`, backlog id `7447052d` — new). A real failure in `api.snapshots.list` for the chapter-switch path will not surface in dev. Fix: replace with `devWarn("snapshot list (chapter-switch) failed", controller.signal, err)`. **Found by:** Logic & Correctness.
- **[OOSS2]** Snapshot `refreshCount` bare `.catch(() => {})` swallows every failure while the parallel restore-followup site uses `devWarn` (`useSnapshotState.ts:530`, backlog id `adb234cb` — new). Same sibling-divergence shape as OOSS1. Fix: `.catch((err) => devWarn("snapshot refreshCount failed", controller.signal, err))` and destructure `{ promise, signal }` from `refreshCountOp.run`. **Found by:** Error Handling.
- **[OOSS3]** `useTrashManager` `seedConfirmedStatusRef` effect re-runs every parent render because `useProjectEditor` returns `seedConfirmedStatus: (id, status) => …` as a fresh arrow per render (`useTrashManager.ts:30-37`, backlog id `1303c9f4` — new). The new sibling `replaceConfirmedStatusesFromProject` IS memoized, making the asymmetry visible. Fix: wrap `seedConfirmedStatus` in `useCallback((id, status) => …, [])` in `useProjectEditor`, or drop the trash hook's effect dep. **Found by:** Contract & Integration.

## Review Metadata

- **Agents dispatched:** Logic & Correctness (Group A hooks, Group B editor/tests), Error Handling (Group A hooks, Group B editor/tests), Contract & Integration (Group A hooks, Group B editor/tests), Concurrency & State (Group A hooks, Group B editor/tests), Security (single), Spec Compliance (single), Verifier (single). All ten specialists ran (`claude-opus-4-7[1m]`) with their reference-file tokens confirmed (`[ref-loaded:…]`).
- **Scope:** all files in the diff (`packages/client/src/{hooks,components,pages,__tests__}`, `e2e/`, `CLAUDE.md`), one level of callers/callees (`packages/client/src/App.tsx`, `apiErrorMapper.ts`, `applyMappedError.ts`, `scopes.ts`, `devWarn.ts`, `useAbortableSequence.ts`, `useAbortableAsyncOperation.ts`, `pages/HomePage.tsx`, `api/client.ts`), the two prior reviews on this branch (`paad/code-reviews/consumer-recovery-independent-fixes-2026-05-27-08-03-50-be39c67.md`, `…-11-37-51-5576869.md`), and the plan/design docs (`docs/plans/2026-05-26-consumer-recovery-completeness-{design,plan}.md`).
- **Raw findings:** 29 (across all specialists, before verification)
- **Verified findings:** 14 in-scope (4 Important + 10 Suggestion) + 3 out-of-scope (3 Suggestion)
- **Filtered out:** 12 — including three refuted by the Verifier (EB1 S18-test-validity claim refuted by reading TipTap source confirming `scheduleDestroy` uses `setTimeout(..., 1)`; LB4 gallery-refresh-asymmetry intentional by project-vs-editor scope; SC4 onProjectNotFound callback shape an improvement over the plan's prescribed direct navigate), plus nine merged-duplicate findings collapsed into the three Important items.
- **Out-of-scope findings:** 3 (Critical: 0, Important: 0, Suggestion: 3)
- **Out-of-scope additions:** N/A — Spec Compliance produced two OOSA findings (wider drift-guard sweep + inline pin-test pattern); they were dropped from this report at the author's standing instruction that deliberate scope expansion is the author's call to make. Bugs within the deliberately-added code (I2, the wider-sweep handleStatusChange gap) are reported normally as in-scope Important.
- **Backlog:** 3 new entries added, 0 re-confirmed (see `paad/code-reviews/backlog.md`). The existing entries `a65acf76` (handleCreateChapter recovery S20-style inside-updater guard) and `dc808129` (handleUpdateProjectTitle slug-recovery) are not re-confirmed by this run — neither was raised by any specialist as a current bug, indicating the wider sweep's general pattern adoption has likely addressed (or made dormant) those concerns.
- **Steering files consulted:** `CLAUDE.md` (Save-pipeline invariants, PR Scope rules, Unified API error mapping, Testing Philosophy zero-warnings rule, Accessibility constraints).
- **Intent sources consulted:** `docs/plans/2026-05-26-consumer-recovery-completeness-design.md`, `docs/plans/2026-05-26-consumer-recovery-completeness-plan.md`, `docs/roadmap.md`, prior reviews `…be39c67.md` and `…5576869.md`, commit messages on branch.
- **Verifier warnings:** none
