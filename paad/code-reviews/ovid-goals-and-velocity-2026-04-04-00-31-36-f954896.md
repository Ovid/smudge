# Agentic Code Review: ovid/goals-and-velocity

**Date:** 2026-04-04 00:31:36
**Branch:** ovid/goals-and-velocity -> main
**Commit:** f954896119d1e570b4c47e5ca933f76074018bad
**Files changed:** 76 | **Lines changed:** +8170 / -146
**Diff size category:** Large

## Executive Summary

The Goals & Velocity feature is well-implemented overall, with solid Zod validation, proper parameterized SQL, good accessibility (hidden data tables, aria-labels, reduced-motion support), and a clean API design. The most significant issues are: (1) the 30-day average calculation produces misleadingly low values for new projects, (2) stale velocity data persists in the editor footer after navigating between projects, and (3) silent query failures in the velocity pipeline can produce incorrect session statistics without any user-visible indication.

## Critical Issues

None found.

## Important Issues

### [I1] `dailyAvg30d` always divides by 30, even for projects younger than 30 days
- **File:** `packages/server/src/routes/velocity.ts:286`
- **Bug:** The 30-day average is computed as `(newest.total_word_count - baselineTotal) / 30` regardless of how many days of data exist. A project with 5 days of history at 500 words/day will show ~83 words/day instead of 500.
- **Impact:** Cascades into `calculateProjection()`, making projected completion dates wildly pessimistic for new projects. Displayed in the summary strip as a misleadingly low daily average.
- **Suggested fix:** Compute the actual number of days between the baseline snapshot date and the newest, and use `Math.min(actualDays, 30)` as the divisor.
- **Confidence:** High
- **Found by:** Logic & Correctness, Plan Alignment

### [I2] `hasFetchedInitial` ref never resets on slug change; stale `lastSession` persists
- **File:** `packages/client/src/pages/EditorPage.tsx:129-157`
- **Bug:** `hasFetchedInitial` is set to `true` after the first velocity fetch and never reset when the user navigates to a different project. After navigation, the velocity fetch only triggers when `saveStatus === "saved"` AND the 60s throttle has elapsed. Meanwhile, `lastSession` from the previous project continues displaying in the status bar.
- **Impact:** The editor footer shows stale session data (duration, word count) from the wrong project after navigation.
- **Suggested fix:** Reset `hasFetchedInitial.current = false`, `lastVelocityFetch.current = 0`, and `setLastSession(null)` when `slug` changes.
- **Confidence:** High
- **Found by:** Concurrency & State

### [I3] Streak counts any snapshot day as a "writing day" regardless of net word change
- **File:** `packages/server/src/routes/velocity.ts:264-272`
- **Bug:** The streak is derived from `daily_snapshots` dates. Since `upsertDailySnapshot` fires on every content save (even if word count is unchanged or decreased), any editing activity -- including pure deletions or formatting changes that trigger auto-save -- extends the streak.
- **Impact:** The streak metric becomes a measure of "days I opened the editor and typed something" rather than "days I made progress." Depending on the desired semantics this may or may not be a bug, but the design doc says "A day counts as a writing day if any save occurred that day -- regardless of whether the word count changed," so this is actually aligned with the spec. Flagging for awareness.
- **Suggested fix:** If the intent is to track productive writing days only, filter snapshots to those where `total_word_count` increased relative to the previous day's snapshot.
- **Confidence:** Medium
- **Found by:** Logic & Correctness

### [I4] Silent baseline query failure inflates session `net_words`
- **File:** `packages/server/src/routes/velocity.ts:237-256`
- **Bug:** The `preWindowBaselines` query is wrapped in a try/catch that silently falls back to `{}`. When baselines are missing, `deriveSessions` defaults to `0` for chapters with history older than 30 days, treating their entire word count as "net new" in the session.
- **Impact:** If the query fails (DB lock, corrupt index, etc.), all sessions show dramatically inflated net_words with no indication that something went wrong.
- **Suggested fix:** At minimum, log the error. Consider letting the error propagate since a 500 is more honest than silently wrong data on a read-only endpoint.
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases

### [I5] Silent `upsertDailySnapshot` failure breaks streaks and averages
- **File:** `packages/server/src/routes/velocityHelpers.ts:51-69`
- **Bug:** `upsertDailySnapshot` wraps everything in try/catch that only logs. If the upsert fails persistently, that day's snapshot is never written. Streaks break, and the 30-day average becomes stale.
- **Impact:** The user's writing streak could be incorrectly broken and their daily average would be wrong, with the only evidence being a `console.error` in server logs.
- **Suggested fix:** Consider detecting stale snapshots in the velocity handler (compare latest snapshot date against `today`) and flag staleness in the response so the client can display a warning.
- **Confidence:** Medium
- **Found by:** Error Handling & Edge Cases

## Suggestions

- `packages/client/src/components/VelocityView.tsx:16-37` — `computeDailyNetWords` shows absolute count for 1 snapshot but delta-only for 2+; the first day vanishes from the chart when a second snapshot arrives. Consider including the first day consistently. (Logic & Correctness)
- `packages/server/src/routes/velocity.ts:178` — When `currentTotal >= targetWordCount`, `projected_date` is null and the UI shows "No projection" rather than "Goal reached." Consider adding a "target met" state. (Logic & Correctness)
- `packages/server/src/routes/velocity.ts:290-294` / `packages/server/src/routes/velocityHelpers.ts:54-58` — Duplicated "sum chapters word count" query pattern. Extract to a shared helper to prevent divergence. (Contract & Integration)
- `packages/server/src/routes/settings.ts:49` — Error message reflects raw user-supplied `value` verbatim. Consider omitting the raw value: `` `Invalid value for ${key}` ``. (Security)
- `packages/client/src/components/ProjectSettingsDialog.tsx:69-74` — On save error, all three fields are reverted to prop values, which may be stale if a concurrent save for a different field succeeded. Consider tracking last-known-good values per field. (Logic & Correctness, Error Handling, Concurrency)

## Plan Alignment

- **Implemented:** All core design items — data model (SaveEvent, DailySnapshot, Setting), migration with seeds, session derivation (30m gap, net words), streak calculation, velocity API endpoint, projection, timezone handling, Settings API, Project Settings dialog, App Settings dialog, Summary strip, Daily word chart, Burndown chart, Recent sessions, Editor status bar, chapter target_word_count, adaptive display, accessibility (hidden data tables, aria-labels, reduced-motion), string externalization.
- **Not yet implemented:** Chapter target inline popover (clicking word count in dashboard table). Client-side timezone auto-detection on first launch.
- **Deviations:** Streak uses DailySnapshot dates instead of SaveEvent dates (deliberate optimization, functionally equivalent). Velocity response includes extra fields (`today`, `current_total`, `chapter_names`) beyond the design spec (additive, not contradictory).

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** 76 changed files + adjacent callers/callees (velocity pipeline, settings, project/chapter PATCH, client components, shared schemas/types)
- **Raw findings:** 25 (before verification)
- **Verified findings:** 10 (after verification)
- **Filtered out:** 15
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** docs/plans/2026-04-01-goals-velocity-design.md, docs/plans/2026-04-01-goals-velocity-plan.md
