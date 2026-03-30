import { describe, it, expect } from "vitest";
import { CreateProjectSchema, UpdateChapterSchema, ChapterStatus } from "../schemas";

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
