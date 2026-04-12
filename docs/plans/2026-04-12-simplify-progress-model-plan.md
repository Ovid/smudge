# Simplify Progress Model — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Strip the velocity system from a save-event analytics pipeline down to a lightweight "am I on track?" indicator — daily snapshots, rolling averages, projected completion, and a simple progress strip UI.

**Architecture:** Drop `save_events` table, `completion_threshold` column, and `chapters.target_word_count` column via migration 010. Gut the velocity service/repository to compute only from `daily_snapshots`. Replace the client's velocity tab + charts with an inline ProgressStrip component on the dashboard.

**Tech Stack:** TypeScript, Knex migrations, Vitest, React, Tailwind CSS, Playwright

**Design doc:** `docs/plans/2026-04-11-simplify-progress-model-design.md`

---

### Task 1: Database Migration

**Requirement:** Design §Database Migration — drop save_events table, completion_threshold column, chapters.target_word_count column

**Files:**
- Create: `packages/server/src/db/migrations/010_simplify_progress_model.js`
- Test: `packages/server/src/__tests__/migration-010.test.ts`

#### RED

Write a migration test. Follow the patterns in `packages/server/src/__tests__/migration-004.test.ts` for db setup/teardown.

Create `packages/server/src/__tests__/migration-010.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import knex from "knex";

describe("migration 010 — simplify progress model", () => {
  let db: ReturnType<typeof knex>;

  beforeAll(async () => {
    db = knex({
      client: "better-sqlite3",
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
    });
    // Run all migrations up to 009
    await db.migrate.latest({
      directory: "src/db/migrations",
      loadExtensions: [".js"],
    });
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("save_events table no longer exists after migration", async () => {
    // Verify it exists before (sanity check)
    const before = await db.raw(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='save_events'",
    );
    expect(before).toHaveLength(1);

    // Run migration 010
    await db.migrate.latest({
      directory: "src/db/migrations",
      loadExtensions: [".js"],
    });

    const after = await db.raw(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='save_events'",
    );
    expect(after).toHaveLength(0);
  });

  it("projects table no longer has completion_threshold column", async () => {
    const cols = await db.raw("PRAGMA table_info(projects)");
    const colNames = cols.map((c: { name: string }) => c.name);
    expect(colNames).not.toContain("completion_threshold");
  });

  it("chapters table no longer has target_word_count column", async () => {
    const cols = await db.raw("PRAGMA table_info(chapters)");
    const colNames = cols.map((c: { name: string }) => c.name);
    expect(colNames).not.toContain("target_word_count");
  });

  it("daily_snapshots table still exists", async () => {
    const result = await db.raw(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='daily_snapshots'",
    );
    expect(result).toHaveLength(1);
  });

  it("settings table still exists", async () => {
    const result = await db.raw(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='settings'",
    );
    expect(result).toHaveLength(1);
  });
});
```

Run: `npm test -w packages/server -- --reporter=verbose --run migration-010`
Expected failure: migration file doesn't exist yet.

#### GREEN

Create `packages/server/src/db/migrations/010_simplify_progress_model.js`:

```javascript
/** @param {import('knex').Knex} knex */
export async function up(knex) {
  // 1. Drop save_events table
  await knex.schema.dropTableIfExists("save_events");

  // 2. Drop completion_threshold from projects
  await knex.schema.alterTable("projects", (table) => {
    table.dropColumn("completion_threshold");
  });

  // 3. Drop target_word_count from chapters
  await knex.schema.alterTable("chapters", (table) => {
    table.dropColumn("target_word_count");
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  // Re-add completion_threshold to projects
  await knex.schema.alterTable("projects", (table) => {
    table.text("completion_threshold").notNullable().defaultTo("final");
  });

  // Re-add target_word_count to chapters
  await knex.schema.alterTable("chapters", (table) => {
    table.integer("target_word_count").nullable().defaultTo(null);
  });

  // Re-create save_events table (structure from migration 004 + 006 + 007 + 009)
  await knex.schema.createTable("save_events", (table) => {
    table.uuid("id").primary();
    table.uuid("chapter_id").nullable().references("id").inTable("chapters").onDelete("SET NULL");
    table.uuid("project_id").notNullable().references("id").inTable("projects").onDelete("CASCADE");
    table.integer("word_count").notNullable();
    table.text("saved_at").notNullable();
    table.text("save_date").notNullable();
    table.index(["project_id", "saved_at"]);
    table.index(["project_id", "save_date"]);
  });
}
```

Run: `npm test -w packages/server -- --reporter=verbose --run migration-010`
Expected: PASS

#### REFACTOR

- Verify the `down` migration recreates the table with the same column types and constraints as the original (check migration 004 + 006 + 007 + 009).
- No other refactoring expected for a migration.

**Commit:**
```bash
git add packages/server/src/db/migrations/010_simplify_progress_model.js packages/server/src/__tests__/migration-010.test.ts
git commit -m "feat: add migration 010 — drop save_events, completion_threshold, chapter target_word_count"
```

---

### Task 2: Simplify Shared Types and Schemas

