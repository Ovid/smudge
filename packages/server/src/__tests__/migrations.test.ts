import { describe, it, expect, afterAll, beforeAll } from "vitest";
import knex, { type Knex } from "knex";
import { createTestKnexConfig } from "../db/knexfile";

describe("migrations", () => {
  let db: Knex;

  beforeAll(async () => {
    db = knex(createTestKnexConfig());
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("up creates projects and chapters tables", async () => {
    await db.migrate.latest();

    const tables = await db.raw(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('projects', 'chapters') ORDER BY name",
    );
    expect(tables.map((r: { name: string }) => r.name)).toEqual(["chapters", "projects"]);
  });

  it("down removes projects and chapters tables", async () => {
    // Ensure tables exist first
    await db.migrate.latest();

    // Now rollback
    await db.migrate.rollback();

    const tables = await db.raw(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('projects', 'chapters')",
    );
    expect(tables).toEqual([]);
  });
});
