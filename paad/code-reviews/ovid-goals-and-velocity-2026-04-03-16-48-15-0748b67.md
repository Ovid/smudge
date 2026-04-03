# Agentic Code Review: ovid/goals-and-velocity

**Date:** 2026-04-03 16:48:15
**Branch:** ovid/goals-and-velocity -> main
**Commit:** 0748b67fac5067029dce66ae928258d78a5547cf
**Files changed:** 72 | **Lines changed:** +7571 / -128
**Diff size category:** Large

## Executive Summary

The goals & velocity feature is substantial and well-structured, with correct session derivation, proper Zod validation, and solid accessibility scaffolding (hidden data tables, reduced motion support). Three critical issues stand out: the 30-day average calculation uses the wrong denominator (snapshot span instead of 30 days), producing wildly inflated projections for bursty writers; and two blur/clear race conditions in ProjectSettingsDialog and ChapterTargetPopover silently corrupt user-set values. Six additional important issues include excessive velocity API calls per save, missing FK cascades that will break hard-purge, and a WCAG AA violation in the daily word chart.

## Critical Issues

### [C1] 30-day average denominator uses snapshot span, not 30 days
- **File:** `packages/server/src/routes/velocity.ts:268-282`
- **Bug:** `dailyAvg30d` divides `(newest.total_word_count - oldest.total_word_count)` by `daysBetween` (the gap between the oldest and newest snapshot in the 30-day window). For a writer who had a productive burst on days 1-2 then stopped, `daysBetween = 1` and the "30-day average" is 15x the correct value. Additionally, if the writer deleted more than they wrote, `dailyAvg30d` goes negative, silently suppressing `projected_date` with no user feedback.
- **Impact:** Daily average, projected completion date, and burndown chart are all wildly wrong for any writer who didn't write consistently over the full 30-day window. This is the most user-visible stat on the velocity tab.
- **Suggested fix:** Divide by 30 (or by `min(30, days since first snapshot)` for new projects). Clamp to 0 or surface negative averages explicitly.
- **Confidence:** High
- **Found by:** Logic & Correctness, Error Handling & Edge Cases

### [C2] Blur/clear race in ProjectSettingsDialog word count field
- **File:** `packages/client/src/components/ProjectSettingsDialog.tsx:69-83,128-135`
- **Bug:** Clicking the "Clear" button on the word count field triggers `onBlur` first (saving the old value), then the click handler (saving `null`). Two concurrent `PATCH` requests race. The last one to settle wins non-deterministically, so the clear may silently fail and the server retains the old target while the UI shows empty.
- **Impact:** Silent data integrity failure — user believes they cleared the target but it persists.
- **Suggested fix:** In `handleWordCountBlur`, check `e.relatedTarget` to skip saving when focus moves to the Clear button. Or use an `AbortController` to cancel in-flight requests.
- **Confidence:** High
- **Found by:** Concurrency & State

### [C3] Blur/clear race in ChapterTargetPopover
- **File:** `packages/client/src/components/ChapterTargetPopover.tsx:43-54`
- **Bug:** Same pattern as C2. `handleBlur` fires before `handleClear`, sending two conflicting `PATCH` requests. The last writer wins, and the Clear action may silently fail.
- **Impact:** Same silent data integrity failure as C2 for per-chapter targets.
- **Suggested fix:** Same as C2 — check `relatedTarget` on blur, or cancel the in-flight request.
- **Confidence:** High
- **Found by:** Concurrency & State

## Important Issues

### [I1] Velocity endpoint fires twice per save cycle
- **File:** `packages/client/src/pages/EditorPage.tsx:129-147`
- **Bug:** The `useEffect` that fetches `lastSession` fires when `saveStatus` is `"saved"` or `"idle"`. A single auto-save cycle transitions `saving → saved → idle`, triggering two full velocity API calls (5+ DB queries each). Also fires on component mount (`idle` is the initial state).
- **Impact:** Approximately doubles the server load from velocity queries during active writing. On slow connections, two in-flight requests race to update `lastSession`.
- **Suggested fix:** Only trigger on `"saved"` (remove `"idle"` from the guard), or use a ref to track whether a save actually occurred.
- **Confidence:** High
- **Found by:** Logic & Correctness, Concurrency & State

### [I2] Missing ON DELETE CASCADE on save_events and daily_snapshots FKs
- **File:** `packages/server/src/db/migrations/004_goals_velocity.js:23-28,34-39`
- **Bug:** `save_events.chapter_id → chapters(id)` and `daily_snapshots.project_id → projects(id)` lack `.onDelete("CASCADE")`. When the background purge hard-deletes chapters/projects after 30 days, the FK constraints will either block the delete (if `PRAGMA foreign_keys = ON`) or leave orphaned rows (if FKs are off).
- **Impact:** Hard-purge will fail at runtime or accumulate orphaned rows indefinitely.
- **Suggested fix:** Add `.onDelete("CASCADE")` to both FKs, or explicitly delete from `save_events`/`daily_snapshots` before purging.
- **Confidence:** High
- **Found by:** Contract & Integration

