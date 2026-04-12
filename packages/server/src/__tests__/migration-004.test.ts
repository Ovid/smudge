import { describe, it, expect, beforeAll, afterAll } from "vitest";
import knex, { type Knex } from "knex";
import { createTestKnexConfig } from "../db/knexfile";

describe("migration 004: goals & velocity (post-simplification)", () => {
  let db: Knex;

  beforeAll(async () => {
    db = knex(createTestKnexConfig());
    await db.raw("PRAGMA foreign_keys = ON");
    await db.migrate.latest();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("projects have target_word_count and target_deadline but not completion_threshold", async () => {
    const cols = await db.raw("PRAGMA table_info(projects)");
    const colNames = cols.map((c: { name: string }) => c.name);
    expect(colNames).toContain("target_word_count");
    expect(colNames).toContain("target_deadline");
    expect(colNames).not.toContain("completion_threshold");
  });

  it("chapters do not have target_word_count (removed by migration 010)", async () => {
    const cols = await db.raw("PRAGMA table_info(chapters)");
    const colNames = cols.map((c: { name: string }) => c.name);
    expect(colNames).not.toContain("target_word_count");
  });

  it("creates settings table", async () => {
    const cols = await db.raw("PRAGMA table_info(settings)");
    expect(cols.length).toBeGreaterThan(0);
    const colNames = cols.map((c: { name: string }) => c.name);
    expect(colNames).toContain("key");
    expect(colNames).toContain("value");
  });

  it("save_events table does not exist (dropped by migration 010)", async () => {
    const tables = await db.raw(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='save_events'",
    );
    expect(tables).toHaveLength(0);
  });

  it("creates daily_snapshots table with unique constraint", async () => {
    const cols = await db.raw("PRAGMA table_info(daily_snapshots)");
    const colNames = cols.map((c: { name: string }) => c.name);
    expect(colNames).toContain("id");
    expect(colNames).toContain("project_id");
    expect(colNames).toContain("date");
    expect(colNames).toContain("total_word_count");
    expect(colNames).toContain("created_at");

    const indexes = await db.raw("PRAGMA index_list(daily_snapshots)");
    const uniqueIndexes = indexes.filter((i: { unique: number }) => i.unique === 1);
    expect(uniqueIndexes.length).toBeGreaterThan(0);
  });

  it("creates index on chapters(project_id)", async () => {
    const indexes = await db.raw("PRAGMA index_list(chapters)");
    const indexNames = indexes.map((i: { name: string }) => i.name);
    expect(indexNames.some((n: string) => n.includes("project_id"))).toBe(true);
  });

  it("empty daily_snapshots after fresh migration", async () => {
    const snapshots = await db("daily_snapshots").select("*");
    expect(snapshots).toHaveLength(0);
  });
});
