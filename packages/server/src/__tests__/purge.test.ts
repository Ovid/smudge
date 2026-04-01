import { describe, it, expect } from "vitest";
import knex from "knex";
import { createTestKnexConfig } from "../db/knexfile";
import { purgeOldTrash } from "../db/purge";

describe("purgeOldTrash", () => {
  it("deletes chapters trashed more than 30 days ago", async () => {
    const db = knex(createTestKnexConfig());
    await db.raw("PRAGMA foreign_keys = ON");
    await db.migrate.latest();

    const now = new Date();
    const old = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();

    await db("projects").insert({
      id: "p1",
      title: "Test",
      mode: "fiction",
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });
    await db("chapters").insert({
      id: "ch-old",
      project_id: "p1",
      title: "Old",
      sort_order: 0,
      word_count: 0,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      deleted_at: old,
    });
    await db("chapters").insert({
      id: "ch-recent",
      project_id: "p1",
      title: "Recent",
      sort_order: 1,
      word_count: 0,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      deleted_at: recent,
    });

    const count = await purgeOldTrash(db);

    expect(count.chapters).toBe(1);
    const remaining = await db("chapters").select("id");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("ch-recent");

    await db.destroy();
  });

  it("deletes projects trashed more than 30 days ago", async () => {
    const db = knex(createTestKnexConfig());
    await db.raw("PRAGMA foreign_keys = ON");
    await db.migrate.latest();

    const now = new Date();
    const old = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();

    await db("projects").insert({
      id: "p-old",
      title: "Old Project",
      mode: "fiction",
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      deleted_at: old,
    });

    const count = await purgeOldTrash(db);

    expect(count.projects).toBe(1);
    const remaining = await db("projects").select("id");
    expect(remaining).toHaveLength(0);

    await db.destroy();
  });

  it("preserves non-deleted chapters when purging their expired project", async () => {
    const db = knex(createTestKnexConfig());
    await db.raw("PRAGMA foreign_keys = ON");
    await db.migrate.latest();

    const now = new Date();
    const old = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();

    // Project is expired
    await db("projects").insert({
      id: "p-expired",
      title: "Expired Project",
      mode: "fiction",
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      deleted_at: old,
    });

    // Chapter was restored (deleted_at is null) even though project is expired
    await db("chapters").insert({
      id: "ch-restored",
      project_id: "p-expired",
      title: "Restored Chapter",
      sort_order: 0,
      word_count: 0,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      deleted_at: null,
    });

    // Soft-deleted chapter should still be purged
    await db("chapters").insert({
      id: "ch-deleted",
      project_id: "p-expired",
      title: "Deleted Chapter",
      sort_order: 1,
      word_count: 0,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      deleted_at: old,
    });

    await purgeOldTrash(db);

    // ch-deleted is purged (expired on its own), ch-restored is preserved
    const remaining = await db("chapters").select("id");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("ch-restored");

    await db.destroy();
  });
});
