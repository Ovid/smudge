import { describe, it, expect } from "vitest";
import {
  CreateProjectSchema,
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
