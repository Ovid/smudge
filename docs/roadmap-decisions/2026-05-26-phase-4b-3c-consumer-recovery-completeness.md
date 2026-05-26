---
date: 2026-05-26
phase: "Phase 4b.3c: Consumer Recovery Completeness"
model: claude-opus-4-7
design_file: docs/plans/2026-05-26-consumer-recovery-completeness-design.md
plan_file: docs/plans/2026-05-26-consumer-recovery-completeness-plan.md
pushback:
  total: 7
  critical: 1
  important: 3
  minor: 3
alignment:
  total: 3
  critical: 0
  important: 1
  minor: 2
---

# Phase 4b.3c: Consumer Recovery Completeness — Decision Log

This entry covers the /roadmap run on 2026-05-26 that brainstormed the
parent phase (4b.3c), pushed back on its design, split it into three
sub-phases (4b.3c.1 / 4b.3c.2 / 4b.3c.3), wrote the implementation
plan, and ran alignment.

## Pushback Findings

### [1] [I4] introduces a new `useRef<AbortController>` in `useTrashManager.ts` — file is NOT on the migrationStructuralCheck allowlist

- **Severity:** Critical
- **Category:** Contradiction
- **Summary:** The design's [I4] item proposes introducing `restoreRecoveryAbortRef` (a hand-rolled `useRef<AbortController>`) in `useTrashManager.ts`. CLAUDE.md §Save-Pipeline Invariants Rule 4 names exactly three allowlisted files (`HomePage.tsx`, `useProjectEditor.ts`, `useSnapshotState.ts`); `useTrashManager.ts` is not one of them. The structural test (`packages/client/src/__tests__/migrationStructuralCheck.test.ts`) would fail the moment the new ref lands. The spec was silent on this — no allowlist update, no justification block draft, no migration plan.
- **Resolution:** fixed-in-design — option A. Spec gains an explicit allowlist-update commit before the [I4] behavioural fix in 4b.3c.3, plus a justification-block draft mirroring `useProjectEditor.ts:207-218`. The justification: the recovery GET must outlive the next `handleRestore`'s `restoreOp` cancellation, mirroring the rationale for the three existing allowlisted files.

### [2] Phase scope bundles a feature with 11 unrelated behavioural fixes plus a UX semantic change — one-feature rule violation

- **Severity:** Important
- **Category:** Scope
- **Summary:** The design bundled `applyMappedError` + `ScopeExtras<S>` + `devWarn` (a new feature) with 11 distinct behavioural bug fixes ([I3], [I4], [I5], [S4], [S5], [S10], [S11], [S17], [S18], [S19], [S20]), 22 ladder migrations, an `image.delete` UX semantic change ([S8]), a scope-registry restructure ([S3]/[S7]), a new scope ([S16]), and 3 new e2e specs. CLAUDE.md §Pull Request Scope: "A PR delivers a single feature *or* a single refactor — never both, and never two features." The cited precedent is the 17,000-line snapshots+find-replace branch that took 16 review rounds.
- **Resolution:** fixed-in-design — option B. Split into three sub-phases: 4b.3c.1 (foundation + scope refactor + simple-ladder migrations), 4b.3c.2 (helper-consuming behavioural fixes: I3, I5, S4, S10, S20, ladders), 4b.3c.3 (independent fixes: I4, S5, S11, S17, S18, S19, S8, S16). Roadmap updated to add three sub-phase entries; each gains its own PR.

### [3] [S5] dispatched-flag fallthrough-throw breaks the caller's branching contract

- **Severity:** Important
- **Category:** Contradiction
- **Summary:** The original [S5] proposal had pre-send sync throws fall through and re-throw, claiming "the caller's existing mapApiError dispatch picks up the error." But the actual caller (`EditorPage.tsx:412-512`) branches on `RestoreFailedError` and `RestoreAbortedError` sentinels via `mutation.run`'s stage:"mutate" result. A bare-Error from a pre-send throw matches neither sentinel and falls off the bottom of the branch — silent fallthrough, no banner at all (worse than the current committed-lock).
- **Resolution:** fixed-in-design — option B. Pre-send branch returns `makeClientNetworkError()` (existing helper at `useSnapshotState.ts:34`) instead of throwing. No caller change required; banner reads via the existing `RestoreFailedError` + `mapApiError("snapshot.restore")` + `scope.network` path. Slight framing inaccuracy ("network failure" for a client bug) accepted as the trade-off against a new sentinel class.

