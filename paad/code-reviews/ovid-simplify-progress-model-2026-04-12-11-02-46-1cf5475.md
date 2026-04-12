# Agentic Code Review: ovid/simplify-progress-model

**Date:** 2026-04-12 11:02:46
**Branch:** ovid/simplify-progress-model -> main
**Commit:** 1cf54750f45db64c1764bfb4753cadcbdc3523bc
**Files changed:** 67 | **Lines changed:** +2687 / -3108
**Diff size category:** Large

## Executive Summary

A clean, well-executed simplification that strips velocity analytics down to a lightweight pace indicator. The implementation aligns closely with the design document. Two important issues found: a non-atomic read-write in the snapshot upsert path, and a missing client-side guard for zero-value word count targets. No critical bugs.

## Critical Issues

None found.

## Important Issues

### [I1] Non-atomic read+write in `updateDailySnapshot` — stale snapshot possible under concurrent saves

- **File:** `packages/server/src/velocity/velocity.service.ts:32-41`
- **Bug:** `sumWordCountByProject` (READ) and `upsertDailySnapshot` (WRITE) are not wrapped in a transaction. Between the two calls, a concurrent save (or delete/restore) can commit a different word count, and the first call's stale sum overwrites the newer value.
- **Impact:** `daily_snapshots` row for today could hold a stale word count. All rolling averages and `words_today` derive from this. With 1.5s client debounce the window is narrow, but it exists for simultaneous save+delete or rapid multi-chapter edits.
- **Suggested fix:** Wrap both calls in a Knex transaction — both repository functions already accept `Knex | Knex.Transaction`:
  ```typescript
  await db.transaction(async (trx) => {
    const totalWordCount = await ChapterRepo.sumWordCountByProject(trx, projectId);
    await VelocityRepo.upsertDailySnapshot(trx, projectId, today, totalWordCount);
  });
  ```
- **Confidence:** High
- **Found by:** Concurrency & State

### [I2] `ProgressStrip` — division by zero and broken ARIA when `target_word_count === 0`

- **File:** `packages/client/src/components/ProgressStrip.tsx:33`
- **Bug:** `hasTarget` is `targetWc !== null`, which is `true` for `targetWc = 0`. This causes `data.current_total / 0 * 100 = Infinity`, clamped to `100` by `Math.min`. `aria-valuemax={0}` violates ARIA spec (must be > `aria-valuemin`). The text "5,000 / 0 words" is meaningless.
- **Impact:** The server's `UpdateProjectSchema` uses `.positive()` which rejects 0, so this can only occur via direct DB manipulation, stale cache, or a future validation change. Low probability but the client has no defense.
- **Suggested fix:** Change to `const hasTarget = targetWc !== null && targetWc > 0;`
- **Confidence:** Medium (server validation blocks the primary path)
- **Found by:** Logic & Correctness, Error Handling & Edge Cases

### [I3] `getTodayDate` silently falls back to epoch date on malformed `Intl` output

- **File:** `packages/server/src/velocity/velocity.service.ts:24-27`
- **Bug:** If `formatToParts` returns parts without a `year`, `month`, or `day` key, the function silently returns `"1970-01-01"` via `?? "1970"` fallbacks. This would poison `daily_snapshots` with a 1970 date and inflate `wordsToday` to the full manuscript total.
- **Impact:** Extremely unlikely on Node 20, but the fallback masks the problem instead of surfacing it. A thrown error would be caught by `updateDailySnapshot`'s try/catch and logged, preserving the save.
- **Suggested fix:** Throw if any part is missing instead of falling back:
  ```typescript
  if (!year || !month || !day) {
    throw new Error(`getTodayDate: missing date parts for timezone "${tz}"`);
  }
  ```
- **Confidence:** Medium
- **Found by:** Error Handling & Edge Cases

## Suggestions

- `velocity.service.ts:43` — `recordSave` is now a pure passthrough to `updateDailySnapshot` with no independent logic. Consider collapsing them or adding a comment explaining why the abstraction is preserved for future divergence. (Contract & Integration)

- `ProgressStrip.tsx:11` — When `error && !data`, the component returns `null`, silently removing the entire progress section. Consider rendering the `emptyState` string instead, so the section remains in the DOM for screen readers. (Contract & Integration)

- `migrations/010:27-29` — The `finally` block's `PRAGMA foreign_keys = ON` could throw, discarding the original migration error. Wrapping it in a nested try/catch preserves diagnostics. (Error Handling & Edge Cases)

- `velocity.service.ts:123-124` — `bestAvg` falls back to `dailyAverage7d` when `dailyAverage30d === 0` (net-zero writing over 30 days). A zero 30d average is meaningful data, not absent data. The projection guard (`bestAvg > 0`) prevents a wrong completion date, but the fallback to a recent productive sprint could be misleading. (Logic & Correctness)

## Plan Alignment

- **Implemented:** All "What Gets Removed" items confirmed gone (save_events, completion_threshold, chapter target_word_count, session/streak code, BurndownChart, RecentSessions, DailyWordChart, VelocityView, SummaryStrip, recharts, calculateWordsToday). All "What Stays" items preserved. New ProgressStrip and simplified API response match the design spec faithfully. Migration 010 is idempotent. CLAUDE.md data model section updated.
- **Not yet implemented:** `words_today` and `projected_completion_date` are returned by the API but not rendered in the ProgressStrip UI. The design's status line examples don't include them, so this appears intentional — data available for future features.
- **Deviations:** Design doc describes `recordSave(projectId, chapterId, wordCount)` — the implementation correctly simplified to `recordSave(projectId)` since the other params are unused. This is a doc-vs-code mismatch (code is correct).

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** 67 changed files + callers/callees one level deep across server, client, shared, e2e
- **Raw findings:** 21 (before verification)
- **Verified findings:** 7 (3 important + 4 suggestions, after verification)
- **Filtered out:** 14 (below confidence threshold, design-by-intent, duplicates, false positives)
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** docs/plans/2026-04-11-simplify-progress-model-design.md, docs/plans/2026-04-12-simplify-progress-model-plan.md
