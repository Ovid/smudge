import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { UNTITLED_CHAPTER } from "@smudge/shared";
import { setupTestDb } from "./test-helpers";
import { logger } from "../logger";

const t = setupTestDb();

/** Helper: create a project and return its id, slug, + first chapter id */
async function createProjectWithChapter(app: ReturnType<typeof setupTestDb>["app"]) {
  const projectRes = await request(app)
    .post("/api/projects")
    .send({ title: "Test Project", mode: "fiction" });
  const projectId = projectRes.body.id;
  const projectSlug = projectRes.body.slug;

  const getRes = await request(app).get(`/api/projects/${projectSlug}`);
  const chapterId = getRes.body.chapters[0].id;

  return { projectId, projectSlug, chapterId };
}

describe("POST /api/projects/:id/chapters", () => {
  it("creates a new chapter appended to end", async () => {
    const { projectId, projectSlug } = await createProjectWithChapter(t.app);

    const res = await request(t.app).post(`/api/projects/${projectSlug}/chapters`).send();

    expect(res.status).toBe(201);
    expect(res.body.title).toBe(UNTITLED_CHAPTER);
    expect(res.body.project_id).toBe(projectId);
    expect(res.body.sort_order).toBe(1); // after the auto-created chapter at 0
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request(t.app).post("/api/projects/nonexistent-id/chapters").send();

    expect(res.status).toBe(404);
  });

  it("returns 404 for deleted project", async () => {
    const { projectSlug } = await createProjectWithChapter(t.app);
    await request(t.app).delete(`/api/projects/${projectSlug}`);

    const res = await request(t.app).post(`/api/projects/${projectSlug}/chapters`).send();

    expect(res.status).toBe(404);
  });

  it("increments sort_order for each new chapter", async () => {
    const { projectSlug } = await createProjectWithChapter(t.app);

    await request(t.app).post(`/api/projects/${projectSlug}/chapters`).send();
    const res = await request(t.app).post(`/api/projects/${projectSlug}/chapters`).send();

    expect(res.body.sort_order).toBe(2);
  });
});

