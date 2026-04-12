# Agentic Code Review: ovid/simplify-progress-model

**Date:** 2026-04-12 10:08:52
**Branch:** ovid/simplify-progress-model -> main
**Commit:** 35bfc27c99f7badb210905ecd79c5f70002354fc
**Files changed:** 58 | **Lines changed:** +2352 / -2959
**Diff size category:** Large

## Executive Summary

The implementation is well-aligned with the design document. The core velocity simplification -- migration, service/repository rewrite, ProgressStrip UI, and type system changes -- is solid and correct. The most impactful bug is stale velocity data shown when navigating between projects (the dashboard data uses a slug-guard pattern, but velocity data does not). The `??` fallback from 30d to 7d average silently fails when the 30d average is 0, defeating the intended fallback logic. CLAUDE.md and several test mocks are stale.

## Critical Issues

None found.

## Important Issues

### [I1] Stale velocity data shown for wrong project during navigation
- **File:** `packages/client/src/components/DashboardView.tsx:31,55-77`
- **Bug:** `velocityData` is not keyed to the current slug (unlike `dataWithSlug` which guards by slug on line 92). When the user navigates between projects, the old project's velocity data persists until the new fetch resolves. Additionally, `velocityLoading` is never reset to `true` on slug change, so the loading skeleton never re-shows after the first load.
- **Impact:** Users see stale velocity stats (word counts, pace, progress bar) from the previous project during navigation. The dashboard data handling shows the correct pattern was known but not applied to velocity data.
- **Suggested fix:** Either wrap velocity data in a `{ slug, data }` pair like `dataWithSlug`, or reset both states at the top of the effect:
  ```typescript
  useEffect(() => {
    let cancelled = false;
    setVelocityData(null);
    setVelocityLoading(true);
    api.projects.velocity(slug)
    // ...rest unchanged
  ```
- **Confidence:** High
- **Found by:** Logic & Correctness, Error Handling & Edge Cases, Concurrency & State

### [I2] `??` fallback from 30d to 7d average fails when 30d average is 0
- **File:** `packages/server/src/velocity/velocity.service.ts:140`, `packages/client/src/components/ProgressStrip.tsx:46`
- **Bug:** `const bestAvg = dailyAverage30d ?? dailyAverage7d` and `const recentPace = data.daily_average_30d ?? data.daily_average_7d`. The `??` operator only coalesces `null`/`undefined`, not `0`. `computeRollingAverage` returns `0` (not `null`) when the diff is <= 0 (line 90). So when the 30d average is 0 (no net progress), a positive 7d average is ignored -- the fallback silently fails.
- **Impact:** When a writer has no net progress over 30 days but positive 7-day progress, both projected completion date and "Recent pace" display are lost. The entire point of the fallback is defeated.
- **Suggested fix:** Use an explicit check instead of `??`:
  ```typescript
  // velocity.service.ts:140
  const bestAvg = (dailyAverage30d !== null && dailyAverage30d > 0) ? dailyAverage30d : dailyAverage7d;
  // ProgressStrip.tsx:46
  const recentPace = (data.daily_average_30d !== null && data.daily_average_30d > 0) ? data.daily_average_30d : data.daily_average_7d;
  ```
- **Confidence:** High
- **Found by:** Logic & Correctness

### [I3] `recordSave()` and `updateDailySnapshot()` are duplicate code
- **File:** `packages/server/src/velocity/velocity.service.ts:32-64`
- **Bug:** Both functions have identical inner logic: get db, get today's date, sum word count by project, upsert daily snapshot. The only differences are unused parameters (`_chapterId`, `_wordCount` in `recordSave`) and the error log text.
- **Impact:** Divergence risk -- if one is updated but not the other, snapshot behavior becomes inconsistent. The unused parameters in `recordSave` also create a misleading API contract.
- **Suggested fix:** Extract a shared helper or have `recordSave` delegate to `updateDailySnapshot`:
  ```typescript
  export async function recordSave(projectId: string, _chapterId: string, _wordCount: number): Promise<void> {
    await updateDailySnapshot(projectId);
  }
  ```