### [4] `ScopeExtras<S>` typing gap — `S` is decoupled from `mapApiError`'s scope argument

- **Severity:** Important
- **Category:** Feasibility
- **Summary:** The original `applyMappedError<S extends ApiErrorScope>(mapped: MappedError, handlers)` design used `S` only on the `handlers.onExtras` parameter. TypeScript could only infer `S` from `onExtras`'s parameter shape, not from `mapApiError`'s scope argument. Two footguns: (a) TS infers `S = "image.delete"` to satisfy an `onExtras: ({ chapters }) => ...` callback paired with `mapApiError(err, "chapter.load")` — compiles, never fires; (b) when no `onExtras` is present, `S` falls back to the union — defeating the type-safety claim.
- **Resolution:** fixed-in-design — option A. Parameterize `MappedError<S>` and `mapApiError<S>` with a phantom `S extends ApiErrorScope` field. `S` now flows from `mapApiError` through `applyMappedError`'s typed callbacks. Negative compile-time test asserts wrong-scope `onExtras` callbacks fail to type-check.

### [5] [I5] routing through `mapApiError(err, "chapter.delete")` for an unexpected-throw path is dubious value

- **Severity:** Minor
- **Category:** Ambiguity
- **Summary:** `useTrashManager.confirmDeleteChapter`'s bare `catch {}` only fires on a genuine programming bug (`handleDeleteChapter` surfaces all API errors via `onError`). Routing through the mapper would surface `scope.fallback` ("Unable to delete chapter…") for a non-ApiError, masking the bug-path under generic copy. The forward-looking defense ("ABORTED stays silent if a future refactor lets one escape") protects against a refactor that doesn't exist.
- **Resolution:** fixed-in-design — option B. Drop the mapper routing. Replace the bare catch with `console.warn("confirmDeleteChapter programming-bug path:", err)` + a code comment naming the path as a programming-bug path. Pinning test asserts both dialog-dismiss and warn. Preserves visibility without spurious scope dependency.

### [6] `applyMappedError`'s fixed ordering would fire BOTH `onCommitted` and `onExtras` when both flags are true, changing ImageGallery behaviour

- **Severity:** Minor
- **Category:** Omission
- **Summary:** The original helper design had no early-return semantic. `ImageGallery.handleDelete` currently early-returns inside the committed branch (skipping the extras/message branches). After migration, both `onCommitted` AND `onExtras` would fire, double-announcing to the screen reader. The both-true state is unreachable in the current mapper emit shape (the BAD_JSON branch returns early before `extras` is populated), but the contract-level question stands: a future scope adding `committedCodes` + `extrasFrom` would silently produce double-announce.
- **Resolution:** fixed-in-design — option A. Added a `STOP` sentinel: a callback may return `STOP` to halt subsequent callbacks. The contract becomes "fire in order until a callback halts." Pattern P2 documentation updated to show `STOP` usage at the ImageGallery migration site.

### [7] Three new e2e specs don't have a phase home after the 4b.3c.1/.2/.3 split

- **Severity:** Minor
- **Category:** Omission
- **Summary:** The original design listed three e2e specs (snapshot-create-recovery, trash-restore-recovery, chapter-create-recovery coverage backfill) without specifying which sub-phase each lands in. After Issue 2's three-way split, placement needed explicit reckoning.
- **Resolution:** fixed-in-design — option A. Paired each spec with its behavioural-fix sub-phase: spec 1 (snapshot-create-recovery) → 4b.3c.2 (covers [I3]); spec 2 (trash-restore-recovery) → 4b.3c.3 (covers [I4]); spec 3 (chapter-create-recovery) → 4b.3c.1 as coverage backfill against unchanged behaviour.