describe("GET /api/chapters/:id", () => {
  it("returns chapter by id", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);

    const res = await request(t.app).get(`/api/chapters/${chapterId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(chapterId);
    expect(res.body.title).toBe(UNTITLED_CHAPTER);
  });

  it("returns 404 for non-existent chapter", async () => {
    const res = await request(t.app).get("/api/chapters/nonexistent-id");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 500 CORRUPT_CONTENT when chapter has corrupt JSON in DB", async () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const { chapterId } = await createProjectWithChapter(t.app);

    // Directly corrupt the content in the DB (bypassing the API validation)
    await t.db("chapters").where({ id: chapterId }).update({ content: "{invalid json!!!" });

    const res = await request(t.app).get(`/api/chapters/${chapterId}`);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("CORRUPT_CONTENT");
    expect(res.body.error.message).toContain("corrupted");
    errorSpy.mockRestore();
  });
});

describe("PATCH /api/chapters/:id", () => {
  it("updates chapter content", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);

    const content = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }],
    };

    const res = await request(t.app).patch(`/api/chapters/${chapterId}`).send({ content });

    expect(res.status).toBe(200);
    expect(res.body.content).toEqual(content);
  });

  it("updates chapter title", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);

    const res = await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ title: "Chapter One" });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Chapter One");
  });

  it("returns 400 when content has wrong root type", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);

    const res = await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ content: { type: "paragraph" } });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when body is empty", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);

    const res = await request(t.app).patch(`/api/chapters/${chapterId}`).send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for non-existent chapter", async () => {
    const res = await request(t.app).patch("/api/chapters/nonexistent-id").send({ title: "Nope" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 for soft-deleted chapter", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);
    await t
      .db("chapters")
      .where({ id: chapterId })
      .update({ deleted_at: new Date().toISOString() });

    const res = await request(t.app).patch(`/api/chapters/${chapterId}`).send({ title: "Nope" });

    expect(res.status).toBe(404);
  });

  it("updates chapter status", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);

    const res = await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ status: "rough_draft" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("rough_draft");
  });

  it("returns 400 for invalid status", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);

    const res = await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ status: "invalid_status" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns chapter with status in response", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);

    const res = await request(t.app).get(`/api/chapters/${chapterId}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("outline");
  });

  it("GET /api/projects/:slug includes chapter status and status_label", async () => {
    const { projectSlug, chapterId } = await createProjectWithChapter(t.app);

    await request(t.app).patch(`/api/chapters/${chapterId}`).send({ status: "edited" });

    const res = await request(t.app).get(`/api/projects/${projectSlug}`);

    expect(res.status).toBe(200);
    expect(res.body.chapters[0].status).toBe("edited");
    expect(res.body.chapters[0].status_label).toBe("Edited");
  });

  it("returns 400 when status is valid in schema but missing from DB", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);

    // Remove a status from the DB table to simulate drift between Zod enum and DB
    await t.db("chapter_statuses").where({ status: "final" }).del();

    try {
      const res = await request(t.app)
        .patch(`/api/chapters/${chapterId}`)
        .send({ status: "final" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.message).toContain("Invalid status");
    } finally {
      // Restore the deleted row so subsequent tests see all statuses
      await t.db("chapter_statuses").insert({ status: "final", sort_order: 5, label: "Final" });
    }
  });

  it("preserves content on invalid update", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);

    const validContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Original" }] }],
    };

    // Save valid content first
    await request(t.app).patch(`/api/chapters/${chapterId}`).send({ content: validContent });

    // Attempt invalid update
    const badRes = await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ content: { type: "paragraph" } });
    expect(badRes.status).toBe(400);

    // Verify original content preserved
    const getRes = await request(t.app).get(`/api/chapters/${chapterId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.content).toEqual(validContent);
  });

  it("succeeds for title-only update even when chapter has corrupt content", async () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const { chapterId } = await createProjectWithChapter(t.app);

    // Directly corrupt the content in the DB
    await t.db("chapters").where({ id: chapterId }).update({ content: "{invalid json!!!" });

    // PATCH only the title — should succeed despite corrupt content
    const res = await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ title: "New Title" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("New Title");
    errorSpy.mockRestore();
  });
});

describe("DELETE /api/chapters/:id", () => {
  it("soft-deletes a chapter", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);

    const res = await request(t.app).delete(`/api/chapters/${chapterId}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Chapter moved to trash.");
  });

  it("returns 404 for non-existent chapter", async () => {
    const res = await request(t.app).delete("/api/chapters/nonexistent-id");

    expect(res.status).toBe(404);
  });

  it("returns 404 for already-deleted chapter", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);
    await request(t.app).delete(`/api/chapters/${chapterId}`);

    const res = await request(t.app).delete(`/api/chapters/${chapterId}`);

    expect(res.status).toBe(404);
  });

  it("chapter no longer appears in project chapters after delete", async () => {
    const { projectSlug, chapterId } = await createProjectWithChapter(t.app);
    await request(t.app).delete(`/api/chapters/${chapterId}`);

    const projectRes = await request(t.app).get(`/api/projects/${projectSlug}`);

    expect(projectRes.body.chapters).toHaveLength(0);
  });
});

