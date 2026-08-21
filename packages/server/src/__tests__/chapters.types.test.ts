import { describe, it, expect } from "vitest";
import {
  isCorruptChapter,
  stripParseFailedFlag,
  type ChapterRow,
} from "../chapters/chapters.types";
import type { OuttakeRow } from "@smudge/shared";

describe("chapters.types", () => {
  describe("isCorruptChapter()", () => {
    it("returns true when content_parse_failed is true", () => {
      expect(isCorruptChapter({ content_parse_failed: true })).toBe(true);
    });

    it("returns false when content_parse_failed is absent", () => {
      expect(isCorruptChapter({})).toBe(false);
    });

    it("returns false when content_parse_failed is false", () => {
      expect(isCorruptChapter({ content_parse_failed: false })).toBe(false);
    });
  });

  describe("stripParseFailedFlag()", () => {
    it("removes content_parse_failed from the object", () => {
      const result = stripParseFailedFlag({
        id: "abc",
        content_parse_failed: true,
        title: "hi",
      } as ChapterRow);
      expect(result).toEqual({ id: "abc", title: "hi" });
      expect("content_parse_failed" in result).toBe(false);
    });

    it("returns the same data when no content_parse_failed key exists", () => {
      const result = stripParseFailedFlag({ id: "abc", title: "hi" } as ChapterRow);
      expect(result).toEqual({ id: "abc", title: "hi" });
    });
  });
});

// ---------------------------------------------------------------------------
// I5 (dedup review 2026-07-26): the helper is the only corrupt-flag strip
// ---------------------------------------------------------------------------

describe("stripParseFailedFlag is the single owner of the corrupt-flag surface", () => {
  // Drift history: e6fd38b (2026-04-08) consolidated the inline strips onto
  // this helper; b694a86 (2026-04-14) re-introduced one in
  // chapters.service.updateChapter; bdb6c99 (2026-04-19) fixed the identical
  // shape in snapshots.service.ts — its own message warning that "any future
  // field added to the corrupt-flag surface would have drifted between the two
  // paths" — and did not touch the twin created five days earlier.
  //
  // Nothing type-forced the call: `updated` is a ChapterRow, so
  // stripParseFailedFlag(updated) already type-checked. Widening the helper to any
  // row carrying the optional flag is what lets every site call it.

  it("accepts a row type wider than ChapterRow", () => {
    // enrichChaptersWithLabels' generic overload passes `{ status: string;
    // content_parse_failed?: unknown }`, which the ChapterRow-only signature
    // rejected — the reason that call site inlined its own strip.
    const result = stripParseFailedFlag({ status: "draft", content_parse_failed: true, extra: 1 });
    expect(result).toEqual({ status: "draft", extra: 1 });
  });

  it("preserves every other field, including falsy ones", () => {
    const result = stripParseFailedFlag({
      id: "abc",
      word_count: 0,
      deleted_at: null,
      content_parse_failed: true,
    });
    expect(result).toEqual({ id: "abc", word_count: 0, deleted_at: null });
  });

  it("is a no-op for a row that never carried the flag", () => {
    // Rest-destructuring an ABSENT key omits nothing, which is why the
    // `if ("content_parse_failed" in ch)` branch in enrichChaptersWithLabels was
    // behaviorally redundant and could collapse.
    const row: { id: string; status: string; content_parse_failed?: boolean } = {
      id: "abc",
      status: "draft",
    };
    expect(stripParseFailedFlag(row)).toEqual(row);
  });
});

/**
 * F-22 (architecture report 2026-08-11). `content_parse_failed` named two
 * incompatible contracts. For a chapter it pairs with `content: null`, is
 * server-internal, and is stripped before the row reaches the wire. For an
 * outtake it pairs with a VALID EMPTY DOC and is part of the public wire type
 * — the client reads it to refuse to copy or insert the substituted content
 * (`OuttakeCard.test.tsx`).
 *
 * Sharing the field name meant they also shared a structural SHAPE, so the
 * chapters-only helpers accepted an outtake row and the compiler said nothing.
 * Applying the strip to an outtake would have removed a flag the wire contract
 * requires, handing the client a substituted-empty row it reads as healthy.
 *
 * The chapter flag is now `content_parse_failed`, which makes the two shapes
 * incompatible. The mechanism is TypeScript's WEAK TYPE DETECTION, and it is
 * worth naming because it is not obvious: both helpers accept a target whose
 * properties are ALL optional, and TypeScript rejects such a target only when
 * the source shares NONE of its properties. While both flags were spelled
 * `content_corrupt` an `OuttakeRow` shared one, so it was accepted; sharing
 * zero properties is what now rejects it. The corollary is the thing to watch:
 * if either helper ever gains a property an `OuttakeRow` also has, the weak-type
 * rule stops applying and these guards silently weaken — at which point the fix
 * is a required discriminating field (`status` is the natural one), not a
 * fourth optional.
 *
 * These are the forcing pause: if either helper becomes applicable to an
 * outtake again, its `@ts-expect-error` goes unused and
 * `tsc --noEmit -p packages/server` fails. Runtime tests cannot catch this —
 * the whole defect lives in the type system, which is why this case asserts
 * almost nothing at runtime. Both directives were confirmed live by negative
 * control: widening either helper's parameter to `Record<string, unknown>`
 * turns that helper's line, and only that line, into TS2578.
 */
describe("chapters.types — separation from the outtakes wire flag (F-22)", () => {
  it("refuses to apply the chapter-only helpers to an outtake row", () => {
    const outtake = {
      id: "o1",
      project_id: "p1",
      label: null,
      content: { type: "doc", content: [] },
      content_corrupt: true,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    } satisfies OuttakeRow;

    // @ts-expect-error - an OuttakeRow must not satisfy the chapter predicate
    isCorruptChapter(outtake);
    // @ts-expect-error - an OuttakeRow must not satisfy the chapter strip helper
    stripParseFailedFlag(outtake);

    // The outtake's own flag is untouched by any of this — it must survive to
    // the client, which is the contract the strip would have broken.
    expect(outtake.content_corrupt).toBe(true);
  });
});
