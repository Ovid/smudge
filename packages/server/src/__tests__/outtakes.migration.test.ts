import { describe, it, expect } from "vitest";
import { setupTestDb } from "./test-helpers";

const t = setupTestDb();

describe("migration 015 outtakes", () => {
  it("creates the outtakes table with the expected columns", async () => {
    const cols = await t.db("outtakes").columnInfo();
    expect(Object.keys(cols).sort()).toEqual(
      ["content", "created_at", "id", "label", "project_id", "updated_at"].sort(),
    );
  });

  it("has no word_count or deleted_at column", async () => {
    const cols = await t.db("outtakes").columnInfo();
    expect(cols).not.toHaveProperty("word_count");
    expect(cols).not.toHaveProperty("deleted_at");
  });
});
