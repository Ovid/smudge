# Data Model Separation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor `packages/server/src/` from flat route-handler architecture into domain-based folders with routes/services/repositories layers, plus unit tests for all new code.

**Architecture:** Each domain (projects, chapters, velocity, settings, chapter-statuses) gets its own folder containing types, repository, service, and route files. Routes handle HTTP only, services own business logic and transactions, repositories encapsulate all Knex/SQL. Services import `db` from a singleton module with `setDb()` for test injection.

**Tech Stack:** TypeScript, Express, Knex.js, better-sqlite3, Vitest, Supertest

**Design doc:** `docs/plans/2026-04-05-data-model-separation-design.md`

**Alignment review:** 5 issues found and resolved — see Alignment Review Log at end of document.

---

## Task 1: Foundation — Update `db/connection.ts` with `setDb()`

**Requirement:** Design §Database Connection Management — services import `db` from singleton; `setDb()` for test injection.

### RED
- Existing `connection.test.ts` tests define expected behavior for `getDb()`, `initDb()`, `closeDb()`
- Write a new test: `setDb()` sets the database instance used by `getDb()`
- Expected failure: `setDb` is not exported from `connection.ts`

### GREEN

**Files:**
- Modify: `packages/server/src/db/connection.ts`
- Modify: `packages/server/src/__tests__/connection.test.ts`

Update `connection.ts`:

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

Add test to `connection.test.ts`:

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

Run: `npm test -w packages/server -- --run connection`
Expected: All tests pass including new `setDb()` test

### REFACTOR
- Check that `setDb` is only used in test code — no production code should call it except `initDb`

**Commit:**
```bash
git add packages/server/src/db/connection.ts packages/server/src/__tests__/connection.test.ts
git commit -m "feat: add setDb() to connection module for test injection and service imports"
```

---

## Task 2: Chapter Statuses Domain (simplest — proves the pattern)

**Requirement:** Design §Directory Structure, §Type Flow, §Repository Boundaries

### RED
- Existing `chapter-statuses.test.ts` (1 test) defines expected HTTP behavior
- The test must pass unchanged after extraction
- If it passes: the new domain folder, types, repository, service, and route are wired correctly

### GREEN

**Files:**
- Create: `packages/server/src/chapter-statuses/chapter-statuses.types.ts`
- Create: `packages/server/src/chapter-statuses/chapter-statuses.repository.ts`
- Create: `packages/server/src/chapter-statuses/chapter-statuses.service.ts`
- Create: `packages/server/src/chapter-statuses/chapter-statuses.routes.ts`
- Modify: `packages/server/src/app.ts` (swap import)
- Modify: `packages/server/src/__tests__/test-helpers.ts` (add `setDb`)

**Internal types:**

```typescript
// packages/server/src/chapter-statuses/chapter-statuses.types.ts
export interface ChapterStatusRow {
  status: string;
  sort_order: number;
  label: string;
}
```

**Repository:**

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

**Service:**

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

**Route:**

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

**Update `app.ts`** — change chapter-statuses import and mounting:

```typescript
// Change import:
import { chapterStatusesRouter } from "./chapter-statuses/chapter-statuses.routes";
// Change mounting:
app.use("/api/chapter-statuses", chapterStatusesRouter());
```

**Update `test-helpers.ts`** — add `setDb` call:

```typescript
import { setDb } from "../db/connection";
// In beforeAll, after creating testDb:
setDb(testDb);
```

Keep `createApp(testDb)` working for now — other routers still accept `db`.

Run: `npm test -w packages/server`
Expected: ALL existing tests pass (185+ tests)

### REFACTOR
- Verify no duplicate status-label logic remains — `status-labels.ts` will be removed later when old routes are deleted
- Check that the mapping function `toChapterStatus` is trivial here (1:1) — that's fine for this domain

**Commit:**
```bash
git add packages/server/src/chapter-statuses/ packages/server/src/app.ts packages/server/src/__tests__/test-helpers.ts
git commit -m "refactor: extract chapter-statuses domain (types, repository, service, routes)"
```

---

## Task 3: Settings Domain

**Requirement:** Design §Directory Structure, §Transaction Handling

### RED
- Existing `settings.test.ts` (8 tests) defines expected HTTP behavior
- Must pass unchanged after extraction

### GREEN

**Files:**
- Create: `packages/server/src/settings/settings.types.ts`
- Create: `packages/server/src/settings/settings.repository.ts`
- Create: `packages/server/src/settings/settings.service.ts`
- Create: `packages/server/src/settings/settings.routes.ts`
- Modify: `packages/server/src/app.ts`

