import { describe, it, expect } from "vitest";
import {
  CreateProjectSchema,
  CreateSnapshotSchema,
  UpdateProjectSchema,
  UpdateChapterSchema,
  UpdateSettingsSchema,
  ChapterStatus,
  ExportSchema,
} from "../schemas";

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
});

describe("CreateSnapshotSchema", () => {
  it("accepts a missing label", () => {
    const result = CreateSnapshotSchema.safeParse({});
    expect(result.success).toBe(true);
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
});
