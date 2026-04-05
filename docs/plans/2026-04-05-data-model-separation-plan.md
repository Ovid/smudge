# Data Model Separation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor `packages/server/src/` from flat route-handler architecture into domain-based folders with routes/services/repositories layers, plus unit tests for all new code.

**Architecture:** Each domain (projects, chapters, velocity, settings, chapter-statuses) gets its own folder containing types, repository, service, and route files. Routes handle HTTP only, services own business logic and transactions, repositories encapsulate all Knex/SQL. Services import `db` from a singleton module with `setDb()` for test injection.

**Tech Stack:** TypeScript, Express, Knex.js, better-sqlite3, Vitest, Supertest

**Design doc:** `docs/plans/2026-04-05-data-model-separation-design.md`

---

## Task 1: Foundation — Update `db/connection.ts` with `setDb()`

This task modifies the database connection module to support direct import by services and test injection.

**Files:**
- Modify: `packages/server/src/db/connection.ts`
- Test: `packages/server/src/__tests__/connection.test.ts`

**Step 1: Update connection.ts to add `setDb()`**

Replace the entire file with:

```typescript
import knex, { type Knex } from "knex";
import { createKnexConfig } from "./knexfile";

let db: Knex | undefined;

export function getDb(): Knex {
  if (!db) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return db;
}

export function setDb(instance: Knex): void {
  db = instance;
}

export async function initDb(config?: Knex.Config): Promise<Knex> {
  db = knex(config ?? createKnexConfig());
  await db.raw("PRAGMA journal_mode = WAL");
  await db.raw("PRAGMA foreign_keys = ON");
  await db.migrate.latest();
  return db;
}

export async function closeDb(): Promise<void> {
  if (db) {
    await db.destroy();
    db = undefined;
  }
}
```

**Step 2: Add test for `setDb()`**

Add this test to `packages/server/src/__tests__/connection.test.ts` in the existing describe block:

```typescript
it("setDb() sets the database instance used by getDb()", async () => {
  const { closeDb, setDb, getDb } = await import("../db/connection");
  await closeDb();
  const customDb = knex(createTestKnexConfig());
  setDb(customDb);
  expect(getDb()).toBe(customDb);
  await customDb.destroy();
});
```

**Step 3: Run tests**

Run: `npm test -w packages/server -- --run connection`
Expected: All tests pass including new `setDb()` test

**Step 4: Commit**

```bash
git add packages/server/src/db/connection.ts packages/server/src/__tests__/connection.test.ts
git commit -m "feat: add setDb() to connection module for test injection and service imports"
```

---

## Task 2: Chapter Statuses Domain (simplest — proves the pattern)

**Files:**
- Create: `packages/server/src/chapter-statuses/chapter-statuses.types.ts`
- Create: `packages/server/src/chapter-statuses/chapter-statuses.repository.ts`
- Create: `packages/server/src/chapter-statuses/chapter-statuses.service.ts`
- Create: `packages/server/src/chapter-statuses/chapter-statuses.routes.ts`
- Test: `packages/server/src/__tests__/chapter-statuses.test.ts` (existing — must still pass)

**Step 1: Create internal types**

```typescript
// packages/server/src/chapter-statuses/chapter-statuses.types.ts
export interface ChapterStatusRow {
  status: string;
  sort_order: number;
  label: string;
}
```

**Step 2: Create repository**

```typescript
// packages/server/src/chapter-statuses/chapter-statuses.repository.ts
import type { Knex } from "knex";
import type { ChapterStatusRow } from "./chapter-statuses.types";

export async function list(trx: Knex.Transaction | Knex): Promise<ChapterStatusRow[]> {
  return trx("chapter_statuses")
    .orderBy("sort_order", "asc")
    .select("status", "sort_order", "label");
}

export async function findByStatus(
  trx: Knex.Transaction | Knex,
  status: string,
): Promise<ChapterStatusRow | undefined> {
  return trx("chapter_statuses").where({ status }).first();
}

export async function getStatusLabel(
  trx: Knex.Transaction | Knex,
  status: string,
): Promise<string> {
  const row = await trx("chapter_statuses").where({ status }).first("label");
  return row?.label ?? status;
}

export async function getStatusLabelMap(
  trx: Knex.Transaction | Knex,
): Promise<Record<string, string>> {
  const rows = await trx("chapter_statuses")
    .orderBy("sort_order", "asc")
    .select("status", "label");
  return Object.fromEntries(
    rows.map((r: { status: string; label: string }) => [r.status, r.label]),
  );
}
```

**Step 3: Create service**

```typescript
// packages/server/src/chapter-statuses/chapter-statuses.service.ts
import type { ChapterStatusRow as SharedChapterStatusRow } from "@smudge/shared";
import { getDb } from "../db/connection";
import * as ChapterStatusRepo from "./chapter-statuses.repository";
import type { ChapterStatusRow } from "./chapter-statuses.types";

function toChapterStatus(row: ChapterStatusRow): SharedChapterStatusRow {
  return {
    status: row.status,
    sort_order: row.sort_order,
    label: row.label,
  };
}

export async function listStatuses(): Promise<SharedChapterStatusRow[]> {
  const db = getDb();
  const rows = await ChapterStatusRepo.list(db);
  return rows.map(toChapterStatus);
}
```

**Step 4: Create route**

```typescript
// packages/server/src/chapter-statuses/chapter-statuses.routes.ts
import { Router } from "express";
import { asyncHandler } from "../app";
import * as ChapterStatusService from "./chapter-statuses.service";

export function chapterStatusesRouter(): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const statuses = await ChapterStatusService.listStatuses();
      res.json(statuses);
    }),
  );

  return router;
}
```

**Step 5: Update `app.ts` to use the new router**

Change the import and mounting for chapter-statuses:

```typescript
// In app.ts, change:
import { chapterStatusesRouter } from "./routes/chapter-statuses";
// to:
import { chapterStatusesRouter } from "./chapter-statuses/chapter-statuses.routes";

// Change:
app.use("/api/chapter-statuses", chapterStatusesRouter(db));
// to:
app.use("/api/chapter-statuses", chapterStatusesRouter());
```

**Step 6: Update test-helpers.ts to call `setDb()`**

Add `setDb` import and call in `setupTestDb()`:

```typescript
// In test-helpers.ts, add import:
import { setDb } from "../db/connection";

// In beforeAll, after creating testDb and before creating app:
setDb(testDb);
```

Note: Keep `createApp(testDb)` working for now — it still passes `db` to the other routers that haven't been migrated yet. The `setDb()` call makes the singleton available for the migrated chapter-statuses service.

**Step 7: Run existing tests**

Run: `npm test -w packages/server`
Expected: ALL existing tests pass (185+ tests). The chapter-statuses test validates that the new domain folder works end-to-end.

**Step 8: Commit**

```bash
git add packages/server/src/chapter-statuses/ packages/server/src/app.ts packages/server/src/__tests__/test-helpers.ts
git commit -m "refactor: extract chapter-statuses domain (types, repository, service, routes)"
```

---

## Task 3: Settings Domain

**Files:**
- Create: `packages/server/src/settings/settings.types.ts`
- Create: `packages/server/src/settings/settings.repository.ts`
- Create: `packages/server/src/settings/settings.service.ts`
- Create: `packages/server/src/settings/settings.routes.ts`
- Test: `packages/server/src/__tests__/settings.test.ts` (existing — must still pass)

**Step 1: Create internal types**

```typescript
// packages/server/src/settings/settings.types.ts
export interface SettingRow {
  key: string;
  value: string;
}
```

**Step 2: Create repository**

```typescript
// packages/server/src/settings/settings.repository.ts
import type { Knex } from "knex";
import type { SettingRow } from "./settings.types";

export async function listAll(trx: Knex.Transaction | Knex): Promise<SettingRow[]> {
  return trx("settings").select("key", "value");
}

export async function findByKey(
  trx: Knex.Transaction | Knex,
  key: string,
): Promise<SettingRow | undefined> {
  return trx("settings").where({ key }).first();
}

export async function upsert(
  trx: Knex.Transaction,
  key: string,
  value: string,
): Promise<void> {
  const existing = await trx("settings").where({ key }).first();
  if (existing) {
    await trx("settings").where({ key }).update({ value });
  } else {
    await trx("settings").insert({ key, value });
  }
}
```

**Step 3: Create service**

```typescript
// packages/server/src/settings/settings.service.ts
import { getDb } from "../db/connection";
import * as SettingsRepo from "./settings.repository";

const SETTING_VALIDATORS: Record<string, (value: string) => boolean> = {
  timezone: (value) => {
    try {
      return Intl.supportedValuesOf("timeZone").includes(value);
    } catch {
      return false;
    }
  },
};

export async function getAll(): Promise<Record<string, string>> {
  const db = getDb();
  const rows = await SettingsRepo.listAll(db);
  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

export async function update(
  settings: Array<{ key: string; value: string }>,
): Promise<{ errors: Record<string, string> } | null> {
  const errors: Record<string, string> = {};
  for (const { key, value } of settings) {
    const validator = SETTING_VALIDATORS[key];
    if (!validator) {
      errors[key] = `Unknown setting: ${key}`;
    } else if (!validator(value)) {
      errors[key] = `Invalid value for ${key}`;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  const db = getDb();
  await db.transaction(async (trx) => {
    for (const { key, value } of settings) {
      await SettingsRepo.upsert(trx, key, value);
    }
  });

  return null;
}
```

**Step 4: Create route**

```typescript
// packages/server/src/settings/settings.routes.ts
import { Router } from "express";
import { UpdateSettingsSchema } from "@smudge/shared";
import { asyncHandler } from "../app";
import * as SettingsService from "./settings.service";

export function settingsRouter(): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const settings = await SettingsService.getAll();
      res.json(settings);
    }),
  );

  router.patch(
    "/",
    asyncHandler(async (req, res) => {
      const parsed = UpdateSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: parsed.error.message },
        });
        return;
      }

      const result = await SettingsService.update(parsed.data.settings);
      if (result) {
        const messages = Object.values(result.errors).join("; ");
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: `Invalid settings: ${messages}`,
          },
        });
        return;
      }

      res.json({ message: "Settings updated" });
    }),
  );

  return router;
}
```

**Step 5: Update `app.ts`**

Change the settings import and mounting:

```typescript
// Change import from:
import { settingsRouter } from "./routes/settings";
// to:
import { settingsRouter } from "./settings/settings.routes";

// Change:
app.use("/api/settings", settingsRouter(db));
// to:
app.use("/api/settings", settingsRouter());
```

**Step 6: Run existing tests**

Run: `npm test -w packages/server`
Expected: ALL existing tests pass

