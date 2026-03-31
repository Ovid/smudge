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

describe("migration 003 chapter statuses", () => {
  let db: Knex;

  beforeAll(async () => {
    db = knex(createTestKnexConfig());
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("seeds chapter_statuses table with 5 statuses", async () => {
    await db.migrate.latest();

    const statuses = await db("chapter_statuses").orderBy("sort_order");
    expect(statuses).toEqual([
      { status: "outline", sort_order: 1, label: "Outline" },
      { status: "rough_draft", sort_order: 2, label: "Rough Draft" },
      { status: "revised", sort_order: 3, label: "Revised" },
      { status: "edited", sort_order: 4, label: "Edited" },
      { status: "final", sort_order: 5, label: "Final" },
    ]);
  });

  it("adds status column to chapters with default 'outline'", async () => {
    // Roll back everything and start fresh
    await db.migrate.rollback(undefined, true);

    // Run migrations 001 and 002
    await db.migrate.up();
    await db.migrate.up();

    // Insert a project and chapter before migration 003
    const now = new Date().toISOString();
    await db("projects").insert({
      id: "p1",
      slug: "test-project",
      title: "Test Project",
      mode: "fiction",
      created_at: now,
      updated_at: now,
    });
    await db("chapters").insert({
      id: "c1",
      project_id: "p1",
      title: "Chapter 1",
      sort_order: 0,
      word_count: 0,
      created_at: now,
      updated_at: now,
    });

    // Run migration 003
    await db.migrate.up();

    const chapter = await db("chapters").where({ id: "c1" }).first();
    expect(chapter.status).toBe("outline");
  });
});