### [I3] Silent fallback to completedChapters=0 when threshold status not found
- **File:** `packages/server/src/routes/velocity.ts:308-327`
- **Bug:** When `completionThreshold` is not found in `chapter_statuses`, `thresholdSortOrder` silently falls back to 999, making `completedChapters` always 0 regardless of actual chapter statuses.
- **Impact:** Misleading "0 of N chapters complete" if a data inconsistency occurs.
- **Suggested fix:** Log a warning or return an error when `thresholdRow` is null instead of using a silent 999 fallback.
- **Confidence:** Medium
- **Found by:** Error Handling & Edge Cases

### [I4] Deadline field fires PATCH on every onChange
- **File:** `packages/client/src/components/ProjectSettingsDialog.tsx:75-78`
- **Bug:** `handleDeadlineChange` calls `saveField` on every `onChange` event. On browsers where manual text entry into a `<input type="date">` fires onChange per character, partial date strings (e.g., `"2026-0"`) produce 400 errors that are silently swallowed by the catch block.
- **Impact:** Stream of 400 errors on the server during manual date entry; no user feedback.
- **Suggested fix:** Save on `onBlur` instead of `onChange` (matching the word count field's pattern), or debounce.
- **Confidence:** Medium
- **Found by:** Error Handling & Edge Cases

### [I5] DailyWordChart: positive/negative bars indistinguishable without color
- **File:** `packages/client/src/components/DailyWordChart.tsx:31-36`
- **Bug:** Both positive and negative bars use identical fill (`#6B4720`), radius, and opacity. The design doc requires "a Recharts-native visual distinction in addition to color (e.g., rounded vs. square bar corners, reduced opacity)." Color is the sole carrier of the positive/negative distinction.
- **Impact:** WCAG 2.1 AA violation. Users who cannot perceive color cannot distinguish growth from deletion bars. Violates the project's first-class accessibility constraint.
- **Suggested fix:** Use Recharts `Cell` component to conditionally set fill opacity (e.g., 1.0 for positive, 0.4 for negative) or use a custom shape with different corner radius.
- **Confidence:** High
- **Found by:** Plan Alignment

### [I6] Streak computed from daily_snapshots, not save_events as specified
- **File:** `packages/server/src/routes/velocity.ts:253-260`
- **Bug:** The design specifies streaks are "computed from SaveEvent data." The implementation uses `daily_snapshots` dates. These usually align, but diverge when: (a) `upsertDailySnapshot` fails silently (a save happened but no snapshot was created), or (b) the migration seeds snapshots for all existing projects on migration day, inflating streak data.
- **Impact:** Post-migration, all existing projects show at least 1 day of streak from the seeded snapshot, even if no actual writing occurred that day.
- **Suggested fix:** Use `save_events` for streak calculation (with `DISTINCT date(saved_at, timezone)` query), or document the deviation and accept the minor inflation.
- **Confidence:** Medium
- **Found by:** Plan Alignment

## Suggestions

- `packages/server/src/routes/velocityHelpers.ts:23-26` — `getTodayDate` falls back to `"1970-01-01"` if Intl.DateTimeFormat parts are missing. Consider throwing or falling back to `new Date().toISOString().slice(0,10)` (UTC today) instead. *(Error Handling)*
- `packages/client/src/hooks/useTimezoneDetection.ts:7` — `Intl.DateTimeFormat().resolvedOptions().timeZone` can be `undefined` or empty in rare environments. Add a guard (`if (tz && tz.length > 0)`) before sending to the API. *(Error Handling)*
- `packages/client/src/components/SummaryStrip.tsx:34` — "Words today" value doesn't include a `+` sign prefix for positive values. The footer status bar already uses `+` for session net words, creating an inconsistency. *(Plan Alignment)*

## Plan Alignment

- **Implemented:** Database migration, save event + daily snapshot side-effects, session derivation (30-min gap), streak calculation, projection, completion stats, settings API with timezone validation, velocity endpoint, summary strip, daily word chart, burndown chart, recent sessions, project settings dialog, app settings dialog, chapter target popover, timezone auto-detection, string externalization, recharts integration, hidden data tables for screen readers, `prefers-reduced-motion` support.
- **Not yet implemented:** None identified — all design doc features appear to be present.
- **Deviations:** Daily chart lacks non-color bar distinction (I5), streak source is daily_snapshots not save_events (I6), "Words today" missing `+` prefix, 30-day average denominator wrong (C1).

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** 72 changed files + callers/callees one level deep
- **Raw findings:** 30 (before verification)
- **Verified findings:** 12 (after verification)
- **Filtered out:** 18
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** `docs/plans/2026-04-01-goals-velocity-design.md`, `docs/plans/2026-04-01-goals-velocity-plan.md`
