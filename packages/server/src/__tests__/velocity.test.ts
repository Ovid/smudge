import { describe, it, expect } from "vitest";
import request from "supertest";
import { setupTestDb } from "./test-helpers";
import { v4 as uuid } from "uuid";
import { safeTimezone } from "../routes/velocityHelpers";

describe("safeTimezone", () => {
  it("returns the timezone unchanged when valid", () => {
    expect(safeTimezone("America/New_York")).toBe("America/New_York");
  });

  it("returns UTC for an invalid timezone string", () => {
    expect(safeTimezone("Not/AReal_Zone")).toBe("UTC");
  });
});

const t = setupTestDb();

/** Return an ISO timestamp for N days ago at a given hour (UTC) */
function daysAgoAt(n: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

/** Return a YYYY-MM-DD date string for N days ago (UTC, matches server default) */
function daysAgoDate(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

async function createProjectWithChapter() {
  const res = await request(t.app)
    .post("/api/projects")
    .send({ title: "Velocity Test", mode: "fiction" });
  const project = res.body;
  const chapters = await t.db("chapters").where({ project_id: project.id }).select("id");
  return { projectId: project.id, chapterId: chapters[0].id, slug: project.slug };
}

async function insertSaveEvent(
  projectId: string,
  chapterId: string,
  wordCount: number,
  savedAt: string,
) {
  await t.db("save_events").insert({
    id: uuid(),
    chapter_id: chapterId,
    project_id: projectId,
    word_count: wordCount,
    saved_at: savedAt,
  });
}

async function insertSnapshot(projectId: string, date: string, totalWordCount: number) {
  await t.db("daily_snapshots").insert({
    id: uuid(),
    project_id: projectId,
    date,
    total_word_count: totalWordCount,
    created_at: new Date().toISOString(),
  });
}

describe("GET /api/projects/:slug/velocity", () => {
  it("returns empty shape for project with no data", async () => {
    const { slug, projectId } = await createProjectWithChapter();
    await t.db("save_events").where({ project_id: projectId }).del();
    await t.db("daily_snapshots").where({ project_id: projectId }).del();

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.status).toBe(200);
    expect(res.body.daily_snapshots).toEqual([]);
    expect(res.body.sessions).toEqual([]);
    expect(res.body.streak).toEqual({ current: 0, best: 0 });
    expect(res.body.projection).toEqual({
      target_word_count: null,
      target_deadline: null,
      projected_date: null,
      daily_average_30d: 0,
    });
    expect(res.body.completion).toHaveProperty("total_chapters");
  });

  it("returns daily_snapshots for last 90 days", async () => {
    const { slug, projectId } = await createProjectWithChapter();
    await t.db("daily_snapshots").where({ project_id: projectId }).del();

    await insertSnapshot(projectId, "2026-03-30", 1000);
    await insertSnapshot(projectId, "2026-03-31", 1500);

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.daily_snapshots.length).toBe(2);
    expect(res.body.daily_snapshots[0].date).toBe("2026-03-30");
    expect(res.body.daily_snapshots[0].total_word_count).toBe(1000);
  });

  it("derives sessions from SaveEvent gaps > 30 minutes", async () => {
    const { slug, projectId, chapterId } = await createProjectWithChapter();
    await t.db("save_events").where({ project_id: projectId }).del();

    // Session 1: two saves 5 minutes apart
    await insertSaveEvent(projectId, chapterId, 100, "2026-03-31T14:00:00Z");
    await insertSaveEvent(projectId, chapterId, 200, "2026-03-31T14:05:00Z");
    // Gap > 30 min
    // Session 2: one save
    await insertSaveEvent(projectId, chapterId, 300, "2026-03-31T15:00:00Z");

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.sessions).toHaveLength(2);
  });

  it("calculates net_words per session correctly", async () => {
    const { slug, projectId, chapterId } = await createProjectWithChapter();
    await t.db("save_events").where({ project_id: projectId }).del();

    // Baseline
    await insertSaveEvent(projectId, chapterId, 100, "2026-03-30T10:00:00Z");
    // Session: word count goes from 100 to 250
    await insertSaveEvent(projectId, chapterId, 150, "2026-03-31T14:00:00Z");
    await insertSaveEvent(projectId, chapterId, 250, "2026-03-31T14:10:00Z");

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    const session = res.body.sessions.find(
      (s: { start: string }) => s.start === "2026-03-31T14:00:00Z",
    );
    expect(session).toBeDefined();
    expect(session.net_words).toBe(150); // 250 - 100
  });

  it("calculates streaks from daily snapshot dates", async () => {
    const { slug, projectId, chapterId } = await createProjectWithChapter();
    await t.db("save_events").where({ project_id: projectId }).del();
    await t.db("daily_snapshots").where({ project_id: projectId }).del();

    // 3 consecutive days ending today
    await insertSaveEvent(projectId, chapterId, 100, daysAgoAt(2, 10));
    await insertSaveEvent(projectId, chapterId, 200, daysAgoAt(1, 10));
    await insertSaveEvent(projectId, chapterId, 300, daysAgoAt(0, 10));
    await insertSnapshot(projectId, daysAgoDate(2), 100);
    await insertSnapshot(projectId, daysAgoDate(1), 200);
    await insertSnapshot(projectId, daysAgoDate(0), 300);

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.streak.current).toBe(3);
    expect(res.body.streak.best).toBe(3);
  });

  it("returns projection when target is set", async () => {
    const { slug, projectId } = await createProjectWithChapter();
    await t.db("save_events").where({ project_id: projectId }).del();
    await t.db("daily_snapshots").where({ project_id: projectId }).del();

    await request(t.app)
      .patch(`/api/projects/${slug}`)
      .send({ target_word_count: 80000, target_deadline: "2026-09-01" });

    await insertSnapshot(projectId, "2026-03-31", 40000);
    await insertSnapshot(projectId, "2026-04-01", 41200);

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.projection.target_word_count).toBe(80000);
    expect(res.body.projection.target_deadline).toBe("2026-09-01");
    expect(res.body.projection.daily_average_30d).toBeGreaterThan(0);
  });

  it("returns completion stats based on threshold", async () => {
    const { slug, projectId } = await createProjectWithChapter();

    await request(t.app).patch(`/api/projects/${slug}`).send({ completion_threshold: "revised" });

    const chapters = await t.db("chapters").where({ project_id: projectId }).select("id");
    await request(t.app).patch(`/api/chapters/${chapters[0].id}`).send({ status: "revised" });

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.completion.threshold_status).toBe("revised");
    expect(res.body.completion.total_chapters).toBe(1);
    expect(res.body.completion.completed_chapters).toBe(1);
  });

  it("calculates net_words across multiple chapters in one session", async () => {
    const { slug, projectId, chapterId } = await createProjectWithChapter();
    const ch2Res = await request(t.app).post(`/api/projects/${slug}/chapters`).send({});
    const chapterId2 = ch2Res.body.id;
    await t.db("save_events").where({ project_id: projectId }).del();

    // Baselines
    await insertSaveEvent(projectId, chapterId, 100, "2026-03-30T10:00:00Z");
    await insertSaveEvent(projectId, chapterId2, 50, "2026-03-30T10:00:00Z");
    // Session: both chapters edited within 30 min
    await insertSaveEvent(projectId, chapterId, 200, "2026-03-31T14:00:00Z");
    await insertSaveEvent(projectId, chapterId2, 120, "2026-03-31T14:10:00Z");

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    const session = res.body.sessions.find(
      (s: { start: string }) => s.start === "2026-03-31T14:00:00Z",
    );
    expect(session).toBeDefined();
    expect(session.net_words).toBe(170); // (200-100) + (120-50)
    expect(session.chapters_touched).toHaveLength(2);
  });

  it("streak: no saves today — counts from yesterday", async () => {
    const { slug, projectId, chapterId } = await createProjectWithChapter();
    await t.db("save_events").where({ project_id: projectId }).del();
    await t.db("daily_snapshots").where({ project_id: projectId }).del();

    // Saves yesterday and day before, but NOT today
    await insertSaveEvent(projectId, chapterId, 100, daysAgoAt(2, 10));
    await insertSaveEvent(projectId, chapterId, 200, daysAgoAt(1, 10));
    await insertSnapshot(projectId, daysAgoDate(2), 100);
    await insertSnapshot(projectId, daysAgoDate(1), 200);

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.streak.current).toBe(2);
  });

  it("streak: gap in the middle resets current but not best", async () => {
    const { slug, projectId, chapterId } = await createProjectWithChapter();
    await t.db("save_events").where({ project_id: projectId }).del();
    await t.db("daily_snapshots").where({ project_id: projectId }).del();

    // 3-day run (6-4 days ago), gap (3 days ago), then 2-0 days ago
    await insertSaveEvent(projectId, chapterId, 100, daysAgoAt(6, 10));
    await insertSaveEvent(projectId, chapterId, 200, daysAgoAt(5, 10));
    await insertSaveEvent(projectId, chapterId, 300, daysAgoAt(4, 10));
    // gap on day 3
    await insertSaveEvent(projectId, chapterId, 400, daysAgoAt(2, 10));
    await insertSaveEvent(projectId, chapterId, 500, daysAgoAt(1, 10));
    await insertSaveEvent(projectId, chapterId, 600, daysAgoAt(0, 10));
    await insertSnapshot(projectId, daysAgoDate(6), 100);
    await insertSnapshot(projectId, daysAgoDate(5), 200);
    await insertSnapshot(projectId, daysAgoDate(4), 300);
    await insertSnapshot(projectId, daysAgoDate(2), 400);
    await insertSnapshot(projectId, daysAgoDate(1), 500);
    await insertSnapshot(projectId, daysAgoDate(0), 600);

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.streak.current).toBe(3); // days 2, 1, 0
    expect(res.body.streak.best).toBe(3); // tied: days 6-4 and days 2-0
  });

  it("streak: zero-word-change save still counts as writing day", async () => {
    const { slug, projectId, chapterId } = await createProjectWithChapter();
    await t.db("save_events").where({ project_id: projectId }).del();
    await t.db("daily_snapshots").where({ project_id: projectId }).del();

    await insertSaveEvent(projectId, chapterId, 500, daysAgoAt(1, 10));
    await insertSaveEvent(projectId, chapterId, 500, daysAgoAt(0, 10));
    await insertSnapshot(projectId, daysAgoDate(1), 500);
    await insertSnapshot(projectId, daysAgoDate(0), 500);

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.streak.current).toBe(2);
  });

  it("completion: counts chapters at or beyond threshold using sort_order", async () => {
    const { slug, projectId } = await createProjectWithChapter();
    await request(t.app).post(`/api/projects/${slug}/chapters`).send({});
    const chapters = await t
      .db("chapters")
      .where({ project_id: projectId })
      .whereNull("deleted_at")
      .select("id");

    await request(t.app).patch(`/api/projects/${slug}`).send({ completion_threshold: "revised" });

    // Chapter 1: "edited" (sort_order 4 — beyond threshold)
    await request(t.app).patch(`/api/chapters/${chapters[0].id}`).send({ status: "edited" });
    // Chapter 2: "outline" (sort_order 1 — below threshold)

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.completion.threshold_status).toBe("revised");
    expect(res.body.completion.total_chapters).toBe(2);
    expect(res.body.completion.completed_chapters).toBe(1);
  });

  it("includes SaveEvents from soft-deleted chapters in sessions", async () => {
    const { slug, projectId, chapterId } = await createProjectWithChapter();
    await t.db("save_events").where({ project_id: projectId }).del();

    await insertSaveEvent(projectId, chapterId, 0, "2026-03-30T10:00:00Z");
    await insertSaveEvent(projectId, chapterId, 500, "2026-03-31T14:00:00Z");

    await request(t.app).delete(`/api/chapters/${chapterId}`);

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    const session = res.body.sessions.find(
      (s: { start: string }) => s.start === "2026-03-31T14:00:00Z",
    );
    expect(session).toBeDefined();
    expect(session.net_words).toBe(500);
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request(t.app).get("/api/projects/no-such-project/velocity");
    expect(res.status).toBe(404);
  });
});
