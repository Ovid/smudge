import { describe, it, expect, afterEach } from "vitest";
import { v4 as uuid } from "uuid";
import { setupTestDb } from "./test-helpers";
import {
  setVelocityService,
  resetVelocityService,
  updateChapter,
  deleteChapter,
  restoreChapter,
  getChapter,
  isCorruptChapter,
  stripCorruptFlag,
} from "../chapters/chapters.service";

const t = setupTestDb();

afterEach(() => {
  resetVelocityService();
});

const DOC_JSON = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
};

async function createProjectAndChapter() {
  const projectId = uuid();
  const chapterId = uuid();
  const now = new Date().toISOString();
  await t.db("projects").insert({
    id: projectId,
    title: `Test Project ${projectId.slice(0, 8)}`,
    slug: `test-${projectId.slice(0, 8)}`,
    mode: "fiction",
    created_at: now,
    updated_at: now,
  });
  await t.db("chapters").insert({
    id: chapterId,
    project_id: projectId,
    title: "Test Chapter",
    content: JSON.stringify(DOC_JSON),
    sort_order: 0,
    word_count: 1,
    status: "draft",
    created_at: now,
    updated_at: now,
  });
  return { projectId, chapterId };
}

describe("chapters.service", () => {
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
      const result = stripCorruptFlag({ id: "abc", content_corrupt: true, title: "hi" });
      expect(result).toEqual({ id: "abc", title: "hi" });
      expect("content_corrupt" in result).toBe(false);
    });

    it("returns the same data when no content_corrupt key exists", () => {
      const result = stripCorruptFlag({ id: "abc", title: "hi" });
      expect(result).toEqual({ id: "abc", title: "hi" });
    });
  });

  describe("updateChapter()", () => {
    it("succeeds even when velocity recordSave throws", async () => {
      const { chapterId } = await createProjectAndChapter();

      setVelocityService({
        recordSave: async () => {
          throw new Error("velocity broken");
        },
        updateDailySnapshot: async () => {
          throw new Error("velocity broken");
        },
      });

      const result = await updateChapter(chapterId, {
        content: DOC_JSON,
      });

      expect(result).toBeDefined();
      expect(result).not.toBeNull();
      expect(result).toHaveProperty("chapter");
    });

    it("returns null for a non-existent chapter", async () => {
      const result = await updateChapter(uuid(), { title: "New Title" });
      expect(result).toBeNull();
    });

    it("returns validationError for invalid body", async () => {
      const { chapterId } = await createProjectAndChapter();
      const result = await updateChapter(chapterId, { content: "not-valid-json-object" });
      expect(result).toBeDefined();
      expect(result).toHaveProperty("validationError");
    });
  });

  describe("deleteChapter()", () => {
    it("succeeds even when velocity updateDailySnapshot throws", async () => {
      const { chapterId } = await createProjectAndChapter();

      setVelocityService({
        recordSave: async () => {
          throw new Error("velocity broken");
        },
        updateDailySnapshot: async () => {
          throw new Error("velocity broken");
        },
      });

      const result = await deleteChapter(chapterId);
      expect(result).toBe(true);
    });

    it("returns false for a non-existent chapter", async () => {
      const result = await deleteChapter(uuid());
      expect(result).toBe(false);
    });
  });

  describe("restoreChapter()", () => {
    it("succeeds even when velocity updateDailySnapshot throws", async () => {
      const { chapterId } = await createProjectAndChapter();

      // Soft-delete the chapter so we can restore it
      const now = new Date().toISOString();
      await t.db("chapters").where({ id: chapterId }).update({ deleted_at: now });

      setVelocityService({
        recordSave: async () => {
          throw new Error("velocity broken");
        },
        updateDailySnapshot: async () => {
          throw new Error("velocity broken");
        },
      });

      const result = await restoreChapter(chapterId);
      expect(result).toBeDefined();
      expect(result).not.toBeNull();
      expect(result).not.toBe("purged");
      expect(result).not.toBe("conflict");
    });
  });

  describe("getChapter()", () => {
    it("returns null for a non-existent chapter", async () => {
      const result = await getChapter(uuid());
      expect(result).toBeNull();
    });

    it("returns chapter with status_label for an existing chapter", async () => {
      const { chapterId } = await createProjectAndChapter();
      const result = await getChapter(chapterId);
      expect(result).toBeDefined();
      expect(result).not.toBeNull();
      expect(result).not.toBe("corrupt");
      expect(
        typeof result === "object" &&
          result !== null &&
          "status_label" in result &&
          result.status_label,
      ).toBeTruthy();
    });
  });
});
