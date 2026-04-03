import { describe, it, expect, vi } from "vitest";
import { insertSaveEvent, upsertDailySnapshot } from "../routes/velocityHelpers";
import { calculateProjection } from "../routes/velocity";

describe("insertSaveEvent error handling", () => {
  it("logs error and does not throw when insert fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fakeDb = (() => {
      throw new Error("DB write failed");
    }) as unknown as import("knex").Knex;
    await expect(insertSaveEvent(fakeDb, "ch1", "p1", 100)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to insert save event"),
      expect.any(Error),
    );
    spy.mockRestore();
  });
});

describe("upsertDailySnapshot error handling", () => {
  it("logs error and does not throw when upsert fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fakeDb = Object.assign(
      () => ({ where: () => ({ first: () => Promise.resolve(null) }) }),
      {
        raw: () => {
          throw new Error("DB write failed");
        },
      },
    ) as unknown as import("knex").Knex;
    await expect(upsertDailySnapshot(fakeDb, "p1")).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to upsert daily snapshot"),
      expect.any(Error),
    );
    spy.mockRestore();
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
