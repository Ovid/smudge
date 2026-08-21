import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "crypto";
import { setupTestDb } from "./test-helpers";
import { logger } from "../logger";
import {
  createProject,
  createChapter,
  getProject,
  deleteProject,
  ProjectTitleExistsError,
} from "../projects/projects.service";
import { getProjectStore } from "../stores/project-store.injectable";

const t = setupTestDb();

describe("projects.service", () => {
  describe("createProject()", () => {
    it("creates a project with an auto-generated first chapter", async () => {
      const result = await createProject({ title: "My Novel", mode: "fiction" });
      expect(result).toHaveProperty("project");
      if (!("project" in result)) throw new Error("unexpected");
      expect(result.project.title).toBe("My Novel");

      const chapters = await t.db("chapters").where({ project_id: result.project.id });
      expect(chapters).toHaveLength(1);
      expect(chapters[0].title).toBe("Untitled Chapter");
      expect(chapters[0].sort_order).toBe(0);
      expect(chapters[0].word_count).toBe(0);
    });

    it("throws ProjectTitleExistsError on duplicate title", async () => {
      await createProject({ title: "Duplicate Title", mode: "fiction" });
      await expect(createProject({ title: "Duplicate Title", mode: "fiction" })).rejects.toThrow(
        ProjectTitleExistsError,
      );
    });

    it("returns validationError for invalid body", async () => {
      const result = await createProject({ mode: "fiction" });
      expect(result).toHaveProperty("validationError");
    });
  });

  describe("createChapter()", () => {
    // OOSI1 (2026-08-21 review, backlog 767fdc1e). The twin of the unguarded
    // enrichChapterWithLabel in chapters.service.restoreChapter: the call runs
    // after the insert transaction commits, so a status-lookup throw turned a
    // COMMITTED chapter into a generic 500 and left the writer with a chapter
    // they were told had not been created. The guard now lives inside
    // enrichChapterWithLabel, which is why one edit closed both sites.
    it("degrades to status-as-label rather than failing a committed insert when the status lookup throws", async () => {
      const created = await createProject({ title: "Enrich Degrade", mode: "fiction" });
      if (!("project" in created)) throw new Error("unexpected");

      const store = getProjectStore();
      const logSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
      vi.spyOn(store, "getStatusLabel").mockRejectedValue(new Error("SQLITE_BUSY"));

      try {
        const result = await createChapter(created.project.slug);

        expect(result).not.toBe("project_not_found");
        expect(result).not.toBe("read_after_create_failure");
        expect(result).toMatchObject({ status_label: "outline", title: "Untitled Chapter" });

        expect(logSpy).toHaveBeenCalledWith(
          expect.objectContaining({ project_id: created.project.id }),
          expect.stringContaining("status as label"),
        );

        // The insert really did commit: two chapters now, not one.
        const chapters = await t.db("chapters").where({ project_id: created.project.id });
        expect(chapters).toHaveLength(2);
      } finally {
        vi.restoreAllMocks();
      }
    });
  });

  describe("getProject()", () => {
    it("returns null for a missing slug", async () => {
      const result = await getProject("nonexistent-slug");
      expect(result).toBeNull();
    });

    it("includes status labels on chapters", async () => {
      const created = await createProject({ title: "Status Test", mode: "fiction" });
      if (!("project" in created)) throw new Error("unexpected");
      const result = await getProject(created.project.slug);
      expect(result).not.toBeNull();
      expect(result!.chapters.length).toBeGreaterThanOrEqual(1);
      for (const ch of result!.chapters) {
        expect(ch).toHaveProperty("status_label");
      }
    });
  });

  describe("deleteProject()", () => {
    it("soft-deletes both the project and its chapters", async () => {
      const created = await createProject({ title: "Delete Me", mode: "fiction" });
      if (!("project" in created)) throw new Error("unexpected");
      const slug = created.project.slug;

      const deleted = await deleteProject(slug);
      expect(deleted).toBe(true);

      // Project should have deleted_at set
      const project = await t.db("projects").where({ id: created.project.id }).first();
      expect(project.deleted_at).not.toBeNull();

      // Chapters should also have deleted_at set
      const chapters = await t.db("chapters").where({ project_id: created.project.id });
      for (const ch of chapters) {
        expect(ch.deleted_at).not.toBeNull();
      }
    });

    it("returns false for a non-existent project slug", async () => {
      const result = await deleteProject("no-such-project");
      expect(result).toBe(false);
    });

    it("decrements reference counts for images referenced by deleted chapters", async () => {
      const created = await createProject({ title: "Has Images", mode: "fiction" });
      if (!("project" in created)) throw new Error("unexpected");
      const projectId = created.project.id;
      const chapter = await t.db("chapters").where({ project_id: projectId }).first();

      // An image referenced once by the chapter, seeded with a refcount of 1.
      const imageId = randomUUID();
      await t.db("images").insert({
        id: imageId,
        project_id: projectId,
        filename: "pic.png",
        mime_type: "image/png",
        size_bytes: 10,
        reference_count: 1,
        created_at: new Date().toISOString(),
      });
      await t
        .db("chapters")
        .where({ id: chapter.id })
        .update({
          content: JSON.stringify({
            type: "doc",
            content: [{ type: "image", attrs: { src: `/api/images/${imageId}` } }],
          }),
        });

      const deleted = await deleteProject(created.project.slug);
      expect(deleted).toBe(true);

      // The reference released by the deleted chapter brings the count to 0.
      const img = await t.db("images").where({ id: imageId }).first();
      expect(img.reference_count).toBe(0);
    });

    it("does not decrement an image belonging to a different project (F-7)", async () => {
      // Project B owns an image with refcount 1.
      const projectB = await createProject({ title: "Owner Project", mode: "fiction" });
      if (!("project" in projectB)) throw new Error("unexpected");
      const foreignImageId = randomUUID();
      await t.db("images").insert({
        id: foreignImageId,
        project_id: projectB.project.id,
        filename: "foreign.png",
        mime_type: "image/png",
        size_bytes: 10,
        reference_count: 1,
        created_at: new Date().toISOString(),
      });

      // Project A's chapter references project B's image via a stale/pasted URL.
      const projectA = await createProject({ title: "Stale Ref Project", mode: "fiction" });
      if (!("project" in projectA)) throw new Error("unexpected");
      const chapterA = await t.db("chapters").where({ project_id: projectA.project.id }).first();
      await t
        .db("chapters")
        .where({ id: chapterA.id })
        .update({
          content: JSON.stringify({
            type: "doc",
            content: [{ type: "image", attrs: { src: `/api/images/${foreignImageId}` } }],
          }),
        });

      // Deleting project A must not touch project B's image ref count.
      expect(await deleteProject(projectA.project.slug)).toBe(true);
      const img = await t.db("images").where({ id: foreignImageId }).first();
      expect(img.reference_count).toBe(1);
    });

    it("skips chapters whose content is not valid JSON during delete", async () => {
      const created = await createProject({ title: "Corrupt Content", mode: "fiction" });
      if (!("project" in created)) throw new Error("unexpected");
      const projectId = created.project.id;
      const chapter = await t.db("chapters").where({ project_id: projectId }).first();
      await t.db("chapters").where({ id: chapter.id }).update({ content: "{not valid json" });
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

      // The unparseable chapter must be skipped, not abort the whole delete.
      await expect(deleteProject(created.project.slug)).resolves.toBe(true);
      const project = await t.db("projects").where({ id: projectId }).first();
      expect(project.deleted_at).not.toBeNull();
      // Skipped, but not in silence — the release path routes through
      // applyImageRefDiff's old-content arm, which now records the anomaly.
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.anything(), project_id: projectId }),
        expect.stringContaining("oldContent"),
      );
      warnSpy.mockRestore();
    });
  });
});
