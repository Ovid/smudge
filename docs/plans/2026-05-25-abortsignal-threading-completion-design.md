# Phase 4b.3b: AbortSignal Threading Completion — Design

**Date:** 2026-05-25
**Roadmap phase:** `docs/roadmap.md` — Phase 4b.3b: AbortSignal Threading Completion
**Branch:** `abortsignal-threading-completion`
**Plan:** `2026-05-25-abortsignal-threading-completion-plan.md` (forthcoming)

---

## Goal

Finish Cluster B from the Phase 4b.3 code review (`paad/code-reviews/ovid-unified-error-mapper-2026-04-25-10-32-46-a68afd1.md`) **and** sweep the `migrationStructuralCheck.test.ts` allowlist down from 7 files to as few as the per-site lifecycle requirements permit (target: 3 files, each with inline justification comments), so Phase 4b.4 (ESLint rule for `useRef<AbortController>`) can land with surgical `eslint-disable` lines instead of a file-level allowlist.

## Why Now

CLAUDE.md §Save-pipeline invariants rule 4 (bump-the-sequence-before-the-request) is enforced by `useAbortableSequence`, but it depends on the underlying request being cancellable. While these consumers ship without signals — or with hand-rolled `useRef<AbortController>` allocations that bypass the new `useAbortableAsyncOperation` hook — an in-flight response can land on a stale closure and re-set state after the user has navigated away. Phase 4b.3a.1 proved the hook on three cross-confirmed sites (find/replace, trash, image gallery); Phase 4b.3b applies the same per-site evaluation to the remaining 20 hand-rolled allocations across 7 files.

Phase 4b.3c [S10]'s dev-warn gate depends on `signal.aborted`, so this phase must land before 4b.3c.

## Scope Decisions Made During Brainstorming

Two scope decisions were made during the 2026-05-25 brainstorm session and are recorded here so the implementation plan and decision log can refer back to them.

**Decision 1 — API surface additions are in scope (Path A).** The roadmap's §Out of Scope claim that "API-surface changes to `api/client.ts` (already shipped in 4b.3a)" is incorrect for four endpoints in Cluster B's scope: `api.projects.create`, `api.projects.delete`, `api.chapters.create`, and `api.chapterStatuses.list` do not yet accept `signal?: AbortSignal`. Rather than splitting these mechanical additions into a separate sub-phase, they are folded into Phase 4b.3b. The roadmap §Out of Scope line for this phase is no longer accurate; the decision log captures this.

**Decision 2 — Allowlist sweep is in scope (Path B).** The original roadmap §Scope enumerates only [I7]–[I11] + [S12], which touches 3 files (HomePage, useProjectEditor, EditorPage). However, the `migrationStructuralCheck.test.ts:130–138` allowlist covers 7 files containing 20 `useRef<AbortController>` allocations. Maintaining the one-feature rule (CLAUDE.md §Pull Request Scope) would have meant ~5 follow-up sub-phases to evaluate each remaining file. To keep the project on track, Phase 4b.3b's scope expands to sweep the entire allowlist. This is an explicit, recorded bend of the one-feature rule.

## In Scope

1. **API surface additions** (`packages/client/src/api/client.ts`). Four endpoints grow a `signal?: AbortSignal` parameter (API-1 through API-4 in §2.1).
2. **Cluster B consumer threading** ([I7]–[I11] + [S12]). All 11 entries enumerated below get a signal, via `useAbortableAsyncOperation` where the hook fits or hand-rolled-with-justification where it doesn't (C-1 through C-11 in §2.2).
3. **Allowlist sweep.** All remaining 16 `useRef<AbortController>` allocations across the 6 allowlisted files (EditorPage and useProjectEditor are partially touched by Cluster B as well) get re-evaluated against the Approach-3 decision matrix (S-1 through S-16 in §2.3).
4. **Structural test update.** `migrationStructuralCheck.test.ts:130–138`'s `PHASE_4B_3B_ALLOWLIST` shrinks to the 3 post-sweep survivors; the comment block is rewritten to reflect post-sweep reality.
5. **CLAUDE.md edits.** §Save-pipeline invariants Rule 4 reframing + §Pull Request Scope footnote (see §4).

## Out of Scope

