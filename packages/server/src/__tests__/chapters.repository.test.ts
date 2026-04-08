import { describe, it, expect, vi } from "vitest";
import { v4 as uuid } from "uuid";
import { setupTestDb } from "./test-helpers";
import * as ChapterRepo from "../chapters/chapters.repository";

const t = setupTestDb();

const DOC_JSON = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
};

async function createProject(id?: string) {
  const projectId = id ?? uuid();
  const now = new Date().toISOString();
  await t.db("projects").insert({
    id: projectId,
    title: "Test Project",
    slug: `test-${projectId.slice(0, 8)}`,
    mode: "fiction",
    created_at: now,
    updated_at: now,
  });
  return projectId;
}

async function createChapter(
  projectId: string,
  overrides: Partial<{
    id: string;
    title: string;
    content: string | null;
    sort_order: number;
    word_count: number;
    deleted_at: string | null;
    status: string;
  }> = {},
) {
  const chapterId = overrides.id ?? uuid();
  const now = new Date().toISOString();
  await t.db("chapters").insert({
    id: chapterId,
    project_id: projectId,
    title: overrides.title ?? "Test Chapter",
    content: overrides.content ?? JSON.stringify(DOC_JSON),
    sort_order: overrides.sort_order ?? 0,
    word_count: overrides.word_count ?? 1,
    status: overrides.status ?? "draft",
    created_at: now,
    updated_at: now,
    deleted_at: overrides.deleted_at ?? null,
  });
  return chapterId;
}

