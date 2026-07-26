import { describe, it, expect } from "vitest";
import { CreateSnapshotSchema, LABEL_MAX_UNITS } from "@smudge/shared";
import { buildAutoSnapshotLabel } from "../snapshots/labels";

// I4 (dedup review 2026-07-26): the label cap 500 was written three times in
// TWO DIFFERENT UNITS. The schema rejects above 500 UTF-16 CODE UNITS; the auto
// label builder truncated at 500 GRAPHEMES, and never passes through the schema
// (insertAutoSnapshotIfChanged goes straight to the store, no Zod). Emoji are
// one grapheme and two code units, so the two caps differ by up to 2x and the
// paths compose: a manual label the schema accepts, embedded in the restore
// template, produced a stored label longer than the same column's own limit.
//
// SQLite `text` does not enforce a length, and nothing downstream reads it, so
// there is no crash to point at. The defect is that the server writes values
// its own API rejects — a constraint the codebase believes it enforces and
// does not. It also fails in the dangerous direction: LOWER the schema cap and
// both auto-label builders keep emitting over-cap labels.

/** 250 emoji: 250 graphemes, 500 UTF-16 code units — exactly at the cap. */
const MAX_LENGTH_EMOJI_LABEL = "\u{1F600}".repeat(250);

describe("the auto-snapshot label cap is the cap the schema enforces (I4)", () => {
  it("agrees with the schema about what 'at the cap' means", () => {
    expect(MAX_LENGTH_EMOJI_LABEL.length).toBe(LABEL_MAX_UNITS);
    // The schema accepts it — so it is a label a user really can store.
    expect(CreateSnapshotSchema.safeParse({ label: MAX_LENGTH_EMOJI_LABEL }).success).toBe(true);
  });

  it("never emits a label the schema would reject", () => {
    // The restore path: sanitize (no-op), truncate the embedded fragment to
    // 450 (no-op at 250 graphemes), then wrap in a template that adds exactly
    // 20 code units. A grapheme cap of 500 waves the 270-grapheme /
    // 520-code-unit result straight through.
    const embedded = MAX_LENGTH_EMOJI_LABEL;
    const label = buildAutoSnapshotLabel(`Before restore to ‘${embedded}’`);

    expect(label.length).toBeLessThanOrEqual(LABEL_MAX_UNITS);
    expect(CreateSnapshotSchema.safeParse({ label }).success).toBe(true);
  });

  it("still cuts on a whole character, never mid-surrogate-pair", () => {
    const label = buildAutoSnapshotLabel("\u{1F600}".repeat(400));
    expect(label.length).toBeLessThanOrEqual(LABEL_MAX_UNITS);
    // A dangling high surrogate would render as U+FFFD.
    expect(label).not.toMatch(/[\uD800-\uDBFF]$/);
  });

  it("leaves a label that already fits untouched", () => {
    expect(buildAutoSnapshotLabel("Before restore to ‘chapter one’")).toBe(
      "Before restore to ‘chapter one’",
    );
  });
});
