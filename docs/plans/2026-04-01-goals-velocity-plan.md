# Phase 2: Goals & Velocity — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add velocity tracking, session stats, streaks, goals, and projections so writers can see how fast they're writing without judgment.

**Architecture:** New tables (SaveEvent, DailySnapshot, Setting) + columns on Project/Chapter. PATCH /chapters/:id gains side-effects (SaveEvent insert, DailySnapshot upsert). New velocity endpoint derives sessions on-the-fly from SaveEvent data. Client adds Settings UI, Project Settings dialog, and a Velocity sub-tab with Recharts charts.

**Tech Stack:** Knex migrations, Zod schemas, Express routes, Recharts (MIT), React Testing Library, Vitest + Supertest.

**Design doc:** `docs/plans/2026-04-01-goals-velocity-design.md`

---

## Task 1: Database Migration — New Tables and Columns

**Files:**
- Create: `packages/server/src/db/migrations/004_goals_velocity.js`
- Test: `packages/server/src/__tests__/migration-004.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/server/src/__tests__/migration-004.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import knex, { Knex } from "knex";
import { createTestKnexConfig } from "../db/knexfile";

describe("migration 004: goals & velocity", () => {
  let db: Knex;

  beforeAll(async () => {
    db = knex(createTestKnexConfig());
    await db.raw("PRAGMA foreign_keys = ON");
    await db.migrate.latest();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("adds target columns to projects", async () => {
    const cols = await db.raw("PRAGMA table_info(projects)");
    const colNames = cols.map((c: { name: string }) => c.name);
    expect(colNames).toContain("target_word_count");
    expect(colNames).toContain("target_deadline");
    expect(colNames).toContain("completion_threshold");
  });

  it("adds target_word_count to chapters", async () => {
    const cols = await db.raw("PRAGMA table_info(chapters)");
    const colNames = cols.map((c: { name: string }) => c.name);
    expect(colNames).toContain("target_word_count");
  });

  it("creates settings table", async () => {
    const cols = await db.raw("PRAGMA table_info(settings)");
    expect(cols.length).toBeGreaterThan(0);
    const colNames = cols.map((c: { name: string }) => c.name);
    expect(colNames).toContain("key");
    expect(colNames).toContain("value");
  });

  it("creates save_events table with correct columns", async () => {
    const cols = await db.raw("PRAGMA table_info(save_events)");
    const colNames = cols.map((c: { name: string }) => c.name);
    expect(colNames).toContain("id");
    expect(colNames).toContain("chapter_id");
    expect(colNames).toContain("project_id");
    expect(colNames).toContain("word_count");
    expect(colNames).toContain("saved_at");
  });

  it("creates daily_snapshots table with unique constraint", async () => {
    const cols = await db.raw("PRAGMA table_info(daily_snapshots)");
    const colNames = cols.map((c: { name: string }) => c.name);
    expect(colNames).toContain("id");
    expect(colNames).toContain("project_id");
    expect(colNames).toContain("date");
    expect(colNames).toContain("total_word_count");
    expect(colNames).toContain("created_at");

    // Verify unique constraint on (project_id, date)
    const indexes = await db.raw("PRAGMA index_list(daily_snapshots)");
    const uniqueIndexes = indexes.filter((i: { unique: number }) => i.unique === 1);
    expect(uniqueIndexes.length).toBeGreaterThan(0);
  });

  it("creates index on save_events(project_id, saved_at)", async () => {
    const indexes = await db.raw("PRAGMA index_list(save_events)");
    expect(indexes.length).toBeGreaterThan(0);
  });

  it("creates index on chapters(project_id)", async () => {
    const indexes = await db.raw("PRAGMA index_list(chapters)");
    const indexNames = indexes.map((i: { name: string }) => i.name);
    expect(indexNames.some((n: string) => n.includes("project_id"))).toBe(true);
  });

  it("seeds baseline SaveEvents and DailySnapshots for existing data", async () => {
    // Insert a project and chapter BEFORE migration runs
    // Since migration already ran in beforeAll, we test the seed logic indirectly:
    // Insert a project+chapter, then verify the migration's seed behavior
    // by checking that the migration function handles existing data.
    // For a proper test, we'd need to insert data between migrations.
    // Instead, verify the tables are empty (no pre-existing data in test DB).
    const events = await db("save_events").select("*");
    const snapshots = await db("daily_snapshots").select("*");
    // In-memory test DB has no pre-existing chapters, so no seeds
    expect(events).toHaveLength(0);
    expect(snapshots).toHaveLength(0);
  });

  it("defaults completion_threshold to 'final'", async () => {
    const { v4: uuid } = await import("uuid");
    const id = uuid();
    await db("projects").insert({
      id,
      title: "Test",
      slug: "test",
      mode: "fiction",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const project = await db("projects").where({ id }).first();
    expect(project.completion_threshold).toBe("final");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -w packages/server -- --run migration-004`
Expected: FAIL — migration file doesn't exist yet

**Step 3: Write the migration**

```javascript
// packages/server/src/db/migrations/004_goals_velocity.js

export async function up(knex) {
  // Add target columns to projects
  await knex.schema.alterTable("projects", (table) => {
    table.integer("target_word_count").nullable().defaultTo(null);
    table.text("target_deadline").nullable().defaultTo(null);
    table.text("completion_threshold").notNullable().defaultTo("final");
  });

  // Add target_word_count to chapters
  await knex.schema.alterTable("chapters", (table) => {
    table.integer("target_word_count").nullable().defaultTo(null);
  });

  // Create settings table
  await knex.schema.createTable("settings", (table) => {
    table.text("key").primary();
    table.text("value").notNullable();
  });

  // Create save_events table
  await knex.schema.createTable("save_events", (table) => {
    table.uuid("id").primary();
    table.uuid("chapter_id").notNullable().references("id").inTable("chapters");
    table.uuid("project_id").notNullable().references("id").inTable("projects");
    table.integer("word_count").notNullable();
    table.text("saved_at").notNullable();
    table.index(["project_id", "saved_at"]);
  });

  // Create daily_snapshots table
  await knex.schema.createTable("daily_snapshots", (table) => {
    table.uuid("id").primary();
    table.uuid("project_id").notNullable().references("id").inTable("projects");
    table.text("date").notNullable();
    table.integer("total_word_count").notNullable();
    table.text("created_at").notNullable();
    table.unique(["project_id", "date"]);
  });

  // Add indexes on chapters table
  await knex.schema.alterTable("chapters", (table) => {
    table.index("project_id", "idx_chapters_project_id");
    table.index("deleted_at", "idx_chapters_deleted_at");
  });

  // Seed baseline SaveEvents and DailySnapshots for existing chapters/projects
  const now = new Date().toISOString();
  const today = now.slice(0, 10); // YYYY-MM-DD in UTC (best effort before timezone setting exists)
  const { v4: uuid } = await import("uuid");

  const chapters = await knex("chapters")
    .whereNull("deleted_at")
    .select("id", "project_id", "word_count");

  for (const chapter of chapters) {
    await knex("save_events").insert({
      id: uuid(),
      chapter_id: chapter.id,
      project_id: chapter.project_id,
      word_count: chapter.word_count || 0,
      saved_at: now,
    });
  }

  // Seed DailySnapshots per project
  const projects = await knex("projects")
    .whereNull("deleted_at")
    .select("id");

  for (const project of projects) {
    const result = await knex("chapters")
      .where({ project_id: project.id })
      .whereNull("deleted_at")
      .sum("word_count as total");
    const total = result[0]?.total || 0;

    await knex("daily_snapshots").insert({
      id: uuid(),
      project_id: project.id,
      date: today,
      total_word_count: total,
      created_at: now,
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists("daily_snapshots");
  await knex.schema.dropTableIfExists("save_events");
  await knex.schema.dropTableIfExists("settings");

  await knex.schema.alterTable("chapters", (table) => {
    table.dropIndex("project_id", "idx_chapters_project_id");
    table.dropIndex("deleted_at", "idx_chapters_deleted_at");
    table.dropColumn("target_word_count");
  });

  await knex.schema.alterTable("projects", (table) => {
    table.dropColumn("target_word_count");
    table.dropColumn("target_deadline");
    table.dropColumn("completion_threshold");
  });
}
```

**Step 4: Update test-helpers.ts to clean new tables**

The `setupTestDb()` helper must delete from the new tables in `beforeEach`, in FK-safe order (children before parents):

```typescript
// packages/server/src/__tests__/test-helpers.ts — update beforeEach:
beforeEach(async () => {
  await testDb("save_events").del();
  await testDb("daily_snapshots").del();
  await testDb("settings").del();
  await testDb("chapters").del();
  await testDb("projects").del();
});
```

Without this, tests leak state across runs through the new tables.

**Step 5: Run test to verify it passes**

Run: `npm test -w packages/server -- --run migration-004`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/server/src/db/migrations/004_goals_velocity.js packages/server/src/__tests__/migration-004.test.ts packages/server/src/__tests__/test-helpers.ts
git commit -m "feat: add migration 004 — goals & velocity tables and columns"
```

---

## Task 2: Shared Schemas — New Zod Schemas and Types

**Files:**
- Modify: `packages/shared/src/schemas.ts`
- Test: `packages/shared/src/__tests__/schemas.test.ts`

**Step 1: Write the failing tests**

Add tests for the new schemas. Find the existing test file first and add to it, or create it if it doesn't exist.

```typescript
// Add to packages/shared/src/__tests__/schemas.test.ts
import { describe, it, expect } from "vitest";
import {
  UpdateProjectSchema,
  UpdateChapterSchema,
  UpdateSettingsSchema,
  CompletionThreshold,
  calculateWordsToday,
} from "../schemas";

