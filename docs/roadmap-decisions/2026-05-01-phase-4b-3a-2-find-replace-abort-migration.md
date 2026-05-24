---
date: 2026-05-01
phase: "Phase 4b.3a.2: Find/Replace Abort Migration"
model: claude-opus-4-7
design_file: docs/plans/2026-05-01-find-replace-abort-migration-design.md
plan_file: docs/plans/2026-05-01-find-replace-abort-migration-plan.md
pushback:
  total: 3
  critical: 0
  important: 2
  minor: 1
alignment:
  total: 2
  critical: 0
  important: 1
  minor: 1
---

# Phase 4b.3a.2: Find/Replace Abort Migration — Decision Log

## Pushback Findings

### [1] New test #3 cannot distinguish the new `signal.aborted` gate from the existing `token.isStale()` path
- **Severity:** Important
- **Category:** Feasibility
- **Summary:** The design's new test #3 (success-path gate suppression) was framed as pinning the *new* row-7 success-path gate's contract. But re-reading the migrated row-7 placement, both gates (`if (signal.aborted) return;` and `if (token.isStale()) return;`) sit immediately above the success-path setStates. Production abort paths bump both — `closePanel` calls `searchSeq.abort()` AND `op.abort()`. So when test #3 aborts via closePanel, *whichever* gate fires first suppresses the setState; the test cannot tell them apart, and a future maintainer who deletes the `signal.aborted` gate would not see this test fail. The test pins the combined behaviour, not the gate in isolation.
- **Resolution:** `fixed-in-design` — Reworded the test #3 description in §Test plan §3b item 3 to honestly acknowledge the limitation: the test is a behavioural backstop covering the combined behaviour; the code comment at the gate (per §Risks) is the design-time enforcement of the gate's intent. Pinning the gates in isolation would require contrived production-impossible state (mocking `useAbortableAsyncOperation` directly) and was explicitly declared out of scope. Two alternative options (add a 4th test that mocks the hook to abort without bumping the seq; rework test #3 with vitest module mocking) were considered and rejected as overcomplicating coverage of a regression the source-code comment already discourages.

