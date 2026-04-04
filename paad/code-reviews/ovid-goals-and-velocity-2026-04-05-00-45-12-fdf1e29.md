# Agentic Code Review: ovid/goals-and-velocity

**Date:** 2026-04-05 00:45:12
**Branch:** ovid/goals-and-velocity -> main
**Commit:** fdf1e295e48b8fa8c6b1c27e85f8a9f8ed5f9620
**Files changed:** 83 | **Lines changed:** +9065 / -286
**Diff size category:** Large

## Executive Summary

The goals & velocity feature is substantially complete and faithful to its design doc. The implementation is well-structured with good accessibility, string externalization, and timezone handling. The review found 4 important issues (a sort direction bug, silent velocity error swallowing, a missing shared type contract, and a nullable column missing its constraint) and 9 suggestions. No critical bugs were found. Overall confidence in the implementation is high.

## Critical Issues

None found.

## Important Issues

### [I1] Status sort ignores direction for unknown statuses
- **File:** `packages/client/src/components/DashboardView.tsx:170-171`
- **Bug:** The known-vs-unknown status sort branches return hardcoded `-1`/`1` instead of multiplying by `dir`. When the user toggles sort direction (ascending/descending), known statuses always appear before unknown ones regardless of direction.
- **Impact:** Sort direction toggle is partially broken for the status column -- known statuses always sort before unknown ones.
- **Suggested fix:** Change to `return -1 * dir` and `return 1 * dir` on lines 170-171.
- **Confidence:** High
- **Found by:** Logic & Correctness (Client)

### [I2] Silent error swallowing in velocity helpers (triple-silenced)
- **File:** `packages/server/src/routes/velocityHelpers.ts:29-71`, `packages/server/src/routes/chapters.ts:104-115`
- **Bug:** Both `insertSaveEvent` and `upsertDailySnapshot` catch all errors internally and only `console.error`. The caller in `chapters.ts` wraps these in yet another try/catch. If the database has a persistent issue (disk full, schema corruption), velocity tracking silently stops accumulating with zero user or operational visibility. There is no monitoring hook, health check, or degraded-status indicator.
- **Impact:** A writer could go days or weeks without realizing velocity data is not being recorded. The data loss is irrecoverable -- those save_events and snapshots are gone.
- **Suggested fix:** Either (a) propagate errors and include a `warnings` field in the save response so the client can show a non-blocking indicator, or (b) add a counter that surfaces a warning after N consecutive velocity recording failures, or (c) accept as a deliberate tradeoff and document it prominently.
- **Confidence:** High
- **Found by:** Logic & Correctness (Server), Error Handling & Edge Cases, Concurrency & State

### [I3] VelocityResponse type defined only on client, no shared contract
- **File:** `packages/client/src/api/client.ts:12-36`
- **Bug:** The `VelocityResponse` interface is manually defined in the client API module. The server constructs its response as an untyped object literal in `velocity.ts:397-406`. There is no shared type or schema enforcing the contract. If the server renames or removes a field, TypeScript will not catch it at compile time. This is inconsistent with the rest of the codebase where `Project`, `Chapter`, etc. are defined in `packages/shared/src/types.ts`.
- **Impact:** Any server-side refactor that changes a velocity response field name silently breaks the client with no compile-time error. The velocity endpoint returns a complex nested structure (7 top-level keys, nested objects and arrays) making drift especially likely.
- **Suggested fix:** Define `VelocityResponse` (and its nested types) in `packages/shared/src/types.ts` and import on both sides.
- **Confidence:** High
- **Found by:** Contract & Integration (Server), Contract & Integration (Client)

### [I4] save_date column missing NOT NULL constraint
- **File:** `packages/server/src/db/migrations/007_save_events_date_column.js:6`
- **Bug:** Migration 007 adds `save_date` as a nullable TEXT column and backfills existing rows, but never adds a NOT NULL constraint after the backfill. While `insertSaveEvent` always sets `save_date`, the schema doesn't enforce this invariant. Any future code path that inserts save_events without calling `insertSaveEvent` could produce NULL `save_date` rows. The streak query at `velocity.ts:287` joins `save_events.save_date = daily_snapshots.date`, which silently excludes NULL rows.
- **Impact:** Low probability today (all current paths use `insertSaveEvent`), but a future code change could silently break streak calculations without any error.
- **Suggested fix:** Add a follow-up migration that adds a NOT NULL constraint on `save_date` using the SQLite table-rebuild pattern (used in migrations 005 and 006).
- **Confidence:** Medium
- **Found by:** Logic & Correctness (Server), Contract & Integration (Server)

