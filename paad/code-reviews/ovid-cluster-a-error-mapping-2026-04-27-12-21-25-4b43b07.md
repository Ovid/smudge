# Agentic Code Review: ovid/cluster-a-error-mapping

**Date:** 2026-04-27 12:21:25
**Branch:** `ovid/cluster-a-error-mapping` -> `main`
**Commit:** `4b43b07998f2a40d4b699cf7be6af931eb617967`
**Files changed:** 16 | **Lines changed:** +789 / -135
**Diff size category:** Medium

## Executive Summary

Cluster A of Phase 4b.3a (scope-coverage gaps for error mapping — items I1, I2, S1) is implemented correctly and well-tested, with multiple round-of-review follow-ups already absorbed. No Critical or Important in-scope findings: the new mappings match the server contract, the save-pipeline invariants are upheld, the C1↔I6 contract pair is correctly resolved (intentional revert of `flushSave`'s isEditable guard, with `debouncedSave`'s guard kept). Two latent findings on Editor.tsx:154-182 capture the unenforced "type-system invariant" that `isEditable` must always be a boolean and the "re-arm-on-unlock" gap; both are future-proofing hardening rather than live bugs. Three out-of-scope findings on the broader save pipeline (Editor unmount cleanup, `cancelPendingSaves` lock-banner stale state, `latestContentRef` clobber) are pre-existing — one already in the backlog, two minted new.

## Critical Issues

None found.

## Important Issues

None found.

## Suggestions

- **[S1]** `e2e/editor-save.spec.ts:117-119` — add `{ timeout: 5000 }` to the `toHaveAttribute("contenteditable", "false")` assertion so it mirrors the explicit timeout on the lockBanner check (Found by: Logic, Error Handling — agreement; `claude-opus-4-7`).
- **[S2]** `packages/client/src/errors/scopes.ts:117-143` — add a precedence-pin test for `chapter.save` that asserts `byCode?.INTERNAL_ERROR` is `undefined` AND that `500 + INTERNAL_ERROR → byStatus[500] → saveFailedServer`, mirroring the trash.restoreChapter precedence pin pattern (Found by: Concurrency & State; `claude-opus-4-7`).
- **[S3]** `packages/client/src/hooks/useProjectEditor.ts:447-469` — collapse the post-loop `lastErr ? ... : STRINGS.editor.saveFailed` ternary's third clause OR add a unit test that pins the documented `lastErr === null` paranoid-defense path; today the third branch is dead code so a future regression that needs it would silently miss (Found by: Contract & Integration; `claude-opus-4-7`).

## Latent

> Findings on lines this branch authored where the bug is not currently reachable
> via any live code path, but the pattern itself is brittle or load-bearing for
> future work. **Not a merge-blocker** — record so the next change in this area
> is informed. Does not enter the OOS backlog (the branch authored these).

### [LAT1] `editorInstance.isEditable === false` strict-equality guard lets `undefined` fall through
- **File:** `packages/client/src/components/Editor.tsx:154, 182`
- **Bug:** `debouncedSave`'s parameter type is `{ getJSON: ...; isEditable?: boolean }` (line 154) — `isEditable` is optional. The strict `=== false` check at line 182 means `undefined` does not skip the save.
- **Why latent:** The only call site is `debouncedSave(ed)` inside the TipTap `onUpdate({ editor })` handler. Real TipTap editor instances always expose `isEditable` as a boolean — never undefined. No live caller can hit the gap.
- **What would make it active:** A future call site that passes a custom shape (test stub, alternate adapter, future "preview-with-edit" intermediate) without setting `isEditable`. Then locked content would not skip the save.
- **Suggested hardening:** Tighten the parameter type to `isEditable: boolean` (drop the `?`), OR change the guard to `if (editorInstance.isEditable !== true) return;` so any non-`true` (undefined included) shorts.
- **Confidence:** High
- **Found by:** Logic & Correctness, Error Handling, Contract & Integration, Concurrency & State (four-way agreement) (`claude-opus-4-7`)

