import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import { setupTestDb } from "./test-helpers";
import {
  createProject,
  getProject,
  deleteProject,
  ProjectTitleExistsError,
} from "../projects/projects.service";

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

    it("skips chapters whose content is not valid JSON during delete", async () => {
      const created = await createProject({ title: "Corrupt Content", mode: "fiction" });
      if (!("project" in created)) throw new Error("unexpected");
      const projectId = created.project.id;
      const chapter = await t.db("chapters").where({ project_id: projectId }).first();
      await t.db("chapters").where({ id: chapter.id }).update({ content: "{not valid json" });

      // The unparseable chapter must be skipped, not abort the whole delete.
      await expect(deleteProject(created.project.slug)).resolves.toBe(true);
      const project = await t.db("projects").where({ id: projectId }).first();
      expect(project.deleted_at).not.toBeNull();
    });
  });
});
