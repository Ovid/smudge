# Agentic Code Review: ovid/goals-and-velocity

**Date:** 2026-04-03
**Branch:** ovid/goals-and-velocity -> main
**Commit:** 499da131eb5e7aa3e4cd4ed70262c7b1bc01a4cb
**Files changed:** 65 | **Lines changed:** +6,978 / -128
**Diff size category:** Large

## Executive Summary

The goals & velocity feature is well-structured and largely complete. The most significant bugs are: (1) `daysRemaining` in VelocityView uses the client clock instead of the server-provided timezone-aware `today`, causing off-by-one errors; (2) velocity helper functions silently swallow all errors with no logging; and (3) several UI components deviate from the design spec regarding progress fraction display and negative bar visual distinction. The shared `Chapter` type is also missing the new `target_word_count` field. Overall confidence is moderate-high -- 4 of 6 specialists independently flagged the same timezone bug.

## Critical Issues

None found.

## Important Issues

### [I1] `daysRemaining` uses client `Date.now()` instead of server-provided `today`
- **File:** `packages/client/src/components/VelocityView.tsx:37,87-93`
- **Bug:** `const [now] = useState(() => Date.now())` is captured once at mount time and used for deadline calculation. The server provides `data.today` (timezone-aware) but it's ignored for this calculation. Two problems: (1) stale across long sessions, (2) client timezone may differ from configured writer timezone, causing off-by-one in days remaining.
- **Impact:** Off-by-one day count for any user whose browser timezone differs from their configured writing timezone. Value freezes if dashboard is left open overnight.
- **Suggested fix:** Compute from server-provided date strings:
  ```ts
  const daysRemaining = data.projection.target_deadline
    ? Math.max(0, Math.ceil(
        (new Date(data.projection.target_deadline + "T00:00:00Z").getTime() -
         new Date(data.today + "T00:00:00Z").getTime()) / (1000 * 60 * 60 * 24)
      ))
    : null;
  ```
- **Confidence:** High
- **Found by:** Logic & Correctness, Error Handling, Contract & Integration, Concurrency & State (4 specialists)

### [I2] Silent error swallowing in velocity helpers (no logging)
- **File:** `packages/server/src/routes/velocityHelpers.ts:40-42,71-73`
- **Bug:** Both `insertSaveEvent` and `upsertDailySnapshot` have empty `catch {}` blocks with only a comment "Best-effort: next save retries." No logging whatsoever. If velocity tracking breaks (schema drift, disk full, constraint violation), it fails invisibly on every save.
- **Impact:** Impossible to diagnose velocity data gaps. A structural failure would silently corrupt all velocity data without any operational signal.
- **Suggested fix:** Add `console.error("Failed to insert save event:", err)` (and equivalent for snapshot) in both catch blocks.
- **Confidence:** High
- **Found by:** Error Handling, Concurrency & State, Security (3 specialists)

### [I3] DailyWordChart lacks visual distinction for negative bars
- **File:** `packages/client/src/components/DailyWordChart.tsx:31-35`
- **Bug:** All bars use identical `fill="#6B4720"` and `radius={[2, 2, 0, 0]}`. The design doc requires: "positive/negative bar distinction must use a Recharts-native visual distinction in addition to color (e.g., rounded vs. square bar corners, reduced opacity)." Currently positive and negative bars are completely indistinguishable.
- **Impact:** Accessibility requirement (WCAG: color must not be sole information carrier) and design deviation. Writers cannot visually distinguish days where they deleted more than they wrote.
- **Suggested fix:** Use a custom shape or conditional props to differentiate negative bars (e.g., reduced opacity, different corner radius, or different fill color).
- **Confidence:** High
- **Found by:** Plan Alignment

### [I4] SummaryStrip missing progress fraction and threshold qualifier
- **File:** `packages/client/src/components/SummaryStrip.tsx:48-68,74-79`
- **Bug:** Design spec says word target should display as "42,000 / 80,000 words (52%)" but only the target number is shown. Completion display should say "7 of 12 chapters at Revised or beyond" but only "7 of 12" is shown (the `STRINGS.velocity.atOrBeyond` string exists but is unused).
- **Impact:** Writers lose context about their progress toward goals. The threshold qualifier tells them what "complete" means.
- **Suggested fix:** Add current/target fraction with percentage for word count. Add threshold qualifier text using the existing `atOrBeyond` string.
- **Confidence:** High
- **Found by:** Plan Alignment

### [I5] `Chapter` shared type missing `target_word_count` field
- **File:** `packages/shared/src/types.ts:20-32`
- **Bug:** The `Chapter` interface lacks `target_word_count` despite the DB column, schema, API client, and dashboard all using this field. The dashboard works around this with an inline response type, but any code consuming the shared `Chapter` type cannot access `target_word_count` at compile time.
- **Impact:** TypeScript won't catch misuse of `target_word_count` on `Chapter`-typed objects.
- **Suggested fix:** Add `target_word_count: number | null;` to the `Chapter` interface.
- **Confidence:** High
- **Found by:** Contract & Integration

