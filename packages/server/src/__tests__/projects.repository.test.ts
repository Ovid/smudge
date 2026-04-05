import { describe, it, expect } from "vitest";
import { v4 as uuid } from "uuid";
import { setupTestDb } from "./test-helpers";
import * as ProjectRepo from "../projects/projects.repository";

const t = setupTestDb();

function makeProject(overrides: Partial<{ id: string; title: string; slug: string; mode: string }> = {}) {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? uuid(),
    title: overrides.title ?? "Test Project",
    slug: overrides.slug ?? "test-project",
    mode: overrides.mode ?? "fiction",
    created_at: now,
    updated_at: now,
  };
}

describe("projects repository", () => {
  describe("insert() + findById()", () => {
    it("round-trips a project", async () => {
      const data = makeProject();
      const inserted = await ProjectRepo.insert(t.db, data);
      expect(inserted.id).toBe(data.id);
      expect(inserted.title).toBe(data.title);
      expect(inserted.slug).toBe(data.slug);
      expect(inserted.mode).toBe(data.mode);

      const found = await ProjectRepo.findById(t.db, data.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(data.id);
      expect(found!.title).toBe(data.title);
    });

    it("findById() returns undefined for nonexistent id", async () => {
      const found = await ProjectRepo.findById(t.db, uuid());
      expect(found).toBeUndefined();
    });
  });

  describe("findBySlug()", () => {
    it("finds a project by slug", async () => {
      const data = makeProject({ slug: "my-slug" });
      await ProjectRepo.insert(t.db, data);
      const found = await ProjectRepo.findBySlug(t.db, "my-slug");
      expect(found).toBeDefined();
      expect(found!.id).toBe(data.id);
    });

    it("excludes deleted projects", async () => {
      const data = makeProject({ slug: "deleted-slug" });
      await ProjectRepo.insert(t.db, data);
      await ProjectRepo.softDelete(t.db, data.id, new Date().toISOString());
      const found = await ProjectRepo.findBySlug(t.db, "deleted-slug");
      expect(found).toBeUndefined();
    });
  });

  describe("findByTitle()", () => {
    it("finds a project by title", async () => {
      const data = makeProject({ title: "Unique Title", slug: "unique-title" });
      await ProjectRepo.insert(t.db, data);
      const found = await ProjectRepo.findByTitle(t.db, "Unique Title");
      expect(found).toBeDefined();
      expect(found!.id).toBe(data.id);
    });

    it("returns undefined when title does not exist", async () => {
      const found = await ProjectRepo.findByTitle(t.db, "Nonexistent");
      expect(found).toBeUndefined();
    });

    it("excludes a project with excludeId", async () => {
      const data = makeProject({ title: "Same Title", slug: "same-title" });
      await ProjectRepo.insert(t.db, data);
      const found = await ProjectRepo.findByTitle(t.db, "Same Title", data.id);
      expect(found).toBeUndefined();
    });

    it("finds other projects with same title when excludeId does not match", async () => {
      const data = makeProject({ title: "Shared Title", slug: "shared-1" });
      await ProjectRepo.insert(t.db, data);
      const found = await ProjectRepo.findByTitle(t.db, "Shared Title", uuid());
      expect(found).toBeDefined();
      expect(found!.id).toBe(data.id);
    });
  });

  describe("resolveUniqueSlug()", () => {
    it("returns base slug when available", async () => {
      const slug = await ProjectRepo.resolveUniqueSlug(t.db, "fresh-slug");
      expect(slug).toBe("fresh-slug");
    });

    it("returns suffixed slug on collision", async () => {
      const data = makeProject({ slug: "taken-slug" });
      await ProjectRepo.insert(t.db, data);
      const slug = await ProjectRepo.resolveUniqueSlug(t.db, "taken-slug");
      expect(slug).toBe("taken-slug-2");
    });

    it("increments suffix when multiple collisions exist", async () => {
      await ProjectRepo.insert(t.db, makeProject({ slug: "dup", title: "A" }));
      await ProjectRepo.insert(t.db, makeProject({ slug: "dup-2", title: "B" }));
      const slug = await ProjectRepo.resolveUniqueSlug(t.db, "dup");
      expect(slug).toBe("dup-3");
    });

    it("excludes a project by excludeProjectId", async () => {
      const data = makeProject({ slug: "my-slug" });
      await ProjectRepo.insert(t.db, data);
      const slug = await ProjectRepo.resolveUniqueSlug(t.db, "my-slug", data.id);
      expect(slug).toBe("my-slug");
    });
  });

  describe("listAll()", () => {
    it("returns empty array when no projects", async () => {
      const list = await ProjectRepo.listAll(t.db);
      expect(list).toEqual([]);
    });

    it("returns projects with total word counts", async () => {
      const projectId = uuid();
      const now = new Date().toISOString();
      await ProjectRepo.insert(t.db, makeProject({ id: projectId, slug: "list-test" }));

      // Add a chapter with word count
      await t.db("chapters").insert({
        id: uuid(),
        project_id: projectId,
        title: "Ch 1",
        content: JSON.stringify({ type: "doc", content: [] }),
        sort_order: 0,
        word_count: 100,
        created_at: now,
        updated_at: now,
      });
      await t.db("chapters").insert({
        id: uuid(),
        project_id: projectId,
        title: "Ch 2",
        content: JSON.stringify({ type: "doc", content: [] }),
        sort_order: 1,
        word_count: 200,
        created_at: now,
        updated_at: now,
      });

      const list = await ProjectRepo.listAll(t.db);
      expect(list).toHaveLength(1);
      expect(list[0].total_word_count).toBe(300);
    });

    it("excludes deleted projects", async () => {
      const data = makeProject({ slug: "to-delete" });
      await ProjectRepo.insert(t.db, data);
      await ProjectRepo.softDelete(t.db, data.id, new Date().toISOString());
      const list = await ProjectRepo.listAll(t.db);
      expect(list).toEqual([]);
    });

    it("excludes word counts from deleted chapters", async () => {
      const projectId = uuid();
      const now = new Date().toISOString();
      await ProjectRepo.insert(t.db, makeProject({ id: projectId, slug: "wc-test" }));

      const chId = uuid();
      await t.db("chapters").insert({
        id: chId,
        project_id: projectId,
        title: "Deleted Ch",
        content: JSON.stringify({ type: "doc", content: [] }),
        sort_order: 0,
        word_count: 500,
        created_at: now,
        updated_at: now,
        deleted_at: now,
      });

      const list = await ProjectRepo.listAll(t.db);
      expect(list).toHaveLength(1);
      expect(list[0].total_word_count).toBe(0);
    });
  });

  describe("update()", () => {
    it("updates and returns the project", async () => {
      const data = makeProject({ slug: "update-test" });
      await ProjectRepo.insert(t.db, data);
      const updated = await ProjectRepo.update(t.db, data.id, {
        title: "Updated Title",
        slug: "updated-title",
      });
      expect(updated.title).toBe("Updated Title");
      expect(updated.slug).toBe("updated-title");
    });
  });

  describe("updateTimestamp()", () => {
    it("touches updated_at", async () => {
      const data = makeProject({ slug: "ts-test" });
      const inserted = await ProjectRepo.insert(t.db, data);
      const originalUpdatedAt = inserted.updated_at;

      // Small delay to ensure different timestamp
      await new Promise((r) => setTimeout(r, 10));
      await ProjectRepo.updateTimestamp(t.db, data.id);

      const found = await ProjectRepo.findById(t.db, data.id);
      expect(found!.updated_at).not.toBe(originalUpdatedAt);
    });
  });

  describe("softDelete()", () => {
    it("sets deleted_at so findById returns undefined", async () => {
      const data = makeProject({ slug: "soft-del" });
      await ProjectRepo.insert(t.db, data);
      await ProjectRepo.softDelete(t.db, data.id, new Date().toISOString());

      const found = await ProjectRepo.findById(t.db, data.id);
      expect(found).toBeUndefined();
    });

    it("findByIdIncludingDeleted still returns the project", async () => {
      const data = makeProject({ slug: "soft-del-2" });
      await ProjectRepo.insert(t.db, data);
      const now = new Date().toISOString();
      await ProjectRepo.softDelete(t.db, data.id, now);

      const found = await ProjectRepo.findByIdIncludingDeleted(t.db, data.id);
      expect(found).toBeDefined();
      expect(found!.deleted_at).toBe(now);
    });
  });
});