**Internal types:**

```typescript
// packages/server/src/settings/settings.types.ts
export interface SettingRow {
  key: string;
  value: string;
}
```

**Repository:**

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

**Service:**

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

**Route:**

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

**Update `app.ts`:**

```typescript
import { settingsRouter } from "./settings/settings.routes";
app.use("/api/settings", settingsRouter());
```

Run: `npm test -w packages/server`
Expected: ALL existing tests pass

### REFACTOR
- Confirm SETTING_VALIDATORS is the only place setting validation lives (no duplication)

**Commit:**
```bash
git add packages/server/src/settings/ packages/server/src/app.ts
git commit -m "refactor: extract settings domain (types, repository, service, routes)"
```

---

## Task 4: Velocity Domain

Extract velocity before projects/chapters because it's self-contained and the other domains call into it for side effects.

**Requirement:** Design §Directory Structure, §Velocity Side Effects

### RED
- Existing `velocity.test.ts` (31 tests) and `velocityHelpers.test.ts` (5 tests) define expected behavior
- Must pass unchanged after extraction

### GREEN

**Files:**
- Create: `packages/server/src/velocity/velocity.types.ts`
- Create: `packages/server/src/velocity/velocity.repository.ts`
- Create: `packages/server/src/velocity/velocity.service.ts`
- Create: `packages/server/src/velocity/velocity.routes.ts`

**Internal types:**

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

**Repository:**

```typescript
// packages/server/src/velocity/velocity.repository.ts
import type { Knex } from "knex";
import { v4 as uuid } from "uuid";
import type { SaveEventRow } from "./velocity.types";

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
```

**Service** — contains pure business logic (`deriveSessions`, `calculateStreaks`, `calculateProjection`), timezone helpers, side-effect recording, and the velocity dashboard query.