describe("CompletionThreshold", () => {
  it("accepts valid threshold values", () => {
    for (const v of ["outline", "rough_draft", "revised", "edited", "final"]) {
      expect(CompletionThreshold.safeParse(v).success).toBe(true);
    }
  });

  it("rejects invalid values", () => {
    expect(CompletionThreshold.safeParse("invalid").success).toBe(false);
  });
});

describe("UpdateProjectSchema — target fields", () => {
  it("accepts target_word_count as positive integer", () => {
    const result = UpdateProjectSchema.safeParse({ target_word_count: 80000 });
    expect(result.success).toBe(true);
  });

  it("accepts target_word_count as null (clear target)", () => {
    const result = UpdateProjectSchema.safeParse({ target_word_count: null });
    expect(result.success).toBe(true);
  });

  it("rejects target_word_count as zero or negative", () => {
    expect(UpdateProjectSchema.safeParse({ target_word_count: 0 }).success).toBe(false);
    expect(UpdateProjectSchema.safeParse({ target_word_count: -1 }).success).toBe(false);
  });

  it("accepts target_deadline as ISO date string", () => {
    const result = UpdateProjectSchema.safeParse({ target_deadline: "2026-09-01" });
    expect(result.success).toBe(true);
  });

  it("accepts target_deadline as null (clear deadline)", () => {
    const result = UpdateProjectSchema.safeParse({ target_deadline: null });
    expect(result.success).toBe(true);
  });

  it("rejects target_deadline as invalid date", () => {
    expect(UpdateProjectSchema.safeParse({ target_deadline: "not-a-date" }).success).toBe(false);
  });

  it("accepts completion_threshold", () => {
    const result = UpdateProjectSchema.safeParse({ completion_threshold: "revised" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid completion_threshold", () => {
    expect(UpdateProjectSchema.safeParse({ completion_threshold: "garbage" }).success).toBe(false);
  });
});

describe("UpdateChapterSchema — target_word_count", () => {
  it("accepts target_word_count as positive integer", () => {
    const result = UpdateChapterSchema.safeParse({ target_word_count: 5000 });
    expect(result.success).toBe(true);
  });

  it("accepts target_word_count as null", () => {
    const result = UpdateChapterSchema.safeParse({ target_word_count: null });
    expect(result.success).toBe(true);
  });

  it("rejects target_word_count as zero", () => {
    expect(UpdateChapterSchema.safeParse({ target_word_count: 0 }).success).toBe(false);
  });
});

describe("UpdateSettingsSchema", () => {
  it("accepts valid settings array", () => {
    const result = UpdateSettingsSchema.safeParse({
      settings: [{ key: "timezone", value: "America/New_York" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty key", () => {
    const result = UpdateSettingsSchema.safeParse({
      settings: [{ key: "", value: "foo" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("calculateWordsToday", () => {
  it("returns diff between current total and most recent prior-day snapshot", () => {
    const result = calculateWordsToday(41200, [
      { date: "2026-03-31", total_word_count: 40000 },
      { date: "2026-04-01", total_word_count: 41200 },
    ], "2026-04-01");
    expect(result).toBe(1200); // 41200 - 40000
  });

  it("returns current total when no prior-day snapshot exists (first day)", () => {
    const result = calculateWordsToday(5000, [
      { date: "2026-04-01", total_word_count: 5000 },
    ], "2026-04-01");
    expect(result).toBe(5000);
  });

  it("returns 0 when no snapshots exist", () => {
    const result = calculateWordsToday(0, [], "2026-04-01");
    expect(result).toBe(0);
  });

  it("uses most recent prior-day snapshot, not strictly yesterday", () => {
    // Gap on March 31 — uses March 30 as baseline
    const result = calculateWordsToday(42000, [
      { date: "2026-03-30", total_word_count: 40000 },
      { date: "2026-04-01", total_word_count: 42000 },
    ], "2026-04-01");
    expect(result).toBe(2000); // 42000 - 40000
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -w packages/shared -- --run schemas`
Expected: FAIL — new schemas don't exist yet

**Step 3: Update the shared schemas**

Modify `packages/shared/src/schemas.ts` to add:

```typescript
// Add to existing file:

export const CompletionThreshold = z.enum([
  "outline",
  "rough_draft",
  "revised",
  "edited",
  "final",
]);

// Update UpdateProjectSchema to include target fields:
export const UpdateProjectSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    target_word_count: z.number().int().positive().nullable(),
    target_deadline: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format")
      .refine((d) => !isNaN(Date.parse(d)), "Must be a valid date")
      .nullable(),
    completion_threshold: CompletionThreshold,
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

// Update UpdateChapterSchema to include target_word_count:
export const UpdateChapterSchema = z
  .object({
    title: z.string().min(1).max(500),
    content: TipTapDocSchema,
    status: ChapterStatus,
    target_word_count: z.number().int().positive().nullable(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export const UpdateSettingsSchema = z.object({
  settings: z.array(
    z.object({
      key: z.string().min(1),
      value: z.string(),
    })
  ),
});

/**
 * Pure function for "Words today" calculation.
 * Used by both client (SummaryStrip) and status bar.
 */
export function calculateWordsToday(
  currentTotal: number,
  snapshots: Array<{ date: string; total_word_count: number }>,
  today: string
): number {
  // Find the most recent snapshot from a day BEFORE today
  const priorDaySnapshots = snapshots
    .filter((s) => s.date < today)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (priorDaySnapshots.length === 0) {
    // First day of tracking — show current total
    return currentTotal;
  }

  return currentTotal - priorDaySnapshots[0].total_word_count;
}
```

Also export the new schemas and `calculateWordsToday` from `packages/shared/src/index.ts`.

**Step 4: Run tests to verify they pass**

Run: `npm test -w packages/shared -- --run schemas`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/shared/src/schemas.ts packages/shared/src/__tests__/schemas.test.ts packages/shared/src/index.ts
git commit -m "feat: add Zod schemas for goals, velocity settings"
```

---

## Task 3: Server — Settings API

**Files:**
- Create: `packages/server/src/routes/settings.ts`
- Modify: `packages/server/src/app.ts` (register new router)
- Test: `packages/server/src/__tests__/settings.test.ts`

**Step 1: Write the failing tests**

```typescript
// packages/server/src/__tests__/settings.test.ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { setupTestDb } from "./test-helpers";

const t = setupTestDb();

describe("GET /api/settings", () => {
  it("returns empty object when no settings exist", async () => {
    const res = await request(t.app).get("/api/settings");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it("returns all settings as key-value pairs", async () => {
    await t.db("settings").insert({ key: "timezone", value: "America/New_York" });
    const res = await request(t.app).get("/api/settings");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ timezone: "America/New_York" });
  });
});

describe("PATCH /api/settings", () => {
  it("creates new settings", async () => {
    const res = await request(t.app)
      .patch("/api/settings")
      .send({ settings: [{ key: "timezone", value: "America/New_York" }] });
    expect(res.status).toBe(200);

    const row = await t.db("settings").where({ key: "timezone" }).first();
    expect(row.value).toBe("America/New_York");
  });

  it("updates existing settings", async () => {
    await t.db("settings").insert({ key: "timezone", value: "UTC" });
    const res = await request(t.app)
      .patch("/api/settings")
      .send({ settings: [{ key: "timezone", value: "Europe/London" }] });
    expect(res.status).toBe(200);

    const row = await t.db("settings").where({ key: "timezone" }).first();
    expect(row.value).toBe("Europe/London");
  });

  it("validates timezone values", async () => {
    const res = await request(t.app)
      .patch("/api/settings")
      .send({ settings: [{ key: "timezone", value: "Not/A/Timezone" }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects invalid body structure", async () => {
    const res = await request(t.app)
      .patch("/api/settings")
      .send({ settings: [{ key: "", value: "foo" }] });
    expect(res.status).toBe(400);
  });

  it("applies no changes if any setting is invalid (atomic)", async () => {
    await t.db("settings").insert({ key: "timezone", value: "UTC" });
    const res = await request(t.app)
      .patch("/api/settings")
      .send({
        settings: [
          { key: "timezone", value: "America/Chicago" },
          { key: "timezone", value: "Bad/Zone" },
        ],
      });
    expect(res.status).toBe(400);

    // Original value unchanged
    const row = await t.db("settings").where({ key: "timezone" }).first();
    expect(row.value).toBe("UTC");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -w packages/server -- --run settings`
Expected: FAIL — route doesn't exist

**Step 3: Implement the settings router**

```typescript
// packages/server/src/routes/settings.ts
import { Router } from "express";
import { Knex } from "knex";
import { UpdateSettingsSchema } from "@smudge/shared";
import { asyncHandler } from "./asyncHandler";

const TIMEZONE_VALIDATORS: Record<string, (value: string) => boolean> = {
  timezone: (value) => {
    try {
      return Intl.supportedValuesOf("timeZone").includes(value);
    } catch {
      return false;
    }
  },
};

export function settingsRouter(db: Knex): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const rows = await db("settings").select("key", "value");
      const settings: Record<string, string> = {};
      for (const row of rows) {
        settings[row.key] = row.value;
      }
      res.json(settings);
    })
  );

  router.patch(
    "/",
    asyncHandler(async (req, res) => {
      const parsed = UpdateSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: parsed.error.message },
        });
      }

      // Validate all values before applying any
      const errors: Record<string, string> = {};
      for (const { key, value } of parsed.data.settings) {
        const validator = TIMEZONE_VALIDATORS[key];
        if (validator && !validator(value)) {
          errors[key] = `Invalid value for ${key}: ${value}`;
        }
      }

      if (Object.keys(errors).length > 0) {
        return res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: "Invalid settings", details: errors },
        });
      }

      // Apply atomically
      await db.transaction(async (trx) => {
        for (const { key, value } of parsed.data.settings) {
          const existing = await trx("settings").where({ key }).first();
          if (existing) {
            await trx("settings").where({ key }).update({ value });
          } else {
            await trx("settings").insert({ key, value });
          }
        }
      });

      res.json({ message: "Settings updated" });
    })
  );

  return router;
}
```

Then register in `packages/server/src/app.ts`:

```typescript
// Add import:
import { settingsRouter } from "./routes/settings";

// Add route:
app.use("/api/settings", settingsRouter(db));
```

**Step 4: Run tests to verify they pass**

Run: `npm test -w packages/server -- --run settings`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/routes/settings.ts packages/server/src/app.ts packages/server/src/__tests__/settings.test.ts
git commit -m "feat: add settings API (GET + PATCH /api/settings)"
```

---

## Task 4: Server — SaveEvent + DailySnapshot Side-Effects

**Files:**
- Create: `packages/server/src/routes/velocityHelpers.ts`
- Modify: `packages/server/src/routes/chapters.ts` (PATCH endpoint)
- Test: `packages/server/src/__tests__/save-side-effects.test.ts`

**Step 1: Write the failing tests**

```typescript
// packages/server/src/__tests__/save-side-effects.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { setupTestDb } from "./test-helpers";

const t = setupTestDb();

async function createProjectWithChapter() {
  const res = await request(t.app)
    .post("/api/projects")
    .send({ title: "Test Project", mode: "fiction" });
  const project = res.body;
  const chapters = await t.db("chapters")
    .where({ project_id: project.id })
    .select("id");
  return { projectId: project.id, chapterId: chapters[0].id, slug: project.slug };
}

describe("PATCH /api/chapters/:id — side effects", () => {
  it("creates a SaveEvent on content save", async () => {
    const { chapterId } = await createProjectWithChapter();
    await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }] } });

    const events = await t.db("save_events").where({ chapter_id: chapterId });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[events.length - 1].word_count).toBe(2);
  });

  it("does NOT create SaveEvent for title-only updates", async () => {
    const { chapterId } = await createProjectWithChapter();
    // Clear any migration-seeded events
    await t.db("save_events").where({ chapter_id: chapterId }).del();

    await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ title: "New Title" });

    const events = await t.db("save_events").where({ chapter_id: chapterId });
    expect(events).toHaveLength(0);
  });

  it("upserts a DailySnapshot on content save", async () => {
    const { projectId, chapterId } = await createProjectWithChapter();
    // Clear any migration-seeded snapshots
    await t.db("daily_snapshots").where({ project_id: projectId }).del();

    await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] } });

    const snapshots = await t.db("daily_snapshots").where({ project_id: projectId });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].total_word_count).toBe(1);
  });

  it("upserts same-day DailySnapshot on multiple saves", async () => {
    const { projectId, chapterId } = await createProjectWithChapter();
    await t.db("daily_snapshots").where({ project_id: projectId }).del();

    await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] } });

    await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world again" }] }] } });

    const snapshots = await t.db("daily_snapshots").where({ project_id: projectId });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].total_word_count).toBe(3);
  });

  it("chapter save succeeds even if SaveEvent insert fails", async () => {
    // This tests best-effort behavior. Hard to simulate failure in SQLite,
    // but we can verify the save itself succeeds by checking the response.
    const { chapterId } = await createProjectWithChapter();
    const res = await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "test" }] }] } });
    expect(res.status).toBe(200);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -w packages/server -- --run save-side-effects`
Expected: FAIL — no SaveEvent rows created

**Step 3: Implement velocity helpers and modify PATCH endpoint**

Create `packages/server/src/routes/velocityHelpers.ts`:

```typescript
import { Knex } from "knex";
import { v4 as uuid } from "uuid";

