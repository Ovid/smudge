# Phase 4b.7 — Test Warning-Pin Audit (Design)

**Date:** 2026-05-30
**Phase:** 4b.7 (docs/roadmap.md)
**Status:** Design — approved in brainstorming, pending pushback
**Author:** Ovid / Claude (collaborative)
**Type:** Test-only refactor. No production code change, no user-facing behavior change.

---

## 1. Goal

Make CLAUDE.md §Testing Philosophy's rule — _"When a test deliberately
triggers an error path that logs a warning, spy on the output, suppress
it, **and assert the expected message**"_ — **structurally enforced**
rather than reliant on reviewer vigilance.

Today the contract is honored inconsistently: many tests install a
`console.warn`/`console.error` spy with `.mockImplementation(() => {})`
to keep the output clean, but never assert on it. Each unasserted spy is
a silent suppressor — if the production path it covers stops warning (or
starts warning differently), the test still passes, and a future
unexpected warning anywhere in that scope is swallowed. That is exactly
the failure CLAUDE.md warns about: _"if every test run has 30 expected
warnings, developers stop reading them and miss the 31st that signals a
real bug."_

After this phase, the **only** way to spy on `console` in the client
test suite is a helper that makes "installed ⇒ asserted" a structural
invariant, backed by a runtime guard and a lint ban.

## 2. Non-goals

- **No production code changes.** No source file under
  `packages/client/src/` outside test files and test infrastructure is
  touched. Word counts, save pipeline, etc. are untouched.
- **No new test behavior.** Migrating a spy does not change _what_ a
  test verifies about the component/hook under test — only _how_ console
  output is spied and asserted.
- **No server/shared work.** The pattern does not occur under
  `packages/server/` or `packages/shared/` (census below is client-only).
  Server tests are out of scope.
- **No global "fail on any un-suppressed console output" guard.** That is
  a different, larger initiative (it polices console output the suite does
  _not_ spy, requires an allowlist for framework/library noise, and does
  **not** enforce assertion of spied calls — a mocked spy is invisible to
  it). Explicitly excluded; may be proposed as its own future phase.
- **No coverage-threshold changes.** Thresholds in `vitest.config.ts`
  (95/85/90/95) stay; coverage may rise incidentally but is not chased.

## 3. Corrected census (supersedes the roadmap's stale count)

The roadmap row for 4b.7 states "52 console-spy installs across 9 client
test files." That count predates 4b.3c/4b.4/4b.5 and is badly stale. The
current reality on the `test-warning-pin-audit` branch:

**140 `vi.spyOn(console, …)` installs across 16 files.**

| Installs | File |
| -------- | ---- |
| 69 | `__tests__/useProjectEditor.test.ts` |
| 15 | `__tests__/EditorPageFeatures.test.tsx` |
| 12 | `hooks/useEditorMutation.test.tsx` |
| 10 | `__tests__/HomePage.test.tsx` |
| 9 | `__tests__/DashboardView.test.tsx` |
| 4 | `__tests__/ProjectSettingsDialog.test.tsx` |
| 4 | `errors/clientLog.test.ts` |
| 3 | `__tests__/useSnapshotState.test.ts` |
| 3 | `errors/devWarn.test.ts` |
| 2 | `__tests__/useTrashManager.test.ts` |
| 2 | `__tests__/ExportDialog.test.tsx` |
| 2 | `hooks/useAbortableSequence.test.ts` |
| 2 | `hooks/useAbortableAsyncOperation.test.ts` |
| 1 | `__tests__/useContentCache.test.ts` |
| 1 | `__tests__/editorSafeOps.test.ts` |
| 1 | `errors/apiErrorMapper.test.ts` |

A fresh census is the source of truth at implementation time (the suite
may grow before this lands). The implementation's first step re-runs the
census; the roadmap row and this section are corrected as a deliverable.
The single-grep audit surface is:

```
grep -rnE 'vi\.spyOn\(console' packages/client/src
```

## 4. Three spy shapes (the audit must classify each site)

1. **Per-test, already asserted** — compliant today, e.g.
   `useProjectEditor.test.ts:1284` (`expect(warnSpy).toHaveBeenCalledWith(...)`).
   Migrated to the helper anyway so the lint ban can be total and the
   pattern uniform. No change to the assertion's meaning.
2. **Per-test, defensive/unasserted** — installed only to keep output
   clean, never asserted, e.g. `ExportDialog.test.tsx:380-381`. Gets a
   real classification (see §6).
3. **Block-level `beforeEach` suppressor** — silences warn+error for an
   entire `describe`, e.g. `useTrashManager.test.ts:57-68`. This is the
   highest-risk shape: it hides _any_ new unexpected warning across every
   test in the block. **Per the brainstorm decision, these are eliminated**
   — converted to per-test expectations (§6). No sanctioned block-level
   suppressor survives; there is **no escape hatch**.

## 5. The helper

### 5.1 Location

