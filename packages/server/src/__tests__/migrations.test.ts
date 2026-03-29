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

describe("migration 002 slug backfill", () => {
  let db: Knex;

  beforeAll(async () => {
    db = knex(createTestKnexConfig());
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("backfills slugs for existing projects", async () => {
    // Run only migration 001
    await db.migrate.up();

    // Insert projects without slugs (slug column doesn't exist yet)
    const now = new Date().toISOString();
    await db("projects").insert({
      id: "p1",
      title: "My Novel",
      mode: "fiction",
      created_at: now,
      updated_at: now,
    });
    await db("projects").insert({
      id: "p2",
      title: "Another Book",
      mode: "nonfiction",
      created_at: now,
      updated_at: now,
    });

    // Run migration 002
    await db.migrate.up();

    const p1 = await db("projects").where({ id: "p1" }).first();
    const p2 = await db("projects").where({ id: "p2" }).first();
    expect(p1.slug).toBe("my-novel");
    expect(p2.slug).toBe("another-book");
  });

  it("handles slug collisions during backfill for same-titled projects", async () => {
    // Roll back everything and start fresh
    await db.migrate.rollback(undefined, true);

    // Run only migration 001
    await db.migrate.up();

    // Insert two projects with the same title
    const now = new Date().toISOString();
    await db("projects").insert({
      id: "p1",
      title: "My Novel",
      mode: "fiction",
      created_at: now,
      updated_at: now,
    });
    await db("projects").insert({
      id: "p2",
      title: "My Novel",
      mode: "nonfiction",
      created_at: now,
      updated_at: now,
    });

    // Run migration 002 — should not fail
    await db.migrate.up();

    const p1 = await db("projects").where({ id: "p1" }).first();
    const p2 = await db("projects").where({ id: "p2" }).first();

    // One should get "my-novel", the other "my-novel-2"
    const slugs = [p1.slug, p2.slug].sort();
    expect(slugs).toEqual(["my-novel", "my-novel-2"]);
  });
});
