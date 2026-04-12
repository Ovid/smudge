import { describe, it, expect, beforeAll, afterAll } from "vitest";
import knex, { type Knex } from "knex";
import { createTestKnexConfig } from "../db/knexfile";

describe("migration 010: simplify progress model", () => {
  let db: Knex;

  beforeAll(async () => {
    db = knex(createTestKnexConfig());
    await db.raw("PRAGMA foreign_keys = ON");
    await db.migrate.latest();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("drops the save_events table", async () => {
    const tables = await db.raw(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='save_events'",
    );
    expect(tables).toHaveLength(0);
  });

  it("removes completion_threshold from projects", async () => {
    const cols = await db.raw("PRAGMA table_info(projects)");
    const colNames = cols.map((c: { name: string }) => c.name);
    expect(colNames).not.toContain("completion_threshold");
  });

  it("removes target_word_count from chapters", async () => {
    const cols = await db.raw("PRAGMA table_info(chapters)");
    const colNames = cols.map((c: { name: string }) => c.name);
    expect(colNames).not.toContain("target_word_count");
  });

  it("preserves daily_snapshots table", async () => {
    const cols = await db.raw("PRAGMA table_info(daily_snapshots)");
    expect(cols.length).toBeGreaterThan(0);
    const colNames = cols.map((c: { name: string }) => c.name);
    expect(colNames).toContain("id");
    expect(colNames).toContain("project_id");
    expect(colNames).toContain("date");
    expect(colNames).toContain("total_word_count");
  });

  it("preserves settings table", async () => {
    const cols = await db.raw("PRAGMA table_info(settings)");
    expect(cols.length).toBeGreaterThan(0);
    const colNames = cols.map((c: { name: string }) => c.name);
    expect(colNames).toContain("key");
    expect(colNames).toContain("value");
  });

  it("down() is idempotent — running twice does not error", async () => {
    // Import the migration's down() function directly
    const migration = await import("../db/migrations/010_simplify_progress_model.js");

    // First: rollback via Knex (runs down() once, restores columns + table)
    await db.migrate.down();

    // Verify rollback restored the columns and table
    const projectCols = await db.raw("PRAGMA table_info(projects)");
    expect(projectCols.map((c: { name: string }) => c.name)).toContain("completion_threshold");

    const chapterCols = await db.raw("PRAGMA table_info(chapters)");
    expect(chapterCols.map((c: { name: string }) => c.name)).toContain("target_word_count");

    const tables = await db.raw(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='save_events'",
    );
    expect(tables).toHaveLength(1);

    // Call down() directly again — simulates partial failure recovery
    // This should NOT throw even though columns and table already exist
    await migration.down(db);

    // Re-apply so other tests still pass if run order changes
    await db.migrate.latest();
  });
});
