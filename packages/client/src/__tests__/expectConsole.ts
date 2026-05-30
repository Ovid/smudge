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
  // helper implementation: the one sanctioned raw console spy; everything else
  // routes through here.
  // eslint-disable-next-line no-restricted-syntax -- sole sanctioned raw console spy
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
export function assertConsoleExpectationsSettled(opts?: { testFailed?: boolean }): void {
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