## Suggestions

- **[S1]** `packages/server/src/routes/projects.ts:397-402` — Dashboard handler builds `statusLabelMap` inline, duplicating the existing `getStatusLabelMap()` helper from `status-labels.ts`. Use the existing helper to prevent logic divergence.

- **[S2]** `packages/client/src/components/ProjectSettingsDialog.tsx:83` — When the user enters an invalid word count (0, negative, NaN) and blurs, the handler silently returns without saving, reverting the field, or showing an error. The user may believe the value was saved.

- **[S3]** `packages/client/src/components/BurndownChart.tsx:27-28` — Uses `snapshots[0]` for the start word count without sorting. Currently safe because the server returns date-sorted data, but fragile if server ordering changes.

- **[S4]** `packages/client/src/components/BurndownChart.tsx:39` and `packages/shared/src/schemas.ts:18-31` — Past deadlines are not rejected by validation. In BurndownChart, `dayIndex` can go negative when snapshot dates precede `startDate`, producing a backwards planned-pace line. Consider either rejecting past deadlines on the server or showing a "deadline passed" indicator in the UI.

- **[S5]** `packages/server/src/routes/velocityHelpers.ts:36,55` — `insertSaveEvent` and `upsertDailySnapshot` each independently call `getTodayDate(db)`. If a save straddles midnight, they can return different dates, causing the streak join to miss that event. Fix: compute `today` once in the caller and pass it to both functions.

- **[S6]** `packages/client/src/components/RecentSessions.tsx:10-32` — "Today"/"Yesterday" labels compare against the server's timezone-aware `today` string parsed as UTC midnight, but session timestamps are ISO instants. For users whose configured timezone significantly differs from UTC, labels could be off by a day.

- **[S7]** `packages/server/src/routes/velocity.ts:333` — `dailyAvg30d` can be negative when a writer deletes more than they write over 30 days. The negative value is returned to the client as-is, which could display as "-342 words/day." Consider clamping to 0 or labeling appropriately in the UI.

- **[S8]** `packages/client/src/components/DashboardView.tsx:150-153` — The server returns `totals.most_recent_edit` and `totals.least_recent_edit`, but the client ignores these and re-derives them from the chapters array. Either use the server values or remove them from the response.

- **[S9]** `CLAUDE.md` — The data model section says "Two tables: Project and Chapter" but the codebase now has `projects`, `chapters`, `save_events`, `daily_snapshots`, `chapter_statuses`, and `settings`. This should be updated to avoid misleading Claude Code or new contributors.

## Plan Alignment

- **Implemented:** All major plan items are reflected — data model (migrations 004-007), snapshot collection on save, velocity API endpoint, session derivation from save events, streak calculation, adaptive display with burndown/daily charts, project settings dialog, app settings with timezone, chapter word count targets, string externalization, accessibility (ARIA, hidden data tables, reduced motion), editor status bar session info.
- **Not yet implemented:** SaveEvent retention policy (acknowledged as future work in the design doc).
- **Deviations:**
  - `chapter_id` on `save_events` made nullable (migration 006) to preserve session history after chapter hard-purges -- necessary for the plan's own stated requirement that deleting chapters doesn't shrink past session stats.
  - `save_date` column added (migration 007) as a denormalized optimization for streak queries -- not in the original schema but avoids expensive timezone conversions at query time.
  - DailySnapshot upserts also fire on chapter delete/restore (not just content saves) to keep snapshot totals accurate after structural changes.
  - These deviations are reasonable extensions that resolve edge cases the plan didn't fully address.

## Review Metadata

- **Agents dispatched:** Logic & Correctness (Server), Logic & Correctness (Client), Error Handling & Edge Cases, Contract & Integration (Server), Contract & Integration (Client), Concurrency & State, Security, Plan Alignment
- **Scope:** 83 changed files + adjacent callers/callees one level deep
- **Raw findings:** 27 (before verification)
- **Verified findings:** 13 (after verification)
- **Filtered out:** 14
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** docs/plans/2026-04-01-goals-velocity-plan.md, docs/plans/2026-04-01-goals-velocity-design.md
