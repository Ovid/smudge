import { describe, it, expect, afterEach } from "vitest";
import { randomUUID as uuid } from "node:crypto";
import { setupTestDb } from "./test-helpers";
import * as ImagesRepo from "../images/images.repository";
import * as SnapshotsRepo from "../snapshots/snapshots.repository";
import * as OuttakesRepo from "../outtakes/outtakes.repository";
import { READ_AFTER_INSERT_FAILURE } from "../errors/readAfterInsert";
import { createOuttake } from "../outtakes/outtakes.service";
import { createSnapshot } from "../snapshots/snapshots.service";

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

// ---------------------------------------------------------------------------
// S8 (agentic review 2026-08-17): transaction membership, observed
// ---------------------------------------------------------------------------

describe("read-after-insert commit semantics through the service layer", () => {
  // The tests above call the repositories directly with `t.db`, so the one
  // fact the whole design rests on — that `images` inserts OUTSIDE a
  // transaction and the other two INSIDE — is never observed. That fact is
  // the sole justification for `image.upload` carrying `committedCodes` while
  // `outtake.create` and `snapshot.create` deliberately omit it, and
  // readAfterInsert.ts states it only as prose addressed to a human. If a
  // future refactor moves an insert across that boundary, the corresponding
  // client scope must move with it — these tests are what goes red.
  //
  // The lever is a trigger that SHIFTS the row's id rather than deleting it:
  // the confirming re-read misses, but the row itself survives the statement.
  // What happens to it next is decided purely by transaction membership.
  async function shiftIdAfterInsert(table: string) {
    await t.db.raw(`DROP TRIGGER IF EXISTS shift_${table}`);
    await t.db.raw(
      `CREATE TRIGGER shift_${table} AFTER INSERT ON ${table}
       BEGIN UPDATE ${table} SET id = id || '-x' WHERE id = NEW.id; END`,
    );
  }

  afterEach(async () => {
    for (const table of ["images", "chapter_snapshots", "outtakes"]) {
      await t.db.raw(`DROP TRIGGER IF EXISTS shift_${table}`);
    }
  });

  it("images: the row is COMMITTED — the insert runs outside any transaction", async () => {
    const projectId = await createProject();
    await shiftIdAfterInsert("images");

    await expect(
      ImagesRepo.insert(t.db, {
        id: uuid(),
        project_id: projectId,
        filename: "committed.png",
        mime_type: "image/png",
        size_bytes: 1,
        created_at: new Date().toISOString(),
      }),
    ).rejects.toMatchObject({ code: READ_AFTER_INSERT_FAILURE });

    // Still there. A retry would mint a duplicate — hence committedCodes.
    await expect(t.db("images").where({ project_id: projectId })).resolves.toHaveLength(1);
  });

  it("outtakes: the row ROLLS BACK — createOuttake wraps the insert", async () => {
    const projectId = await createProject();
    await shiftIdAfterInsert("outtakes");

    await expect(
      createOuttake(projectId, { type: "doc", content: [] }, "rolled-back"),
    ).rejects.toMatchObject({ code: READ_AFTER_INSERT_FAILURE });

    // Nothing survived, so retrying is safe and correct — hence NO
    // committedCodes on `outtake.create`.
    await expect(t.db("outtakes").where({ project_id: projectId })).resolves.toHaveLength(0);
  });

  it("snapshots: the row ROLLS BACK — createSnapshot wraps the insert", async () => {
    const projectId = await createProject();
    const chapterId = await createChapter(projectId);
    await shiftIdAfterInsert("chapter_snapshots");

    await expect(createSnapshot(chapterId, "rolled-back")).rejects.toMatchObject({
      code: READ_AFTER_INSERT_FAILURE,
    });

    await expect(t.db("chapter_snapshots").where({ chapter_id: chapterId })).resolves.toHaveLength(
      0,
    );
  });
});
