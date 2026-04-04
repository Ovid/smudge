# Agentic Code Review: ovid/goals-and-velocity

**Date:** 2026-04-04 14:40:27
**Branch:** ovid/goals-and-velocity -> main
**Commit:** 4fc5ec0ef7a92114a86b435be2f3e437e9be4f8e
**Files changed:** 78 | **Lines changed:** +8,548 / -285
**Diff size category:** Large

## Executive Summary

The goals & velocity feature is substantially implemented and well-structured, but the review found 11 important issues and 7 suggestions. The highest-severity findings involve timezone boundary mismatches in the 30-day session window, inflated "words today" on the first day after deployment, sessions showing "Unknown Chapter" for deleted chapters, and `ProjectSettingsDialog` sending float values that the server rejects. No critical issues were found.

## Critical Issues

None found.

## Important Issues

### [I1] Streaks count non-writing days (deletes, restores) as active writing days
- **File:** `packages/server/src/routes/velocity.ts:271-278`
- **Bug:** Streak calculation uses `daily_snapshots` dates. Since `upsertDailySnapshot` is called on chapter delete (`chapters.ts:160`) and restore (`chapters.ts:228`), days where the user only deleted or restored a chapter — without writing — count toward the writing streak.
- **Impact:** Streak metric becomes "days you interacted with the app" rather than "days you wrote." Also a design deviation: the design doc specifies streaks should be derived from SaveEvent data, not DailySnapshot dates.
- **Suggested fix:** Either derive streak dates from `save_events` (as the design specifies), or filter to only snapshot dates where the word count increased from the prior day.
- **Confidence:** High
- **Found by:** Logic & Correctness (Server), Plan Alignment

### [I2] `calculateWordsToday` inflated for existing projects on first deploy
- **File:** `packages/shared/src/schemas.ts:73-88`
- **Bug:** When no prior-day snapshot exists (first day after migration), `calculateWordsToday` returns the full `currentTotal`. For a project with 50,000 existing words, the UI shows "+50,000 words today" on the first day.
- **Impact:** Misleading "words today" metric on the first day after deployment. Self-corrects the next day.
- **Suggested fix:** Return 0 when there are no prior-day snapshots and the only snapshot is today's (indicating baseline seeding, not actual writing).
- **Confidence:** High
- **Found by:** Logic & Correctness (Server), Error Handling & Edge Cases

### [I3] 30-day window boundary misaligned by timezone offset
- **File:** `packages/server/src/routes/velocity.ts:228-231`
- **Bug:** The 30-day window for save_events uses `thirtyDaysAgo.toISOString()` which produces a UTC midnight boundary (e.g., `2026-03-05T00:00:00.000Z`). But `today` from `getTodayDate` is timezone-aware. For a user in UTC-4, save events near the boundary can be incorrectly included or excluded — up to ~12 hours of drift depending on timezone offset.
- **Impact:** Sessions at the edges of the 30-day window may be misclassified. Daily snapshots use the correct timezone-aware date strings, but save_events don't, creating an inconsistency.
- **Suggested fix:** Compute `thirtyDaysAgoStr` as the UTC equivalent of the user's local midnight 30 days ago, not UTC midnight.
- **Confidence:** High
- **Found by:** Logic & Correctness (Server), Error Handling & Edge Cases

### [I4] Project soft-delete skips daily snapshot upsert
- **File:** `packages/server/src/routes/projects.ts:486-514`
- **Bug:** When a project is soft-deleted (`DELETE /:slug`), all chapters are soft-deleted but `upsertDailySnapshot` is never called. Compare with chapter delete (`chapters.ts:160`) and restore (`chapters.ts:228`) which both call it.
- **Impact:** The daily snapshot for that day retains the old word count. If the project is restored same-day, velocity calculations will be incorrect until the next save.
- **Suggested fix:** Add `await upsertDailySnapshot(db, project.id);` after the soft-delete transaction.
- **Confidence:** Medium
- **Found by:** Logic & Correctness (Server)