**Step 7: Commit**

```bash
git add packages/server/src/settings/ packages/server/src/app.ts
git commit -m "refactor: extract settings domain (types, repository, service, routes)"
```

---

## Task 4: Velocity Domain

Extract velocity before projects/chapters because it's self-contained and the other domains will call into it.

**Files:**
- Create: `packages/server/src/velocity/velocity.types.ts`
- Create: `packages/server/src/velocity/velocity.repository.ts`
- Create: `packages/server/src/velocity/velocity.service.ts`
- Create: `packages/server/src/velocity/velocity.routes.ts`
- Test: `packages/server/src/__tests__/velocity.test.ts` (existing — must still pass)
- Test: `packages/server/src/__tests__/velocityHelpers.test.ts` (existing — must still pass)

**Step 1: Create internal types**

```typescript
// packages/server/src/velocity/velocity.types.ts
export interface SaveEventRow {
  id: string;
  chapter_id: string | null;
  project_id: string;
  word_count: number;
  saved_at: string;
  save_date: string;
}

export interface DailySnapshotRow {
  id: string;
  project_id: string;
  date: string;
  total_word_count: number;
  created_at: string;
}
```

**Step 2: Create repository**

```typescript
// packages/server/src/velocity/velocity.repository.ts
import type { Knex } from "knex";
import { v4 as uuid } from "uuid";
import type { SaveEventRow, DailySnapshotRow } from "./velocity.types";

export async function insertSaveEvent(
  db: Knex.Transaction | Knex,
  chapterId: string,
  projectId: string,
  wordCount: number,
  today: string,
): Promise<void> {
  await db("save_events").insert({
    id: uuid(),
    chapter_id: chapterId,
    project_id: projectId,
    word_count: wordCount,
    saved_at: new Date().toISOString(),
    save_date: today,
  });
}

export async function upsertDailySnapshot(
  db: Knex.Transaction | Knex,
  projectId: string,
  today: string,
  totalWordCount: number,
): Promise<void> {
  await db.raw(
    `INSERT INTO daily_snapshots (id, project_id, date, total_word_count, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_id, date) DO UPDATE SET total_word_count = excluded.total_word_count`,
    [uuid(), projectId, today, totalWordCount, new Date().toISOString()],
  );
}

export async function getDailySnapshots(
  db: Knex.Transaction | Knex,
  projectId: string,
  sinceDate: string,
): Promise<Array<{ date: string; total_word_count: number }>> {
  return db("daily_snapshots")
    .where({ project_id: projectId })
    .where("date", ">=", sinceDate)
    .orderBy("date", "asc")
    .select("date", "total_word_count");
}

export async function getRecentSaveEvents(
  db: Knex.Transaction | Knex,
  projectId: string,
  sinceTimestamp: string,
): Promise<SaveEventRow[]> {
  return db("save_events")
    .where({ project_id: projectId })
    .where("saved_at", ">=", sinceTimestamp)
    .orderBy("saved_at", "asc")
    .select("id", "chapter_id", "project_id", "word_count", "saved_at");
}

export async function getPreWindowBaselines(
  db: Knex.Transaction | Knex,
  projectId: string,
  chapterIds: string[],
  beforeTimestamp: string,
): Promise<Record<string, number>> {
  const baselines: Record<string, number> = {};
  if (chapterIds.length === 0) return baselines;

  const rows = await db("save_events as se1")
    .whereIn("se1.chapter_id", chapterIds)
    .where("se1.project_id", projectId)
    .where("se1.saved_at", "<", beforeTimestamp)
    .whereNotExists(
      db("save_events as se2")
        .where("se2.chapter_id", db.raw("se1.chapter_id"))
        .where("se2.project_id", projectId)
        .where("se2.saved_at", "<", beforeTimestamp)
        .where("se2.saved_at", ">", db.raw("se1.saved_at")),
    )
    .select("se1.chapter_id", "se1.word_count");

  for (const row of rows) {
    if (row.chapter_id) baselines[row.chapter_id] = row.word_count;
  }
  return baselines;
}

export async function getWritingDates(
  db: Knex.Transaction | Knex,
  projectId: string,
  limit: number,
): Promise<string[]> {
  const rows: { date: string }[] = await db("daily_snapshots")
    .where("daily_snapshots.project_id", projectId)
    .whereExists(
      db("save_events")
        .where("save_events.project_id", projectId)
        .whereRaw(`save_events.save_date = daily_snapshots.date`)
        .select(db.raw("1")),
    )
    .orderBy("date", "desc")
    .limit(limit)
    .select("daily_snapshots.date");
  return rows.map((r) => r.date);
}

export async function getProjectTotalWordCount(
  db: Knex.Transaction | Knex,
  projectId: string,
): Promise<number> {
  const result = await db("chapters")
    .where({ project_id: projectId })
    .whereNull("deleted_at")
    .sum("word_count as total");
  return Number(result[0]?.total) || 0;
}
```

**Step 3: Create service**

This service contains the pure business logic functions (`deriveSessions`, `calculateStreaks`, `calculateProjection`) plus the orchestration for recording saves and building the velocity response.