- Cluster C (Phase 4b.3c) consumer recovery completeness.
- Cluster E (Phase 4b.3d) mapper internals.
- Phase 4b.4's ESLint rule itself — this phase prepares the codebase for it; the rule lands in 4b.4 with inline `eslint-disable` for the three justified survivors.
- Behavior changes visible to the user. This phase is correctness-and-observability only.
- Migrating `App.tsx` / `DashboardView.tsx` — both already use `AbortController` with `useEffect`-cleanup abort lifecycle; verified during 4b.3b brainstorming that no migration is needed. Phase 4b.4's ESLint rule design will re-evaluate whether they need inline justification comments. (They also don't match the structural regex and aren't allowlisted.)

## Dependencies

- Phase 4b.3a (partial signal-bearing API surface — this phase completes it).
- Phase 4b.3a.1 (`useAbortableAsyncOperation` hook).

---

## 1. Architectural Approach (Approach 3 — Hybrid Pragmatic)

For each `useRef<AbortController>` allocation, decide against this default rule:

| Lifecycle shape | Default decision |
|---|---|
| Single-shot mutation, "abort prior + abort on unmount" | **Migrate to `useAbortableAsyncOperation`.** |
| Dialog-scoped (abort on dialog close) | **Migrate to hook, with an explicit `op.abort()` on dialog-close transition.** The hook's `abort()` JSDoc endorses "explicit external cancellation (panel-close, project-id change)." |
| Paired with `useAbortableSequence` (response-staleness + network-cancel) | **Migrate to hook.** The find/replace site already proves this pairing works; both hooks are orthogonal. |
| Retry-with-backoff (multiple sequential network calls under one logical op) | **Migrate to hook.** Call `op.run()` once with an async function that contains the retry loop and forwards the signal to each attempt. |
| "Second-tier" recovery controllers (recovery branch inside `catch` of a primary mutation) | **Keep hand-rolled with explicit justification.** Lifecycle is "the recovery branch outlives the primary mutation by design — primary's hook auto-aborts when a new mutation starts, but the recovery follow-up must complete." |
| Multi-controller-live-simultaneously | **Keep hand-rolled.** Two simultaneously-live controllers from one hook instance are not expressible. |

Hand-rolled survivors get inline justification comments. The result: a much smaller allowlist (3 files vs 7), each entry documented at the line of the allocation rather than in a single file-level set.

---

## 2. Per-Site Decision Matrix

### 2.1 — API surface (`packages/client/src/api/client.ts`)

| # | Endpoint | Change |
|---|---|---|
| API-1 | `api.projects.create(input)` | Add `signal?: AbortSignal`; use `...(signal ? { signal } : {})` spread on the options object. |
| API-2 | `api.projects.delete(slug)` | Same pattern. |
| API-3 | `api.chapters.create(projectSlug)` | Same pattern. |
| API-4 | `api.chapterStatuses.list()` | Same pattern; the existing `apiFetch` helper handles `signal ? { signal } : undefined` for the no-body case (mirrors `projects.list`). |

### 2.2 — Cluster B consumer threading

