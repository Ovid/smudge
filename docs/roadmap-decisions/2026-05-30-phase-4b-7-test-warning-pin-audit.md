---
date: 2026-05-30
phase: "Phase 4b.7: Test Warning-Pin Audit"
model: claude-opus-4-8
design_file: docs/plans/2026-05-30-test-warning-pin-audit-design.md
plan_file: docs/plans/2026-05-30-test-warning-pin-audit-plan.md
pushback:
  total: 5
  critical: 0
  important: 3
  minor: 2
alignment:
  total: 3
  critical: 0
  important: 1
  minor: 2
---

# Phase 4b.7: Test Warning-Pin Audit — Decision Log

## Pushback Findings

### [1] Closed matcher set cannot model the `mock.calls.filter` site
- **Severity:** Important
- **Category:** Feasibility
- **Summary:** §5.2 claimed the helper's matcher set was "closed and exhaustive of the shapes the census uses," with deliberately no raw `.spy` accessor. Grepping the actual census disproved it: `useProjectEditor.test.ts:1081` filters `warnSpy.mock.calls` with a custom first-arg-substring predicate over a variable trailing-arg list. The proposed `notCalledWith(expect.stringContaining(…))` can't reproduce it — a one-arg `notCalledWith` never matches a two-arg `console.warn(msg, error)` call, so it would pass trivially (a false green that defeats the regression the test guards). "All 140 migrate, no escape hatch" collided with a real site on day one.
- **Resolution:** fixed-in-design — added `calledMatching(fn)` / `notCalledMatching(fn)` predicate matchers (predicate over `mock.calls`, still resolves the handle); corrected the §5.2 "exhaustive" claim and added a §6 classification bullet.

### [2] §2/§12 "no production code changes" contradicts §6/§13 fix-forward
- **Severity:** Important
- **Category:** Contradiction
- **Summary:** §2 Non-goals and §12 DoD asserted an absolute "no production code changes," while §6 and §13 instructed the implementer to forward-fix any production-warning bug the audit uncovers in the same PR. Both cannot hold; the test-only framing is load-bearing for the §11 one-refactor PR-scope justification, and block-level suppressors (the highest-risk shape) are exactly where a hidden prod bug is most likely to surface — so the fork is foreseeable, not hypothetical.
- **Resolution:** fixed-in-design — rewrote §2/§12/§13 to drop the absolute claim in favor of "test-only **except** bug fixes the audit uncovers, each recorded in the phase decision log per CLAUDE.md §Pull Request Scope."

### [3] Runtime guard double-reports on already-failing tests
- **Severity:** Important
- **Category:** Omission
- **Summary:** §7.1 claimed the `afterEach` guard was "additive, not masking" when a test throws before resolving — but didn't reckon with red-phase TDD. Any test that installs `expectConsole()` then fails before its matcher call would report two errors: the real failure and a spurious unresolved-handle error. That noise lands precisely during red-first development (which CLAUDE.md mandates) and when bisecting a regression, and the "additive" claim was unproven.
- **Resolution:** fixed-in-design — `assertConsoleExpectationsSettled` now suppresses its own throw when the test already failed (via the `afterEach` `ctx.task.result?.state` signal), firing only on green-but-unasserted handles; §8 adds a test proving the original failure is not masked.

### [4a] Helper's own test file may be unable to lint
- **Severity:** Minor
- **Category:** Omission
- **Summary:** §7.2 exempted only `expectConsole.ts` from the raw-spy ban, but §8 requires `expectConsole.test.ts` to prove the helper suppresses output — which naively wants a raw `vi.spyOn(console, …)` that the ban forbids and the test file is not exempted for. Risk: the implementer hits a wall or reflexively widens the exemption to the test file, punching a hole in the ban.
- **Resolution:** fixed-in-design — §8 now specifies the suppression test asserts on `process.stderr`/`stdout.write` (which the lint selector does not match), keeping the test file inside the ban with no test-file exemption.

### [4b] ESLint file-path allowlist adds churn for no safety gain
- **Severity:** Minor
- **Category:** Other (process)
- **Summary:** §11 step 3 added the ESLint ban with a 15-file per-file disable list, then removed entries one per migration commit (~15 throwaway config edits). The allowlist's only benefit is "the ban is visible earlier," which has no value before migration completes.
- **Resolution:** fixed-in-design — §11 now migrates all files first (each commit green because no rule exists yet) and adds the total ban in a single final commit; no allowlist.

## Alignment Findings

### [1] §8 wants pass AND fail proofs for every matcher
- **Severity:** Important
- **Category:** missing-coverage
- **Summary:** Design §8 specifies each matcher must pass when its contract holds **and fail when it does not**, enumerating all of them. The plan proved the fail direction only for `calledWith` and `notCalledMatching`, leaving `silent`/`notCalledWith`/`calledTimes`/`nthCalledWith`/`called`/`calledMatching` fail-paths unproven — where an inverted matcher (e.g. `silent` calling `toHaveBeenCalled`) would pass silently.
- **Resolution:** fixed-in-plan — added a fail-path assertion for every matcher. Writing these surfaced a latent implementation bug (matchers marked the handle resolved *after* `expect()`, so a failing matcher left the handle unresolved and would spuriously re-fire the guard); fixed by marking resolved *before* asserting, with design §5.3 clarified to match.

### [2] Design §7.1's defensive registry clear guards an impossible state
- **Severity:** Minor
- **Category:** design-gap
- **Summary:** §7.1 called for a defensive registry clear at `expectConsole()` registration "if a prior test left state," which the plan omitted. On inspection the omission was correct: `registry.splice(0)` is the first statement of `settle`, so every exit path leaves the registry empty and a leak is unreachable. The registration-time clear would be dead code under the sequential suite, actively wrong under `test.concurrent` (clearing a sibling's live handles), and a silent self-heal would mask an `afterEach`-not-running bug.
- **Resolution:** fixed-in-design — reconciled §7.1 to explain the registration clear was deliberately dropped as redundant-and-masking; pinned the splice-first ordering as a load-bearing invariant in the plan's implementation comment.

### [3] Task 4 wiring proof was a string read, not behavioral
- **Severity:** Minor
- **Category:** tdd-format
- **Summary:** Task 4 proved the global `afterEach` wiring by regex-matching `setup.ts` as text — a structural assertion that would pass on semantically-broken wiring and couples the test to source text. §8's actual requirement ("exercise settle directly") was already met by Tasks 1–3, making the string-read the weakest, most brittle test in the plan.
- **Resolution:** fixed-in-plan — replaced the string read with a behavioral test that drives the guard through a real (nested) `afterEach` lifecycle and captures the unresolved-handle error, plus a resolved-handle no-op check.

## Summary

- Pushback raised 5 issues; all 5 resulted in design changes (fixed-in-design). Two were Important structural problems caught only by grepping the real census and PR-scope rules (the predicate-matcher gap and the no-production-change contradiction); the third Important issue hardened the guard against red-phase double-reporting. None dismissed.
- Alignment raised 3 issues; 2 fixed in the plan, 1 fixed in the design. The Important coverage gap (matcher fail-paths) additionally surfaced a latent mark-after-assert bug in the helper implementation, fixed before any code was written. None dismissed.