**Requirement:** Design §API Changes (new VelocityResponse), §Shared types (remove CompletionThreshold, chapter target_word_count, calculateWordsToday)

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/__tests__/schemas.test.ts`

#### RED

Update `packages/shared/src/__tests__/schemas.test.ts`:
- Remove the `completion_threshold` acceptance and rejection tests (lines ~158-165)
- Remove any `target_word_count` tests for `UpdateChapterSchema` if they exist
- Remove any `calculateWordsToday` tests if they exist in this file

Run: `npm test -w packages/shared -- --run`
Expected failure: tests reference types/functions that still exist (tests may pass since we're removing test cases, not adding new ones — but compilation will fail once we modify the source in GREEN).

If tests pass unexpectedly: that's fine — we're removing tests, not adding failing ones. Proceed to GREEN.

#### GREEN

1. **`packages/shared/src/types.ts`:**
   - Replace the `VelocityResponse` interface (lines 63-87) with:
     ```typescript
     export interface VelocityResponse {
       words_today: number;
       daily_average_7d: number | null;
       daily_average_30d: number | null;
       current_total: number;
       target_word_count: number | null;
       remaining_words: number | null;
       target_deadline: string | null;
       days_until_deadline: number | null;
       required_pace: number | null;
       projected_completion_date: string | null;
       today: string;
     }
     ```
   - Remove `completion_threshold` from the `Project` interface (line 14)
   - Remove `target_word_count` from the `Chapter` interface (line 27)
   - Remove the `CompletionThresholdValue` type export (line 5)
   - Remove the `CompletionThreshold` import from `"./schemas"` (line 2)

2. **`packages/shared/src/schemas.ts`:**
   - Remove the `CompletionThreshold` enum (line 12)
   - Remove `completion_threshold` from `UpdateProjectSchema` (line 32)
   - Remove `target_word_count` from `UpdateChapterSchema` (line 55)
   - Remove the `calculateWordsToday` function (lines 73-90)

3. **`packages/shared/src/index.ts`:**
   - Remove `CompletionThreshold` and `calculateWordsToday` from schema exports
   - Remove `CompletionThresholdValue` from type exports

Run: `npm test -w packages/shared -- --run`
Expected: PASS

#### REFACTOR

- Check that no dead imports remain in `types.ts` (the `CompletionThreshold` import should be gone)
- Verify `index.ts` exports are clean — no dangling re-exports

**Commit:**
```bash
git add packages/shared/
git commit -m "feat: simplify shared types — new VelocityResponse, remove completion_threshold and chapter targets"
```

---

### Task 3: Simplify Server Velocity Repository

**Requirement:** Design §velocity.repository.ts — remove save_event/streak queries, replace getDailySnapshots with purpose-specific queries

**Files:**
- Modify: `packages/server/src/velocity/velocity.repository.ts`
- Modify: `packages/server/src/velocity/velocity.types.ts`

#### RED

No separate test for this task — the repository is tested through the service integration tests (Task 6). The change itself is a simplification that will temporarily break the service (fixed in Task 4).

If you want a safety check: run `npm test -w packages/server -- --run` and confirm it fails with import/reference errors after this change. That confirms the old code is gone.

#### GREEN

1. **Rewrite `velocity.types.ts`** — remove `SaveEventRow`, keep only `DailySnapshotRow`:

```typescript
export interface DailySnapshotRow {
  id: string;
  project_id: string;
  date: string;
  total_word_count: number;
  created_at: string;
}
```

2. **Rewrite `velocity.repository.ts`** — remove `insertSaveEvent`, `getRecentSaveEvents`, `getPreWindowBaselines`, `getWritingDates`. Keep `upsertDailySnapshot`. Add `getBaselineSnapshot` and `getLastPriorDaySnapshot`:

```typescript
import type { Knex } from "knex";
import { v4 as uuid } from "uuid";

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

/**
 * Fetch the nearest snapshot on or before `targetDate` for a project.
 * Used as a baseline for rolling average calculations.
 */
export async function getBaselineSnapshot(
  db: Knex.Transaction | Knex,
  projectId: string,
  targetDate: string,
): Promise<{ date: string; total_word_count: number } | undefined> {
  return db("daily_snapshots")
    .where({ project_id: projectId })
    .where("date", "<=", targetDate)
    .orderBy("date", "desc")
    .first("date", "total_word_count");
}

/**
 * Fetch the most recent snapshot strictly before `today` for words-today calculation.
 */
