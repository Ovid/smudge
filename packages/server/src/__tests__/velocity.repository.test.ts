import { describe, it, expect } from "vitest";
import { v4 as uuid } from "uuid";
import { setupTestDb } from "./test-helpers";
import * as VelocityRepo from "../velocity/velocity.repository";

const t = setupTestDb();

async function createProject() {
  const projectId = uuid();
  const now = new Date().toISOString();
  await t.db("projects").insert({
    id: projectId,
    title: "Velocity Test",
    slug: `vel-${projectId.slice(0, 8)}`,
    mode: "fiction",
    created_at: now,
    updated_at: now,
  });
  return projectId;
}

async function createChapter(projectId: string) {
  const chapterId = uuid();
  const now = new Date().toISOString();
  await t.db("chapters").insert({
    id: chapterId,
    project_id: projectId,
    title: "Test Chapter",
    content: JSON.stringify({ type: "doc", content: [] }),
    sort_order: 0,
    word_count: 0,
    created_at: now,
    updated_at: now,
  });
  return chapterId;
}

describe("velocity repository", () => {
  describe("insertSaveEvent()", () => {
    it("inserts a save event row", async () => {
      const projectId = await createProject();
      const chapterId = await createChapter(projectId);

      await VelocityRepo.insertSaveEvent(t.db, chapterId, projectId, 100, "2026-04-05", "2026-04-05T12:00:00.000Z");

      const rows = await t.db("save_events").where({ project_id: projectId });
      expect(rows).toHaveLength(1);
      expect(rows[0].chapter_id).toBe(chapterId);
      expect(rows[0].word_count).toBe(100);
      expect(rows[0].save_date).toBe("2026-04-05");
    });

    it("inserts multiple save events", async () => {
      const projectId = await createProject();
      const chapterId = await createChapter(projectId);

      await VelocityRepo.insertSaveEvent(t.db, chapterId, projectId, 50, "2026-04-05", "2026-04-05T12:00:00.000Z");
      await VelocityRepo.insertSaveEvent(t.db, chapterId, projectId, 75, "2026-04-05", "2026-04-05T12:01:00.000Z");

      const rows = await t.db("save_events").where({ project_id: projectId });
      expect(rows).toHaveLength(2);
    });
  });

  describe("upsertDailySnapshot()", () => {
    it("creates a new daily snapshot", async () => {
      const projectId = await createProject();

      await VelocityRepo.upsertDailySnapshot(t.db, projectId, "2026-04-05", 500);

      const rows = await t.db("daily_snapshots").where({ project_id: projectId });
      expect(rows).toHaveLength(1);
      expect(rows[0].total_word_count).toBe(500);
      expect(rows[0].date).toBe("2026-04-05");
    });

    it("updates existing snapshot on same project+date", async () => {
      const projectId = await createProject();

      await VelocityRepo.upsertDailySnapshot(t.db, projectId, "2026-04-05", 500);
      await VelocityRepo.upsertDailySnapshot(t.db, projectId, "2026-04-05", 800);

      const rows = await t.db("daily_snapshots").where({ project_id: projectId });
      expect(rows).toHaveLength(1);
      expect(rows[0].total_word_count).toBe(800);
    });

    it("creates separate snapshots for different dates", async () => {
      const projectId = await createProject();

      await VelocityRepo.upsertDailySnapshot(t.db, projectId, "2026-04-05", 500);
      await VelocityRepo.upsertDailySnapshot(t.db, projectId, "2026-04-06", 600);

      const rows = await t.db("daily_snapshots").where({ project_id: projectId }).orderBy("date");
      expect(rows).toHaveLength(2);
      expect(rows[0].total_word_count).toBe(500);
      expect(rows[1].total_word_count).toBe(600);
    });
  });

  describe("getDailySnapshots()", () => {
    it("filters snapshots by date", async () => {
      const projectId = await createProject();

      await VelocityRepo.upsertDailySnapshot(t.db, projectId, "2026-04-01", 100);
      await VelocityRepo.upsertDailySnapshot(t.db, projectId, "2026-04-03", 200);
      await VelocityRepo.upsertDailySnapshot(t.db, projectId, "2026-04-05", 300);

      const snapshots = await VelocityRepo.getDailySnapshots(t.db, projectId, "2026-04-03");
      expect(snapshots).toHaveLength(2);
      expect(snapshots[0]!.date).toBe("2026-04-03");
      expect(snapshots[0]!.total_word_count).toBe(200);
      expect(snapshots[1]!.date).toBe("2026-04-05");
      expect(snapshots[1]!.total_word_count).toBe(300);
    });

    it("returns empty array when no snapshots match", async () => {
      const projectId = await createProject();
      const snapshots = await VelocityRepo.getDailySnapshots(t.db, projectId, "2026-04-05");
      expect(snapshots).toEqual([]);
    });
  });

  describe("getRecentSaveEvents()", () => {
    it("filters events by timestamp", async () => {
      const projectId = await createProject();
      const chapterId = await createChapter(projectId);

      // Insert events with specific timestamps
      const oldTs = "2026-04-01T00:00:00.000Z";
      const newTs = "2026-04-05T12:00:00.000Z";

      await t.db("save_events").insert({
        id: uuid(),
        chapter_id: chapterId,
        project_id: projectId,
        word_count: 50,
        saved_at: oldTs,
        save_date: "2026-04-01",
      });
      await t.db("save_events").insert({
        id: uuid(),
        chapter_id: chapterId,
        project_id: projectId,
        word_count: 100,
        saved_at: newTs,
        save_date: "2026-04-05",
      });

      const events = await VelocityRepo.getRecentSaveEvents(
        t.db,
        projectId,
        "2026-04-03T00:00:00.000Z",
      );
      expect(events).toHaveLength(1);
      expect(events[0]!.word_count).toBe(100);
      expect(events[0]!.chapter_id).toBe(chapterId);
    });

    it("returns empty array when no events match", async () => {
      const projectId = await createProject();
      const events = await VelocityRepo.getRecentSaveEvents(
        t.db,
        projectId,
        "2026-04-05T00:00:00.000Z",
      );
      expect(events).toEqual([]);
    });

    it("returns events ordered by saved_at ascending", async () => {
      const projectId = await createProject();
      const chapterId = await createChapter(projectId);

      await t.db("save_events").insert({
        id: uuid(),
        chapter_id: chapterId,
        project_id: projectId,
        word_count: 200,
        saved_at: "2026-04-05T14:00:00.000Z",
        save_date: "2026-04-05",
      });
      await t.db("save_events").insert({
        id: uuid(),
        chapter_id: chapterId,
        project_id: projectId,
        word_count: 100,
        saved_at: "2026-04-05T10:00:00.000Z",
        save_date: "2026-04-05",
      });

      const events = await VelocityRepo.getRecentSaveEvents(
        t.db,
        projectId,
        "2026-04-05T00:00:00.000Z",
      );
      expect(events).toHaveLength(2);
      expect(events[0]!.word_count).toBe(100);
      expect(events[1]!.word_count).toBe(200);
    });
  });

  describe("getWritingDates()", () => {
    it("returns dates that have both snapshots and save events", async () => {
      const projectId = await createProject();
      const chapterId = await createChapter(projectId);

      // Date with both snapshot and save event
      await VelocityRepo.upsertDailySnapshot(t.db, projectId, "2026-04-05", 500);
      await t.db("save_events").insert({
        id: uuid(),
        chapter_id: chapterId,
        project_id: projectId,
        word_count: 100,
        saved_at: "2026-04-05T12:00:00.000Z",
        save_date: "2026-04-05",
      });

      // Date with snapshot only (no save event) — should NOT appear
      await VelocityRepo.upsertDailySnapshot(t.db, projectId, "2026-04-04", 400);

      const dates = await VelocityRepo.getWritingDates(t.db, projectId, 10);
      expect(dates).toEqual(["2026-04-05"]);
    });

    it("returns empty array when no writing dates", async () => {
      const projectId = await createProject();
      const dates = await VelocityRepo.getWritingDates(t.db, projectId, 10);
      expect(dates).toEqual([]);
    });

    it("respects the limit parameter", async () => {
      const projectId = await createProject();
      const chapterId = await createChapter(projectId);

      for (let day = 1; day <= 5; day++) {
        const dateStr = `2026-04-0${day}`;
        await VelocityRepo.upsertDailySnapshot(t.db, projectId, dateStr, day * 100);
        await t.db("save_events").insert({
          id: uuid(),
          chapter_id: chapterId,
          project_id: projectId,
          word_count: day * 10,
          saved_at: `${dateStr}T12:00:00.000Z`,
          save_date: dateStr,
        });
      }

      const dates = await VelocityRepo.getWritingDates(t.db, projectId, 3);
      expect(dates).toHaveLength(3);
      // Most recent first
      expect(dates[0]).toBe("2026-04-05");
    });

    it("returns dates in descending order", async () => {
      const projectId = await createProject();
      const chapterId = await createChapter(projectId);

      for (const day of ["01", "03", "05"]) {
        const dateStr = `2026-04-${day}`;
        await VelocityRepo.upsertDailySnapshot(t.db, projectId, dateStr, 100);
        await t.db("save_events").insert({
          id: uuid(),
          chapter_id: chapterId,
          project_id: projectId,
          word_count: 10,
          saved_at: `${dateStr}T12:00:00.000Z`,
          save_date: dateStr,
        });
      }

      const dates = await VelocityRepo.getWritingDates(t.db, projectId, 10);
      expect(dates).toEqual(["2026-04-05", "2026-04-03", "2026-04-01"]);
    });
  });
});