| # | Site | Current shape | Decision |
|---|---|---|---|
| C-1 | `HomePage.handleCreate` — `api.projects.create` (line 61) | No signal, no ref | **Hook.** New `createOp = useAbortableAsyncOperation()` at component scope. |
| C-2 | `HomePage.handleDelete` — `api.projects.delete` (line 104) | No signal, no ref | **Hook.** Separate instance `deleteOp = useAbortableAsyncOperation()`. Independent operations — see Approach-3 default for "single-shot mutation." |
| C-3 | `HomePage.handleCreate` recovery branch — `createRecoveryAbortRef` (line 24) | Hand-rolled ref | **Hand-rolled, justified.** Recovery branch lifecycle outlives the primary mutation (the dialog has already closed by the time the recovery `api.projects.list` resolves). Inline comment explains the second-tier-recovery rationale. |
| C-4 | `useProjectEditor.handleCreateChapter` — `api.chapters.create` (line 577) | No signal | **Hook.** New `createChapterOp` at hook scope. The staleness check (`projectRef.current?.id !== projectId`) stays — that's response-discard, orthogonal to network cancel. |
| C-5 | `useProjectEditor` recovery refs — `createRecoveryAbortRef`, `statusRecoveryAbortRef`, `titleRecoveryAbortRef` (lines 154–156) | Hand-rolled refs | **Hand-rolled, justified.** Same rationale as C-3. All three share a single block comment at line 154. |
| C-6 | `useProjectEditor.loadProject` — `let cancelled = false` (line 205) + `api.projects.get(slug)` (line 220) + `api.chapters.get(firstChapter.id)` (line 245) | Flag + no signal | **Hook.** New `loadProjectOp` at hook scope, called inside the `useEffect`. The `cancelled` flag dies entirely; `signal.aborted` after each `await` replaces it. Thread `signal` through both `api.projects.get` and `api.chapters.get`. |
| C-7 | `useProjectEditor.handleSelectChapter` — `api.chapters.get(chapterId)` (line 704) | No signal; paired with `selectChapterSeq` | **Hook.** New `selectChapterOp`. Both `selectChapterSeq.start()` (epoch token) *and* `selectChapterOp.run((s) => api.chapters.get(id, s))` apply — orthogonal, like the find/replace pairing. |
| C-8 | `useProjectEditor.reloadActiveChapter` — `api.chapters.get(current.id)` (line 757) | No signal; paired with `selectChapterSeq` | **Hook reuse.** Same `selectChapterOp` instance as C-7 — both flows are "load active chapter" under the same logical operation. **Verify before migration:** confirm `reloadActiveChapter` cannot fire concurrently with `handleSelectChapter`. If it can, this row becomes "Two separate hook instances" and a behavioral test pins the chosen race semantics. |
| C-9 | `EditorPage` chapterStatuses retry (lines 1223–1250) | `let cancelled = false` + setTimeout queue | **Hook.** New `statusesOp`. Call `statusesOp.run(async (signal) => { ... })` once inside the effect; the retry loop lives inside the callback, checks `signal.aborted` between attempts, and uses a small `sleep(ms, signal)` helper for the backoff. Thread `signal` into `api.chapterStatuses.list(signal)`. |
| C-10 | `EditorPage` executeReplace — `api.search.replace` (line 775) | No signal; runs inside `mutation.run(...)` | **Hook.** New `replaceOp` at page scope. Inside the `mutation.run(...)` callback, get a signal via `replaceOp.run((s) => api.search.replace(..., s))`. The mutation owns staleness/locking; the hook owns network cancellation. |
| C-11 | `EditorPage` executeReplaceOne — `api.search.replace` (line 1018) | No signal; same shape as C-10 | **Hook reuse.** Same `replaceOp` instance — replace-all and replace-one are mutually exclusive (gated by `isActionBusy`). |

### 2.3 — Allowlist sweep (out-of-Cluster-B refs)

| # | Site (file:line) | Current purpose | Decision |
|---|---|---|---|
| S-1 | `EditorPage.settingsRefreshAbortRef` (1193) | Post-update settings GET; abort on unmount | **Hook.** Single-shot, abort-on-unmount — textbook fit. Replace ref with new `settingsRefreshOp`. |
| S-2 | `useProjectEditor.saveAbortRef` (90) | Save retry-with-backoff (paired with `saveSeq`) | **Hook.** Retry-with-backoff pattern (matches C-9). `cancelInFlightSave()` maps to `saveOp.abort()` rather than ref-poke. Uses the shared `sleep(ms, signal)` helper (see §5 step 2). |
| S-3 | `useProjectEditor.statusChangeAbortRef` (108) | Status PATCH; abort prior + on unmount | **Hook.** Textbook fit. |
| S-4 | `useProjectEditor.titleChangeAbortRef` (116) | Title PATCH; same shape | **Hook.** Textbook fit. |
| S-5 | `useProjectEditor.reorderAbortRef` (124) | Reorder PUT; same shape | **Hook.** Textbook fit. |
| S-6 | `useProjectEditor.renameChapterAbortRef` (131) | Chapter rename PATCH; same shape | **Hook.** Textbook fit. |
| S-7 | `useProjectEditor.deleteChapterAbortRef` (132) | Delete + follow-up GET share one controller (line 849 threads the same signal into the follow-up `api.chapters.get`) | **Hook.** The follow-up GET continues to use the *same* signal from the same `run()` call — `run()` returns a signal that can be passed to multiple awaited calls within the callback. |
| S-8 | `ExportDialog.abortRef` (36) | Export download; aborts on dialog close transition | **Hook.** New `exportOp`. Call `exportOp.abort()` in the open→close effect (line 53). |
| S-9 | `ProjectSettingsDialog.timezoneAbortRef` (45) | Timezone PATCH; abort on open-transition and unmount | **Hook.** New `timezoneOp`. Call `timezoneOp.abort()` in the open-transition cleanup. |
| S-10 | `ProjectSettingsDialog.fieldAbortRef` (55) | Field PATCH; same shape | **Hook.** New `fieldOp`. |
| S-11 | `SnapshotPanel.fetchAbortRef` (125) | Snapshot list GET; paired with `chapterSeq` | **Hook.** Pairing with `useAbortableSequence` is the find/replace pattern. |
| S-12 | `SnapshotPanel.mutateAbortRef` (131) | Snapshot create/delete; paired with `chapterSeq` | **Hook.** Same rationale. |
| S-13 | `useSnapshotState.viewAbortRef` (171) | Snapshot view GET; paired with `viewSeq` | **Hook.** Same rationale. |
| S-14 | `useSnapshotState.refreshCountAbortRef` (172) | Refresh count GET | **Hook.** Single-shot. |
| S-15 | `useSnapshotState.restoreAbortRef` (178) | Restore POST | **Hook.** Single-shot. |
| S-16 | `useSnapshotState.restoreFollowupAbortRef` (186) | Follow-up GET after successful restore — fires *while* restore's controller would have been aborted by the next restore | **Hand-rolled, justified.** Two simultaneously-live controllers (primary restore + follow-up GET) from the same hook instance are not expressible with one `useAbortableAsyncOperation` — `run()` aborts the prior. The existing comment at line 395–402 explains the lifecycle entanglement; splitting into two hook instances would lose that context. Inline justification comment at the allocation. |