describe("POST /api/chapters/:id/restore", () => {
  it("restores a soft-deleted chapter", async () => {
    const { projectSlug, chapterId } = await createProjectWithChapter(t.app);
    await request(t.app).delete(`/api/chapters/${chapterId}`);

    const res = await request(t.app).post(`/api/chapters/${chapterId}/restore`);

    expect(res.status).toBe(200);
    expect(res.body.deleted_at).toBeNull();

    // Chapter should appear in project again
    const projectRes = await request(t.app).get(`/api/projects/${projectSlug}`);
    expect(projectRes.body.chapters).toHaveLength(1);
  });

  it("also restores parent project if it was deleted", async () => {
    const { projectSlug, chapterId } = await createProjectWithChapter(t.app);
    await request(t.app).delete(`/api/chapters/${chapterId}`);
    await request(t.app).delete(`/api/projects/${projectSlug}`);

    const res = await request(t.app).post(`/api/chapters/${chapterId}/restore`);

    expect(res.status).toBe(200);

    // Project should be accessible again
    const projectRes = await request(t.app).get(`/api/projects/${projectSlug}`);
    expect(projectRes.status).toBe(200);
  });

  it("re-slugs restored project when slug is now taken", async () => {
    // Create project A, delete it
    const projectA = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Novel", mode: "fiction" });
    const chapterA = (await request(t.app).get(`/api/projects/${projectA.body.slug}`)).body
      .chapters[0];
    await request(t.app).delete(`/api/chapters/${chapterA.id}`);
    await request(t.app).delete(`/api/projects/${projectA.body.slug}`);

    // Create project B with the same title — slug reuse is allowed after soft-delete
    const projectB = await request(t.app)
      .post("/api/projects")
      .send({ title: "My Novel", mode: "fiction" });
    expect(projectB.body.slug).toBe("my-novel");

    // Restore chapter from A — this also restores project A
    const res = await request(t.app).post(`/api/chapters/${chapterA.id}/restore`);
    expect(res.status).toBe(200);

    // Project A should be accessible with a new slug (not "my-novel", that's taken by B)
    const restoredProject = await t.db("projects").where({ id: projectA.body.id }).first();
    expect(restoredProject.deleted_at).toBeNull();
    expect(restoredProject.slug).toBe("my-novel-2");

    // Project B should be unaffected
    const projectBRes = await request(t.app).get("/api/projects/my-novel");
    expect(projectBRes.status).toBe(200);
    expect(projectBRes.body.id).toBe(projectB.body.id);
  });

  it("returns 404 for non-existent chapter", async () => {
    const res = await request(t.app).post("/api/chapters/nonexistent-id/restore");

    expect(res.status).toBe(404);
  });

  it("returns 404 for a chapter that is not deleted", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);

    const res = await request(t.app).post(`/api/chapters/${chapterId}/restore`);

    expect(res.status).toBe(404);
  });

  it("returns PROJECT_PURGED when parent project has been hard-deleted", async () => {
    const { projectId, chapterId } = await createProjectWithChapter(t.app);

    // Soft-delete the chapter
    await request(t.app).delete(`/api/chapters/${chapterId}`);

    // Temporarily disable FK constraints so we can hard-delete the project
    // while leaving the orphaned chapter behind
    await t.db.raw("PRAGMA foreign_keys = OFF");

    await t.db("chapters").where({ project_id: projectId }).del();
    await t.db("projects").where({ id: projectId }).del();

    // Re-insert just the soft-deleted chapter (no parent project)
    const now = new Date().toISOString();
    await t.db("chapters").insert({
      id: chapterId,
      project_id: projectId,
      title: "Orphaned Chapter",
      sort_order: 0,
      word_count: 0,
      created_at: now,
      updated_at: now,
      deleted_at: now,
    });

    // Re-enable FK constraints
    await t.db.raw("PRAGMA foreign_keys = ON");

    const res = await request(t.app).post(`/api/chapters/${chapterId}/restore`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PROJECT_PURGED");
  });

  it("succeeds when restoring a chapter with corrupt JSON content", async () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const { chapterId } = await createProjectWithChapter(t.app);

    // Soft-delete the chapter
    await request(t.app).delete(`/api/chapters/${chapterId}`);

    // Directly corrupt the content in the DB
    await t.db("chapters").where({ id: chapterId }).update({ content: "{invalid json!!!" });

    // Restore should succeed — corruption is surfaced when the user opens the chapter
    const res = await request(t.app).post(`/api/chapters/${chapterId}/restore`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(chapterId);
    errorSpy.mockRestore();
  });
});

describe("PATCH /api/chapters/:id — target_word_count removed", () => {
  it("ignores target_word_count (column removed)", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);
    const res = await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ title: "Updated Title" });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("target_word_count");
  });
});
