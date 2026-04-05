import { describe, it, expect } from "vitest";
import { setupTestDb } from "./test-helpers";
import * as ChapterStatusRepo from "../chapter-statuses/chapter-statuses.repository";

const t = setupTestDb();

describe("chapter-statuses repository", () => {
  it("list() returns all 5 statuses in sort_order", async () => {
    const statuses = await ChapterStatusRepo.list(t.db);
    expect(statuses).toHaveLength(5);
    expect(statuses[0].status).toBe("outline");
    expect(statuses[1].status).toBe("rough_draft");
    expect(statuses[2].status).toBe("revised");
    expect(statuses[3].status).toBe("edited");
    expect(statuses[4].status).toBe("final");
    // Verify sort_order is ascending
    for (let i = 1; i < statuses.length; i++) {
      expect(statuses[i].sort_order).toBeGreaterThan(statuses[i - 1].sort_order);
    }
  });

  it("list() returns rows with status, sort_order, and label", async () => {
    const statuses = await ChapterStatusRepo.list(t.db);
    for (const s of statuses) {
      expect(s).toHaveProperty("status");
      expect(s).toHaveProperty("sort_order");
      expect(s).toHaveProperty("label");
    }
  });

  it("findByStatus() finds an existing status", async () => {
    const row = await ChapterStatusRepo.findByStatus(t.db, "rough_draft");
    expect(row).toBeDefined();
    expect(row!.status).toBe("rough_draft");
    expect(row!.label).toBe("Rough Draft");
  });

  it("findByStatus() returns undefined for a missing status", async () => {
    const row = await ChapterStatusRepo.findByStatus(t.db, "nonexistent");
    expect(row).toBeUndefined();
  });

  it("getStatusLabel() returns label for existing status", async () => {
    const label = await ChapterStatusRepo.getStatusLabel(t.db, "final");
    expect(label).toBe("Final");
  });

  it("getStatusLabel() returns the status string as fallback for missing status", async () => {
    const label = await ChapterStatusRepo.getStatusLabel(t.db, "unknown_status");
    expect(label).toBe("unknown_status");
  });

  it("getStatusLabelMap() returns a complete map of all statuses", async () => {
    const map = await ChapterStatusRepo.getStatusLabelMap(t.db);
    expect(Object.keys(map)).toHaveLength(5);
    expect(map["outline"]).toBe("Outline");
    expect(map["rough_draft"]).toBe("Rough Draft");
    expect(map["revised"]).toBe("Revised");
    expect(map["edited"]).toBe("Edited");
    expect(map["final"]).toBe("Final");
  });
});
