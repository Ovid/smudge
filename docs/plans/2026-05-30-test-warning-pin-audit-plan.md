# Test Warning-Pin Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CLAUDE.md §Testing Philosophy's "spy on console output, suppress it, **and assert the expected message**" rule structurally enforced — the only way to spy on `console` in the client suite becomes a helper that fails the test if an installed spy is never asserted, backed by a runtime guard and a total ESLint ban.

**Architecture:** A new test-infra helper `expectConsole()` installs a suppressing `console` spy and registers a pending expectation; chainable matcher methods run the `expect(...)` assertion **and** mark the handle resolved. A global `afterEach` (`assertConsoleExpectationsSettled`) restores spies and throws if any handle was installed-but-unasserted — unless the test already failed, in which case it stays silent so it never masks the real error. After all 16 census files migrate to the helper, a `no-restricted-syntax` ESLint rule bans raw `vi.spyOn(console, …)` everywhere except the helper itself.

**Tech Stack:** Vitest (`vi.spyOn`, `expect`, `afterEach` TestContext), TypeScript, ESLint flat config (`no-restricted-syntax`), npm workspaces (`packages/client`).

**Source design:** `docs/plans/2026-05-30-test-warning-pin-audit-design.md` (pushback-revised 2026-05-30).

**PR scope:** One cohesive **refactor** (CLAUDE.md §Pull Request Scope). Test-only **except** a production-warning bug the audit uncovers — forward-fixed in this PR and recorded in the phase decision log (design §2, §6, §13).

---

## File Structure

**Created:**
- `packages/client/src/__tests__/expectConsole.ts` — the helper (types, registry, `expectConsole()`, `assertConsoleExpectationsSettled()`). Under `__tests__/`, so excluded from coverage by the root `vitest.config.ts` `coverage.exclude` glob `**/__tests__/**`.
- `packages/client/src/__tests__/expectConsole.test.ts` — unit tests for the helper.

**Modified:**
- `packages/client/src/__tests__/setup.ts` — add the global `afterEach` guard.
- `eslint.config.js` — append one `no-restricted-syntax` selector to the **existing client-block array** (added in the final migration commit, no path allowlist).
- The 16 census test files — migrate every `vi.spyOn(console, …)` to `expectConsole()`.
- `CLAUDE.md` — §Testing Philosophy "Zero warnings" paragraph.
- `docs/roadmap.md` — correct the 4b.7 census row (52/9 → 140/16).

**Census (re-verify at implementation start — `grep -rnE 'vi\.spyOn\(console' packages/client/src`):**

| Installs | File | Shape notes |
| --- | --- | --- |
| 69 | `__tests__/useProjectEditor.test.ts` | per-test; **predicate site at :1081** (`mock.calls.filter`); abort-silence `notCalledWith` at :1337 |
| 15 | `__tests__/EditorPageFeatures.test.tsx` | per-test |
| 12 | `hooks/useEditorMutation.test.tsx` | per-test |
| 10 | `__tests__/HomePage.test.tsx` | per-test |
| 9 | `__tests__/DashboardView.test.tsx` | per-test |
| 4 | `__tests__/ProjectSettingsDialog.test.tsx` | per-test |
| 4 | `errors/clientLog.test.ts` | per-test; tests the logger itself |
| 3 | `__tests__/useSnapshotState.test.ts` | per-test |
| 3 | `errors/devWarn.test.ts` | per-test; tests the logger itself |
| 2 | `__tests__/useTrashManager.test.ts` | **BLOCK-LEVEL `beforeEach` suppressor** (warn+error) — eliminate |
| 2 | `__tests__/ExportDialog.test.tsx` | per-test (warn+error pair per test) |
| 2 | `hooks/useAbortableSequence.test.ts` | per-test |
| 2 | `hooks/useAbortableAsyncOperation.test.ts` | per-test |
| 1 | `__tests__/useContentCache.test.ts` | **BLOCK-LEVEL `beforeEach` suppressor** (warn) — eliminate |
| 1 | `__tests__/editorSafeOps.test.ts` | per-test |
| 1 | `errors/apiErrorMapper.test.ts` | per-test |

---

## Task 1: `expectConsole` helper — core install + fixed matchers

**Files:**
- Create: `packages/client/src/__tests__/expectConsole.ts`
- Test: `packages/client/src/__tests__/expectConsole.test.ts`

- [ ] **Step 1: Write the failing test** (`expectConsole.test.ts`)

