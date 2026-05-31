# Phase 4b.7 — Test Warning-Pin Audit (Design)

**Date:** 2026-05-30
**Phase:** 4b.7 (docs/roadmap.md)
**Status:** Design — brainstormed + pushback-revised (2026-05-30), pending implementation plan & alignment
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

- **Test-only by default — one documented exception.** No source file
  under `packages/client/src/` outside test files and test infrastructure
  is touched, **except** a production-warning bug the audit uncovers (a
  warning that fires wrong, or fails to fire where the suppressor was
  hiding its absence — see §6). Such a fix is forward-fixed in this PR and
  **recorded in the phase decision log per CLAUDE.md §Pull Request Scope**
  (a bug fix alongside the change that surfaced it). Absent such a finding,
  no production code changes. Word counts, save pipeline, etc. are
  untouched regardless.
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
  /** Assert >=1 recorded call satisfies the predicate (over its full arg array). Resolves. */
  calledMatching(fn: (args: unknown[]) => boolean): ConsoleExpectation;
  /** Assert NO recorded call satisfies the predicate. Resolves. */
  notCalledMatching(fn: (args: unknown[]) => boolean): ConsoleExpectation;
}

/** Install a suppressing spy on console[method] and register a pending expectation. */
export function expectConsole(method: ConsoleMethod): ConsoleExpectation;

