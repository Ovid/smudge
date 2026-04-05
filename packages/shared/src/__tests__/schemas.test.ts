import { describe, it, expect } from "vitest";
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  UpdateChapterSchema,
  UpdateSettingsSchema,
  ChapterStatus,
  CompletionThreshold,
  calculateWordsToday,
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

describe("CompletionThreshold", () => {
  it("accepts valid threshold values", () => {
    for (const v of ["outline", "rough_draft", "revised", "edited", "final"]) {
      expect(CompletionThreshold.safeParse(v).success).toBe(true);
    }
  });

  it("rejects invalid values", () => {
    expect(CompletionThreshold.safeParse("invalid").success).toBe(false);
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

  it("accepts completion_threshold", () => {
    const result = UpdateProjectSchema.safeParse({ completion_threshold: "revised" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid completion_threshold", () => {
    expect(UpdateProjectSchema.safeParse({ completion_threshold: "garbage" }).success).toBe(false);
  });
});

describe("UpdateChapterSchema — target_word_count", () => {
  it("accepts target_word_count as positive integer", () => {
    const result = UpdateChapterSchema.safeParse({ target_word_count: 5000 });
    expect(result.success).toBe(true);
  });

  it("accepts target_word_count as null", () => {
    const result = UpdateChapterSchema.safeParse({ target_word_count: null });
    expect(result.success).toBe(true);
  });

  it("rejects target_word_count as zero", () => {
    expect(UpdateChapterSchema.safeParse({ target_word_count: 0 }).success).toBe(false);
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

describe("calculateWordsToday", () => {
  it("returns diff between current total and most recent prior-day snapshot", () => {
    const result = calculateWordsToday(
      41200,
      [
        { date: "2026-03-31", total_word_count: 40000 },
        { date: "2026-04-01", total_word_count: 41200 },
      ],
      "2026-04-01",
    );
    expect(result).toBe(1200);
  });

  it("returns current total when no prior-day snapshot exists (first day)", () => {
    const result = calculateWordsToday(
      5000,
      [{ date: "2026-04-01", total_word_count: 5000 }],
      "2026-04-01",
    );
    expect(result).toBe(5000);
  });

  it("returns current total when no snapshots exist (first day)", () => {
    expect(calculateWordsToday(0, [], "2026-04-01")).toBe(0);
    expect(calculateWordsToday(3000, [], "2026-04-01")).toBe(3000);
  });

  it("uses most recent prior-day snapshot, not strictly yesterday", () => {
    const result = calculateWordsToday(
      42000,
      [
        { date: "2026-03-30", total_word_count: 40000 },
        { date: "2026-04-01", total_word_count: 42000 },
      ],
      "2026-04-01",
    );
    expect(result).toBe(2000);
  });
});