### [LAT2] `Editor.debouncedSave` skip on lock leaves `dirtyRef=true` with no automatic re-arm on unlock
- **File:** `packages/client/src/components/Editor.tsx:160-182`
- **Bug:** When the `isEditable === false` early return fires, `dirtyRef` stays `true` (intentional — the cache is the recovery path) but no mechanism re-fires the debounce on a future `setEditable(true)`. If a flow re-enables an existing Editor instance without remount AND without driving a keystroke or calling `flushSave`, dirty content sits unsaved with no indicator.
- **Why latent:** The S8 comment block (lines 171-181) audits every current `setEditable(true)` caller and confirms each either remounts the Editor or fires `flushSave`. No live code path leaves dirty content stranded.
- **What would make it active:** A future flow that toggles `setEditable(true)` on a still-mounted Editor without an immediate flush — e.g. a "preview & edit" toggle, an inline modal that re-enables on dismiss, etc.
- **Suggested hardening:** Add an effect in `Editor.tsx` that watches `editor?.isEditable` and re-fires the debounce when it transitions false→true while `dirtyRef.current === true`. Cheaper alternative: an ESLint rule that flags any `setEditable(true)` not adjacent to a `flushSave()` or remount. Cheapest: document the invariant in CLAUDE.md §Save-pipeline invariants as rule #6 ("re-arm or flush after `setEditable(true)` on a non-remounted editor").
- **Confidence:** Medium
- **Found by:** Logic & Correctness, Error Handling (two-way agreement) (`claude-opus-4-7`)

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

#### [OOSI1] Editor unmount cleanup PATCH ignores `setEditable(false)` lock — backlog id: `4d5b9e81`
- **File:** `packages/client/src/components/Editor.tsx:218-227`
- **Bug:** The unmount cleanup at lines 218-227 unconditionally fires `onSaveRef.current(...)` if `dirtyRef.current && editorInstanceRef.current`. It does not check `editorInstanceRef.current.isEditable`. The companion paths (`debouncedSave` at line 182, `onBlur`, `flushSave`) all have explicit isEditable handling; the unmount path was not updated by the I6 work on this branch.
- **Impact:** A locked editor that unmounts (e.g. chapter switch immediately after a terminal-code lock) can still issue a stale PATCH. Cache + server reconciliation usually masks it, but it violates the invariant pair the I6 commit established.
- **Suggested fix:** Mirror the I6 guard — check `editorInstanceRef.current.isEditable !== false` before firing `onSaveRef.current(...)` in the unmount cleanup.
- **Confidence:** High
- **Found by:** Logic & Correctness (`claude-opus-4-7`)
- **Backlog status:** re-seen (first logged 2026-04-26)

#### [OOSI2] `latestContentRef` can be clobbered by an unmount-cleanup save targeting an old chapter — backlog id: `1f9d4b27`
- **File:** `packages/client/src/hooks/useProjectEditor.ts:273`
- **Bug:** `handleSave` unconditionally writes `latestContentRef.current = { id: savingChapterId, content }`. When the OLD Editor's unmount cleanup fires `onSave(getJSON, mountChapterId)` after a chapter switch, `savingChapterId` is the old chapter id but the user is already typing on the new one, whose draft just landed in `latestContentRef`. The cleanup-save overwrites the new chapter's `latestContentRef` entry.
- **Impact:** A subsequent backoff-retry for the new chapter reads `latestContentRef`, sees the id mismatch, and falls back to the closure `content` rather than picking up keystrokes typed during the backoff window. Rare race; data-loss-adjacent.
- **Suggested fix:** Gate the assignment: `if (activeChapterRef.current?.id === savingChapterId) latestContentRef.current = ...`. Or have the unmount-cleanup save bypass `handleSave` entirely (call `api.chapters.update` directly with no shared-state side effects).
- **Confidence:** Medium
- **Found by:** Concurrency & State (`claude-opus-4-7`)
- **Backlog status:** new (first logged 2026-04-27)

### Out-of-Scope Suggestions

- `[OOSS1]` `packages/client/src/hooks/useProjectEditor.ts:1243` — `cancelPendingSaves` clears `saveErrorMessage` but leaves the `editorLockedMessage` banner stale; footer says "idle" while alert still says "no longer available." (backlog id: `8e3c1a47`, new)

## Plan Alignment

Plan/design docs found: `docs/plans/2026-04-25-4b3a-review-followups-plan.md` (PR 2 / Cluster A) and `docs/plans/2026-04-25-4b3a-review-followups-design.md`.

- **Implemented:**
  - **[I1]** `chapter.reorder` `byCode: { REORDER_MISMATCH }` + new `reorderMismatch` string + unit test.
  - **[I2]** `chapter.save` `network:` + `byStatus: { 404 }` + reworded `saveFailed` + new `saveFailedNetwork` and `saveFailedChapterGone` strings + e2e test.
  - **[S1]** `trash.restoreChapter` `byStatus: { 404 }` mapping (with intentional copy deviation — see Deviations).

- **Not yet implemented:** Nothing from Cluster A.

