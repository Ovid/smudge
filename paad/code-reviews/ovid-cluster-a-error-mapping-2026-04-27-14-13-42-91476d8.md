# Agentic Code Review: ovid/cluster-a-error-mapping

**Date:** 2026-04-27 14:13:42
**Branch:** ovid/cluster-a-error-mapping -> main
**Commit:** 91476d8c3a26d725d1cdc8c8079df645d5a9a85a
**Files changed:** 16 | **Lines changed:** +813 / -144
**Diff size category:** Large

## Executive Summary

Third pass over Cluster A (error-mapping) at HEAD `91476d8`, after two refactor commits since the prior review at `4b43b07` (`rejected4xx → terminalSaveError` rename, `SAVE_BACKOFF_MS` export). Six specialists + Verifier produced 5 in-scope findings — the only Important is a CLAUDE.md "zero-warnings" rule violation in two `useProjectEditor.test.ts` 404 tests that install a `warnSpy` but never assert on it. Three latent findings document defense-in-depth gaps in newly-introduced patterns (debouncedSave isEditable soft contract, status-only 404 lock predicate, `mapApiErrorMessage` empty-string fallback) — informational, not merge-blocking. One out-of-scope Important re-confirms the `4d5b9e81` backlog entry (Editor unmount cleanup ignores `setEditable(false)`); the prior C1 revert means the editor-level invariant remains incomplete on the unmount path. No critical issues; the rename + export refactors are clean.

## Critical Issues

None found.

## Important Issues

### [I1] `useProjectEditor.test.ts` 404 tests install `warnSpy` but never assert on it
- **File:** `packages/client/src/__tests__/useProjectEditor.test.ts:1434-1453, 1466-1486`
- **Bug:** Both 404 NOT_FOUND tests (the I2 envelope-coded test and the S3 bare-404 test) install `const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})` and restore it at the end, but never `expect(warnSpy).toHaveBeenCalledWith(...)`. The handleSave 4xx branch at `useProjectEditor.ts:401` calls `console.warn("Save failed with 4xx:", err)`, so the spy IS catching a real warning. The sibling test at line 1290 (4xx ApiRequestError) does correctly assert `expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Save failed with 4xx:"), ...)`.
- **Impact:** CLAUDE.md "zero warnings in test output" rule explicitly requires "spy on the output, suppress it, **and assert the expected message**." Suppressing without asserting means a future change that drops or reworks the warn call would silently pass these two tests; the warn is no longer an enforced part of the contract.
- **Suggested fix:** Add `expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Save failed with 4xx:"), expect.anything())` at the end of both tests (around line 1452 and line 1485).
- **Confidence:** High
- **Found by:** Contract & Integration (`general-purpose (claude-opus-4-7)`)

## Suggestions