```ts
import { describe, it, expect, vi } from "vitest";
import {
  expectConsole,
  assertConsoleExpectationsSettled,
  type ConsoleMethod,
} from "./expectConsole";

// NOTE: this file deliberately drives the registry by hand (calling
// assertConsoleExpectationsSettled directly) to prove the guard in isolation.
// It must NOT use a raw `vi.spyOn(console, …)` — the suppression proof below
// spies process.stderr instead (design §8, Finding 4a), keeping the file
// inside the lint ban with no test-file exemption.

describe("expectConsole — fixed matchers", () => {
  it("calledWith passes when console was called with those args", () => {
    const h = expectConsole("warn");
    console.warn("boom", 1);
    h.calledWith("boom", 1);
    assertConsoleExpectationsSettled(); // resolved → no throw
  });

  it("silent passes when console was never called", () => {
    const h = expectConsole("error");
    h.silent();
    assertConsoleExpectationsSettled();
  });

  it("calledTimes and nthCalledWith chain on one handle", () => {
    const h = expectConsole("warn");
    console.warn("a");
    console.warn("b");
    h.calledTimes(2).nthCalledWith(1, "a");
    assertConsoleExpectationsSettled();
  });

  it("notCalledWith passes when that exact arg list never occurred", () => {
    const h = expectConsole("warn");
    console.warn("present");
    h.notCalledWith("absent");
    assertConsoleExpectationsSettled();
  });

  it("called passes when console fired at least once", () => {
    const h = expectConsole("log");
    console.log("x");
    h.called();
    assertConsoleExpectationsSettled();
  });

  // §8: EVERY matcher must fail when its contract is violated, not only pass
  // when it holds. A wrong polarity (e.g. silent calling toHaveBeenCalled
  // instead of not.toHaveBeenCalled) would otherwise pass silently.
  it("calledWith FAILS when those args never occurred", () => {
    const h = expectConsole("warn");
    expect(() => h.calledWith("nope")).toThrow(); // never called
    assertConsoleExpectationsSettled(); // resolved (matcher ran)
  });

  it("silent FAILS when console WAS called", () => {
    const h = expectConsole("warn");
    console.warn("noise");
    expect(() => h.silent()).toThrow();
    assertConsoleExpectationsSettled();
  });

  it("notCalledWith FAILS when that exact arg list DID occur", () => {
    const h = expectConsole("warn");
    console.warn("present", 1);
    expect(() => h.notCalledWith("present", 1)).toThrow();
    assertConsoleExpectationsSettled();
  });

  it("calledTimes FAILS on the wrong count", () => {
    const h = expectConsole("warn");
    console.warn("once");
    expect(() => h.calledTimes(2)).toThrow();
    assertConsoleExpectationsSettled();
  });

  it("nthCalledWith FAILS on the wrong nth args", () => {
    const h = expectConsole("warn");
    console.warn("a");
    console.warn("b");
    expect(() => h.nthCalledWith(1, "b")).toThrow();
    assertConsoleExpectationsSettled();
  });

  it("called FAILS when console never fired", () => {
    const h = expectConsole("warn");
    expect(() => h.called()).toThrow();
    assertConsoleExpectationsSettled();
  });

  it("calledMatching FAILS when no call satisfies the predicate", () => {
    const h = expectConsole("warn");
    console.warn("unrelated");
    expect(() => h.calledMatching((a) => a[0] === "target")).toThrow();
    assertConsoleExpectationsSettled();
  });

  it("suppresses real console output (asserted via process.stderr, not a console spy)", () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const h = expectConsole("warn");
    console.warn("should be swallowed");
    expect(stderrSpy).not.toHaveBeenCalled();
    h.called();
    stderrSpy.mockRestore();
    assertConsoleExpectationsSettled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/client -- expectConsole`
Expected: FAIL — `Cannot find module './expectConsole'` / `expectConsole is not a function`.

- [ ] **Step 3: Write minimal implementation** (`expectConsole.ts`)

