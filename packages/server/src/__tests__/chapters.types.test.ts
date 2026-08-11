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

// ---------------------------------------------------------------------------
// I5 (dedup review 2026-07-26): the helper is the only corrupt-flag strip
// ---------------------------------------------------------------------------

describe("stripCorruptFlag is the single owner of the corrupt-flag surface", () => {
  // Drift history: e6fd38b (2026-04-08) consolidated the inline strips onto
  // this helper; b694a86 (2026-04-14) re-introduced one in
  // chapters.service.updateChapter; bdb6c99 (2026-04-19) fixed the identical
  // shape in snapshots.service.ts — its own message warning that "any future
  // field added to the corrupt-flag surface would have drifted between the two
  // paths" — and did not touch the twin created five days earlier.
  //
  // Nothing type-forced the call: `updated` is a ChapterRow, so
  // stripCorruptFlag(updated) already type-checked. Widening the helper to any
  // row carrying the optional flag is what lets every site call it.

  it("accepts a row type wider than ChapterRow", () => {
    // enrichChaptersWithLabels' generic overload passes `{ status: string;
    // content_corrupt?: unknown }`, which the ChapterRow-only signature
    // rejected — the reason that call site inlined its own strip.
    const result = stripCorruptFlag({ status: "draft", content_corrupt: true, extra: 1 });
    expect(result).toEqual({ status: "draft", extra: 1 });
  });

  it("preserves every other field, including falsy ones", () => {
    const result = stripCorruptFlag({
      id: "abc",
      word_count: 0,
      deleted_at: null,
      content_corrupt: true,
    });
    expect(result).toEqual({ id: "abc", word_count: 0, deleted_at: null });
  });

  it("is a no-op for a row that never carried the flag", () => {
    // Rest-destructuring an ABSENT key omits nothing, which is why the
    // `if ("content_corrupt" in ch)` branch in enrichChaptersWithLabels was
    // behaviorally redundant and could collapse.
    const row: { id: string; status: string; content_corrupt?: boolean } = {
      id: "abc",
      status: "draft",
    };
    expect(stripCorruptFlag(row)).toEqual(row);
  });
});
