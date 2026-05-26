---
date: 2026-05-25
phase: "Phase 4b.3b: AbortSignal Threading Completion"
model: claude-opus-4-7
design_file: docs/plans/2026-05-25-abortsignal-threading-completion-design.md
plan_file: docs/plans/2026-05-25-abortsignal-threading-completion-plan.md
pushback:
  total: 10
  critical: 1
  important: 7
  minor: 2
alignment:
  total: 2
  critical: 0
  important: 0
  minor: 2
---

# Phase 4b.3b: AbortSignal Threading Completion — Decision Log

## Pushback Findings

### [1] Allowlist-test breakage mid-PR
- **Severity:** Critical
- **Category:** Feasibility
- **Summary:** The structural-test assertion at `migrationStructuralCheck.test.ts:155` ("Phase 4b.3b allowlist entries actually contain `useRef<AbortController>`") fails the moment a migration removes the last ref from any file still in the allowlist. Three files (ExportDialog, ProjectSettingsDialog, SnapshotPanel) trip this fail-mode on their final ref-removal commit. The original §5 execution order updated the allowlist only at step 7, leaving CI red across steps 4-6 and contradicting §5's "rollback at site granularity" and "each commit `make test` green" claims.
- **Resolution:** fixed-in-design — §5 grew an "Allowlist-edit discipline" block (lines 193–199): each last-ref-removal commit MUST also remove the file from `PHASE_4B_3B_ALLOWLIST` in the same commit. The step-7 commit only rewrites the comment block; file-set is already correct by then. Preserves CI-green-per-commit and rollback-at-site-granularity.

### [2] Arithmetic inconsistency in §In Scope item 3
- **Severity:** Important
- **Category:** Contradiction
- **Summary:** §In Scope item 3 claimed "12 allocations across the 4 non-Cluster-B allowlisted files" but §2.3 enumerated 16 sites (S-1..S-16) across 6 files. The §6 DoD math was correct (20 starting refs − 15 hook migrations = 5 survivors), so the inconsistency lived only in the §In Scope wording — but the off-by-N signals a slight drift in the author's mental model and a reviewer noticing it loses trust in other counts.
- **Resolution:** fixed-in-design — §In Scope item 3 rewritten to "16 allocations across the 6 allowlisted files (EditorPage and useProjectEditor are partially touched by Cluster B as well)".

### [3] Scope size has snapshots-find-replace shape with no review-burden mitigation
- **Severity:** Important
- **Category:** Scope
- **Summary:** The PR contains ~25 commits across 7 files plus structural test plus CLAUDE.md edits. Decision 2 in §Scope Decisions records that this bends CLAUDE.md's one-feature rule, but the original §5 didn't pre-commit to a review-burden mitigation. The snapshots-find-replace PR was the same shape and took 16 rounds of review.
- **Resolution:** fixed-in-design — §5 gained a "Review strategy" subsection (line 207): review per-commit, decision matrix is the contract, reviewers may approve commit-by-commit. The CLAUDE.md §Pull Request Scope footnote stays inside this PR (cosmetic circularity accepted — decision log is the actual record).

### [4] §In Scope item 2 inconsistency ("8 sites" vs "C-1 through C-11")
- **Severity:** Important
- **Category:** Contradiction
- **Summary:** §In Scope item 2 said "All 8 sites enumerated in the roadmap" but §2.2 enumerated 11 entries (C-1..C-11). Second arithmetic miss in the same §In Scope section after issue 2.
- **Resolution:** fixed-in-design — §In Scope item 2 rewritten to "All 11 entries enumerated below".

### [5] `sleep(ms, signal)` helper extraction left undecided
- **Severity:** Important
- **Category:** Ambiguity
- **Summary:** The spec mentioned `sleep(ms, signal)` three times with three different conditional framings: "uses a small `sleep(ms, signal)` helper" (§2.2 C-9), "if extracted as a shared helper" (§3.2), "if extracted" (§5 step 2). §6 DoD didn't mention it. C-9 needs the helper; S-2 (retry-with-backoff) is the natural second user. The deferred decision would have become a brainstorm detour mid-implementation.
- **Resolution:** fixed-in-design — committed to extracting to `packages/client/src/utils/abortable.ts` with unit tests. §5 step 2, §2.3 S-2 row, §3.2, and §6 DoD all updated. Both C-9 and S-2 use the helper.