export async function getLastPriorDaySnapshot(
  db: Knex.Transaction | Knex,
  projectId: string,
  today: string,
): Promise<{ date: string; total_word_count: number } | undefined> {
  return db("daily_snapshots")
    .where({ project_id: projectId })
    .where("date", "<", today)
    .orderBy("date", "desc")
    .first("date", "total_word_count");
}
```

Run: `npm test -w packages/server -- --run`
Expected: FAIL — velocity.service.ts still references removed functions. Fixed in Task 4.

#### REFACTOR

Nothing to refactor — this is already minimal.

**Commit:**
```bash
git add packages/server/src/velocity/velocity.repository.ts packages/server/src/velocity/velocity.types.ts
git commit -m "feat: simplify velocity repository — remove save_event and streak queries"
```

---

### Task 4: Simplify Server Velocity Service

**Requirement:** Design §velocity.service.ts — remove deriveSessions, calculateStreaks, completion tracking; simplify recordSave and getVelocityBySlug

**Files:**
- Modify: `packages/server/src/velocity/velocity.service.ts`

Note: `velocity.injectable.ts` needs no changes — it only exposes `recordSave` and `updateDailySnapshot`, whose signatures are unchanged.

#### RED

The service rewrite is verified by Task 6's tests. At this stage, confirm the service compiles and the server starts. The old tests will still fail (they reference removed features).

#### GREEN

Rewrite `velocity.service.ts`. Remove `deriveSessions`, `calculateStreaks`, `calculateProjection`, all session/streak/completion logic, and the `insertSaveEvent` call. Remove imports for `ChapterStatusRepo`.

```typescript
import type { VelocityResponse } from "@smudge/shared";
import { getDb } from "../db/connection";
import * as VelocityRepo from "./velocity.repository";
import * as SettingsRepo from "../settings/settings.repository";
import * as ChapterRepo from "../chapters/chapters.repository";
import * as ProjectRepo from "../projects/projects.repository";
import { safeTimezone } from "../timezone";

// --- Timezone helper ---

export { safeTimezone };

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
  _chapterId: string,
  _wordCount: number,
): Promise<void> {
  try {
    const db = getDb();
    const today = await getTodayDate();
    try {
      const totalWordCount = await ChapterRepo.sumWordCountByProject(db, projectId);
      await VelocityRepo.upsertDailySnapshot(db, projectId, today, totalWordCount);
    } catch (err) {
      console.error(`Failed to upsert daily snapshot for project=${projectId}:`, err);
    }
  } catch (err) {
    console.error(`Velocity recordSave failed for project=${projectId}:`, err);
  }
}

export async function updateDailySnapshot(projectId: string): Promise<void> {
  try {
    const db = getDb();
    const today = await getTodayDate();
    try {
      const totalWordCount = await ChapterRepo.sumWordCountByProject(db, projectId);
      await VelocityRepo.upsertDailySnapshot(db, projectId, today, totalWordCount);
    } catch (err) {
      console.error(`Failed to upsert daily snapshot for project=${projectId}:`, err);
    }
  } catch (err) {
    console.error(`Velocity updateDailySnapshot failed for project=${projectId}:`, err);
  }
}

// --- Velocity query ---

