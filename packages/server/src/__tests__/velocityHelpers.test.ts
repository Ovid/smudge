import { describe, it, expect, vi } from "vitest";
import { insertSaveEvent, upsertDailySnapshot } from "../routes/velocityHelpers";

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