### [I6] `ProjectSettingsDialog` silently swallows save errors
- **File:** `packages/client/src/components/ProjectSettingsDialog.tsx:60-67`
- **Bug:** `saveField` catches errors with only `console.error`. The user gets no feedback when a save fails. Local state shows the new value (set optimistically), but the server never received it. On reload, the setting silently reverts.
- **Impact:** Violates the app's core trust promise around save reliability. Users believe their settings were saved when they weren't.
- **Suggested fix:** Add a `saveError` state (like `SettingsDialog` does) and display it. Consider reverting local state on failure.
- **Confidence:** High
- **Found by:** Error Handling

### [I7] Unbounded query loads ALL save events for streak calculation
- **File:** `packages/server/src/routes/velocity.ts:234-238`
- **Bug:** `SELECT saved_at FROM save_events WHERE project_id = ? ORDER BY saved_at ASC` with no limit. A heavy writer (~240 saves/day) accumulates ~87K rows/year. All loaded into memory on every velocity endpoint call just to extract distinct dates.
- **Impact:** Progressive performance degradation over time. After a year of writing, this query loads tens of thousands of rows into memory.
- **Suggested fix:** Use SQL-level deduplication: `SELECT DISTINCT date(saved_at) as date FROM save_events WHERE project_id = ? ORDER BY date DESC`. Or use `daily_snapshots` dates (which already track active days).
- **Confidence:** Medium
- **Found by:** Error Handling, Security (2 specialists)

### [I8] `threshold_status` typed as `string` but server can return `null`
- **File:** `packages/client/src/api/client.ts:28` vs `packages/server/src/routes/velocity.ts:292`
- **Bug:** Client `VelocityResponse` declares `threshold_status: string` but server sets it to `project.completion_threshold ?? null`. The migration defaults the column to `"final"` so null is unlikely in practice, but the type contract is inaccurate.
- **Impact:** Future code trusting the type could crash on a null dereference.
- **Suggested fix:** Change client type to `threshold_status: string | null`.
- **Confidence:** Medium
- **Found by:** Contract & Integration

## Suggestions

- **RecentSessions format deviates from design** (`RecentSessions.tsx`) -- Shows chapter count and date only instead of "2:15 PM -- 3:40 PM" time range and chapter names as specified in the design doc. Found by: Plan Alignment
- **`CompletionThreshold` duplicates `ChapterStatus` values** (`schemas.ts:5,12`) -- Two identical Zod enums that could diverge. Consider `CompletionThreshold = ChapterStatus`. Found by: Contract & Integration
- **Double timezone lookup in velocityHandler** (`velocity.ts:206-208`) -- Handler queries settings for timezone, then `getTodayDate()` queries it again internally. Minor inefficiency with a theoretical race if settings change between queries. Found by: Contract & Integration
- **`lastSession` never refreshed** (`EditorPage.tsx:129-146`) -- Fetched once on mount, shows stale session data in status bar as user writes. Found by: Concurrency & State
- **`calculateWordsToday` can return negative** (`schemas.ts:76`) -- By design (net change), but no `+/-` prefix in display. Found by: Logic & Correctness
- **Settings endpoint allows arbitrary keys** (`settings.ts`) -- No allowlist on setting keys; any key/value can be written. Low risk in single-user app. Found by: Security
- **BurndownChart local time parsing** (`BurndownChart.tsx:24-25`) -- Uses `new Date(date + "T00:00:00")` (local time) instead of UTC. Consistent within the chart but could cause DST rounding issues. Found by: Logic & Correctness
- **`UpdateSettingsSchema` accepts empty array** (`schemas.ts:53`) -- `{ settings: [] }` passes validation, resulting in a no-op PATCH that returns 200 success. Found by: Error Handling

## Plan Alignment

- **Implemented:** Tasks 1-17 (migration, schemas, settings API, save side-effects, project/chapter targets, velocity endpoint, client API extensions, strings, dialogs, Recharts, velocity tab, chart accessibility, editor status bar, chapter target popover, timezone auto-detection)
- **Not yet implemented:** Task 18 (E2E velocity tests), Task 19 (aXe accessibility audit on velocity tab), Task 20 (full suite verification)
- **Deviations:** DailyWordChart negative bar distinction (accessibility requirement), RecentSessions format (time range + chapter names), SummaryStrip progress fraction (current/target with percentage), extra `today` field in velocity response (benign addition)

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment (6 specialists) + Verifier
- **Scope:** 65 changed files + adjacent callers/callees
- **Raw findings:** 20 (before verification)
- **Verified findings:** 16 (after verification)
- **Filtered out:** 4 (migration seeds baselines, Zod mitigates falsy-zero, unique constraint prevents TOCTOU, Zod enum sufficient for completion_threshold)
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** docs/plans/2026-04-01-goals-velocity-plan.md, docs/plans/2026-04-01-goals-velocity-design.md
