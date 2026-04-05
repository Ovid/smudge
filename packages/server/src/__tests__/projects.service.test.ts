import { describe, it, expect } from "vitest";
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
  });
});