```ts
import { expect, vi, type MockInstance } from "vitest";

export type ConsoleMethod = "log" | "info" | "warn" | "error" | "debug";

interface Handle {
  method: ConsoleMethod;
  spy: MockInstance;
  resolved: boolean;
}

// Module-level, per-test registry. Cleared in assertConsoleExpectationsSettled
// (run from the global afterEach), so it cannot leak across tests. This
// assumes sequential tests within a file; the client suite does not use
// test.concurrent. If concurrency is ever introduced, key by
// expect.getState().currentTestName (design §7.1).
const registry: Handle[] = [];

export interface ConsoleExpectation {
  /** Assert called with exactly these args (vitest matchers allowed). Resolves. */
  calledWith(...args: unknown[]): ConsoleExpectation;
  /** Assert NOT called with these args. Resolves. */
  notCalledWith(...args: unknown[]): ConsoleExpectation;
  /** Assert called exactly n times. Resolves. */
  calledTimes(n: number): ConsoleExpectation;
  /** Assert the nth (1-based) call's args. Resolves. */
  nthCalledWith(n: number, ...args: unknown[]): ConsoleExpectation;
  /** Assert called at least once, args unspecified. Resolves. */
  called(): ConsoleExpectation;
  /** Assert never called. Resolves. */
  silent(): ConsoleExpectation;
  /** Assert >=1 recorded call satisfies the predicate (full arg array). Resolves. */
  calledMatching(fn: (args: unknown[]) => boolean): ConsoleExpectation;
  /** Assert NO recorded call satisfies the predicate. Resolves. */
  notCalledMatching(fn: (args: unknown[]) => boolean): ConsoleExpectation;
}

export function expectConsole(method: ConsoleMethod): ConsoleExpectation {
  if (registry.some((h) => h.method === method)) {
    throw new Error(
      `expectConsole("${method}") was called twice in one test. ` +
        `Spy on each console method at most once per test.`,
    );
  }
  // eslint-disable-next-line no-restricted-syntax -- helper implementation: the
  // one sanctioned raw console spy; everything else routes through here.
  const spy = vi.spyOn(console, method).mockImplementation(() => {});
  const handle: Handle = { method, spy, resolved: false };
  registry.push(handle);

  // Each matcher marks the handle resolved BEFORE running expect(). The guard
  // tracks "did you assert?", not "did the assertion pass?" — a failing matcher
  // throws and fails the test on its own, and the afterEach guard then stays
  // silent (testFailed). Marking after expect() would leave a failed matcher's
  // handle unresolved, producing a spurious second error (the very
  // double-report Finding 3 eliminates).
  const resolve = () => {
    handle.resolved = true;
    return api;
  };
  const api: ConsoleExpectation = {
    calledWith(...args) {
      resolve();
      expect(spy).toHaveBeenCalledWith(...args);
      return api;
    },
    notCalledWith(...args) {
      resolve();
      expect(spy).not.toHaveBeenCalledWith(...args);
      return api;
    },
    calledTimes(n) {
      resolve();
      expect(spy).toHaveBeenCalledTimes(n);
      return api;
    },
    nthCalledWith(n, ...args) {
      resolve();
      expect(spy).toHaveBeenNthCalledWith(n, ...args);
      return api;
    },
    called() {
      resolve();
      expect(spy).toHaveBeenCalled();
      return api;
    },
    silent() {
      resolve();
      expect(spy).not.toHaveBeenCalled();
      return api;
    },
    calledMatching(fn) {
      resolve();
      expect(spy.mock.calls.some((c) => fn(c))).toBe(true);
      return api;
    },
    notCalledMatching(fn) {
      resolve();
      expect(spy.mock.calls.some((c) => fn(c))).toBe(false);
      return api;
    },
  };
  return api;
}

/**
 * Restore all spies and clear the registry. Throw if any handle was installed
 * but never asserted — UNLESS the test already failed (opts.testFailed), in
 * which case stay silent so the guard never competes with the real failure
 * (design §7.1, Finding 3). Safe to call with no args (treats testFailed as
 * false); the global afterEach passes the real signal.
 */
export function assertConsoleExpectationsSettled(opts?: {
  testFailed?: boolean;
}): void {
  // INVARIANT (load-bearing): splice(0) MUST be the first statement. Clearing
  // the registry before the restore loop, the testFailed check, and any throw
  // guarantees every exit path leaves the registry empty — so a handle can
  // never leak into the next test, which is why no defensive clear is needed at
  // expectConsole() registration (design §7.1). Do not move it below a throwable
  // statement: that would resurrect the leak this ordering rules out.
  const handles = registry.splice(0);
  for (const h of handles) h.spy.mockRestore();
  if (opts?.testFailed) return;
  const unresolved = handles.filter((h) => !h.resolved);
  if (unresolved.length > 0) {
    const methods = unresolved.map((h) => h.method).join(", ");
    throw new Error(
      `${unresolved.length} console expectation(s) installed but never asserted: ` +
        `${methods}. Every expectConsole() must be resolved with a matcher ` +
        `(CLAUDE.md §Testing Philosophy).`,
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w packages/client -- expectConsole`
Expected: PASS (all fixed-matcher + suppression tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/__tests__/expectConsole.ts packages/client/src/__tests__/expectConsole.test.ts
git commit -m "test(4b.7): expectConsole helper — install + fixed matchers"
```

---

## Task 2: Predicate matchers `calledMatching` / `notCalledMatching`

The interface already declares these (Task 1) and the implementation already includes them. This task **proves** them and locks in the `useProjectEditor.test.ts:1081` use case (design §5.2, Finding 1).

**Files:**
- Test: `packages/client/src/__tests__/expectConsole.test.ts` (add a describe block)

- [ ] **Step 1: Write the failing test**

```ts
describe("expectConsole — predicate matchers", () => {
  it("notCalledMatching passes when no call's first arg contains the substring", () => {
    const h = expectConsole("warn");
    console.warn("unrelated message", new Error("x"));
    h.notCalledMatching(
      (a) =>
        typeof a[0] === "string" &&
        a[0].includes("Failed to load chapter after delete"),
    );
    assertConsoleExpectationsSettled();
  });

  it("notCalledMatching FAILS when a matching call exists (the false-green that notCalledWith would have missed)", () => {
    const h = expectConsole("warn");
    // Two-arg call — a one-arg notCalledWith(stringContaining) would pass
    // trivially here; notCalledMatching must catch it.
    console.warn("Failed to load chapter after delete", new Error("x"));
    expect(() =>
      h.notCalledMatching(
        (a) =>
          typeof a[0] === "string" &&
          a[0].includes("Failed to load chapter after delete"),
      ),
    ).toThrow();
    assertConsoleExpectationsSettled();
  });

  it("calledMatching passes when at least one call satisfies the predicate", () => {
    const h = expectConsole("error");
    console.error("prefix: detail", 42);
    h.calledMatching((a) => typeof a[0] === "string" && a[0].startsWith("prefix:"));
    assertConsoleExpectationsSettled();
  });
});
```

- [ ] **Step 2: Run test to verify it passes** (implementation already present from Task 1)

Run: `npm test -w packages/client -- expectConsole`
Expected: PASS. (If RED, the predicate methods are missing/incorrect in `expectConsole.ts` — add them per Task 1 Step 3.)

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/__tests__/expectConsole.test.ts
git commit -m "test(4b.7): expectConsole predicate matchers (covers mock.calls.filter site)"
```

---

## Task 3: Settle guard — double-spy throw, unresolved throw, non-masking silence

**Files:**
- Test: `packages/client/src/__tests__/expectConsole.test.ts` (add a describe block)

- [ ] **Step 1: Write the failing test**

```ts
describe("assertConsoleExpectationsSettled — guard semantics", () => {
  it("throws when a handle is installed but never asserted (passing test)", () => {
    expectConsole("warn"); // never resolved
    expect(() => assertConsoleExpectationsSettled()).toThrow(
      /installed but never asserted/,
    );
    // settle already spliced+restored, so the global afterEach sees an empty
    // registry and does not double-fire.
  });

  it("does NOT throw on an unresolved handle when the test already failed (non-masking)", () => {
    expectConsole("warn"); // never resolved
    expect(() =>
      assertConsoleExpectationsSettled({ testFailed: true }),
    ).not.toThrow();
  });

  it("throwing the same method twice in one test fails immediately", () => {
    const h = expectConsole("warn");
    expect(() => expectConsole("warn")).toThrow(/called twice/);
    h.silent(); // resolve the first handle so this test stays clean
    assertConsoleExpectationsSettled();
  });

  it("restores the original console method after settle", () => {
    const original = console.warn;
    const h = expectConsole("warn");
    expect(console.warn).not.toBe(original); // replaced by suppressing spy
    h.silent();
    assertConsoleExpectationsSettled();
    expect(console.warn).toBe(original); // restored
  });
});
```

- [ ] **Step 2: Run test to verify it passes** (logic already present from Task 1)

Run: `npm test -w packages/client -- expectConsole`
Expected: PASS. (If the non-masking test is RED, `assertConsoleExpectationsSettled` is missing the `if (opts?.testFailed) return;` early-out — add it per Task 1 Step 3.)

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/__tests__/expectConsole.test.ts
git commit -m "test(4b.7): settle guard — double-spy, unresolved throw, non-masking"
```

---

## Task 4: Wire the global `afterEach` guard into `setup.ts`

**Files:**
- Modify: `packages/client/src/__tests__/setup.ts`

**Wiring is verified behaviorally, not by reading `setup.ts` as text** (alignment Finding C). §8's "exercise settle directly" is already satisfied by Tasks 1–3. The live `afterEach` is proven two ways: (a) every helper test that installs `expectConsole()` and resolves it passes — meaning the global guard ran and did not spuriously fail it; (b) a dedicated behavioral test that drives the guard through a real (inner) lifecycle.

- [ ] **Step 1: Write the failing behavioral test** (`expectConsole.test.ts`)

```ts
import { afterEach } from "vitest";

describe("global afterEach wiring", () => {
  // A nested describe with its OWN afterEach that mirrors setup.ts, proving the
  // wired guard fails a green-but-unasserted test and stays silent on failure.
  // (We cannot assert the project-level afterEach fails *this* test without
  // failing it for real, so we exercise an equivalent local registration.)
  describe("guard behavior under a real afterEach", () => {
    let captured: Error | null = null;
    afterEach((ctx) => {
      try {
        assertConsoleExpectationsSettled({
          testFailed: ctx.task.result?.state === "fail",
        });
      } catch (e) {
        captured = e as Error; // capture instead of throw so we can assert it
      }
    });

    it("captures an unresolved-handle error from the afterEach", () => {
      expectConsole("warn"); // deliberately not resolved
      // assertion happens in the NEXT test, after this afterEach runs
    });

    it("the prior test's afterEach raised the unresolved-handle error", () => {
      expect(captured).toBeInstanceOf(Error);
      expect(captured?.message).toMatch(/installed but never asserted/);
      captured = null;
    });
  });

  it("a normally-resolved handle leaves the project afterEach a no-op", () => {
    expectConsole("warn").silent(); // resolved → global guard must not fail us
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/client -- expectConsole`
Expected: FAIL — the final test (`leaves the project afterEach a no-op`) errors because `setup.ts` does not yet register the global guard, OR passes trivially if it does not. Confirm the behavioral wiring test is red against an un-wired `setup.ts`. (If the nested-afterEach test already passes, that only proves the local mirror; the project-level wiring still needs Step 3.)

- [ ] **Step 3: Write minimal implementation** — append to `setup.ts`

```ts
import { afterEach } from "vitest";
import { assertConsoleExpectationsSettled } from "./expectConsole";

// Runtime backstop for CLAUDE.md §Testing Philosophy: any expectConsole()
// installed but never asserted fails the test. ctx.task.result?.state tells us
// whether the test already failed, so the guard stays silent on real failures
// (non-masking, design §7.1) and only fires on green-but-unasserted handles.
afterEach((ctx) => {
  assertConsoleExpectationsSettled({
    testFailed: ctx.task.result?.state === "fail",
  });
});
```

(Place the two `import` lines at the top of `setup.ts` with the existing import; ESLint's `import/first` requires imports before other statements.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w packages/client -- expectConsole`
Expected: PASS. Then run the **full** client suite to confirm the new afterEach does not break existing tests (no existing test uses `expectConsole`, so the registry is always empty → guard is a no-op):

Run: `npm test -w packages/client`
Expected: PASS, unchanged count, zero new warnings.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/__tests__/setup.ts packages/client/src/__tests__/expectConsole.test.ts
git commit -m "test(4b.7): wire assertConsoleExpectationsSettled into global afterEach"
```

---

## Migration recipe (applies to Tasks 5–20)

For **every** `vi.spyOn(console, M)` site, delete the manual spy + `mockRestore()` and replace with `expectConsole("M")…`, classified per design §6:

| Old pattern | New pattern |
| --- | --- |
| `const s = vi.spyOn(console,"warn").mockImpl(()=>{}); … expect(s).toHaveBeenCalledWith(a,b); … s.mockRestore();` | `const s = expectConsole("warn"); … s.calledWith(a,b);` |
| `… expect(s).not.toHaveBeenCalled(); s.mockRestore();` (defensive, never fires) | `expectConsole("warn").silent();` |
| `… expect(s).not.toHaveBeenCalledWith(msg, x); s.mockRestore();` | `expectConsole("warn").notCalledWith(msg, x);` |
| `s.mock.calls.filter(pred)` + `expect(...).toEqual([])` | `expectConsole("warn").notCalledMatching(pred)` |
| `expect(s).toHaveBeenCalledTimes(n)` / `toHaveBeenNthCalledWith(n,…)` | `.calledTimes(n)` / `.nthCalledWith(n,…)` (chain on one handle) |

**Mechanical rules:**
1. Drop every `s.mockRestore()` — the global afterEach restores.
2. Each handle must reach **at least one** matcher before the test ends, or the guard fails it. Choose the matcher that matches what the test actually proves; do not weaken a real assertion to `.silent()` to make it pass.
3. If a test installs **two** methods (warn + error), call `expectConsole("warn")` and `expectConsole("error")` separately and resolve both.
4. Remove now-unused `vi`/`MockInstance` imports only if nothing else in the file needs them.
5. **Do not change any non-console assertion.** Migration touches console spying only (design §13).
6. **Block-level `beforeEach` suppressors:** delete the `beforeEach`/`afterEach` spy pair; add an explicit `expectConsole(...)` to **each** test in the block (`.calledWith`/`.calledMatching` where a warning is expected, `.silent()` where none should fire). No sanctioned block-level suppressor survives (design §4, §6).
7. **Fix-forward clause:** if classifying a site shows the production warning is wrong or missing, fix the production code in this PR and record it in the phase decision log (design §2/§6). Note it in the commit body.

**Per-file loop (every migration task uses these steps):**

- [ ] Re-grep the file: `grep -nE 'vi\.spyOn\(console' <file>`
- [ ] Replace each site per the recipe; handle the special sites called out in the task.
- [ ] Run the file green: `npm test -w packages/client -- <basename-without-ext>` → Expected: PASS, zero warnings.
- [ ] Commit: `git add <file> && git commit -m "test(4b.7): migrate <basename> to expectConsole"`

Migrate **smallest → largest** to build confidence; `useProjectEditor.test.ts` (69) is last.

---

## Task 5: Migrate `errors/apiErrorMapper.test.ts` (1)

**Files:** Modify `packages/client/src/errors/apiErrorMapper.test.ts`

- [ ] Apply the per-file loop. Single per-test site. Worked example:

```ts
// BEFORE
const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
// … exercise …
expect(warnSpy).toHaveBeenCalledWith("…", expect.any(Error));
warnSpy.mockRestore();

// AFTER
const warn = expectConsole("warn");
// … exercise …
warn.calledWith("…", expect.any(Error));
```

Add `import { expectConsole } from "../__tests__/expectConsole";` (adjust relative depth: `errors/` → `../__tests__/expectConsole`).
- [ ] Run: `npm test -w packages/client -- apiErrorMapper` → PASS.
- [ ] Commit.

---

## Task 6: Migrate `__tests__/editorSafeOps.test.ts` (1)

**Files:** Modify `packages/client/src/__tests__/editorSafeOps.test.ts`
Import path: `./expectConsole` (same dir).
- [ ] Apply the per-file loop (single site).
- [ ] Run: `npm test -w packages/client -- editorSafeOps` → PASS. Commit.

---

## Task 7: Migrate `__tests__/useContentCache.test.ts` (1) — **BLOCK-LEVEL**

**Files:** Modify `packages/client/src/__tests__/useContentCache.test.ts`

This file installs `warnSpy` in a `beforeEach` (lines ~31–34) and restores in `afterEach` (~37). **Eliminate the block-level suppressor.**

- [ ] **Delete** the `beforeEach` spy install + `afterEach` `mockRestore()` + the `warnSpy`/`MockInstance` declarations.
- [ ] In **each** `it(...)` in the describe block, add the explicit expectation:
  - Tests that exercise the warn path: `const warn = expectConsole("warn"); … warn.calledWith(...)` (or `.calledMatching` / `.called`).
  - Tests where no warn should fire: `expectConsole("warn").silent();`
- [ ] Inspect what each test actually triggers (read the hook's warn call site) to pick the right matcher — do not blanket `.silent()`.
- [ ] Run: `npm test -w packages/client -- useContentCache` → PASS, zero warnings. Commit.

---

## Task 8: Migrate `hooks/useAbortableAsyncOperation.test.ts` (2)

**Files:** Modify `packages/client/src/hooks/useAbortableAsyncOperation.test.ts`
Import path: `../__tests__/expectConsole`.
- [ ] Apply the per-file loop (2 per-test sites). Commit after green.

---

## Task 9: Migrate `hooks/useAbortableSequence.test.ts` (2)

**Files:** Modify `packages/client/src/hooks/useAbortableSequence.test.ts`
Import path: `../__tests__/expectConsole`.
- [ ] Apply the per-file loop (2 sites). Commit after green.

---

## Task 10: Migrate `__tests__/ExportDialog.test.tsx` (2)

**Files:** Modify `packages/client/src/__tests__/ExportDialog.test.tsx`

Each affected test installs a **warn + error pair** (e.g. lines ~380–381) that are defensive (guarding against image-list failure noise). Classify each:
- If the failure path genuinely logs → `.called()` / `.calledWith(...)`.
- If on inspection nothing logs → `.silent()`.

```ts
// BEFORE
const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
// … render with api.images.list rejecting …

// AFTER (example — verify which actually fire by reading the component)
const warn = expectConsole("warn");
const error = expectConsole("error");
// … render with api.images.list rejecting …
error.called();   // images.list failure is logged via clientError
warn.silent();    // no warn on this path
```

- [ ] Apply the per-file loop. Run: `npm test -w packages/client -- ExportDialog` → PASS. Commit.

---

## Task 11: Migrate `errors/devWarn.test.ts` (3)

**Files:** Modify `packages/client/src/errors/devWarn.test.ts`
Import path: `../__tests__/expectConsole`.

This tests the `devWarn` logger itself. Likely shapes: "warns in DEV" → `.calledWith(...)`; "silent when aborted / in prod" → `.silent()` or `.notCalledWith(...)`. Preserve each test's exact intent.
- [ ] Apply the per-file loop. Run: `npm test -w packages/client -- devWarn` → PASS. Commit.

---

## Task 12: Migrate `__tests__/useSnapshotState.test.ts` (3)

**Files:** Modify `packages/client/src/__tests__/useSnapshotState.test.ts`
Import path: `./expectConsole`.
- [ ] Apply the per-file loop (3 sites). Commit after green.

---

## Task 13: Migrate `errors/clientLog.test.ts` (4)

**Files:** Modify `packages/client/src/errors/clientLog.test.ts`
Import path: `../__tests__/expectConsole`.

Tests the `clientWarn`/`clientError` loggers themselves. Expect a mix of `.calledWith(...)` (DEV-gated logging fires) and `.silent()` (prod-gated / no-op). Preserve intent.
- [ ] Apply the per-file loop. Run: `npm test -w packages/client -- clientLog` → PASS. Commit.

---

## Task 14: Migrate `__tests__/ProjectSettingsDialog.test.tsx` (4)

**Files:** Modify `packages/client/src/__tests__/ProjectSettingsDialog.test.tsx`
Import path: `./expectConsole`.
- [ ] Apply the per-file loop (4 sites). Commit after green.

---

## Task 15: Migrate `__tests__/DashboardView.test.tsx` (9)

**Files:** Modify `packages/client/src/__tests__/DashboardView.test.tsx`
Import path: `./expectConsole`.
- [ ] Apply the per-file loop (9 sites). Commit after green.

---

## Task 16: Migrate `__tests__/HomePage.test.tsx` (10)

**Files:** Modify `packages/client/src/__tests__/HomePage.test.tsx`
Import path: `./expectConsole`.
- [ ] Apply the per-file loop (10 sites). Commit after green.

---

## Task 17: Migrate `hooks/useEditorMutation.test.tsx` (12)

**Files:** Modify `packages/client/src/hooks/useEditorMutation.test.tsx`
Import path: `../__tests__/expectConsole`.
- [ ] Apply the per-file loop (12 sites). Commit after green.

---

## Task 18: Migrate `__tests__/EditorPageFeatures.test.tsx` (15)

**Files:** Modify `packages/client/src/__tests__/EditorPageFeatures.test.tsx`
Import path: `./expectConsole`.
- [ ] Apply the per-file loop (15 sites). Commit after green.

---

## Task 19: Migrate `__tests__/useTrashManager.test.ts` (2) — **BLOCK-LEVEL**

**Files:** Modify `packages/client/src/__tests__/useTrashManager.test.ts`
Import path: `./expectConsole`.

Lines ~55–68 install a `beforeEach` warn+error suppressor and restore in `afterEach`. **Eliminate it.**

```ts
// DELETE this whole block (and the warnSpy/errorSpy/MockInstance declarations):
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});
```

- [ ] **Keep** the `vi.clearAllMocks()` — move it into a `beforeEach(() => { vi.clearAllMocks(); })` (it is unrelated to console).
- [ ] In **each** `it(...)` of the block (e.g. the `handleRestore — I2 committed UX` describe), add explicit expectations. The hook logs `console.error` on failure paths — for tests that hit a failure path (`RESTORE_READ_FAILURE`, `2xx BAD_JSON`), assert the error fires:

```ts
const error = expectConsole("error");
// … drive handleRestore into the committed/failure branch …
error.called(); // or .calledWith(...) matching the hook's log site
```
For tests where no console output should occur, add `expectConsole("error").silent();` (and `"warn"` likewise if the test previously relied on the block suppressing warn).
- [ ] Read each test to decide warn-vs-error and called-vs-silent; do not blanket-suppress.
- [ ] Run: `npm test -w packages/client -- useTrashManager` → PASS, zero warnings. Commit.

---

## Task 20: Migrate `__tests__/useProjectEditor.test.ts` (69) — largest, special sites

**Files:** Modify `packages/client/src/__tests__/useProjectEditor.test.ts`
Import path: `./expectConsole`.

Bulk per-test sites follow the recipe. Two special sites:

**Predicate site (~:1081)** — `mock.calls.filter`:

```ts
// BEFORE
const failedAfterDelete = warnSpy.mock.calls.filter(
  (call) =>
    typeof call[0] === "string" &&
    call[0].includes("Failed to load chapter after delete"),
);
expect(failedAfterDelete).toEqual([]);
warnSpy.mockRestore();

// AFTER
warn.notCalledMatching(
  (a) =>
    typeof a[0] === "string" &&
    a[0].includes("Failed to load chapter after delete"),
);
```
(where `const warn = expectConsole("warn");` replaced the install at the top of that test).

**Abort-silence site (~:1337)** — already `not.toHaveBeenCalledWith`:

```ts
// BEFORE
expect(warnSpy).not.toHaveBeenCalledWith(
  "handleCreateChapter recovery GET failed:",
  expect.anything(),
);
warnSpy.mockRestore();

// AFTER
warn.notCalledWith(
  "handleCreateChapter recovery GET failed:",
  expect.anything(),
);
```

- [ ] Work through all 69 sites in file order; commit once for the whole file (it is one logical unit). Because this is the largest file, optionally stage in chunks but land a single commit so the file is migrated atomically.
- [ ] Run: `npm test -w packages/client -- useProjectEditor` → PASS, zero warnings.
- [ ] Run the **full** client suite to confirm nothing regressed: `npm test -w packages/client` → PASS.
- [ ] Commit: `git commit -m "test(4b.7): migrate useProjectEditor to expectConsole (incl. predicate site)"`

---

## Task 21: Add the total ESLint ban (no allowlist)

**Files:** Modify `eslint.config.js`

At this point **zero** raw `vi.spyOn(console, …)` remain outside `expectConsole.ts`. Add the ban as the **final** migration commit (design §11, Finding 4b — migrate-all-then-ban-last, no per-file allowlist).

- [ ] **Step 1: Verify the tree is clean first**

Run: `grep -rnE 'vi\.spyOn\(console' packages/client/src | grep -v 'expectConsole.ts'`
Expected: **no output** (only `expectConsole.ts` contains the raw call, and it carries the inline disable from Task 1).

- [ ] **Step 2: Append the selector to the existing client-block `no-restricted-syntax` array**

In `eslint.config.js`, the client block (`files: ["packages/client/**/*.{ts,tsx}"]`) already holds a `no-restricted-syntax` array (seq-ref + raw-strings selectors). **Append** this object before the array's closing `]` (do **not** create a second `no-restricted-syntax` in a separate block — ESLint flat-config would have the later block override this one for test files):

```js
{
  // Phase 4b.7: ban raw console spies. Every console spy must route through
  // expectConsole() (packages/client/src/__tests__/expectConsole.ts), which
  // makes "installed ⇒ asserted" a structural invariant (CLAUDE.md §Testing
  // Philosophy). The helper file itself carries the sole inline exemption.
  selector:
    "CallExpression[callee.object.name='vi'][callee.property.name='spyOn'][arguments.0.name='console']",
  message:
    "Spy on console via expectConsole() from src/__tests__/expectConsole.ts (CLAUDE.md §Testing Philosophy). Raw console spies must be asserted; the helper enforces it.",
},
```

- [ ] **Step 3: Run lint to verify the ban is active and the tree passes**

Run: `npm run lint -w packages/client` (or `make lint`)
Expected: PASS — the only raw spy (`expectConsole.ts`) is exempted inline; no other site trips the rule. If any other file errors, it was missed in migration — go back and migrate it.

- [ ] **Step 4: Prove the rule actually fires** (guard against a dead selector)

Temporarily add `vi.spyOn(console, "warn")` to any test file, run `npm run lint -w packages/client`, confirm it errors with the new message, then **revert** the temporary line.

- [ ] **Step 5: Run the full pipeline**

Run: `make all`
Expected: lint + format + typecheck + coverage + e2e all green; coverage ≥ 95/85/90/95; zero test warnings.

- [ ] **Step 6: Commit**

```bash
git add eslint.config.js
git commit -m "test(4b.7): ban raw vi.spyOn(console) — expectConsole is now total"
```

---

## Task 22: Update CLAUDE.md §Testing Philosophy

**Files:** Modify `CLAUDE.md` (§Testing Philosophy, "Zero warnings in test output" paragraph)

- [ ] **Step 1: Replace the manual-snippet guidance** with `expectConsole()` as canonical (design §9). Keep the principle text ("Noisy test output masks real problems…"). New paragraph:

```markdown
**Zero warnings in test output.** Tests must not produce noisy `console.warn`,
`console.error`, or logger output in stderr. In the **client** suite, spy on
console **only** via `expectConsole()`
(`packages/client/src/__tests__/expectConsole.ts`): it installs a suppressing
spy and registers a pending expectation, and each matcher
(`calledWith`/`notCalledWith`/`calledTimes`/`nthCalledWith`/`called`/`silent`/
`calledMatching`/`notCalledMatching`) both asserts **and** marks the
expectation resolved — e.g.
`expectConsole("warn").calledWith("…", expect.any(Error));`. Raw
`vi.spyOn(console, …)` is **banned by ESLint** (the helper file is the sole
exemption), and a global `afterEach` (`assertConsoleExpectationsSettled`) fails
any test that installs an expectation but never asserts it — so a suppressed
warning can never silently drift. Noisy test output masks real problems; if
every test run has 30 "expected" warnings, developers stop reading them and
miss the 31st that signals a real bug.
```

- [ ] **Step 2: Verify no stale reference** to the old `warnSpy.mockRestore()` snippet remains in CLAUDE.md.

Run: `grep -n "mockRestore" CLAUDE.md`
Expected: no output (the old snippet is gone).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(4b.7): expectConsole is the canonical console-spy pattern"
```

---

## Task 23: Correct the roadmap census row

**Files:** Modify `docs/roadmap.md`

- [ ] **Step 1: Update the 4b.7 row + §Scope table** from "52 console-spy installs across 9 client test files" to the real census "140 installs across 16 files" (design §3, §10). (The `<!-- plan: -->` comment and Phase Structure status flip are owned by the /roadmap flow, not this task.)

Run: `grep -n "52" docs/roadmap.md` to locate the stale count; replace each 4b.7 occurrence with the corrected figure.

- [ ] **Step 2: Commit**

```bash
git add docs/roadmap.md
git commit -m "docs(4b.7): correct census — 140 installs across 16 files"
```

---

## Self-Review

**Spec coverage (design §§1–14):**
- §1 Goal (structural enforcement) → Tasks 1–4, 21.
- §3 Corrected census → re-grep in every per-file task; §10/Task 23.
- §4 Three spy shapes + block-level elimination → Migration recipe rule 6; Tasks 7, 19.
- §5 Helper location/API/semantics → Task 1; predicate matchers → Task 2.
- §6 Per-site classification → Migration recipe table; special sites Tasks 10, 19, 20.
- §7.1 Runtime guard + non-masking → Tasks 3, 4.
- §7.2 Lint ban (total, no allowlist) → Task 21.
- §8 Testing the helper (incl. stderr-spy suppression, non-masking) → Tasks 1–3.
- §9 CLAUDE.md update → Task 22.
- §10 Roadmap census → Task 23.
- §11 Commit sequence (migrate-then-ban-last) → Tasks 5–21 ordering.
- §12 Definition of Done → `make all` in Task 21 Step 5.
- §13 Risks (no assertion change; fix-forward) → Migration recipe rules 5, 7.
- §14 Dependencies → none block; 4b.3a already merged.

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N" — recipe is concrete; per-file tasks carry counts, import paths, and special-site code. Bulk identical sites are covered by the explicit recipe table rather than 140 literal diffs (mechanical repetition, design-sanctioned).

**Type consistency:** `ConsoleMethod`, `ConsoleExpectation`, `expectConsole`, `assertConsoleExpectationsSettled({ testFailed })` are named identically across Tasks 1–4 and the migration tasks. Matcher names (`calledWith`/`notCalledWith`/`calledTimes`/`nthCalledWith`/`called`/`silent`/`calledMatching`/`notCalledMatching`) match the design §5.2 interface and the CLAUDE.md update in Task 22.

**Open verification for the implementer:** confirm `ctx.task.result?.state` is populated at `afterEach` time in the installed vitest version (Task 4). If not, fall back to `expect.getState()`'s failed-assertion signal; either realizes design §7.1's intent (the guard must not throw on an already-failed test).