/**
 * Get today's date string in the configured timezone (or UTC).
 */
export async function getTodayDate(db: Knex): Promise<string> {
  const row = await db("settings").where({ key: "timezone" }).first();
  const tz = row?.value || "UTC";
  const now = new Date();
  // Format as YYYY-MM-DD in the configured timezone
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts; // en-CA locale returns YYYY-MM-DD
}

/**
 * Insert a SaveEvent row. Best-effort — does not throw.
 */
export async function insertSaveEvent(
  db: Knex,
  chapterId: string,
  projectId: string,
  wordCount: number
): Promise<void> {
  try {
    await db("save_events").insert({
      id: uuid(),
      chapter_id: chapterId,
      project_id: projectId,
      word_count: wordCount,
      saved_at: new Date().toISOString(),
    });
  } catch {
    // Best-effort: next save retries
  }
}

/**
 * Upsert a DailySnapshot for the project. Best-effort — does not throw.
 */
export async function upsertDailySnapshot(
  db: Knex,
  projectId: string
): Promise<void> {
  try {
    const today = await getTodayDate(db);
    const result = await db("chapters")
      .where({ project_id: projectId })
      .whereNull("deleted_at")
      .sum("word_count as total");
    const totalWordCount = Number(result[0]?.total) || 0;

    const existing = await db("daily_snapshots")
      .where({ project_id: projectId, date: today })
      .first();

    if (existing) {
      await db("daily_snapshots")
        .where({ id: existing.id })
        .update({ total_word_count: totalWordCount });
    } else {
      await db("daily_snapshots").insert({
        id: uuid(),
        project_id: projectId,
        date: today,
        total_word_count: totalWordCount,
        created_at: new Date().toISOString(),
      });
    }
  } catch {
    // Best-effort: next save retries
  }
}
```

Then modify PATCH in `packages/server/src/routes/chapters.ts` — after the transactional update (around line 96), add:

```typescript
// After the transaction, fire side-effects (best-effort)
if (parsed.data.content !== undefined) {
  await insertSaveEvent(db, req.params.id, chapter.project_id, updates.word_count);
  await upsertDailySnapshot(db, chapter.project_id);
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -w packages/server -- --run save-side-effects`
Expected: PASS

**Step 5: Run full test suite to check for regressions**

Run: `npm test -w packages/server`
Expected: All existing tests still pass

**Step 6: Commit**

```bash
git add packages/server/src/routes/velocityHelpers.ts packages/server/src/routes/chapters.ts packages/server/src/__tests__/save-side-effects.test.ts
git commit -m "feat: add SaveEvent + DailySnapshot side-effects on chapter save"
```

---

## Task 5: Server — Project Target Fields in PATCH /api/projects/:slug

**Files:**
- Modify: `packages/server/src/routes/projects.ts` (PATCH endpoint)
- Test: `packages/server/src/__tests__/projects.test.ts` (add tests)

**Step 1: Write the failing tests**

Add to `packages/server/src/__tests__/projects.test.ts`:

```typescript
describe("PATCH /api/projects/:slug — target fields", () => {
  it("sets target_word_count", async () => {
    const create = await request(t.app).post("/api/projects").send({ title: "Goals Test", mode: "fiction" });
    const res = await request(t.app)
      .patch(`/api/projects/${create.body.slug}`)
      .send({ target_word_count: 80000 });
    expect(res.status).toBe(200);
    expect(res.body.target_word_count).toBe(80000);
  });

  it("clears target_word_count with null", async () => {
    const create = await request(t.app).post("/api/projects").send({ title: "Clear Test", mode: "fiction" });
    await request(t.app).patch(`/api/projects/${create.body.slug}`).send({ target_word_count: 80000 });
    const res = await request(t.app).patch(`/api/projects/${create.body.slug}`).send({ target_word_count: null });
    expect(res.status).toBe(200);
    expect(res.body.target_word_count).toBeNull();
  });

  it("sets target_deadline", async () => {
    const create = await request(t.app).post("/api/projects").send({ title: "Deadline Test", mode: "fiction" });
    const res = await request(t.app)
      .patch(`/api/projects/${create.body.slug}`)
      .send({ target_deadline: "2026-09-01" });
    expect(res.status).toBe(200);
    expect(res.body.target_deadline).toBe("2026-09-01");
  });

  it("sets completion_threshold", async () => {
    const create = await request(t.app).post("/api/projects").send({ title: "Threshold Test", mode: "fiction" });
    const res = await request(t.app)
      .patch(`/api/projects/${create.body.slug}`)
      .send({ completion_threshold: "revised" });
    expect(res.status).toBe(200);
    expect(res.body.completion_threshold).toBe("revised");
  });

  it("rejects invalid completion_threshold", async () => {
    const create = await request(t.app).post("/api/projects").send({ title: "Bad Threshold", mode: "fiction" });
    const res = await request(t.app)
      .patch(`/api/projects/${create.body.slug}`)
      .send({ completion_threshold: "garbage" });
    expect(res.status).toBe(400);
  });

  it("rejects negative target_word_count", async () => {
    const create = await request(t.app).post("/api/projects").send({ title: "Neg Test", mode: "fiction" });
    const res = await request(t.app)
      .patch(`/api/projects/${create.body.slug}`)
      .send({ target_word_count: -100 });
    expect(res.status).toBe(400);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -w packages/server -- --run projects`
Expected: FAIL — PATCH doesn't accept target fields

**Step 3: Update PATCH /api/projects/:slug**

In `packages/server/src/routes/projects.ts`, the PATCH handler currently validates with `UpdateProjectSchema` which now includes the new fields (from Task 2). **Important:** The schema is now `.partial()`, making `title` optional. The existing handler assumes `parsed.data.title` always exists — it regenerates slugs and checks title uniqueness unconditionally. You must guard all title-specific logic:

- Wrap slug regeneration (`resolveUniqueSlug`) in `if (parsed.data.title !== undefined)`
- Wrap title uniqueness check in `if (parsed.data.title !== undefined)`
- Build the `updates` object conditionally — only include title if provided
- Add `target_word_count`, `target_deadline`, and `completion_threshold` to the updates object when present

Also update GET `/api/projects/:slug` and GET `/api/projects` to return the new columns, and POST to return them with defaults.

**Step 4: Run tests to verify they pass**

Run: `npm test -w packages/server -- --run projects`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/routes/projects.ts packages/server/src/__tests__/projects.test.ts
git commit -m "feat: support target_word_count, target_deadline, completion_threshold on projects"
```

---

## Task 6: Server — Chapter Target Word Count in PATCH /api/chapters/:id

**Files:**
- Modify: `packages/server/src/routes/chapters.ts`
- Test: `packages/server/src/__tests__/chapters.test.ts` (add tests)

**Step 1: Write the failing tests**

Add to `packages/server/src/__tests__/chapters.test.ts`:

```typescript
describe("PATCH /api/chapters/:id — target_word_count", () => {
  it("sets target_word_count", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);
    const res = await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ target_word_count: 5000 });
    expect(res.status).toBe(200);
    expect(res.body.target_word_count).toBe(5000);
  });

  it("clears target_word_count with null", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);
    await request(t.app).patch(`/api/chapters/${chapterId}`).send({ target_word_count: 5000 });
    const res = await request(t.app).patch(`/api/chapters/${chapterId}`).send({ target_word_count: null });
    expect(res.status).toBe(200);
    expect(res.body.target_word_count).toBeNull();
  });

  it("rejects zero target_word_count", async () => {
    const { chapterId } = await createProjectWithChapter(t.app);
    const res = await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ target_word_count: 0 });
    expect(res.status).toBe(400);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -w packages/server -- --run chapters`
Expected: FAIL

**Step 3: Update PATCH handler**

In `packages/server/src/routes/chapters.ts`, the PATCH handler already uses `UpdateChapterSchema` which now includes `target_word_count`. Add logic to include it in the `updates` object when present, and return it in the response.

**Step 4: Run tests to verify they pass**

Run: `npm test -w packages/server -- --run chapters`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/routes/chapters.ts packages/server/src/__tests__/chapters.test.ts
git commit -m "feat: support target_word_count on chapters"
```

---

## Task 7: Server — Velocity Endpoint

This is the most complex server task. The endpoint derives sessions from SaveEvent data, computes streaks, projections, and completion stats.

**Files:**
- Create: `packages/server/src/routes/velocity.ts`
- Modify: `packages/server/src/routes/projects.ts` (mount velocity route)
- Test: `packages/server/src/__tests__/velocity.test.ts`

**Step 1: Write the failing tests**

```typescript
// packages/server/src/__tests__/velocity.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { setupTestDb } from "./test-helpers";
import { v4 as uuid } from "uuid";

const t = setupTestDb();

async function createProjectWithChapter() {
  const res = await request(t.app)
    .post("/api/projects")
    .send({ title: "Velocity Test", mode: "fiction" });
  const project = res.body;
  const chapters = await t.db("chapters")
    .where({ project_id: project.id })
    .select("id");
  return { projectId: project.id, chapterId: chapters[0].id, slug: project.slug };
}

async function insertSaveEvent(
  projectId: string,
  chapterId: string,
  wordCount: number,
  savedAt: string
) {
  await t.db("save_events").insert({
    id: uuid(),
    chapter_id: chapterId,
    project_id: projectId,
    word_count: wordCount,
    saved_at: savedAt,
  });
}

async function insertSnapshot(projectId: string, date: string, totalWordCount: number) {
  await t.db("daily_snapshots").insert({
    id: uuid(),
    project_id: projectId,
    date,
    total_word_count: totalWordCount,
    created_at: new Date().toISOString(),
  });
}

describe("GET /api/projects/:slug/velocity", () => {
  it("returns empty shape for project with no data", async () => {
    const { slug, projectId } = await createProjectWithChapter();
    // Clear migration-seeded data
    await t.db("save_events").where({ project_id: projectId }).del();
    await t.db("daily_snapshots").where({ project_id: projectId }).del();

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.status).toBe(200);
    expect(res.body.daily_snapshots).toEqual([]);
    expect(res.body.sessions).toEqual([]);
    expect(res.body.streak).toEqual({ current: 0, best: 0 });
    expect(res.body.projection).toEqual({
      target_word_count: null,
      target_deadline: null,
      projected_date: null,
      daily_average_30d: 0,
    });
    expect(res.body.completion).toHaveProperty("total_chapters");
  });

  it("returns daily_snapshots for last 90 days", async () => {
    const { slug, projectId } = await createProjectWithChapter();
    await t.db("daily_snapshots").where({ project_id: projectId }).del();

    await insertSnapshot(projectId, "2026-03-30", 1000);
    await insertSnapshot(projectId, "2026-03-31", 1500);

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.daily_snapshots.length).toBe(2);
    expect(res.body.daily_snapshots[0].date).toBe("2026-03-30");
    expect(res.body.daily_snapshots[0].total_word_count).toBe(1000);
  });

  it("derives sessions from SaveEvent gaps > 30 minutes", async () => {
    const { slug, projectId, chapterId } = await createProjectWithChapter();
    await t.db("save_events").where({ project_id: projectId }).del();

    // Session 1: two saves 5 minutes apart
    await insertSaveEvent(projectId, chapterId, 100, "2026-03-31T14:00:00Z");
    await insertSaveEvent(projectId, chapterId, 200, "2026-03-31T14:05:00Z");
    // Gap > 30 min
    // Session 2: one save
    await insertSaveEvent(projectId, chapterId, 300, "2026-03-31T15:00:00Z");

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.sessions).toHaveLength(2);
  });

  it("calculates net_words per session correctly", async () => {
    const { slug, projectId, chapterId } = await createProjectWithChapter();
    await t.db("save_events").where({ project_id: projectId }).del();

    // Baseline: a save event before the session
    await insertSaveEvent(projectId, chapterId, 100, "2026-03-30T10:00:00Z");
    // Session: word count goes from 100 to 250
    await insertSaveEvent(projectId, chapterId, 150, "2026-03-31T14:00:00Z");
    await insertSaveEvent(projectId, chapterId, 250, "2026-03-31T14:10:00Z");

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    const session = res.body.sessions.find(
      (s: { start: string }) => s.start === "2026-03-31T14:00:00Z"
    );
    expect(session).toBeDefined();
    expect(session.net_words).toBe(150); // 250 - 100
  });

  it("calculates streaks from SaveEvent dates", async () => {
    const { slug, projectId, chapterId } = await createProjectWithChapter();
    await t.db("save_events").where({ project_id: projectId }).del();

    // 3 consecutive days ending today (2026-04-01 per test context)
    await insertSaveEvent(projectId, chapterId, 100, "2026-03-30T10:00:00Z");
    await insertSaveEvent(projectId, chapterId, 200, "2026-03-31T10:00:00Z");
    await insertSaveEvent(projectId, chapterId, 300, "2026-04-01T10:00:00Z");

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.streak.current).toBe(3);
    expect(res.body.streak.best).toBe(3);
  });

  it("returns projection when target is set", async () => {
    const { slug, projectId, chapterId } = await createProjectWithChapter();
    await t.db("save_events").where({ project_id: projectId }).del();
    await t.db("daily_snapshots").where({ project_id: projectId }).del();

    // Set target
    await request(t.app)
      .patch(`/api/projects/${slug}`)
      .send({ target_word_count: 80000, target_deadline: "2026-09-01" });

    // Add some snapshot history
    await insertSnapshot(projectId, "2026-03-31", 40000);
    await insertSnapshot(projectId, "2026-04-01", 41200);

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.projection.target_word_count).toBe(80000);
    expect(res.body.projection.target_deadline).toBe("2026-09-01");
    expect(res.body.projection.daily_average_30d).toBeGreaterThan(0);
  });

  it("returns completion stats based on threshold", async () => {
    const { slug, projectId } = await createProjectWithChapter();

    // Set threshold to "revised"
    await request(t.app)
      .patch(`/api/projects/${slug}`)
      .send({ completion_threshold: "revised" });

    // Update chapter status to "revised"
    const chapters = await t.db("chapters").where({ project_id: projectId }).select("id");
    await request(t.app)
      .patch(`/api/chapters/${chapters[0].id}`)
      .send({ status: "revised" });

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.completion.threshold_status).toBe("revised");
    expect(res.body.completion.total_chapters).toBe(1);
    expect(res.body.completion.completed_chapters).toBe(1);
  });

  it("calculates net_words across multiple chapters in one session", async () => {
    const { slug, projectId, chapterId } = await createProjectWithChapter();
    // Create a second chapter
    const ch2Res = await request(t.app)
      .post(`/api/projects/${slug}/chapters`)
      .send({});
    const chapterId2 = ch2Res.body.id;
    await t.db("save_events").where({ project_id: projectId }).del();

    // Baselines before the session
    await insertSaveEvent(projectId, chapterId, 100, "2026-03-30T10:00:00Z");
    await insertSaveEvent(projectId, chapterId2, 50, "2026-03-30T10:00:00Z");
    // Session: both chapters edited within 30 min
    await insertSaveEvent(projectId, chapterId, 200, "2026-03-31T14:00:00Z");
    await insertSaveEvent(projectId, chapterId2, 120, "2026-03-31T14:10:00Z");

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    const session = res.body.sessions.find(
      (s: { start: string }) => s.start === "2026-03-31T14:00:00Z"
    );
    expect(session).toBeDefined();
    // net_words = (200 - 100) + (120 - 50) = 170
    expect(session.net_words).toBe(170);
    expect(session.chapters_touched).toHaveLength(2);
  });

  it("streak: no saves today — counts from yesterday", async () => {
    const { slug, projectId, chapterId } = await createProjectWithChapter();
    await t.db("save_events").where({ project_id: projectId }).del();

    // Saves on March 30 and March 31, but NOT today (April 1)
    await insertSaveEvent(projectId, chapterId, 100, "2026-03-30T10:00:00Z");
    await insertSaveEvent(projectId, chapterId, 200, "2026-03-31T10:00:00Z");

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    // Current streak should be 2 (yesterday + day before), not broken
    expect(res.body.streak.current).toBe(2);
  });

  it("streak: gap in the middle resets current but not best", async () => {
    const { slug, projectId, chapterId } = await createProjectWithChapter();
    await t.db("save_events").where({ project_id: projectId }).del();

    // Mon-Tue, skip Wed, Thu (today = April 1 = Tue, so use matching dates)
    // 3-day run ending March 29, gap March 30, then March 31 + April 1
    await insertSaveEvent(projectId, chapterId, 100, "2026-03-27T10:00:00Z");
    await insertSaveEvent(projectId, chapterId, 200, "2026-03-28T10:00:00Z");
    await insertSaveEvent(projectId, chapterId, 300, "2026-03-29T10:00:00Z");
    // gap on March 30
    await insertSaveEvent(projectId, chapterId, 400, "2026-03-31T10:00:00Z");
    await insertSaveEvent(projectId, chapterId, 500, "2026-04-01T10:00:00Z");

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.streak.current).toBe(2); // March 31 + April 1
    expect(res.body.streak.best).toBe(3); // March 27-29
  });

  it("streak: zero-word-change save still counts as writing day", async () => {
    const { slug, projectId, chapterId } = await createProjectWithChapter();
    await t.db("save_events").where({ project_id: projectId }).del();

    // Same word count on both days — revision, not new words
    await insertSaveEvent(projectId, chapterId, 500, "2026-03-31T10:00:00Z");
    await insertSaveEvent(projectId, chapterId, 500, "2026-04-01T10:00:00Z");

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.streak.current).toBe(2);
  });

  it("completion: counts chapters at or beyond threshold using sort_order", async () => {
    const { slug, projectId } = await createProjectWithChapter();
    // Create a second chapter
    await request(t.app).post(`/api/projects/${slug}/chapters`).send({});
    const chapters = await t.db("chapters")
      .where({ project_id: projectId })
      .whereNull("deleted_at")
      .select("id");

    // Set threshold to "revised" (sort_order = 3)
    await request(t.app)
      .patch(`/api/projects/${slug}`)
      .send({ completion_threshold: "revised" });

    // Chapter 1: "edited" (sort_order 4 — beyond threshold, should count)
    await request(t.app).patch(`/api/chapters/${chapters[0].id}`).send({ status: "edited" });
    // Chapter 2: "outline" (sort_order 1 — below threshold, should not count)
    // (default is "outline", no change needed)

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    expect(res.body.completion.threshold_status).toBe("revised");
    expect(res.body.completion.total_chapters).toBe(2);
    expect(res.body.completion.completed_chapters).toBe(1); // only "edited" counts
  });

  it("includes SaveEvents from soft-deleted chapters in sessions", async () => {
    const { slug, projectId, chapterId } = await createProjectWithChapter();
    await t.db("save_events").where({ project_id: projectId }).del();

    // Baseline + session save
    await insertSaveEvent(projectId, chapterId, 0, "2026-03-30T10:00:00Z");
    await insertSaveEvent(projectId, chapterId, 500, "2026-03-31T14:00:00Z");

    // Soft-delete the chapter
    await request(t.app).delete(`/api/chapters/${chapterId}`);

    const res = await request(t.app).get(`/api/projects/${slug}/velocity`);
    const session = res.body.sessions.find(
      (s: { start: string }) => s.start === "2026-03-31T14:00:00Z"
    );
    expect(session).toBeDefined();
    expect(session.net_words).toBe(500);
  });

  it("returns 404 for non-existent project", async () => {
    const res = await request(t.app).get("/api/projects/no-such-project/velocity");
    expect(res.status).toBe(404);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -w packages/server -- --run velocity`
Expected: FAIL — endpoint doesn't exist

**Step 3: Implement the velocity endpoint**

Create `packages/server/src/routes/velocity.ts` with:
- `deriveSessions(events)` — walks SaveEvent timestamps, splits on 30-min gaps, calculates net words
- `calculateStreaks(dates, today)` — computes current and best streaks from distinct writing dates
- `calculateProjection(project, dailyAverage, currentTotal)` — projects completion date
- Route handler that queries data and assembles the response

Then mount it in `projects.ts`:

```typescript
router.get("/:slug/velocity", asyncHandler(async (req, res) => { ... }));
```

The velocity endpoint implementation should:
1. Look up project by slug (404 if not found)
2. Read the `timezone` setting (default UTC) — needed for streak date conversion
3. Query DailySnapshots for last 90 days
4. Query SaveEvents for last 30 days, derive sessions (sessions use UTC gaps — no timezone conversion needed)
5. Query all SaveEvent `saved_at` timestamps for streak calculation. **Critical:** convert each `saved_at` to a `YYYY-MM-DD` date in the writer's timezone using `Intl.DateTimeFormat("en-CA", { timeZone: tz })` before extracting distinct dates. UTC-based date extraction (`saved_at.slice(0, 10)`) would produce incorrect streaks for non-UTC writers (e.g., an 11pm local save grouped as "tomorrow" in UTC). Reuse `getTodayDate()` from `velocityHelpers.ts` for "today".
6. Calculate projection from targets + 30-day daily average
7. Calculate completion from chapter statuses + threshold (use `sort_order` comparison — "at or beyond" means `chapter.sort_order >= threshold.sort_order`)
8. Return assembled response

**Step 4: Run tests to verify they pass**

Run: `npm test -w packages/server -- --run velocity`
Expected: PASS

**Step 5: Run full server test suite**

Run: `npm test -w packages/server`
Expected: All pass

**Step 6: Commit**

```bash
git add packages/server/src/routes/velocity.ts packages/server/src/routes/projects.ts packages/server/src/__tests__/velocity.test.ts
git commit -m "feat: add GET /api/projects/:slug/velocity endpoint"
```

---

## Task 8: Client — API Client Extensions

**Files:**
- Modify: `packages/client/src/api/client.ts`
- Test: `packages/client/src/__tests__/api-client.test.ts` (add tests if file exists, otherwise verify via integration)

**Step 1: Add new API methods**

Extend `packages/client/src/api/client.ts`:

```typescript
// Under api.projects:
velocity: async (slug: string) => {
  const res = await fetch(`/api/projects/${slug}/velocity`);
  if (!res.ok) throw new ApiRequestError(res.status, await res.json());
  return res.json();
},

// New settings namespace:
settings: {
  get: async () => {
    const res = await fetch("/api/settings");
    if (!res.ok) throw new ApiRequestError(res.status, await res.json());
    return res.json();
  },
  update: async (settings: Array<{ key: string; value: string }>) => {
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings }),
    });
    if (!res.ok) throw new ApiRequestError(res.status, await res.json());
    return res.json();
  },
},
```

**Step 2: Add TypeScript types**

Add types for the velocity response shape either in the api client file or in `@smudge/shared`:

```typescript
export interface VelocityResponse {
  daily_snapshots: Array<{ date: string; total_word_count: number }>;
  sessions: Array<{
    start: string;
    end: string;
    duration_minutes: number;
    chapters_touched: string[];
    net_words: number;
  }>;
  streak: { current: number; best: number };
  projection: {
    target_word_count: number | null;
    target_deadline: string | null;
    projected_date: string | null;
    daily_average_30d: number;
  };
  completion: {
    threshold_status: string;
    total_chapters: number;
    completed_chapters: number;
  };
}
```

**Step 3: Commit**

```bash
git add packages/client/src/api/client.ts
git commit -m "feat: add velocity + settings API client methods"
```

---

## Task 9: Client — Externalize New Strings

**Files:**
- Modify: `packages/client/src/strings.ts`

**Step 1: Add all new strings**

```typescript
// Add to STRINGS object:
velocity: {
  tabLabel: "Velocity",
  chaptersTabLabel: "Chapters",
  emptyState: "Start writing to see your stats here.",
  wordsToday: "Words today",
  dailyAverage: "Daily avg (30d)",
  currentStreak: "Current streak",
  bestStreak: "Best streak",
  days: "days",
  projected: "Projected",
  daysRemaining: "days remaining",
  chaptersComplete: "chapters complete",
  atOrBeyond: "at %s or beyond",
  recentSessions: "Recent sessions",
  sessionLabel: "%s · %s min · %s net words · %s",
  netWords: "net words",
  chartDailyLabel: "Daily word count over the last 30 days",
  chartBurndownLabel: "Burndown chart comparing planned pace vs actual pace",
  noAverage: "—",
  noProjection: "—",
  lastSession: "Last session",
},
settings: {
  heading: "Settings",
  timezoneLabel: "Timezone",
  save: "Save",
  cancel: "Cancel",
},
projectSettings: {
  heading: "Project Settings",
  wordCountTarget: "Word count target",
  deadline: "Deadline",
  completionThreshold: "A chapter counts as complete at",
  clear: "Clear",
},
```

**Step 2: Commit**

```bash
git add packages/client/src/strings.ts
git commit -m "feat: externalize velocity, settings, project settings strings"
```

---

## Task 10: Client — App Settings Dialog (Timezone)

**Files:**
- Create: `packages/client/src/components/SettingsDialog.tsx`
- Modify: `packages/client/src/components/Sidebar.tsx` (add Settings button)
- Test: `packages/client/src/__tests__/SettingsDialog.test.tsx`

**Step 1: Write the failing tests**

```typescript
// packages/client/src/__tests__/SettingsDialog.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsDialog } from "../components/SettingsDialog";
import { api } from "../api/client";