```typescript
// packages/server/src/velocity/velocity.service.ts
import type { VelocityResponse } from "@smudge/shared";
import { getDb } from "../db/connection";
import * as VelocityRepo from "./velocity.repository";
import * as SettingsRepo from "../settings/settings.repository";

// --- Pure business logic (exported for unit testing) ---

interface SaveEvent {
  id: string;
  chapter_id: string | null;
  project_id: string;
  word_count: number;
  saved_at: string;
}

interface Session {
  start: string;
  end: string;
  duration_minutes: number;
  chapters_touched: string[];
  net_words: number;
}

export function deriveSessions(
  events: SaveEvent[],
  preWindowBaselines: Record<string, number> = {},
): Session[] {
  if (events.length === 0) return [];

  const SESSION_GAP_MS = 30 * 60 * 1000;

  const sessionGroups: SaveEvent[][] = [];
  const firstEvent = events[0];
  if (!firstEvent) return [];
  let currentGroup: SaveEvent[] = [firstEvent];

  for (let i = 1; i < events.length; i++) {
    const prevEvent = events[i - 1];
    const currEvent = events[i];
    if (!prevEvent || !currEvent) continue;
    const prev = new Date(prevEvent.saved_at).getTime();
    const curr = new Date(currEvent.saved_at).getTime();
    if (curr - prev > SESSION_GAP_MS) {
      sessionGroups.push(currentGroup);
      currentGroup = [currEvent];
    } else {
      currentGroup.push(currEvent);
    }
  }
  sessionGroups.push(currentGroup);

  const lastSeenWordCount: Record<string, number> = { ...preWindowBaselines };
  const sessionBaselines: Record<string, number>[] = [];
  for (const group of sessionGroups) {
    sessionBaselines.push({ ...lastSeenWordCount });
    for (const evt of group) {
      const key = evt.chapter_id ?? `_purged_${evt.id}`;
      lastSeenWordCount[key] = evt.word_count;
    }
  }

  return sessionGroups.map((group, groupIdx) => {
    const groupFirst = group[0];
    const groupLast = group[group.length - 1];
    if (!groupFirst || !groupLast) {
      return { start: "", end: "", duration_minutes: 0, chapters_touched: [], net_words: 0 };
    }
    const start = groupFirst.saved_at;
    const end = groupLast.saved_at;
    const durationMs = new Date(end).getTime() - new Date(start).getTime();
    const durationMinutes = Math.round(durationMs / 60000);

    const lastInSessionByChapter: Record<string, SaveEvent> = {};
    for (const evt of group) {
      const key = evt.chapter_id ?? `_purged_${evt.id}`;
      lastInSessionByChapter[key] = evt;
    }
    const chapterIds = Object.keys(lastInSessionByChapter);

    const baselines = sessionBaselines[groupIdx] ?? {};
    let netWords = 0;
    for (const chapterId of chapterIds) {
      const lastInSession = lastInSessionByChapter[chapterId];
      if (!lastInSession) continue;
      const baseline = baselines[chapterId] ?? 0;
      netWords += lastInSession.word_count - baseline;
    }

    return {
      start,
      end,
      duration_minutes: durationMinutes,
      chapters_touched: chapterIds.filter((id) => !id.startsWith("_purged_")),
      net_words: netWords,
    };
  });
}

export function calculateStreaks(
  dates: string[],
  today: string,
): { current: number; best: number } {
  if (dates.length === 0) return { current: 0, best: 0 };

  const sorted = [...dates].sort((a, b) => (a > b ? -1 : 1));

  function prevDay(dateStr: string): string {
    const d = new Date(dateStr + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  let current = 0;
  let checkDate = today;
  const mostRecent = sorted[0];

  if (mostRecent !== undefined && mostRecent !== today) {
    checkDate = prevDay(today);
  }

  const dateSet = new Set(sorted);
  while (dateSet.has(checkDate)) {
    current++;
    checkDate = prevDay(checkDate);
  }

  let best = 0;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prevDate = sorted[i - 1];
    const currDate = sorted[i];
    if (!prevDate || !currDate) continue;
    const expected = prevDay(prevDate);
    if (currDate === expected) {
      run++;
    } else {
      best = Math.max(best, run);
      run = 1;
    }
  }
  best = Math.max(best, run);

  return { current, best };
}

export function calculateProjection(
  targetWordCount: number | null,
  targetDeadline: string | null,
  dailyAvg30d: number,
  currentTotal: number,
  today: string,
): {
  target_word_count: number | null;
  target_deadline: string | null;
  projected_date: string | null;
  daily_average_30d: number;
} {
  if (targetWordCount == null) {
    return {
      target_word_count: targetWordCount,
      target_deadline: targetDeadline,
      projected_date: null,
      daily_average_30d: dailyAvg30d,
    };
  }

  let projectedDate: string | null = null;
  if (dailyAvg30d > 0 && currentTotal < targetWordCount) {
    const daysRemaining = Math.ceil((targetWordCount - currentTotal) / dailyAvg30d);
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + daysRemaining);
    projectedDate = d.toISOString().slice(0, 10);
  }

  return {
    target_word_count: targetWordCount,
    target_deadline: targetDeadline,
    projected_date: projectedDate,
    daily_average_30d: dailyAvg30d,
  };
}

// --- Timezone helper ---

export function safeTimezone(tz: string): string {
  try {
    Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

export async function getTodayDate(): Promise<string> {
  const db = getDb();
  const row = await SettingsRepo.findByKey(db, "timezone");
  const tz = safeTimezone(row?.value || "UTC");
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

// --- Side-effect operations (called by chapters service) ---

export async function recordSave(
  projectId: string,
  chapterId: string,
  wordCount: number,
): Promise<void> {
  const db = getDb();
  const today = await getTodayDate();
  try {
    await VelocityRepo.insertSaveEvent(db, chapterId, projectId, wordCount, today);
  } catch (err) {
    console.error(
      `Failed to insert save event for chapter=${chapterId} project=${projectId}:`,
      err,
    );
  }
  try {
    const totalWordCount = await VelocityRepo.getProjectTotalWordCount(db, projectId);
    await VelocityRepo.upsertDailySnapshot(db, projectId, today, totalWordCount);
  } catch (err) {
    console.error(`Failed to upsert daily snapshot for project=${projectId}:`, err);
  }
}

export async function updateDailySnapshot(projectId: string): Promise<void> {
  const db = getDb();
  const today = await getTodayDate();
  try {
    const totalWordCount = await VelocityRepo.getProjectTotalWordCount(db, projectId);
    await VelocityRepo.upsertDailySnapshot(db, projectId, today, totalWordCount);
  } catch (err) {
    console.error(`Failed to upsert daily snapshot for project=${projectId}:`, err);
  }
}

// --- Velocity dashboard query ---

export async function getVelocity(
  projectId: string,
  targetWordCount: number | null,
  targetDeadline: string | null,
  completionThreshold: string | null,
): Promise<VelocityResponse> {
  const db = getDb();
  const today = await getTodayDate();

  // Daily snapshots: last 90 days
  const ninetyDaysAgo = new Date(today + "T00:00:00Z");
  ninetyDaysAgo.setUTCDate(ninetyDaysAgo.getUTCDate() - 90);
  const ninetyDaysAgoStr = ninetyDaysAgo.toISOString().slice(0, 10);

  const dailySnapshots = await VelocityRepo.getDailySnapshots(db, projectId, ninetyDaysAgoStr);

  // Save events: last 30 days
  const thirtyDaysAgo = new Date(today + "T00:00:00Z");
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString();

  const recentEvents = await VelocityRepo.getRecentSaveEvents(db, projectId, thirtyDaysAgoStr);

  // Pre-window baselines
  const chapterIdsInWindow = [
    ...new Set(recentEvents.map((e) => e.chapter_id).filter((id): id is string => id !== null)),
  ];
  let preWindowBaselines: Record<string, number> = {};
  try {
    preWindowBaselines = await VelocityRepo.getPreWindowBaselines(
      db,
      projectId,
      chapterIdsInWindow,
      thirtyDaysAgoStr,
    );
  } catch (err) {
    console.error("Failed to fetch pre-window baselines for session net_words:", err);
    for (const evt of recentEvents) {
      const key = evt.chapter_id ?? `_purged_${evt.id}`;
      if (!(key in preWindowBaselines)) {
        preWindowBaselines[key] = evt.word_count;
      }
    }
  }

  const sessions = deriveSessions(recentEvents, preWindowBaselines);

  // Streaks
  const allDates = await VelocityRepo.getWritingDates(db, projectId, 400);
  const streak = calculateStreaks(allDates, today);

  // 30-day daily average
  const thirtyDaysAgoDateStr = thirtyDaysAgo.toISOString().slice(0, 10);
  let dailyAvg30d = 0;
  const newest = dailySnapshots[dailySnapshots.length - 1];
  if (newest) {
    const firstSnapshot = dailySnapshots[0];
    const baselineSnapshot = [...dailySnapshots]
      .reverse()
      .find((s) => s.date <= thirtyDaysAgoDateStr);
    const baselineTotal = baselineSnapshot
      ? baselineSnapshot.total_word_count
      : firstSnapshot
        ? firstSnapshot.total_word_count
        : 0;
    const baselineDate = baselineSnapshot
      ? baselineSnapshot.date
      : firstSnapshot
        ? firstSnapshot.date
        : newest.date;
    const msPerDay = 86_400_000;
    const daysCovered = Math.min(
      30,
      Math.max(
        1,
        Math.round(
          (new Date(newest.date + "T00:00:00Z").getTime() -
            new Date(baselineDate + "T00:00:00Z").getTime()) /
            msPerDay,
        ),
      ),
    );
    dailyAvg30d = Math.round((newest.total_word_count - baselineTotal) / daysCovered);
  }

  // Current total
  const currentTotal = await VelocityRepo.getProjectTotalWordCount(db, projectId);

  const projection = calculateProjection(
    targetWordCount,
    targetDeadline,
    dailyAvg30d,
    currentTotal,
    today,
  );

  // Completion stats
  let completedChapters = 0;
  const chapters = await db("chapters")
    .where({ project_id: projectId })
    .whereNull("deleted_at")
    .select("id", "title", "status");

  if (completionThreshold) {
    const { findByStatus } = await import("../chapter-statuses/chapter-statuses.repository");
    const thresholdRow = await findByStatus(db, completionThreshold);
    const thresholdSortOrder = thresholdRow?.sort_order ?? 999;
    const allStatuses = await (await import("../chapter-statuses/chapter-statuses.repository")).list(db);
    const statusSortMap: Record<string, number> = {};
    for (const s of allStatuses) {
      statusSortMap[s.status] = s.sort_order;
    }
    for (const ch of chapters) {
      const chSortOrder = statusSortMap[ch.status] ?? 0;
      if (chSortOrder >= thresholdSortOrder) {
        completedChapters++;
      }
    }
  }

  const completion = {
    threshold_status: completionThreshold,
    total_chapters: chapters.length,
    completed_chapters: completedChapters,
  };

  // Chapter names
  const allChaptersForNames = await db("chapters")
    .where({ project_id: projectId })
    .select("id", "title");
  const chapterNames: Record<string, string> = {};
  for (const ch of allChaptersForNames) {
    chapterNames[ch.id] = ch.title;
  }

  return {
    daily_snapshots: dailySnapshots,
    sessions,
    streak,
    projection,
    completion,
    today,
    current_total: currentTotal,
    chapter_names: chapterNames,
  };
}
```

**Step 4: Create route**

```typescript
// packages/server/src/velocity/velocity.routes.ts
import { Router } from "express";
import { asyncHandler } from "../app";
import * as VelocityService from "./velocity.service";

// Note: This router is mounted under /api/projects by the projects router.
// The velocity route is GET /:slug/velocity, but it needs the project lookup
// to happen first. So we export a handler factory instead of a full router.

export const velocityHandler = asyncHandler(async (req, res) => {
  // The project is looked up by the projects route. We need the project data.
  // Since the velocity route is mounted within the projects router context,
  // we receive the slug and need to look up the project ourselves.
  const { getDb } = await import("../db/connection");
  const db = getDb();

  const project = await db("projects")
    .where({ slug: req.params.slug })
    .whereNull("deleted_at")
    .first();

  if (!project) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Project not found." },
    });
    return;
  }

  const body = await VelocityService.getVelocity(
    project.id,
    project.target_word_count ?? null,
    project.target_deadline ?? null,
    project.completion_threshold ?? null,
  );
  res.json(body);
});
```

**Step 5: Run existing tests**

Run: `npm test -w packages/server`
Expected: ALL existing tests pass. The velocity and velocityHelpers tests validate correctness.

Note: The velocity route is still mounted by the projects router. We'll update the mounting in Task 6 when we extract projects.

**Step 6: Commit**

```bash
git add packages/server/src/velocity/
git commit -m "refactor: extract velocity domain (types, repository, service, routes)"
```

---

## Task 5: Projects Domain

**Files:**
- Create: `packages/server/src/projects/projects.types.ts`
- Create: `packages/server/src/projects/projects.repository.ts`
- Create: `packages/server/src/projects/projects.service.ts`
- Create: `packages/server/src/projects/projects.routes.ts`
- Test: Multiple existing tests must still pass

**Step 1: Create internal types**

```typescript
// packages/server/src/projects/projects.types.ts
export interface ProjectRow {
  id: string;
  title: string;
  slug: string;
  mode: string;
  target_word_count: number | null;
  target_deadline: string | null;
  completion_threshold: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CreateProjectRow {
  id: string;
  title: string;
  slug: string;
  mode: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectListRow {
  id: string;
  title: string;
  slug: string;
  mode: string;
  updated_at: string;
  total_word_count: number;
}
```

**Step 2: Create repository**

```typescript
// packages/server/src/projects/projects.repository.ts
import type { Knex } from "knex";
import type { ProjectRow, CreateProjectRow, ProjectListRow } from "./projects.types";

export async function insert(
  trx: Knex.Transaction,
  data: CreateProjectRow,
): Promise<ProjectRow> {
  await trx("projects").insert(data);
  return trx("projects").where({ id: data.id }).first();
}

export async function findById(
  trx: Knex.Transaction | Knex,
  id: string,
): Promise<ProjectRow | undefined> {
  return trx("projects").where({ id }).first();
}

export async function findBySlug(
  trx: Knex.Transaction | Knex,
  slug: string,
): Promise<ProjectRow | undefined> {
  return trx("projects").where({ slug }).whereNull("deleted_at").first();
}

export async function findByTitle(
  trx: Knex.Transaction | Knex,
  title: string,
  excludeId?: string,
): Promise<ProjectRow | undefined> {
  const query = trx("projects").where({ title }).whereNull("deleted_at");
  if (excludeId) {
    query.whereNot({ id: excludeId });
  }
  return query.first();
}

export async function listAll(trx: Knex.Transaction | Knex): Promise<ProjectListRow[]> {
  const result = await trx("projects")
    .leftJoin("chapters", function () {
      this.on("projects.id", "=", "chapters.project_id").andOnNull("chapters.deleted_at");
    })
    .whereNull("projects.deleted_at")
    .groupBy("projects.id")
    .orderBy("projects.updated_at", "desc")
    .orderBy("projects.rowid", "desc")
    .select(
      "projects.id",
      "projects.title",
      "projects.slug",
      "projects.mode",
      "projects.updated_at",
      trx.raw("COALESCE(SUM(chapters.word_count), 0) as total_word_count"),
    );

  return result.map((r: Record<string, unknown>) => ({
    ...r,
    total_word_count: Number(r.total_word_count),
  })) as ProjectListRow[];
}

export async function update(
  trx: Knex.Transaction,
  id: string,
  data: Partial<ProjectRow>,
): Promise<ProjectRow> {
  await trx("projects").where({ id }).update(data);
  return trx("projects").where({ id }).first();
}

export async function softDelete(
  trx: Knex.Transaction,
  id: string,
  now: string,
): Promise<void> {
  await trx("projects").where({ id }).update({ deleted_at: now });
}

export async function resolveUniqueSlug(
  trx: Knex.Transaction | Knex,
  baseSlug: string,
  excludeProjectId?: string,
): Promise<string> {
  const MAX_SUFFIX = 1000;

  const baseQuery = trx("projects").where({ slug: baseSlug }).whereNull("deleted_at");
  if (excludeProjectId) {
    baseQuery.whereNot({ id: excludeProjectId });
  }
  if (!(await baseQuery.first())) return baseSlug;

  for (let suffix = 2; suffix <= MAX_SUFFIX; suffix++) {
    const slug = `${baseSlug}-${suffix}`;
    const query = trx("projects").where({ slug }).whereNull("deleted_at");
    if (excludeProjectId) {
      query.whereNot({ id: excludeProjectId });
    }
    if (!(await query.first())) return slug;
  }

  throw new Error(`Cannot generate unique slug for "${baseSlug}" after ${MAX_SUFFIX} attempts`);
}
```

