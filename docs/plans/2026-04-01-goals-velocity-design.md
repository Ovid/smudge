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
| `completion_status` | text | `"final"` | One of: `outline`, `rough_draft`, `revised`, `edited`, `final`. Defines what status a chapter must reach to count as "complete." |

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

Initial row: `timezone` → detected from browser on first launch.

### What's NOT in the data model

No `WritingSession` table. Sessions are derived on-demand from chapter `updated_at` timestamps — any cluster of saves to the same project with no gap exceeding 30 minutes constitutes a session.

No `SaveLog` table. "Added words" (gross) is deferred. Only net words per session are tracked, derived from word count deltas.

---

## Snapshot Collection: Upsert on Save

Every `PATCH /api/chapters/{id}` that updates content triggers a DailySnapshot upsert:

1. Recalculate chapter word count (existing behavior).
2. Sum all chapter word counts for the project.
3. Read the `timezone` setting, compute today's date in that timezone.
4. Upsert a DailySnapshot row for `(project_id, today)` with the total.

The upsert is best-effort — if it fails, the chapter save still succeeds. The next save retries. The 1.5s debounce already limits save frequency.

---

## API

### Settings

- `GET /api/settings` — returns all settings as key-value pairs.
- `PATCH /api/settings` — body: `{ key, value }`. Validates timezone against `Intl.supportedValuesOf('timeZone')`.

### Project targets

- `PATCH /api/projects/{id}` — now also accepts `target_word_count` (positive integer or null), `target_deadline` (ISO date or null), `completion_status` (one of five status values).

### Chapter targets

- `PATCH /api/chapters/{id}` — now also accepts `target_word_count` (positive integer or null).

### Velocity

- `GET /api/projects/{id}/velocity` — single endpoint returning everything the dashboard needs:

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

Sessions are computed server-side in the velocity endpoint:

1. Query all chapter `updated_at` timestamps for the project within the time range, ordered chronologically.
2. Walk timestamps. Start a new session when the gap between consecutive timestamps exceeds 30 minutes.
3. For each session, compare each chapter's `word_count` at the session's first and last save to compute `net_words`.

No "added words" (gross) metric. Net words only — honest about what it measures.

---

## Streak Calculation

Computed from DailySnapshot data:

1. Query all snapshots for the project, ordered by date descending.
2. Walk backwards from today. A day counts as a writing day if its `total_word_count` differs from the previous day's. Any change counts — adding or deleting words both qualify as writing.
3. **Current streak:** consecutive calendar days from today backwards where the word count changed. If today has no snapshot yet, start counting from yesterday (don't break the streak mid-day).
4. **Best streak:** longest consecutive run in the full history.
5. **First day:** a project's first snapshot counts as a writing day (no prior day to compare against).

---

## Adaptive Display

The dashboard adapts based on what targets are configured:

| Configuration | Dashboard shows |
|---|---|
| Nothing set | Daily word counts, streaks, session stats, chapter completion bar |
| Word target only | Above + word count progress, projected completion date |
| Deadline only | Above + days remaining countdown |
| Word target + deadline | Above + burndown chart comparing planned pace vs. actual pace |

Chapter completion ("7 of 12 chapters at Revised or beyond") is always shown — it's free data from Phase 1 statuses. The `completion_status` setting controls the threshold.

Settings control display, not data collection. Clearing a word count target does not delete historical DailySnapshot data. Setting a target later recovers the full history.

---

## UI Layout

### Velocity tab (default tab on project dashboard)

The dashboard sub-tabs are: **Velocity** (default) and **Chapters**.

**1. Summary strip** — horizontal row of key metrics:
- Words today: `+340`
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

**Timezone change:** if a writer changes timezone, some calendar days might get two snapshots or skip a day. The upsert overwrites today's entry. Streaks might break. This is acceptable for a rare event.

---

## Edge Cases

- **Empty project:** velocity tab shows "Start writing to see your stats here."
- **No saves today:** "Words today" shows `+0`. Streak doesn't break until the day ends.
- **Single day of data:** one bar in chart. No average or projection shown.
- **Soft-deleted chapter:** word count excluded from project total on next save. Historical snapshots unchanged.
- **DailySnapshot upsert failure:** chapter save still succeeds. Next save retries.
- **Velocity query performance:** a 50-chapter book with frequent saves produces a few thousand `updated_at` rows over 30 days. Single indexed query, processed in memory. No concern for SQLite.

---

## Language & Tone

Velocity data is encouraging, never judgmental:
- "At your current pace, you'll reach your 80,000-word target around September 15" — not "you'll finish by..."
- No "behind schedule" alarms. If the writer is behind, they can see it.
- Projections are about reaching the word count target, not about "finishing the book."

---

## Dependencies

- Phase 1: dashboard view, chapter statuses, status labels
- MVP: auto-save pipeline, word count calculation, chapter `updated_at` timestamps
- New dependency: Recharts (MIT licensed, add to `docs/dependency-licenses.md`)
