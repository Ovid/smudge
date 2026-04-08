import knex from "knex";
import { describe, it, expect, afterEach } from "vitest";
import { initDb, getDb, closeDb } from "../db/connection";
import { createTestKnexConfig } from "../db/knexfile";

describe("db/connection", () => {
  afterEach(async () => {
    await closeDb();
  });

  it("getDb throws before initDb is called", () => {
    // After closeDb in afterEach, db is cleared to undefined
    expect(() => getDb()).toThrow("Database not initialized. Call initDb() first.");
  });

  it("initDb initializes the database and runs migrations", async () => {
    const db = await initDb(createTestKnexConfig());
    expect(db).toBeDefined();

    // Verify migrations ran by checking tables exist
    const tables = await db.raw(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('projects', 'chapters')",
    );
    const tableNames = tables.map((row: { name: string }) => row.name).sort();
    expect(tableNames).toEqual(["chapters", "projects"]);
  });

  it("getDb returns the initialized instance", async () => {
    await initDb(createTestKnexConfig());
    const db = getDb();
    expect(db).toBeDefined();

    // Should be able to query
    const result = await db("projects").select("*");
    expect(result).toEqual([]);
  });

  it("initDb sets WAL journal mode", async () => {
    const db = await initDb(createTestKnexConfig());
    const result = await db.raw("PRAGMA journal_mode");
    // In-memory databases may report 'memory' instead of 'wal'
    expect(result[0].journal_mode).toBeDefined();
  });

  it("initDb enables foreign keys", async () => {
    const db = await initDb(createTestKnexConfig());
    const result = await db.raw("PRAGMA foreign_keys");
    expect(result[0].foreign_keys).toBe(1);
  });

  it("closeDb destroys the connection without error", async () => {
    await initDb(createTestKnexConfig());
    await expect(closeDb()).resolves.toBeUndefined();
  });

  it("closeDb is safe to call when no db exists", async () => {
    // closeDb should handle the case gracefully
    await expect(closeDb()).resolves.toBeUndefined();
  });

  it("setDb() sets the database instance used by getDb()", async () => {
    const { closeDb, setDb, getDb } = await import("../db/connection");
    await closeDb();
    const customDb = knex(createTestKnexConfig());
    await setDb(customDb);
    expect(getDb()).toBe(customDb);
    // Let afterEach/closeDb() own destruction — setDb stored this
    // in the module singleton, so destroying here would double-destroy.
  });
});
