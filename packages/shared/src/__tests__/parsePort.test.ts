import { describe, it, expect } from "vitest";
import { parsePort } from "../parsePort";

describe("parsePort", () => {
  it("returns the integer when raw is a clean numeric string", () => {
    expect(parsePort("3456", "TEST_PORT")).toBe(3456);
    expect(parsePort("1", "TEST_PORT")).toBe(1);
    expect(parsePort("65535", "TEST_PORT")).toBe(65535);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parsePort("  3456  ", "TEST_PORT")).toBe(3456);
    expect(parsePort("\t3456\n", "TEST_PORT")).toBe(3456);
  });

  // S1 (review 2026-04-26): Number.parseInt("3456abc", 10) is 3456,
  // which silently passes range and integer checks. The R3 fail-fast
  // intent (typo in .env, accidental shell-comment append, unit suffix)
  // is defeated unless we reject anything that isn't a pure-digit
  // string. These cases are the spec.
  //
  // S1 (review 2026-04-26 039ca1b): leading-zero forms (`"0080"`,
  // `"0123"`) are also rejected. Number.parseInt("0080", 10) returns
  // 80 (decimal), so a stray octal-looking value in .env would have
  // silently bound to a different port. The "clean integer" docstring
  // claim is now enforced — only canonical decimal notation passes.
  it.each([
    ["trailing letters", "3456abc"],
    ["trailing comment", "3456 # comment"],
    // S4 (review 2026-04-26 f346047): trim() only strips leading and
    // trailing whitespace, not internal — `"3456\n# comment"` survives
    // trim and the /^\d+$/ regex catches the non-digit. Pin the
    // rejection so a future change to the trim/regex pipeline (e.g.
    // splitting on the first non-digit) cannot silently start
    // accepting shell-comment styles that resemble a valid port.
    ["trailing newline + comment", "3456\n# comment"],
    ["trailing unit", "3456kb"],
    ["leading sign", "+3456"],
    ["negative", "-1"],
    ["floating point", "3456.5"],
    ["hex", "0xdead"],
    ["empty", ""],
    ["whitespace only", "   "],
    ["only letters", "abc"],
    ["leading zero (octal-looking)", "0080"],
    ["leading zero (small)", "0123"],
    ["multiple leading zeros", "00001"],
  ])("rejects %s (%s)", (_label, raw) => {
    expect(() => parsePort(raw, "TEST_PORT")).toThrow(/TEST_PORT/);
  });

  it("rejects out-of-range integers", () => {
    expect(() => parsePort("0", "TEST_PORT")).toThrow(/TEST_PORT/);
    expect(() => parsePort("65536", "TEST_PORT")).toThrow(/TEST_PORT/);
    expect(() => parsePort("99999", "TEST_PORT")).toThrow(/TEST_PORT/);
  });

  it("includes the env name and the raw value in the error message", () => {
    expect(() => parsePort("3456abc", "SMUDGE_PORT")).toThrow(/SMUDGE_PORT.*3456abc/);
  });
});
