import { describe, it, expect } from "vitest";
import request from "supertest";
import { setupTestDb } from "./test-helpers";

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
    expect(res.body.title).toBe("Untitled Chapter");
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
    expect(res.body.title).toBe("Untitled Chapter");
  });

  it("returns 404 for non-existent chapter", async () => {
    const res = await request(t.app).get("/api/chapters/nonexistent-id");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
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

  it("returns 404 for non-existent chapter", async () => {
    const res = await request(t.app).post("/api/chapters/nonexistent-id/restore");

    expect(res.status).toBe(404);
  });

  it("returns 404 for a chapter that is not deleted", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);

    const res = await request(t.app).post(`/api/chapters/${chapterId}/restore`);

    expect(res.status).toBe(404);
  });
});
