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

  // S19 (agentic-review 2026-08-04): design §10 promised "migration up/down" and
  // both blocks above assert only `up`. An untested `down` is how a rollback
  // discovers, in the one situation where rolling back is the whole plan, that
  // it does not work. Declared LAST so the re-migrate restores the table before
  // any sibling test runs.
  it("drops the table on rollback and restores it on re-migrate (down)", async () => {
    // S6 (agentic-review 2026-08-04): pinned to 015. A bare down() rolls back
    // whatever is latest, so the day 016 lands this went red against an
    // unrelated change — while silently ceasing to cover 015's down(), the one
    // thing it exists for.
    await t.db.migrate.down({ name: "015_create_outtakes.js" });
    expect(await t.db.schema.hasTable("outtakes")).toBe(false);

    await t.db.migrate.latest();
    expect(await t.db.schema.hasTable("outtakes")).toBe(true);
    const cols = await t.db("outtakes").columnInfo();
    expect(Object.keys(cols).sort()).toEqual(
      ["content", "created_at", "id", "label", "project_id", "updated_at"].sort(),
    );
  });
});
