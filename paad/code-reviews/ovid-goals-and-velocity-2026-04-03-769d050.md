# Agentic Code Review: ovid/goals-and-velocity

**Date:** 2026-04-03 16:15:00
**Branch:** ovid/goals-and-velocity -> main
**Commit:** 769d050eec4b14092423e2ffc39f4513d89b92a8
**Files changed:** 66 | **Lines changed:** +7120 / -128
**Diff size category:** Large

## Executive Summary

The goals & velocity feature is well-structured and largely aligns with the design document. The review found no critical bugs, but identified 5 important issues: inflated session net_words after a 30+ day gap, unrounded daily average display, days-remaining calculated from client clock instead of server timezone, a non-atomic daily snapshot upsert, and the shared `Chapter` type missing `target_word_count`. Several plan alignment deviations were also identified (missing progress ratio, no visual bar distinction for negative values, etc.).

## Critical Issues

None found.

## Important Issues

### [I1] Session baseline defaults to 0 outside 30-day query window
- **File:** `packages/server/src/routes/velocity.ts` (`deriveSessions` function, event query at ~lines 222-228)
- **Bug:** `deriveSessions` searches backward through the `events` array for a per-chapter baseline word count. Since `events` is filtered to the last 30 days, any chapter whose last save was >30 days ago will have no baseline found, defaulting to 0. This inflates `net_words` by the entire word count of that chapter.
- **Impact:** After a 31+ day break on a chapter, the first session back shows grossly inflated net words (potentially thousands of words from a single edit).
- **Suggested fix:** For each distinct chapter in the session, query the most recent SaveEvent before the 30-day window as a true baseline. Pass these baselines into `deriveSessions` or expand the query.
- **Confidence:** 80%
- **Found by:** Logic & Correctness

### [I2] `daily_average_30d` returned as unrounded float
- **File:** `packages/server/src/routes/velocity.ts:271`, `packages/client/src/components/SummaryStrip.tsx:37`
- **Bug:** `dailyAvg30d` is a raw division result (e.g., `342.857142857`). SummaryStrip displays it via `toLocaleString()` which shows all decimal places. The DailyWordChart also passes it as a ReferenceLine y-value.
- **Impact:** Design says "Daily average (30d): 1,200" — ugly display with many decimal places instead.
- **Suggested fix:** Round on the server: `Math.round(dailyAvg30d)`.
- **Confidence:** 88%
- **Found by:** Contract & Integration

### [I3] `daysRemaining` uses client `Date.now()` instead of server-provided `today`
- **File:** `packages/client/src/components/VelocityView.tsx:87-94`
- **Bug:** `daysRemaining` is calculated using `Date.now()` (client local clock) against the deadline string. The server provides `today` in the writer's configured timezone, but the client ignores it. `new Date("2026-06-01")` parses as UTC midnight, while `Date.now()` is the local wall clock.
- **Impact:** Off-by-one day in non-UTC timezones. A writer in UTC+12 could see incorrect days remaining.
- **Suggested fix:** Use the server-provided `today` for both sides of the calculation: `Math.ceil((new Date(deadline + 'T00:00:00').getTime() - new Date(data.today + 'T00:00:00').getTime()) / 86400000)`.
- **Confidence:** 85%
- **Found by:** Contract & Integration, Concurrency & State

### [I4] Non-atomic upsert on `daily_snapshots`
- **File:** `packages/server/src/routes/velocityHelpers.ts:54-70`
- **Bug:** `upsertDailySnapshot` performs a read-then-conditional-write without a transaction. Two concurrent saves for the same project can both read `existing` as null, then both attempt to insert, causing a UNIQUE constraint violation. The error is silently swallowed by the bare `catch {}`.
- **Impact:** A daily snapshot silently dropped. The total for that day is stale until the next successful save.
- **Suggested fix:** Use SQLite `INSERT ... ON CONFLICT(project_id, date) DO UPDATE SET total_word_count = excluded.total_word_count` via `knex.raw()`.
- **Confidence:** 75%
- **Found by:** Error Handling & Edge Cases, Concurrency & State