**Step 3: Create service**

```typescript
// packages/server/src/projects/projects.service.ts
import { v4 as uuid } from "uuid";
import type {
  Project,
  ProjectListItem,
  ProjectWithChapters,
} from "@smudge/shared";
import { generateSlug, UNTITLED_CHAPTER } from "@smudge/shared";
import { getDb } from "../db/connection";
import * as ProjectRepo from "./projects.repository";
import * as ChapterRepo from "../chapters/chapters.repository";
import * as ChapterStatusRepo from "../chapter-statuses/chapter-statuses.repository";
import * as VelocityService from "../velocity/velocity.service";
import type { ProjectRow, ProjectListRow } from "./projects.types";

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    mode: row.mode as Project["mode"],
    target_word_count: row.target_word_count,
    target_deadline: row.target_deadline,
    completion_threshold: row.completion_threshold as Project["completion_threshold"],
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  };
}

function toProjectListItem(row: ProjectListRow): ProjectListItem {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    mode: row.mode as ProjectListItem["mode"],
    total_word_count: row.total_word_count,
    updated_at: row.updated_at,
  };
}

export async function createProject(
  title: string,
  mode: string,
): Promise<Project> {
  const db = getDb();

  const existing = await ProjectRepo.findByTitle(db, title);
  if (existing) {
    throw new ProjectTitleExistsError();
  }

  const projectId = uuid();
  const chapterId = uuid();
  const now = new Date().toISOString();

  try {
    await db.transaction(async (trx) => {
      const slug = await ProjectRepo.resolveUniqueSlug(trx, generateSlug(title));
      await ProjectRepo.insert(trx, {
        id: projectId,
        title,
        slug,
        mode,
        created_at: now,
        updated_at: now,
      });
      await ChapterRepo.insert(trx, {
        id: chapterId,
        project_id: projectId,
        title: UNTITLED_CHAPTER,
        content: null,
        sort_order: 0,
        word_count: 0,
        created_at: now,
        updated_at: now,
      });
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
      throw new ProjectTitleExistsError();
    }
    throw err;
  }

  const row = await ProjectRepo.findById(db, projectId);
  return toProject(row!);
}

export async function listProjects(): Promise<ProjectListItem[]> {
  const db = getDb();
  const rows = await ProjectRepo.listAll(db);
  return rows.map(toProjectListItem);
}

export async function getProject(slug: string): Promise<ProjectWithChapters | null> {
  const db = getDb();
  const project = await ProjectRepo.findBySlug(db, slug);
  if (!project) return null;

  const chapters = await ChapterRepo.listByProject(db, project.id);
  const statusLabelMap = await ChapterStatusRepo.getStatusLabelMap(db);

  const chaptersWithLabels = chapters.map((ch) => ({
    ...ch,
    status_label: statusLabelMap[ch.status] ?? ch.status,
  }));

  return { ...toProject(project), chapters: chaptersWithLabels };
}

export async function updateProject(
  slug: string,
  data: {
    title?: string;
    target_word_count?: number | null;
    target_deadline?: string | null;
    completion_threshold?: string | null;
  },
): Promise<Project | null> {
  const db = getDb();
  const project = await ProjectRepo.findBySlug(db, slug);
  if (!project) return null;

  if (data.title !== undefined) {
    const existing = await ProjectRepo.findByTitle(db, data.title, project.id);
    if (existing) throw new ProjectTitleExistsError();
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (data.target_word_count !== undefined) updates.target_word_count = data.target_word_count;
  if (data.target_deadline !== undefined) updates.target_deadline = data.target_deadline;
  if (data.completion_threshold !== undefined) updates.completion_threshold = data.completion_threshold;

  try {
    await db.transaction(async (trx) => {
      if (data.title !== undefined) {
        const newSlug = await ProjectRepo.resolveUniqueSlug(
          trx,
          generateSlug(data.title),
          project.id,
        );
        updates.title = data.title;
        updates.slug = newSlug;
      }
      await trx("projects").where({ id: project.id }).update(updates);
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
      throw new ProjectTitleExistsError();
    }
    throw err;
  }

  const updated = await ProjectRepo.findById(db, project.id);
  return toProject(updated!);
}

export async function deleteProject(slug: string): Promise<boolean> {
  const db = getDb();
  const project = await ProjectRepo.findBySlug(db, slug);
  if (!project) return false;

  const now = new Date().toISOString();
  await db.transaction(async (trx) => {
    await ChapterRepo.softDeleteByProject(trx, project.id, now);
    await ProjectRepo.softDelete(trx, project.id, now);
  });

  await VelocityService.updateDailySnapshot(project.id);
  return true;
}

export async function createChapter(slug: string): Promise<Record<string, unknown> | null> {
  const db = getDb();
  const project = await ProjectRepo.findBySlug(db, slug);
  if (!project) return null;

  const chapterId = uuid();
  const now = new Date().toISOString();

  await db.transaction(async (trx) => {
    const maxOrder = await ChapterRepo.getMaxSortOrder(trx, project.id);
    await ChapterRepo.insert(trx, {
      id: chapterId,
      project_id: project.id,
      title: UNTITLED_CHAPTER,
      content: null,
      sort_order: (maxOrder ?? -1) + 1,
      word_count: 0,
      created_at: now,
      updated_at: now,
    });
    await trx("projects").where({ id: project.id }).update({ updated_at: now });
  });

  const chapter = await ChapterRepo.findById(db, chapterId);
  if (!chapter) return null;
  const statusLabelMap = await ChapterStatusRepo.getStatusLabelMap(db);
  return { ...chapter, status_label: statusLabelMap[chapter.status] ?? chapter.status };
}

export async function reorderChapters(
  slug: string,
  chapterIds: string[],
): Promise<{ error?: { code: string; message: string } } | null> {
  const db = getDb();
  const project = await ProjectRepo.findBySlug(db, slug);
  if (!project) return null;

  const existing = await ChapterRepo.listIdsByProject(db, project.id);
  const existingIds = existing.sort();
  const providedIds = [...chapterIds].sort();

  if (
    existingIds.length !== providedIds.length ||
    !existingIds.every((id, i) => id === providedIds[i])
  ) {
    return {
      error: {
        code: "REORDER_MISMATCH",
        message: "Provided chapter IDs do not match existing chapters.",
      },
    };
  }

  await db.transaction(async (trx) => {
    await ChapterRepo.updateSortOrders(
      trx,
      chapterIds.map((id, i) => ({ id, sortOrder: i })),
    );
    await trx("projects")
      .where({ id: project.id })
      .update({ updated_at: new Date().toISOString() });
  });

  return {};
}

export async function getDashboard(slug: string): Promise<Record<string, unknown> | null> {
  const db = getDb();
  const project = await ProjectRepo.findBySlug(db, slug);
  if (!project) return null;

  const chapters = await ChapterRepo.listMetadataByProject(db, project.id);
  const statusLabelMap = await ChapterStatusRepo.getStatusLabelMap(db);

  const chaptersWithLabels = chapters.map((ch: Record<string, unknown>) => ({
    ...ch,
    status_label: statusLabelMap[ch.status as string] ?? (ch.status as string),
  }));

  const allStatuses = await ChapterStatusRepo.list(db);
  const statusSummary: Record<string, number> = {};
  for (const s of allStatuses) {
    statusSummary[s.status] = 0;
  }
  for (const ch of chapters) {
    const status = ch.status as string;
    if (status in statusSummary) {
      statusSummary[status] = (statusSummary[status] ?? 0) + 1;
    }
  }

  const totalWordCount = chapters.reduce(
    (sum: number, ch: Record<string, unknown>) => sum + (ch.word_count as number),
    0,
  );
  const updatedAts = chapters.map((ch: Record<string, unknown>) => ch.updated_at as string);
  const mostRecentEdit =
    updatedAts.length > 0 ? updatedAts.reduce((a, b) => (a > b ? a : b)) : null;
  const leastRecentEdit =
    updatedAts.length > 0 ? updatedAts.reduce((a, b) => (a < b ? a : b)) : null;

  return {
    chapters: chaptersWithLabels,
    status_summary: statusSummary,
    totals: {
      word_count: totalWordCount,
      chapter_count: chapters.length,
      most_recent_edit: mostRecentEdit,
      least_recent_edit: leastRecentEdit,
    },
  };
}

export async function getTrash(slug: string): Promise<Record<string, unknown>[] | null> {
  const db = getDb();
  const project = await ProjectRepo.findBySlug(db, slug);
  if (!project) return null;

  return ChapterRepo.listDeletedByProject(db, project.id);
}

// --- Error types ---

export class ProjectTitleExistsError extends Error {
  constructor() {
    super("A project with that title already exists");
    this.name = "ProjectTitleExistsError";
  }
}
```

**Step 4: Create route**

