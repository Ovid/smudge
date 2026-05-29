import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { mkdtemp, mkdir, writeFile, rm, readdir } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import knex, { type Knex } from "knex";
import { createTestKnexConfig } from "../db/knexfile";
import * as imagesRepo from "../images/images.repository";
import { reapOrphanImages } from "../images/images.reaper";

vi.mock("../logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const PNG = Buffer.from("fake-png-bytes");

let db: Knex;
let dataDir: string;
let projectId: string;

beforeEach(async () => {
  db = knex(createTestKnexConfig());
  await db.migrate.latest();
  dataDir = await mkdtemp(path.join(tmpdir(), "smudge-reaper-test-"));
  projectId = uuidv4();
  await db("projects").insert({
    id: projectId,
    title: "Reaper Test",
    slug: "reaper-test",
    mode: "fiction",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
});

afterEach(async () => {
  await db.destroy();
  await rm(dataDir, { recursive: true, force: true });
});

async function writeImage(id: string): Promise<string> {
  const dir = path.join(dataDir, "images", projectId);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${id}.png`);
  await writeFile(file, PNG);
  return file;
}

describe("reapOrphanImages (F-14)", () => {
  it("deletes image files with no DB row and keeps files that have one", async () => {
    // Known image: row + file
    const knownId = uuidv4();
    await imagesRepo.insert(db, {
      id: knownId,
      project_id: projectId,
      filename: "known.png",
      mime_type: "image/png",
      size_bytes: PNG.length,
      created_at: new Date().toISOString(),
    });
    await writeImage(knownId);

    // Orphan image: file only, no row
    const orphanId = uuidv4();
    await writeImage(orphanId);

    const reaped = await reapOrphanImages(db, dataDir);

    expect(reaped).toBe(1);
    const remaining = await readdir(path.join(dataDir, "images", projectId));
    expect(remaining).toContain(`${knownId}.png`);
    expect(remaining).not.toContain(`${orphanId}.png`);
  });

  it("never deletes files that are not image-shaped (<uuid>.<ext>)", async () => {
    const dir = path.join(dataDir, "images", projectId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "notes.txt"), "not an image");
    await writeFile(path.join(dir, "README.md"), "leave me");

    const reaped = await reapOrphanImages(db, dataDir);

    expect(reaped).toBe(0);
    const remaining = await readdir(dir);
    expect(remaining).toEqual(expect.arrayContaining(["notes.txt", "README.md"]));
  });

  it("returns 0 when the images directory does not exist (fresh install)", async () => {
    const reaped = await reapOrphanImages(db, dataDir);
    expect(reaped).toBe(0);
  });
});