### [I5] `Chapter` interface missing `target_word_count`
- **File:** `packages/shared/src/types.ts:20-32`
- **Bug:** The `Chapter` interface does not include `target_word_count`, even though the migration adds the column, `UpdateChapterSchema` accepts it, and the dashboard endpoint returns it.
- **Impact:** TypeScript consumers using the `Chapter` type will not see `target_word_count`. Any code relying on the shared type for destructuring or mapping will silently drop the field.
- **Suggested fix:** Add `target_word_count: number | null;` to the `Chapter` interface.
- **Confidence:** 95%
- **Found by:** Logic & Correctness, Contract & Integration

### [I6] `currentTotal` / `wordsToday` uses stale snapshot instead of live chapter sum
- **File:** `packages/client/src/components/VelocityView.tsx:95-96`
- **Bug:** `currentTotal` is derived from the last daily snapshot's `total_word_count`. The server computes a live total from the chapters table (velocity.ts:277-281) for projection but does not include it in the response. If the snapshot upsert failed silently, the displayed total is stale.
- **Impact:** "Words today" may undercount if the snapshot is behind the actual current state.
- **Suggested fix:** Include the server-computed `currentTotal` in the velocity response and use it on the client.
- **Confidence:** 72%
- **Found by:** Concurrency & State

## Suggestions

- **[S1]** `velocity.ts:164` — `if (!targetWordCount)` falsely rejects 0; should be `=== null`. Safe today due to Zod `.positive()` but fragile. (Error Handling)
- **[S2]** `schemas.ts:53-60` / `settings.ts:44` — Arbitrary setting keys accepted and persisted without allowlist validation. (Error Handling, Security)
- **[S3]** `ProjectSettingsDialog.tsx:33-37` — `useState` initializers don't reset when `project` prop changes while dialog is open. (Concurrency & State)
- **[S4]** `velocity.ts:205-208` — Timezone queried from DB twice in the same request (once directly, once via `getTodayDate`). (Contract & Integration)
- **[S5]** `chapters.ts:104-112` — `insertSaveEvent` and `upsertDailySnapshot` are awaited sequentially; could use `Promise.all` for parallelism. (Error Handling, Concurrency & State)
- **[S6]** `client.ts:29` / `velocity.ts:292` — `completion.threshold_status` typed as `string` on client but server code allows `null` via `?? null`. (Contract & Integration)

## Plan Alignment

### Implemented
- Data model (all tables, columns, indexes, constraints, seeded baselines)
- Session derivation algorithm (30-min gap rule, baseline lookup, net words)
- Streak calculation (including "start from yesterday" rule)
- Save side-effects (SaveEvent insert + DailySnapshot upsert, best-effort)
- Adaptive display logic (burndown only with both target + deadline)
- Timezone handling (server default UTC, auto-detection, writer-timezone dates)
- Accessibility (hidden data tables, aria-labels, reduced-motion, semantic HTML)
- Language/tone (no judgmental language, encouraging projections)
- String externalization (all new strings in `strings.ts`)
- Recharts dependency added and documented in `dependency-licenses.md`
- All Zod schemas match the data model spec

### Not yet implemented
(Neutral — partial implementation expected.)

### Deviations
- **SummaryStrip missing word-count progress ratio:** Design expects `"42,000 / 80,000 words (52%)"` but only the target number is shown.
- **No visual distinction beyond color for positive/negative bars:** Design requires a Recharts-native visual distinction (rounded vs. square corners, reduced opacity, or custom shape) in DailyWordChart. Not implemented — all bars use the same style.
- **No differentiated color for negative bars:** Design says "warm accent color for positive, muted tone for negative." All bars use the same fill color.
- **Recent sessions format differs:** Missing time range (start-end times); shows chapter count instead of chapter identifiers.
- **Chart aria-label is static:** Design says it should include dynamic data summary (e.g., "averaging 1,200 words per day"). Current label is a static string.
- **Single day of data shows no chart:** Design says "one bar in chart" but `computeDailyNetWords` returns empty for <2 snapshots, so no chart renders.
- **"Words today" lacks `+` prefix:** Design shows `"+340"` but implementation uses bare `toLocaleString()`.
- **Extra `today` field in velocity response:** Not in design but useful for client-side timezone-consistent calculations.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** 66 changed files + adjacent callers/callees one level deep
- **Raw findings:** 31 (before verification)
- **Verified findings:** 12 (after verification)
- **Filtered out:** 19
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** docs/plans/2026-04-01-goals-velocity-design.md, docs/plans/2026-04-01-goals-velocity-plan.md
