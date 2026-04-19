import { describe, it, expect, vi } from "vitest";
import knex from "knex";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
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

    expect(count).toEqual({ chapters: 1, projects: 0, images: 0 });
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

    expect(count).toEqual({ chapters: 0, projects: 1, images: 0 });
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

  it("deletes image DB records when a project is purged", async () => {
    const db = knex(createTestKnexConfig());
    await db.raw("PRAGMA foreign_keys = ON");
    await db.migrate.latest();

    const now = new Date();
    const old = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();

    await db("projects").insert({
      id: "p-img",
      title: "Image Project",
      mode: "fiction",
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      deleted_at: old,
    });

    await db("images").insert({
      id: "img-1",
      project_id: "p-img",
      filename: "photo.jpg",
      mime_type: "image/jpeg",
      size_bytes: 1024,
      created_at: now.toISOString(),
    });
    await db("images").insert({
      id: "img-2",
      project_id: "p-img",
      filename: "diagram.png",
      mime_type: "image/png",
      size_bytes: 2048,
      created_at: now.toISOString(),
    });

    const result = await purgeOldTrash(db);

    expect(result.images).toBe(2);
    expect(result.projects).toBe(1);
    const remainingImages = await db("images").select("id");
    expect(remainingImages).toHaveLength(0);

    await db.destroy();
  });

  it("removes image directory from disk when a project is purged", async () => {
    const db = knex(createTestKnexConfig());
    await db.raw("PRAGMA foreign_keys = ON");
    await db.migrate.latest();

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "smudge-purge-"));

    const now = new Date();
    const old = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();

    await db("projects").insert({
      id: "p-disk",
      title: "Disk Project",
      mode: "fiction",
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      deleted_at: old,
    });

    // Create the image directory with a file
    const imageDir = path.join(tmpDir, "images", "p-disk");
    await fs.mkdir(imageDir, { recursive: true });
    await fs.writeFile(path.join(imageDir, "photo.jpg"), "fake-image-data");

    const warnSpy = vi
      .spyOn((await import("../logger")).logger, "warn")
      .mockImplementation(() => {});

    await purgeOldTrash(db, tmpDir);

    // Directory should be gone
    await expect(fs.access(imageDir)).rejects.toThrow();

    warnSpy.mockRestore();
    await fs.rm(tmpDir, { recursive: true, force: true });
    await db.destroy();
  });

  it("deletes chapter snapshots when a standalone chapter is purged", async () => {
    const db = knex(createTestKnexConfig());
    await db.raw("PRAGMA foreign_keys = ON");
    await db.migrate.latest();

    const now = new Date();
    const old = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();

    await db("projects").insert({
      id: "p-snap",
      title: "Snapshot Project",
      mode: "fiction",
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });
    await db("chapters").insert({
      id: "ch-snap",
      project_id: "p-snap",
      title: "Snapped Chapter",
      sort_order: 0,
      word_count: 10,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      deleted_at: old,
    });
    await db("chapter_snapshots").insert({
      id: "snap-1",
      chapter_id: "ch-snap",
      content: '{"type":"doc"}',
      word_count: 10,
      is_auto: false,
      created_at: now.toISOString(),
    });

    const result = await purgeOldTrash(db);

    expect(result.chapters).toBe(1);
    const remainingSnapshots = await db("chapter_snapshots").select("id");
    expect(remainingSnapshots).toHaveLength(0);

    await db.destroy();
  });

  it("deletes chapter snapshots when a project is purged", async () => {
    const db = knex(createTestKnexConfig());
    await db.raw("PRAGMA foreign_keys = ON");
    await db.migrate.latest();

    const now = new Date();
    const old = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();

    await db("projects").insert({
      id: "p-snap-proj",
      title: "Snapshot Project Purge",
      mode: "fiction",
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      deleted_at: old,
    });
    await db("chapters").insert({
      id: "ch-snap-proj",
      project_id: "p-snap-proj",
      title: "Chapter In Purged Project",
      sort_order: 0,
      word_count: 5,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      deleted_at: old,
    });
    await db("chapter_snapshots").insert({
      id: "snap-proj-1",
      chapter_id: "ch-snap-proj",
      content: '{"type":"doc"}',
      word_count: 5,
      is_auto: true,
      created_at: now.toISOString(),
    });

    const result = await purgeOldTrash(db);

    expect(result.projects).toBe(1);
    expect(result.chapters).toBe(1);
    const remainingSnapshots = await db("chapter_snapshots").select("id");
    expect(remainingSnapshots).toHaveLength(0);

    await db.destroy();
  });

  it("does not delete images for non-purged projects", async () => {
    const db = knex(createTestKnexConfig());
    await db.raw("PRAGMA foreign_keys = ON");
    await db.migrate.latest();

    const now = new Date();
    const old = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();

    // Purged project
    await db("projects").insert({
      id: "p-gone",
      title: "Gone Project",
      mode: "fiction",
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      deleted_at: old,
    });
    await db("images").insert({
      id: "img-gone",
      project_id: "p-gone",
      filename: "gone.jpg",
      mime_type: "image/jpeg",
      size_bytes: 1024,
      created_at: now.toISOString(),
    });

    // Active project
    await db("projects").insert({
      id: "p-alive",
      title: "Alive Project",
      mode: "fiction",
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });
    await db("images").insert({
      id: "img-alive",
      project_id: "p-alive",
      filename: "keep.jpg",
      mime_type: "image/jpeg",
      size_bytes: 2048,
      created_at: now.toISOString(),
    });

    const result = await purgeOldTrash(db);

    expect(result.images).toBe(1);
    const remainingImages = await db("images").select("id");
    expect(remainingImages).toHaveLength(1);
    expect(remainingImages[0].id).toBe("img-alive");

    await db.destroy();
  });
});