`packages/client/src/__tests__/expectConsole.ts`, beside the existing
`setup.ts`. It lives under `__tests__/`, which the root
`vitest.config.ts` coverage config excludes — so the helper does not
affect coverage either way. It is nonetheless unit-tested for
correctness (§8); test infrastructure that everything else trusts must
itself be trustworthy.

### 5.2 API

```ts
type ConsoleMethod = "log" | "info" | "warn" | "error" | "debug";

interface ConsoleExpectation {
  /** Assert called with exactly these args (vitest matchers allowed). Resolves. */
  calledWith(...args: unknown[]): ConsoleExpectation;
  /** Assert NOT called with these args (the `not.toHaveBeenCalledWith` shape). Resolves. */
  notCalledWith(...args: unknown[]): ConsoleExpectation;
  /** Assert called exactly n times. Resolves. */
  calledTimes(n: number): ConsoleExpectation;
  /** Assert the nth (1-based) call's args. Resolves. */
  nthCalledWith(n: number, ...args: unknown[]): ConsoleExpectation;
  /** Assert called at least once, args unspecified. Resolves. */
  called(): ConsoleExpectation;
  /** Assert never called (the `not.toHaveBeenCalled` shape). Resolves. */
  silent(): ConsoleExpectation;
}

/** Install a suppressing spy on console[method] and register a pending expectation. */
export function expectConsole(method: ConsoleMethod): ConsoleExpectation;

/** Throw if any expectation created this test was never resolved; restore + clear. */
export function assertConsoleExpectationsSettled(): void;
```

The matcher set is **closed and exhaustive of the shapes the census uses**
(`toHaveBeenCalledWith`, `not.toHaveBeenCalled`, `not.toHaveBeenCalledWith`,
times/nth for multi-call paths). There is deliberately **no raw `.spy`
accessor** — exposing the underlying mock would let a caller bypass
resolution tracking (assert manually while the registry believes the
handle unresolved, or grab the spy and never assert). If a genuinely new
matcher shape appears during migration, it is added to the helper as a
named method, not via a raw escape.

### 5.3 Semantics

- `expectConsole(m)` does `vi.spyOn(console, m).mockImplementation(() => {})`
  (suppress output), pushes a handle onto a module-level per-test
  registry, and returns the chainable handle.
- Each matcher method runs the corresponding `expect(spy)...` assertion
  **and** marks the handle resolved. Methods are chainable so a test can
  assert more than one property (e.g. `.calledTimes(2).nthCalledWith(1, …)`).
- A handle created but never resolved is a **test failure**, raised by
  `assertConsoleExpectationsSettled()` with a message naming the method
  and the count of unresolved handles.

## 6. Per-site classification procedure

For each migrated site:

- **Production call fires deliberately** → `.calledWith(...)` (or
  `.calledTimes`/`.nthCalledWith` for multi-call paths) matching the exact
  production call site. Mirror the already-pinned examples at
  `useProjectEditor.test.ts:1284, 1314`.
- **No console output should occur** (defensive spy that was guarding
  against noise that, on inspection, never fires) → `.silent()`.
- **Negative assertion of a specific message** (e.g. abort-silence
  invariants, `useProjectEditor.test.ts:1337`) → `.notCalledWith(...)`.
- **Block-level `beforeEach` suppressor** → delete the `beforeEach`/
  `afterEach` spy pair; in each test of the block, add the explicit
  expectation that fits that test (`.calledWith` where a warn is expected,
  `.silent` where none should fire). Every test in the block is classified
  individually.

If classifying a site reveals that the production path's warning is
_wrong_ or _missing_, that is a real finding: fix forward in the same PR
(it is a bug the suppressor was hiding) and note it in the PR description.

## 7. Enforcement (two layers)

### 7.1 Runtime guard — global `afterEach`

`packages/client/src/__tests__/setup.ts` currently registers no
`afterEach`. Add one that calls `assertConsoleExpectationsSettled()`.
This runs after every test in the client project and converts an
unresolved (installed-but-unasserted) spy into a hard failure — the
runtime backstop that makes the invariant real even if lint is bypassed.

Robustness details:
- The registry is cleared at the end of each `afterEach` (and defensively
  at handle-registration if a prior test left state) so an unresolved
  handle cannot leak into the next test.
- Spies are restored in the same `afterEach` (removing the manual
  `mockRestore()` boilerplate the old pattern required).
- A test that throws before resolving still triggers the guard; vitest
  reports both the original failure and the unresolved-handle error
  (additive, not masking).
- Calling `expectConsole(m)` twice for the same method in one test throws
  immediately with a clear message (no silent double-spy).
- **Concurrency constraint:** the module-level registry assumes
  sequential tests within a file. The client suite does not use
  `test.concurrent`. The helper documents this; if concurrency is ever
  introduced, the registry must be keyed by
  `expect.getState().currentTestName`.

### 7.2 Lint ban — total, via ESLint

