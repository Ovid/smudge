# Agentic Code Review: ovid/goals-and-velocity

**Date:** 2026-04-03 15:42:00
**Branch:** ovid/goals-and-velocity -> main
**Commit:** 0b3daddaee2605517f7703e6965a6e107ccc95e6
**Files changed:** 62 | **Lines changed:** +6707 / -86
**Diff size category:** Large

## Executive Summary

The Goals & Velocity feature is a substantial, well-structured addition that closely follows the design document. The most impactful bugs are: `RecentSessions` displaying the oldest 5 sessions instead of the most recent 5, a client/server timezone mismatch causing incorrect "Words today" calculations for non-UTC users, and test mocks using invalid `completion_threshold` values that could never exist in production. Overall confidence is moderate-high -- no critical data-loss bugs, but several Important-tier issues that affect correctness and UX.

## Critical Issues

None found.

## Important Issues

### [I1] RecentSessions shows oldest 5 sessions instead of most recent 5
- **File:** `packages/client/src/components/RecentSessions.tsx:11`
- **Bug:** `sessions.slice(0, 5)` takes the first 5 elements from an array ordered chronologically (oldest first, from `deriveSessions` which processes events by `saved_at ASC`). The component displays the 5 oldest sessions in the 30-day window.
- **Impact:** Users see their oldest writing sessions under a "Recent Sessions" heading -- misleading and unhelpful.
- **Suggested fix:** Change to `sessions.slice(-5).reverse()` to get the 5 most recent in reverse-chronological order.
- **Confidence:** High
- **Found by:** Logic & Correctness, Error Handling, Plan Alignment

### [I2] Client computes `today` in UTC; server uses configured timezone for snapshot dates
- **File:** `packages/client/src/components/VelocityView.tsx:85`
- **Bug:** `new Date(now).toISOString().slice(0, 10)` produces a UTC date. The server's `getTodayDate()` uses `Intl.DateTimeFormat("en-CA", { timeZone: tz })` with the writer's configured timezone. When the writer is in a non-UTC timezone near day boundaries, the client's `today` differs from the server's snapshot dates, causing `calculateWordsToday()` to use the wrong baseline.
- **Impact:** "Words today" in the SummaryStrip can be incorrect for non-UTC writers -- potentially showing 0 or yesterday's delta.
- **Suggested fix:** Have the server include `today` (in the configured timezone) in the velocity response, or have the client fetch the timezone setting and compute the date consistently.
- **Confidence:** High
- **Found by:** Logic & Correctness, Error Handling, Contract & Integration, Concurrency & State, Plan Alignment

### [I3] Client allows `target_word_count` of 0; server rejects with `.positive()`
- **File:** `packages/client/src/components/ProjectSettingsDialog.tsx:69-71`
- **Bug:** `handleWordCountBlur` validates `parsed < 0` but allows `parsed === 0`. The server's Zod schema uses `.positive()` (strictly > 0). When the user enters "0", the client sends it, the server returns 400, and `saveField`'s catch block only logs to console.
- **Impact:** Silent save failure -- user believes they set a target of 0 but it was never persisted.
- **Suggested fix:** Change client validation to `parsed <= 0`, change `min="0"` to `min="1"` on the input, and surface API errors to the user.
- **Confidence:** High
- **Found by:** Logic & Correctness, Error Handling, Contract & Integration

### [I4] Test mocks use invalid `completion_threshold: "100"`
- **Files:** `packages/client/src/__tests__/App.test.tsx`, `ChapterTitle.test.tsx`, `StatusBar.test.tsx`, `HomePage.test.tsx`, `Sidebar.test.tsx`, `useProjectEditor.test.ts`, `EditorPageFeatures.test.tsx`, `KeyboardShortcuts.test.tsx`
- **Bug:** Eight test files set `completion_threshold: "100"` in mock project data. The Zod `CompletionThreshold` schema only accepts `"outline" | "rough_draft" | "revised" | "edited" | "final"`. The `Project` type uses `string` instead of the enum, so TypeScript doesn't catch this.
- **Impact:** Tests pass with data that could never exist in production. Any future code that conditionally renders based on threshold values would behave differently in tests.
- **Suggested fix:** Change all instances to `completion_threshold: "final"`. Consider using `z.infer<typeof CompletionThreshold>` in the `Project` type for compile-time safety.
- **Confidence:** High
- **Found by:** Contract & Integration

### [I5] ProjectSettingsDialog state doesn't sync when `project` prop changes
- **File:** `packages/client/src/components/ProjectSettingsDialog.tsx:32-36`
- **Bug:** `useState` initializers only run on first mount. If the parent re-renders with a different `project` prop (e.g., after navigation or server update), the dialog's local state retains old values.
- **Impact:** User sees stale settings data when reopening the dialog after external changes.
- **Suggested fix:** Add a `useEffect` that syncs local state when `project` or `open` changes, or use `project.slug` as a React `key` to force remount.
- **Confidence:** Medium
- **Found by:** Logic & Correctness

