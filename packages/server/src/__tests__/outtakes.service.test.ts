import { describe, it, expect } from "vitest";
import { randomUUID as uuid } from "node:crypto";
import { setupTestDb } from "./test-helpers";
import {
  createOuttake,
  listOuttakes,
  updateOuttakeLabel,
  deleteOuttake,
} from "../outtakes/outtakes.service";

const t = setupTestDb();

const DOC_WITH_IMAGE = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "keep me" }] },
    { type: "image", attrs: { src: "/api/images/abc" } },
  ],
};

async function createProject(overrides: { deleted_at?: string | null } = {}): Promise<string> {
  const projectId = uuid();
  const now = new Date().toISOString();
  await t.db("projects").insert({
    id: projectId,
    title: `Test Project ${projectId.slice(0, 8)}`,
    slug: `test-${projectId.slice(0, 8)}`,
    mode: "fiction",
    created_at: now,
    updated_at: now,
    deleted_at: overrides.deleted_at ?? null,
  });
  return projectId;
}

describe("outtakes.service", () => {
  describe("createOuttake()", () => {
    it("strips image nodes and stores parsed sibling content", async () => {
      const projectId = await createProject();
      const result = await createOuttake(projectId, DOC_WITH_IMAGE, "Cut scene");

      expect(result).not.toBeNull();
      const outtake = result!;
      expect(outtake.project_id).toBe(projectId);
      expect(outtake.label).toBe("Cut scene");
      expect(outtake.id).toBeDefined();
      const flat = JSON.stringify(outtake.content);
      expect(flat).not.toContain("image");
      expect(flat).toContain("keep me");
    });

    it("coerces an empty-string label to null", async () => {
      const projectId = await createProject();
      const result = await createOuttake(projectId, DOC_WITH_IMAGE, "");
      expect(result!.label).toBeNull();
    });

    it("returns null when the project is soft-deleted", async () => {
      const projectId = await createProject({ deleted_at: new Date().toISOString() });
      const result = await createOuttake(projectId, DOC_WITH_IMAGE, "Cut scene");
      expect(result).toBeNull();
    });

    it("returns null for a nonexistent project", async () => {
      const result = await createOuttake(uuid(), DOC_WITH_IMAGE);
      expect(result).toBeNull();
    });
  });

  describe("listOuttakes()", () => {
    it("returns [] for a live project with no outtakes", async () => {
      const projectId = await createProject();
      expect(await listOuttakes(projectId)).toEqual([]);
    });

    it("returns rows newest-first", async () => {
      const projectId = await createProject();
      const first = await createOuttake(projectId, DOC_WITH_IMAGE, "first");
      const second = await createOuttake(projectId, DOC_WITH_IMAGE, "second");
      const list = await listOuttakes(projectId);
      expect(list).not.toBeNull();
      expect(list!.map((o) => o.id)).toEqual([second!.id, first!.id]);
    });

    it("returns null for a soft-deleted project", async () => {
      const projectId = await createProject({ deleted_at: new Date().toISOString() });
      expect(await listOuttakes(projectId)).toBeNull();
    });

    it("returns null for a nonexistent project", async () => {
      expect(await listOuttakes(uuid())).toBeNull();
    });
  });

  describe("updateOuttakeLabel()", () => {
    it("updates the label and bumps updated_at", async () => {
      const projectId = await createProject();
      const created = await createOuttake(projectId, DOC_WITH_IMAGE, "old");
      // Ensure a distinct timestamp from creation.
      await new Promise((r) => setTimeout(r, 5));
      const updated = await updateOuttakeLabel(created!.id, "new");
      expect(updated).not.toBeNull();
      expect(updated!.label).toBe("new");
      expect(updated!.updated_at >= created!.updated_at).toBe(true);
      expect(updated!.updated_at).not.toBe(created!.created_at);
    });

    it("returns null for an unknown id", async () => {
      expect(await updateOuttakeLabel(uuid(), "x")).toBeNull();
    });

    it("returns null when the parent project is soft-deleted", async () => {
      const projectId = await createProject();
      const created = await createOuttake(projectId, DOC_WITH_IMAGE, "old");
      await t.db("projects").where({ id: projectId }).update({ deleted_at: new Date().toISOString() });
      expect(await updateOuttakeLabel(created!.id, "new")).toBeNull();
    });
  });

  describe("deleteOuttake()", () => {
    it("hard-deletes and returns true", async () => {
      const projectId = await createProject();
      const created = await createOuttake(projectId, DOC_WITH_IMAGE, "gone");
      expect(await deleteOuttake(created!.id)).toBe(true);
      expect(await listOuttakes(projectId)).toEqual([]);
    });

    it("returns false for an unknown id", async () => {
      expect(await deleteOuttake(uuid())).toBe(false);
    });

    it("returns false when the parent project is soft-deleted", async () => {
      const projectId = await createProject();
      const created = await createOuttake(projectId, DOC_WITH_IMAGE, "gone");
      await t.db("projects").where({ id: projectId }).update({ deleted_at: new Date().toISOString() });
      expect(await deleteOuttake(created!.id)).toBe(false);
    });
  });
});
