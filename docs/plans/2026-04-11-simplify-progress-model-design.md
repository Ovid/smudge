# Phase 2.5a: Simplify Progress Model — Design Document

**Date:** 2026-04-11
**Phase:** 2.5a
**Depends on:** Phase 2 (Goals & Velocity)
**Companion docs:** `docs/simplification-roadmap.md`, `docs/roadmap.md`

---

## Goal

Reduce the velocity/progress system from a save-event analytics pipeline to a lightweight pace indicator. The writer gets one question answered: "Am I roughly on track?"

The current system derives sessions, computes streaks, renders burndown charts, and tracks completion thresholds. This phase strips all of that back to: daily word count snapshots, rolling averages, and projected completion.

---

## What Gets Removed

| Feature | Current Location | Action |
|---|---|---|
| `save_events` table | DB, migrations 004-009 | Drop via migration |
| `completion_threshold` column | `projects` table | Drop via migration |
| `target_word_count` column | `chapters` table | Drop via migration |
| Derived sessions (30-min gap clustering) | `velocity.service.ts` | Delete code |
| Streak calculation (current + best) | `velocity.service.ts` | Delete code |
| Burndown chart | `BurndownChart.tsx` | Delete component |
| Recent sessions table | `RecentSessions.tsx` | Delete component |
| Daily word chart | `DailyWordChart.tsx` | Delete component |
| Velocity tab in dashboard | `DashboardView.tsx` | Remove tab structure |
| `VelocityView.tsx` | Client | Delete component |
| `recharts` dependency | `packages/client/package.json` | Remove (no remaining imports) |
| `calculateWordsToday()` | `packages/shared/src/schemas.ts` | Remove (only consumer is VelocityView; server computes inline) |

## What Stays

| Feature | Notes |
|---|---|
| `daily_snapshots` table | One row per project per day, upserted on chapter save |
| `settings` table with timezone | Determines day boundaries |
| Rolling averages (7d, 30d) | Computed from daily_snapshots |
| Projected completion date | From target + average pace |
| `target_word_count` on projects | Unchanged |
| `target_deadline` on projects | Unchanged |

## What's New

| Feature | Notes |
|---|---|
| `ProgressStrip` component | Status line + progress bar, inlined at top of dashboard |
| Simplified velocity API response | Flat summary object, no arrays |

---

## API Changes

### `GET /api/projects/:slug/velocity` — Simplified Response

```typescript
interface VelocityResponse {
  words_today: number;
  daily_average_7d: number | null;   // null if < 7 days of data
  daily_average_30d: number | null;  // null if < 30 days of data
  current_total: number;
  target_word_count: number | null;
  remaining_words: number | null;    // null if no target
  target_deadline: string | null;    // ISO date
  days_until_deadline: number | null;
  required_pace: number | null;      // null if no target + deadline
  projected_completion_date: string | null; // null if no target or no avg
  today: string;                     // today's date in configured timezone
}
```

**Computation:**
- `words_today` = current manuscript total minus the most recent snapshot from before today. For new projects with no prior-day snapshot, baseline is 0, so `words_today` equals the current total (the writer wrote those words today).
- Rolling averages: `(today_total - baseline_total) / actual_days` using the nearest snapshot on or before the target date (7 or 30 days ago). If no exact match exists (writer took a day off), use the closest earlier snapshot and divide by the actual number of days between that snapshot and today. Null if no snapshot exists within the window at all.
- `projected_completion_date` = today + (`remaining_words` / `daily_average_30d`) days. Falls back to `daily_average_7d` if 30d data isn't available. Null if no target or no history.

No arrays, no sessions, no streaks, no chapter names map.

---

## Database Migration

A single migration that:

1. **Drops `save_events` table.** Clean break — no data preservation.
2. **Drops `completion_threshold` column from `projects`.** SQLite 3.35+ (shipped with better-sqlite3 on Node 20) supports `ALTER TABLE ... DROP COLUMN`.
3. **Drops `target_word_count` column from `chapters`.** Per-chapter targets are part of the velocity complexity being removed; project-level targets are sufficient.
4. **No changes to `daily_snapshots`** or **`settings`**.

---

## Save Pipeline Changes

### Chapter save (`chapters.service.ts`)

Currently calls `velocityService.recordSave()`, which inserts a save_event AND upserts the daily snapshot. After this change, `recordSave()` only upserts the daily snapshot. The save_event insert is removed entirely.

Same best-effort try/catch wrapper — a snapshot upsert failure never blocks a chapter save.

### Chapter delete/restore

The existing `updateDailySnapshot()` call stays — it recalculates the day's total when chapters are deleted or restored.

---

## Server Code Changes

### `velocity.service.ts` — Gut and Simplify

