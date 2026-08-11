import { describe, it, expect } from "vitest";
import { randomUUID as uuid } from "node:crypto";
import { NOTE_MARK_NAME } from "@smudge/shared";
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

const DOC_WITH_NOTE = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "annotated",
          marks: [{ type: NOTE_MARK_NAME, attrs: { text: "private note" } }],
        },
      ],
    },
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

    // Forcing pause (review 2026-07-19 S3): outtakes DELIBERATELY preserve
    // editor-only `note` marks on capture — an outtake is an editor-trusted
    // round-trip surface (only ever shown as plaintext in the panel, or
    // re-inserted into the editor, which is the one surface allowed to render
    // notes). Stripping them would destroy the writer's private commentary on a
    // mere stash-and-restash. If a future change adds an HTML/export render of
    // outtake content it MUST strip notes there (per CLAUDE.md), and whoever
    // decides to scrub on capture instead must consciously flip this test.
    it("preserves editor-only note marks (editor-trusted round-trip surface)", async () => {
      const projectId = await createProject();
      const result = await createOuttake(projectId, DOC_WITH_NOTE, "Cut scene");
      const flat = JSON.stringify(result!.content);
      expect(flat).toContain(NOTE_MARK_NAME);
      expect(flat).toContain("private note");
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
      // Distinct created_at so "newest-first" is unambiguous: same-millisecond
      // rows fall back to the id DESC tiebreak (random UUID), not insertion order.
      await new Promise((r) => setTimeout(r, 5));
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

    it("coerces an empty-string label to null", async () => {
      const projectId = await createProject();
      const created = await createOuttake(projectId, DOC_WITH_IMAGE, "old");
      const updated = await updateOuttakeLabel(created!.id, "");
      expect(updated!.label).toBeNull();
    });

    it("returns null for an unknown id", async () => {
      expect(await updateOuttakeLabel(uuid(), "x")).toBeNull();
    });

    it("returns null when the parent project is soft-deleted", async () => {
      const projectId = await createProject();
      const created = await createOuttake(projectId, DOC_WITH_IMAGE, "old");
      await t
        .db("projects")
        .where({ id: projectId })
        .update({ deleted_at: new Date().toISOString() });
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
      await t
        .db("projects")
        .where({ id: projectId })
        .update({ deleted_at: new Date().toISOString() });
      expect(await deleteOuttake(created!.id)).toBe(false);
    });
  });
});
