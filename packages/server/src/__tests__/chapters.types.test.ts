import { describe, it, expect } from "vitest";
import { isCorruptChapter, stripCorruptFlag, type ChapterRow } from "../chapters/chapters.types";

describe("chapters.types", () => {
  describe("isCorruptChapter()", () => {
    it("returns true when content_corrupt is true", () => {
      expect(isCorruptChapter({ content_corrupt: true })).toBe(true);
    });

    it("returns false when content_corrupt is absent", () => {
      expect(isCorruptChapter({})).toBe(false);
    });

    it("returns false when content_corrupt is false", () => {
      expect(isCorruptChapter({ content_corrupt: false })).toBe(false);
    });
  });

  describe("stripCorruptFlag()", () => {
    it("removes content_corrupt from the object", () => {
      const result = stripCorruptFlag({
        id: "abc",
        content_corrupt: true,
        title: "hi",
      } as ChapterRow);
      expect(result).toEqual({ id: "abc", title: "hi" });
      expect("content_corrupt" in result).toBe(false);
    });

    it("returns the same data when no content_corrupt key exists", () => {
      const result = stripCorruptFlag({ id: "abc", title: "hi" } as ChapterRow);
      expect(result).toEqual({ id: "abc", title: "hi" });
    });
  });
});
