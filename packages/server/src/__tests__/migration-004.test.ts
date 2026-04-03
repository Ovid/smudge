import { describe, it, expect, beforeAll, afterAll } from "vitest";
import knex, { type Knex } from "knex";
import { createTestKnexConfig } from "../db/knexfile";

describe("migration 004: goals & velocity", () => {
  let db: Knex;

  beforeAll(async () => {
    db = knex(createTestKnexConfig());
    await db.raw("PRAGMA foreign_keys = ON");
    await db.migrate.latest();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("adds target columns to projects", async () => {
    const cols = await db.raw("PRAGMA table_info(projects)");
    const colNames = cols.map((c: { name: string }) => c.name);
    expect(colNames).toContain("target_word_count");
    expect(colNames).toContain("target_deadline");
    expect(colNames).toContain("completion_threshold");
  });

  it("adds target_word_count to chapters", async () => {
    const cols = await db.raw("PRAGMA table_info(chapters)");
    const colNames = cols.map((c: { name: string }) => c.name);
    expect(colNames).toContain("target_word_count");
  });

  it("creates settings table", async () => {
    const cols = await db.raw("PRAGMA table_info(settings)");
    expect(cols.length).toBeGreaterThan(0);
    const colNames = cols.map((c: { name: string }) => c.name);
    expect(colNames).toContain("key");
    expect(colNames).toContain("value");
  });

  it("creates save_events table with correct columns", async () => {
    const cols = await db.raw("PRAGMA table_info(save_events)");
    const colNames = cols.map((c: { name: string }) => c.name);
    expect(colNames).toContain("id");
    expect(colNames).toContain("chapter_id");
    expect(colNames).toContain("project_id");
    expect(colNames).toContain("word_count");
    expect(colNames).toContain("saved_at");
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

  it("creates index on save_events(project_id, saved_at)", async () => {
    const indexes = await db.raw("PRAGMA index_list(save_events)");
    expect(indexes.length).toBeGreaterThan(0);
  });

  it("creates index on chapters(project_id)", async () => {
    const indexes = await db.raw("PRAGMA index_list(chapters)");
    const indexNames = indexes.map((i: { name: string }) => i.name);
    expect(indexNames.some((n: string) => n.includes("project_id"))).toBe(true);
  });

  it("seeds baseline SaveEvents and DailySnapshots for existing data", async () => {
    const events = await db("save_events").select("*");
    const snapshots = await db("daily_snapshots").select("*");
    expect(events).toHaveLength(0);
    expect(snapshots).toHaveLength(0);
  });

  it("defaults completion_threshold to 'final'", async () => {
    const { v4: uuid } = await import("uuid");
    const id = uuid();
    await db("projects").insert({
      id,
      title: "Test",
      slug: "test",
      mode: "fiction",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const project = await db("projects").where({ id }).first();
    expect(project.completion_threshold).toBe("final");
  });
});