- **Confidence:** High
- **Found by:** Contract & Integration

### [I4] CLAUDE.md Data Model section is stale
- **File:** `CLAUDE.md` (Data Model section)
- **Bug:** Still documents: (a) `completion_threshold` column on `projects`, (b) `target_word_count` column on `chapters`, (c) `save_events` table, and (d) "Six tables" count. All three were dropped by migration 010; the actual count is five tables.
- **Impact:** Developers and AI assistants relying on CLAUDE.md will reference non-existent tables/columns.
- **Suggested fix:** Update the Data Model section to remove `save_events`, remove `completion_threshold` from projects, remove `target_word_count` from chapters, and change "Six tables" to "Five tables".
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases, Contract & Integration

### [I5] 6 client test files use old velocity mock shape
- **Files:**
  - `packages/client/src/__tests__/App.test.tsx`
  - `packages/client/src/__tests__/ChapterTitle.test.tsx`
  - `packages/client/src/__tests__/KeyboardShortcuts.test.tsx`
  - `packages/client/src/__tests__/StatusBar.test.tsx`
  - `packages/client/src/__tests__/useProjectEditor.test.ts`
  - `packages/client/src/__tests__/api-client.test.ts`
- **Bug:** These files mock `api.projects.velocity` with the old response shape (`daily_snapshots: []`, `sessions: []`, `streak: {...}`, `projection: {...}`, `completion: {...}`) instead of the new `VelocityResponse` interface. Tests pass because the mocks are untyped and no assertions check velocity fields.
- **Impact:** Tests provide false confidence and misleading API contract documentation. If any test starts consuming velocity data, it will get wrong fields.
- **Suggested fix:** Update all velocity mocks to use the new shape:
  ```typescript
  velocity: vi.fn().mockResolvedValue({
    words_today: 0, daily_average_7d: null, daily_average_30d: null,
    current_total: 0, target_word_count: null, remaining_words: null,
    target_deadline: null, days_until_deadline: null, required_pace: null,
    projected_completion_date: null, today: "2026-04-12",
  })
  ```
- **Confidence:** High
- **Found by:** Plan Alignment

## Suggestions

- `getChapterNamesMapIncludingDeleted()` in `chapters.repository.ts:142-152` is orphaned production code -- only referenced by its own test. Consider removing. (Contract & Integration, confidence 95%)
- `DailySnapshotRow` in `velocity.types.ts:1-7` is exported but never imported. The file could be deleted or the type actually used by the repository. (Contract & Integration, confidence 95%)
- `STRINGS.velocity.wordsToday` and `STRINGS.velocity.projectedDate` in `strings.ts:165,172-175` are defined but never displayed by any component, despite the server computing both values. Either wire them into ProgressStrip or remove the dead strings. (Logic, Contract, Plan Alignment, confidence 88%)
- `STRINGS.error.loadVelocityFailed` in `strings.ts:56` is defined but unused. Velocity fetch errors are silently swallowed (`console.error` only) with no user-facing indication. (Contract & Integration, confidence 82%)

## Plan Alignment

- **Implemented:** All plan tasks (migration 010, shared types, velocity repo/service, client deletions, ProgressStrip, DashboardView restructuring, ProjectSettingsDialog, test rewrites, e2e tests, accessibility) are reflected in the diff and match the design document.
- **Not yet implemented:** None -- all planned tasks are complete.
- **Deviations:** Test mock cleanup (plan Task 12) was only partially executed -- `completion_threshold` references were removed but velocity mock shapes were not updated to the new `VelocityResponse` format in 6 files.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** 58 changed files + adjacent callers/callees (velocity.injectable.ts, chapters.service.ts, chapters.repository.ts, projects.types.ts, chapters.types.ts)
- **Raw findings:** 27 (before verification)
- **Verified findings:** 9 (5 Important + 4 Suggestions)
- **Filtered out:** 18 (false positives, design choices, duplicates, below-threshold)
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** `docs/plans/2026-04-11-simplify-progress-model-design.md`, `docs/plans/2026-04-12-simplify-progress-model-plan.md`