Note: All cross-domain imports are static (alignment fix #4). Chapter queries use the chapters repository (alignment fix #1).

```typescript
// packages/server/src/velocity/velocity.service.ts
import type { VelocityResponse } from "@smudge/shared";
import { getDb } from "../db/connection";
import * as VelocityRepo from "./velocity.repository";
import * as SettingsRepo from "../settings/settings.repository";
import * as ChapterStatusRepo from "../chapter-statuses/chapter-statuses.repository";
import * as ChapterRepo from "../chapters/chapters.repository";
import * as ProjectRepo from "../projects/projects.repository";

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
    const totalWordCount = await ChapterRepo.sumWordCountByProject(db, projectId);
    await VelocityRepo.upsertDailySnapshot(db, projectId, today, totalWordCount);
  } catch (err) {
    console.error(`Failed to upsert daily snapshot for project=${projectId}:`, err);
  }
}

export async function updateDailySnapshot(projectId: string): Promise<void> {
  const db = getDb();
  const today = await getTodayDate();
  try {
    const totalWordCount = await ChapterRepo.sumWordCountByProject(db, projectId);
    await VelocityRepo.upsertDailySnapshot(db, projectId, today, totalWordCount);
  } catch (err) {
    console.error(`Failed to upsert daily snapshot for project=${projectId}:`, err);
  }
}

// --- Velocity dashboard query ---

export async function getVelocityBySlug(slug: string): Promise<VelocityResponse | null> {
  const db = getDb();

  const project = await ProjectRepo.findBySlug(db, slug);
  if (!project) return null;

  const projectId = project.id;
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
      db, projectId, chapterIdsInWindow, thirtyDaysAgoStr,
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

  // Current total (via chapters repository — alignment fix #1)
  const currentTotal = await ChapterRepo.sumWordCountByProject(db, projectId);

  const projection = calculateProjection(
    project.target_word_count ?? null,
    project.target_deadline ?? null,
    dailyAvg30d,
    currentTotal,
    today,
  );

  // Completion stats (via repositories — alignment fix #1)
  const chapters = await ChapterRepo.listIdTitleStatusByProject(db, projectId);
  let completedChapters = 0;
  const completionThreshold = project.completion_threshold ?? null;

  if (completionThreshold) {
    const thresholdRow = await ChapterStatusRepo.findByStatus(db, completionThreshold);
    const thresholdSortOrder = thresholdRow?.sort_order ?? 999;
    const allStatuses = await ChapterStatusRepo.list(db);
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

  // Chapter names (including deleted — via repository)
  const chapterNames = await ChapterRepo.getChapterNamesMap(db, projectId);

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

**Route** — no db access, just calls service (alignment fix #3):

```typescript
// packages/server/src/velocity/velocity.routes.ts
import { asyncHandler } from "../app";
import * as VelocityService from "./velocity.service";

export const velocityHandler = asyncHandler(async (req, res) => {
  const result = await VelocityService.getVelocityBySlug(req.params.slug);
  if (!result) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Project not found." },
    });
    return;
  }
  res.json(result);
});
```

Note: The velocity route is mounted by the projects router at `GET /:slug/velocity`. It's not a standalone router.

Run: `npm test -w packages/server`
Expected: ALL existing tests pass

### REFACTOR
- Verify no dynamic imports remain (alignment fix #4 — all imports are static)
- Verify no raw `db("table")` calls in service — all go through repos

**Commit:**
```bash
git add packages/server/src/velocity/
git commit -m "refactor: extract velocity domain (types, repository, service, routes)"
```

---

## Task 5: Projects + Chapters Domains (merged — they depend on each other)

These two domains are extracted together because the projects service imports `ChapterRepo` and the chapters service imports `ProjectRepo`. Creating them separately would produce intermediate states that don't compile.

**Requirement:** Design §Directory Structure, §Transaction Handling, §Cross-Domain Coordination, §Dashboard Aggregation, §Slug Resolution

### RED
- Existing tests: `projects.test.ts` (34), `chapters.test.ts` (36), `dashboard.test.ts` (6), `save-side-effects.test.ts` (4), `resolve-slug.test.ts` (7), `parseChapterContent.test.ts` (12)
- All must pass unchanged after extraction

### GREEN

**Order of creation:** Both repos first, then both services, then both routes.

#### Step 1: Create chapters internal types

```typescript
// packages/server/src/chapters/chapters.types.ts
export interface ChapterRow {
  id: string;
  project_id: string;
  title: string;
  content: Record<string, unknown> | null;
  content_corrupt?: boolean;
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

#### Step 2: Create chapters repository

Returns typed `ChapterRow` (alignment fix #2). All `Record<string, unknown>` from old code becomes `ChapterRow`. JSON parsing is internal.

```typescript
// packages/server/src/chapters/chapters.repository.ts
import type { Knex } from "knex";
import type { ChapterRow, CreateChapterRow } from "./chapters.types";

// --- Internal: JSON parsing (absorbed from parseChapterContent.ts) ---

function parseContent(row: Record<string, unknown>): ChapterRow {
  if (typeof row.content === "string") {
    try {
      return { ...row, content: JSON.parse(row.content) } as ChapterRow;
    } catch (err) {
      console.error(
        `[parseChapterContent] corrupt JSON in chapter ${row.id ?? "unknown"} (${err instanceof Error ? err.name : "UnknownError"})`,
      );
      return { ...row, content: null, content_corrupt: true } as ChapterRow;
    }
  }
  return { ...row, content: (row.content as Record<string, unknown>) ?? null } as ChapterRow;
}

// Exported for backward compat with existing parseChapterContent tests
export { parseContent as parseChapterContent };

// --- Public API ---

export async function findById(
  trx: Knex.Transaction | Knex,
  id: string,
): Promise<ChapterRow | null> {
  const row = await trx("chapters").where({ id }).whereNull("deleted_at").first();
  return row ? parseContent(row) : null;
}

export async function findDeletedById(
  trx: Knex.Transaction | Knex,
  id: string,
): Promise<ChapterRow | null> {
  const row = await trx("chapters").where({ id }).whereNotNull("deleted_at").first();
  return row ? (row as ChapterRow) : null;
}

export async function findByIdRaw(
  trx: Knex.Transaction | Knex,
  id: string,
): Promise<ChapterRow | null> {
  const row = await trx("chapters").where({ id }).whereNull("deleted_at").first();
  return row ? (row as ChapterRow) : null;
}

export async function listByProject(
  trx: Knex.Transaction | Knex,
  projectId: string,
): Promise<ChapterRow[]> {
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
): Promise<ChapterRow[]> {
  const rows = await trx("chapters")
    .where({ project_id: projectId })
    .whereNull("deleted_at")
    .orderBy("sort_order", "asc")
    .select("id", "title", "status", "word_count", "target_word_count", "updated_at", "sort_order");
  return rows as ChapterRow[];
}

export async function listDeletedByProject(
  trx: Knex.Transaction | Knex,
  projectId: string,
): Promise<ChapterRow[]> {
  const trashed = await trx("chapters")
    .where({ project_id: projectId })
    .whereNotNull("deleted_at")
    .orderBy("deleted_at", "desc")
    .select(
      "id", "project_id", "title", "status", "word_count",
      "sort_order", "deleted_at", "created_at", "updated_at",
    );
  return trashed.map((ch: Record<string, unknown>) => ({ ...ch, content: null } as ChapterRow));
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

// Used by velocity service for completion stats
export async function listIdTitleStatusByProject(
  trx: Knex.Transaction | Knex,
  projectId: string,
): Promise<Array<{ id: string; title: string; status: string }>> {
  return trx("chapters")
    .where({ project_id: projectId })
    .whereNull("deleted_at")
    .select("id", "title", "status");
}

// Used by velocity service for chapter names (including deleted)
export async function getChapterNamesMap(
  trx: Knex.Transaction | Knex,
  projectId: string,
): Promise<Record<string, string>> {
  const rows = await trx("chapters")
    .where({ project_id: projectId })
    .select("id", "title");
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.id] = row.title;
  }
  return map;
}

// Used by velocity service for daily snapshot word count
export async function sumWordCountByProject(
  trx: Knex.Transaction | Knex,
  projectId: string,
): Promise<number> {
  const result = await trx("chapters")
    .where({ project_id: projectId })
    .whereNull("deleted_at")
    .sum("word_count as total");
  return Number(result[0]?.total) || 0;
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

export async function update(
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

#### Step 3: Create projects internal types

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

#### Step 4: Create projects repository

Includes `resolveUniqueSlug` (design §Slug Resolution) and `updateTimestamp` (alignment fix #1).

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
  data: Record<string, unknown>,
): Promise<ProjectRow> {
  await trx("projects").where({ id }).update(data);
  return trx("projects").where({ id }).first();
}

// Common pattern: touch updated_at on a project (alignment fix #1)
export async function updateTimestamp(
  trx: Knex.Transaction,
  id: string,
): Promise<void> {
  await trx("projects").where({ id }).update({ updated_at: new Date().toISOString() });
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

#### Step 5: Create projects service

All data access goes through repos — no raw `trx("table")` calls (alignment fix #1).

```typescript
// packages/server/src/projects/projects.service.ts
import { v4 as uuid } from "uuid";
import type { Project, ProjectListItem, ProjectWithChapters, Chapter } from "@smudge/shared";
import { generateSlug, UNTITLED_CHAPTER } from "@smudge/shared";
import { getDb } from "../db/connection";
import * as ProjectRepo from "./projects.repository";
import * as ChapterRepo from "../chapters/chapters.repository";
import * as ChapterStatusRepo from "../chapter-statuses/chapter-statuses.repository";
import * as VelocityService from "../velocity/velocity.service";
import type { ProjectRow, ProjectListRow } from "./projects.types";
import type { ChapterRow } from "../chapters/chapters.types";

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

function toChapter(row: ChapterRow): Chapter {
  return {
    id: row.id,
    project_id: row.project_id,
    title: row.title,
    content: row.content,
    sort_order: row.sort_order,
    word_count: row.word_count,
    target_word_count: row.target_word_count,
    status: row.status,
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

export async function createProject(title: string, mode: string): Promise<Project> {
  const db = getDb();

  const existing = await ProjectRepo.findByTitle(db, title);
  if (existing) throw new ProjectTitleExistsError();

  const projectId = uuid();
  const chapterId = uuid();
  const now = new Date().toISOString();

  try {
    await db.transaction(async (trx) => {
      const slug = await ProjectRepo.resolveUniqueSlug(trx, generateSlug(title));
      await ProjectRepo.insert(trx, {
        id: projectId, title, slug, mode, created_at: now, updated_at: now,
      });
      await ChapterRepo.insert(trx, {
        id: chapterId, project_id: projectId, title: UNTITLED_CHAPTER,
        content: null, sort_order: 0, word_count: 0, created_at: now, updated_at: now,
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

  const chaptersWithLabels = chapters.map((ch) => {
    const mapped = toChapter(ch);
    const { content_corrupt: _, ...clean } = ch;
    return {
      ...mapped,
      ...(!ch.content_corrupt ? {} : {}),
      status_label: statusLabelMap[ch.status] ?? ch.status,
    };
  });

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
          trx, generateSlug(data.title), project.id,
        );
        updates.title = data.title;
        updates.slug = newSlug;
      }
      await ProjectRepo.update(trx, project.id, updates);
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

export async function createChapter(slug: string): Promise<(Chapter & { status_label: string }) | null> {
  const db = getDb();
  const project = await ProjectRepo.findBySlug(db, slug);
  if (!project) return null;

  const chapterId = uuid();
  const now = new Date().toISOString();

  await db.transaction(async (trx) => {
    const maxOrder = await ChapterRepo.getMaxSortOrder(trx, project.id);
    await ChapterRepo.insert(trx, {
      id: chapterId, project_id: project.id, title: UNTITLED_CHAPTER,
      content: null, sort_order: (maxOrder ?? -1) + 1, word_count: 0,
      created_at: now, updated_at: now,
    });
    await ProjectRepo.updateTimestamp(trx, project.id);
  });

  const chapter = await ChapterRepo.findById(db, chapterId);
  if (!chapter) return null;
  const statusLabelMap = await ChapterStatusRepo.getStatusLabelMap(db);
  return {
    ...toChapter(chapter),
    status_label: statusLabelMap[chapter.status] ?? chapter.status,
  };
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
    await ProjectRepo.updateTimestamp(trx, project.id);
  });

  return {};
}

export async function getDashboard(slug: string): Promise<Record<string, unknown> | null> {
  const db = getDb();
  const project = await ProjectRepo.findBySlug(db, slug);
  if (!project) return null;

  const chapters = await ChapterRepo.listMetadataByProject(db, project.id);
  const statusLabelMap = await ChapterStatusRepo.getStatusLabelMap(db);

  const chaptersWithLabels = chapters.map((ch) => ({
    ...ch,
    status_label: statusLabelMap[ch.status] ?? ch.status,
  }));

  const allStatuses = await ChapterStatusRepo.list(db);
  const statusSummary: Record<string, number> = {};
  for (const s of allStatuses) {
    statusSummary[s.status] = 0;
  }
  for (const ch of chapters) {
    if (ch.status in statusSummary) {
      statusSummary[ch.status] = (statusSummary[ch.status] ?? 0) + 1;
    }
  }

  const totalWordCount = chapters.reduce((sum, ch) => sum + ch.word_count, 0);
  const updatedAts = chapters.map((ch) => ch.updated_at);
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

export async function getTrash(slug: string): Promise<ChapterRow[] | null> {
  const db = getDb();
  const project = await ProjectRepo.findBySlug(db, slug);
  if (!project) return null;
  return ChapterRepo.listDeletedByProject(db, project.id);
}

export class ProjectTitleExistsError extends Error {
  constructor() {
    super("A project with that title already exists");
    this.name = "ProjectTitleExistsError";
  }
}
```

#### Step 6: Create chapters service

All data access through repos — no raw table queries (alignment fix #1).

```typescript
// packages/server/src/chapters/chapters.service.ts
import type { Chapter } from "@smudge/shared";
import { countWords, generateSlug } from "@smudge/shared";
import { getDb } from "../db/connection";
import * as ChapterRepo from "./chapters.repository";
import * as ProjectRepo from "../projects/projects.repository";
import * as ChapterStatusRepo from "../chapter-statuses/chapter-statuses.repository";
import * as VelocityService from "../velocity/velocity.service";
import type { ChapterRow } from "./chapters.types";

// Injectable velocity service for testing failure paths (design §Velocity failure path exception)
let velocityServiceImpl: typeof VelocityService = VelocityService;

export function setVelocityService(impl: typeof VelocityService): void {
  velocityServiceImpl = impl;
}

export function resetVelocityService(): void {
  velocityServiceImpl = VelocityService;
}

function toChapter(row: ChapterRow): Chapter {
  return {
    id: row.id,
    project_id: row.project_id,
    title: row.title,
    content: row.content,
    sort_order: row.sort_order,
    word_count: row.word_count,
    target_word_count: row.target_word_count,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  };
}

export function isCorruptChapter(chapter: ChapterRow): boolean {
  return chapter.content_corrupt === true;
}

export function stripCorruptFlag(chapter: ChapterRow): Omit<ChapterRow, "content_corrupt"> {
  const { content_corrupt: _, ...rest } = chapter;
  return rest;
}

export async function getChapter(id: string): Promise<(Chapter & { status_label: string; content_corrupt?: boolean }) | null> {
  const db = getDb();
  const chapter = await ChapterRepo.findById(db, id);
  if (!chapter) return null;
  const statusLabel = await ChapterStatusRepo.getStatusLabel(db, chapter.status);
  return { ...toChapter(chapter), content_corrupt: chapter.content_corrupt, status_label: statusLabel };
}

export async function updateChapter(
  id: string,
  data: {
    title?: string;
    content?: Record<string, unknown>;
    status?: string;
    target_word_count?: number | null;
  },
): Promise<{ chapter: (Chapter & { status_label: string }) | null; error?: { code: string; message: string } }> {
  const db = getDb();

  const chapter = await ChapterRepo.findByIdRaw(db, id);
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
    await ChapterRepo.update(trx, id, updates);
    await ProjectRepo.updateTimestamp(trx, chapter.project_id);
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

  const statusLabel = await ChapterStatusRepo.getStatusLabel(db, updated.status);
  return { chapter: { ...toChapter(updated), status_label: statusLabel } };
}

export async function deleteChapter(id: string): Promise<boolean> {
  const db = getDb();
  const chapter = await ChapterRepo.findByIdRaw(db, id);
  if (!chapter) return false;

  const now = new Date().toISOString();
  await db.transaction(async (trx) => {
    await ChapterRepo.softDelete(trx, id, now);
    await ProjectRepo.updateTimestamp(trx, chapter.project_id);
  });

  await velocityServiceImpl.updateDailySnapshot(chapter.project_id);
  return true;
}

export async function restoreChapter(
  id: string,
): Promise<{ chapter: (Chapter & { status_label: string; project_slug?: string }) | null; error?: { code: string; message: string }; status?: number }> {
  const db = getDb();
  const chapter = await ChapterRepo.findDeletedById(db, id);
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
          trx, generateSlug(parentProject.title), parentProject.id,
        );
        await ProjectRepo.update(trx, chapter.project_id, {
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
  const statusLabel = await ChapterStatusRepo.getStatusLabel(db, restored.status);
  return {
    chapter: {
      ...toChapter(restored),
      status_label: statusLabel,
      project_slug: updatedProject?.slug,
    },
  };
}
```

#### Step 7: Create projects route

```typescript
// packages/server/src/projects/projects.routes.ts
import { Router } from "express";
import { CreateProjectSchema, UpdateProjectSchema, ReorderChaptersSchema } from "@smudge/shared";
import { asyncHandler } from "../app";
import * as ProjectService from "./projects.service";
import { velocityHandler } from "../velocity/velocity.routes";

export function projectsRouter(): Router {
  const router = Router();

  router.post("/", asyncHandler(async (req, res) => {
    const parsed = CreateProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      return;
    }
    try {
      const project = await ProjectService.createProject(parsed.data.title, parsed.data.mode);
      res.status(201).json(project);
    } catch (err) {
      if (err instanceof ProjectService.ProjectTitleExistsError) {
        res.status(400).json({ error: { code: "PROJECT_TITLE_EXISTS", message: "A project with that title already exists" } });
        return;
      }
      throw err;
    }
  }));

  router.get("/", asyncHandler(async (_req, res) => {
    const projects = await ProjectService.listProjects();
    res.json(projects);
  }));

  router.patch("/:slug", asyncHandler(async (req, res) => {
    const parsed = UpdateProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      return;
    }
    try {
      const project = await ProjectService.updateProject(req.params.slug, parsed.data);
      if (!project) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found." } }); return; }
      res.json(project);
    } catch (err) {
      if (err instanceof ProjectService.ProjectTitleExistsError) {
        res.status(400).json({ error: { code: "PROJECT_TITLE_EXISTS", message: "A project with that title already exists" } });
        return;
      }
      throw err;
    }
  }));

  router.get("/:slug/velocity", velocityHandler);

  router.get("/:slug", asyncHandler(async (req, res) => {
    const project = await ProjectService.getProject(req.params.slug);
    if (!project) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found." } }); return; }
    res.json(project);
  }));

  router.post("/:slug/chapters", asyncHandler(async (req, res) => {
    const chapter = await ProjectService.createChapter(req.params.slug);
    if (!chapter) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found." } }); return; }
    res.status(201).json(chapter);
  }));

  router.put("/:slug/chapters/order", asyncHandler(async (req, res) => {
    const parsed = ReorderChaptersSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "chapter_ids must be an array of UUIDs." } });
      return;
    }
    const result = await ProjectService.reorderChapters(req.params.slug, parsed.data.chapter_ids);
    if (!result) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found." } }); return; }
    if (result.error) { res.status(400).json({ error: result.error }); return; }
    res.json({ message: "Chapter order updated." });
  }));

  router.get("/:slug/dashboard", asyncHandler(async (req, res) => {
    const dashboard = await ProjectService.getDashboard(req.params.slug);
    if (!dashboard) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found." } }); return; }
    res.json(dashboard);
  }));

  router.get("/:slug/trash", asyncHandler(async (req, res) => {
    const trashed = await ProjectService.getTrash(req.params.slug);
    if (!trashed) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found." } }); return; }
    res.json(trashed);
  }));

  router.delete("/:slug", asyncHandler(async (req, res) => {
    const deleted = await ProjectService.deleteProject(req.params.slug);
    if (!deleted) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found." } }); return; }
    res.json({ message: "Project moved to trash." });
  }));

  return router;
}
```

#### Step 8: Create chapters route

```typescript
// packages/server/src/chapters/chapters.routes.ts
import { Router } from "express";
import { UpdateChapterSchema } from "@smudge/shared";
import { asyncHandler } from "../app";
import * as ChapterService from "./chapters.service";

export function chaptersRouter(): Router {
  const router = Router();

  router.get("/:id", asyncHandler(async (req, res) => {
    const chapter = await ChapterService.getChapter(req.params.id);
    if (!chapter) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Chapter not found." } }); return; }
    if (chapter.content_corrupt) {
      res.status(500).json({ error: { code: "CORRUPT_CONTENT", message: "Chapter content is corrupted and cannot be loaded." } });
      return;
    }
    res.json(chapter);
  }));

  router.patch("/:id", asyncHandler(async (req, res) => {
    const parsed = UpdateChapterSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      return;
    }
    const result = await ChapterService.updateChapter(req.params.id, parsed.data);
    if (result.error) {
      const status = result.error.code === "CORRUPT_CONTENT" ? 500 : 400;
      res.status(status).json({ error: result.error });
      return;
    }
    if (!result.chapter) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Chapter not found." } }); return; }
    res.json(result.chapter);
  }));

  router.delete("/:id", asyncHandler(async (req, res) => {
    const deleted = await ChapterService.deleteChapter(req.params.id);
    if (!deleted) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Chapter not found." } }); return; }
    res.json({ message: "Chapter moved to trash." });
  }));

  router.post("/:id/restore", asyncHandler(async (req, res) => {
    const result = await ChapterService.restoreChapter(req.params.id);
    if (result.error) { res.status(result.status ?? 500).json({ error: result.error }); return; }
    if (!result.chapter) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Chapter not found." } }); return; }
    res.json(result.chapter);
  }));

  return router;
}
```

#### Step 9: Update `app.ts` — final version

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

#### Step 10: Update `index.ts`

Change `createApp(db)` to `createApp()`.

#### Step 11: Update `test-helpers.ts` — final version

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
    get db() { return testDb; },
    get app() { return testServer; },
  };
}
```

#### Step 12: Update existing test imports

- `resolve-slug.test.ts` — import `resolveUniqueSlug` from `../projects/projects.repository`
- `parseChapterContent.test.ts` — import `parseChapterContent` from `../chapters/chapters.repository`
- `velocityHelpers.test.ts` — import `calculateProjection`, `safeTimezone` from `../velocity/velocity.service`

#### Step 13: Delete old route files

```bash
rm -r packages/server/src/routes
```

#### Step 14: Run full test suite

Run: `npm test -w packages/server`
Expected: ALL existing tests pass (185+ tests)

### REFACTOR
- Grep for any remaining `trx("projects")` or `trx("chapters")` or `db("projects")` or `db("chapters")` in service files — there should be zero (alignment fix #1)
- Grep for `Record<string, unknown>` returns in repository files — chapter repo should return `ChapterRow` (alignment fix #2)
- Grep for `getDb()` in route files — there should be zero (alignment fix #3)
- Grep for dynamic `import(` in service files — there should be zero (alignment fix #4)

**Commit:**
```bash
git add -A
git commit -m "refactor: extract projects and chapters domains, complete layered architecture

All five domains (chapter-statuses, settings, velocity, projects, chapters)
now follow the types/repository/service/routes pattern. Old routes/ directory
removed. No service code touches tables directly — all via repositories.
app.ts no longer passes db to routers."
```

---

## Task 6: Unit Tests — Repositories

**Requirement:** Design §Testing — new repository tests against real SQLite

### RED
- Write tests for each repository function
- Expected failure: none (repos already work) — these tests verify the extraction is correct

### GREEN

**Files:**
- Create: `packages/server/src/__tests__/chapter-statuses.repository.test.ts`
- Create: `packages/server/src/__tests__/settings.repository.test.ts`
- Create: `packages/server/src/__tests__/projects.repository.test.ts`
- Create: `packages/server/src/__tests__/chapters.repository.test.ts`
- Create: `packages/server/src/__tests__/velocity.repository.test.ts`

Write tests covering: list, find, insert, update, soft-delete, restore for each repo. Use `setupTestDb()` for real SQLite. See the design doc for the full list of repository functions per domain.

Key tests per repo:
- **chapter-statuses:** `list()` returns 5 statuses, `findByStatus()` finds/misses, `getStatusLabelMap()` complete
- **settings:** `listAll()` empty, `upsert()` insert + update, `findByKey()` found/missing
- **projects:** `insert()` + `findById()` round-trip, `findBySlug()` excludes deleted, `findByTitle()` with/without exclude, `resolveUniqueSlug()` base/collision, `listAll()` with word counts, `updateTimestamp()`
- **chapters:** `insert()` + `findById()` round-trip, JSON parsing, corrupt detection, `listByProject()` sort order, `softDelete()` + `findById()` exclusion, `listDeletedByProject()`, `getMaxSortOrder()`, `sumWordCountByProject()`, `getChapterNamesMap()`
- **velocity:** `insertSaveEvent()`, `upsertDailySnapshot()` create/update, `getRecentSaveEvents()` filtering, `getWritingDates()`

Run: `npm test -w packages/server`
Expected: All tests pass

### REFACTOR
- Check for duplicate test setup patterns — extract shared helpers if needed

**Commit:**
```bash
git add packages/server/src/__tests__/*repository*
git commit -m "test: add unit tests for all repository modules"
```

---

## Task 7: Unit Tests — Services

**Requirement:** Design §Testing, §Velocity failure path exception

### RED
- Write tests for service-layer business logic, mapping, and the velocity injection path
- The velocity injection test should verify: chapter save succeeds even when `recordSave` throws

### GREEN

**Files:**
- Create: `packages/server/src/__tests__/chapters.service.test.ts`
- Create: `packages/server/src/__tests__/projects.service.test.ts`
- Create: `packages/server/src/__tests__/settings.service.test.ts`

Key tests:
- **chapters.service:** `updateChapter()` succeeds when velocity throws, `deleteChapter()` succeeds when velocity throws, `isCorruptChapter()` detection, `stripCorruptFlag()` removal
- **projects.service:** `createProject()` throws `ProjectTitleExistsError` on duplicate, auto-creates first chapter, `getProject()` null for missing slug, includes status labels, `deleteProject()` soft-deletes both
- **settings.service:** `getAll()` empty, `update()` saves valid, rejects unknown, rejects invalid timezone

Run: `npm test -w packages/server`
Expected: All tests pass

### REFACTOR
- Ensure `resetVelocityService()` is called in `afterEach` for chapters service tests

**Commit:**
```bash
git add packages/server/src/__tests__/*service*
git commit -m "test: add unit tests for service modules including velocity injection"
```

---

## Task 8: Final Verification

**Requirement:** All existing behavior preserved, coverage thresholds met

### RED
Run: `make all`
Note any failures — lint, format, typecheck, coverage, e2e

### GREEN
Fix all failures. Common issues:
- Coverage drops below thresholds (95/85/90/95) — add tests for uncovered new code
- TypeScript errors from type mismatches between old test expectations and new typed returns
- Lint errors from unused imports in migrated test files
- Format issues from new files

### REFACTOR
- Remove any dead code flagged by TypeScript or lint
- Verify no `packages/server/src/routes/` directory remains

Run: `make all`
Expected: Full pass — lint, format, typecheck, coverage, e2e

**Commit:**
```bash
git add -A
git commit -m "fix: address coverage gaps and CI issues from layered architecture refactor"
```

---

## Alignment Review Log

Reviewed 2026-04-05 against design doc `2026-04-05-data-model-separation-design.md`.

| # | Issue | Severity | Resolution |
|---|-------|----------|-----------|
| 1 | Services bypassed repos with raw `trx("table")` calls | Critical | Added `ProjectRepo.updateTimestamp()`, `ChapterRepo.sumWordCountByProject()`, `ChapterRepo.listIdTitleStatusByProject()`, `ChapterRepo.getChapterNamesMap()`, `ChapterRepo.findByIdRaw()`, `ChapterRepo.findDeletedById()`. All service code uses repos exclusively. |
| 2 | Chapters repo returned `Record<string, unknown>` not `ChapterRow` | Important | Repo now returns typed `ChapterRow` with `content_corrupt?: boolean`. Service maps to shared `Chapter` type. |
| 3 | Velocity route accessed `getDb()` directly | Important | Added `VelocityService.getVelocityBySlug()`. Route handler calls service only — no db access. |
| 4 | Dynamic imports in velocity service | Minor | Replaced with static imports for `ChapterStatusRepo`, `ChapterRepo`, `ProjectRepo`. |
| 5 | Circular dependency between Tasks 5 and 6 | Minor | Merged into single Task 5: both repos created first, then both services, then both routes. |