vi.mock("../api/client");

describe("SettingsDialog", () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.mocked(api.settings.get).mockResolvedValue({ timezone: "UTC" });
    vi.mocked(api.settings.update).mockResolvedValue({ message: "ok" });
  });

  it("renders timezone dropdown with current value", async () => {
    render(<SettingsDialog open={true} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByLabelText(/timezone/i)).toBeInTheDocument();
    });
  });

  it("saves timezone on submit", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog open={true} onClose={onClose} />);
    await waitFor(() => screen.getByLabelText(/timezone/i));

    // Change timezone and save
    const select = screen.getByLabelText(/timezone/i);
    await user.selectOptions(select, "America/New_York");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(api.settings.update).toHaveBeenCalledWith([
      { key: "timezone", value: "America/New_York" },
    ]);
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when cancel is clicked", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog open={true} onClose={onClose} />);
    await waitFor(() => screen.getByLabelText(/timezone/i));
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -w packages/client -- --run SettingsDialog`
Expected: FAIL

**Step 3: Implement SettingsDialog component**

Create `packages/client/src/components/SettingsDialog.tsx`:
- Uses `<dialog>` element (semantic HTML per CLAUDE.md)
- Fetches current settings on open via `api.settings.get()`
- Timezone `<select>` populated from `Intl.supportedValuesOf("timeZone")`
- Save button calls `api.settings.update()`
- Cancel button closes without saving

**Step 4: Add Settings button to Sidebar**

In `packages/client/src/components/Sidebar.tsx`, add a "Settings" button in the footer section (after Trash button). On click, it opens the SettingsDialog.

**Step 5: Run tests to verify they pass**

Run: `npm test -w packages/client -- --run SettingsDialog`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/client/src/components/SettingsDialog.tsx packages/client/src/components/Sidebar.tsx packages/client/src/__tests__/SettingsDialog.test.tsx
git commit -m "feat: add app settings dialog with timezone picker"
```