**Remove:**
- `deriveSessions()` — session clustering logic
- `calculateStreaks()` — streak computation
- Completion threshold lookups
- Chapter names map assembly
- `insertSaveEvent()` call from `recordSave()`

**What remains:**
- `recordSave(projectId, chapterId, wordCount)` — calls only `upsertDailySnapshot()`
- `updateDailySnapshot(projectId)` — recalculates day total (for delete/restore)
- `getVelocityBySlug(slug)` — queries daily_snapshots, computes averages and projection, returns the flat response

### `velocity.repository.ts`

**Remove:**
- `insertSaveEvent()`
- `getRecentSaveEvents()`
- `getPreWindowBaselines()` — per-chapter baselines for session net_words, no longer needed
- `getWritingDates()` — distinct writing dates for streak calculation, no longer needed

**Keep:**
- `upsertDailySnapshot()`

**Replace:**
- `getDailySnapshots()` → two purpose-specific queries: `getBaselineSnapshot()` (nearest snapshot on or before a date, for rolling averages) and `getLastPriorDaySnapshot()` (most recent snapshot before today, for words-today calculation)

### `velocity.types.ts`

Replace `VelocityResponse` with the new flat interface. Remove session, streak, and completion types.

### `velocity.injectable.ts`

No changes needed. The interface already only exposes `recordSave` and `updateDailySnapshot`, whose signatures are unchanged.

### Shared types (`packages/shared/src/schemas.ts`)

- Remove `CompletionThreshold` Zod enum and its usage in `UpdateProjectSchema`
- Remove `target_word_count` from the chapter Zod schema
- Remove `calculateWordsToday()` function (only consumer is VelocityView; server computes words-today via `getLastPriorDaySnapshot()`)
- Add `VelocityResponse` type to the shared package so both client and server import from the same source

---

## Client Changes

### Remove

- `BurndownChart.tsx`
- `RecentSessions.tsx`
- `DailyWordChart.tsx`
- `VelocityView.tsx`
- `SummaryStrip.tsx` (replaced by ProgressStrip)
- `recharts` from `packages/client/package.json` (no remaining imports)
- Velocity tab from `DashboardView.tsx`

### New: `ProgressStrip.tsx`

Sits at the top of the dashboard view, above the chapter table. Contains:

**Progress bar** (only when target is set):
- Warm fill showing `current_total / target_word_count`
- Uses `role="progressbar"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, and a visible text label
- Fill color: warm amber/ochre accent (`#6B4720` or similar)

**Status line** below the bar, plain text:
- With target + deadline: "41,200 / 80,000 words. 52 days left. Needed pace: 746/day. Recent pace: 680/day."
- With target, no deadline: "41,200 / 80,000 words. Recent pace: 680/day."
- No target: "41,200 words" and daily average if available.
- No data yet: "Start writing to see your progress."

Sans-serif font (DM Sans) — this is tool chrome, not manuscript.

### `DashboardView.tsx`

- Remove tab navigation — single view
- `ProgressStrip` at top, chapter table below
- Velocity API call moves into the dashboard view (or the strip fetches its own data)

### API client

Update to match the new simplified response type.

---

## Testing Strategy

### Server Integration Tests

- **Remove:** session derivation tests, streak tests, completion threshold tests, save_event insertion tests
- **Keep/update:** daily snapshot upsert tests, rolling average calculation tests (7d, 30d, edge cases like < 7 days of data)
- **Add:** projected completion date tests (with target, without target, without enough history)
- **Add:** `words_today` edge cases (no prior snapshot, first save of the day, multiple saves same day)
- **Add:** migration test — verify save_events table is gone, completion_threshold column is gone

### Client Tests

- **Remove:** tests for BurndownChart, RecentSessions, DailyWordChart, VelocityView, SummaryStrip
- **Add:** ProgressStrip tests — renders progress bar when target set, hides when no target, correct status text variations, accessible markup
- **Update:** DashboardView tests — no tab switching, strip renders at top

### E2e Tests

- **Update:** any Playwright tests that interact with the velocity tab or charts
- **Add:** e2e test that sets a word target, writes content, verifies the status strip updates with correct pace numbers
- **Add:** aXe scan on the progress bar for a11y

### Coverage

Removing code and its tests should keep ratios healthy. The new ProgressStrip and simplified service need full coverage per the 95/85/90/95 thresholds in vitest.config.ts.

---

## Accessibility

- Progress bar uses semantic `role="progressbar"` with proper ARIA attributes
- Status text is plain text — no color-only information
- Progress bar has a visible text label (not just the bar fill)
- Progress bar transition respects `prefers-reduced-motion` via Tailwind `motion-reduce:transition-none`
- All removed chart components had accessibility considerations that no longer apply
- aXe scan covers the new ProgressStrip component