function daysAgoDate(today: string, days: number): string {
  const d = new Date(today + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function computeRollingAverage(
  currentTotal: number,
  baseline: { date: string; total_word_count: number } | undefined,
  today: string,
): number | null {
  if (!baseline) return null;
  const msPerDay = 86_400_000;
  const actualDays = Math.max(
    1,
    Math.round(
      (new Date(today + "T00:00:00Z").getTime() -
        new Date(baseline.date + "T00:00:00Z").getTime()) /
        msPerDay,
    ),
  );
  const diff = currentTotal - baseline.total_word_count;
  if (diff <= 0) return 0;
  return Math.round(diff / actualDays);
}

export async function getVelocityBySlug(slug: string): Promise<VelocityResponse | null> {
  const db = getDb();

  const project = await ProjectRepo.findBySlug(db, slug);
  if (!project) return null;

  const projectId = project.id;
  const today = await getTodayDate();
  const currentTotal = await ChapterRepo.sumWordCountByProject(db, projectId);

  // Words today: current total minus last prior-day snapshot
  const lastPrior = await VelocityRepo.getLastPriorDaySnapshot(db, projectId, today);
  const wordsToday = lastPrior ? currentTotal - lastPrior.total_word_count : currentTotal;

  // Rolling averages: find baseline snapshot on or before N days ago
  const baseline7d = await VelocityRepo.getBaselineSnapshot(
    db,
    projectId,
    daysAgoDate(today, 7),
  );
  const baseline30d = await VelocityRepo.getBaselineSnapshot(
    db,
    projectId,
    daysAgoDate(today, 30),
  );

  const dailyAverage7d = computeRollingAverage(currentTotal, baseline7d, today);
  const dailyAverage30d = computeRollingAverage(currentTotal, baseline30d, today);

  // Projection
  const targetWordCount = project.target_word_count ?? null;
  const targetDeadline = project.target_deadline ?? null;
  const remainingWords = targetWordCount !== null ? Math.max(0, targetWordCount - currentTotal) : null;

  let daysUntilDeadline: number | null = null;
  if (targetDeadline) {
    const msPerDay = 86_400_000;
    daysUntilDeadline = Math.max(
      0,
      Math.round(
        (new Date(targetDeadline + "T00:00:00Z").getTime() -
          new Date(today + "T00:00:00Z").getTime()) /
          msPerDay,
      ),
    );
  }

  let requiredPace: number | null = null;
  if (remainingWords !== null && daysUntilDeadline !== null && daysUntilDeadline > 0) {
    requiredPace = Math.ceil(remainingWords / daysUntilDeadline);
  }

  // Use 30d average, fall back to 7d
  const bestAvg = dailyAverage30d ?? dailyAverage7d;
  let projectedCompletionDate: string | null = null;
  if (remainingWords !== null && remainingWords > 0 && bestAvg !== null && bestAvg > 0) {
    const daysRemaining = Math.ceil(remainingWords / bestAvg);
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + daysRemaining);
    projectedCompletionDate = d.toISOString().slice(0, 10);
  }

  return {
    words_today: wordsToday,
    daily_average_7d: dailyAverage7d,
    daily_average_30d: dailyAverage30d,
    current_total: currentTotal,
    target_word_count: targetWordCount,
    remaining_words: remainingWords,
    target_deadline: targetDeadline,
    days_until_deadline: daysUntilDeadline,
    required_pace: requiredPace,
    projected_completion_date: projectedCompletionDate,
    today,
  };
}
```

Run: `npm test -w packages/server -- --run`
Expected: FAIL in velocity.test.ts (old tests reference sessions, streaks, completion) and possibly in projects.test.ts (completion_threshold). Fixed in Tasks 5-6.

#### REFACTOR

- Check that `ChapterStatusRepo` import is removed (no longer used)
- Verify `recordSave` no longer has the inner try/catch for save_event insertion (just one for snapshot)

**Commit:**
```bash
git add packages/server/src/velocity/velocity.service.ts
git commit -m "feat: simplify velocity service — remove sessions, streaks, completion"
```

---

### Task 5: Remove completion_threshold and chapter target_word_count from Server Types

**Requirement:** Design §What Gets Removed — completion_threshold from projects, target_word_count from chapters

**Files:**
- Modify: `packages/server/src/projects/projects.types.ts`
- Modify: `packages/server/src/projects/projects.service.ts`
- Modify: `packages/server/src/chapters/chapters.types.ts`
- Modify: `packages/server/src/chapters/chapters.service.ts`
- Modify: `packages/server/src/chapters/chapters.repository.ts`

#### RED

No separate test — verified by existing tests once updated in Task 6. Confirm the type changes compile by running `npx tsc --noEmit -p packages/server/tsconfig.json` (expect errors in test files that still reference old fields — those are fixed in Task 6).

#### GREEN

1. **`projects.types.ts`:**
   - Remove `completion_threshold` from `ProjectRow` (line 10)
   - Remove `completion_threshold` from `UpdateProjectData` (line 31)
   - Remove the `CompletionThresholdValue` import (line 1)

2. **`projects.service.ts`:**
   - Remove the `completion_threshold` handling from the update function (lines 149-150)

3. **`chapters.types.ts`:**
   - Remove `target_word_count` from `ChapterRow` (line 9)
   - Remove `target_word_count` from `ChapterRawRow` (line 23)
   - Remove `target_word_count` from `ChapterMetadataRow` (line 35)
   - Remove `target_word_count` from `UpdateChapterData` (line 65)

4. **`chapters.service.ts`:**
   - Remove `target_word_count` handling from the update function (lines 77-78)

5. **`chapters.repository.ts`:**
   - Remove `"target_word_count"` from any select lists (line 99)

#### REFACTOR

- Check for any remaining `CompletionThresholdValue` imports in the server package
- Verify no `target_word_count` references remain in chapter service/repository code

**Commit:**
```bash
git add packages/server/src/projects/ packages/server/src/chapters/
git commit -m "feat: remove completion_threshold from projects, target_word_count from chapters"
```

---

### Task 6: Rewrite Server Velocity Tests

**Requirement:** Design §Testing Strategy — remove session/streak/completion tests, add rolling average/projection/words-today tests

**Files:**
- Modify: `packages/server/src/__tests__/velocity.test.ts`
- Modify: `packages/server/src/__tests__/projects.test.ts`

#### RED

Delete the entire existing `velocity.test.ts` and replace with tests for the simplified system. Write all new tests first — they define the expected behavior.

New tests should cover:

1. **`safeTimezone()`** — keep existing tests (still valid)
2. **Empty state** — new project with no snapshots returns `words_today: 0`, null averages, null projection
3. **`words_today`** — with prior-day snapshot, returns delta; with no prior snapshot (new project), returns `current_total`
4. **Rolling average (7d)** — insert snapshots 7+ days ago, verify calculation
5. **Rolling average (30d)** — insert snapshots 30+ days ago, verify calculation
6. **Rolling average with missing days** — no snapshot exactly N days ago, uses nearest earlier snapshot, adjusts divisor to actual days
7. **Projection** — with target + 30d average, returns `projected_completion_date`
8. **Projection fallback** — no 30d data, uses 7d average
9. **Projection null cases** — no target → null; no average → null; target already met → null
10. **`required_pace`** — with target + deadline, correct calculation
11. **`days_until_deadline`** — correct calculation; past deadline → 0
12. **404 for non-existent project** — returns 404
13. **`recordSave` only upserts snapshot** — verify daily_snapshots updated, no save_events table access

Follow the existing test harness patterns (check how the current `velocity.test.ts` creates projects and chapters via HTTP).

Also update `projects.test.ts`:
- Remove the `completion_threshold` tests (lines ~432-449)

Run: `npm test -w packages/server -- --run`
Expected: PASS

If tests pass unexpectedly on empty state: verify the test actually hits the API, not just asserts on defaults.

#### GREEN

Implementation was already done in Tasks 3-5. The tests should pass against the new service.

#### REFACTOR

- Look for duplicated test setup (project creation, snapshot insertion). Extract helpers.
- Ensure test helper functions for date math are consistent with the service's date math.

**Commit:**
```bash
git add packages/server/src/__tests__/velocity.test.ts packages/server/src/__tests__/projects.test.ts
git commit -m "test: rewrite velocity tests for simplified progress model"
```

---

### Task 7: Delete Client Velocity Components and Tests

**Requirement:** Design §Client Changes — Remove BurndownChart, RecentSessions, DailyWordChart, VelocityView, SummaryStrip, ChapterTargetPopover, recharts

**Files:**
- Delete: `packages/client/src/components/VelocityView.tsx`
- Delete: `packages/client/src/components/SummaryStrip.tsx`
- Delete: `packages/client/src/components/BurndownChart.tsx`
- Delete: `packages/client/src/components/DailyWordChart.tsx`
- Delete: `packages/client/src/components/RecentSessions.tsx`
- Delete: `packages/client/src/components/ChapterTargetPopover.tsx`
- Delete: `packages/client/src/__tests__/VelocityView.test.tsx`
- Delete: `packages/client/src/__tests__/BurndownChart.test.tsx`
- Delete: `packages/client/src/__tests__/DailyWordChart.test.tsx`
- Delete: `packages/client/src/__tests__/ChapterTargetPopover.test.tsx`

#### RED

This is a deletion task — no new tests. Verify the files exist before deleting:

```bash
ls packages/client/src/components/{VelocityView,SummaryStrip,BurndownChart,DailyWordChart,RecentSessions,ChapterTargetPopover}.tsx
```

#### GREEN

```bash
rm packages/client/src/components/VelocityView.tsx
rm packages/client/src/components/SummaryStrip.tsx
rm packages/client/src/components/BurndownChart.tsx
rm packages/client/src/components/DailyWordChart.tsx
rm packages/client/src/components/RecentSessions.tsx
rm packages/client/src/components/ChapterTargetPopover.tsx
rm packages/client/src/__tests__/VelocityView.test.tsx
rm packages/client/src/__tests__/BurndownChart.test.tsx
rm packages/client/src/__tests__/DailyWordChart.test.tsx
rm packages/client/src/__tests__/ChapterTargetPopover.test.tsx
```

Remove `recharts` dependency:

```bash
cd packages/client && npm uninstall recharts && cd ../..
```

Run: `npm test -w packages/client -- --run`
Expected: FAIL — DashboardView still imports VelocityView and ChapterTargetPopover. Fixed in Tasks 8-11.

#### REFACTOR

- Verify no other components import the deleted files (grep for their names)
- Check `packages/client/src/hooks/useReducedMotion.ts` — if it's only used by the deleted chart components, flag it for removal later (but leave it if ProgressStrip will use it)

**Commit:**
```bash
git add -A packages/client/src/components/ packages/client/src/__tests__/ packages/client/package.json package-lock.json
git commit -m "feat: delete velocity chart components, ChapterTargetPopover, and recharts dependency"
```

---

### Task 8: Update Client API, Types, and Strings

**Requirement:** Design §API client, §ProgressStrip status line text variants

**Files:**
- Modify: `packages/client/src/api/client.ts`
- Modify: `packages/client/src/strings.ts`

#### RED

No separate test — verified by Task 10 (ProgressStrip) and Task 11 (DashboardView) tests.

#### GREEN

1. **`packages/client/src/api/client.ts`:**
   - Remove the `CompletionThresholdValue` import (line 9)
   - Remove `completion_threshold` from the `projects.update` type (line 66)
   - Remove `target_word_count` from the `chapters.update` type (line 121)
   - Remove `target_word_count` from the `projects.dashboard` response type (line 95)
   - The `VelocityResponse` import and re-export stay as-is

2. **`packages/client/src/strings.ts`:**

   Remove the velocity strings (lines 162-196). Replace with ProgressStrip strings:

   ```typescript
   velocity: {
     progressLabel: "Writing progress",
     emptyState: "Start writing to see your progress.",
     wordsToday: (count: number) => `${count.toLocaleString()} words today`,
     dailyAverage: (count: number) => `Recent pace: ${count.toLocaleString()}/day`,
     requiredPace: (count: number) => `Needed pace: ${count.toLocaleString()}/day`,
     daysRemaining: (count: number) => `${count} ${count === 1 ? "day" : "days"} left`,
     wordsOfTarget: (current: number, target: number) =>
       `${current.toLocaleString()} / ${target.toLocaleString()} words`,
     wordsTotal: (count: number) => `${count.toLocaleString()} words`,
     projectedDate: (date: string) => {
       const d = new Date(date + "T00:00:00Z");
       return `Projected: ${d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
     },
   },
   ```

   Also remove from `projectSettings`:
   - `completionThreshold` (line 209)
   - `thresholdOutline`, `thresholdRoughDraft`, `thresholdRevised`, `thresholdEdited`, `thresholdFinal` (lines 213-217)

#### REFACTOR

- Check for any remaining string constants that reference the old velocity features (streaks, sessions, burndown)
- Verify the new string functions produce the expected output formats

**Commit:**
```bash
git add packages/client/src/api/client.ts packages/client/src/strings.ts
git commit -m "feat: update client API types and strings for simplified velocity"
```

---

### Task 9: Update ProjectSettingsDialog — Remove Completion Threshold

**Requirement:** Design §What Gets Removed — completion_threshold UI

**Files:**
- Modify: `packages/client/src/components/ProjectSettingsDialog.tsx`
- Modify: `packages/client/src/__tests__/ProjectSettingsDialog.test.tsx`

#### RED

Update `ProjectSettingsDialog.test.tsx`:
- Remove `completion_threshold` from mock project data (line 16)
- Remove the test that verifies threshold change calls the API (line ~176)
- Remove any other tests that reference completion threshold

Run: `npm test -w packages/client -- --run ProjectSettingsDialog`
Expected: FAIL — component still expects and renders completion_threshold.

#### GREEN

Update `ProjectSettingsDialog.tsx`:
- Remove the `CompletionThresholdValue` import (line 2)
- Remove `completion_threshold` from the `ProjectSettingsDialogProps.project` interface (line 23)
- Remove `THRESHOLD_OPTIONS` (lines 29-35)
- Remove `threshold` state and all `setThreshold` calls
- Remove `threshold` from `confirmedFieldsRef.current`
- Remove `handleThresholdChange` function (line 186-188)
- Remove the completion threshold `<div>` block from the JSX (lines 313-332)
- Remove all `completion_threshold` handling in `saveField` (lines 149-150, 163-165)

Run: `npm test -w packages/client -- --run ProjectSettingsDialog`
Expected: PASS

#### REFACTOR

- Check that no dead state variables remain from the threshold removal
- Verify the dialog layout still looks clean without the threshold dropdown (word count target, deadline, timezone should flow naturally)

**Commit:**
```bash
git add packages/client/src/components/ProjectSettingsDialog.tsx packages/client/src/__tests__/ProjectSettingsDialog.test.tsx
git commit -m "feat: remove completion threshold from project settings dialog"
```

---

### Task 10: Create ProgressStrip Component with Tests

**Requirement:** Design §ProgressStrip — progress bar with ARIA, status line variants, prefers-reduced-motion

**Files:**
- Create: `packages/client/src/components/ProgressStrip.tsx`
- Create: `packages/client/src/__tests__/ProgressStrip.test.tsx`

#### RED

Create `packages/client/src/__tests__/ProgressStrip.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProgressStrip } from "../components/ProgressStrip";
import type { VelocityResponse } from "@smudge/shared";

function makeVelocity(overrides: Partial<VelocityResponse> = {}): VelocityResponse {
  return {
    words_today: 0,
    daily_average_7d: null,
    daily_average_30d: null,
    current_total: 0,
    target_word_count: null,
    remaining_words: null,
    target_deadline: null,
    days_until_deadline: null,
    required_pace: null,
    projected_completion_date: null,
    today: "2026-04-12",
    ...overrides,
  };
}

describe("ProgressStrip", () => {
  it("shows empty state when no data", () => {
    render(<ProgressStrip data={null} loading={false} />);
    expect(screen.getByText(/start writing/i)).toBeInTheDocument();
  });

  it("shows loading state", () => {
    render(<ProgressStrip data={null} loading={true} />);
    expect(screen.queryByText(/start writing/i)).not.toBeInTheDocument();
  });

  it("shows word count when no target set", () => {
    render(<ProgressStrip data={makeVelocity({ current_total: 12500 })} loading={false} />);
    expect(screen.getByText(/12,500 words/)).toBeInTheDocument();
  });

  it("shows progress bar when target is set", () => {
    render(
      <ProgressStrip
        data={makeVelocity({ current_total: 40000, target_word_count: 80000, remaining_words: 40000 })}
        loading={false}
      />,
    );
    const progressBar = screen.getByRole("progressbar");
    expect(progressBar).toHaveAttribute("aria-valuenow", "40000");
    expect(progressBar).toHaveAttribute("aria-valuemax", "80000");
    expect(screen.getByText(/40,000 \/ 80,000 words/)).toBeInTheDocument();
  });

  it("does not show progress bar when no target", () => {
    render(<ProgressStrip data={makeVelocity({ current_total: 5000 })} loading={false} />);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows days remaining when deadline is set", () => {
    render(
      <ProgressStrip
        data={makeVelocity({
          current_total: 40000,
          target_word_count: 80000,
          remaining_words: 40000,
          target_deadline: "2026-06-01",
          days_until_deadline: 50,
          required_pace: 800,
          daily_average_30d: 650,
        })}
        loading={false}
      />,
    );
    expect(screen.getByText(/50 days left/)).toBeInTheDocument();
    expect(screen.getByText(/Needed pace: 800\/day/)).toBeInTheDocument();
    expect(screen.getByText(/Recent pace: 650\/day/)).toBeInTheDocument();
  });

  it("shows daily average without deadline", () => {
    render(
      <ProgressStrip
        data={makeVelocity({
          current_total: 40000,
          target_word_count: 80000,
          remaining_words: 40000,
          daily_average_30d: 650,
        })}
        loading={false}
      />,
    );
    expect(screen.getByText(/Recent pace: 650\/day/)).toBeInTheDocument();
    expect(screen.queryByText(/days left/)).not.toBeInTheDocument();
  });

  it("has accessible progress bar with text label", () => {
    render(
      <ProgressStrip
        data={makeVelocity({ current_total: 40000, target_word_count: 80000, remaining_words: 40000 })}
        loading={false}
      />,
    );
    const progressBar = screen.getByRole("progressbar");
    expect(progressBar).toHaveAttribute("aria-valuemin", "0");
    expect(progressBar).toHaveAttribute("aria-valuenow", "40000");
    expect(progressBar).toHaveAttribute("aria-valuemax", "80000");
  });

  it("respects prefers-reduced-motion on progress bar", () => {
    render(
      <ProgressStrip
        data={makeVelocity({ current_total: 40000, target_word_count: 80000, remaining_words: 40000 })}
        loading={false}
      />,
    );
    const progressBar = screen.getByRole("progressbar");
    const fill = progressBar.firstElementChild as HTMLElement;
    expect(fill.className).toContain("motion-reduce:transition-none");
  });
});
```

Run: `npm test -w packages/client -- --reporter=verbose --run ProgressStrip`
Expected: FAIL — component doesn't exist yet.

#### GREEN

Create `packages/client/src/components/ProgressStrip.tsx`:

```tsx
import type { VelocityResponse } from "@smudge/shared";
import { STRINGS } from "../strings";

interface ProgressStripProps {
  data: VelocityResponse | null;
  loading: boolean;
}

export function ProgressStrip({ data, loading }: ProgressStripProps) {
  if (loading && !data) {
    return (
      <section aria-label={STRINGS.velocity.progressLabel} className="mb-8">
        <div className="h-6 bg-bg-secondary/50 rounded animate-pulse" />
      </section>
    );
  }

  if (!data) {
    return (
      <section aria-label={STRINGS.velocity.progressLabel} className="mb-8">
        <p className="text-text-muted text-sm font-sans">{STRINGS.velocity.emptyState}</p>
      </section>
    );
  }

  const hasTarget = data.target_word_count !== null;
  const percentage = hasTarget
    ? Math.min(100, (data.current_total / data.target_word_count!) * 100)
    : 0;

  // Build status segments
  const segments: string[] = [];

  if (hasTarget) {
    segments.push(STRINGS.velocity.wordsOfTarget(data.current_total, data.target_word_count!));
  } else {
    segments.push(STRINGS.velocity.wordsTotal(data.current_total));
  }

  if (data.days_until_deadline !== null) {
    segments.push(STRINGS.velocity.daysRemaining(data.days_until_deadline));
  }

  if (data.required_pace !== null) {
    segments.push(STRINGS.velocity.requiredPace(data.required_pace));
  }

  const recentPace = data.daily_average_30d ?? data.daily_average_7d;
  if (recentPace !== null && recentPace > 0) {
    segments.push(STRINGS.velocity.dailyAverage(recentPace));
  }

  return (
    <section aria-label={STRINGS.velocity.progressLabel} className="mb-8">
      {hasTarget && (
        <div
          role="progressbar"
          aria-valuenow={data.current_total}
          aria-valuemin={0}
          aria-valuemax={data.target_word_count!}
          aria-label={STRINGS.velocity.wordsOfTarget(data.current_total, data.target_word_count!)}
          className="h-3 rounded-full overflow-hidden bg-bg-secondary mb-3"
        >
          <div
            className="h-full rounded-full transition-all duration-500 motion-reduce:transition-none"
            style={{
              width: `${percentage}%`,
              backgroundColor: "var(--color-accent, #6B4720)",
            }}
          />
        </div>
      )}
      <p className="text-sm text-text-secondary font-sans">
        {segments.join(". ")}.
      </p>
    </section>
  );
}
```

Run: `npm test -w packages/client -- --reporter=verbose --run ProgressStrip`
Expected: PASS

#### REFACTOR

- Check that the status line formatting looks clean for all variants (no double periods, no trailing period after "words")
- Ensure the component handles edge cases: `current_total > target_word_count` (percentage capped at 100%), zero word count

**Commit:**
```bash
git add packages/client/src/components/ProgressStrip.tsx packages/client/src/__tests__/ProgressStrip.test.tsx
git commit -m "feat: add ProgressStrip component with tests"
```

---

### Task 11: Rewrite DashboardView — Remove Tabs, Add ProgressStrip

**Requirement:** Design §DashboardView — remove tab navigation, single view with ProgressStrip at top

**Files:**
- Modify: `packages/client/src/components/DashboardView.tsx`
- Modify: `packages/client/src/__tests__/DashboardView.test.tsx`

#### RED

Update `DashboardView.test.tsx`:
- Remove all tab-switching tests (velocity tab, chapters tab switching)
- Remove tests that reference the velocity tab
- Add test: ProgressStrip renders at top when velocity data loads
- Add test: shows loading state while velocity data is fetching
- Update mock setup to include a velocity API mock
- Keep all existing chapter table tests (sorting, navigation, status, empty state, error state)

Run: `npm test -w packages/client -- --reporter=verbose --run DashboardView`
Expected: FAIL — DashboardView still has tabs, still imports VelocityView.

#### GREEN

Update `DashboardView.tsx`:
- Remove the `VelocityView` import (line 6)
- Remove the `ChapterTargetPopover` import (line 7)
- Add imports: `ProgressStrip` and velocity API call
- Remove `activeTab` state (line 26) and all tab-related JSX (lines 72-118)
- Add velocity data fetching state (`velocityData`, `velocityLoading`)
- Add a `useEffect` that fetches `api.projects.velocity(slug)` alongside the dashboard data
- Replace the `ChapterTargetPopover` in the word count column with a plain formatted number
- Add `<ProgressStrip data={velocityData} loading={velocityLoading} />` at the top, above the health summary

The DashboardView should now be a single view: ProgressStrip → health summary → status bar → chapter table.

Run: `npm test -w packages/client -- --reporter=verbose --run DashboardView`
Expected: PASS

#### REFACTOR

- Check that the velocity and dashboard fetches happen in parallel (two independent `useEffect` hooks, or one combined fetch)
- Ensure proper cleanup of both fetch effects on unmount (cancelled flag)
- Remove the `tabBar` variable and related styling

**Commit:**
```bash
git add packages/client/src/components/DashboardView.tsx packages/client/src/__tests__/DashboardView.test.tsx
git commit -m "feat: replace dashboard tabs with single view + ProgressStrip"
```

---

### Task 12: Fix All Remaining References to Removed Fields

**Requirement:** Implied by removal of completion_threshold and chapter target_word_count — mock data in tests must match new types

**Files:**
- Modify: Various client test files

#### RED

Run: `npm test -w packages/client -- --run`
Expected: FAIL — multiple test files have `completion_threshold: "final" as const` in mock Project objects that no longer match the `Project` type.

#### GREEN

Remove `completion_threshold` from all mock Project objects in these files:
- `packages/client/src/__tests__/ChapterTitle.test.tsx` (lines 106, 279)
- `packages/client/src/__tests__/EditorPageFeatures.test.tsx` (lines 86, 728)
- `packages/client/src/__tests__/StatusBar.test.tsx` (line 64)
- `packages/client/src/__tests__/KeyboardShortcuts.test.tsx` (line 70)
- `packages/client/src/__tests__/useProjectEditor.test.ts` (line 96)
- `packages/client/src/__tests__/HomePage.test.tsx` (line 127)
- `packages/client/src/__tests__/App.test.tsx` (line 98)
- `packages/client/src/__tests__/Sidebar.test.tsx` (line 25)

Also remove `target_word_count` from any mock Chapter objects in these files if it appears.

Run: `npm test -w packages/client -- --run`
Expected: PASS

#### REFACTOR

- Grep for any remaining `completion_threshold` references across the entire codebase: `grep -r "completion_threshold" packages/`
- Grep for `CompletionThreshold` imports: `grep -r "CompletionThreshold" packages/`
- Any remaining references are bugs — fix them.

**Commit:**
```bash
git add packages/client/src/__tests__/
git commit -m "fix: remove completion_threshold and chapter target_word_count from all client test mocks"
```

---

### Task 13: Full Test Suite and Lint

**Requirement:** Design §Coverage — 95/85/90/95 thresholds

#### RED

Run: `make test`
Expected: PASS (if any failures remain, investigate and fix)

#### GREEN

Run: `make lint && make format`
Fix any lint/format issues.

Run typecheck:
```bash
npx tsc --noEmit -p packages/shared/tsconfig.json && npx tsc --noEmit -p packages/server/tsconfig.json && npx tsc --noEmit -p packages/client/tsconfig.json
```
Fix any type errors.

Run coverage: `make cover`
Expected: PASS at 95/85/90/95 thresholds.

#### REFACTOR

- If coverage drops: identify uncovered lines in the new code (ProgressStrip, velocity service) and add targeted tests
- If lint finds issues: fix them (likely import ordering or unused variables from the refactor)

**Commit:**
```bash
git add -A
git commit -m "chore: lint and format after progress model simplification"
```

---

### Task 14: E2e Tests

**Requirement:** Design §E2e Tests — update velocity tests, add progress strip test, aXe scan

**Files:**
- Modify: any existing Playwright tests that reference velocity tab or charts
- Create or modify: e2e test for progress strip

#### RED

Write an e2e test that:
1. Creates a project with a word count target
2. Creates a chapter and writes content
3. Navigates to the dashboard
4. Verifies the progress strip shows word count and progress bar
5. Runs aXe scan on the dashboard view

Check for existing velocity e2e tests: `grep -r "velocity\|burndown\|streak\|session\|completion_threshold" e2e/`
Update or remove any that reference the old UI.

Run: `make e2e`
Expected: FAIL — new test expects ProgressStrip which should be visible.

If the test passes unexpectedly: verify it's actually testing the new UI, not a leftover.

#### GREEN

Implement the e2e test following existing patterns in the `e2e/` directory. Ensure the aXe scan covers the progress bar's accessibility.

Run: `make e2e`
Expected: PASS

#### REFACTOR

- Check that e2e test doesn't duplicate what unit tests already cover (focus on integration: API → UI flow)
- Ensure proper test isolation (project cleanup)

**Commit:**
```bash
git add e2e/
git commit -m "test: update e2e tests for simplified progress model"
```

---

### Task 15: Run Full CI Pass

**Requirement:** Quality gate — everything green before merge

#### RED/GREEN/REFACTOR

Run: `make all`
Expected: PASS — lint, format, typecheck, coverage, e2e all green.

If any failures: investigate root cause, fix, and re-run. Do not commit broken code.

**Final commit only if `make all` required fixes not yet committed.**
