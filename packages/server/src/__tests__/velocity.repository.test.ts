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

describe("velocity repository", () => {
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

  describe("getBaselineSnapshot()", () => {
    it("returns snapshot on exact target date", async () => {
      const projectId = await createProject();

      await VelocityRepo.upsertDailySnapshot(t.db, projectId, "2026-04-01", 100);
      await VelocityRepo.upsertDailySnapshot(t.db, projectId, "2026-04-05", 300);

      const result = await VelocityRepo.getBaselineSnapshot(t.db, projectId, "2026-04-05");
      expect(result).toBeDefined();
      expect(result!.date).toBe("2026-04-05");
      expect(result!.total_word_count).toBe(300);
    });

    it("returns nearest earlier snapshot when no exact match", async () => {
      const projectId = await createProject();

      await VelocityRepo.upsertDailySnapshot(t.db, projectId, "2026-04-01", 100);
      await VelocityRepo.upsertDailySnapshot(t.db, projectId, "2026-04-03", 200);

      // Target date is 2026-04-05, nearest earlier is 2026-04-03
      const result = await VelocityRepo.getBaselineSnapshot(t.db, projectId, "2026-04-05");
      expect(result).toBeDefined();
      expect(result!.date).toBe("2026-04-03");
      expect(result!.total_word_count).toBe(200);
    });

    it("returns undefined when no snapshot on or before target date", async () => {
      const projectId = await createProject();

      await VelocityRepo.upsertDailySnapshot(t.db, projectId, "2026-04-10", 500);

      const result = await VelocityRepo.getBaselineSnapshot(t.db, projectId, "2026-04-05");
      expect(result).toBeUndefined();
    });

    it("returns undefined when no snapshots exist", async () => {
      const projectId = await createProject();

      const result = await VelocityRepo.getBaselineSnapshot(t.db, projectId, "2026-04-05");
      expect(result).toBeUndefined();
    });
  });

  describe("getLastPriorDaySnapshot()", () => {
    it("returns the most recent snapshot before today", async () => {
      const projectId = await createProject();

      await VelocityRepo.upsertDailySnapshot(t.db, projectId, "2026-04-03", 100);
      await VelocityRepo.upsertDailySnapshot(t.db, projectId, "2026-04-04", 200);
      await VelocityRepo.upsertDailySnapshot(t.db, projectId, "2026-04-05", 300);

      const result = await VelocityRepo.getLastPriorDaySnapshot(t.db, projectId, "2026-04-05");
      expect(result).toBeDefined();
      expect(result!.date).toBe("2026-04-04");
      expect(result!.total_word_count).toBe(200);
    });

    it("excludes today's snapshot (strictly less than)", async () => {
      const projectId = await createProject();

      await VelocityRepo.upsertDailySnapshot(t.db, projectId, "2026-04-05", 500);

      const result = await VelocityRepo.getLastPriorDaySnapshot(t.db, projectId, "2026-04-05");
      expect(result).toBeUndefined();
    });

    it("returns undefined when no prior snapshots exist", async () => {
      const projectId = await createProject();

      const result = await VelocityRepo.getLastPriorDaySnapshot(t.db, projectId, "2026-04-05");
      expect(result).toBeUndefined();
    });
  });
});
