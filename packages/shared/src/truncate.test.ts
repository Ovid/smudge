import { describe, it, expect } from "vitest";
import { truncateUnits } from "./truncate";

describe("truncateUnits", () => {
  it("returns the string unchanged when it fits", () => {
    expect(truncateUnits("hello", 10)).toBe("hello");
    expect(truncateUnits("hello", 5)).toBe("hello");
  });

  it("truncates to the unit limit for plain BMP text", () => {
    expect(truncateUnits("hello world", 5)).toBe("hello");
  });

  it("does not leave a lone high surrogate when the cut splits a pair", () => {
    // "a" + 😀 (U+1F600, a surrogate pair): slicing at 2 units would keep the
    // high surrogate only. Expect it dropped, leaving just "a".
    const s = "a\u{1F600}b";
    const cut = truncateUnits(s, 2);
    expect(cut).toBe("a");
    // No U+FFFD-producing lone surrogate remains.
    expect(cut.charCodeAt(cut.length - 1)).toBeLessThan(0xd800);
  });

  it("keeps a whole surrogate pair when the cut lands after it", () => {
    const s = "\u{1F600}xyz";
    expect(truncateUnits(s, 2)).toBe("\u{1F600}");
  });
});