```typescript
// packages/server/src/projects/projects.routes.ts
import { Router } from "express";
import { CreateProjectSchema, UpdateProjectSchema, ReorderChaptersSchema } from "@smudge/shared";
import { asyncHandler } from "../app";
import * as ProjectService from "./projects.service";
import { velocityHandler } from "../velocity/velocity.routes";

export function projectsRouter(): Router {
  const router = Router();

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const parsed = CreateProjectSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0]?.message ?? "Invalid input",
          },
        });
        return;
      }

      try {
        const project = await ProjectService.createProject(parsed.data.title, parsed.data.mode);
        res.status(201).json(project);
      } catch (err) {
        if (err instanceof ProjectService.ProjectTitleExistsError) {
          res.status(400).json({
            error: {
              code: "PROJECT_TITLE_EXISTS",
              message: "A project with that title already exists",
            },
          });
          return;
        }
        throw err;
      }
    }),
  );

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const projects = await ProjectService.listProjects();
      res.json(projects);
    }),
  );

  router.patch(
    "/:slug",
    asyncHandler(async (req, res) => {
      const parsed = UpdateProjectSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0]?.message ?? "Invalid input",
          },
        });
        return;
      }

      try {
        const project = await ProjectService.updateProject(req.params.slug, parsed.data);
        if (!project) {
          res.status(404).json({
            error: { code: "NOT_FOUND", message: "Project not found." },
          });
          return;
        }
        res.json(project);
      } catch (err) {
        if (err instanceof ProjectService.ProjectTitleExistsError) {
          res.status(400).json({
            error: {
              code: "PROJECT_TITLE_EXISTS",
              message: "A project with that title already exists",
            },
          });
          return;
        }
        throw err;
      }
    }),
  );

  router.get("/:slug/velocity", velocityHandler);

  router.get(
    "/:slug",
    asyncHandler(async (req, res) => {
      const project = await ProjectService.getProject(req.params.slug);
      if (!project) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Project not found." },
        });
        return;
      }
      res.json(project);
    }),
  );

  router.post(
    "/:slug/chapters",
    asyncHandler(async (req, res) => {
      const chapter = await ProjectService.createChapter(req.params.slug);
      if (!chapter) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Project not found." },
        });
        return;
      }
      res.status(201).json(chapter);
    }),
  );

  router.put(
    "/:slug/chapters/order",
    asyncHandler(async (req, res) => {
      const parsed = ReorderChaptersSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0]?.message ?? "chapter_ids must be an array of UUIDs.",
          },
        });
        return;
      }

      const result = await ProjectService.reorderChapters(req.params.slug, parsed.data.chapter_ids);
      if (!result) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Project not found." },
        });
        return;
      }
      if (result.error) {
        res.status(400).json({ error: result.error });
        return;
      }
      res.json({ message: "Chapter order updated." });
    }),
  );

  router.get(
    "/:slug/dashboard",
    asyncHandler(async (req, res) => {
      const dashboard = await ProjectService.getDashboard(req.params.slug);
      if (!dashboard) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Project not found." },
        });
        return;
      }
      res.json(dashboard);
    }),
  );

  router.get(
    "/:slug/trash",
    asyncHandler(async (req, res) => {
      const trashed = await ProjectService.getTrash(req.params.slug);
      if (!trashed) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Project not found." },
        });
        return;
      }
      res.json(trashed);
    }),
  );

  router.delete(
    "/:slug",
    asyncHandler(async (req, res) => {
      const deleted = await ProjectService.deleteProject(req.params.slug);
      if (!deleted) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Project not found." },
        });
        return;
      }
      res.json({ message: "Project moved to trash." });
    }),
  );

  return router;
}
```

**Step 5: Update `app.ts`**

```typescript
// Change import from:
import { projectsRouter } from "./routes/projects";
// to:
import { projectsRouter } from "./projects/projects.routes";

// Change:
app.use("/api/projects", projectsRouter(db));
// to:
app.use("/api/projects", projectsRouter());
```

**Step 6: Run existing tests**

Run: `npm test -w packages/server`
Expected: ALL existing tests pass

Note: This task depends on Task 6 (chapters repository) being created first, because the projects service imports `ChapterRepo`. **You must create the chapters repository (Task 6, Steps 1-2) before this task can compile.** Alternatively, implement Tasks 5 and 6 together. The plan presents them separately for clarity, but the implementer should create both repository files before attempting to compile either service.

**Step 7: Commit**

```bash
git add packages/server/src/projects/ packages/server/src/app.ts
git commit -m "refactor: extract projects domain (types, repository, service, routes)"
```

---

## Task 6: Chapters Domain

**Files:**
- Create: `packages/server/src/chapters/chapters.types.ts`
- Create: `packages/server/src/chapters/chapters.repository.ts`
- Create: `packages/server/src/chapters/chapters.service.ts`
- Create: `packages/server/src/chapters/chapters.routes.ts`
- Test: Multiple existing tests must still pass

**Step 1: Create internal types**

```typescript
// packages/server/src/chapters/chapters.types.ts
export interface ChapterRow {
  id: string;
  project_id: string;
  title: string;
  content: Record<string, unknown> | null;
  sort_order: number;
  word_count: number;
  target_word_count: number | null;
  status: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CreateChapterRow {
  id: string;
  project_id: string;
  title: string;
  content: string | null;
  sort_order: number;
  word_count: number;
  created_at: string;
  updated_at: string;
}
```

**Step 2: Create repository**

The chapters repository absorbs `parseChapterContent`, `queryChapter`, `queryChapters`, and related helpers.

```typescript
// packages/server/src/chapters/chapters.repository.ts
import type { Knex } from "knex";
import type { ChapterRow, CreateChapterRow } from "./chapters.types";

// --- Internal: JSON parsing ---

function parseContent(chapter: Record<string, unknown>): Record<string, unknown> {
  if (typeof chapter.content === "string") {
    try {
      return { ...chapter, content: JSON.parse(chapter.content) };
    } catch (err) {
      console.error(
        `[parseChapterContent] corrupt JSON in chapter ${chapter.id ?? "unknown"} (${err instanceof Error ? err.name : "UnknownError"})`,
      );
      return { ...chapter, content: null, content_corrupt: true };
    }
  }
  return { ...chapter, content: chapter.content ?? null };
}

// --- Public API ---

export async function findById(
  trx: Knex.Transaction | Knex,
  id: string,
): Promise<Record<string, unknown> | null> {
  const row = await trx("chapters").where({ id }).whereNull("deleted_at").first();
  return row ? parseContent(row) : null;
}

export async function findByIdIncludingDeleted(
  trx: Knex.Transaction | Knex,
  id: string,
): Promise<Record<string, unknown> | null> {
  const row = await trx("chapters").where({ id }).whereNotNull("deleted_at").first();
  return row ? row : null;
}

export async function findByIdRaw(
  trx: Knex.Transaction | Knex,
  id: string,
): Promise<Record<string, unknown> | null> {
  return trx("chapters").where({ id }).whereNull("deleted_at").first() ?? null;
}

export async function listByProject(
  trx: Knex.Transaction | Knex,
  projectId: string,
): Promise<Record<string, unknown>[]> {
  const rows = await trx("chapters")
    .where({ project_id: projectId })
    .whereNull("deleted_at")
    .orderBy("sort_order", "asc")
    .select("*");
  return rows.map((row: Record<string, unknown>) => parseContent(row));
}

export async function listMetadataByProject(
  trx: Knex.Transaction | Knex,
  projectId: string,
): Promise<Record<string, unknown>[]> {
  return trx("chapters")
    .where({ project_id: projectId })
    .whereNull("deleted_at")
    .orderBy("sort_order", "asc")
    .select("id", "title", "status", "word_count", "target_word_count", "updated_at", "sort_order");
}

export async function listDeletedByProject(
  trx: Knex.Transaction | Knex,
  projectId: string,
): Promise<Record<string, unknown>[]> {
  const trashed = await trx("chapters")
    .where({ project_id: projectId })
    .whereNotNull("deleted_at")
    .orderBy("deleted_at", "desc")
    .select(
      "id", "project_id", "title", "status", "word_count",
      "sort_order", "deleted_at", "created_at", "updated_at",
    );
  return trashed.map((ch: Record<string, unknown>) => ({ ...ch, content: null }));
}

export async function listIdsByProject(
  trx: Knex.Transaction | Knex,
  projectId: string,
): Promise<string[]> {
  const existing = await trx("chapters")
    .where({ project_id: projectId })
    .whereNull("deleted_at")
    .select("id");
  return existing.map((c: { id: string }) => c.id);
}

export async function insert(
  trx: Knex.Transaction,
  data: CreateChapterRow,
): Promise<void> {
  await trx("chapters").insert(data);
}

export async function getMaxSortOrder(
  trx: Knex.Transaction | Knex,
  projectId: string,
): Promise<number | null> {
  const result = (await trx("chapters")
    .where({ project_id: projectId })
    .whereNull("deleted_at")
    .max("sort_order as max")
    .first()) as { max: number | null };
  return result?.max ?? null;
}

export async function updateContent(
  trx: Knex.Transaction,
  id: string,
  updates: Record<string, unknown>,
): Promise<void> {
  await trx("chapters").where({ id }).update(updates);
}

export async function updateSortOrders(
  trx: Knex.Transaction,
  orders: Array<{ id: string; sortOrder: number }>,
): Promise<void> {
  for (const { id, sortOrder } of orders) {
    await trx("chapters").where({ id }).update({ sort_order: sortOrder });
  }
}

export async function softDelete(
  trx: Knex.Transaction,
  id: string,
  now: string,
): Promise<void> {
  await trx("chapters").where({ id }).update({ deleted_at: now });
}

export async function softDeleteByProject(
  trx: Knex.Transaction,
  projectId: string,
  now: string,
): Promise<void> {
  await trx("chapters")
    .where({ project_id: projectId })
    .whereNull("deleted_at")
    .update({ deleted_at: now });
}

export async function restore(
  trx: Knex.Transaction,
  id: string,
): Promise<void> {
  await trx("chapters")
    .where({ id })
    .update({ deleted_at: null, updated_at: new Date().toISOString() });
}

export async function validateStatus(
  trx: Knex.Transaction | Knex,
  status: string,
): Promise<boolean> {
  const row = await trx("chapter_statuses").where({ status }).first();
  return !!row;
}
```

**Step 3: Create service**

