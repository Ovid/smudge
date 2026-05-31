import { describe, it, expect } from "vitest";
import { computeCacheKey, validateNodeMajor } from "../native-cache.mjs";

describe("validateNodeMajor", () => {
  it("accepts a matching single-major form (22.x against 22.22.2)", () => {
    expect(validateNodeMajor("22.x", "22.22.2")).toEqual({
      ok: true,
      expected: "22",
    });
  });

  it.each(["22", "22.x", "22.5.0", "^22.5", "~22.5"])(
    "accepts the supported form %s when the active major matches",
    (form) => {
      expect(validateNodeMajor(form, "22.0.0")).toEqual({
        ok: true,
        expected: "22",
      });
    },
  );

  it("reports missing engines.node", () => {
    expect(validateNodeMajor(undefined, "22.22.2")).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("reports a multi-major range as unsupported", () => {
    expect(validateNodeMajor("22 || 24", "22.22.2")).toEqual({
      ok: false,
      reason: "unsupported-range",
    });
  });

  it("reports garbage as unsupported", () => {
    expect(validateNodeMajor("not-a-version", "22.22.2")).toEqual({
      ok: false,
      reason: "unsupported-range",
    });
  });

  it("reports a major mismatch with both expected and actual", () => {
    expect(validateNodeMajor("22.x", "20.11.0")).toEqual({
      ok: false,
      reason: "mismatch",
      expected: "22",
      actual: "20",
    });
  });
});

describe("computeCacheKey", () => {
  it("joins version, platform, arch and node-ABI into a stable key", () => {
    expect(
      computeCacheKey({
        version: "11.10.0",
        platform: "linux",
        arch: "arm64",
        abiVersion: "127",
      }),
    ).toBe("better-sqlite3@11.10.0-linux-arm64-abi127");
  });

  it("reflects a different platform/arch/abi in the key", () => {
    expect(
      computeCacheKey({
        version: "11.10.0",
        platform: "darwin",
        arch: "x64",
        abiVersion: "131",
      }),
    ).toBe("better-sqlite3@11.10.0-darwin-x64-abi131");
  });
});
