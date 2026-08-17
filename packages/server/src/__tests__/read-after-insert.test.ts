import { describe, it, expect } from "vitest";
import { randomUUID as uuid } from "node:crypto";
import { setupTestDb } from "./test-helpers";
import * as ImagesRepo from "../images/images.repository";
import * as SnapshotsRepo from "../snapshots/snapshots.repository";
import * as OuttakesRepo from "../outtakes/outtakes.repository";
import { READ_AFTER_INSERT_FAILURE } from "../errors/readAfterInsert";

// Safety net for F-12 (architecture report 2026-08-11).
//
// Every `insert()` in the repository layer re-reads the row it just wrote
// rather than echoing its input, and throws when that re-read comes back
// empty. Those `if (!row) throw` arms were dead in the coverage report for
// all three of these modules — which is exactly the code F-12 restructures,
// so the behaviour is pinned here BEFORE that fix moves it.
//
// These assertions deliberately test only that the read-after-insert failure
// REJECTS and yields no row. They do NOT assert the error class, code, or
// message: F-12's whole point is that a bare `Error` is the wrong taxonomy
// and should become a discriminating AppError. Pinning the message here
// would mean editing this file during the fix, which is precisely what a
// safety net must not require. The discriminating code gets its own
// assertions in F-12's own tests.
//
// The vanishing row is driven by a SQLite AFTER INSERT trigger rather than a
// mocked query builder, so the test survives the re-read moving between a
// store, a txStore, or a different Knex call — it constrains the database's
// observable behaviour, not the shape of the code that reads it. This is the
// same technique the F-27 fix used for its own read-after-write arm.

const t = setupTestDb();

/**
 * Makes any INSERT into `table` land and then immediately vanish.
 *
 * Idempotent: the trigger outlives an individual test within this file, and
 * two tests here target the same table.
 */
async function vanishAfterInsert(table: string) {
  await t.db.raw(`DROP TRIGGER IF EXISTS vanish_${table}`);
  await t.db.raw(
    `CREATE TRIGGER vanish_${table} AFTER INSERT ON ${table}
     BEGIN DELETE FROM ${table} WHERE id = NEW.id; END`,
  );
}

async function createProject() {
  const id = uuid();
  const now = new Date().toISOString();
  await t.db("projects").insert({
    id,
    title: "Read After Insert",
    slug: `rai-${id.slice(0, 8)}`,
    mode: "fiction",
    created_at: now,
    updated_at: now,
  });
  return id;
}

async function createChapter(projectId: string) {
  const id = uuid();
  const now = new Date().toISOString();
  await t.db("chapters").insert({
    id,
    project_id: projectId,
    title: "Chapter",
    content: '{"type":"doc","content":[]}',
    sort_order: 0,
    word_count: 0,
    status: "outline",
    created_at: now,
    updated_at: now,
  });
  return id;
}

describe("read-after-insert failure (F-12 safety net)", () => {
  it("images.insert rejects when the written row cannot be read back", async () => {
    const projectId = await createProject();
    await vanishAfterInsert("images");

    await expect(
      ImagesRepo.insert(t.db, {
        id: uuid(),
        project_id: projectId,
        filename: "gone.png",
        mime_type: "image/png",
        size_bytes: 1,
        created_at: new Date().toISOString(),
      }),
    ).rejects.toThrow();
  });

  it("snapshots.insert rejects when the written row cannot be read back", async () => {
    const projectId = await createProject();
    const chapterId = await createChapter(projectId);
    await vanishAfterInsert("chapter_snapshots");

    await expect(
      SnapshotsRepo.insert(t.db, {
        id: uuid(),
        chapter_id: chapterId,
        label: null,
        content: '{"type":"doc","content":[]}',
        word_count: 0,
        is_auto: false,
        created_at: new Date().toISOString(),
      }),
    ).rejects.toThrow();
  });

  it("outtakes.insert rejects when the written row cannot be read back", async () => {
    const projectId = await createProject();
    await vanishAfterInsert("outtakes");
    const now = new Date().toISOString();

    await expect(
      OuttakesRepo.insert(t.db, {
        id: uuid(),
        project_id: projectId,
        label: null,
        content: '{"type":"doc","content":[]}',
        created_at: now,
        updated_at: now,
      }),
    ).rejects.toThrow();
  });

  it("carries a discriminating code so the client can branch on it (F-12)", async () => {
    // A bare Error was clamped by globalErrorHandler to a generic 500 with no
    // code, and the client's scope registry discriminates entirely on
    // error.code — so there was nothing to branch on. `projects` already
    // emitted a discriminating code for this exact condition.
    const projectId = await createProject();
    await vanishAfterInsert("images");

    await expect(
      ImagesRepo.insert(t.db, {
        id: uuid(),
        project_id: projectId,
        filename: "gone.png",
        mime_type: "image/png",
        size_bytes: 1,
        created_at: new Date().toISOString(),
      }),
    ).rejects.toMatchObject({ code: READ_AFTER_INSERT_FAILURE, status: 500 });
  });

  it("uses ONE code across all three modules — commit semantics are the scope's job", async () => {
    // Deliberately the same code everywhere: it is one condition. Whether it
    // means "possibly committed" depends on whether the caller wrapped the
    // insert in a transaction, which is a per-call-site fact the client scope
    // records — not something the code itself can express.
    const projectId = await createProject();
    const chapterId = await createChapter(projectId);
    await vanishAfterInsert("chapter_snapshots");
    await vanishAfterInsert("outtakes");
    const now = new Date().toISOString();

    await expect(
      SnapshotsRepo.insert(t.db, {
        id: uuid(),
        chapter_id: chapterId,
        label: null,
        content: '{"type":"doc","content":[]}',
        word_count: 0,
        is_auto: false,
        created_at: now,
      }),
    ).rejects.toMatchObject({ code: READ_AFTER_INSERT_FAILURE });

    await expect(
      OuttakesRepo.insert(t.db, {
        id: uuid(),
        project_id: projectId,
        label: null,
        content: '{"type":"doc","content":[]}',
        created_at: now,
        updated_at: now,
      }),
    ).rejects.toMatchObject({ code: READ_AFTER_INSERT_FAILURE });
  });

  it("does not silently return a fabricated row in place of the vanished one", async () => {
    // The failure mode the throw exists to prevent: echoing the caller's own
    // input back as if it were persisted state. A caller that receives a row
    // here would report success for a write that is not in the database.
    const projectId = await createProject();
    await vanishAfterInsert("outtakes");
    const now = new Date().toISOString();
    const id = uuid();

    const result = await OuttakesRepo.insert(t.db, {
      id,
      project_id: projectId,
      label: "vanished",
      content: '{"type":"doc","content":[]}',
      created_at: now,
      updated_at: now,
    }).catch(() => "threw" as const);

    expect(result).toBe("threw");
    await expect(OuttakesRepo.findById(t.db, id)).resolves.toBeNull();
  });
});
