import { describe, it, expect } from "vitest";
import { upsertDailySnapshot } from "../velocity/velocity.repository";

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