### 2.4 — Expected end state

Post-sweep, the file-level allowlist contains **3 files** (down from 7):

- `HomePage.tsx` — retains `createRecoveryAbortRef` (C-3)
- `useProjectEditor.ts` — retains 3 recovery refs (C-5)
- `useSnapshotState.ts` — retains `restoreFollowupAbortRef` (S-16)

All other files (ExportDialog, ProjectSettingsDialog, SnapshotPanel, EditorPage) exit the allowlist entirely. Phase 4b.4's ESLint rule replaces the file-level allowlist with inline `// eslint-disable-next-line` on each justified line.

---

## 3. Testing Strategy

### 3.1 — Structural test

Update `packages/client/src/__tests__/migrationStructuralCheck.test.ts`:

- Shrink `PHASE_4B_3B_ALLOWLIST` to the 3 survivors (HomePage, useProjectEditor, useSnapshotState).
- Rewrite the comment at lines 110–123 to describe post-sweep reality: "These files retain hand-rolled `useRef<AbortController>` for second-tier-recovery or simultaneously-live-controller patterns; Phase 4b.4 replaces this file-level allowlist with inline `eslint-disable` comments on each justified line."
- Add a new assertion: **every file that imports `useAbortableAsyncOperation` must contain at least one `.run(` call** — guards against drift where someone imports the hook but never calls it.
- Best-effort assertion: every API endpoint that grew a `signal?: AbortSignal` parameter is used by at least one consumer that threads a non-undefined signal. Defer if grep-on-source gets too fragile; structural-only is acceptable.

### 3.2 — Selective per-site behavioral tests

Add focused unit tests *only* where the migration changes observable behavior:

| Site | Test |
|---|---|
| C-6 `loadProject` | Unmount mid-`api.projects.get` does NOT call `setProject` (preserves the `cancelled`-flag guarantee). |
| C-9 chapterStatuses retry | Unmount during the 2s backoff sleep aborts the timer; no warnings; no subsequent retry. |
| C-10/C-11 replace pairing | Aborting `replaceOp` during a `mutation.run` body causes `api.search.replace` to receive an aborted signal. |
| S-2 `saveAbortRef` | `cancelInFlightSave()` aborts an in-flight save (behavior-preserving refactor — regression test). |
| S-7 deleteChapter follow-up | The same signal threaded into delete *and* the post-delete `api.chapters.get` aborts both together. |
| S-16 restoreFollowup | The hand-rolled two-controller pattern still aborts correctly on unmount and on a new restore. |

Plus a unit test for the shared `sleep(ms, signal)` helper at `packages/client/src/utils/abortable.ts` (see §5 step 2): aborts the timer when the signal aborts; rejects with the canonical ABORTED shape; does not throw if aborted before the call.