### [6] API-surface commit's test claim didn't match commit's reality
- **Severity:** Important
- **Category:** Contradiction
- **Summary:** §5 step 1 said "tests proving each signal reaches `apiFetch` options" (implying transport-level tests). §6 DoD said "Each new signal parameter is exercised by at least one consumer test" (which can't exist in commit #1 — consumers migrate in steps 3+). Either commit #1 ships transport tests (fine; clarify) or DoD's language is wrong.
- **Resolution:** fixed-in-design — §5 step 1 explicitly calls for 4 transport-level tests in commit #1; §6 DoD adds a second bullet for per-consumer behavioral tests landing with each consumer's migration commit. Both gates testable independently.

### [7] S-7 dual-signal claim depends on hook contract that should be pinned
- **Severity:** Important
- **Category:** Omission
- **Summary:** S-7's decision relies on "the per-call signal passed to fn remains valid for multiple awaited calls within fn." The hook source supports this today (verified), but no test pins the contract. A future hook refactor could silently break S-7 without breaking the hook's own tests or the structural import-implies-call assertion.
- **Resolution:** fixed-in-design — §3.2 added a hook-level contract test in `useAbortableAsyncOperation.test.ts`: per-call signal valid across multiple awaits within fn, aborts all on next run(). §6 DoD gained a "Hook contract" section.

### [8] C-7/C-8 mutual-abort semantics unstated, possibly wrong
- **Severity:** Important
- **Category:** Feasibility
- **Summary:** §2.2 C-8 said "Same `selectChapterOp` instance as C-7" without analyzing whether `reloadActiveChapter` can fire concurrently with `handleSelectChapter`. Today's seq-token mechanism discards stale responses; the migration changes the cancellation surface to abort at the network layer. If a race is reachable, sharing the instance changes user-visible behavior.
- **Resolution:** fixed-in-design — §2.2 C-8 gained a "Verify before migration" gate: confirm the race surface during implementation; if a race exists, row becomes "Two separate hook instances" with a behavioral test pinning the chosen semantics. Plan Task 12 includes the investigation as Step 1.

### [9] Coverage risk from §3.3 test drops not acknowledged
- **Severity:** Minor
- **Category:** Omission
- **Summary:** §3.3 (drop redundant internals tests) reduces test count without reducing production lines, shrinking the coverage headroom above threshold. CLAUDE.md §Testing Philosophy's "never lowered, aim higher" rule needs a measurement gate, not just an assertion.
- **Resolution:** fixed-in-design — §5 step 7 added a `make cover` checkpoint: record per-package delta vs branch-base; if any threshold dropped (even within still-passing range), add a focused test before opening the PR.

### [10] App.tsx / DashboardView.tsx skip rationale was structural, not behavioral
- **Severity:** Minor
- **Category:** Omission
- **Summary:** §Out of Scope said both files "use `AbortController` without `useRef`, so they don't match the structural regex" — answering *why they're not blocked*, not *why they don't need migration*. A future "AbortSignal threading completion" claim that excludes two AbortController-using files reads odd without a behavioral rationale.
- **Resolution:** fixed-in-design — §Out of Scope line rewritten with behavioral rationale ("already use `AbortController` with `useEffect`-cleanup abort lifecycle; verified during 4b.3b brainstorming that no migration is needed. Phase 4b.4's ESLint rule design will re-evaluate whether they need inline justification comments.").

## Alignment Findings

### [1] §3.2 row S-16 — behavioral test not in plan
- **Severity:** Minor
- **Category:** missing-coverage
- **Summary:** Design §3.2 lists a behavioral assertion for S-16: "the hand-rolled two-controller pattern still aborts correctly on unmount and on a new restore." Plan Task 26 (S-16 inline justification comment) only adds the documentation; no verification step. Other §3.2 rows all map to plan tasks with tests. The behavioral coverage may already exist in `useSnapshotState.test.ts` (the design notes the existing comment at lines 395-402), but Task 26 didn't verify this.
- **Resolution:** fixed-in-plan — Task 26 gained Step 2 (verify §3.2 row 6 behavioral coverage): grep existing test file; if found, cite the test name in the commit message; if not found, add a new behavioral test before committing.

### [2] §3.1 best-effort assertion — not addressed in plan
- **Severity:** Minor
- **Category:** missing-coverage
- **Summary:** Design §3.1 last bullet calls for a best-effort structural assertion that every signal-bearing API endpoint has ≥1 consumer threading a non-undefined signal, with explicit permission to defer if grep-on-source gets too fragile. The plan didn't mention this anywhere — neither attempting it nor recording the deferral. Not a behavioral gap; an evidence-trail gap.
- **Resolution:** fixed-in-plan — Task 27 gained Step 4: attempt the assertion with a concrete grep template; if the grep is fragile, record the deferral rationale in the commit message ("§3.1 best-effort … deferred — grep-on-source too fragile for `op.run((s) => api.X(arg, s))` shapes. Coverage of signal-threading provided behaviorally by Tasks 11, 13, 14, 23, 24 mock-call assertions.").

## Summary

- Pushback raised 10 issues; all 10 resulted in design changes (`fixed-in-design`). Severity profile: 1 Critical, 7 Important, 2 Minor.
- Alignment raised 2 issues; both resulted in plan changes (`fixed-in-plan`). Both Minor.
- Both critical/important findings concentrated in two areas: (1) the §5 execution order's CI-green-per-commit discipline (issue 1) and the scope-bending review strategy (issue 3); (2) doc-internal arithmetic and naming inconsistencies (issues 2, 4, 6) that would have eroded reviewer trust.
- Alignment confirmed the plan traces cleanly to the design's §1-§6 modulo two evidence-trail gaps that the design itself anticipated (S-16 behavioral coverage, §3.1 best-effort assertion's deferral path).
