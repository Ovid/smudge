import { describe, it, expect, afterEach, vi } from "vitest";
import { v4 as uuid } from "uuid";
import { setupTestDb } from "./test-helpers";
import { setVelocityService, resetVelocityService } from "../velocity/velocity.injectable";
import { logger } from "../logger";
import {
  updateChapter,
  deleteChapter,
  restoreChapter,
  getChapter,
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
    status: "outline",
    created_at: now,
    updated_at: now,
  });
  return { projectId, chapterId };
}

describe("chapters.service", () => {
  describe("updateChapter()", () => {
    it("succeeds even when velocity recordSave throws", async () => {
      const { chapterId } = await createProjectAndChapter();
      const spy = vi.spyOn(logger, "error").mockImplementation(() => {});

      try {
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
        expect(spy).toHaveBeenCalledWith(
          expect.objectContaining({
            project_id: expect.any(String),
            chapter_id: chapterId,
          }),
          "Velocity recordSave failed (best-effort)",
        );
      } finally {
        spy.mockRestore();
      }
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
      const spy = vi.spyOn(logger, "error").mockImplementation(() => {});

      try {
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
        expect(spy).toHaveBeenCalledWith(
          expect.objectContaining({
            project_id: expect.any(String),
            chapter_id: chapterId,
          }),
          "Velocity updateDailySnapshot failed (best-effort)",
        );
      } finally {
        spy.mockRestore();
      }
    });

    it("returns false for a non-existent chapter", async () => {
      const result = await deleteChapter(uuid());
      expect(result).toBe(false);
    });
  });

  describe("restoreChapter()", () => {
    it("succeeds even when velocity updateDailySnapshot throws", async () => {
      const { chapterId } = await createProjectAndChapter();
      const spy = vi.spyOn(logger, "error").mockImplementation(() => {});

      try {
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
        expect(result).not.toBe("parent_purged");
        expect(result).not.toBe("chapter_purged");
        expect(result).not.toBe("conflict");
        expect(spy).toHaveBeenCalledWith(
          expect.objectContaining({
            project_id: expect.any(String),
            chapter_id: chapterId,
          }),
          "Velocity updateDailySnapshot failed (best-effort)",
        );
      } finally {
        spy.mockRestore();
      }
    });

    it("returns 'chapter_purged' when chapter is purged mid-transaction", async () => {
      const { chapterId } = await createProjectAndChapter();

      // Soft-delete so findDeletedChapterById will find it
      const now = new Date().toISOString();
      await t.db("chapters").where({ id: chapterId }).update({ deleted_at: now });

      // Hard-delete so the restore UPDATE inside the transaction finds 0 rows
      await t.db("chapters").where({ id: chapterId }).del();

      // Re-insert as soft-deleted so findDeletedChapterById succeeds (outside tx),
      // but then hard-delete before the service calls restore inside the tx.
      // Since SQLite is synchronous and single-threaded, we simulate the race
      // by spying on the store's restoreChapter to return 0.
      const { getProjectStore } = await import("../stores/project-store.injectable");
      const store = getProjectStore();

      // Re-insert for findDeletedChapterById to find
      await t.db("chapters").insert({
        id: chapterId,
        project_id: (await t.db("projects").first()).id,
        title: "Purged Chapter",
        sort_order: 0,
        word_count: 0,
        created_at: now,
        updated_at: now,
        deleted_at: now,
      });

      // Spy on transaction to intercept the txStore's restoreChapter
      const origTransaction = store.transaction.bind(store);
      vi.spyOn(store, "transaction").mockImplementation(async (fn) => {
        return origTransaction(async (txStore) => {
          const origRestore = txStore.restoreChapter.bind(txStore);
          vi.spyOn(txStore, "restoreChapter").mockImplementation(async () => {
            // Simulate: chapter was purged between lookup and restore
            return 0;
          });
          try {
            return await fn(txStore);
          } finally {
            txStore.restoreChapter = origRestore;
          }
        });
      });

      try {
        const result = await restoreChapter(chapterId);
        expect(result).toBe("chapter_purged");
      } finally {
        vi.restoreAllMocks();
      }
    });

    it("returns restored chapter when another request already restored it (double-restore)", async () => {
      const { chapterId } = await createProjectAndChapter();

      // Soft-delete the chapter so findDeletedChapterById will find it
      const now = new Date().toISOString();
      await t.db("chapters").where({ id: chapterId }).update({ deleted_at: now });

      // Simulate: between findDeletedChapterById (outside tx) and restoreChapter (inside tx),
      // another request restored the chapter. We do this by restoring it before our call,
      // but making findDeletedChapterById still find it via a spy.
      await t.db("chapters").where({ id: chapterId }).update({ deleted_at: null });

      // Spy on the store so findDeletedChapterById returns the chapter as if still deleted,
      // but the actual restore UPDATE inside the transaction finds 0 rows (deleted_at is NULL).
      const { getProjectStore } = await import("../stores/project-store.injectable");
      const store = getProjectStore();
      vi.spyOn(store, "findDeletedChapterById").mockImplementation(async (id) => {
        // Return the chapter as if it were still deleted (simulating the race window)
        const row = await t.db("chapters").where({ id }).first();
        return row ?? null;
      });

      try {
        const result = await restoreChapter(chapterId);
        // Should NOT return "chapter_purged" — the chapter exists and is active
        expect(result).not.toBe("chapter_purged");
        expect(result).not.toBeNull();
        expect(result).not.toBe("read_failure");
        // Should return the chapter data (successful restore response)
        expect(typeof result).toBe("object");
        expect((result as { id: string }).id).toBe(chapterId);
      } finally {
        vi.restoreAllMocks();
      }
    });

    it("returns 'parent_purged' when parent project has been hard-deleted", async () => {
      const { chapterId, projectId } = await createProjectAndChapter();

      // Soft-delete the chapter
      const now = new Date().toISOString();
      await t.db("chapters").where({ id: chapterId }).update({ deleted_at: now });

      // Hard-delete the project (simulating a purge)
      await t.db.raw("PRAGMA foreign_keys = OFF");
      await t.db("projects").where({ id: projectId }).del();
      await t.db.raw("PRAGMA foreign_keys = ON");

      const result = await restoreChapter(chapterId);
      expect(result).toBe("parent_purged");
    });

    it("resolves slug conflict by generating a new slug when restoring a deleted project", async () => {
      const slug = `conflict-slug-${uuid().slice(0, 8)}`;
      const { chapterId, projectId } = await createProjectAndChapter();

      // Give the project a known slug, then soft-delete it and its chapter
      const now = new Date().toISOString();
      await t.db("projects").where({ id: projectId }).update({ slug, title: slug });
      await t.db("chapters").where({ id: chapterId }).update({ deleted_at: now });
      await t.db("projects").where({ id: projectId }).update({ deleted_at: now });

      // Create a new active project that occupies the same slug
      const newProjectId = uuid();
      await t.db("projects").insert({
        id: newProjectId,
        title: `Occupier ${newProjectId.slice(0, 8)}`,
        slug,
        mode: "fiction",
        created_at: now,
        updated_at: now,
      });

      // Restore succeeds — resolveUniqueSlug generates a new slug
      const result = await restoreChapter(chapterId);
      expect(result).not.toBeNull();
      expect(result).not.toBe("conflict");
      expect(result).not.toBe("parent_purged");
      expect(result).not.toBe("chapter_purged");
      expect(typeof result).toBe("object");
      // Restored project gets a different slug
      expect((result as { project_slug: string }).project_slug).toBe(`${slug}-2`);
    });
  });

  describe("restoreChapter() — parent project deleted_at branch", () => {
    it("restores parent project when it is soft-deleted (sets deleted_at null, updates slug)", async () => {
      const { chapterId, projectId } = await createProjectAndChapter();

      // Soft-delete both project and chapter
      const now = new Date().toISOString();
      await t.db("projects").where({ id: projectId }).update({ deleted_at: now });
      await t.db("chapters").where({ id: chapterId }).update({ deleted_at: now });

      const result = await restoreChapter(chapterId);

      expect(result).not.toBeNull();
      expect(result).not.toBe("parent_purged");
      expect(result).not.toBe("chapter_purged");
      expect(typeof result).toBe("object");

      // Verify the project was un-deleted
      const project = await t.db("projects").where({ id: projectId }).first();
      expect(project.deleted_at).toBeNull();
    });
  });

  describe("restoreChapter() — image ref increment on restore", () => {
    it("increments image reference counts for images in restored chapter content", async () => {
      const { chapterId, projectId } = await createProjectAndChapter();
      const imageId = uuid();

      // Insert an image record
      await t.db("images").insert({
        id: imageId,
        project_id: projectId,
        filename: "test.png",
        mime_type: "image/png",
        size_bytes: 100,
        reference_count: 0,
        created_at: new Date().toISOString(),
      });

      // Update chapter content to include an image reference
      const contentWithImage = {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "hello" }] },
          { type: "image", attrs: { src: `/api/images/${imageId}` } },
        ],
      };
      await t
        .db("chapters")
        .where({ id: chapterId })
        .update({ content: JSON.stringify(contentWithImage) });

      // Soft-delete the chapter
      const now = new Date().toISOString();
      await t.db("chapters").where({ id: chapterId }).update({ deleted_at: now });

      const result = await restoreChapter(chapterId);
      expect(result).not.toBeNull();
      expect(typeof result).toBe("object");

      // Check that the image reference count was incremented
      const image = await t.db("images").where({ id: imageId }).first();
      expect(image.reference_count).toBe(1);
    });

    it("handles corrupt content gracefully during image ref increment on restore", async () => {
      const logSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
      // applyImageRefDiff logs a warn when it can't parse the corrupt
      // content before aborting the diff. Spy + assert rather than
      // letting it pollute test stderr.
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const { chapterId } = await createProjectAndChapter();

      // Set content to corrupt JSON
      await t.db("chapters").where({ id: chapterId }).update({ content: "{not valid json!!!" });

      // Soft-delete the chapter
      const now = new Date().toISOString();
      await t.db("chapters").where({ id: chapterId }).update({ deleted_at: now });

      // Should not throw — corrupt content catch block handles it
      const result = await restoreChapter(chapterId);
      expect(result).not.toBeNull();
      expect(typeof result).toBe("object");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ project_id: expect.any(String) }),
        "applyImageRefDiff: newContent JSON.parse failed; aborting diff to avoid mass decrement",
      );
      logSpy.mockRestore();
      warnSpy.mockRestore();
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
      expect(result).toMatchObject({ status_label: "Outline" });
    });
  });
});
