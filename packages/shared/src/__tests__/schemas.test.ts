import { describe, it, expect } from "vitest";
import {
  CreateProjectSchema,
  CreateSnapshotSchema,
  CreateOuttakeSchema,
  UpdateOuttakeSchema,
  UpdateProjectSchema,
  UpdateChapterSchema,
  UpdateSettingsSchema,
  ChapterStatus,
  ExportSchema,
  ReorderChaptersSchema,
} from "../schemas";
import { MAX_TIPTAP_DEPTH } from "../tiptap-safety";

describe("CreateProjectSchema", () => {
  it("accepts valid project creation input", () => {
    const result = CreateProjectSchema.safeParse({
      title: "My Novel",
      mode: "fiction",
    });
    expect(result.success).toBe(true);
  });

  it("requires title", () => {
    const result = CreateProjectSchema.safeParse({ mode: "fiction" });
    expect(result.success).toBe(false);
  });

  it("requires title to be non-empty", () => {
    const result = CreateProjectSchema.safeParse({ title: "", mode: "fiction" });
    expect(result.success).toBe(false);
  });

  it("requires mode to be fiction or nonfiction", () => {
    const result = CreateProjectSchema.safeParse({
      title: "My Book",
      mode: "poetry",
    });
    expect(result.success).toBe(false);
  });

  it("accepts nonfiction mode", () => {
    const result = CreateProjectSchema.safeParse({
      title: "My Memoir",
      mode: "nonfiction",
    });
    expect(result.success).toBe(true);
  });

  it("trims whitespace from title", () => {
    const result = CreateProjectSchema.safeParse({
      title: "  My Novel  ",
      mode: "fiction",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("My Novel");
    }
  });

  // F-25: a typo'd field used to answer 200 having changed nothing.
  it("rejects unknown keys (strict)", () => {
    const result = CreateProjectSchema.safeParse({
      title: "My Novel",
      mode: "fiction",
      taget_word_count: 50000,
    });
    expect(result.success).toBe(false);
  });
});

describe("UpdateChapterSchema", () => {
  it("accepts title-only update", () => {
    const result = UpdateChapterSchema.safeParse({ title: "Chapter One" });
    expect(result.success).toBe(true);
  });

  it("accepts content-only update", () => {
    const content = { type: "doc", content: [] };
    const result = UpdateChapterSchema.safeParse({ content });
    expect(result.success).toBe(true);
  });

  it("accepts both title and content", () => {
    const result = UpdateChapterSchema.safeParse({
      title: "Chapter One",
      content: { type: "doc", content: [] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty object (must update something)", () => {
    const result = UpdateChapterSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects content without type: doc", () => {
    const result = UpdateChapterSchema.safeParse({
      content: { type: "paragraph", content: [] },
    });
    expect(result.success).toBe(false);
  });

  it("accepts status-only update", () => {
    const result = UpdateChapterSchema.safeParse({ status: "revised" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status value", () => {
    const result = UpdateChapterSchema.safeParse({ status: "published" });
    expect(result.success).toBe(false);
  });

  it("rejects TipTap content nested beyond the depth cap", () => {
    // Build a deeply nested structure that exceeds MAX_TIPTAP_DEPTH (64).
    interface Node {
      type: string;
      content?: Node[];
    }
    let deep: Node = { type: "paragraph" };
    for (let i = 0; i < 100; i++) {
      deep = { type: "blockquote", content: [deep] };
    }
    const doc = { type: "doc", content: [deep] };
    const result = UpdateChapterSchema.safeParse({ content: doc });
    expect(result.success).toBe(false);
  });

  // S4 (agentic-review 2026-08-04): validateTipTapDepth gained two NON-depth
  // rejections on this branch (an array node, a present non-array `content`)
  // while the refine kept its depth-only message. That message reaches the
  // client verbatim, so a shape violation was reported as a depth violation the
  // writer cannot act on by un-nesting.
  it.each([
    // Nested, not top-level: Zod's own z.array(z.record()) already rejects a
    // top-level array child with an accurate message. The refine is the only
    // check that sees deeper positions.
    [
      "a nested array node",
      { type: "doc", content: [{ type: "paragraph", content: [[{ type: "text", text: "x" }]] }] },
    ],
    ["a non-array content", { type: "doc", content: [{ type: "paragraph", content: 5 }] }],
    // OOSI1 (agentic-review 2026-08-05): the entry arm `if (!node || typeof
    // node !== "object") return true` fires for a null/primitive sitting as an
    // ELEMENT of a nested content[], and the recursion loop did not gate on
    // isTipTapNode — so the branch closed the container case (S1) and the
    // array-child case two lines away and left the primitive-child case open,
    // while the function's doc comment asserted a fail-closed contract. A
    // number or string child makes renderEditorHtml throw RangeError, so
    // chapterContentToHtml returns "" and HTML/EPUB/markdown/plaintext emit the
    // chapter heading with NO BODY behind a single logger.warn, while
    // word_count still reads healthy.
    [
      "a primitive child of a nested content[]",
      { type: "doc", content: [{ type: "paragraph", content: [0] }] },
    ],
    [
      "a null child of a nested content[]",
      { type: "doc", content: [{ type: "paragraph", content: [null] }] },
    ],
  ])("names shape as well as depth when rejecting %s", (_name, doc) => {
    const result = UpdateChapterSchema.safeParse({ content: doc });
    expect(result.success).toBe(false);
    if (result.success) return;
    const message = result.error.issues.map((i) => i.message).join(" ");
    expect(message).toMatch(/malformed/i);
    expect(message).toContain(String(MAX_TIPTAP_DEPTH));
  });
});

describe("CreateSnapshotSchema", () => {
  it("accepts a missing label", () => {
    const result = CreateSnapshotSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  // S9 (dedup review 2026-07-26): the two create schemas share
  // sanitizedLabelBase and both write a nullable `text` column, but disagreed
  // on the nullability modifier — snapshot `.optional()` 400s on an explicit
  // null that outtake `.nullish()` accepts. Latent (no shipped client sends
  // one) and a strict subset, so widening breaks nothing. UpdateOuttakeSchema
  // stays `.nullable()`: a PATCH genuinely needs an explicit clear signal and
  // must not treat "absent" as "clear".
  it.each([
    ["CreateSnapshotSchema", CreateSnapshotSchema, { label: null }],
    ["CreateOuttakeSchema", CreateOuttakeSchema, { label: null, content: { type: "doc" } }],
  ])("%s accepts an explicit null label", (_label, schema, body) => {
    expect(schema.safeParse(body).success).toBe(true);
  });

  it("sanitizes control characters in the label", () => {
    const result = CreateSnapshotSchema.safeParse({ label: "a\u0000b\u202Ec" });
    expect(result.success).toBe(true);
    expect(result.success && result.data.label).toBe("abc");
  });

  it("rejects unknown keys (strict)", () => {
    const result = CreateSnapshotSchema.safeParse({ label: "x", is_auto: true });
    expect(result.success).toBe(false);
  });

  it("strips Unicode non-characters from the label (S5)", () => {
    // BMP non-characters: U+FDD0..U+FDEF, U+FFFE, U+FFFF.
    const bmp = CreateSnapshotSchema.safeParse({
      label: "a\uFDD0b\uFDEFc\uFFFEd\uFFFFe",
    });
    expect(bmp.success).toBe(true);
    expect(bmp.success && bmp.data.label).toBe("abcde");

    // Supplementary non-char U+1FFFE (surrogate pair D83F DFFE) and
    // U+10FFFF (surrogate pair DBFF DFFF) stripped.
    const supp = CreateSnapshotSchema.safeParse({
      label: "x\uD83F\uDFFEy\uDBFF\uDFFFz",
    });
    expect(supp.success).toBe(true);
    expect(supp.success && supp.data.label).toBe("xyz");

    // A valid supplementary-plane code point (U+1F600 😀) is preserved.
    const emoji = CreateSnapshotSchema.safeParse({ label: "a\uD83D\uDE00b" });
    expect(emoji.success).toBe(true);
    expect(emoji.success && emoji.data.label).toBe("a\uD83D\uDE00b");
  });

  it("strips unpaired surrogate code units from the label (S5)", () => {
    // A lone high surrogate (not followed by a low surrogate) is invalid
    // UTF-16 \u2014 stored as-is it renders as U+FFFD and breaks length clamps,
    // so it must be removed.
    const loneHigh = CreateSnapshotSchema.safeParse({ label: "a\uD800b" });
    expect(loneHigh.success).toBe(true);
    expect(loneHigh.success && loneHigh.data.label).toBe("ab");

    // A lone low surrogate (not preceded by a high surrogate) is likewise
    // stripped.
    const loneLow = CreateSnapshotSchema.safeParse({ label: "a\uDC00b" });
    expect(loneLow.success).toBe(true);
    expect(loneLow.success && loneLow.data.label).toBe("ab");

    // Two consecutive high surrogates: the first's successor is not a low
    // surrogate and the second is unpaired too \u2014 both stripped.
    const doubleHigh = CreateSnapshotSchema.safeParse({ label: "\uD800\uD800x" });
    expect(doubleHigh.success).toBe(true);
    expect(doubleHigh.success && doubleHigh.data.label).toBe("x");
  });
});

describe("ChapterStatus", () => {
  it("accepts all valid statuses", () => {
    for (const status of ["outline", "rough_draft", "revised", "edited", "final"]) {
      const result = ChapterStatus.safeParse(status);
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid status", () => {
    const result = ChapterStatus.safeParse("published");
    expect(result.success).toBe(false);
  });
});

describe("UpdateProjectSchema — target fields", () => {
  it("accepts target_word_count as positive integer", () => {
    const result = UpdateProjectSchema.safeParse({ target_word_count: 80000 });
    expect(result.success).toBe(true);
  });

  it("accepts target_word_count as null (clear target)", () => {
    const result = UpdateProjectSchema.safeParse({ target_word_count: null });
    expect(result.success).toBe(true);
  });

  it("rejects target_word_count as zero or negative", () => {
    expect(UpdateProjectSchema.safeParse({ target_word_count: 0 }).success).toBe(false);
    expect(UpdateProjectSchema.safeParse({ target_word_count: -1 }).success).toBe(false);
  });

  it("accepts target_deadline as ISO date string", () => {
    const result = UpdateProjectSchema.safeParse({ target_deadline: "2026-09-01" });
    expect(result.success).toBe(true);
  });

  it("accepts target_deadline as null (clear deadline)", () => {
    const result = UpdateProjectSchema.safeParse({ target_deadline: null });
    expect(result.success).toBe(true);
  });

  it("rejects target_deadline as invalid date", () => {
    expect(UpdateProjectSchema.safeParse({ target_deadline: "not-a-date" }).success).toBe(false);
  });
});

describe("UpdateProjectSchema — author_name", () => {
  it("accepts author_name as a string", () => {
    const result = UpdateProjectSchema.safeParse({ author_name: "Jane Doe" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.author_name).toBe("Jane Doe");
  });

  it("accepts author_name as null", () => {
    const result = UpdateProjectSchema.safeParse({ author_name: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.author_name).toBeNull();
  });

  it("normalizes empty author_name to null", () => {
    const result = UpdateProjectSchema.safeParse({ author_name: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.author_name).toBeNull();
  });

  it("normalizes whitespace-only author_name to null", () => {
    const result = UpdateProjectSchema.safeParse({ author_name: "   " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.author_name).toBeNull();
  });

  it("trims whitespace from author_name", () => {
    const result = UpdateProjectSchema.safeParse({ author_name: "  Jane Doe  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.author_name).toBe("Jane Doe");
  });
});

describe("ExportSchema", () => {
  it("accepts valid export config with all fields", () => {
    const result = ExportSchema.safeParse({
      format: "html",
      include_toc: true,
      chapter_ids: ["550e8400-e29b-41d4-a716-446655440000"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts minimal config (format only)", () => {
    const result = ExportSchema.safeParse({ format: "markdown" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.include_toc).toBe(true);
    }
  });

  it("rejects invalid format", () => {
    const result = ExportSchema.safeParse({ format: "pdf" });
    expect(result.success).toBe(false);
  });

  it("rejects empty chapter_ids array", () => {
    const result = ExportSchema.safeParse({ format: "html", chapter_ids: [] });
    expect(result.success).toBe(false);
  });

  it("accepts plaintext format", () => {
    const result = ExportSchema.safeParse({ format: "plaintext" });
    expect(result.success).toBe(true);
  });

  // F-25: a typo'd field used to answer 200 having changed nothing.
  it("rejects unknown keys (strict)", () => {
    const result = ExportSchema.safeParse({ format: "html", include_tock: false });
    expect(result.success).toBe(false);
  });
});

describe("ReorderChaptersSchema", () => {
  it("accepts a chapter_ids array of uuids", () => {
    const result = ReorderChaptersSchema.safeParse({
      chapter_ids: ["3f6c8b1e-1f2a-4c3d-8e9f-0a1b2c3d4e5f"],
    });
    expect(result.success).toBe(true);
  });

  // F-25: a typo'd field used to answer 200 having changed nothing.
  it("rejects unknown keys (strict)", () => {
    const result = ReorderChaptersSchema.safeParse({
      chapter_ids: ["3f6c8b1e-1f2a-4c3d-8e9f-0a1b2c3d4e5f"],
      project_id: "3f6c8b1e-1f2a-4c3d-8e9f-0a1b2c3d4e5f",
    });
    expect(result.success).toBe(false);
  });
});

describe("UpdateSettingsSchema", () => {
  it("accepts valid settings array", () => {
    const result = UpdateSettingsSchema.safeParse({
      settings: [{ key: "timezone", value: "America/New_York" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty key", () => {
    const result = UpdateSettingsSchema.safeParse({
      settings: [{ key: "", value: "foo" }],
    });
    expect(result.success).toBe(false);
  });

  // F-25: a typo'd field used to answer 200 having changed nothing.
  it("rejects unknown keys (strict)", () => {
    const result = UpdateSettingsSchema.safeParse({
      settings: [{ key: "timezone", value: "UTC" }],
      overwrite: true,
    });
    expect(result.success).toBe(false);
  });

  // F-25: the outer .strict() does NOT reach inside the array, so the entry
  // object carries its own. Without it, `{key, value, valeu}` is the same
  // silent no-op one level down — the exact flaw, at the same endpoint.
  it("rejects unknown keys inside a settings entry (strict)", () => {
    const result = UpdateSettingsSchema.safeParse({
      settings: [{ key: "timezone", value: "UTC", valeu: "typo" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("CreateOuttakeSchema", () => {
  const doc = { type: "doc", content: [{ type: "paragraph" }] };
  it("accepts content with an optional label", () => {
    expect(CreateOuttakeSchema.safeParse({ content: doc }).success).toBe(true);
    expect(CreateOuttakeSchema.safeParse({ content: doc, label: "Cut scene" }).success).toBe(true);
  });
  it("rejects unknown keys (strict)", () => {
    expect(CreateOuttakeSchema.safeParse({ content: doc, word_count: 5 }).success).toBe(false);
  });
  it("rejects a non-TipTap content", () => {
    expect(CreateOuttakeSchema.safeParse({ content: 42 }).success).toBe(false);
  });
  it("trims surrounding whitespace from the label", () => {
    const result = CreateOuttakeSchema.safeParse({ content: doc, label: "  Cut scene  " });
    expect(result.success).toBe(true);
    expect(result.success && result.data.label).toBe("Cut scene");
  });
  it("rejects an over-max label", () => {
    const result = CreateOuttakeSchema.safeParse({ content: doc, label: "a".repeat(501) });
    expect(result.success).toBe(false);
  });
  it("rejects a huge label before sanitizing (pre-cap)", () => {
    const result = CreateOuttakeSchema.safeParse({ content: doc, label: "a".repeat(5001) });
    expect(result.success).toBe(false);
  });
});

describe("UpdateOuttakeSchema", () => {
  it("accepts a label (string or null) and rejects other keys", () => {
    expect(UpdateOuttakeSchema.safeParse({ label: "x" }).success).toBe(true);
    expect(UpdateOuttakeSchema.safeParse({ label: null }).success).toBe(true);
    expect(UpdateOuttakeSchema.safeParse({ content: {} }).success).toBe(false);
  });
  it("trims surrounding whitespace from the label", () => {
    const result = UpdateOuttakeSchema.safeParse({ label: "  Cut scene  " });
    expect(result.success).toBe(true);
    expect(result.success && result.data.label).toBe("Cut scene");
  });
  it("rejects an over-max label", () => {
    const result = UpdateOuttakeSchema.safeParse({ label: "a".repeat(501) });
    expect(result.success).toBe(false);
  });
  it("rejects a huge label before sanitizing (pre-cap)", () => {
    const result = UpdateOuttakeSchema.safeParse({ label: "a".repeat(5001) });
    expect(result.success).toBe(false);
  });
});
