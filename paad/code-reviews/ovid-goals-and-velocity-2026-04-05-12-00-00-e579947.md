# Agentic Code Review: ovid/goals-and-velocity

**Date:** 2026-04-05 12:00:00
**Branch:** ovid/goals-and-velocity -> main
**Commit:** e57994709fbf1cb3b3df17e5b2e91e140d53391e
**Files changed:** 87 | **Lines changed:** +9,250 / -289
**Diff size category:** Large

## Executive Summary

The Goals & Velocity feature is well-implemented with strong type safety, proper Zod validation, and good separation of concerns. The VelocityResponse contract between server and client is consistent. Five Important-severity issues were found: a burndown chart edge case with past deadlines, two input validation UX bugs where invalid values aren't reverted, a concurrent PATCH race in the project settings dialog, and a velocity fetch throttle that blocks retries after failures. No Critical issues found.

## Critical Issues

None found.

## Important Issues

### [I1] BurndownChart produces nonsensical values when startDate >= targetDeadline
- **File:** `packages/client/src/components/BurndownChart.tsx:39`
- **Bug:** When the earliest snapshot date is at or after the target deadline (e.g., user sets a past deadline), `dayIndex` can go negative because `Math.min(totalDays, Math.ceil(...))` has no lower-bound clamp. This produces planned pace values below the start word count, rendering a misleading chart.
- **Impact:** Confusing visual data when deadline is in the past or very close to project start.
- **Suggested fix:** Clamp `dayIndex` to `Math.max(0, Math.min(totalDays, ...))`, or return `null` when `startDate >= targetDeadline` to skip the planned pace line.
- **Confidence:** High
- **Found by:** Logic & Correctness

### [I2] Invalid word count input silently kept in ProjectSettingsDialog
- **File:** `packages/client/src/components/ProjectSettingsDialog.tsx:78-85`
- **Bug:** When the user enters an invalid word count target (zero, negative, NaN) and blurs, `handleWordCountBlur` returns early without saving *and* without reverting the displayed value. The input shows the invalid text while the server retains the old value.
- **Impact:** User sees one value, server has another, with no error message or visual indication.
- **Suggested fix:** On the early-return path, revert: `setWordCountTarget(project.target_word_count != null ? String(project.target_word_count) : "")`.
- **Confidence:** High
- **Found by:** Error Handling, Concurrency & State

### [I3] Same invalid-input-not-reverted pattern in ChapterTargetPopover
- **File:** `packages/client/src/components/ChapterTargetPopover.tsx:48-60`
- **Bug:** Identical to I2. Invalid chapter word count targets cause early return from `handleBlur` without reverting the draft or showing an error.
- **Impact:** Same as I2 — displayed value diverges from persisted value silently.
- **Suggested fix:** Add `setDraft(targetWordCount?.toString() ?? "")` on the invalid-input path.
- **Confidence:** High
- **Found by:** Error Handling

### [I4] Concurrent PATCH failure reverts ALL fields to stale props in ProjectSettingsDialog
- **File:** `packages/client/src/components/ProjectSettingsDialog.tsx:61-76`
- **Bug:** `saveField` is async with no serialization. If two rapid field changes cause concurrent PATCHes and the second fails, the catch block (lines 70-74) reverts *all three* local fields to the `project` prop values, undoing the first successfully-saved field's display state. The prop hasn't updated yet because the re-fetch triggered by `onUpdate` is still in flight.
- **Impact:** Successfully-saved settings visually revert to old values, confusing the user.
- **Suggested fix:** Either serialize saves (queue pattern), or only revert the specific field that failed.
- **Confidence:** High
- **Found by:** Error Handling, Concurrency & State

### [I5] Failed velocity fetch blocks retries for 60 seconds
- **File:** `packages/client/src/pages/EditorPage.tsx:148`
- **Bug:** `lastVelocityFetch.current = Date.now()` is set *before* the fetch promise resolves. If the fetch fails (network error, server down), the timestamp is already recorded, blocking any retry for 60 seconds even though no data was received.
- **Impact:** After a transient network error, the status bar shows stale or no session data for up to 60 seconds with no retry.
- **Suggested fix:** Move `lastVelocityFetch.current = Date.now()` into the `.then()` handler so it's only set on success.
- **Confidence:** High
- **Found by:** Concurrency & State

## Suggestions

- **[S1]** `RecentSessions.tsx:10-29` — Today/yesterday label computation assumes browser timezone matches server-configured timezone. If they differ, sessions near midnight may show wrong day labels. Consider extracting the date from the ISO string directly.
- **[S2]** `VelocityView.tsx:23` — First day of daily net words chart always shows 0 (no prior day to diff). This is by-design baseline behavior but may surprise users on day one.
- **[S3]** `velocity.ts:249-263` — Pre-window baseline query can return multiple rows per chapter if two save events share the exact same `saved_at` timestamp. Extremely rare but could be guarded with a window function.
- **[S4]** `velocityHelpers.ts:23-25` — `getTodayDate` falls back to `1970-01-01` if `Intl.DateTimeFormat.formatToParts` returns unexpected output. Consider validating the parts and falling back to `new Date().toISOString().slice(0, 10)` instead.
- **[S5]** `velocity.ts:334` — `dailyAvg30d` can be negative if the writer deleted more than they wrote. Consider clamping to 0 or displaying differently.
- **[S6]** `SettingsDialog.tsx` + `ProjectSettingsDialog.tsx` — Duplicated dialog open/close boilerplate with try/catch for happy-dom. Could be extracted to a `useDialogControl` hook.
- **[S7]** `EditorPage.tsx:784` — `key` prop on ProjectSettingsDialog includes all settings values. Successful save triggers remount, which can reset in-progress edits in other fields.
- **[S8]** `ProjectSettingsDialog.tsx:78-85` — `handleWordCountBlur` does not `await saveField`, so closing the dialog immediately after blur can race with the in-flight save.

## Plan Alignment

**Implemented:** All major features from the design document are implemented — data model (SaveEvent, DailySnapshot, Setting tables + Project/Chapter columns), snapshot collection on save, session derivation with 30-min gap, streak calculation, projection, completion stats, velocity API endpoint, Settings UI, Project Settings dialog, Chapter Target popover, Velocity tab with charts and summary strip, editor status bar session info, string externalization, accessibility features (aria-labels, hidden data tables, reduced-motion support).

**Not yet implemented:** None identified — the feature appears complete.

**Deviations:**
- SaveEvent has an additional `save_date` column (not in design) for optimized streak queries — additive enhancement
- VelocityResponse includes extra `today`, `current_total`, `chapter_names` fields — additive, needed by client
- Burndown chart is actually a "burn-up" chart (counts up toward target rather than remaining work counting down) — naming/conceptual divergence
- Settings PATCH error response concatenates errors into a single message rather than per-key error object
- Dashboard uses top-level view-mode toggle (Editor/Preview/Dashboard) rather than sub-tabs within the dashboard view

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** 87 changed files + adjacent callers/callees
- **Raw findings:** 23 (before verification)
- **Verified findings:** 13 (5 Important, 8 Suggestions)
- **Filtered out:** 10 (1 rejected, 7 plan alignment observations, 2 below threshold)
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** docs/plans/2026-04-01-goals-velocity-design.md