describe("chapters repository", () => {
  describe("insert() + findById()", () => {
    it("round-trips a chapter with JSON parsing", async () => {
      const projectId = await createProject();
      const chapterId = uuid();
      const now = new Date().toISOString();

      await ChapterRepo.insert(t.db, {
        id: chapterId,
        project_id: projectId,
        title: "Chapter One",
        content: JSON.stringify(DOC_JSON),
        sort_order: 0,
        word_count: 1,
        created_at: now,
        updated_at: now,
      });

      const found = await ChapterRepo.findById(t.db, chapterId);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(chapterId);
      expect(found!.title).toBe("Chapter One");
      // Content should be parsed JSON, not a string
      expect(found!.content).toEqual(DOC_JSON);
      expect(typeof found!.content).toBe("object");
    });

    it("findById() returns null for nonexistent chapter", async () => {
      const found = await ChapterRepo.findById(t.db, uuid());
      expect(found).toBeNull();
    });
  });

  describe("parseChapterContent", () => {
    it("parses valid JSON string content", () => {
      const row = { id: "abc", content: JSON.stringify(DOC_JSON) };
      const result = ChapterRepo.parseChapterContent(row);
      expect(result.content).toEqual(DOC_JSON);
    });

    it("handles corrupt JSON gracefully", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const row = { id: "abc", content: "not valid json {{{" };
      const result = ChapterRepo.parseChapterContent(row);
      expect(result.content).toBeNull();
      expect(result.content_corrupt).toBe(true);
      spy.mockRestore();
    });

    it("handles null content", () => {
      const row = { id: "abc", content: null };
      const result = ChapterRepo.parseChapterContent(row);
      expect(result.content).toBeNull();
    });

    it("passes through object content as-is", () => {
      const row = { id: "abc", content: DOC_JSON };
      const result = ChapterRepo.parseChapterContent(row);
      expect(result.content).toEqual(DOC_JSON);
    });
  });

  describe("findDeletedById()", () => {
    it("returns a deleted chapter", async () => {
      const projectId = await createProject();
      const now = new Date().toISOString();
      const chapterId = await createChapter(projectId, { deleted_at: now });

      const found = await ChapterRepo.findDeletedById(t.db, chapterId);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(chapterId);
    });

    it("returns null for a non-deleted chapter", async () => {
      const projectId = await createProject();
      const chapterId = await createChapter(projectId);

      const found = await ChapterRepo.findDeletedById(t.db, chapterId);
      expect(found).toBeNull();
    });
  });

  describe("findByIdRaw()", () => {
    it("returns raw row without JSON parsing", async () => {
      const projectId = await createProject();
      const chapterId = await createChapter(projectId);

      const found = await ChapterRepo.findByIdRaw(t.db, chapterId);
      expect(found).not.toBeNull();
      // Content should be the raw string, not parsed
      expect(typeof found!.content).toBe("string");
    });

    it("returns null for deleted chapter", async () => {
      const projectId = await createProject();
      const chapterId = await createChapter(projectId, { deleted_at: new Date().toISOString() });

      const found = await ChapterRepo.findByIdRaw(t.db, chapterId);
      expect(found).toBeNull();
    });
  });

  describe("listByProject()", () => {
    it("returns chapters sorted by sort_order, excludes deleted", async () => {
      const projectId = await createProject();
      await createChapter(projectId, { title: "Ch 2", sort_order: 2 });
      await createChapter(projectId, { title: "Ch 1", sort_order: 1 });
      await createChapter(projectId, {
        title: "Deleted",
        sort_order: 3,
        deleted_at: new Date().toISOString(),
      });

      const chapters = await ChapterRepo.listByProject(t.db, projectId);
      expect(chapters).toHaveLength(2);
      expect(chapters[0]!.title).toBe("Ch 1");
      expect(chapters[1]!.title).toBe("Ch 2");
      // Content should be parsed
      expect(typeof chapters[0]!.content).toBe("object");
    });

    it("returns empty array when no chapters exist", async () => {
      const projectId = await createProject();
      const chapters = await ChapterRepo.listByProject(t.db, projectId);
      expect(chapters).toEqual([]);
    });
  });

  describe("listMetadataByProject()", () => {
    it("returns metadata fields only, sorted by sort_order", async () => {
      const projectId = await createProject();
      await createChapter(projectId, { title: "Meta Ch", sort_order: 0, word_count: 42 });

      const meta = await ChapterRepo.listMetadataByProject(t.db, projectId);
      expect(meta).toHaveLength(1);
      expect(meta[0]).toHaveProperty("id");
      expect(meta[0]).toHaveProperty("title");
      expect(meta[0]).toHaveProperty("word_count");
      expect(meta[0]).toHaveProperty("sort_order");
      // Should NOT have content
      expect(meta[0]).not.toHaveProperty("content");
    });
  });

  describe("listDeletedByProject()", () => {
    it("returns deleted chapters with content set to null", async () => {
      const projectId = await createProject();
      const now = new Date().toISOString();
      await createChapter(projectId, { title: "Deleted Ch", deleted_at: now });
      await createChapter(projectId, { title: "Active Ch" });

      const deleted = await ChapterRepo.listDeletedByProject(t.db, projectId);
      expect(deleted).toHaveLength(1);
      expect(deleted[0]!.title).toBe("Deleted Ch");
      expect(deleted[0]!.content).toBeNull();
    });

    it("returns empty array when no deleted chapters", async () => {
      const projectId = await createProject();
      await createChapter(projectId);
      const deleted = await ChapterRepo.listDeletedByProject(t.db, projectId);
      expect(deleted).toEqual([]);
    });
  });

  describe("softDelete() + findById()", () => {
    it("soft-deleted chapter is not found by findById", async () => {
      const projectId = await createProject();
      const chapterId = await createChapter(projectId);

      await ChapterRepo.softDelete(t.db, chapterId, new Date().toISOString());
      const found = await ChapterRepo.findById(t.db, chapterId);
      expect(found).toBeNull();
    });
  });

  describe("getMaxSortOrder()", () => {
    it("returns -1 when no chapters exist", async () => {
      const projectId = await createProject();
      const max = await ChapterRepo.getMaxSortOrder(t.db, projectId);
      expect(max).toBe(-1);
    });

    it("returns the highest sort_order among active chapters", async () => {
      const projectId = await createProject();
      await createChapter(projectId, { sort_order: 0 });
      await createChapter(projectId, { sort_order: 5 });
      await createChapter(projectId, { sort_order: 3 });

      const max = await ChapterRepo.getMaxSortOrder(t.db, projectId);
      expect(max).toBe(5);
    });

    it("ignores deleted chapters", async () => {
      const projectId = await createProject();
      await createChapter(projectId, { sort_order: 2 });
      await createChapter(projectId, { sort_order: 10, deleted_at: new Date().toISOString() });

      const max = await ChapterRepo.getMaxSortOrder(t.db, projectId);
      expect(max).toBe(2);
    });
  });

  describe("sumWordCountByProject()", () => {
    it("sums word counts of active chapters", async () => {
      const projectId = await createProject();
      await createChapter(projectId, { word_count: 100, sort_order: 0 });
      await createChapter(projectId, { word_count: 200, sort_order: 1 });

      const total = await ChapterRepo.sumWordCountByProject(t.db, projectId);
      expect(total).toBe(300);
    });

    it("excludes deleted chapters from sum", async () => {
      const projectId = await createProject();
      await createChapter(projectId, { word_count: 100, sort_order: 0 });
      await createChapter(projectId, {
        word_count: 999,
        sort_order: 1,
        deleted_at: new Date().toISOString(),
      });

      const total = await ChapterRepo.sumWordCountByProject(t.db, projectId);
      expect(total).toBe(100);
    });

    it("returns 0 when no chapters exist", async () => {
      const projectId = await createProject();
      const total = await ChapterRepo.sumWordCountByProject(t.db, projectId);
      expect(total).toBe(0);
    });
  });

  describe("getChapterNamesMap()", () => {
    it("includes both active and deleted chapters", async () => {
      const projectId = await createProject();
      const activeId = await createChapter(projectId, { title: "Active", sort_order: 0 });
      const deletedId = await createChapter(projectId, {
        title: "Deleted",
        sort_order: 1,
        deleted_at: new Date().toISOString(),
      });

      const map = await ChapterRepo.getChapterNamesMap(t.db, projectId);
      expect(map[activeId]).toBe("Active");
      expect(map[deletedId]).toBe("Deleted");
      expect(Object.keys(map)).toHaveLength(2);
    });

    it("returns empty object when no chapters", async () => {
      const projectId = await createProject();
      const map = await ChapterRepo.getChapterNamesMap(t.db, projectId);
      expect(map).toEqual({});
    });
  });

  describe("update()", () => {
    it("updates an active chapter", async () => {
      const projectId = await createProject();
      const chapterId = await createChapter(projectId, { title: "Original" });

      const affected = await ChapterRepo.update(t.db, chapterId, { title: "Updated" });
      expect(affected).toBe(1);

      const found = await ChapterRepo.findById(t.db, chapterId);
      expect(found!.title).toBe("Updated");
    });

    it("does not update a soft-deleted chapter", async () => {
      const projectId = await createProject();
      const chapterId = await createChapter(projectId, {
        title: "Original",
        deleted_at: new Date().toISOString(),
      });

      const affected = await ChapterRepo.update(t.db, chapterId, { title: "Should Not Apply" });
      expect(affected).toBe(0);

      // Verify the row is unchanged
      const row = await t.db("chapters").where({ id: chapterId }).first();
      expect(row.title).toBe("Original");
    });
  });

  describe("restore()", () => {
    it("clears deleted_at on a soft-deleted chapter", async () => {
      const projectId = await createProject();
      const chapterId = await createChapter(projectId, { deleted_at: new Date().toISOString() });

      // Verify deleted
      expect(await ChapterRepo.findById(t.db, chapterId)).toBeNull();

      await ChapterRepo.restore(t.db, chapterId, 0, new Date().toISOString());

      const found = await ChapterRepo.findById(t.db, chapterId);
      expect(found).not.toBeNull();
      expect(found!.deleted_at).toBeNull();
    });
  });
});
