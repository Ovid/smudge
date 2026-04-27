# Agentic Code Review: ovid/cluster-a-error-mapping

**Date:** 2026-04-27 12:50:17
**Branch:** ovid/cluster-a-error-mapping -> main
**Commit:** 4b43b07998f2a40d4b699cf7be6af931eb617967
**Files changed:** 16 | **Lines changed:** +789 / -135
**Diff size category:** Large

## Executive Summary

The branch ships Cluster A of the 4b.3a review-followups (scope-coverage gaps for `chapter.reorder`, `chapter.save`, `trash.restoreChapter`) plus a chain of review-driven follow-up fixes (S/I/OOSS/C1 tags). After dispatching five specialists and a Plan Alignment reviewer, the only verified in-scope code finding is a brittle e2e assertion that masks regressions of this branch's own NETWORK mapping. Two latent findings document defensive-pattern gaps in newly-introduced surface (a 404-lock predicate that will mis-classify future codes; an empty-string fallback hazard in the new `mapApiErrorMessage` helper). One pre-existing Important concurrency bug (Editor unmount cleanup ignoring `setEditable(false)`) is confirmed and matches an existing backlog entry. The dominant non-code observation is plan-alignment scope creep: this PR absorbed four consumer-side changes that the design assigned to Clusters B/C, plus a Cluster E refactor and test-infra additions — all defensible per individual review tag, but cumulatively a one-feature-rule violation.

## Critical Issues

None found.

## Important Issues

None found.

## Suggestions

- **[S1]** `e2e/editor-save.spec.ts:145` — `toContainText("Unable to save", …)` is satisfied by `saveFailedNetwork`, `saveFailedServer`, `saveFailedInvalid`, `saveFailedTooLarge`, AND `saveFailedCorrupt`; pin to `STRINGS.editor.saveFailedNetwork` (or the discriminating substring `"check your connection"`) so a regression of this branch's NETWORK mapping is detectable. **Found by:** Contract & Integration (`general-purpose (claude-opus-4-7)`).

## Latent

> Findings on lines this branch authored where the bug is not currently reachable
> via any live code path, but the pattern itself is brittle or load-bearing for
> future work. **Not a merge-blocker** — record so the next change in this area
> is informed. Does not enter the OOS backlog (the branch authored these).

### [LAT1] `chapter.save` editor-lock predicate covers all status-404 codes
- **File:** `packages/client/src/hooks/useProjectEditor.ts:494-501`
- **Bug:** The lock predicate `rejected4xx.status === 404 || rejected4xx.code === "BAD_JSON" || …` is status-only on the 404 branch (added by S3 to handle envelope-stripped proxy 404s). Today the chapter PATCH route (`packages/server/src/chapters/chapters.routes.ts`) only emits `code: "NOT_FOUND"` at 404, so every 404 the predicate sees is genuinely terminal. A future server change that adds a recoverable 404 code (e.g. a hypothetical `STALE_CHAPTER_VERSION` reload-and-retry hint) would be hard-locked by default — the inverse of the policy `code === "BAD_JSON" | "UPDATE_READ_FAILURE" | "CORRUPT_CONTENT"` encodes for the other terminal-code branches.
- **Why latent:** The chapter PATCH server route only emits `NOT_FOUND` at 404 today; envelope-strip from a proxy is the only other live source of bare 404, and that case correctly warrants a lock. No live caller can drive the predicate into a misclassification.
- **What would make it active:** Adding any new `code: "X"` envelope to a 404 response on the chapter PATCH route — particularly a non-terminal recovery hint — would activate the bug.
- **Suggested hardening:** Tighten the 404 branch to `(!rejected4xx.code || rejected4xx.code === "NOT_FOUND")`, preserving proxy-strip behavior while requiring future codes to opt in. Pair with a unit test fixture exercising a hypothetical non-NOT_FOUND 404 code.
- **Confidence:** Medium
- **Found by:** Contract & Integration (`general-purpose (claude-opus-4-7)`)