```typescript
// packages/server/src/chapters/chapters.service.ts
import { countWords, generateSlug } from "@smudge/shared";
import { getDb } from "../db/connection";
import * as ChapterRepo from "./chapters.repository";
import * as ProjectRepo from "../projects/projects.repository";
import * as ChapterStatusRepo from "../chapter-statuses/chapter-statuses.repository";
import * as VelocityService from "../velocity/velocity.service";

// Injectable velocity service for testing failure paths
let velocityServiceImpl = VelocityService;

export function setVelocityService(impl: typeof VelocityService): void {
  velocityServiceImpl = impl;
}

export function resetVelocityService(): void {
  velocityServiceImpl = VelocityService;
}

export async function getChapter(id: string): Promise<Record<string, unknown> | null> {
  const db = getDb();
  const chapter = await ChapterRepo.findById(db, id);
  if (!chapter) return null;
  const statusLabel = await ChapterStatusRepo.getStatusLabel(db, chapter.status as string);
  return { ...chapter, status_label: statusLabel };
}

export function isCorruptChapter(chapter: Record<string, unknown>): boolean {
  return chapter.content_corrupt === true;
}

export function stripCorruptFlag(chapter: Record<string, unknown>): Record<string, unknown> {
  const { content_corrupt: _, ...rest } = chapter;
  return rest;
}

export async function updateChapter(
  id: string,
  data: {
    title?: string;
    content?: Record<string, unknown>;
    status?: string;
    target_word_count?: number | null;
  },
): Promise<{ chapter: Record<string, unknown> | null; error?: { code: string; message: string } }> {
  const db = getDb();

  const chapter = await db("chapters").where({ id }).whereNull("deleted_at").first();
  if (!chapter) return { chapter: null };

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (data.title !== undefined) updates.title = data.title;

  if (data.content !== undefined) {
    updates.content = JSON.stringify(data.content);
    updates.word_count = countWords(data.content as Record<string, unknown>);
  }

  if (data.target_word_count !== undefined) updates.target_word_count = data.target_word_count;

  if (data.status !== undefined) {
    const valid = await ChapterRepo.validateStatus(db, data.status);
    if (!valid) {
      return {
        chapter: null,
        error: { code: "VALIDATION_ERROR", message: `Invalid status: ${data.status}` },
      };
    }
    updates.status = data.status;
  }

  await db.transaction(async (trx) => {
    await ChapterRepo.updateContent(trx, id, updates);
    await trx("projects")
      .where({ id: chapter.project_id })
      .update({ updated_at: new Date().toISOString() });
  });

  // Velocity side effects (best-effort)
  if (data.content !== undefined) {
    await velocityServiceImpl
      .recordSave(chapter.project_id, chapter.id, updates.word_count as number)
      .catch((err) => console.error("velocity tracking failed", err));
  }

  const updated = await ChapterRepo.findById(db, id);
  if (!updated) return { chapter: null };

  if (data.content !== undefined && isCorruptChapter(updated)) {
    return {
      chapter: null,
      error: { code: "CORRUPT_CONTENT", message: "Chapter content is corrupted and cannot be loaded." },
    };
  }

  const statusLabel = await ChapterStatusRepo.getStatusLabel(db, updated.status as string);
  return { chapter: { ...updated, status_label: statusLabel } };
}

export async function deleteChapter(id: string): Promise<boolean> {
  const db = getDb();
  const chapter = await db("chapters").where({ id }).whereNull("deleted_at").first();
  if (!chapter) return false;

  const now = new Date().toISOString();
  await db.transaction(async (trx) => {
    await ChapterRepo.softDelete(trx, id, now);
    await trx("projects").where({ id: chapter.project_id }).update({ updated_at: now });
  });

  await velocityServiceImpl.updateDailySnapshot(chapter.project_id);
  return true;
}

export async function restoreChapter(
  id: string,
): Promise<{ chapter: Record<string, unknown> | null; error?: { code: string; message: string }; status?: number }> {
  const db = getDb();
  const chapter = await db("chapters").where({ id }).whereNotNull("deleted_at").first();
  if (!chapter) {
    return { chapter: null, error: { code: "NOT_FOUND", message: "Deleted chapter not found." }, status: 404 };
  }

  const parentProject = await ProjectRepo.findById(db, chapter.project_id);
  if (!parentProject) {
    return {
      chapter: null,
      error: { code: "PROJECT_PURGED", message: "The parent project has been permanently deleted." },
      status: 404,
    };
  }

  try {
    await db.transaction(async (trx) => {
      await ChapterRepo.restore(trx, id);
      if (parentProject.deleted_at) {
        const freshSlug = await ProjectRepo.resolveUniqueSlug(
          trx,
          generateSlug(parentProject.title),
          parentProject.id,
        );
        await trx("projects")
          .where({ id: chapter.project_id })
          .update({
            deleted_at: null,
            updated_at: new Date().toISOString(),
            slug: freshSlug,
          });
      }
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
      return {
        chapter: null,
        error: { code: "RESTORE_CONFLICT", message: "Could not restore — slug conflict. Please try again." },
        status: 409,
      };
    }
    throw err;
  }

  await velocityServiceImpl.updateDailySnapshot(chapter.project_id);

  const restored = await ChapterRepo.findById(db, id);
  if (!restored) return { chapter: null };

  const updatedProject = await ProjectRepo.findById(db, chapter.project_id);
  const statusLabel = await ChapterStatusRepo.getStatusLabel(db, restored.status as string);
  return {
    chapter: {
      ...restored,
      status_label: statusLabel,
      project_slug: updatedProject?.slug,
    },
  };
}
```

**Step 4: Create route**

```typescript
// packages/server/src/chapters/chapters.routes.ts
import { Router } from "express";
import { UpdateChapterSchema } from "@smudge/shared";
import { asyncHandler } from "../app";
import * as ChapterService from "./chapters.service";

export function chaptersRouter(): Router {
  const router = Router();

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const chapter = await ChapterService.getChapter(req.params.id);
      if (!chapter) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Chapter not found." },
        });
        return;
      }
      if (ChapterService.isCorruptChapter(chapter)) {
        res.status(500).json({
          error: { code: "CORRUPT_CONTENT", message: "Chapter content is corrupted and cannot be loaded." },
        });
        return;
      }
      res.json(chapter);
    }),
  );

  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const parsed = UpdateChapterSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0]?.message ?? "Invalid input",
          },
        });
        return;
      }

      const result = await ChapterService.updateChapter(req.params.id, parsed.data);
      if (result.error) {
        const status = result.error.code === "CORRUPT_CONTENT" ? 500 : 400;
        res.status(status).json({ error: result.error });
        return;
      }
      if (!result.chapter) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Chapter not found." },
        });
        return;
      }
      res.json(result.chapter);
    }),
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const deleted = await ChapterService.deleteChapter(req.params.id);
      if (!deleted) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Chapter not found." },
        });
        return;
      }
      res.json({ message: "Chapter moved to trash." });
    }),
  );

  router.post(
    "/:id/restore",
    asyncHandler(async (req, res) => {
      const result = await ChapterService.restoreChapter(req.params.id);
      if (result.error) {
        res.status(result.status ?? 500).json({ error: result.error });
        return;
      }
      if (!result.chapter) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Chapter not found." },
        });
        return;
      }
      res.json(result.chapter);
    }),
  );

  return router;
}
```

**Step 5: Update `app.ts` — final version**

```typescript
// packages/server/src/app.ts
import express from "express";
import type { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { projectsRouter } from "./projects/projects.routes";
import { chaptersRouter } from "./chapters/chapters.routes";
import { chapterStatusesRouter } from "./chapter-statuses/chapter-statuses.routes";
import { settingsRouter } from "./settings/settings.routes";

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function createApp(): express.Express {
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  app.use(express.json({ limit: "5mb" }));

  app.use("/api/projects", projectsRouter());
  app.use("/api/chapters", chaptersRouter());
  app.use("/api/chapter-statuses", chapterStatusesRouter());
  app.use("/api/settings", settingsRouter());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(
    (
      err: Error & { status?: number; statusCode?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      console.error(err);
      const status = err.status ?? err.statusCode ?? 500;
      const code = status < 500 ? "VALIDATION_ERROR" : "INTERNAL_ERROR";
      const message = status < 500 ? err.message : "An unexpected error occurred.";
      res.status(status).json({ error: { code, message } });
    },
  );

  return app;
}
```

**Step 6: Update `index.ts`**

Remove the `db` parameter from `createApp`:

```typescript
// In index.ts, change:
const app = createApp(db);
// to:
const app = createApp();
```

**Step 7: Update `test-helpers.ts`**

```typescript
// packages/server/src/__tests__/test-helpers.ts
import http from "http";
import { beforeAll, afterAll, beforeEach } from "vitest";
import knex, { type Knex } from "knex";
import { createTestKnexConfig } from "../db/knexfile";
import { setDb } from "../db/connection";
import { createApp } from "../app";

let testDb: Knex;
let testServer: http.Server;

export function setupTestDb() {
  beforeAll(async () => {
    testDb = knex(createTestKnexConfig());
    await testDb.raw("PRAGMA foreign_keys = ON");
    await testDb.migrate.latest();
    setDb(testDb);
    const app = createApp();
    testServer = app.listen(0);
    await new Promise<void>((resolve) => testServer.on("listening", resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => testServer.close(() => resolve()));
    await testDb.destroy();
  });

  beforeEach(async () => {
    await testDb("save_events").del();
    await testDb("daily_snapshots").del();
    await testDb("settings").del();
    await testDb("chapters").del();
    await testDb("projects").del();
  });

  return {
    get db() {
      return testDb;
    },
    get app() {
      return testServer;
    },
  };
}
```

**Step 8: Update existing test imports**

Several test files import from `../routes/...`. Update these imports:

- `packages/server/src/__tests__/resolve-slug.test.ts` — change import from `../routes/resolve-slug` to `../projects/projects.repository` and update the function name to `resolveUniqueSlug`
- `packages/server/src/__tests__/parseChapterContent.test.ts` — these test the parsing function which is now internal to the chapters repository. Either: (a) export `parseContent` from the repository for testing, or (b) test through the repository's public API. Recommended: export a `parseChapterContent` function from the chapters repository for backward compatibility with existing tests.
- `packages/server/src/__tests__/velocityHelpers.test.ts` — change imports to use `../velocity/velocity.service` for `calculateProjection` and `safeTimezone`. The `insertSaveEvent` and `upsertDailySnapshot` error-handling tests should be updated to test through `VelocityService.recordSave` and `VelocityService.updateDailySnapshot`.

**Step 9: Delete old route files**

Once all tests pass with the new domain structure, delete the old files:

```bash
rm packages/server/src/routes/projects.ts
rm packages/server/src/routes/chapters.ts
rm packages/server/src/routes/chapter-statuses.ts
rm packages/server/src/routes/settings.ts
rm packages/server/src/routes/velocity.ts
rm packages/server/src/routes/chapterQueries.ts
rm packages/server/src/routes/parseChapterContent.ts
rm packages/server/src/routes/resolve-slug.ts
rm packages/server/src/routes/status-labels.ts
rm packages/server/src/routes/velocityHelpers.ts
rmdir packages/server/src/routes
```

**Step 10: Run full test suite**

Run: `npm test -w packages/server`
Expected: ALL existing tests pass

Run: `make all`
Expected: Full CI pass (lint, format, typecheck, coverage, e2e)

**Step 11: Commit**

```bash
git add -A
git commit -m "refactor: extract chapters domain and complete layered architecture

All five domains (chapter-statuses, settings, velocity, projects, chapters)
now follow the types/repository/service/routes pattern. Old routes/ directory
removed. app.ts no longer passes db to routers — services use the connection
singleton directly."
```

---

## Task 7: Unit Tests — Repositories

Add unit tests for each repository. These test against a real SQLite database (project philosophy: no mocks).

