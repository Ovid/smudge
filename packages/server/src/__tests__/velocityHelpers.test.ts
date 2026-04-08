import { describe, it, expect } from "vitest";
import { insertSaveEvent, upsertDailySnapshot } from "../velocity/velocity.repository";
import { calculateProjection } from "../velocity/velocity.service";

describe("insertSaveEvent error handling", () => {
  it("throws when insert fails (error handling moved to service layer)", async () => {
    const fakeDb = (() => {
      throw new Error("DB write failed");
    }) as unknown as import("knex").Knex;
    await expect(
      insertSaveEvent(fakeDb, "ch1", "p1", 100, "2026-04-03", new Date().toISOString()),
    ).rejects.toThrow("DB write failed");
  });
});

describe("upsertDailySnapshot error handling", () => {
  it("throws when upsert fails (error handling moved to service layer)", async () => {
    const fakeDb = Object.assign(
      () => ({ where: () => ({ first: () => Promise.resolve(null) }) }),
      {
        raw: () => {
          throw new Error("DB write failed");
        },
      },
    ) as unknown as import("knex").Knex;
    await expect(upsertDailySnapshot(fakeDb, "p1", "2026-04-03", 0)).rejects.toThrow(
      "DB write failed",
    );
  });
});

describe("calculateProjection", () => {
  it("returns projection when targetWordCount is 0", () => {
    const result = calculateProjection(0, "2026-12-31", 500, 0, "2026-04-03");
    // targetWordCount === 0 means target is set (to 0), should not skip projection
    expect(result.target_word_count).toBe(0);
    expect(result.daily_average_30d).toBe(500);
  });

  it("skips projection when targetWordCount is null", () => {
    const result = calculateProjection(null, null, 500, 1000, "2026-04-03");
    expect(result.target_word_count).toBeNull();
    expect(result.projected_date).toBeNull();
  });

  it("calculates projected date when target exceeds current total", () => {
    const result = calculateProjection(10000, "2026-12-31", 500, 5000, "2026-04-03");
    expect(result.target_word_count).toBe(10000);
    expect(result.projected_date).not.toBeNull();
    expect(result.daily_average_30d).toBe(500);
  });
});
