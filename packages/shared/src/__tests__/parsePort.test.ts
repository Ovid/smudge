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
  it.each([
    ["trailing letters", "3456abc"],
    ["trailing comment", "3456 # comment"],
    ["trailing unit", "3456kb"],
    ["leading sign", "+3456"],
    ["negative", "-1"],
    ["floating point", "3456.5"],
    ["hex", "0xdead"],
    ["empty", ""],
    ["whitespace only", "   "],
    ["only letters", "abc"],
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
