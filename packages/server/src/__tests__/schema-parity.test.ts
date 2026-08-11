import { describe, it, expect, beforeAll, afterAll } from "vitest";
import knex, { type Knex } from "knex";
import { ChapterStatus } from "@smudge/shared";
import { createTestKnexConfig } from "../db/knexfile";

// Two invariants that live in both TypeScript and the SQLite schema, with
// nothing previously checking that the two agree.

let db: Knex;

beforeAll(async () => {
  db = knex(createTestKnexConfig());
  await db.migrate.latest();
});

afterAll(async () => {
  await db.destroy();
});

describe("chapter-status closed set matches the seeded table (S9)", () => {
  // The set is encoded in ChapterStatus (schemas.ts), in migration 003's seed
  // insert, and restated in two test files. The chapters.status column carries
  // neither a CHECK constraint nor an FK to chapter_statuses, so the DB will
  // not catch a mismatch.
  //
  // Drift is not silent-but-harmless: chapters.service.updateChapter validates
  // an incoming status with `store.findStatusByStatus(...)`, a DB lookup. A
  // value added to the Zod enum but not to the seed table therefore passes Zod
  // and is then rejected by the service as "Invalid status" — a 400 the client
  // has no way to anticipate, since its own type says the value is legal. A
  // value seeded but missing from the enum is rejected at the schema instead.
  // That service check is the runtime net; this test is what makes it dead
  // code rather than load-bearing, so keep both.

  it("the Zod enum and the seed table hold exactly the same statuses", async () => {
    const seeded = await db("chapter_statuses").pluck("status");
    expect([...seeded].sort()).toEqual([...ChapterStatus.options].sort());
  });

  it("every seeded status carries a label and a unique sort_order", async () => {
    const rows = await db("chapter_statuses").select("status", "label", "sort_order");
    for (const row of rows) {
      expect(row.label, `status ${row.status} has no label`).toBeTruthy();
    }
    const orders = rows.map((r: { sort_order: number }) => r.sort_order);
    expect(new Set(orders).size, "sort_order values are not unique").toBe(orders.length);
  });
});

describe("every project-child table is covered on project purge (S10)", () => {
  // "A purged project's children are removed" is enforced TWO ways, and which
  // way a table uses is not visible from its own migration:
  //   - chapters and images are deleted EXPLICITLY by purge.ts, before the
  //     project row goes (purge needs their ids anyway — images to unlink the
  //     files on disk, chapters to decide whether the project is purgeable);
  //   - daily_snapshots and outtakes rely on ON DELETE CASCADE.
  // Nothing forced a NEW project-child table to join either camp.
  //
  // The failure mode is not a leaked row — it is a server that never binds.
  // index.ts awaits purgeOldTrash(db) bare at startup and main().catch() calls
  // process.exit(1), so a new child table with a NOT NULL project_id FK and
  // neither mechanism makes purge.ts's `delete from projects` violate that
  // constraint (PRAGMA foreign_keys is ON — connection.ts sets it), and
  // Smudge fails to start on the first day a 30-day-old trashed project ages
  // out. Nothing in the test suite would have caught it first.
  //
  // ┌─ NEW TABLE WITH A project_id FK? ──────────────────────────────────────┐
  // │ Give it `.onDelete("CASCADE")` and list it under CASCADING, or delete  │
  // │ its rows explicitly in purge.ts and list it under EXPLICITLY_PURGED.   │
  // └────────────────────────────────────────────────────────────────────────┘
  const CASCADING = ["daily_snapshots", "outtakes"];
  const EXPLICITLY_PURGED = ["chapters", "images"];

  it("the two lists together cover every table with a project_id column", async () => {
    const tables: { name: string }[] = await db.raw(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'knex_%'",
    );

    const withProjectId: string[] = [];
    for (const { name } of tables) {
      const cols: { name: string }[] = await db.raw(`PRAGMA table_info("${name}")`);
      if (cols.some((c) => c.name === "project_id")) withProjectId.push(name);
    }
    expect([...withProjectId].sort()).toEqual([...CASCADING, ...EXPLICITLY_PURGED].sort());
  });

  it.each(CASCADING)("%s cascades its project_id FK", async (table) => {
    const fks: { table: string; from: string; on_delete: string }[] = await db.raw(
      `PRAGMA foreign_key_list("${table}")`,
    );
    const projectFk = fks.find((fk) => fk.from === "project_id" && fk.table === "projects");
    expect(projectFk, `${table}.project_id has no FK to projects`).toBeDefined();
    expect(projectFk!.on_delete, `${table}.project_id FK does not cascade`).toBe("CASCADE");
  });

  it.each(EXPLICITLY_PURGED)("purge.ts deletes from %s by project id", async (table) => {
    // These do NOT cascade, so purge.ts is the only thing standing between a
    // project delete and an FK violation. Assert the delete is actually there.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { resolve, dirname } = await import("node:path");
    const purgeSource = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../db/purge.ts"),
      "utf8",
    );
    expect(
      purgeSource,
      `purge.ts has no trx("${table}") delete — a project purge will violate its FK`,
    ).toContain(`trx("${table}")`);
  });
});