**Hook-level contract test.** Add to `useAbortableAsyncOperation.test.ts`: the per-call signal passed to `fn` remains valid across multiple awaited calls within `fn`, and aborts all of them on the next `run()`. Pins the contract that S-7 (and any future dual-await site) relies on. Lands with the S-7 commit or as a tiny precursor.

### 3.3 — Drop redundant tests

Where a per-site test exists today that only proved the old `useRef<AbortController>` pattern was wired (e.g., "saveAbortRef is non-null after a save fires"), delete it. Keep tests that prove *behavior*; drop tests that prove *internals*.

### 3.4 — E2e

No new e2e tests. Existing Playwright coverage (HomePage navigation, chapter create/select/delete, snapshot restore, export, etc.) is the regression net.

### 3.5 — Zero-warnings

Several existing `cancelled` flags exist specifically to suppress `setState on unmounted component` warnings (HomePage, ProjectSettingsDialog cite the zero-warnings rule in their comments). The migration must not regress this — any new warning in test output is a failure (CLAUDE.md §Testing Philosophy zero-warnings rule).

---

## 4. CLAUDE.md Updates

Two edits land in this phase, as explicit tasks (not "while we're in there" changes):

**4.1 — §Save-pipeline invariants Rule 4.** The current wording references "the seven Phase 4b.3b files — each containing one or more such allocations — are allowlisted there until their call sites are per-site re-evaluated." Update to reflect post-sweep reality: three files remain, each for documented second-tier-recovery or simultaneously-live-controller reasons, with the file-level allowlist scheduled for removal in Phase 4b.4 (replaced by inline `// eslint-disable-next-line` on each justified line).

**4.2 — §Pull Request Scope.** Add a one-sentence footnote: **"Exceptions to the one-feature rule require an explicit decision recorded in the phase's decision log; the rule defaults to enforcement."** This documents the Decision-2 bend without weakening the default. The 2026-05-25 decision log entry for this phase is the first such recorded exception.

---

## 5. Execution Order

Single PR, ordered commits:

1. **API surface.** Land API-1 through API-4 as one commit with 4 transport-level unit tests in `packages/client/src/api/client.test.ts` (or equivalent location for transport tests) — one per new endpoint, mocking `fetch` and asserting the signal reaches `apiFetch` options.
2. **`sleep(ms, signal)` helper** at `packages/client/src/utils/abortable.ts` with unit tests. Used by C-9 and S-2. Tiny — isolates review from the call-site change.
3. **Cluster B consumer threading.** [I7], [I8], [I9], [I10], [I11], [S12] — one commit per site (~8 commits).
4. **Allowlist sweep — textbook-fit sites.** S-1, S-3/4/5/6, S-9/10, S-14/15. Mechanical migrations, low per-commit review burden.
5. **Allowlist sweep — paired-with-sequence sites.** S-11/12, S-13, plus the C-7/8 commits (already in step 3, re-listed here for review-attention emphasis).
6. **Tricky sites.** S-2 (saveAbortRef retry-with-backoff), S-7 (dual-purpose signal), S-8 (dialog-close lifecycle). One commit each — reviewer should spend real time here.
7. **Structural test update + allowlist shrink.** Inline justification comments added at C-3, C-5, S-16. New import-implies-call assertion. **After this commit:** run `make cover` and record the per-package coverage delta vs. branch-base. If any threshold dropped (even within the still-passing range), add a focused test before opening the PR.
8. **CLAUDE.md edits.** §Save-pipeline Rule 4 + §Pull Request Scope footnote. Last because it describes the actually-landed state.

**Allowlist-edit discipline.** The structural-test assertion at `migrationStructuralCheck.test.ts:155` ("Phase 4b.3b allowlist entries actually contain `useRef<AbortController>`") fails the moment a migration removes the LAST ref from any file still in the allowlist. Three files have only their own refs and trip this fail-mode on the migration commit that removes their final ref:

- **ExportDialog.tsx** — last-ref-removal is S-8 (step 6).
- **ProjectSettingsDialog.tsx** — last-ref-removal is whichever of S-9 or S-10 lands second (step 4).
- **SnapshotPanel.tsx** — last-ref-removal is whichever of S-11 or S-12 lands second (step 5).

Each of these commits MUST also remove the file from `PHASE_4B_3B_ALLOWLIST` in the same commit. The step-7 commit then only rewrites the allowlist comment block; the file-set is already correct by the time step 7 runs. This keeps CI green per-commit and preserves the rollback-at-site-granularity property below.

