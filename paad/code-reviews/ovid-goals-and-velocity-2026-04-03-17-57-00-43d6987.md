# Agentic Code Review: ovid/goals-and-velocity

**Date:** 2026-04-03 17:57:00
**Branch:** ovid/goals-and-velocity -> main
**Commit:** 43d6987c29bb6f1aaa265f63dce458561df8844f
**Files changed:** 75 | **Lines changed:** +7956 / -146
**Diff size category:** Large

## Executive Summary

The Goals & Velocity feature is a substantial, well-implemented addition. The data model, API contracts, and core algorithms closely match the design spec. The most significant issues are: the velocity endpoint fires on every auto-save (~1.5s during typing) with no throttle, an N+1 query pattern in baseline fetching compounds that load, and the DailyWordChart lacks the WCAG-required non-color visual distinction for negative bars. Several UI components deviate from the design spec in session display format.

## Critical Issues

None found.

## Important Issues

### [I1] Velocity fetch fires on every auto-save with no throttle
- **File:** `packages/client/src/pages/EditorPage.tsx:128-150`
- **Bug:** The `useEffect` for fetching `lastSession` triggers on every `saveStatus === "saved"` transition. With 1.5s debounced auto-save, active writing triggers the full velocity endpoint every ~1.5s. The velocity endpoint runs 5+ DB queries including the N+1 pattern in I2.
- **Impact:** Significant unnecessary server load during writing sessions. The status bar only needs one field from a heavyweight endpoint.
- **Suggested fix:** Throttle to at most once per 30-60 seconds, or create a lightweight `/last-session` endpoint.
- **Confidence:** High
- **Found by:** Error Handling, Concurrency & State

### [I2] N+1 query pattern for pre-window baselines
- **File:** `packages/server/src/routes/velocity.ts:236-246`
- **Bug:** For each unique `chapter_id` in the 30-day save events window, a separate DB query fetches the pre-window baseline. No error isolation per query -- one failure returns 500 for the entire endpoint.
- **Impact:** Performance scales linearly with chapter count. A 20-chapter book adds 20 sequential queries per velocity call. Combined with I1, this runs every 1.5s during writing.
- **Suggested fix:** Replace with a single query using `WHERE chapter_id IN (...)` with a correlated subquery. Wrap in try/catch defaulting to baseline of 0.
- **Confidence:** High
- **Found by:** Logic & Correctness, Error Handling, Contract & Integration, Security

### [I3] DailyWordChart missing non-color visual distinction for negative bars (WCAG)
- **File:** `packages/client/src/components/DailyWordChart.tsx:35-39`
- **Bug:** Design spec requires non-color visual distinction (opacity, corner radius) between positive and negative bars. Current implementation uses a single `<Bar>` with uniform styling.
- **Impact:** Accessibility violation. The design explicitly requires this for WCAG AA compliance.
- **Suggested fix:** Use Recharts cell-level rendering or a custom shape to apply reduced opacity and square corners for negative bars.
- **Confidence:** High
- **Found by:** Plan Alignment

### [I4] ChapterTargetPopover blur on empty field silently discards instead of clearing
- **File:** `packages/client/src/components/ChapterTargetPopover.tsx:43-51`
- **Bug:** Empty input produces `NaN` from `parseInt`, fails the guard, and no save fires. The old target silently persists. Only the Clear button works. Inconsistent with ProjectSettingsDialog which correctly handles empty -> null on blur.
- **Impact:** User believes they cleared the target by emptying the field, but it persists on next open.
- **Suggested fix:** Add `if (draft.trim() === "") { handleSave(null); return; }` before the parseInt logic.
- **Confidence:** High
- **Found by:** Error Handling, Contract & Integration