### [I5] `computeDailyNetWords` drops first day for multi-day datasets
- **File:** `packages/client/src/components/VelocityView.tsx:16-37`
- **Bug:** For 2+ snapshots, the function starts its loop at `i = 1` and computes deltas, but never includes the first day. With 3 days of data, the chart shows 2 bars. For a single snapshot, it correctly shows the absolute count. This inconsistency means the first day disappears from the chart when a second day of data arrives.
- **Impact:** Daily word chart is missing a bar for the earliest date. Users with only 2 days of data see 1 bar.
- **Suggested fix:** Include the first day as an entry (using its absolute word count, matching the single-snapshot case).
- **Confidence:** High
- **Found by:** Logic & Correctness (Client)

### [I6] `chapter_names` excludes deleted chapters but sessions reference them
- **File:** `packages/server/src/routes/velocity.ts:332-370`
- **Bug:** The `chapters` query filters `whereNull("deleted_at")`, so `chapterNames` only includes active chapters. But `save_events` deliberately includes events for soft-deleted chapters (the code comment on line 227 confirms this intent). Sessions referencing deleted chapters display "Unknown Chapter" in the UI.
- **Impact:** If a writer deletes a chapter that had recent sessions, those sessions show "Unknown Chapter" instead of the actual title, which is confusing. The design says sessions should reflect historical truth.
- **Suggested fix:** Query chapter names from all chapters (including soft-deleted) for the `chapter_names` map.
- **Confidence:** High
- **Found by:** Contract & Integration

### [I7] `ProjectSettingsDialog` sends float word counts that server rejects
- **File:** `packages/client/src/components/ProjectSettingsDialog.tsx:82`
- **Bug:** The blur handler uses `Number(wordCountTarget)` which preserves decimals. The server's `UpdateProjectSchema` requires `.int()`, so "50.5" → 50.5 → 400 error. The `<input type="number">` allows decimals by default (no `step="1"`). Compare with `ChapterTargetPopover` which uses `parseInt(draft, 10)` — a divergent parsing approach.
- **Impact:** User enters a decimal, sees a save error, and all three fields revert (see S3). No clear indication of what went wrong.
- **Suggested fix:** Use `parseInt` or `Math.round` in the blur handler, and add `step="1"` to the input. Align both components on the same parsing approach.
- **Confidence:** High
- **Found by:** Contract & Integration

### [I8] Failed baseline query silently inflates session net_words
- **File:** `packages/server/src/routes/velocity.ts:243-262`
- **Bug:** If the pre-window baseline query fails, the catch block logs the error and continues with empty `preWindowBaselines`. `deriveSessions` then uses baseline 0 for all chapters (`baselines[chapterId] ?? 0`). For a chapter with 10,000 words that added 50, the session shows +10,000 instead of +50.
- **Impact:** Sessions display wildly inflated net_words with no visible indication that data is inaccurate.
- **Suggested fix:** Fall back to each chapter's first event in the window rather than zero, or propagate the error.
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases

### [I9] `ProjectSettingsDialog` state doesn't sync when project prop changes
- **File:** `packages/client/src/components/ProjectSettingsDialog.tsx:33-37`
- **Bug:** `useState` initializers only run on mount. If the `project` prop updates while the dialog is open (e.g., from `onUpdate` triggering a re-fetch), local state is stale. Note: the parent `EditorPage` uses a `key` prop (line 774) that forces remount on project data changes, which partially mitigates this. But between the save and the re-fetch completing, the dialog could show stale data.
- **Impact:** User can see outdated field values after a successful save by another field.
- **Suggested fix:** Add a `useEffect` syncing local state when project prop values change, or rely entirely on the key-based remount (which currently works but is fragile).
- **Confidence:** Medium
- **Found by:** Logic & Correctness (Client)

### [I10] Unbounded `save_events` table growth with no pruning
- **File:** `packages/server/src/routes/velocityHelpers.ts:29-48`
- **Bug:** Every auto-save (~1.5s during editing) inserts a `save_events` row. At ~240 saves/day for 4 hours of writing, that's ~87,600 rows/year per project. The velocity endpoint only queries the last 30 days. There is no cleanup mechanism (unlike the 30-day trash purge).
- **Impact:** Over months, the table grows unbounded. The correlated NOT EXISTS subquery for pre-window baselines (velocity.ts:244-254) scales poorly with table size.
- **Suggested fix:** Add periodic pruning of save_events older than 90-120 days, similar to the trash purge on server startup.
- **Confidence:** Medium
- **Found by:** Security

