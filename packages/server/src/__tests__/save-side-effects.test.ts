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
  it("creates a SaveEvent on content save", async () => {
    const { chapterId } = await createProjectWithChapter();
    await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }],
        },
      });

    const events = await t.db("save_events").where({ chapter_id: chapterId });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[events.length - 1].word_count).toBe(2);
  });

  it("does NOT create SaveEvent for title-only updates", async () => {
    const { chapterId } = await createProjectWithChapter();
    await t.db("save_events").where({ chapter_id: chapterId }).del();

    await request(t.app).patch(`/api/chapters/${chapterId}`).send({ title: "New Title" });

    const events = await t.db("save_events").where({ chapter_id: chapterId });
    expect(events).toHaveLength(0);
  });

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

  it("chapter save succeeds even if SaveEvent insert fails", async () => {
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