**Files:**
- Create: `packages/server/src/__tests__/chapter-statuses.repository.test.ts`
- Create: `packages/server/src/__tests__/settings.repository.test.ts`
- Create: `packages/server/src/__tests__/projects.repository.test.ts`
- Create: `packages/server/src/__tests__/chapters.repository.test.ts`
- Create: `packages/server/src/__tests__/velocity.repository.test.ts`

**Step 1: Write chapter-statuses repository tests**

```typescript
// packages/server/src/__tests__/chapter-statuses.repository.test.ts
import { describe, it, expect } from "vitest";
import { setupTestDb } from "./test-helpers";
import * as ChapterStatusRepo from "../chapter-statuses/chapter-statuses.repository";

const t = setupTestDb();

describe("ChapterStatusRepo", () => {
  it("list() returns all statuses in sort order", async () => {
    const statuses = await ChapterStatusRepo.list(t.db);
    expect(statuses).toHaveLength(5);
    expect(statuses[0].status).toBe("outline");
    expect(statuses[4].status).toBe("final");
  });

  it("findByStatus() returns a status row", async () => {
    const row = await ChapterStatusRepo.findByStatus(t.db, "revised");
    expect(row).toBeDefined();
    expect(row!.label).toBe("Revised");
  });

  it("findByStatus() returns undefined for unknown status", async () => {
    const row = await ChapterStatusRepo.findByStatus(t.db, "nonexistent");
    expect(row).toBeUndefined();
  });

  it("getStatusLabel() returns the label for a known status", async () => {
    const label = await ChapterStatusRepo.getStatusLabel(t.db, "rough_draft");
    expect(label).toBe("Rough Draft");
  });

  it("getStatusLabel() returns the raw status for unknown status", async () => {
    const label = await ChapterStatusRepo.getStatusLabel(t.db, "unknown");
    expect(label).toBe("unknown");
  });

  it("getStatusLabelMap() returns a complete map", async () => {
    const map = await ChapterStatusRepo.getStatusLabelMap(t.db);
    expect(Object.keys(map)).toHaveLength(5);
    expect(map.outline).toBe("Outline");
    expect(map.final).toBe("Final");
  });
});
```

**Step 2: Write settings repository tests**

```typescript
// packages/server/src/__tests__/settings.repository.test.ts
import { describe, it, expect } from "vitest";
import { setupTestDb } from "./test-helpers";
import * as SettingsRepo from "../settings/settings.repository";

const t = setupTestDb();

describe("SettingsRepo", () => {
  it("listAll() returns empty array when no settings exist", async () => {
    const settings = await SettingsRepo.listAll(t.db);
    expect(settings).toEqual([]);
  });

  it("upsert() inserts a new setting", async () => {
    await t.db.transaction(async (trx) => {
      await SettingsRepo.upsert(trx, "timezone", "Europe/Malta");
    });
    const row = await SettingsRepo.findByKey(t.db, "timezone");
    expect(row).toBeDefined();
    expect(row!.value).toBe("Europe/Malta");
  });

  it("upsert() updates an existing setting", async () => {
    await t.db.transaction(async (trx) => {
      await SettingsRepo.upsert(trx, "timezone", "UTC");
    });
    await t.db.transaction(async (trx) => {
      await SettingsRepo.upsert(trx, "timezone", "America/New_York");
    });
    const row = await SettingsRepo.findByKey(t.db, "timezone");
    expect(row!.value).toBe("America/New_York");
  });

  it("listAll() returns all settings", async () => {
    await t.db.transaction(async (trx) => {
      await SettingsRepo.upsert(trx, "timezone", "UTC");
    });
    const settings = await SettingsRepo.listAll(t.db);
    expect(settings).toHaveLength(1);
    expect(settings[0].key).toBe("timezone");
  });
});
```

**Step 3: Write projects repository tests**

```typescript
// packages/server/src/__tests__/projects.repository.test.ts
import { describe, it, expect } from "vitest";
import { v4 as uuid } from "uuid";
import { setupTestDb } from "./test-helpers";
import * as ProjectRepo from "../projects/projects.repository";

const t = setupTestDb();

function makeProject(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    title: `Project ${Math.random().toString(36).slice(2, 8)}`,
    slug: `project-${Math.random().toString(36).slice(2, 8)}`,
    mode: "fiction",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("ProjectRepo", () => {
  it("insert() creates and returns a project", async () => {
    const data = makeProject();
    const row = await t.db.transaction(async (trx) => {
      return ProjectRepo.insert(trx, data);
    });
    expect(row.id).toBe(data.id);
    expect(row.title).toBe(data.title);
  });

  it("findBySlug() returns a project", async () => {
    const data = makeProject();
    await t.db.transaction(async (trx) => {
      await ProjectRepo.insert(trx, data);
    });
    const found = await ProjectRepo.findBySlug(t.db, data.slug);
    expect(found).toBeDefined();
    expect(found!.id).toBe(data.id);
  });

  it("findBySlug() excludes soft-deleted projects", async () => {
    const data = makeProject();
    await t.db.transaction(async (trx) => {
      await ProjectRepo.insert(trx, data);
      await ProjectRepo.softDelete(trx, data.id, new Date().toISOString());
    });
    const found = await ProjectRepo.findBySlug(t.db, data.slug);
    expect(found).toBeUndefined();
  });

  it("findByTitle() finds by title", async () => {
    const data = makeProject({ title: "Unique Title" });
    await t.db.transaction(async (trx) => {
      await ProjectRepo.insert(trx, data);
    });
    const found = await ProjectRepo.findByTitle(t.db, "Unique Title");
    expect(found).toBeDefined();
  });

  it("findByTitle() excludes specified project", async () => {
    const data = makeProject({ title: "Unique Title 2" });
    await t.db.transaction(async (trx) => {
      await ProjectRepo.insert(trx, data);
    });
    const found = await ProjectRepo.findByTitle(t.db, "Unique Title 2", data.id);
    expect(found).toBeUndefined();
  });

  it("resolveUniqueSlug() returns base slug when available", async () => {
    const slug = await ProjectRepo.resolveUniqueSlug(t.db, "fresh-slug");
    expect(slug).toBe("fresh-slug");
  });

  it("resolveUniqueSlug() appends suffix on collision", async () => {
    const data = makeProject({ slug: "taken" });
    await t.db.transaction(async (trx) => {
      await ProjectRepo.insert(trx, data);
    });
    const slug = await ProjectRepo.resolveUniqueSlug(t.db, "taken");
    expect(slug).toBe("taken-2");
  });

  it("listAll() returns projects with total word counts", async () => {
    const data = makeProject();
    await t.db.transaction(async (trx) => {
      await ProjectRepo.insert(trx, data);
    });
    const list = await ProjectRepo.listAll(t.db);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].total_word_count).toBeDefined();
  });
});
```

**Step 4: Write chapters repository tests**

```typescript
// packages/server/src/__tests__/chapters.repository.test.ts
import { describe, it, expect } from "vitest";
import { v4 as uuid } from "uuid";
import { setupTestDb } from "./test-helpers";
import * as ChapterRepo from "../chapters/chapters.repository";

const t = setupTestDb();

async function createProject() {
  const id = uuid();
  const now = new Date().toISOString();
  await t.db("projects").insert({
    id, title: `Project ${id.slice(0, 6)}`, slug: `project-${id.slice(0, 6)}`,
    mode: "fiction", created_at: now, updated_at: now,
  });
  return id;
}

describe("ChapterRepo", () => {
  it("insert() + findById() round-trips a chapter", async () => {
    const projectId = await createProject();
    const id = uuid();
    const now = new Date().toISOString();
    await t.db.transaction(async (trx) => {
      await ChapterRepo.insert(trx, {
        id, project_id: projectId, title: "Chapter 1",
        content: JSON.stringify({ type: "doc", content: [] }),
        sort_order: 0, word_count: 0, created_at: now, updated_at: now,
      });
    });
    const found = await ChapterRepo.findById(t.db, id);
    expect(found).toBeDefined();
    expect(found!.title).toBe("Chapter 1");
    expect(found!.content).toEqual({ type: "doc", content: [] });
  });

  it("findById() parses JSON content strings", async () => {
    const projectId = await createProject();
    const id = uuid();
    const now = new Date().toISOString();
    await t.db("chapters").insert({
      id, project_id: projectId, title: "Ch",
      content: '{"type":"doc","content":[]}',
      sort_order: 0, word_count: 0, created_at: now, updated_at: now,
    });
    const ch = await ChapterRepo.findById(t.db, id);
    expect(ch!.content).toEqual({ type: "doc", content: [] });
  });

  it("findById() flags corrupt JSON", async () => {
    const projectId = await createProject();
    const id = uuid();
    const now = new Date().toISOString();
    await t.db("chapters").insert({
      id, project_id: projectId, title: "Ch",
      content: "not-valid-json",
      sort_order: 0, word_count: 0, created_at: now, updated_at: now,
    });
    const ch = await ChapterRepo.findById(t.db, id);
    expect(ch!.content).toBeNull();
    expect(ch!.content_corrupt).toBe(true);
  });

  it("listByProject() returns chapters in sort order", async () => {
    const projectId = await createProject();
    const now = new Date().toISOString();
    await t.db.transaction(async (trx) => {
      await ChapterRepo.insert(trx, {
        id: uuid(), project_id: projectId, title: "B",
        content: null, sort_order: 1, word_count: 0, created_at: now, updated_at: now,
      });
      await ChapterRepo.insert(trx, {
        id: uuid(), project_id: projectId, title: "A",
        content: null, sort_order: 0, word_count: 0, created_at: now, updated_at: now,
      });
    });
    const chapters = await ChapterRepo.listByProject(t.db, projectId);
    expect(chapters[0].title).toBe("A");
    expect(chapters[1].title).toBe("B");
  });

  it("softDelete() + findById() excludes deleted chapters", async () => {
    const projectId = await createProject();
    const id = uuid();
    const now = new Date().toISOString();
    await t.db.transaction(async (trx) => {
      await ChapterRepo.insert(trx, {
        id, project_id: projectId, title: "Ch",
        content: null, sort_order: 0, word_count: 0, created_at: now, updated_at: now,
      });
      await ChapterRepo.softDelete(trx, id, now);
    });
    const found = await ChapterRepo.findById(t.db, id);
    expect(found).toBeNull();
  });

  it("listDeletedByProject() returns trashed chapters", async () => {
    const projectId = await createProject();
    const id = uuid();
    const now = new Date().toISOString();
    await t.db.transaction(async (trx) => {
      await ChapterRepo.insert(trx, {
        id, project_id: projectId, title: "Ch",
        content: null, sort_order: 0, word_count: 0, created_at: now, updated_at: now,
      });
      await ChapterRepo.softDelete(trx, id, now);
    });
    const trashed = await ChapterRepo.listDeletedByProject(t.db, projectId);
    expect(trashed).toHaveLength(1);
    expect(trashed[0].content).toBeNull();
  });

  it("getMaxSortOrder() returns highest sort_order", async () => {
    const projectId = await createProject();
    const now = new Date().toISOString();
    await t.db.transaction(async (trx) => {
      await ChapterRepo.insert(trx, {
        id: uuid(), project_id: projectId, title: "A",
        content: null, sort_order: 0, word_count: 0, created_at: now, updated_at: now,
      });
      await ChapterRepo.insert(trx, {
        id: uuid(), project_id: projectId, title: "B",
        content: null, sort_order: 5, word_count: 0, created_at: now, updated_at: now,
      });
    });
    const max = await ChapterRepo.getMaxSortOrder(t.db, projectId);
    expect(max).toBe(5);
  });
});
```

