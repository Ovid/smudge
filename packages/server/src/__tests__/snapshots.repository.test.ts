import { describe, it, expect } from "vitest";
import { v4 as uuid } from "uuid";
import { createHash } from "crypto";
import { setupTestDb } from "./test-helpers";
import * as SnapshotsRepo from "../snapshots/snapshots.repository";

const t = setupTestDb();

async function createProject() {
  const projectId = uuid();
  const now = new Date().toISOString();
  await t.db("projects").insert({
    id: projectId,
    title: "Snapshot Test",
    slug: `snap-${projectId.slice(0, 8)}`,
    mode: "fiction",
    created_at: now,
    updated_at: now,
  });
  return projectId;
}

async function createChapter(projectId: string) {
  const chapterId = uuid();
  const now = new Date().toISOString();
  await t.db("chapters").insert({
    id: chapterId,
    project_id: projectId,
    title: "Test Chapter",
    content: null,
    sort_order: 0,
    word_count: 0,
    status: "draft",
    created_at: now,
    updated_at: now,
  });
  return chapterId;
}

describe("snapshots repository", () => {
  describe("insert() + findById()", () => {
    it("inserts a snapshot and retrieves it by id", async () => {
      const projectId = await createProject();
      const chapterId = await createChapter(projectId);
      const id = uuid();
      const now = new Date().toISOString();

      const data = {
        id,
        chapter_id: chapterId,
        label: "Manual save",
        content: '{"type":"doc","content":[]}',
        word_count: 42,
        is_auto: false,
        created_at: now,
      };

      const inserted = await SnapshotsRepo.insert(t.db, data);
      expect(inserted).toEqual(data);

      const found = await SnapshotsRepo.findById(t.db, id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(id);
      expect(found!.chapter_id).toBe(chapterId);
      expect(found!.label).toBe("Manual save");
      expect(found!.content).toBe('{"type":"doc","content":[]}');
      expect(found!.word_count).toBe(42);
      expect(found!.is_auto).toBe(false);
      expect(found!.created_at).toBe(now);
    });

    it("returns null for non-existing id", async () => {
      const found = await SnapshotsRepo.findById(t.db, uuid());
      expect(found).toBeNull();
    });
  });

  describe("listByChapter()", () => {
    it("returns snapshots newest first, excludes content", async () => {
      const projectId = await createProject();
      const chapterId = await createChapter(projectId);

      const older = {
        id: uuid(),
        chapter_id: chapterId,
        label: "First",
        content: '{"type":"doc","content":[{"type":"paragraph"}]}',
        word_count: 10,
        is_auto: true,
        created_at: "2026-04-01T00:00:00.000Z",
      };
      const newer = {
        id: uuid(),
        chapter_id: chapterId,
        label: null,
        content: '{"type":"doc","content":[]}',
        word_count: 20,
        is_auto: false,
        created_at: "2026-04-02T00:00:00.000Z",
      };

      await SnapshotsRepo.insert(t.db, older);
      await SnapshotsRepo.insert(t.db, newer);

      const list = await SnapshotsRepo.listByChapter(t.db, chapterId);
      expect(list).toHaveLength(2);
      // Newest first
      expect(list[0]!.id).toBe(newer.id);
      expect(list[1]!.id).toBe(older.id);
      // No content field
      expect(list[0]!).not.toHaveProperty("content");
      expect(list[1]!).not.toHaveProperty("content");
      // Has expected fields
      expect(list[0]!).toHaveProperty("word_count");
      expect(list[0]).toHaveProperty("is_auto");
      expect(list[0]).toHaveProperty("created_at");
    });

    it("returns empty array when no snapshots exist", async () => {
      const projectId = await createProject();
      const chapterId = await createChapter(projectId);

      const list = await SnapshotsRepo.listByChapter(t.db, chapterId);
      expect(list).toEqual([]);
    });
  });

  describe("remove()", () => {
    it("returns 1 for existing snapshot", async () => {
      const projectId = await createProject();
      const chapterId = await createChapter(projectId);
      const id = uuid();

      await SnapshotsRepo.insert(t.db, {
        id,
        chapter_id: chapterId,
        label: null,
        content: "{}",
        word_count: 0,
        is_auto: false,
        created_at: new Date().toISOString(),
      });

      const count = await SnapshotsRepo.remove(t.db, id);
      expect(count).toBe(1);

      const found = await SnapshotsRepo.findById(t.db, id);
      expect(found).toBeNull();
    });

    it("returns 0 for non-existing snapshot", async () => {
      const count = await SnapshotsRepo.remove(t.db, uuid());
      expect(count).toBe(0);
    });
  });

  describe("getLatestContentHash()", () => {
    it("returns null when no snapshots exist for chapter", async () => {
      const projectId = await createProject();
      const chapterId = await createChapter(projectId);

      const hash = await SnapshotsRepo.getLatestContentHash(t.db, chapterId);
      expect(hash).toBeNull();
    });

    it("returns sha256 hash of latest snapshot content", async () => {
      const projectId = await createProject();
      const chapterId = await createChapter(projectId);
      const content = '{"type":"doc","content":[{"type":"paragraph"}]}';

      await SnapshotsRepo.insert(t.db, {
        id: uuid(),
        chapter_id: chapterId,
        label: null,
        content: "older content",
        word_count: 5,
        is_auto: true,
        created_at: "2026-04-01T00:00:00.000Z",
      });

      await SnapshotsRepo.insert(t.db, {
        id: uuid(),
        chapter_id: chapterId,
        label: null,
        content,
        word_count: 10,
        is_auto: true,
        created_at: "2026-04-02T00:00:00.000Z",
      });

      const hash = await SnapshotsRepo.getLatestContentHash(t.db, chapterId);
      const expected = createHash("sha256").update(content).digest("hex");
      expect(hash).toBe(expected);
    });
  });

  describe("FK cascade on chapter delete", () => {
    it("deletes snapshots automatically when parent chapter is hard-deleted", async () => {
      const projectId = await createProject();
      const chapterId = await createChapter(projectId);

      await SnapshotsRepo.insert(t.db, {
        id: uuid(),
        chapter_id: chapterId,
        label: null,
        content: "a",
        word_count: 1,
        is_auto: true,
        created_at: "2026-04-01T00:00:00.000Z",
      });
      await SnapshotsRepo.insert(t.db, {
        id: uuid(),
        chapter_id: chapterId,
        label: null,
        content: "b",
        word_count: 2,
        is_auto: false,
        created_at: "2026-04-02T00:00:00.000Z",
      });

      // Hard-delete the parent chapter; cascade should remove the snapshots.
      await t.db("chapters").where({ id: chapterId }).delete();

      const list = await SnapshotsRepo.listByChapter(t.db, chapterId);
      expect(list).toEqual([]);
    });
  });
});
