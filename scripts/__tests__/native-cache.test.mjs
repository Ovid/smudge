import { describe, it, expect } from "vitest";
import { computeCacheKey } from "../native-cache.mjs";

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