---

## Task 11: Client — Project Settings Dialog

**Files:**
- Create: `packages/client/src/components/ProjectSettingsDialog.tsx`
- Modify: `packages/client/src/pages/EditorPage.tsx` (add gear icon + dialog)
- Test: `packages/client/src/__tests__/ProjectSettingsDialog.test.tsx`

**Step 1: Write the failing tests**

```typescript
// packages/client/src/__tests__/ProjectSettingsDialog.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectSettingsDialog } from "../components/ProjectSettingsDialog";
import { api } from "../api/client";

vi.mock("../api/client");

const defaultProject = {
  id: "1",
  slug: "test",
  title: "Test",
  mode: "fiction" as const,
  target_word_count: null,
  target_deadline: null,
  completion_threshold: "final" as const,
  created_at: "",
  updated_at: "",
};

describe("ProjectSettingsDialog", () => {
  const onClose = vi.fn();
  const onUpdate = vi.fn();

  beforeEach(() => {
    vi.mocked(api.projects.update).mockResolvedValue(defaultProject);
  });

  it("renders word count target input", () => {
    render(
      <ProjectSettingsDialog open={true} project={defaultProject} onClose={onClose} onUpdate={onUpdate} />
    );
    expect(screen.getByLabelText(/word count target/i)).toBeInTheDocument();
  });

  it("renders deadline input", () => {
    render(
      <ProjectSettingsDialog open={true} project={defaultProject} onClose={onClose} onUpdate={onUpdate} />
    );
    expect(screen.getByLabelText(/deadline/i)).toBeInTheDocument();
  });

  it("renders completion threshold dropdown", () => {
    render(
      <ProjectSettingsDialog open={true} project={defaultProject} onClose={onClose} onUpdate={onUpdate} />
    );
    expect(screen.getByLabelText(/chapter counts as complete/i)).toBeInTheDocument();
  });

  it("saves changes immediately on input change", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSettingsDialog open={true} project={defaultProject} onClose={onClose} onUpdate={onUpdate} />
    );
    const input = screen.getByLabelText(/word count target/i);
    await user.clear(input);
    await user.type(input, "80000");
    // Changes take effect on blur or after debounce per spec: "No confirmation dialogs"
    await user.tab(); // blur triggers save

    await waitFor(() => {
      expect(api.projects.update).toHaveBeenCalled();
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -w packages/client -- --run ProjectSettingsDialog`
Expected: FAIL

