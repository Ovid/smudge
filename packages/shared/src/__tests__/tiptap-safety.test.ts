import { describe, it, expect } from "vitest";
import { CANONICAL_UNSAFE_KEYS } from "../index";

describe("CANONICAL_UNSAFE_KEYS", () => {
  it("is exported from the package barrel with exactly the three prototype-pollution keys", () => {
    expect(CANONICAL_UNSAFE_KEYS.has("__proto__")).toBe(true);
    expect(CANONICAL_UNSAFE_KEYS.has("prototype")).toBe(true);
    expect(CANONICAL_UNSAFE_KEYS.has("constructor")).toBe(true);
    expect(CANONICAL_UNSAFE_KEYS.size).toBe(3);
  });
});