**Branch / PR shape.** Single PR. Path B already commits to bending the one-feature rule, and the structural test's allowlist must land in the same PR as the sites it covers — splitting would flip CI red mid-merge.

**Verification gates.** Each commit: `make test` green for the touched package, type errors fail-fast. Final commit: `make all` green (lint, format, typecheck, coverage, e2e). Coverage thresholds met or exceeded — never lowered (see step 7's explicit `make cover` checkpoint).

**Rollback shape.** Each site is its own commit so a regression on `main` can be reverted at site granularity. The API surface commit (step 1) is forward-compatible: reverting any consumer leaves the surface in place with no contract break.

**Review strategy.** Review per-commit, not per-PR. Each commit is a single per-site migration (plus, where applicable, the `PHASE_4B_3B_ALLOWLIST` shrink for that file's last ref-removal). Reviewers may approve commit-by-commit and merge once all are green. §2's decision matrix is the contract — if a commit's behavior diverges from its row, that's the only place to raise. This is the discipline that distinguishes this PR (Decision 2, recorded bend of the one-feature rule) from snapshots-find-replace's 16-round-review shape.

---

## 6. Definition of Done

### API surface
- [ ] `api.projects.create`, `api.projects.delete`, `api.chapters.create`, `api.chapterStatuses.list` each accept `signal?: AbortSignal`.
- [ ] Transport-level unit test in commit #1 for each new endpoint, mocking `fetch` and asserting the signal reaches `apiFetch` options.
- [ ] Each new signal parameter is also exercised by ≥1 consumer test landing with that consumer's migration commit.

### Shared helpers
- [ ] `sleep(ms, signal)` helper exists at `packages/client/src/utils/abortable.ts` with unit tests.
- [ ] Both C-9 (chapterStatuses retry) and S-2 (`saveAbortRef`) use the helper.

### Hook contract
- [ ] `useAbortableAsyncOperation.test.ts` includes a test pinning the per-call-signal contract: the signal passed to `fn` remains valid across multiple awaited calls within `fn`, and aborts all of them on the next `run()`.

### Cluster B consumers
- [ ] Every site enumerated in roadmap §Phase 4b.3b threads a signal.
- [ ] No `let cancelled = false` flag remains in `loadProject` (C-6) or `chapterStatuses` retry (C-9).
- [ ] Behavioral tests exist for C-6, C-9, C-10/11.

### Allowlist sweep
- [ ] Of the 20 starting `useRef<AbortController>` allocations, exactly 5 remain: C-3 (HomePage) + C-5×3 (useProjectEditor) + S-16 (useSnapshotState).
- [ ] Each surviving allocation has an inline justification comment.
- [ ] `PHASE_4B_3B_ALLOWLIST` contains exactly 3 entries (HomePage, useProjectEditor, useSnapshotState).
- [ ] The allowlist comment block in `migrationStructuralCheck.test.ts` is rewritten for post-sweep reality.

### Structural assertions
- [ ] New assertion: every file importing `useAbortableAsyncOperation` contains at least one `.run(` call.
- [ ] Existing `useAbortableSequence` and `*SeqRef` assertions unchanged.

### CLAUDE.md
- [ ] §Save-pipeline invariants Rule 4 reframed from "seven files" to "three justified survivors, soon to be inline `eslint-disable`."
- [ ] §Pull Request Scope footnote on the recorded-exception path.

### Test output
- [ ] Zero `console.warn` / `console.error` from production code paths.
- [ ] No `setState on unmounted component` warnings during the test run.

### CI gates
- [ ] `make test` green per package.
- [ ] `make all` green: lint, format, typecheck, coverage, e2e.
- [ ] Coverage thresholds met or exceeded — never lowered.

### Documentation
- [ ] Design doc lands at `docs/plans/2026-05-25-abortsignal-threading-completion-design.md` (this document).
- [ ] Implementation plan lands at `docs/plans/2026-05-25-abortsignal-threading-completion-plan.md`.
- [ ] `docs/roadmap.md`: `<!-- plan: 2026-05-25-abortsignal-threading-completion-design.md -->` comment added; Phase Structure table updated (4b.3a.4 → Done, 4b.3b → In Progress).
- [ ] Decision log entry at `docs/roadmap-decisions/2026-05-25-phase-4b-3b-abortsignal-threading-completion.md`; INDEX.md prepended.