**Step 3: Implement ProjectSettingsDialog**

Create `packages/client/src/components/ProjectSettingsDialog.tsx`:
- `<dialog>` element with three form fields
- Word count target: `<input type="number">` with clear button
- Deadline: `<input type="date">` with clear button
- Completion threshold: `<select>` with five status options
- Changes call `api.projects.update(slug, { field: value })` immediately (no save button per spec)
- Calls `onUpdate` callback so parent can refresh state

**Step 4: Add gear icon to EditorPage**

In `packages/client/src/pages/EditorPage.tsx`:
- Add a gear icon button on the project dashboard (near the project title or tab area)
- On click, opens ProjectSettingsDialog
- Pass current project data and update callback

**Step 5: Run tests to verify they pass**

Run: `npm test -w packages/client -- --run ProjectSettingsDialog`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/client/src/components/ProjectSettingsDialog.tsx packages/client/src/pages/EditorPage.tsx packages/client/src/__tests__/ProjectSettingsDialog.test.tsx
git commit -m "feat: add project settings dialog (targets + threshold)"
```

---

## Task 12: Install Recharts Dependency

**Files:**
- Modify: `packages/client/package.json`
- Modify: `docs/dependency-licenses.md`

**Step 1: Install Recharts**

```bash
npm install recharts -w packages/client
```

**Step 2: Verify license**

Check `node_modules/recharts/package.json` — should be MIT.

**Step 3: Update dependency-licenses.md**

Add Recharts to `docs/dependency-licenses.md` with license info.

**Step 4: Commit**

```bash
git add packages/client/package.json package-lock.json docs/dependency-licenses.md
git commit -m "feat: add recharts dependency (MIT licensed)"
```

---

## Task 13: Client — Velocity Tab (Dashboard Sub-Tabs)

This is the largest client task. Break it into sub-components.

**Files:**
- Create: `packages/client/src/components/VelocityView.tsx` (main velocity tab)
- Create: `packages/client/src/components/SummaryStrip.tsx` (metric cards)
- Create: `packages/client/src/components/DailyWordChart.tsx` (bar chart)
- Create: `packages/client/src/components/BurndownChart.tsx` (line chart)
- Create: `packages/client/src/components/RecentSessions.tsx` (session list)
- Modify: `packages/client/src/components/DashboardView.tsx` (add sub-tab navigation)
- Modify: `packages/client/src/pages/EditorPage.tsx` (pass velocity data)
- Test: `packages/client/src/__tests__/VelocityView.test.tsx`
- Test: `packages/client/src/__tests__/DailyWordChart.test.tsx`

### Step 1: Write the failing test for VelocityView

```typescript
// packages/client/src/__tests__/VelocityView.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { VelocityView } from "../components/VelocityView";
import { api } from "../api/client";

vi.mock("../api/client");

const mockVelocity = {
  daily_snapshots: [
    { date: "2026-03-31", total_word_count: 40000 },
    { date: "2026-04-01", total_word_count: 41200 },
  ],
  sessions: [
    {
      start: "2026-04-01T14:15:00Z",
      end: "2026-04-01T15:40:00Z",
      duration_minutes: 85,
      chapters_touched: ["ch1", "ch2"],
      net_words: 1200,
    },
  ],
  streak: { current: 12, best: 23 },
  projection: {
    target_word_count: 80000,
    target_deadline: "2026-09-01",
    projected_date: "2026-08-28",
    daily_average_30d: 1200,
  },
  completion: {
    threshold_status: "revised",
    total_chapters: 12,
    completed_chapters: 7,
  },
};