/** Throw if any expectation created this test was never resolved; restore + clear. */
export function assertConsoleExpectationsSettled(): void;
```

The matcher set is **closed and covers every shape the census uses**
(`toHaveBeenCalledWith`, `not.toHaveBeenCalled`, `not.toHaveBeenCalledWith`,
times/nth for multi-call paths, **plus the predicate matchers
`calledMatching`/`notCalledMatching`**). The predicate pair exists because
the census is _not_ confined to the fixed-arg matchers: at least one site
(`useProjectEditor.test.ts:1081`) filters `warnSpy.mock.calls` with a custom
first-arg-substring predicate across a _variable_ trailing-arg list, which
`not.toHaveBeenCalledWith` cannot reproduce (a one-arg `notCalledWith` never
matches a two-arg `console.warn(msg, error)` call, so it passes trivially —
a false green). `notCalledMatching((a) => typeof a[0] === "string" &&
a[0].includes("…"))` preserves that test's exact meaning while still
resolving the handle. There is deliberately **no raw `.spy` accessor** —
exposing the underlying mock would let a caller bypass resolution tracking
(assert manually while the registry believes the handle unresolved, or grab
the spy and never assert); the predicate matchers give the same expressive
power _through_ the tracked path. If a genuinely new matcher shape appears
during migration, it is added to the helper as a named method, not via a raw
escape.

### 5.3 Semantics

- `expectConsole(m)` does `vi.spyOn(console, m).mockImplementation(() => {})`
  (suppress output), pushes a handle onto a module-level per-test
  registry, and returns the chainable handle.
- Each matcher method marks the handle resolved **and** runs the
  corresponding `expect(spy)...` assertion — in that order. "Resolved" means
  _a matcher was invoked_ (you asserted), not _the assertion passed_: a
  failing matcher throws and fails the test on its own, after which the
  `afterEach` guard stays silent (test already failed). Marking _after_
  `expect()` would leave a failed matcher's handle unresolved and produce a
  spurious second error — the double-report §7.1 eliminates. Methods are
  chainable so a test can assert more than one property (e.g.
  `.calledTimes(2).nthCalledWith(1, …)`).
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
- **Predicate over recorded calls** (first-arg substring, variable trailing
  args — e.g. `useProjectEditor.test.ts:1081`'s `mock.calls.filter(...)`) →
  `.calledMatching(fn)` / `.notCalledMatching(fn)`. Do **not** flatten these
  into `.notCalledWith`, which silently passes when the arg count differs.
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
- The registry is cleared at the end of each `afterEach` so an unresolved
  handle cannot leak into the next test. The clear is the **first**
  statement of `assertConsoleExpectationsSettled` (`registry.splice(0)`,
  before the spy-restore loop, the `testFailed` check, and any throw), so
  every exit path leaves the registry empty. A _second_ defensive clear at
  `expectConsole()` registration was considered and **deliberately dropped**
  (pushback alignment, 2026-05-30): given the splice-first ordering the leak
  it would guard is unreachable, so it is dead code under the sequential
  suite and actively wrong under `test.concurrent` (it would clear a sibling
  test's live handles — concurrency instead requires keying by
  `currentTestName`, below); worse, a silent self-heal would _mask_ an
  `afterEach`-not-running bug, the exact swallow-the-signal failure this
  phase exists to prevent. The splice-first ordering is pinned as a
  load-bearing invariant in the implementation comment instead.
- Spies are restored in the same `afterEach` (removing the manual
  `mockRestore()` boilerplate the old pattern required).
- **The guard stays quiet when the test already failed.** A test that
  throws (or fails an assertion) before resolving its handle would
  otherwise double-report: the real failure _and_ a spurious
  unresolved-handle error — noise precisely during red-phase TDD and when
  bisecting a regression. So `assertConsoleExpectationsSettled()` takes a
  `testFailed` flag: the global `afterEach` reads `ctx.task.result?.state`
  (`=== "fail"`) — Vitest sets it before user `afterEach` hooks run — and
  passes it in. When it is set the guard restores spies + clears the
  registry **without** throwing. It throws only for a **green-but-unasserted** handle, which is
  the case it exists to catch. The original failure is therefore never
  masked, because the guard does not compete with it. (A test in §8 proves
  both halves: green-but-unasserted → throws; failed-then-unresolved →
  silent, original error intact.)
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
  written during the test). **This case asserts on `process.stderr.write`
  / `process.stdout.write` (which the lint selector does not match), not a
  raw `vi.spyOn(console, …)`** — so `expectConsole.test.ts` stays inside
  the ban with no test-file exemption (the exemption in §7.2 covers only
  `expectConsole.ts`).
- Each matcher passes when the contract holds and fails when it does not
  (`calledWith`, `notCalledWith`, `calledTimes`, `nthCalledWith`,
  `called`, `silent`, `calledMatching`, `notCalledMatching`).
- `assertConsoleExpectationsSettled()` **throws** when a handle is
  unresolved-on-a-passing-test and **does not throw** when all are
  resolved.
- **Non-masking:** when a test fails _and_ leaves a handle unresolved, the
  settle function stays silent (restores + clears, no throw) and the
  original failure is the only error surfaced. Proven by simulating a
  failed-test state and asserting settle does not throw.
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
3. Migrate file-by-file (one commit per file, largest last or first by
   preference). No ESLint rule exists yet, so each commit stays
   `make all`-green on its own without any per-file allowlist. Migrating
   before the rule lands avoids ~15 throwaway config edits (add-then-remove
   per-file disables) that buy nothing — the ban has no value before
   migration completes.
4. Once every file is migrated, add the **total** ESLint ban in a single
   final commit (no path allowlist, ever). A raw spy reappearing anywhere
   now fails lint immediately.
5. CLAUDE.md + roadmap-census doc edits.

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
- No production code or user-facing behavior changed, **except** any
  production-warning bug the audit uncovered — each such fix recorded in
  the phase decision log per CLAUDE.md §Pull Request Scope (§2, §6).

## 13. Risks & mitigations

- **Scope is 3× the roadmap estimate (140 vs 52).** Accepted as one large
  PR; mitigated by per-file commits that each stay green, so review and
  bisect remain tractable.
- **A migration silently changes what a test asserts.** Mitigated by the
  rule that migration changes only console spying; the file's other
  assertions are untouched and `make all` must stay green per commit.
- **Classifying block-level suppressors surfaces real production-warning
  bugs.** Treated as in-scope fix-forward (the suppressor was hiding
  them), recorded in the phase decision log per CLAUDE.md §Pull Request
  Scope (§2). This is the documented exception to the test-only framing,
  not a contradiction of it.
- **`expect.getState()`/concurrency.** Documented constraint; suite is
  sequential today.

## 14. Dependencies

- Phase 4b.3a Cluster A merged (the I1 finding that motivated this phase).
- Independent of Phase 4b.4 (Raw-Strings ESLint Rule); landing 4b.7 first
  is mildly preferred so 4b.4's lint cleanup runs on a contract-clean
  suite, but order is not enforced.