## Alignment Findings

### [1] Tasks 10-23 (simple-ladder migrations) lack individual TDD detail

- **Severity:** Important
- **Category:** tdd-format
- **Summary:** Tasks 10-23 said "Follow the same Pattern P1 template as Task 9" with a bulleted list of sites but no per-task RED/GREEN steps spelled out. The `superpowers:writing-plans` skill explicitly forbids "Similar to Task N" without repeating the code. Risk: an engineer fast-scanning Task 19 (`DashboardView.tsx:61, 83`) and not noticing that line 83 might have a different scope from line 61 produces a half-migrated file.
- **Resolution:** fixed-in-plan — option B. Promoted the Pattern P1 template into a dedicated "Ladder Migration Template" subsection. Each of Tasks 9-23 references the template and carries its own per-task metadata row (file, line, scope, special-handling notes, commit message) in a table. Task 22 (ImageGallery Pattern P2 with STOP) retained its full task body because it's the only Pattern P2 site.

### [2] Tasks lack explicit REFACTOR phase

- **Severity:** Minor
- **Category:** tdd-format
- **Summary:** CLAUDE.md §Testing Philosophy says "ALL CODE MUST USE RED-GREEN-REFACTOR if feasible." The plan's tasks all followed RED (write failing test) → GREEN (minimal impl) → COMMIT, with no explicit REFACTOR step. The alignment skill names REFACTOR as "the step AI almost never does unless explicitly told to."
- **Resolution:** fixed-in-plan — option B. Added a REFACTOR step to every behavioural-fix and foundation task (~20 tasks). Where genuine refactor opportunity exists (`ImageGallery` Pattern P2 closure-capture, [I4] recovery-GET pattern duplication, etc.), the REFACTOR step names specific opportunities. Where none exists (one-line fixes, ref-nulling, pinning-only commits), the REFACTOR step explicitly states "no opportunity" so the discipline is visible at every task.

### [3] Task 6 includes `BAD_JSON` in `chapter.save.terminalCodes` even though the mapper's 2xx BAD_JSON branch never reaches byCode-matching

- **Severity:** Minor
- **Category:** design-gap
- **Summary:** `_resolveErrorInternal` returns early on 2xx BAD_JSON before byCode-matching, so `terminalCodes: ["BAD_JSON"]` would be dead. The consumer's `mapped.terminal || mapped.possiblyCommitted` OR catches 2xx BAD_JSON via `possiblyCommitted` instead. The design's framing ("the dispatch reads `mapped.terminal`") was misleading because the dispatch actually reads the OR of both flags.
- **Resolution:** fixed-in-design + fixed-in-plan — option A. Dropped BAD_JSON from `chapter.save.terminalCodes` (now `["UPDATE_READ_FAILURE", "CORRUPT_CONTENT"]`). Updated the design doc's framing to name the OR pattern as the documented bridge between terminal codes and committed codes. Updated Task 6's code comment to explain the OR's role. Updated the Step 1 test assertions to verify the BAD_JSON-via-possiblyCommitted path explicitly.

## Summary

- Pushback raised 7 issues; all 7 resulted in design changes (`fixed-in-design`). Most consequential: Issue 2 split the phase into three sub-phases per CLAUDE.md §Pull Request Scope; Issue 4 introduced the `MappedError<S>` phantom-type pattern.
- Alignment raised 3 issues; Issue 1 resulted in plan changes (template + per-task metadata table); Issue 2 added REFACTOR steps to ~20 tasks; Issue 3 touched both design and plan to drop the dead `BAD_JSON` terminal-codes entry and update the framing.
- Status: aligned; ready for implementation. CLAUDE.md drift (the "three justified-survivor files" wording in Save-Pipeline Invariants Rule 4) is deferred to Phase 4b.3d per user decision (the file count becomes four when 4b.3c.3 adds `useTrashManager.ts` to the allowlist).
