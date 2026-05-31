# Agentic Code Review: test-warning-pin-audit

**Date:** 2026-05-31 00:33:44
**Branch:** test-warning-pin-audit -> main
**Commit:** e43e9af19ec59e3d0e63c17ecf282d697822ed88
**Files changed:** 26 | **Lines changed:** +2442 / -753
**Diff size category:** Large

## Executive Summary

Phase 4b.7 is a disciplined, test-only infrastructure refactor: it introduces the
`expectConsole()` console-spy helper, wires a global `afterEach` settle-guard, adds a
total ESLint ban on raw `vi.spyOn(console)`, and migrates all 140 census sites across 16
client test files. Two Logic specialists independently ran the full 1478-test suite green
and verified the load-bearing Vitest semantics (`result.state` is `"fail"` before
`afterEach`, so the non-masking guarantee holds). No Critical or Important issues were
found and the branch is sound for merge. Four Suggestion-tier robustness/doc-accuracy
polish items remain on the new trust-infrastructure — the strongest being that the lint
ban selector only covers the direct `vi.spyOn(console, …)` form while the design frames it
as "total." Overall confidence: high.

## Critical Issues

None found.

## Important Issues

None found.

## Suggestions

- **[S1] Lint ban selector covers only the direct call form** — `eslint.config.js:145-146`: the selector matches only `vi.spyOn(console, …)` and structurally misses `vi.spyOn(globalThis.console, …)` / `vi.spyOn(window.console, …)` (member-access first arg has no `.name`) and aliased/destructured `spyOn`; since a bypass-form raw spy never registers with the helper, the runtime settle-guard would not catch it either. Zero live bypass instances today (latent gap, not an active hole). Fix: add a sibling selector matching `[arguments.0.property.name='console']`, document alias/destructure as known gaps, and/or soften the design's "total / structural invariant" wording to "direct-form ban + runtime backstop." (Contract & Integration, `claude-opus-4-8[1m]`, confidence Medium)
- **[S2] Design §7.1 prose names a stale failure-detection mechanism** — `docs/plans/2026-05-30-test-warning-pin-audit-design.md:247`: the bullet attributes failed-test detection to `expect.getState()`, but the shipped guard uses `ctx.task.result?.state === "fail"` (`setup.ts:42-45`); the decision log already names the correct mechanism, so this is narrow prose staleness. Fix: update line 247 to name `ctx.task.result?.state`, reserving the `expect.getState().currentTestName` reference for the concurrency-keying paragraph only. (Error Handling, `claude-opus-4-8[1m]`, confidence High)
- **[S3] Restore loop has no per-handle error isolation** — `packages/client/src/__tests__/expectConsole.ts:121`: `for (const h of handles) h.spy.mockRestore();` runs after the `registry.splice(0)`; if any `mockRestore()` threw, later handles' suppressing spies would never restore (leaking into the next test) and the unresolved-handle throw at line 124 would be skipped. No realistic trigger in normal Vitest usage, but the blast radius (a leaked suppressor swallowing the next test's output) is exactly the failure class this infrastructure exists to prevent. Fix: wrap each restore in `try { … } catch { /* keep restoring */ }` (or a `try/finally` around the unresolved check). (Error Handling, `claude-opus-4-8[1m]`, confidence Medium)
- **[S4] `testFailed` defaults to `false` on a bare call** — `packages/client/src/__tests__/expectConsole.ts:113,122`: `assertConsoleExpectationsSettled()` treats a missing arg as not-failed, so a bare call still throws on unresolved handles (cannot mask a green-but-unasserted failure — the safe direction); the only downside is a spurious double-report if a future caller invokes it bare on an already-failed test. Today `setup.ts` always passes the real signal. Fix (optional): document at the param that bare calls assume a passing test (fail-loud). (Error Handling, `claude-opus-4-8[1m]`, confidence Medium)

## Review Metadata

- **Agents dispatched:** Logic & Correctness ×2 (helper logic + Vitest semantics; heavy-file migration faithfulness), Error Handling & Edge Cases (settle-guard exit paths), Contract & Integration ×2 (helper API + ESLint selector + heavy files; light-file migrations), Concurrency & State (module-level registry), Security (trust-boundary check), Spec Compliance (Definition-of-Done vs design/plan/decision log)
- **Scope:** All 26 changed files — the helper (`expectConsole.ts`), its tests (`expectConsole.test.ts`), `setup.ts`, `eslint.config.js`, 16 migrated client test files (+ adjacent production sources traced for `.calledWith` arg verification: `useProjectEditor.ts`, `useEditorMutation.ts`, `useTrashManager.ts`, `DashboardView.tsx`, `clientLog.ts`, `devWarn.ts`), and docs (`CLAUDE.md`, `docs/plans/*`, `docs/roadmap*.md`, decision log)
- **Raw findings:** 5 (before verification)
- **Verified findings:** 4 (after verification)
- **Filtered out:** 1 (server `logger.test.ts` raw spy — correct by design; ban is client-suite-scoped per CLAUDE.md §Testing Philosophy)
- **Out-of-scope findings:** 0 (Critical: 0, Important: 0, Suggestion: 0)
- **Out-of-scope additions:** 0
- **Backlog:** 0 new entries added, 0 re-confirmed (see `paad/code-reviews/backlog.md`)
- **Steering files consulted:** `CLAUDE.md`
- **Intent sources consulted:** `docs/plans/2026-05-30-test-warning-pin-audit-design.md`, `docs/plans/2026-05-30-test-warning-pin-audit-plan.md`, `docs/roadmap-decisions/2026-05-30-phase-4b-7-test-warning-pin-audit.md`, recent commit messages, branch name
- **Verifier warnings:** none
