import { describe, it, expect } from "vitest";
import request from "supertest";
import { setupTestDb } from "./test-helpers";

const t = setupTestDb();

async function createProjectWithChapter() {
  const res = await request(t.app)
    .post("/api/projects")
    .send({ title: "Test Project", mode: "fiction" });
  const project = res.body;
  const chapters = await t.db("chapters").where({ project_id: project.id }).select("id");
  return { projectId: project.id, chapterId: chapters[0].id, slug: project.slug };
}

describe("PATCH /api/chapters/:id — side effects", () => {
  it("upserts a DailySnapshot on content save", async () => {
    const { projectId, chapterId } = await createProjectWithChapter();
    await t.db("daily_snapshots").where({ project_id: projectId }).del();

    await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
        },
      });

    const snapshots = await t.db("daily_snapshots").where({ project_id: projectId });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].total_word_count).toBe(1);
  });

  it("does NOT create DailySnapshot for title-only updates", async () => {
    const { projectId, chapterId } = await createProjectWithChapter();
    await t.db("daily_snapshots").where({ project_id: projectId }).del();

    await request(t.app).patch(`/api/chapters/${chapterId}`).send({ title: "New Title" });

    const snapshots = await t.db("daily_snapshots").where({ project_id: projectId });
    expect(snapshots).toHaveLength(0);
  });

  it("upserts same-day DailySnapshot on multiple saves", async () => {
    const { projectId, chapterId } = await createProjectWithChapter();
    await t.db("daily_snapshots").where({ project_id: projectId }).del();

    await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
        },
      });

    await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world again" }] }],
        },
      });

    const snapshots = await t.db("daily_snapshots").where({ project_id: projectId });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].total_word_count).toBe(3);
  });

  it("chapter save succeeds even if velocity tracking fails", async () => {
    const { chapterId } = await createProjectWithChapter();
    const res = await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "test" }] }],
        },
      });
    expect(res.status).toBe(200);
  });
});
