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

describe("GET /api/projects/:slug/dashboard", () => {
  it("returns chapter list with status and metadata", async () => {
    const { projectSlug, chapterId } = await createProjectWithChapter(t.app);

    const res = await request(t.app).get(`/api/projects/${projectSlug}/dashboard`);

    expect(res.status).toBe(200);
    expect(res.body.chapters).toHaveLength(1);
    expect(res.body.chapters[0].id).toBe(chapterId);
    expect(res.body.chapters[0].title).toBe("Untitled Chapter");
    expect(res.body.chapters[0].status).toBe("outline");
    expect(res.body.chapters[0].status_label).toBe("Outline");
    expect(res.body.chapters[0].word_count).toBe(0);
    expect(res.body.chapters[0].sort_order).toBe(0);
    expect(res.body.chapters[0]).toHaveProperty("updated_at");
  });

  it("returns correct status_summary counts", async () => {
    const { projectSlug, chapterId } = await createProjectWithChapter(t.app);

    // Add a second chapter and change its status
    const ch2Res = await request(t.app).post(`/api/projects/${projectSlug}/chapters`).send();
    await request(t.app).patch(`/api/chapters/${ch2Res.body.id}`).send({ status: "rough_draft" });

    const res = await request(t.app).get(`/api/projects/${projectSlug}/dashboard`);

    expect(res.status).toBe(200);
    expect(res.body.status_summary).toEqual({
      outline: 1,
      rough_draft: 1,
      revised: 0,
      edited: 0,
      final: 0,
    });
  });

  it("returns correct totals", async () => {
    const { projectSlug, chapterId } = await createProjectWithChapter(t.app);

    const content = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }],
    };
    await request(t.app).patch(`/api/chapters/${chapterId}`).send({ content });

    const res = await request(t.app).get(`/api/projects/${projectSlug}/dashboard`);

    expect(res.status).toBe(200);
    expect(res.body.totals.word_count).toBe(2);
    expect(res.body.totals.chapter_count).toBe(1);
    expect(res.body.totals.most_recent_edit).toBeTruthy();
    expect(res.body.totals.least_recent_edit).toBeTruthy();
  });

  it("excludes soft-deleted chapters", async () => {
    const { projectSlug, chapterId } = await createProjectWithChapter(t.app);

    // Add a second chapter, then soft-delete the first
    await request(t.app).post(`/api/projects/${projectSlug}/chapters`).send();
    await request(t.app).delete(`/api/chapters/${chapterId}`);

    const res = await request(t.app).get(`/api/projects/${projectSlug}/dashboard`);

    expect(res.status).toBe(200);
    expect(res.body.chapters).toHaveLength(1);
    expect(res.body.totals.chapter_count).toBe(1);
  });

  it("returns empty dashboard for project with no chapters", async () => {
    const { projectSlug, chapterId } = await createProjectWithChapter(t.app);

    // Delete the auto-created chapter
    await request(t.app).delete(`/api/chapters/${chapterId}`);

    const res = await request(t.app).get(`/api/projects/${projectSlug}/dashboard`);

    expect(res.status).toBe(200);
    expect(res.body.chapters).toHaveLength(0);
    expect(res.body.totals.word_count).toBe(0);
    expect(res.body.totals.chapter_count).toBe(0);
    expect(res.body.totals.most_recent_edit).toBeNull();
    expect(res.body.totals.least_recent_edit).toBeNull();
    expect(res.body.status_summary).toEqual({
      outline: 0,
      rough_draft: 0,
      revised: 0,
      edited: 0,
      final: 0,
    });
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request(t.app).get("/api/projects/nonexistent-slug/dashboard");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