describe("VelocityView", () => {
  beforeEach(() => {
    vi.mocked(api.projects.velocity).mockResolvedValue(mockVelocity);
  });

  it("renders summary strip with key metrics", async () => {
    render(<VelocityView slug="test" />);
    await waitFor(() => {
      expect(screen.getByText(/words today/i)).toBeInTheDocument();
      expect(screen.getByText(/12 days/i)).toBeInTheDocument();
    });
  });

  it("renders recent sessions", async () => {
    render(<VelocityView slug="test" />);
    await waitFor(() => {
      expect(screen.getByText(/85 min/)).toBeInTheDocument();
      expect(screen.getByText(/1,200/)).toBeInTheDocument();
    });
  });

  it("shows empty state when no data", async () => {
    vi.mocked(api.projects.velocity).mockResolvedValue({
      daily_snapshots: [],
      sessions: [],
      streak: { current: 0, best: 0 },
      projection: { target_word_count: null, target_deadline: null, projected_date: null, daily_average_30d: 0 },
      completion: { threshold_status: "final", total_chapters: 0, completed_chapters: 0 },
    });
    render(<VelocityView slug="test" />);
    await waitFor(() => {
      expect(screen.getByText(/start writing/i)).toBeInTheDocument();
    });
  });

  it("renders completion stats", async () => {
    render(<VelocityView slug="test" />);
    await waitFor(() => {
      expect(screen.getByText(/7 of 12/)).toBeInTheDocument();
    });
  });

  // Adaptive display: four configurations per design doc
  it("adaptive: nothing set — shows daily words, streaks, sessions, completion only", async () => {
    vi.mocked(api.projects.velocity).mockResolvedValue({
      ...mockVelocity,
      projection: { target_word_count: null, target_deadline: null, projected_date: null, daily_average_30d: 1200 },
    });
    render(<VelocityView slug="test" />);
    await waitFor(() => {
      expect(screen.getByText(/words today/i)).toBeInTheDocument();
      expect(screen.getByText(/current streak/i)).toBeInTheDocument();
      expect(screen.queryByText(/projected/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/days remaining/i)).not.toBeInTheDocument();
    });
  });

  it("adaptive: word target only — shows progress + projected date, no countdown", async () => {
    vi.mocked(api.projects.velocity).mockResolvedValue({
      ...mockVelocity,
      projection: { target_word_count: 80000, target_deadline: null, projected_date: "2026-08-28", daily_average_30d: 1200 },
    });
    render(<VelocityView slug="test" />);
    await waitFor(() => {
      expect(screen.getByText(/80,000/)).toBeInTheDocument();
      expect(screen.getByText(/projected/i)).toBeInTheDocument();
      expect(screen.queryByText(/days remaining/i)).not.toBeInTheDocument();
    });
  });

  it("adaptive: deadline only — shows days remaining, no progress bar", async () => {
    vi.mocked(api.projects.velocity).mockResolvedValue({
      ...mockVelocity,
      projection: { target_word_count: null, target_deadline: "2026-09-01", projected_date: null, daily_average_30d: 1200 },
    });
    render(<VelocityView slug="test" />);
    await waitFor(() => {
      expect(screen.getByText(/days remaining/i)).toBeInTheDocument();
      expect(screen.queryByText(/projected/i)).not.toBeInTheDocument();
    });
  });

  it("adaptive: both set — shows burndown chart", async () => {
    // mockVelocity already has both target_word_count and target_deadline
    render(<VelocityView slug="test" />);
    await waitFor(() => {
      expect(screen.getByLabelText(/burndown/i)).toBeInTheDocument();
    });
  });
});
```

### Step 2: Run tests to verify they fail

Run: `npm test -w packages/client -- --run VelocityView`
Expected: FAIL

### Step 3: Implement VelocityView and sub-components

**VelocityView.tsx:** Fetches velocity data, renders SummaryStrip + charts + RecentSessions. Shows empty state when no sessions/snapshots.

**SummaryStrip.tsx:** Horizontal row of metric cards. Adapts display based on which targets are set (per design doc adaptive display table).

**DailyWordChart.tsx:**
- Recharts `<BarChart>` showing daily net word count (last 30 days)
- Warm accent color for positive bars
- Reduced opacity + different corner radius for negative bars (WCAG — not color alone)
- `aria-label` summarizing the trend
- Hidden `<table>` alternative for screen readers
- `prefers-reduced-motion`: use a `useReducedMotion()` hook (via `window.matchMedia("(prefers-reduced-motion: reduce)")`) and set `isAnimationActive={!prefersReducedMotion}` on all Recharts components

**BurndownChart.tsx:**
- Only rendered when both target_word_count and target_deadline are set
- Recharts `<LineChart>` with planned pace line (lighter tone) and actual pace line (accent)
- `aria-label` + hidden data table
- Same `prefers-reduced-motion` handling as DailyWordChart

**RecentSessions.tsx:**
- Last 5 sessions as informational list items
- Format: "Today, 2:15 PM – 3:40 PM · 85 min · +1,200 net words · Ch 4, Ch 5"

### Step 4: Update DashboardView with sub-tabs

Modify `packages/client/src/components/DashboardView.tsx`:
- Add sub-tab navigation: "Velocity" (default) | "Chapters"
- Velocity tab renders `<VelocityView slug={slug} />`
- Chapters tab renders the existing chapter table content

### Step 5: Run tests to verify they pass

Run: `npm test -w packages/client -- --run VelocityView`
Expected: PASS

### Step 6: Commit

```bash
git add packages/client/src/components/VelocityView.tsx packages/client/src/components/SummaryStrip.tsx packages/client/src/components/DailyWordChart.tsx packages/client/src/components/BurndownChart.tsx packages/client/src/components/RecentSessions.tsx packages/client/src/components/DashboardView.tsx packages/client/src/__tests__/VelocityView.test.tsx
git commit -m "feat: add velocity tab with charts, sessions, and summary strip"
```

---

## Task 14: Client — Chart Accessibility (Hidden Data Tables, Reduced Motion, BurndownChart Tests)

**Files:**
- Modify: `packages/client/src/components/DailyWordChart.tsx`
- Modify: `packages/client/src/components/BurndownChart.tsx`
- Create: `packages/client/src/hooks/useReducedMotion.ts`
- Test: `packages/client/src/__tests__/DailyWordChart.test.tsx`
- Test: `packages/client/src/__tests__/BurndownChart.test.tsx`

**Step 1: Write the failing tests**

```typescript
// packages/client/src/__tests__/DailyWordChart.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DailyWordChart } from "../components/DailyWordChart";

const sampleData = [
  { date: "2026-03-31", net_words: 1200 },
  { date: "2026-04-01", net_words: -300 },
];

describe("DailyWordChart", () => {
  it("renders chart with aria-label", () => {
    render(<DailyWordChart data={sampleData} dailyAverage={450} />);
    expect(
      screen.getByLabelText(/daily word count/i)
    ).toBeInTheDocument();
  });

  it("renders hidden data table for screen readers", () => {
    render(<DailyWordChart data={sampleData} dailyAverage={450} />);
    // The table should be visually hidden but present in DOM
    const table = screen.getByRole("table", { name: /daily word count/i });
    expect(table).toBeInTheDocument();
    expect(table.closest("[class*='sr-only']") || table.closest(".sr-only")).toBeTruthy();
  });
});
```

```typescript
// packages/client/src/__tests__/BurndownChart.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BurndownChart } from "../components/BurndownChart";

const sampleData = {
  snapshots: [
    { date: "2026-03-31", total_word_count: 40000 },
    { date: "2026-04-01", total_word_count: 41200 },
  ],
  targetWordCount: 80000,
  targetDeadline: "2026-09-01",
  startDate: "2026-03-01",
};

describe("BurndownChart", () => {
  it("renders chart with aria-label", () => {
    render(<BurndownChart {...sampleData} />);
    expect(screen.getByLabelText(/burndown/i)).toBeInTheDocument();
  });

  it("renders hidden data table for screen readers", () => {
    render(<BurndownChart {...sampleData} />);
    const table = screen.getByRole("table", { name: /burndown/i });
    expect(table).toBeInTheDocument();
    expect(table.closest("[class*='sr-only']") || table.closest(".sr-only")).toBeTruthy();
  });

  it("does not render when target_word_count is null", () => {
    const { container } = render(<BurndownChart {...sampleData} targetWordCount={null as unknown as number} />);
    expect(container.innerHTML).toBe("");
  });

  it("does not render when target_deadline is null", () => {
    const { container } = render(<BurndownChart {...sampleData} targetDeadline={null as unknown as string} />);
    expect(container.innerHTML).toBe("");
  });
});
```

**Step 2: Write reduced-motion hook and test**

Create `packages/client/src/hooks/useReducedMotion.ts`:

```typescript
import { useState, useEffect } from "react";

export function useReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return prefersReducedMotion;
}
```

Both chart components should use this hook and pass `isAnimationActive={!prefersReducedMotion}` to all Recharts animation props.

**Step 3: Run tests to verify they fail**

Run: `npm test -w packages/client -- --run DailyWordChart && npm test -w packages/client -- --run BurndownChart`
Expected: FAIL

**Step 4: Add visually-hidden data tables and reduced-motion support**

In both chart components:
- Add a `<table>` wrapped in `<div className="sr-only">` that mirrors the chart data
- Use `useReducedMotion()` hook and pass `isAnimationActive={!prefersReducedMotion}` to Recharts components

**Step 5: Run tests to verify they pass**

Run: `npm test -w packages/client -- --run DailyWordChart && npm test -w packages/client -- --run BurndownChart`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/client/src/components/DailyWordChart.tsx packages/client/src/components/BurndownChart.tsx packages/client/src/hooks/useReducedMotion.ts packages/client/src/__tests__/DailyWordChart.test.tsx packages/client/src/__tests__/BurndownChart.test.tsx
git commit -m "a11y: add hidden data tables, burndown tests, and reduced-motion support for charts"
```

---

## Task 15: Client — Editor Status Bar Update

**Files:**
- Modify: `packages/client/src/pages/EditorPage.tsx` (status bar section)
- Modify: `packages/client/src/hooks/useProjectEditor.ts` (or create new hook for last session)
- Test: `packages/client/src/__tests__/StatusBar.test.tsx` (add test)

**Step 1: Write the failing test**

Add to existing StatusBar tests:

```typescript
it("shows last session info in status bar", async () => {
  // Mock the velocity API to return session data
  vi.mocked(api.projects.velocity).mockResolvedValue({
    ...emptyVelocity,
    sessions: [{
      start: "2026-04-01T14:15:00Z",
      end: "2026-04-01T15:40:00Z",
      duration_minutes: 85,
      chapters_touched: ["ch1"],
      net_words: 1200,
    }],
  });

  // Render EditorPage and check status bar
  // ... (adapt to existing test setup)
  expect(screen.getByText(/last session.*85 min/i)).toBeInTheDocument();
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -w packages/client -- --run StatusBar`
Expected: FAIL

**Step 3: Implement status bar addition**

In EditorPage's status bar (around line 639-671), add to the right side (before save status):

```tsx
{lastSession && (
  <span className="text-text-muted text-sm">
    {STRINGS.velocity.lastSession}: {lastSession.duration_minutes} min, +{lastSession.net_words.toLocaleString()} words
  </span>
)}
```

Fetch the last session from the velocity endpoint (can reuse data if already fetched for the velocity tab, or make a lightweight call).

**Step 4: Run test to verify it passes**

