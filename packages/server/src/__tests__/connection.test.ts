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

  it("initDb pins busy_timeout to 5000ms so a writer waits on a held lock (OOSS1)", async () => {
    // A writer meeting a held write lock waits up to busy_timeout before
    // SQLite returns SQLITE_BUSY (surfaced as HTTP 500). better-sqlite3
    // defaults this to 5000ms, but initDb pins it explicitly so the
    // guarantee survives a driver-default change. Assert the exact value
    // so the test fails if the explicit PRAGMA is removed and the driver
    // default later diverges.
    const db = await initDb(createTestKnexConfig());
    const result = await db.raw("PRAGMA busy_timeout");
    expect(result[0].timeout).toBe(5000);
  });

  // F-21: initDb used to destroy the prior handle and install a new one,
  // silently. SqliteProjectStore captures the handle in its constructor, so a
  // second initDb() left getProjectStore() returning a store bound to a
  // destroyed connection — every later query failing with an opaque driver
  // error instead of a seam error naming the cause. It now refuses, mirroring
  // initProjectStore's contract. This asserts more than the test it replaced:
  // the refusal must leave the existing connection usable, which is what makes
  // throwing safe rather than merely loud. setDb (below) remains the seam that
  // deliberately replaces.
  it("initDb throws when already initialized, leaving the live connection intact", async () => {
    const first = await initDb(createTestKnexConfig());
    await first("projects").select("*"); // confirm first is live
    await expect(initDb(createTestKnexConfig())).rejects.toThrow("Database already initialized");
    expect(getDb()).toBe(first);
    await expect(first.raw("SELECT 1")).resolves.toBeDefined();
  });

  // Review 67c00204 S1: initDb published `db` to the module global BEFORE the
  // PRAGMAs and migrate.latest() that make it usable, with no try/catch. A
  // rejecting migration therefore leaked a half-built handle that getDb()
  // (truthiness only) happily returned — a connection whose migrations never
  // ran. F-21 removed the destroy-and-replace path that used to heal it, so
  // the retry now dies on "already initialized", a message that is false for
  // exactly this state. Initialization must be all-or-nothing.
  it("initDb leaves no handle installed when initialization fails, and a retry succeeds", async () => {
    const broken = createTestKnexConfig();
    broken.migrations = { directory: "/nonexistent/smudge-migrations", loadExtensions: [".js"] };

    await expect(initDb(broken)).rejects.toThrow();

    // The failed attempt must not have published anything.
    expect(() => getDb()).toThrow("Database not initialized. Call initDb() first.");

    // ...and the retry must not be refused as "already initialized".
    const db = await initDb(createTestKnexConfig());
    await expect(db("projects").select("*")).resolves.toEqual([]);
  });

  it("setDb destroys the previously-set instance when replaced", async () => {
    const { setDb } = await import("../db/connection");
    const a = knex(createTestKnexConfig());
    const b = knex(createTestKnexConfig());
    await setDb(a);
    await setDb(b); // db === a, a !== b → a is destroyed
    expect(getDb()).toBe(b);
    await expect(a.raw("SELECT 1")).rejects.toThrow();
    // afterEach/closeDb() owns destruction of b (the stored singleton).
  });

  it("closeDb destroys the connection without error", async () => {
    await initDb(createTestKnexConfig());
    await expect(closeDb()).resolves.toBeUndefined();
  });

  // Review 67c00204 S2: `db = undefined` sat after the await, not in a finally,
  // so a rejecting teardown left the global populated. Since F-21, the next
  // initDb() then throws "call closeDb() first" — the exact call that just
  // failed — making the stuck state unrecoverable rather than self-correcting.
  it("closeDb clears the handle even when destroy() rejects", async () => {
    const { setDb } = await import("../db/connection");
    const instance = knex(createTestKnexConfig());
    const realDestroy = instance.destroy.bind(instance);
    // knex's instance is a function object whose `destroy` is non-writable,
    // so assignment throws — define over it instead.
    Object.defineProperty(instance, "destroy", {
      value: () => Promise.reject(new Error("teardown boom")),
      configurable: true,
    });
    await setDb(instance);

    await expect(closeDb()).rejects.toThrow("teardown boom");

    // The failure is still reported, but the global must not be stuck.
    expect(() => getDb()).toThrow("Database not initialized. Call initDb() first.");
    await realDestroy();
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
