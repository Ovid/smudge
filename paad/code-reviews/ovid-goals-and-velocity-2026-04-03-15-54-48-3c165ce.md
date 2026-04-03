# Agentic Code Review: ovid/goals-and-velocity

**Date:** 2026-04-03 15:54:48
**Branch:** ovid/goals-and-velocity -> main
**Commit:** 3c165ce23b7bc82288e78c3699502b50b10aaa8b
**Files changed:** 67 | **Lines changed:** +7258 / -128
**Diff size category:** Large

## Executive Summary

The goals & velocity feature is substantially implemented and well-structured. Five important bugs were found: session net_words inflation at the 30-day boundary, a projected date off-by-one for western timezone users, stale dialog state in ProjectSettingsDialog, fragile date formatting in `getTodayDate`, and a missing TypeScript type field. Seven additional suggestions address minor UX and data integrity improvements.

## Critical Issues

None found.

## Important Issues

### [I1] Session baseline defaults to 0 for chapters with pre-30-day history
- **File:** `packages/server/src/routes/velocity.ts:74-85`
- **Bug:** `deriveSessions` searches for a chapter's baseline word count only within the `events` array (limited to 30 days). For the first session in the window, chapters with SaveEvents older than 30 days get a baseline of 0, inflating `net_words` by the chapter's entire pre-existing word count.
- **Impact:** The first session in a 30-day window could report thousands of phantom words written for any chapter with prior history. This skews session statistics and the "recent sessions" display.
- **Suggested fix:** Query the most recent SaveEvent per chapter *before* the 30-day window start date and pass these as initial baselines to `deriveSessions`.
- **Confidence:** High
- **Found by:** Logic & Correctness

### [I2] Projected date displays one day early for western timezone users
- **File:** `packages/client/src/components/SummaryStrip.tsx:53`
- **Bug:** `new Date(projection.projected_date)` parses `"YYYY-MM-DD"` as UTC midnight per the JS spec. `toLocaleDateString()` then renders in local time, causing UTC midnight to roll back to the previous day for users west of UTC.
- **Impact:** Writers in the Americas see a projected completion date one day earlier than calculated.
- **Suggested fix:** Parse as `new Date(projection.projected_date + "T00:00:00")` (local midnight), matching the pattern already used in `BurndownChart.tsx:59`.
- **Confidence:** High
- **Found by:** Logic & Correctness, Error Handling, Contract & Integration

### [I3] ProjectSettingsDialog shows stale values on reopen
- **File:** `packages/client/src/components/ProjectSettingsDialog.tsx:33-37`
- **Bug:** `useState` initializers for `wordCountTarget`, `deadline`, and `threshold` only run on first mount. When the dialog is reopened after the project prop has changed (same slug), the form fields display stale values.
- **Impact:** Settings dialog may show outdated target/deadline/threshold values after external changes.
- **Suggested fix:** Add a `useEffect` that syncs local state when the `project` prop changes, or include settings values in the component `key`.
- **Confidence:** High
- **Found by:** Error Handling, Concurrency & State

### [I4] `getTodayDate` relies on undocumented `en-CA` locale format
- **File:** `packages/server/src/routes/velocityHelpers.ts:17-23`
- **Bug:** The function uses `Intl.DateTimeFormat("en-CA", {...}).format(now)` assuming it produces `YYYY-MM-DD`. The ECMA-402 spec does not guarantee this format for any locale. Different ICU data versions or runtimes could produce different formats, silently corrupting all downstream date logic.
- **Impact:** Snapshot dates, streak calculations, and daily word counts would silently break if the format varies across environments (e.g., different Docker base images or Node versions).
- **Suggested fix:** Use `formatToParts()` to construct the date string from parts, which is runtime-independent.
- **Confidence:** High
- **Found by:** Error Handling

### [I5] `Chapter` TypeScript type missing `target_word_count` field
- **File:** `packages/shared/src/types.ts:22-32`
- **Bug:** The `Chapter` interface does not include `target_word_count`, despite the column existing in the DB (migration 004), being accepted by `UpdateChapterSchema`, returned by the dashboard endpoint, and used by `ChapterTargetPopover`.
- **Impact:** TypeScript won't catch misuse of `chapter.target_word_count`. Client code works around this with inline types, creating type drift.
- **Suggested fix:** Add `target_word_count: number | null;` to the `Chapter` interface.
- **Confidence:** High
- **Found by:** Contract & Integration