### [LAT2] `mapApiErrorMessage` `??` fallback does not catch empty-string `byCode` entries
- **File:** `packages/client/src/errors/apiErrorMapper.ts:184-195`
- **Bug:** The helper returns `mapApiError(err, scope).message ?? fallback`. `??` only fires for `null`/`undefined`. A future scope that maps a code to `""` (intentionally to suppress the banner) would yield `message: ""`; `"" ?? fallback` returns `""`, not the fallback — producing a blank banner. The docstring claims "non-ABORTED errors always produce scope.fallback or better, so the fallback parameter only fires on ABORTED in practice."
- **Why latent:** Every entry in `SCOPES` today resolves to a non-empty `STRINGS.*` constant; the resolver only ever returns `null` (ABORTED) or a non-empty string for live inputs.
- **What would make it active:** A scope author later adds `byCode: { X: "" }` to opt out of a banner for code X, intending callers to rely on the fallback parameter.
- **Suggested hardening:** Add a `describe.each(ALL_SCOPES)` test that asserts every `byCode`/`byStatus`/`fallback`/`network`/`committed` value is a non-empty string in `scopes.ts` — catches the regression at the source rather than at every `mapApiErrorMessage` call site. (Switching the helper to `||` would also work but would silently mishandle a future legitimate empty `extras` shape, so the test-side pin is safer.)
- **Confidence:** Medium
- **Found by:** Contract & Integration (`general-purpose (claude-opus-4-7)`)

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
- **File:** `packages/client/src/components/Editor.tsx:218`
- **Bug:** The unmount cleanup at lines 214-228 fires `onSaveRef.current(getJSON, mountChapterId)` whenever `dirtyRef.current && editorInstanceRef.current` are truthy, with no `editor.isEditable` check. Sibling save-emitting paths in the same file all gate on the lock state (`debouncedSave` at line 182 via the I6 guard, `onBlur` at line 254 via the C2 guard, `flushSave` at line 360 via the explicit `setEditable(false)` contract). The new I6 contract intentionally leaves `dirtyRef === true` while the editor is locked, widening the latent window.
- **Impact:** Today, safety is by transitive reasoning across `handleSaveLockGated`'s read of `editorLockedMessageRef` from EditorPage's closure. Three orderings keep this safe in practice (same-page chapter switch, page reload, cross-project navigation), but the safety is a load-bearing implicit invariant. A refactor that replaces `handleSaveLockGated` with raw `handleSave`, or moves the `editorLockedMessageRef.current = …` write from render into a useEffect, would silently re-introduce the data-loss path.
- **Suggested fix:** Mirror the C2 onBlur guard inside the unmount cleanup so the lock discriminator is local to the Editor:
  ```ts
  if (dirtyRef.current && editorInstanceRef.current && editor?.isEditable !== false) {
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

- **[I1]** `chapter.reorder` `byCode: { REORDER_MISMATCH }` + new string `STRINGS.error.reorderMismatch` — `errors/scopes.ts:192`, `strings.ts:86`. Unit-tested.
- **[I2]** `chapter.save` adds `network: STRINGS.editor.saveFailedNetwork`, `byStatus: { 404: STRINGS.editor.saveFailedChapterGone }`, and reworded neutral `saveFailed` — `errors/scopes.ts:104-156`, `strings.ts:136-145`. Unit-tested. Design-mandated e2e present at `e2e/editor-save.spec.ts:73-122`.
- **[S1]** `trash.restoreChapter` `byStatus: { 404 }` — `errors/scopes.ts:466`. Unit-tested.

### Not yet implemented

None for Cluster A. Clusters B/C/D/E remain (per design) — partial is expected.

### Deviations

The PR ships +789/-135 lines for what the design scoped at three scope entries plus three new strings. Each addition is review-driven and individually defensible; cumulatively they constitute scope creep beyond Cluster A. Per CLAUDE.md §Pull Request Scope, scope creep is a finding even when review-driven — the right disposition is to log the exception in the PR description and backfill the design doc, not to rewind work the user has already validated.

- **[PA1] Consumer-side changes that the design assigned to Cluster B/C.** Design line 109: "Any consumer-side changes (those belong in Cluster C)." Four consumer-side changes shipped here:
  1. `useProjectEditor.handleSave` post-retry-exhaustion banner now routes through `mapApiError(err, "chapter.save")` — adopting [I2]'s new `network:` mapping (commits `ae09989`, `734bfbe`).
  2. `useProjectEditor.handleSave` editor lock now triggers on `status === 404` in addition to the prior terminal codes (commits `c670281`, `67e9abd`).
  3. `EditorPage.tsx` Ctrl+S flushSave catch routes through `mapApiErrorMessage` instead of literal `STRINGS.editor.saveFailed` (commit `48a8306`).
  4. `Editor.tsx` `debouncedSave` adds an `isEditable === false` short-circuit (I6, commit `89af2a8`); a mirrored `flushSave` guard was added (OOSS1, `5058c69`) and reverted (C1, `4b43b07`) as a silent-data-loss regression.

  **Severity:** Important. The Editor.tsx I6+OOSS1+C1 sequence is exactly the kind of churn the one-feature-rule is meant to prevent — a Cluster B PR could have surfaced the data-loss interaction with `useEditorMutation` separately and avoided the add-then-revert dance on this branch. (`Plan Alignment`, Opus 4.7 1M context, confidence 92.)

- **[PA2] `chapter.save` `byStatus` additions beyond design.** Design [I2] specified only `network` and `byStatus[404]`. The branch adds `byStatus: { 500, 502, 503, 504 }` mapped to a new `saveFailedServer` string (commits `a8e940d`, `921a53e`). Defensible: the [I2] rewording of `saveFailed` to neutral copy made the post-retry banner less actionable for bare-5xx exhaustion than before — the byStatus[5xx] additions restore informativeness. **Severity:** Suggestion. (`Plan Alignment`, confidence 80.)

- **[PA3] `trash.restoreChapter` byStatus[404] copy split.** Design [S1] specified `byStatus[404] → restoreChapterAlreadyPurged`. Implementation introduces a softer `restoreChapterUnavailable` for byStatus[404] and reuses `restoreChapterAlreadyPurged` only for `byCode: CHAPTER_PURGED`. Defensible: the S4 review (2026-04-26) noted that bare 404 may be a never-existed or stale-URL case, not necessarily purged, so a permanence claim is wrong outside the explicit `CHAPTER_PURGED` code. **Severity:** Suggestion. (`Plan Alignment`, confidence 85.)

- **[PA4] `mapApiErrorMessage` helper extraction belongs in Cluster E.** Design lines 199-211 reserve mapper-internals refactors for Cluster E. The `mapApiErrorMessage` helper (commit `fd3f33a`, S2) was extracted opportunistically while addressing [I2]'s call-site rewrite. **Severity:** Suggestion. (`Plan Alignment`, confidence 80.)

- **[PA5] Test-infra additions outside Cluster A scope.** A new `__tests__/helpers/saveRetries.ts` (`flushSaveRetries` for the 2s/4s/8s backoff triple, commit `74531fa`) and a 300ms find-replace debounce skip in `EditorPageFeatures.test.tsx` (commit `27e42d5`). Precedent for opportunistic test-infra changes already exists in the design doc's Cluster F retrospective ([S22]/[S23]). **Severity:** Suggestion. (`Plan Alignment`, confidence 70.)

### Recommended actions for the PR description

For [PA1]: log a "Cluster A scope exception" block listing the four consumer-side commits with their review tags and one-line justifications, and update `docs/plans/2026-04-25-4b3a-review-followups-design.md` to record that Cluster A absorbed save-pipeline lock-on-404 + Ctrl-S routing + debouncedSave isEditable guard, then adjust Cluster B/C item lists so the same fixes are not double-counted.

For [PA2], [PA3], [PA4]: backfill the design doc with one-line notes on each deviation (the round-2/round-3 review tags can be cited verbatim).

For [PA5]: cite the [S22]/[S23] precedent.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment (6 specialists in parallel) + Verifier (sequential).
- **Scope:** All 16 changed files plus adjacent context (`packages/server/src/projects/projects.routes.ts`, `packages/server/src/chapters/chapters.routes.ts`, `packages/client/src/api/client.ts`, `packages/client/src/hooks/useAbortableSequence.ts`, `packages/client/src/hooks/useEditorMutation.ts`, `packages/client/src/hooks/useTrashManager.ts`).
- **Raw findings:** 13 (before verification: 0 Logic, 0 Error Handling, 5 Contract, 2 Concurrency, 0 Security, 6 Plan Alignment).
- **Verified findings:** 8 (after verification: 1 in-scope, 2 latent, 1 out-of-scope, 5 Plan-Alignment deviations; 4 specialist findings demoted as false positives or style-only).
- **Filtered out:** 5 (CI-2 retry-hammering claim — wrong; CI-3 docstring claim folded into LAT2; CI-4 Ctrl+S dead-code claim — comment already discloses dead-code status; CS-2 lastErr style — no current incorrect behavior; PA-6 — folded into PA1).
- **Latent findings:** 2 (Critical: 0, Important: 0, Suggestion: 2).
- **Out-of-scope findings:** 1 (Critical: 0, Important: 1, Suggestion: 0).
- **Backlog:** 0 new entries added, 1 re-confirmed (`4d5b9e81`).
- **Steering files consulted:** `/workspace/CLAUDE.md`.
- **Plan/design docs consulted:** `docs/plans/2026-04-25-4b3a-review-followups-design.md`, `docs/plans/2026-04-25-4b3a-review-followups-plan.md`, `docs/roadmap.md`.