Add a `no-restricted-syntax` selector (in the test-files block of
`eslint.config.js`, mirroring the repo's existing selector style) that
rejects raw `vi.spyOn(console, …)`:

```
CallExpression[callee.object.name='vi'][callee.property.name='spyOn'][arguments.0.name='console']
```

Message: _"Spy on console via expectConsole() from
src/__tests__/expectConsole.ts (CLAUDE.md §Testing Philosophy). Raw
console spies must be asserted; the helper enforces it."_

The helper file `expectConsole.ts` is the sole allowed site for the raw
call (it _is_ the implementation) — exempted via a file-scoped override
or a single inline `// eslint-disable-next-line no-restricted-syntax --
helper implementation` with the repo's two-hyphen reason convention.

Because the ban is total, **all 140 sites must migrate** — a raw spy left
anywhere fails lint. This is the cost of a clean, total guarantee and is
the reason the phase touches every file in the census.

## 8. Testing the helper

`packages/client/src/__tests__/expectConsole.test.ts` covers:

- `expectConsole(m)` suppresses output (the real `console[m]` is not
  written during the test).
- Each matcher passes when the contract holds and fails when it does not
  (`calledWith`, `notCalledWith`, `calledTimes`, `nthCalledWith`,
  `called`, `silent`).
- `assertConsoleExpectationsSettled()` **throws** when a handle is
  unresolved and **does not throw** when all are resolved.
- Double-`expectConsole` for the same method in one test throws.
- Restore happens (after settle, `console[m]` is the original).
- The settle function is exercised directly (not only via the global
  afterEach) so its failure path is provable in isolation.

## 9. CLAUDE.md update (a deliverable of this phase)

§Testing Philosophy's "Zero warnings in test output" paragraph currently
shows the manual `const warnSpy = vi.spyOn(console, "warn")
.mockImplementation(() => {}); … expect(warnSpy).toHaveBeenCalledWith(...);
warnSpy.mockRestore();` snippet as canonical. Update it to:
- Make `expectConsole()` the canonical pattern (with a short example).
- State that raw `vi.spyOn(console, …)` is banned by ESLint and that the
  global afterEach guard fails any unresolved expectation.
- Keep the underlying principle text (why noisy output is dangerous).

## 10. Roadmap update (a deliverable of this phase)

Correct the 4b.7 row + §Scope table in `docs/roadmap.md` from "52 across
9 files" to the real census (140/16), and add the `<!-- plan: -->`
comment pointing at this design doc. (The plan-comment insertion and
Phase Structure status flip are handled by the /roadmap flow.)

## 11. PR shape & commit sequence

**One PR** (Ovid's decision), a single cohesive test-infra refactor,
broken into bite-sized TDD commits:

1. `expectConsole` helper + `expectConsole.test.ts` (red → green for the
   helper itself).
2. Wire `assertConsoleExpectationsSettled()` into `setup.ts`'s new
   `afterEach`.
3. Add the ESLint ban, initially with a file-path allowlist covering the
   not-yet-migrated files so the suite stays green.
4. Migrate file-by-file (one commit per file, largest last or first by
   preference), removing each from the allowlist as it lands; each commit
   keeps `make all` green.
5. Remove the allowlist entirely once all files are migrated — the ban is
   now total.
6. CLAUDE.md + roadmap-census doc edits.

Per CLAUDE.md §Pull Request Scope this is **one refactor** (the helper,
its enforcement, and the mechanical migration are one cohesive change;
the CLAUDE.md doc edit documents the same change). It does not bundle a
second feature.

## 12. Definition of Done

- `expectConsole()` helper + tests landed; `assertConsoleExpectationsSettled`
  wired into `setup.ts`.
- Zero raw `vi.spyOn(console, …)` outside the helper file; ESLint ban
  active with no path allowlist remaining.
- All 140 (or the fresh-census count) sites resolved via the helper, each
  with an explicit per-test expectation; no block-level suppressor remains.
- CLAUDE.md §Testing Philosophy updated; roadmap census corrected.
- `make all` green; coverage at or above thresholds; zero test warnings.
- No production code or user-facing behavior changed.

## 13. Risks & mitigations

- **Scope is 3× the roadmap estimate (140 vs 52).** Accepted as one large
  PR; mitigated by per-file commits that each stay green, so review and
  bisect remain tractable.
- **A migration silently changes what a test asserts.** Mitigated by the
  rule that migration changes only console spying; the file's other
  assertions are untouched and `make all` must stay green per commit.
- **Classifying block-level suppressors surfaces real production-warning
  bugs.** Treated as in-scope fix-forward (the suppressor was hiding
  them), documented in the PR.
- **`expect.getState()`/concurrency.** Documented constraint; suite is
  sequential today.

## 14. Dependencies

- Phase 4b.3a Cluster A merged (the I1 finding that motivated this phase).
- Independent of Phase 4b.4 (Raw-Strings ESLint Rule); landing 4b.7 first
  is mildly preferred so 4b.4's lint cleanup runs on a contract-clean
  suite, but order is not enforced.