### [I6] SettingsDialog.handleSave has unhandled API error
- **File:** `packages/client/src/components/SettingsDialog.tsx:47-52`
- **Bug:** `handleSave` awaits `api.settings.update(...)` without try/catch. On network error or server validation failure, the promise rejects, `onClose()` never executes, and the dialog stays open with no error feedback.
- **Impact:** User clicks Save, nothing visible happens, dialog stays open.
- **Suggested fix:** Wrap in try/catch, show an error state or at minimum ensure the dialog responds gracefully.
- **Confidence:** Medium
- **Found by:** Logic & Correctness

### [I7] VelocityView never refetches after saves
- **File:** `packages/client/src/components/VelocityView.tsx:38-57`
- **Bug:** The `useEffect` fetching velocity data depends only on `[slug]`. The data is never refreshed when the user writes and triggers auto-saves. The sibling `DashboardView` has a `refreshKey` mechanism, but it's not wired to `VelocityView`.
- **Impact:** Velocity tab shows stale data (words today, sessions, streaks) for the entire editing session.
- **Suggested fix:** Pass `refreshKey` to `VelocityView` as a prop and include it in the `useEffect` dependency array, or use a manual refresh button.
- **Confidence:** Medium
- **Found by:** Concurrency & State

## Suggestions

- **[S1]** `packages/client/src/pages/EditorPage.tsx:689` — Hardcoded `+` prefix for `net_words` in status bar displays `+-500 words` when session has net deletions. Use conditional prefix. (Found by: Plan Alignment, confidence 85%)
- **[S2]** `packages/client/src/components/DailyWordChart.tsx:31-36` — No visual distinction between positive and negative bars beyond direction. Design calls for different fill color/opacity/shape for negative values (WCAG concern). (Found by: Plan Alignment, confidence 85%)
- **[S3]** `packages/server/src/routes/settings.ts:6-14` — Settings PATCH accepts arbitrary keys; no allowlist. Unknown keys are silently stored. Consider rejecting unknown keys with 400. (Found by: Error Handling, Security, confidence 75%)
- **[S4]** `packages/client/src/pages/EditorPage.tsx:129-146` — `lastSession` in status bar fetches once on mount (`[slug]` deps) and never updates during the editing session. (Found by: Concurrency & State, confidence 75%)
- **[S5]** `packages/server/src/routes/velocityHelpers.ts:8-9` and `velocity.ts:241-246` — Corrupted timezone in DB throws `RangeError` in `Intl.DateTimeFormat`. Add try/catch with UTC fallback. (Found by: Error Handling, Security, confidence 72%)
- **[S6]** `packages/client/src/components/BurndownChart.tsx:24-25` — Date parsing uses local timezone (`"T00:00:00"` without `Z`), inconsistent with server UTC dates. Can cause off-by-one in planned pace line. (Found by: Logic & Correctness, confidence 70%)
- **[S7]** `packages/server/src/routes/velocity.ts:164` — `!targetWordCount` falsy check conflates 0 and null. Change to `targetWordCount == null`. (Found by: Logic & Correctness, Error Handling, confidence 65%)
- **[S8]** `packages/client/src/components/SummaryStrip.tsx:34` — "Words today" omits `+` prefix. Design specifies `+340` format. (Found by: Plan Alignment, confidence 65%)

## Plan Alignment

**Implemented:**
- Data model (all tables, columns, indexes, constraints)
- Migration seeding of baseline SaveEvents and DailySnapshots
- Settings API (GET + PATCH with timezone validation)
- Project targets (PATCH with target_word_count, target_deadline, completion_threshold)
- Chapter target_word_count
- Velocity endpoint with correct response shape (daily_snapshots, sessions, streak, projection, completion)
- Session derivation (30-min gap, net words, includes soft-deleted chapters)
- Streak calculation (current + best, revision days count, today grace period)
- Adaptive display (SummaryStrip conditionally shows target/projection/deadline)
- Charts (DailyWordChart, BurndownChart) with Recharts, aria-labels, hidden data tables
- Project Settings dialog, App Settings dialog, ChapterTargetPopover
- Timezone auto-detection on first launch
- Editor status bar "Last session" display
- String externalization
- Recharts in dependency-licenses.md
- E2E tests with aXe accessibility audit

**Not yet implemented:**
- Word count progress fraction in SummaryStrip ("42,000 / 80,000 words (52%)")
- Session time range display in RecentSessions ("2:15 PM -- 3:40 PM")
- Chapter names (not just count) in RecentSessions
- "At your current pace, you'll reach..." encouraging language for projections
- Dynamic average in chart aria-labels

**Deviations:**
- RecentSessions shows oldest 5 instead of most recent 5 (see I1)
- Client computes "today" in UTC instead of writer's timezone (see I2)
- DailyWordChart uses same visual treatment for positive and negative bars (design calls for distinct styling)

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** 62 changed files + adjacent callers/callees
- **Raw findings:** 47 (before verification)
- **Verified findings:** 15 (after verification)
- **Filtered out:** 32
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** docs/plans/2026-04-01-goals-velocity-design.md, docs/plans/2026-04-01-goals-velocity-plan.md
