# Agentic Code Review: ovid/goals-and-velocity

**Date:** 2026-04-05 00:05:33
**Branch:** ovid/goals-and-velocity -> main
**Commit:** 58c8b460d6e6dce801762098a199538b9c9397cf
**Files changed:** 80 | **Lines changed:** +8850 / -286
**Diff size category:** Large

## Executive Summary

The goals & velocity feature is substantially complete and well-structured, with strong test coverage and careful accessibility work. However, two critical issues affect data correctness for migrated/existing projects: the daily average calculation uses a zero baseline instead of the first snapshot's value (inflating averages by orders of magnitude), and the "Words today" function contradicts the design by returning 0 on the first day of tracking. Five important issues involve timezone mismatches in streak/session calculations, cascade-delete destroying velocity history, and deleted chapter names missing from sessions.

## Critical Issues

### [C1] Inflated `dailyAvg30d` for migrated/new projects (zero baseline)
- **File:** `packages/server/src/routes/velocity.ts:297-324`
- **Bug:** When no daily snapshot exists before the 30-day window (e.g., freshly migrated projects), `baselineTotal` defaults to 0. For a project seeded at migration with 50,000 words, the calculation becomes `(50000 - 0) / 1 = 50000` words/day. This produces wildly optimistic projected completion dates ("you'll reach your target tomorrow").
- **Impact:** Users see nonsensical daily averages and projections they might trust. Resolves after 30+ days of real data, but first-month experience is broken.
- **Suggested fix:** When no pre-window baseline exists, use `firstSnapshot.total_word_count` as the baseline instead of 0.
- **Confidence:** High
- **Found by:** Logic & Correctness (Server)

### [C2] First-day "Words Today" returns 0 instead of current total (contradicts design)
- **File:** `packages/shared/src/schemas.ts:83-86`
- **Bug:** `calculateWordsToday` returns `0` when `lastPrior` is undefined (no prior-day snapshot). The design doc explicitly states: "If no prior snapshot exists at all, 'Words today' shows the current total (first day of tracking)."
- **Impact:** Writers see "+0" on their first day even after writing thousands of words. First impression of the feature is that it's broken.
- **Suggested fix:** Change the `!lastPrior` branch to `return currentTotal` instead of `return 0`.
- **Confidence:** High
- **Found by:** Plan Alignment, Error Handling, Contract & Integration

## Important Issues

### [I1] `computeDailyNetWords` first bar shows full manuscript total
- **File:** `packages/client/src/components/VelocityView.tsx:23-24`
- **Bug:** The first snapshot's `total_word_count` is used as that day's `net_words`. For a migrated project with 50,000 words, the first bar shows 50,000 net words, dwarfing all other bars and making the chart unreadable.
- **Impact:** Daily word chart is visually broken for any project with pre-existing content. Also contradicts `calculateWordsToday` which returns 0 for the same case.
- **Suggested fix:** Set first day's `net_words` to 0, or exclude the first snapshot from chart data.
- **Confidence:** High
- **Found by:** Logic & Correctness (Client), Contract & Integration

### [I2] Chapter names map excludes soft-deleted chapters; sessions show "Unknown chapter"
- **File:** `packages/server/src/routes/velocity.ts:344-392`
- **Bug:** The `chapters` query filters `whereNull("deleted_at")`, so `chapterNames` only contains live chapters. But sessions include save events from deleted chapters. Recent sessions display "Unknown chapter" for any chapter deleted in the last 30 days.
- **Impact:** Confusing UX when a recently-deleted chapter appears as "Unknown" in session history.
- **Suggested fix:** Include soft-deleted chapters in the `chapterNames` query, or at minimum include chapters referenced by the current session set.
- **Confidence:** High
- **Found by:** Logic & Correctness (Server)

### [I3] `ON DELETE CASCADE` on save_events destroys velocity history on chapter purge
- **File:** `packages/server/src/db/migrations/005_cascade_velocity_fks.js:10`
- **Bug:** When a chapter is hard-purged (after 30-day trash), all its `save_events` are cascade-deleted. Session reconstruction becomes incomplete — historical net_words calculations lose data permanently.
- **Impact:** Writing history for purged chapters is silently destroyed. Sessions may show different stats after a purge.
- **Suggested fix:** Use `ON DELETE SET NULL` for `chapter_id` (make it nullable), preserving events as an append-only log. Keep CASCADE on `project_id`.
- **Confidence:** High
- **Found by:** Logic & Correctness (Server)

### [I4] Streak calculation uses UTC date extraction instead of configured timezone
- **File:** `packages/server/src/routes/velocity.ts:283`
- **Bug:** The join condition `date(save_events.saved_at) = daily_snapshots.date` extracts the UTC date from `saved_at`, but `daily_snapshots.date` is timezone-aware (computed via `getTodayDate`). A save at 11 PM in UTC-8 is attributed to the next UTC day, potentially causing a streak mismatch.
- **Impact:** Streaks may undercount for writers in timezones far from UTC, especially for late-night writing sessions.
- **Suggested fix:** Store a timezone-aware date on `save_events`, or convert `saved_at` to the configured timezone in the query.
- **Confidence:** High
- **Found by:** Plan Alignment