## Suggestions

- **[S1]** `packages/client/src/components/ChapterTargetPopover.tsx:19` — `draft` state initialized from prop on mount only; add `useEffect` to sync when `targetWordCount` prop changes. (Error Handling)
- **[S2]** `packages/client/src/components/VelocityView.tsx:96-98` — `currentTotal` derived from last snapshot rather than live DB total; stale after chapter deletion until next save. Consider including actual current total in velocity response. (Logic & Correctness)
- **[S3]** `packages/server/src/routes/velocityHelpers.ts:48-77` — `upsertDailySnapshot` uses check-then-act without transaction; a single `INSERT ... ON CONFLICT DO UPDATE` would be simpler and race-free. (Concurrency & State)
- **[S4]** `packages/client/src/pages/EditorPage.tsx:129-146` — `lastSession` fetched once on mount, never refreshed during the writing session. Consider periodic refresh or post-save refresh. (Concurrency & State)
- **[S5]** `packages/server/src/routes/velocityHelpers.ts:26-46` — `save_events` table grows unboundedly with no pruning. Consider a background cleanup of events older than 90-180 days. (Security)
- **[S6]** `packages/shared/src/schemas.ts:62-71` — `UpdateSettingsSchema` accepts arbitrary keys; consider allowlisting valid keys (currently only `timezone`). (Security)
- **[S7]** `packages/server/src/routes/velocityHelpers.ts:40-46` — Velocity side-effect failures are silently swallowed (intentional best-effort, but invisible to users). (Security)

## Plan Alignment

### Implemented
- Migration 004: all new tables (save_events, daily_snapshots, settings) and columns (project targets, chapter target)
- Settings API (GET + PATCH /api/settings) with timezone validation
- Project and chapter target fields on PATCH endpoints
- Velocity endpoint (GET /api/projects/:slug/velocity) with full response shape
- Session derivation with 30-minute gap logic
- Streak calculation (using daily_snapshots instead of SaveEvents — intentional deviation)
- Projection calculation with adaptive display
- Client: VelocityView, SummaryStrip, BurndownChart, DailyWordChart, RecentSessions
- Client: ProjectSettingsDialog, SettingsDialog, ChapterTargetPopover
- Editor status bar with last session info
- Recharts integration with accessibility (hidden data tables, aria-labels)
- Best-effort SaveEvent + DailySnapshot side-effects on chapter save
- Migration baseline seeding to prevent first-save inflation

### Not yet implemented
- Timezone auto-detection on first launch may be incomplete (design: "Client detects timezone on first launch and sends it to PATCH /api/settings")

### Deviations
- **DailyWordChart does not visually distinguish positive vs negative bars.** Design requires: "Warm accent color for positive, muted tone for negative" with "a Recharts-native visual distinction in addition to color." Current code uses a single color and bar style for all values. (`DailyWordChart.tsx:31-35`, confidence 95)
- **SummaryStrip shows word target as standalone number, not progress fraction.** Design: "42,000 / 80,000 words (52%)". Code shows just "80,000" as the target. (`SummaryStrip.tsx:62-68`, confidence 90)
- **RecentSessions shows chapter count instead of chapter names.** Design: "Ch 4, Ch 5". Code: "2 chapters". (`RecentSessions.tsx:28-33`, confidence 85)
- **RecentSessions omits start/end time display.** Design: "Today, 2:15 PM – 3:40 PM". Code shows only the date. (`RecentSessions.tsx:21-24`, confidence 90)
- **Velocity response includes undocumented `today` field.** Pragmatic addition for client timezone-aware calculations, but not in design spec. (`velocity.ts:319`, confidence 90)

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment, Verifier
- **Scope:** 67 changed files + adjacent callers/callees
- **Raw findings:** 30 (before verification)
- **Verified findings:** 12 (after verification)
- **Filtered out:** 18
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** docs/plans/2026-04-01-goals-velocity-design.md, docs/plans/2026-04-01-goals-velocity-plan.md