### [I5] Velocity side-effects not fully isolated from save response
- **File:** `packages/server/src/routes/chapters.ts:104-112`
- **Bug:** `insertSaveEvent` and `upsertDailySnapshot` are `await`ed outside any try/catch at the call site. While each helper has internal error handling, if something throws before entering the helper's try block, the error propagates and the client gets a 500 despite the chapter save having committed successfully.
- **Impact:** A transient error in "best-effort" side-effects could make the auto-save appear to fail, triggering retry logic and user-visible error state.
- **Suggested fix:** Wrap lines 104-112 in a try/catch at the call site.
- **Confidence:** Medium
- **Found by:** Error Handling, Concurrency & State

### [I6] Recent sessions show chapter count instead of chapter names
- **File:** `packages/client/src/components/RecentSessions.tsx:31-34`
- **Bug:** Design shows "Ch 4, Ch 5" but implementation shows "2 chapters". The `chapters_touched` array contains UUIDs, not human-readable names.
- **Impact:** Design deviation. Users can't see which chapters they worked on in each session.
- **Suggested fix:** Resolve chapter names on the server, or pass a chapter ID-to-title map to the component.
- **Confidence:** High
- **Found by:** Plan Alignment

### [I7] Recent sessions lack time-of-day display
- **File:** `packages/client/src/components/RecentSessions.tsx:21-24`
- **Bug:** Design shows "Today, 2:15 PM -- 3:40 PM" but implementation only shows "Mar 15" with no time. The timestamps are available in `session.start` and `session.end`.
- **Impact:** Design deviation. Users can't see when during the day their sessions occurred.
- **Suggested fix:** Format both start/end with time-of-day. Use "Today"/"Yesterday" for relative dates.
- **Confidence:** High
- **Found by:** Plan Alignment

## Suggestions

- [S1] Words today should show `+` prefix for positive values per design spec (`SummaryStrip.tsx:34`). RecentSessions already does this.
- [S2] Completion display should include threshold label (e.g., "7 of 12 at Revised or beyond") per design spec (`SummaryStrip.tsx:74-79`). The `STRINGS.velocity.atOrBeyond` function exists but is unused.
- [S3] `currentTotal` in VelocityView derived from last snapshot could briefly lag the server's live SUM. Consider returning `current_total` from the velocity endpoint (`VelocityView.tsx:96-97`).
- [S4] `dailyAvg30d` can be negative (user deleted more than wrote). Currently shows "no average" which hides information. Consider displaying the actual value with appropriate sign (`velocity.ts:268-282`, `SummaryStrip.tsx:36-38`).
- [S5] `completion_threshold` typed as `string` in API client instead of `CompletionThresholdValue` from shared types. Loses compile-time safety (`client.ts:86`).
- [S6] Single-event sessions show "0 min" which looks odd. Consider "< 1 min" (`velocity.ts:64-66`).
- [S7] Unbounded snapshot query for streak calc fetches all dates. Could cap at ~400 days while still computing accurate best streak (`velocity.ts:253-258`).
- [S8] ProjectSettingsDialog `onUpdate` only bumps dashboard refresh key but never re-fetches the project object, so dialog could show stale values on reopen (`EditorPage.tsx:761`).

## Plan Alignment

- **Implemented:** Data model (all tables, columns, indexes, constraints), API contracts (velocity, settings, project/chapter targets), session derivation (30-min gap, net_words, baselines), streak calculation, projection logic, adaptive display, burndown chart, summary strip, project settings dialog, app settings dialog, chapter target popover, editor status bar, timezone handling, migration seeding, accessibility (aria-labels, hidden data tables, reduced motion), string externalization, Recharts integration, language/tone
- **Not yet implemented:** Client timezone auto-detection on first launch (manual selection available)
- **Deviations:** DailyWordChart negative bar styling [I3], recent sessions format [I6, I7], words today `+` prefix [S1], completion threshold label [S2], velocity response includes extra `today` field (beneficial addition)

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** 75 changed files + adjacent callers/callees
- **Raw findings:** 38 (before verification)
- **Verified findings:** 15 (after verification)
- **Filtered out:** 23
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** docs/plans/2026-04-01-goals-velocity-design.md, docs/plans/2026-04-01-goals-velocity-plan.md
