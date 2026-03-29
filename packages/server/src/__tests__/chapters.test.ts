import { describe, it, expect } from "vitest";
import request from "supertest";
import { setupTestDb } from "./test-helpers";

const t = setupTestDb();

/** Helper: create a project and return its id + first chapter id */
async function createProjectWithChapter(app: ReturnType<typeof setupTestDb>["app"]) {
  const projectRes = await request(app)
    .post("/api/projects")
    .send({ title: "Test Project", mode: "fiction" });
  const projectId = projectRes.body.id;

  const getRes = await request(app).get(`/api/projects/${projectId}`);
  const chapterId = getRes.body.chapters[0].id;

  return { projectId, chapterId };
}

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

    const res = await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ content });

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

    const res = await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for non-existent chapter", async () => {
    const res = await request(t.app)
      .patch("/api/chapters/nonexistent-id")
      .send({ title: "Nope" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("preserves content on invalid update", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);

    const validContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Original" }] }],
    };

    // Save valid content first
    await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ content: validContent });

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