**Step 5: Write velocity repository tests**

```typescript
// packages/server/src/__tests__/velocity.repository.test.ts
import { describe, it, expect } from "vitest";
import { v4 as uuid } from "uuid";
import { setupTestDb } from "./test-helpers";
import * as VelocityRepo from "../velocity/velocity.repository";

const t = setupTestDb();

async function createProjectWithChapter() {
  const projectId = uuid();
  const chapterId = uuid();
  const now = new Date().toISOString();
  await t.db("projects").insert({
    id: projectId, title: `P-${projectId.slice(0, 6)}`, slug: `p-${projectId.slice(0, 6)}`,
    mode: "fiction", created_at: now, updated_at: now,
  });
  await t.db("chapters").insert({
    id: chapterId, project_id: projectId, title: "Ch 1",
    content: null, sort_order: 0, word_count: 100, created_at: now, updated_at: now,
  });
  return { projectId, chapterId };
}

describe("VelocityRepo", () => {
  it("insertSaveEvent() creates a save event", async () => {
    const { projectId, chapterId } = await createProjectWithChapter();
    await VelocityRepo.insertSaveEvent(t.db, chapterId, projectId, 100, "2026-04-05");
    const events = await t.db("save_events").where({ project_id: projectId });
    expect(events).toHaveLength(1);
    expect(events[0].word_count).toBe(100);
  });

  it("upsertDailySnapshot() creates a new snapshot", async () => {
    const { projectId } = await createProjectWithChapter();
    await VelocityRepo.upsertDailySnapshot(t.db, projectId, "2026-04-05", 500);
    const snapshots = await t.db("daily_snapshots").where({ project_id: projectId });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].total_word_count).toBe(500);
  });

  it("upsertDailySnapshot() updates existing snapshot on same day", async () => {
    const { projectId } = await createProjectWithChapter();
    await VelocityRepo.upsertDailySnapshot(t.db, projectId, "2026-04-05", 500);
    await VelocityRepo.upsertDailySnapshot(t.db, projectId, "2026-04-05", 600);
    const snapshots = await t.db("daily_snapshots").where({ project_id: projectId });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].total_word_count).toBe(600);
  });

  it("getProjectTotalWordCount() sums non-deleted chapters", async () => {
    const { projectId } = await createProjectWithChapter();
    const total = await VelocityRepo.getProjectTotalWordCount(t.db, projectId);
    expect(total).toBe(100);
  });

  it("getRecentSaveEvents() filters by timestamp", async () => {
    const { projectId, chapterId } = await createProjectWithChapter();
    await VelocityRepo.insertSaveEvent(t.db, chapterId, projectId, 100, "2026-04-05");
    const events = await VelocityRepo.getRecentSaveEvents(
      t.db, projectId, "2026-04-04T00:00:00.000Z",
    );
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it("getWritingDates() returns dates with save events", async () => {
    const { projectId, chapterId } = await createProjectWithChapter();
    await VelocityRepo.insertSaveEvent(t.db, chapterId, projectId, 100, "2026-04-05");
    await VelocityRepo.upsertDailySnapshot(t.db, projectId, "2026-04-05", 100);
    const dates = await VelocityRepo.getWritingDates(t.db, projectId, 400);
    expect(dates).toContain("2026-04-05");
  });
});
```

**Step 6: Run all tests**

Run: `npm test -w packages/server`
Expected: All existing + new repository tests pass

**Step 7: Commit**

```bash
git add packages/server/src/__tests__/*repository*
git commit -m "test: add unit tests for all repository modules"
```

---

## Task 8: Unit Tests — Services

Add unit tests for service-layer logic. These test business logic, orchestration, and mapping.

**Files:**
- Create: `packages/server/src/__tests__/chapters.service.test.ts`
- Create: `packages/server/src/__tests__/projects.service.test.ts`
- Create: `packages/server/src/__tests__/settings.service.test.ts`

**Step 1: Write chapters service test (including velocity injection)**

```typescript
// packages/server/src/__tests__/chapters.service.test.ts
import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { setupTestDb } from "./test-helpers";
import * as ChapterService from "../chapters/chapters.service";

const t = setupTestDb();

afterEach(() => {
  ChapterService.resetVelocityService();
});

async function createProjectWithChapter() {
  const res = await request(t.app)
    .post("/api/projects")
    .send({ title: `P-${Math.random().toString(36).slice(2, 8)}`, mode: "fiction" });
  const chapters = await t.db("chapters").where({ project_id: res.body.id }).select("id");
  return { projectId: res.body.id, chapterId: chapters[0].id };
}

describe("ChapterService", () => {
  it("updateChapter() succeeds even when velocity service throws", async () => {
    const { chapterId } = await createProjectWithChapter();

    // Inject a throwing velocity service
    ChapterService.setVelocityService({
      recordSave: async () => { throw new Error("velocity exploded"); },
      updateDailySnapshot: async () => { throw new Error("velocity exploded"); },
    } as typeof import("../velocity/velocity.service"));

    const result = await ChapterService.updateChapter(chapterId, {
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
      },
    });

    expect(result.chapter).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  it("deleteChapter() succeeds even when velocity service throws", async () => {
    const { chapterId } = await createProjectWithChapter();

    ChapterService.setVelocityService({
      recordSave: async () => { throw new Error("velocity exploded"); },
      updateDailySnapshot: async () => { throw new Error("velocity exploded"); },
    } as typeof import("../velocity/velocity.service"));

    const deleted = await ChapterService.deleteChapter(chapterId);
    expect(deleted).toBe(true);
  });

  it("isCorruptChapter() detects corrupt flag", () => {
    expect(ChapterService.isCorruptChapter({ content_corrupt: true })).toBe(true);
    expect(ChapterService.isCorruptChapter({ content: null })).toBe(false);
  });

  it("stripCorruptFlag() removes the internal flag", () => {
    const result = ChapterService.stripCorruptFlag({ id: "1", content_corrupt: true });
    expect(result).toEqual({ id: "1" });
  });
});
```

**Step 2: Write projects service test**

```typescript
// packages/server/src/__tests__/projects.service.test.ts
import { describe, it, expect } from "vitest";
import { setupTestDb } from "./test-helpers";
import * as ProjectService from "../projects/projects.service";

const t = setupTestDb();

describe("ProjectService", () => {
  it("createProject() throws ProjectTitleExistsError on duplicate title", async () => {
    await ProjectService.createProject("Duplicate Test", "fiction");
    await expect(
      ProjectService.createProject("Duplicate Test", "fiction"),
    ).rejects.toThrow(ProjectService.ProjectTitleExistsError);
  });

  it("createProject() auto-creates a first chapter", async () => {
    const project = await ProjectService.createProject("New Project", "fiction");
    const chapters = await t.db("chapters").where({ project_id: project.id });
    expect(chapters).toHaveLength(1);
  });

  it("getProject() returns null for nonexistent slug", async () => {
    const result = await ProjectService.getProject("no-such-slug");
    expect(result).toBeNull();
  });

  it("getProject() includes chapters with status labels", async () => {
    const created = await ProjectService.createProject("With Chapters", "fiction");
    const project = await ProjectService.getProject(created.slug);
    expect(project).toBeDefined();
    expect(project!.chapters.length).toBeGreaterThanOrEqual(1);
    expect(project!.chapters[0].status_label).toBeDefined();
  });

  it("deleteProject() returns false for nonexistent slug", async () => {
    const result = await ProjectService.deleteProject("no-such-slug");
    expect(result).toBe(false);
  });

  it("deleteProject() soft-deletes project and chapters", async () => {
    const project = await ProjectService.createProject("To Delete", "fiction");
    const result = await ProjectService.deleteProject(project.slug);
    expect(result).toBe(true);
    const found = await t.db("projects").where({ id: project.id }).first();
    expect(found.deleted_at).not.toBeNull();
  });
});
```

**Step 3: Write settings service test**

```typescript
// packages/server/src/__tests__/settings.service.test.ts
import { describe, it, expect } from "vitest";
import { setupTestDb } from "./test-helpers";
import * as SettingsService from "../settings/settings.service";

const t = setupTestDb();

describe("SettingsService", () => {
  it("getAll() returns empty object when no settings", async () => {
    const result = await SettingsService.getAll();
    expect(result).toEqual({});
  });

  it("update() saves valid settings", async () => {
    const result = await SettingsService.update([{ key: "timezone", value: "UTC" }]);
    expect(result).toBeNull();
    const all = await SettingsService.getAll();
    expect(all.timezone).toBe("UTC");
  });

  it("update() rejects unknown settings", async () => {
    const result = await SettingsService.update([{ key: "bogus", value: "whatever" }]);
    expect(result).toBeDefined();
    expect(result!.errors.bogus).toContain("Unknown setting");
  });

  it("update() rejects invalid timezone", async () => {
    const result = await SettingsService.update([{ key: "timezone", value: "Not/A/Zone" }]);
    expect(result).toBeDefined();
    expect(result!.errors.timezone).toContain("Invalid value");
  });
});
```

**Step 4: Run all tests**

Run: `npm test -w packages/server`
Expected: All tests pass

**Step 5: Commit**

```bash
git add packages/server/src/__tests__/*service*
git commit -m "test: add unit tests for service modules including velocity injection"
```

---

## Task 9: Final Verification

**Step 1: Run full CI**

Run: `make all`
Expected: Full pass — lint, format, typecheck, coverage, e2e

**Step 2: Fix any coverage threshold issues**

If coverage drops below thresholds (95% statements, 85% branches, 90% functions, 95% lines), add tests to cover the gaps. The new service and repository files must be covered.

**Step 3: Run e2e tests specifically**

Run: `make e2e`
Expected: All Playwright tests pass

**Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address coverage gaps and CI issues from layered architecture refactor"
```
