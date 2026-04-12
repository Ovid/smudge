# Agentic Code Review: ovid/simplify-progress-model

**Date:** 2026-04-12 11:27:10
**Branch:** ovid/simplify-progress-model -> main
**Commit:** 25d0920fbf675ae0409790956c45c4f555f20265
**Files changed:** 68 | **Lines changed:** +2855 / -3110
**Diff size category:** Large

## Executive Summary

The branch is a clean, well-executed simplification of the velocity/progress system. Contracts are consistent across all layers (shared types, server service, API client, UI components). No security issues, no regressions in error handling, no contract mismatches. The one important finding is that two user-facing values (`words_today` and `projected_completion_date`) are computed server-side but never displayed on the client, despite being specified in the plan.

## Critical Issues

None found.

## Important Issues

### [I1] `words_today` and `projected_completion_date` computed but never displayed on client

- **File:** `packages/client/src/components/ProgressStrip.tsx` (entire component)
- **Bug:** The server computes `words_today` and `projected_completion_date` in the `VelocityResponse` (`packages/server/src/velocity/velocity.service.ts:146,155`), and the shared `VelocityResponse` type includes both fields. However, the `ProgressStrip` component never renders either value. The plan (`docs/plans/2026-04-12-simplify-progress-model-plan.md:733,740`) specifies `wordsToday` and `projectedDate` string functions in `strings.ts` that were never added.
- **Impact:** The user has no visibility into daily word progress or projected completion date in the UI, despite these being key motivating features of the simplified progress model. The design doc's status line examples include pace info but the projected date and daily count are missing.
- **Suggested fix:** Add the missing string functions to `packages/client/src/strings.ts` and render `words_today` and `projected_completion_date` in the ProgressStrip status line segments.
- **Confidence:** High
- **Found by:** Plan Alignment, verified by Verifier

## Suggestions

### [S1] `requiredPace` is null when deadline is today with work remaining

- **File:** `packages/server/src/velocity/velocity.service.ts:130`
- **Bug:** When `daysUntilDeadline` clamps to 0 (deadline is today or past), the `> 0` guard prevents pace calculation. User sees "0 days left" but no pace info. Mathematically correct (can't divide by zero), but could be more informative.
- **Suggested fix:** Consider showing "Deadline reached" or similar when `daysUntilDeadline === 0 && remainingWords > 0`.
- **Confidence:** Medium
- **Found by:** Logic & Correctness, Error Handling

### [S2] Migration `down()` lacks idempotency guards that `up()` has

- **File:** `packages/server/src/db/migrations/010_simplify_progress_model.js:37-64`
- **Bug:** The `up()` function checks column existence before dropping (safe for re-runs after partial failure). The `down()` function unconditionally adds columns and creates the `save_events` table, so re-running after partial rollback would error.
- **Suggested fix:** Add `PRAGMA table_info` checks in `down()` before adding columns, and use `createTableIfNotExists` for `save_events`. Low priority since rollbacks are developer-only.
- **Confidence:** Medium
- **Found by:** Error Handling

## Plan Alignment

- **Implemented:** All 14 tasks (1-14) from the plan are implemented in the diff.
- **Not yet implemented:** Task 15 (Full CI Pass) is a verification step, not a code change.
- **Deviations (improvements, not contradictions):**
  - `recordSave` signature simplified from `(projectId, chapterId, wordCount)` to `(projectId)` -- cleaner than plan's underscore-prefixed unused params
  - `recordSave` delegates to `updateDailySnapshot` instead of duplicating logic
  - `updateDailySnapshot` wraps sum+upsert in a transaction (plan did not specify this)
  - `wordsToday` includes `Math.max(0, ...)` guard against negative values from chapter deletion
  - `bestAvg` fallback checks `> 0` (not just null) to avoid projecting infinity when 30d average is zero
  - `ProgressStrip` has an `error` prop for graceful error state handling (not in plan)
  - `formatDateFromParts` extracted as a named, testable export
  - `hasTarget` additionally checks `> 0` to prevent progress bar when target is 0

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** 68 changed files + adjacent callers/callees (chapters.service.ts, velocity.injectable.ts, shared types, API client, ProgressStrip, DashboardView, EditorPage, migration, strings.ts)
- **Raw findings:** 11 (before verification)
- **Verified findings:** 3 (after verification)
- **Filtered out:** 8 (4 dropped as out-of-scope/pre-existing, 2 dropped as matching spec/design intent, 2 dropped as non-issues given single-user architecture)
- **Steering files consulted:** CLAUDE.md, .github/copilot-instructions.md
- **Plan/design docs consulted:** docs/plans/2026-04-12-simplify-progress-model-plan.md, docs/plans/2026-04-11-simplify-progress-model-design.md