### [I5] BurndownChart planned pace extrapolates beyond target for post-deadline dates
- **File:** `packages/client/src/components/BurndownChart.tsx:39-40`
- **Bug:** When snapshot dates exist past the deadline, `dayIndex` exceeds `totalDays`, causing the planned pace line to extrapolate beyond `targetWordCount`.
- **Impact:** The planned pace line shows incorrect values past the deadline, producing a misleading chart.
- **Suggested fix:** Clamp: `const clampedDayIndex = Math.min(dayIndex, totalDays)`.
- **Confidence:** High
- **Found by:** Logic & Correctness (Client)

### [I6] RecentSessions day labels use browser timezone, not configured timezone
- **File:** `packages/client/src/components/RecentSessions.tsx:12-15`
- **Bug:** "Today" and "Yesterday" labels are computed from `new Date()` (browser local time), while the velocity system uses a server-configured timezone. If these differ, labels are wrong.
- **Impact:** Sessions mislabeled as "Today"/"Yesterday" when browser and configured timezones differ.
- **Suggested fix:** Pass the server-provided `today` string to `RecentSessions` as a prop.
- **Confidence:** High
- **Found by:** Logic & Correctness (Client), Contract & Integration

## Suggestions

- **[S1]** `packages/server/src/routes/chapters.ts:104-115` — Velocity side-effects are `await`ed despite being "best-effort", blocking save response. Outer try/catch is dead code since inner functions swallow all errors. (Concurrency & State, Error Handling)
- **[S2]** `packages/client/src/components/VelocityView.tsx:38-61` — Stale data and error state displayed during slug transition; lacks the `dataWithSlug` guard that `DashboardView` uses. (Logic & Correctness, Concurrency & State)
- **[S3]** `packages/client/src/components/VelocityView.tsx:102` — Daily net words chart uses 90-day snapshot window; design specifies 30 days. (Plan Alignment)
- **[S4]** `packages/server/src/routes/velocity.ts:324` + `packages/client/src/components/SummaryStrip.tsx:42` — Negative `dailyAvg30d` displayed as raw negative number without context. (Error Handling, Contract & Integration)
- **[S5]** `packages/server/src/routes/velocity.ts:219-230` — Inconsistent date format between 30-day (full ISO) and 90-day (date-only) window boundaries. (Logic & Correctness)
- **[S6]** `packages/client/src/components/ProjectSettingsDialog.tsx:69-74` — Error revert resets ALL fields, not just the failed one. (Concurrency & State)
- **[S7]** `packages/client/src/components/ChapterTargetPopover.tsx:52-54` — Blur on empty input clears chapter target; accidental deletion risk. (Logic & Correctness)
- **[S8]** `packages/client/src/components/ProjectSettingsDialog.tsx:82-83` — Invalid word count (0, negative, NaN) silently ignored without user feedback or input revert. (Logic & Correctness)
- **[S9]** `packages/server/src/routes/projects.ts:179-181` — `completion_threshold` not validated against DB `chapter_statuses` table, unlike chapter `status`. (Error Handling)
- **[S10]** `packages/server/src/db/migrations/004_goals_velocity.js:52-53` — Migration seeds snapshot with UTC date instead of configured timezone (one-time, self-resolving). (Error Handling)
- **[S11]** `packages/shared/src/schemas.ts:18-31` — `target_deadline` accepts past dates without warning. (Error Handling)

## Plan Alignment

**Implemented:** Data model (SaveEvent, DailySnapshot, Setting tables + Project/Chapter columns), save side-effects, velocity endpoint with sessions/streaks/projection/completion, Settings UI with timezone, Project Settings dialog, Chapter target popover, Velocity tab with summary strip + daily word chart + burndown chart + recent sessions, editor status bar last session, recharts integration, accessibility (hidden data tables, aria-labels, reduced-motion), string externalization.

**Not yet implemented:** None apparent — the feature appears substantially complete.

**Deviations:**
- `calculateWordsToday` returns 0 on first day; design says show current total (C2)
- Settings PATCH error response collapses per-key errors into a single string instead of per-key object
- Streak join uses UTC date extraction instead of timezone-aware dates (I4)
- Daily net words chart uses 90-day window instead of design's 30-day spec (S3)
- BurndownChart is technically a burn-up chart (cumulative going up) rather than a burndown (remaining going down); information is equivalent but naming/direction differ

## Review Metadata

- **Agents dispatched:** Logic & Correctness (Server), Logic & Correctness (Client), Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment — 7 agents
- **Scope:** 80 changed files + adjacent callers/callees
- **Raw findings:** 38 (before verification)
- **Verified findings:** 20 (after verification)
- **Filtered out:** 18 (false positives, below threshold, duplicates)
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** docs/plans/2026-04-01-goals-velocity-design.md, docs/plans/2026-04-01-goals-velocity-plan.md