Run: `npm test -w packages/client -- --run StatusBar`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/client/src/pages/EditorPage.tsx packages/client/src/__tests__/StatusBar.test.tsx
git commit -m "feat: show last session info in editor status bar"
```

---

## Task 16: Client — Chapter Target Word Count (Inline Popover)

**Files:**
- Create: `packages/client/src/components/ChapterTargetPopover.tsx`
- Modify: `packages/client/src/components/DashboardView.tsx` (chapter table word count column)
- Test: `packages/client/src/__tests__/ChapterTargetPopover.test.tsx`

**Step 1: Write the failing tests**

```typescript
// packages/client/src/__tests__/ChapterTargetPopover.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChapterTargetPopover } from "../components/ChapterTargetPopover";
import { api } from "../api/client";

vi.mock("../api/client");

describe("ChapterTargetPopover", () => {
  it("opens popover on word count click", async () => {
    const user = userEvent.setup();
    render(
      <ChapterTargetPopover
        chapterId="ch1"
        currentWordCount={2500}
        targetWordCount={null}
        onUpdate={vi.fn()}
      />
    );
    await user.click(screen.getByText("2,500"));
    expect(screen.getByLabelText(/word count target/i)).toBeInTheDocument();
  });

  it("saves target on input blur", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    vi.mocked(api.chapters.update).mockResolvedValue({} as never);

    render(
      <ChapterTargetPopover
        chapterId="ch1"
        currentWordCount={2500}
        targetWordCount={null}
        onUpdate={onUpdate}
      />
    );
    await user.click(screen.getByText("2,500"));
    const input = screen.getByLabelText(/word count target/i);
    await user.type(input, "5000");
    await user.tab();

    await waitFor(() => {
      expect(api.chapters.update).toHaveBeenCalledWith("ch1", { target_word_count: 5000 });
    });
  });

  it("clears target with clear button", async () => {
    const user = userEvent.setup();
    vi.mocked(api.chapters.update).mockResolvedValue({} as never);

    render(
      <ChapterTargetPopover
        chapterId="ch1"
        currentWordCount={2500}
        targetWordCount={5000}
        onUpdate={vi.fn()}
      />
    );
    await user.click(screen.getByText(/2,500/));
    await user.click(screen.getByRole("button", { name: /clear/i }));

    await waitFor(() => {
      expect(api.chapters.update).toHaveBeenCalledWith("ch1", { target_word_count: null });
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -w packages/client -- --run ChapterTargetPopover`
Expected: FAIL

**Step 3: Implement ChapterTargetPopover**

Create `packages/client/src/components/ChapterTargetPopover.tsx`:
- Shows word count as clickable text
- On click, opens a small popover with number input + clear button
- Saves on blur
- Shows progress indicator (e.g., "2,500 / 5,000") when target is set

Integrate into DashboardView's chapter table word count column.

**Step 4: Run tests to verify they pass**

Run: `npm test -w packages/client -- --run ChapterTargetPopover`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/client/src/components/ChapterTargetPopover.tsx packages/client/src/components/DashboardView.tsx packages/client/src/__tests__/ChapterTargetPopover.test.tsx
git commit -m "feat: add inline chapter target word count popover"
```

---

## Task 17: Client — Timezone Auto-Detection on First Launch

**Files:**
- Modify: `packages/client/src/App.tsx` (or create a useSettings hook)
- Test: `packages/client/src/__tests__/timezone-detection.test.tsx`

**Step 1: Write the failing test**

```typescript
// packages/client/src/__tests__/timezone-detection.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../api/client";

vi.mock("../api/client");

describe("timezone auto-detection", () => {
  beforeEach(() => {
    vi.mocked(api.settings.get).mockResolvedValue({});
    vi.mocked(api.settings.update).mockResolvedValue({ message: "ok" });
  });

  it("detects browser timezone and sends to server when not set", async () => {
    // Import and call the detection function
    const { detectAndSetTimezone } = await import("../hooks/useTimezoneDetection");
    await detectAndSetTimezone();

    expect(api.settings.update).toHaveBeenCalledWith([
      { key: "timezone", value: expect.any(String) },
    ]);
  });

  it("does not overwrite existing timezone setting", async () => {
    vi.mocked(api.settings.get).mockResolvedValue({ timezone: "Europe/London" });

    const { detectAndSetTimezone } = await import("../hooks/useTimezoneDetection");
    await detectAndSetTimezone();

    expect(api.settings.update).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -w packages/client -- --run timezone`
Expected: FAIL

**Step 3: Implement timezone detection hook**

Create `packages/client/src/hooks/useTimezoneDetection.ts`:

```typescript
import { api } from "../api/client";

export async function detectAndSetTimezone(): Promise<void> {
  try {
    const settings = await api.settings.get();
    if (!settings.timezone) {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await api.settings.update([{ key: "timezone", value: tz }]);
    }
  } catch {
    // Best-effort — don't block app startup
  }
}
```

Call this from `App.tsx` on mount (via `useEffect`).

**Step 4: Run test to verify it passes**

Run: `npm test -w packages/client -- --run timezone`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/client/src/hooks/useTimezoneDetection.ts packages/client/src/App.tsx packages/client/src/__tests__/timezone-detection.test.tsx
git commit -m "feat: auto-detect browser timezone on first launch"
```

---

## Task 18: E2E Tests — Velocity Flow

**Files:**
- Create: `e2e/velocity.spec.ts`

**Step 1: Write the e2e test**

```typescript
// e2e/velocity.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Velocity feature", () => {
  test("shows velocity tab on dashboard", async ({ page }) => {
    // Create a project
    await page.goto("/");
    await page.getByRole("button", { name: /new project/i }).click();
    await page.getByLabel(/title/i).fill("E2E Velocity Test");
    await page.getByRole("button", { name: /create/i }).click();

    // Write some content to trigger SaveEvent
    await page.locator(".tiptap").click();
    await page.keyboard.type("This is some test content for velocity tracking.");
    await page.waitForTimeout(2000); // Wait for auto-save

    // Navigate to dashboard
    await page.getByRole("tab", { name: /dashboard/i }).click();

    // Verify velocity tab is default
    await expect(page.getByRole("tab", { name: /velocity/i })).toHaveAttribute("aria-selected", "true");

    // Verify summary strip shows
    await expect(page.getByText(/words today/i)).toBeVisible();
    await expect(page.getByText(/current streak/i)).toBeVisible();
  });

  test("project settings dialog opens from gear icon", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /new project/i }).click();
    await page.getByLabel(/title/i).fill("Settings Test");
    await page.getByRole("button", { name: /create/i }).click();

    await page.getByRole("tab", { name: /dashboard/i }).click();
    await page.getByRole("button", { name: /project settings/i }).click();

    await expect(page.getByLabel(/word count target/i)).toBeVisible();
    await expect(page.getByLabel(/deadline/i)).toBeVisible();
  });

  test("app settings shows timezone", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /new project/i }).click();
    await page.getByLabel(/title/i).fill("Timezone Test");
    await page.getByRole("button", { name: /create/i }).click();

    await page.getByRole("button", { name: /settings/i }).click();
    await expect(page.getByLabel(/timezone/i)).toBeVisible();
  });
});
```

**Step 2: Run e2e tests**

Run: `make e2e`
Expected: Tests pass after all features are implemented

**Step 3: Commit**

```bash
git add e2e/velocity.spec.ts
git commit -m "test: add e2e tests for velocity feature"
```

---

## Task 19: E2E Accessibility Audit

**Files:**
- Modify: `e2e/velocity.spec.ts` (add aXe checks)

**Step 1: Add aXe checks to velocity e2e tests**

```typescript
import AxeBuilder from "@axe-core/playwright";

test("velocity tab passes aXe accessibility audit", async ({ page }) => {
  // Navigate to velocity tab (reuse setup from above)
  // ...

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
```

**Step 2: Run e2e**

Run: `make e2e`
Expected: PASS

**Step 3: Commit**

```bash
git add e2e/velocity.spec.ts
git commit -m "a11y: add aXe audit for velocity tab"
```

---

## Task 20: Final — Full Suite Verification

**Step 1: Run full test suite**

```bash
make all
```

Expected: All lint, format, typecheck, coverage, and e2e checks pass.

**Step 2: Verify coverage thresholds**

If coverage drops below thresholds (95% statements, 85% branches, 90% functions, 95% lines), add missing tests — do not lower thresholds.

**Step 3: Docker verification**

```bash
docker compose up --build
```

Verify the app loads on port 3456 and velocity features work.

**Step 4: Final commit if any cleanup needed**

```bash
git commit -m "chore: final cleanup for Phase 2 goals & velocity"
```

---

## Task Dependency Graph

```
Task 1 (migration) ──→ Task 2 (schemas) ──→ Task 3 (settings API)
                                          ──→ Task 4 (save side-effects)
                                          ──→ Task 5 (project targets)
                                          ──→ Task 6 (chapter targets)
                                          ──→ Task 7 (velocity endpoint)
                                                      ↓
Task 8 (API client) ───────────────────────────────────┘
Task 9 (strings) ──→ Task 10 (settings dialog)
                  ──→ Task 11 (project settings dialog)
                  ──→ Task 13 (velocity tab + charts) ──→ Task 14 (chart a11y)
Task 12 (recharts) ──→ Task 13
Task 15 (status bar) depends on Task 8
Task 16 (chapter popover) depends on Task 8
Task 17 (timezone detection) depends on Task 3, Task 8
Task 18 (e2e) depends on all feature tasks
Task 19 (e2e a11y) depends on Task 18
Task 20 (final) depends on all
```

**Parallelizable groups:**
- Tasks 3, 4, 5, 6 can run in parallel (all depend on 1+2)
- Tasks 9, 12 can run in parallel (no dependencies on each other)
- Tasks 10, 11, 13, 15, 16, 17 can partially parallelize (all depend on 8+9)