### [2] "RED-shaped" / "GREEN" commit labels in §Migration order misleading for characterization tests
- **Severity:** Important
- **Category:** Ambiguity
- **Summary:** The design's §Migration order labeled commits 1, 2, and 4 with "RED-shaped" / "GREEN" prefixes, conventionally the failing-test step of red-green-refactor. But the design's own §Risks bullet flags that all the new tests pass green against pre-migration code (they're characterization tests, not strict red-then-green). A reviewer reading commit 2's diff sees a passing test labeled "RED-shaped" — two readings: (a) the label is just naming the position in the TDD ordering, or (b) the label asserts the test should fail without the migration source change. Reading (b) would force `superpowers:writing-plans` to construct contrived tests that fail against current code, contradicting the very limitation acknowledged in pushback [1].
- **Resolution:** `fixed-in-design` — Renamed Commits 1, 2, and 4 in §Migration order to "Characterization tests for the abort-prior contract" / "Characterization test for the new success-path gate" / "Structural check" (dropped "RED" / "GREEN" labels). Renamed Commit 5 to "Cleanup (if needed)." Added an explanatory paragraph: *"This phase's tests are characterization tests — they pin behaviour the source change must preserve. They are not red-then-green tests in the strict sense, since the pre-migration code already satisfies them. The commit ordering preserves the discipline (no source change without prior test); it does not pretend the test commits go red against the current source."* Two alternative options (keep labels with redefined meaning; force test #3 genuinely red via contrived mocking) were rejected — option B introduces non-standard semantics future readers will misread, option C contradicts pushback [1]'s resolution.

### [3] `captureSignal` helper typing decision unaddressed
- **Severity:** Minor
- **Category:** Omission
- **Summary:** The design's §Test plan §3a proposes a `captureSignal(callIndex)` helper returning `mockFind.mock.calls[callIndex][3] as AbortSignal`. The existing test file declares `mockFind` as `api.search.find as ReturnType<typeof vi.fn>`, which makes `mock.calls[N]` an `any[]`. The `as AbortSignal` cast is therefore a cast on an `any[]` element — depending on the project's lint config (e.g., `no-unsafe-type-assertion`-style rules), this might be rejected, leaving the implementation plan executor with 30 seconds of unguided work to choose between an inline cast or a typed mock at declaration site. Genuinely minor — worst case a lint warning at PR time.
- **Resolution:** `fixed-in-design` — Added a typing note to §Test plan §3a: *"the existing test file declares mockFind as `api.search.find as ReturnType<typeof vi.fn>`, which makes `mock.calls[N]` an `any[]`. The `as AbortSignal` cast in the helper is therefore a cast on an `any[]` element. If the project's lint config rejects that under a `no-unsafe-type-assertion`-style rule, type the mock at declaration site as `vi.fn<typeof api.search.find>()` instead; otherwise inline the cast as written. The implementation plan picks whichever approach the lint pass accepts."* The implementation plan also includes a Step 2 in Task 1 to run `make lint` before deciding, with both fixes spelled out.

## Alignment Findings

### [1] Design's §3a closePanel tightening infeasible; §3a/§3b/§DoD counts misaligned with plan's [D1] resolution
- **Severity:** Important
- **Category:** design-gap
- **Summary:** The design's §3a row for `closePanel clears stale result state` proposed adding `expect(signal.aborted).toBe(true)` to the existing test. The test resolves the fetch via `mockFind.mockResolvedValue(...)` *before* `closePanel()` runs; the pre-migration `search()` finally-block clears `searchAbortRef.current` on success — so when `closePanel()` runs the ref is null and the captured signal is NOT aborted pre-migration. The assertion would fail pre-migration, contradicting the characterization-test framing. Plan-writing caught this and resolved as [D1]: drop the §3a closePanel tightening; add a 4th pure-new test using a never-resolving mock. The plan correctly delivers one tightening + four new tests, but the design's §3a row, §3b intro ("Three pure-new tests"), and §DoD bullets ("Two existing tests gain assertions… Three new tests added") still described the original (broken) shape. Three places where the count was wrong.
- **Resolution:** `fixed-in-design` — Edited §3a row to explain the infeasibility and point at the new test #4. Renamed §3b heading to "Four pure-new tests (added at end of file)" and added a 4th test description for `closePanel aborts an in-flight search signal`. Updated §DoD bullets to "One existing test gains assertion (project-change reset)" and "Four new tests." The plan's §Plan-vs-Design Notes [D1] stays as historical context; the divergence is now resolved-in-design rather than open. Two alternative options (leave design as-is, rely on plan note as canonical record; defer design update to follow-up) were rejected — both would leave a known inconsistency in two artifacts where alignment exists precisely to surface and resolve such gaps.

### [2] Design's §Behaviour mapping row 5 doesn't acknowledge the empty-query path's lost abort-prior
- **Severity:** Minor
- **Category:** design-gap
- **Summary:** Pre-migration, `search()` calls `searchAbortRef.current?.abort()` at line 193 *before* the `if (!query) { ... return; }` empty-query early-bail. The design's row 5 said this line is "Removed (the abort-prior is now done by op.run() itself)." True for the non-empty-query path, but `op.run()` only fires after the `if (!query)` early-return — for the empty-query path, no `op.run()` call exists to do the abort. The prior in-flight search would continue running server-side until unmount/closePanel/project-change/the-next-non-empty-search. Plan-writing caught this small behavioural regression and resolved as [D2]: add an explicit `op.abort()` at the top of the empty-query branch in the migrated `search()`. The plan correctly preserves the behaviour, but the design's row 5 still read as if op.run() covered everything. The empty-query path is rarely hit in practice (the debounce effect early-returns when query is empty, so it's only reachable via external callers) — this was the only thing keeping the severity Minor rather than Important.
- **Resolution:** `fixed-in-design` — Edited row 5 to acknowledge the empty-query special case: *"Removed for the non-empty-query path (the abort-prior is now done by op.run() itself). For the empty-query path (the if (!query) early-bail at row 9), an explicit op.abort() is added at the top of that branch to preserve the pre-migration abort-prior behaviour — op.run() never fires when the query is empty, so without the explicit abort the prior in-flight search would continue running server-side until unmount/closePanel/project-change. The empty-query path is rarely hit in practice (the debounce effect early-returns when query is empty, so it's only reachable via external callers), but the preservation is faithful to the pre-migration design intent."* Two alternative options (add a separate row 9b note; leave as-is and rely on plan's [D2]) were rejected for the same reason as alignment [1] — surface the resolution in the canonical table so the design is internally complete.

## Summary

- **Pushback raised 3 issues, all `fixed-in-design`.** Two Important findings on the test-strategy framing (test #3 cannot pin gates in isolation; "RED-shaped" / "GREEN" labels misleading for characterization tests) were caught and led to honest test-description rewording and a clean rename of the commit-ordering labels — both significantly improve how the design and plan will read to a reviewer who skims them. One Minor omission (`captureSignal` typing decision) closed a potential 30-second debugging surprise at plan-execution time.
- **Alignment raised 2 issues, both `fixed-in-design`.** One Important design-gap finding (the §3a closePanel tightening was infeasible — the existing test resolves the fetch before closePanel, the pre-migration finally nulls the ref on success, the assertion would fail pre-migration; counts mismatched across §3a, §3b, and §DoD) and one Minor design-gap finding (row 5 didn't acknowledge that the empty-query path's abort-prior would be lost without explicit preservation) were both surfaced by the implementation plan during writing-plans, captured as Plan-vs-Design Notes [D1] and [D2], and reconciled into the design so that the design and plan now agree.
- **Both upstream skills caught real, substantive issues that would have caused friction at plan-execution time.** Pushback's tests-pin-the-combined-behaviour finding [1] is exactly the kind of subtle test-design gap that's easy to over-promise on and hard to walk back; alignment's [D1] design-gap finding caught a flat-out infeasible test-strategy proposal that the original §Test plan invited a plan executor to attempt. Without these catches, the implementation plan would have either contained a knowingly-failing characterization test step or relied on a per-task workaround note buried in the plan — both inferior to the cleanly-resolved final design.