### [I11] Migration 005 not wrapped in a transaction; partial failure leaves broken state
- **File:** `packages/server/src/db/migrations/005_cascade_velocity_fks.js:7-31`
- **Bug:** The migration runs sequential DDL: CREATE new table → INSERT data → DROP old → RENAME new → CREATE index, for two tables. If the process crashes between DROP and RENAME, the application will fail on every query referencing `save_events`.
- **Impact:** Partial migration failure leaves the database in an unrecoverable state without manual intervention.
- **Suggested fix:** Wrap each table's four operations in a transaction. SQLite supports DDL within transactions.
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases

## Suggestions

### [S1] 30-day average can go negative
- `packages/server/src/routes/velocity.ts:312` — When content is deleted over 30 days, the average goes negative and displays in the UI as a negative number. Consider clamping to `Math.max(0, ...)`.
- **Found by:** Logic & Correctness (Server), Error Handling & Edge Cases

### [S2] `ChapterTargetPopover.handleSave` silently swallows errors
- `packages/client/src/components/ChapterTargetPopover.tsx:34-41` — Empty `catch` block means user gets no feedback on save failure. Compare with `ProjectSettingsDialog` which shows an error message.
- **Found by:** Logic & Correctness (Client)

### [S3] Error revert in ProjectSettingsDialog resets ALL fields
- `packages/client/src/components/ProjectSettingsDialog.tsx:69-74` — When one field's save fails, all three fields revert to original values, even if the other fields saved successfully.
- **Found by:** Concurrency & State

### [S4] `RecentSessions` uses browser timezone for Today/Yesterday labels
- `packages/client/src/components/RecentSessions.tsx:12-15` — `formatSessionDate` uses `new Date()` for day boundaries, not the server-provided `today` string. Could mislabel sessions for users with browser timezone != configured timezone.
- **Found by:** Contract & Integration

### [S5] User input reflected in settings error messages
- `packages/server/src/routes/settings.ts:49` — Raw `value` string interpolated into error response. Minor security hygiene concern (not exploitable since response is JSON, not HTML).
- **Found by:** Security

### [S6] Single day of data shows average and projection (design says don't)
- `packages/server/src/routes/velocity.ts:286-312` — With one day of data, the daily average equals the total change, and a projection is computed. Design doc says "No average or projection shown" for single-day data.
- **Found by:** Plan Alignment

### [S7] Dead outer try/catch around velocity side-effects
- `packages/server/src/routes/chapters.ts:103-116` — Both `insertSaveEvent` and `upsertDailySnapshot` have internal try/catch blocks that swallow errors. The outer try/catch can never fire. A failed save event insert doesn't prevent the snapshot upsert, creating a minor data inconsistency.
- **Found by:** Error Handling & Edge Cases

## Plan Alignment

- **Implemented:** Data model (all tables and columns), API endpoints (settings, project targets, chapter targets, velocity), session derivation with baselines, streak calculation, adaptive UI display, summary strip, charts with accessibility, project/app settings dialogs, chapter target popovers, editor status bar, timezone handling, migration with baseline seeding, e2e tests
- **Not yet implemented:** No items identified as missing from the plan
- **Deviations:**
  - Streak source changed from SaveEvent data to DailySnapshot dates (performance optimization, documented in code comment) [I1]
  - Velocity response shape includes undocumented extra fields (`today`, `current_total`, `chapter_names`) — practical additions that support client needs
  - Single-day-of-data edge case shows average/projection instead of suppressing them [S6]

## Review Metadata

- **Agents dispatched:** Logic & Correctness (Server), Logic & Correctness (Client), Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** 78 changed files + adjacent callers/callees (velocity routes, chapter/project routes, settings, shared schemas/types, client components, API client, migrations)
- **Raw findings:** 30 (before verification)
- **Verified findings:** 18 (after verification)
- **Filtered out:** 12 (4 dropped below confidence threshold, 8 deduplicated)
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** docs/plans/2026-04-01-goals-velocity-design.md, docs/plans/2026-04-01-goals-velocity-plan.md
