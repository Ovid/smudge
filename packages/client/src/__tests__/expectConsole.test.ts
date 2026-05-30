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
