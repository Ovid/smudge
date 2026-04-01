# Phase 2: Goals & Velocity — Design Document

**Date:** 2026-04-01
**Phase:** 2 (Roadmap)
**Depends on:** Phase 1 (Writer's Dashboard), MVP
**Status:** Design complete

---

## Overview

Help writers answer: "Am I on track? How fast am I actually writing?" by making their velocity visible without judging it. Track word count progress, session stats, streaks, and chapter completion — adapting the display to whatever targets the writer has set.

---

## Data Model

### Project — add columns

| Column | Type | Default | Notes |
|---|---|---|---|
| `target_word_count` | integer, nullable | null | Optional word count goal |
| `target_deadline` | text, nullable | null | ISO date, optional |
| `completion_threshold` | text | `"final"` | One of: `outline`, `rough_draft`, `revised`, `edited`, `final`. Defines what status a chapter must reach to count as "complete." |

### Chapter — add column

| Column | Type | Default | Notes |
|---|---|---|---|
| `target_word_count` | integer, nullable | null | Optional per-chapter word count goal |

### New table: DailySnapshot

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `project_id` | UUID | Foreign key → Project, indexed |
| `date` | text | ISO date in writer's timezone |
| `total_word_count` | integer | Sum of all chapter word counts at time of save |
| `created_at` | text | ISO timestamp, UTC |

Unique constraint on `(project_id, date)`.

### New table: Setting

| Column | Type | Notes |
|---|---|---|
| `key` | text | Primary key |
| `value` | text | |

Initial row: `timezone` → detected from browser on first launch. Server defaults to UTC if the setting does not yet exist.

### New table: SaveEvent

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `chapter_id` | UUID | Foreign key → Chapter |
| `project_id` | UUID | Foreign key → Project, indexed |
| `word_count` | integer | Chapter word count at time of save |
| `saved_at` | text | ISO timestamp, UTC |

Index on `(project_id, saved_at)` for session derivation queries.

One row per content save. Sessions are derived on-demand from SaveEvent timestamps — any cluster of saves to the same project with no gap exceeding 30 minutes constitutes a session.

### What's NOT in the data model

No `WritingSession` table. Sessions are derived on-demand from SaveEvent data, not stored.

No "added words" (gross) metric. Only net words per session are tracked, derived from word count deltas in SaveEvent rows.

### Database Indexes

These indexes are required for Phase 2 query performance:

| Table | Column(s) | Reason |
|---|---|---|
| `chapters` | `project_id` | All chapter queries filter by project (existing + Phase 2) |
| `chapters` | `deleted_at` | All queries filter soft deletes |
| `save_events` | `(project_id, saved_at)` | Session derivation queries last 30 days per project |
| `daily_snapshots` | `(project_id, date)` unique | Implicit from unique constraint — sufficient |

---

## Snapshot Collection: Upsert on Save

Every `PATCH /api/chapters/{id}` that updates content triggers two side-effects:

1. Recalculate chapter word count (existing behavior).
2. Insert a SaveEvent row with `(chapter_id, project_id, word_count, saved_at)`.
3. Sum all chapter word counts for the project.
4. Read the `timezone` setting (default: UTC if not set), compute today's date in that timezone.
5. Upsert a DailySnapshot row for `(project_id, today)` with the total.

Both the SaveEvent insert and DailySnapshot upsert are best-effort — if either fails, the chapter save still succeeds. The next save retries. The 1.5s debounce already limits save frequency.

---

## API

### Settings

- `GET /api/settings` — returns all settings as key-value pairs.
- `PATCH /api/settings` — body: `{ settings: [{ key, value }, ...] }`. Validates each key individually (e.g., timezone validated against `Intl.supportedValuesOf('timeZone')`). Returns 400 with per-key errors if any value is invalid; no partial application.

### Project targets

- `PATCH /api/projects/:slug` — now also accepts `target_word_count` (positive integer or null), `target_deadline` (ISO date or null), `completion_threshold` (one of five status values).

### Chapter targets

- `PATCH /api/chapters/:id` — now also accepts `target_word_count` (positive integer or null).

### Velocity

- `GET /api/projects/:slug/velocity` — single endpoint returning everything the dashboard needs:

```json
{
  "daily_snapshots": [{ "date": "2026-03-15", "total_word_count": 42000 }],
  "sessions": [{
    "start": "2026-03-15T14:15:00Z",
    "end": "2026-03-15T15:40:00Z",
    "duration_minutes": 85,
    "chapters_touched": ["uuid1", "uuid2"],
    "net_words": 1200
  }],
  "streak": { "current": 12, "best": 23 },
  "projection": {
    "target_word_count": 80000,
    "target_deadline": "2026-09-01",
    "projected_date": "2026-08-28",
    "daily_average_30d": 1200
  },
  "completion": {
    "threshold_status": "revised",
    "total_chapters": 12,
    "completed_chapters": 7
  }
}
```

Fields in `projection` are null when the corresponding target is not set. `daily_snapshots` returns last 90 days. `sessions` returns last 30 days.

---

## Session Derivation

Sessions are computed server-side in the velocity endpoint from SaveEvent data:

1. Query all SaveEvent rows for the project within the time range, ordered by `saved_at`.
2. Walk timestamps. Start a new session when the gap between consecutive save events exceeds 30 minutes.
3. For each chapter touched in a session, look up the most recent SaveEvent **before the session started** as the baseline (or 0 if no prior save exists for that chapter). Then `net_words = sum(last_save_in_session - baseline)` across all chapters.

No "added words" (gross) metric. Net words only — honest about what it measures.

**Deleted chapters:** Session derivation includes SaveEvents from all chapters, including soft-deleted ones. Sessions reflect historical truth — what actually happened during that writing period. Deleting a chapter does not retroactively shrink past session stats.

---

## Streak Calculation

Computed from SaveEvent data:

1. Query distinct dates (in the writer's timezone) that have at least one SaveEvent for the project, ordered descending.
2. A day counts as a writing day if any save occurred that day — regardless of whether the word count changed. Revision days count.
3. **Current streak:** consecutive calendar days from today backwards where at least one save occurred. If today has no saves yet, start counting from yesterday (don't break the streak mid-day).
4. **Best streak:** longest consecutive run in the full history.
5. **First day:** a project's first save event day counts as a writing day.

---

## Adaptive Display

The dashboard adapts based on what targets are configured:

| Configuration | Dashboard shows |
|---|---|
| Nothing set | Daily word counts, streaks, session stats, chapter completion bar |
| Word target only | Above + word count progress, projected completion date |
| Deadline only | Above + days remaining countdown |
| Word target + deadline | Above + burndown chart comparing planned pace vs. actual pace |

Chapter completion ("7 of 12 chapters at Revised or beyond") is always shown — it's free data from Phase 1 statuses. The `completion_threshold` setting controls the threshold.

Settings control display, not data collection. Clearing a word count target does not delete historical DailySnapshot data. Setting a target later recovers the full history.

---

## UI Layout

### Velocity tab (default tab on project dashboard)

The dashboard sub-tabs are: **Velocity** (default) and **Chapters**.

**1. Summary strip** — horizontal row of key metrics:
- Words today: `+340` (current project word count minus the most recent DailySnapshot from a previous calendar day)
- Daily average (30d): `1,200`
- Current streak: `12 days`
- Best streak: `23 days`
- If word target set: `42,000 / 80,000 words (52%)`
- If deadline set: `68 days remaining`
- If both set: `Projected: August 28`
- Always: `7 of 12 chapters at Revised or beyond`

**2. Charts area:**
- Always: daily net word count bar chart (last 30 days). Warm accent color for positive, muted tone for negative. No red/green.
- If target + deadline: burndown chart — planned pace line (lighter tone) vs. actual (accent color).

**3. Recent sessions** — last 5 sessions:
- "Today, 2:15 PM – 3:40 PM · 85 min · +1,200 net words · Ch 4, Ch 5"
- Informational only, not clickable.

### Editor status bar

Right side of existing status bar: "Last session: 85 min, +1,200 words"

### Charts

Recharts (MIT licensed). Styled with the warm earth-tone palette. Tooltips on hover.

**Accessibility:** Charts must have descriptive `aria-label`s summarizing the data trend (e.g., "Daily word count over the last 30 days, averaging 1,200 words per day"). Each chart must include a visually-hidden data table alternative for screen readers. The positive/negative bar distinction in the daily word count chart must use a Recharts-native visual distinction in addition to color (e.g., rounded vs. square bar corners, reduced opacity, or dashed border via a custom shape — not SVG hatching patterns, which Recharts doesn't support natively). Keyboard focus on individual data points is nice-to-have but not required for WCAG AA.

---

## Project Settings

A "Project Settings" dialog accessible from a gear icon on the project dashboard:

- **Word count target:** number input with clear button
- **Deadline:** date picker with clear button
- **A chapter counts as complete at:** dropdown of five statuses, defaults to "Final"

Per-chapter targets set inline — clicking a chapter's word count in the chapter table opens a popover to set/clear the target.

No confirmation dialogs for changing targets. Changes take effect immediately.

### App Settings

A "Settings" link in the sidebar footer opens a minimal dialog with the timezone dropdown. Single setting for now, expandable later.

---

## Timezone Handling

All `created_at` and `updated_at` timestamps are stored as UTC. The `timezone` setting is only used to compute calendar-day boundaries.

- DailySnapshot `date` is computed in the writer's timezone at save time.
- Velocity endpoint uses the configured timezone for grouping and labeling.
- Client detects timezone on first launch and sends it to `PATCH /api/settings`.
- If the timezone setting does not exist (first save before client detection), the server defaults to UTC.

**Timezone change:** if a writer changes timezone, some calendar days might get two snapshots or skip a day. The upsert overwrites today's entry. Streaks might break. This is acceptable for a rare event.

---

## Edge Cases

- **Empty project:** velocity tab shows "Start writing to see your stats here."
- **No saves today:** "Words today" shows `+0` (current total minus most recent prior-day snapshot = no change). Streak doesn't break until the day ends.
- **No prior-day snapshot:** "Words today" diffs current project word count against the most recent DailySnapshot from a previous calendar day, not strictly yesterday. If no prior snapshot exists at all, "Words today" shows the current total (first day of tracking).
- **Single day of data:** one bar in chart. No average or projection shown.
- **Soft-deleted chapter:** word count excluded from project total on next save. Historical snapshots unchanged.
- **DailySnapshot upsert failure:** chapter save still succeeds. Next save retries.
- **Velocity query performance:** a 50-chapter book with frequent saves produces tens of thousands of SaveEvent rows per year (~240 saves/day at ~1 save/minute during 4 hours of active writing). The 30-day session query window limits each velocity request to ~7,200 rows. Single indexed query, processed in memory. No concern for SQLite.
- **Velocity endpoint errors:** the endpoint returns the same empty/default shape regardless of error scenario. No chapters? Same as no saves — empty arrays, zero streak, null projection. Invalid or missing timezone? Fall back to UTC. No new error codes needed; graceful degradation over error states for a read-only dashboard.
- **SaveEvent retention:** rows are retained indefinitely. For a single-user app this is unlikely to be a concern. If performance degrades in the future, a retention policy (e.g., compact saves older than 6 months into daily aggregates) can be added without affecting the API contract.

---

## Language & Tone

Velocity data is encouraging, never judgmental:
- "At your current pace, you'll reach your 80,000-word target around September 15" — not "you'll finish by..."
- No "behind schedule" alarms. If the writer is behind, they can see it.
- Projections are about reaching the word count target, not about "finishing the book."

---

## Migration Notes

- Existing projects receive **seeded baseline data** during migration. For each non-deleted chapter, insert a SaveEvent with the current word count and a timestamp of the migration run. For each non-deleted project, insert a DailySnapshot with the current total word count and today's date. This prevents first-save inflation — without baselines, the first real save would show net_words equal to the entire manuscript (tens of thousands of words) since session derivation uses 0 as the baseline when no prior SaveEvent exists. Seeding ensures "Words today" and session stats reflect only genuine post-migration writing.
- `completion_threshold` defaults to `"final"` for all existing projects. This is the most conservative default — no chapter is incorrectly marked "complete" under a looser threshold the writer didn't choose.
- New columns `target_word_count` and `target_deadline` on Project, and `target_word_count` on Chapter, default to null. No action needed for existing rows.

---

## Dependencies

- Phase 1: dashboard view, chapter statuses, status labels
- MVP: auto-save pipeline, word count calculation, chapter `updated_at` timestamps
- New dependency: Recharts (MIT licensed, add to `docs/dependency-licenses.md`)