- **Deviations / scope expansion (accepted by Ovid in earlier rounds; documented for the record):**
  - **S1 copy:** branch uses `restoreChapterUnavailable` ("Can't restore — this chapter is no longer available.") at `byStatus[404]`, NOT `restoreChapterAlreadyPurged` as the plan prescribed. Justification: bare 404 may be soft-deleted, not purged; permanence claim would be wrong. `restoreChapterAlreadyPurged` is retained but routed only via `byCode: { CHAPTER_PURGED }`. Pinned by precedence test in `apiErrorMapper.test.ts`.
  - **e2e wording:** plan prescribes `/no longer exists/i`, branch asserts `/no longer available/i` — internally consistent with the softened S4 copy.
  - **Scope expansion (S7):** new `saveFailedServer` string + `chapter.save` `byStatus: { 500, 502, 503, 504 }` mappings, plus the CLAUDE.md HTTP-status-allowlist clarification (commit `bca7ea4`). Not in plan; legitimized by the CLAUDE.md edit.
  - **Scope expansion (S3):** editor lock on bare-status 404 (no envelope code) added to `useProjectEditor` consumer recovery — design explicitly fenced consumer-side changes off Cluster A and put them in Cluster C. Justified by the new mapping's UX needing the lock to stop the 404 retry loop.
  - **Scope expansion (I6 + C1 dance):** Editor.tsx `debouncedSave` `isEditable` guard (kept) + `flushSave` mirror guard (added then reverted as silent-data-loss regression). This is Cluster B / save-pipeline territory; not in Cluster A's plan files list. Tied to the new 404 lock — needed to prevent racing a queued debounced PATCH after the lock is set. The add+revert pair is itself the kind of churn the one-feature rule exists to mitigate; ship-time decision was to keep the debounced-save guard and document the flushSave non-guard inline.
  - **Refactor expansion (S2):** `mapApiErrorMessage` helper extraction — pure refactor, plan-stated to belong in Cluster E (mapper internals). Two call sites adopted (post-loop banner + EditorPage Ctrl+S catch).
  - **Test-infra expansion:** `flushSaveRetries` helper extraction (`saveRetries.ts`) and find-and-replace 300ms debounce timer skip (`EditorPageFeatures.test.tsx`). Test-only, low risk, orthogonal to Cluster A.
  - **Branch name divergence:** design says all five PRs land on `ovid/miscellaneous-fixes`; this branch is `ovid/cluster-a-error-mapping` (per-cluster naming). Note the divergence.
  - **Plan file reference drift:** plan repeatedly says `errors/scopes.test.ts`; tests actually live in `errors/apiErrorMapper.test.ts`. Update plan post-merge.

- **One-feature rule:** the branch is on the edge — Cluster A's three plan items alone are ~3 files / 50 lines + tests, but the branch ships ~16 files / 789 insertions including the round-of-review follow-up cluster (S1-S8, I1-I6 review tags). Recommend the PR description list every additional item with its review tag and one-line justification so reviewers can evaluate the expansion deliberately.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment (6 specialists, dispatched in parallel)
- **Scope:** 16 changed files (CLAUDE.md, e2e/editor-save.spec.ts, errors/{apiErrorMapper,apiErrorMapper.test,scopes,index}.ts, hooks/useProjectEditor.ts, components/Editor.tsx, pages/EditorPage.tsx, strings.ts, plus 6 test files) + adjacent files (useTrashManager.ts, useEditorMutation.ts, useAbortableSequence.ts, EditorFooter.tsx, api/client.ts, server routes).
- **Raw findings:** 36 (23 specialist + 13 plan-alignment commentary)
- **Verified findings:** 8 (3 in-scope + 2 latent + 3 out-of-scope)
- **Filtered out:** 28 (false positives, dedupes, plan-commentary not rising to defect)
- **Latent findings:** 2 (Critical: 0, Important: 0, Suggestion: 2)
- **Out-of-scope findings:** 3 (Critical: 0, Important: 2, Suggestion: 1)
- **Backlog:** 2 new entries added (`1f9d4b27`, `8e3c1a47`), 1 re-confirmed (`4d5b9e81`). See `paad/code-reviews/backlog.md`.
- **Steering files consulted:** `CLAUDE.md`
- **Plan/design docs consulted:** `docs/plans/2026-04-25-4b3a-review-followups-plan.md`, `docs/plans/2026-04-25-4b3a-review-followups-design.md`, source review `paad/code-reviews/ovid-unified-error-mapper-2026-04-25-10-32-46-a68afd1.md`