- **[S1]** `packages/client/src/hooks/useProjectEditor.ts:298-300` — `terminalSaveError` doc-comment line refs (`~465`, `~433`, `~494`) drift from actual locations (`~479`, `~448`, `~509`); the rename commit `6f47f27` shifted code without updating the cross-refs. Replace with semantic anchors or update numerics. **Found by:** Contract & Integration (`general-purpose (claude-opus-4-7)`).
- **[S2]** `packages/client/src/errors/apiErrorMapper.test.ts:347-350` — `chapter.save` lacks a `{status: 404, code: "OTHER"}` precedence pin and a bare-404 (no envelope code) pin; trash.restoreChapter has both directions covered. Add tests mirroring trash.restoreChapter's structure. **Found by:** Contract & Integration (`general-purpose (claude-opus-4-7)`).
- **[S3]** `e2e/editor-save.spec.ts:108-109` — status-region assertion uses substring `/no longer available/i`; pin to full `STRINGS.editor.saveFailedChapterGone` so a copy regression that preserves the substring would still fail the test. Same shape as the prior `/Unable to save/` finding. **Found by:** Error Handling & Edge Cases (`general-purpose (claude-opus-4-7)`).
- **[S4]** `e2e/editor-save.spec.ts:117` — lock-banner alert filter shares the same loose substring with the status footer; pin to exact `STRINGS.editor.saveFailedChapterGone` AND assert the Refresh button (the lock banner's structural anchor) is visible. **Found by:** Error Handling & Edge Cases (`general-purpose (claude-opus-4-7)`).

## Latent

> Findings on lines this branch authored where the bug is not currently reachable
> via any live code path, but the pattern itself is brittle or load-bearing for
> future work. **Not a merge-blocker** — record so the next change in this area
> is informed. Does not enter the OOS backlog (the branch authored these).

### [LAT1] `chapter.save` editor-lock predicate is status-only on the 404 branch
- **File:** `packages/client/src/hooks/useProjectEditor.ts:509-517`
- **Bug:** Predicate is `terminalSaveError.status === 404 || terminalSaveError.code === "BAD_JSON" || terminalSaveError.code === "UPDATE_READ_FAILURE" || terminalSaveError.code === "CORRUPT_CONTENT"`. The 404 arm is status-only; the other terminal arms are code-only with an explicit allowlist. This sidesteps the byCode/byStatus precedence the rest of the system uses.
- **Why latent:** The chapter PATCH server route only emits `code: "NOT_FOUND"` at 404 today, and an envelope-stripped proxy 404 is the only other live source — both genuinely warrant a lock. No live caller can drive the predicate into a misclassification.
- **What would make it active:** Adding any new `code: X` envelope to a 404 response on the chapter PATCH route — particularly a non-terminal recovery hint (e.g. `STALE_CHAPTER_VERSION` reload-and-retry) — would activate the bug; the predicate would still lock the editor.
- **Suggested hardening:** Replace the inline predicate with `mapApiError(err, "chapter.save").possiblyCommitted || code-allowlist` so the lock decision flows from the scope's classification rather than re-encoding it. Cheaper alternative: gate `status === 404` with `&& terminalSaveError.code === undefined`, preserving proxy-strip behavior while requiring future codes to opt in. Pair either with a unit test for a hypothetical non-NOT_FOUND 404 code.
- **Confidence:** Medium
- **Found by:** Error Handling & Edge Cases (`general-purpose (claude-opus-4-7)`)

### [LAT2] `Editor.debouncedSave` `isEditable` short-circuit relies on a documented soft contract
- **File:** `packages/client/src/components/Editor.tsx:182`
- **Bug:** When the debounce timer fires and `editorInstance.isEditable === false`, the callback returns without saving and **without re-arming a new debounce**. `dirtyRef.current` stays `true`. The S8 comment block (lines 171-181) audits this as safe today because every `setEditable(true)` caller either remounts the Editor or pairs with explicit `flushSave`/`onSave`.
- **Why latent:** The audit holds — chapter switch keys per-chapter (so the Editor remounts), snapshot restore drives a flushSave, project-wide replace drives a flushSave. No live flow re-enables an existing Editor without flush.
- **What would make it active:** A future flow that re-enables an existing Editor without remount AND without external flushSave (e.g. an "auto-recover from lock" toast button, an in-place lock-clear on idle) would strand the dirty content until the next keystroke or blur. The localStorage cache is the data-loss insurance, but a quota eviction or LRU drop in that window would lose typing.
- **Suggested hardening:** Make the contract programmatic. Either (a) add a runtime invariant in `setEditable` that asserts `dirtyRef.current === false` on `false → true` transitions, OR (b) re-queue the debounce timer at the same delay when locked so the next fire either lands (still locked → re-defer; editable → save). Option (a) is simpler and matches the explicit-error-on-misuse philosophy of the save-pipeline invariants block in CLAUDE.md.
- **Confidence:** Medium
- **Found by:** Error Handling & Edge Cases (`general-purpose (claude-opus-4-7)`)

### [LAT3] `mapApiErrorMessage` `??` fallback does not catch empty-string `byCode`/`byStatus` entries
- **File:** `packages/client/src/errors/apiErrorMapper.ts:193-195`
- **Bug:** The helper returns `mapApiError(err, scope).message ?? fallback`. `??` only fires for `null`/`undefined`. A future scope that maps a code to `""` (intentionally to suppress the banner) would yield `message: ""`; `"" ?? fallback` returns `""`, not the fallback — producing a blank banner.
- **Why latent:** Every entry in SCOPES today resolves to a non-empty `STRINGS.*` constant; the resolver only ever returns `null` (ABORTED) or a non-empty string for live inputs.
- **What would make it active:** A scope author later adds `byCode: { X: "" }` to opt out of a banner for code X, intending callers to rely on the fallback parameter.
- **Suggested hardening:** Add a `describe.each(ALL_SCOPES)` test that asserts every `byCode` / `byStatus` / `fallback` / `network` / `committed` value is a non-empty trimmed string in `scopes.ts` — catches the regression at the source rather than at every `mapApiErrorMessage` call site. (Switching the helper to `||` would also work but would silently mishandle a future legitimate empty `extras` shape, so the test-side pin is safer.) This re-confirms the prior LAT2 from `4b43b07`; no new code change since.
- **Confidence:** Medium
- **Found by:** Error Handling & Edge Cases (`general-purpose (claude-opus-4-7)`)

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

#### [OOSI1] Editor unmount cleanup ignores `setEditable(false)` lock — backlog id: `4d5b9e81`
- **File:** `packages/client/src/components/Editor.tsx:218-227`
- **Bug:** The unmount cleanup at lines 214-228 fires `onSaveRef.current(getJSON, mountChapterId)` whenever `dirtyRef.current && editorInstanceRef.current` are truthy, with no `editor.isEditable` check. Sibling save-emitting paths in the same file gate (or once-gated) on the lock state: `debouncedSave` at line 182 (I6 guard), `onBlur` at line 254 (C2 guard), `flushSave` at line 346 — but flushSave deliberately does NOT gate after the C1 revert at `4b43b07`. The unmount path is therefore the lone editor-side save emitter without the gate.
- **Impact:** Today, safety is by transitive reasoning across `handleSaveLockGated`'s read of `editorLockedMessageRef` from EditorPage's closure. During a `useEditorMutation.run()` window the lock banner is null (the in-flight mutation hasn't reached a known-failure terminal state), so an unmount fired by user-driven navigation in that window can fire a fresh PATCH that races the in-flight mutation. The PATCH can land after the mutation commits and silently revert the just-committed restore/replace. This branch's editor-lock surface expanded (NOT_FOUND, BAD_JSON, UPDATE_READ_FAILURE, CORRUPT_CONTENT all now request the lock) without closing the unmount-cleanup gap, so the bug has measurably more fire opportunities post-merge — but the bug predates this branch and line 218 is NOT in touched-lines.
- **Suggested fix:** Mirror the C2 onBlur guard inside the unmount cleanup so the lock discriminator is local to the Editor:
  ```ts
  if (
    dirtyRef.current &&
    editorInstanceRef.current &&
    (editorInstanceRef.current as { isEditable?: boolean }).isEditable !== false
  ) {
    onSaveRef.current(getJSON, mountChapterId).catch(() => {});
  }
  ```
- **Confidence:** Medium
- **Found by:** Concurrency & State (`general-purpose (claude-opus-4-7)`)
- **Backlog status:** re-seen (first logged 2026-04-26)

### Out-of-Scope Suggestions
None found.

## Plan Alignment

Plan documents consulted: `docs/plans/2026-04-25-4b3a-review-followups-design.md`, `docs/plans/2026-04-25-4b3a-review-followups-plan.md`, `docs/roadmap.md`.

### Implemented (Cluster A core)

- **[I1]** `chapter.reorder` `byCode: { REORDER_MISMATCH }` + new `STRINGS.error.reorderMismatch` — `errors/scopes.ts:186-192`, `strings.ts:86`. Unit-tested.
- **[I2]** `chapter.save` adds `network: STRINGS.editor.saveFailedNetwork`, `byStatus: { 404: STRINGS.editor.saveFailedChapterGone }`, and reworded neutral `saveFailed` — `errors/scopes.ts:106-143`, `strings.ts:104-144`. Unit-tested. Design-mandated e2e present at `e2e/editor-save.spec.ts:73-121`.
- **[S1]** `trash.restoreChapter` `byStatus: { 404 }` — `errors/scopes.ts:452-466`. Unit-tested.

### Not yet implemented

- **Cluster B** (AbortSignal threading, [I6]–[I12], [S12]) — pending. The original [I6] meaning has shifted: this branch absorbed the lock-aware aspect via `debouncedSave`'s `isEditable` short-circuit; what remains is upload-signal threading.
- **Cluster C** (Consumer recovery completeness, [I3]–[I5], [S3]–[S20]) — pending except where this branch absorbed pieces (see PA1 below).
- **Cluster D** (Sanitizer hardening, [I14], [S21]) — pending.
- **Cluster E** (Mapper internals + CLAUDE.md, [S2], [S6], [S9], [S13], [S14]) — pending except for the `mapApiErrorMessage` helper extraction (PA4).
- **Cluster F** retrospective — design-level only; no code action by design.

The design also stipulates "All five PRs land on `ovid/miscellaneous-fixes`, rebased on `main` between merges" — this branch is named `ovid/cluster-a-error-mapping`, a deliberate divergence from the design's branching scheme. Suggestion-level branch-naming deviation only; does not affect merge mechanics.

### Deviations

The PR ships +813/-144 across 16 files for what the design scoped at three scope entries plus three new strings. Each addition is review-driven and individually defensible; cumulatively they constitute scope creep beyond Cluster A. Per CLAUDE.md §Pull Request Scope, scope creep is a finding even when review-driven — the right disposition is to log the exception in the PR description and backfill the design doc, not to rewind work the user has already validated.

- **[PA1] Consumer-side changes that the design assigned to Cluster B/C.** Design line 109: "Any consumer-side changes (those belong in Cluster C)." Four consumer-side changes shipped here:
  1. `useProjectEditor.handleSave` post-retry-exhaustion banner now routes through `mapApiError(err, "chapter.save")` — adopting [I2]'s new `network:` mapping (commits `ae09989`, `734bfbe`).
  2. `useProjectEditor.handleSave` editor lock now triggers on `status === 404` in addition to the prior terminal codes (commits `c670281`, `67e9abd`).
  3. `EditorPage.tsx` Ctrl+S `flushSave` catch routes through `mapApiErrorMessage` instead of literal `STRINGS.editor.saveFailed` (commit `48a8306`).
  4. `Editor.tsx` `debouncedSave` adds an `isEditable === false` short-circuit (I6, commit `89af2a8`); a mirrored `flushSave` guard was added (OOSS1, `5058c69`) and reverted (C1, `4b43b07`) as a silent-data-loss regression.

  **Severity:** Important. The Editor.tsx I6+OOSS1+C1 sequence is exactly the kind of churn the one-feature-rule is meant to prevent — a Cluster B PR could have surfaced the data-loss interaction with `useEditorMutation` separately and avoided the add-then-revert dance on this branch. (`Plan Alignment`, opus-4-7-1m, confidence 92.)

- **[PA2] `chapter.save` `byStatus` additions beyond design.** Design [I2] specified only `network` and `byStatus[404]`. The branch adds `byStatus: { 500, 502, 503, 504 }` mapped to a new `saveFailedServer` string (commits `a8e940d`, `921a53e`). Defensible: the [I2] rewording of `saveFailed` to neutral copy made the post-retry banner less actionable for bare-5xx exhaustion than before — the byStatus[5xx] additions restore informativeness. **Severity:** Suggestion. (`Plan Alignment`, confidence 80.)

- **[PA3] `trash.restoreChapter` byStatus[404] copy split.** Design [S1] specified `byStatus[404] → restoreChapterAlreadyPurged`. Implementation introduces a softer `restoreChapterUnavailable` for byStatus[404] and reuses `restoreChapterAlreadyPurged` only for `byCode: CHAPTER_PURGED`. Defensible: the S4 review (2026-04-26) noted that bare 404 may be a never-existed or stale-URL case, not necessarily purged, so a permanence claim is wrong outside the explicit `CHAPTER_PURGED` code. **Severity:** Suggestion. (`Plan Alignment`, confidence 85.)

- **[PA4] `mapApiErrorMessage` helper extraction belongs in Cluster E.** Design lines 199-211 reserve mapper-internals refactors for Cluster E. The `mapApiErrorMessage` helper (commit `fd3f33a`, S2) was extracted opportunistically while addressing [I2]'s call-site rewrite. Note: distinct from Cluster C's [S15] `applyMappedError` — captures only the `?? fallback` idiom, not the multi-callback dispatcher. **Severity:** Suggestion. (`Plan Alignment`, confidence 80.)

- **[PA5] Test-infra additions outside Cluster A scope.** A new `__tests__/helpers/saveRetries.ts` (`flushSaveRetries` for the 2s/4s/8s backoff triple, commit `74531fa`), a 300ms find-replace debounce skip in `EditorPageFeatures.test.tsx` (commit `27e42d5`), and the `SAVE_BACKOFF_MS` export commit `91476d8` (a production-side touch that exposes an existing constant for test-helper consumption). Precedent for opportunistic test-infra changes already exists in the design doc's Cluster F retrospective ([S22]/[S23]). **Severity:** Suggestion. (`Plan Alignment`, confidence 70.)

### Re-evaluation of the two new commits since SHA `4b43b07`

The two new commits do **not** introduce new deviation categories:

- **`6f47f27` (`rejected4xx → terminalSaveError`)** — comment/clarity rename inside the same `useProjectEditor.handleSave` block already implicated by PA1.3. The new variable name better reflects PA1's expansion of terminal codes to include `status === 404`. Pure rename via diff — no behavioral change. Falls under PA1.

- **`91476d8` (`export SAVE_BACKOFF_MS`)** — extends PA5's test-infra surface with a small production-side hook (one new `export const`, references in the production hook updated to use it). Replaces the previously-brittle "keep in sync" docstring pattern in the test helper. Falls under PA5.

### Recommended actions for the PR description

For [PA1]: log a "Cluster A scope exception" block listing the four consumer-side commits with their review tags and one-line justifications, and update `docs/plans/2026-04-25-4b3a-review-followups-design.md` to record that Cluster A absorbed save-pipeline lock-on-404 + Ctrl-S routing + debouncedSave isEditable guard, then adjust Cluster B/C item lists so the same fixes are not double-counted (specifically narrowing Cluster B's [I6] from "isEditable + signal threading" to "signal threading only").

For [PA2], [PA3], [PA4]: backfill the design doc with one-line notes on each deviation (round-2/round-3 review tags can be cited verbatim).

For [PA5]: cite the [S22]/[S23] precedent. Note the `91476d8` `SAVE_BACKOFF_MS` export as a test-sync hook — production-side touch is the export of an existing constant, not new behavior.

For the two new commits (`6f47f27`, `91476d8`): no action beyond inclusion in the PR body's commit list — they are documented review-feedback follow-ups within the existing deviation envelope.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment (6 specialists in parallel) + Verifier (sequential).
- **Scope:** All 16 changed files plus adjacent context (`packages/server/src/projects/projects.routes.ts`, `packages/server/src/chapters/chapters.routes.ts`, `packages/client/src/api/client.ts`, `packages/client/src/hooks/useAbortableSequence.ts`, `packages/client/src/hooks/useEditorMutation.ts`, `packages/client/src/hooks/useTrashManager.ts`).
- **Raw findings:** 18 (before verification: 0 Logic, 6 Error Handling, 6 Contract & Integration, 1 Concurrency, 0 Security, 5 Plan Alignment).
- **Verified findings:** 9 (after verification: 5 in-scope, 3 latent, 1 out-of-scope, 5 Plan-Alignment deviations).
- **Filtered out:** 4 (EH6 non-Error throw — fallback already correct; CI4 mapApiErrorMessage JSDoc — technically correct, doc polish only; CI5 5xx duplicate strings — intentional per S7; CI6 chapter.reorder lacks committedCodes — forward-conditional only).
- **Latent findings:** 3 (Critical: 0, Important: 0, Suggestion: 3).
- **Out-of-scope findings:** 1 (Critical: 0, Important: 1, Suggestion: 0).
- **Backlog:** 0 new entries added, 1 re-confirmed (`4d5b9e81`).
- **Steering files consulted:** `/workspace/CLAUDE.md`.
- **Plan/design docs consulted:** `docs/plans/2026-04-25-4b3a-review-followups-design.md`, `docs/plans/2026-04-25-4b3a-review-followups-plan.md`, `docs/roadmap.md`.
