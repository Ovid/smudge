# Agentic Code Review: ovid/goals-and-velocity

**Date:** 2026-04-04 15:20:00
**Branch:** ovid/goals-and-velocity -> main
**Commit:** e33e5af329103153b22b59489d010335bac505f5
**Files changed:** 79 | **Lines changed:** +8716 / -286
**Diff size category:** Large

## Executive Summary

The goals & velocity feature is a substantial, well-structured addition with strong alignment to the design document. No critical bugs were found. Six important issues were identified, primarily around edge cases in velocity data accuracy (misleading "words today" after chapter deletion, streaks counting non-writing days, stale snapshots on project delete) and one silent error loss in the chapter target popover. The codebase demonstrates good practices: best-effort side-effects, atomic upserts, proper cancellation in React effects, and comprehensive Zod validation.

## Critical Issues

None found.

## Important Issues

### [I1] `calculateWordsToday` returns misleading values after soft-delete or on first day
- **File:** `packages/shared/src/schemas.ts:73-88`
- **Bug:** Two scenarios produce misleading "words today" values: (1) On the first day of tracking with no prior-day snapshot, the function returns the entire project word count as "words today." (2) After soft-deleting a chapter, `currentTotal` excludes the deleted chapter but yesterday's snapshot included it, producing a large negative value.
- **Impact:** The most visible metric in the velocity summary strip will show incorrect values in these scenarios, undermining user trust in the tracking system.
- **Suggested fix:** For first-day case, check if a same-day snapshot exists and diff against that. For soft-delete case, consider using today's snapshot (updated by `upsertDailySnapshot` on delete) instead of live total, or document the behavior.
- **Confidence:** High
- **Found by:** Logic & Correctness, Error Handling

### [I2] Project soft-delete doesn't call `upsertDailySnapshot`
- **File:** `packages/server/src/routes/projects.ts:486-514`
- **Bug:** When a project is soft-deleted (along with its chapters), `upsertDailySnapshot` is never called. Compare with chapter delete at `chapters.ts:160` which does call it. The daily snapshot retains stale word counts for the deleted project.
- **Impact:** If the project is restored, velocity data for the delete day will be incorrect. The snapshot would show word counts that include chapters that were deleted.
- **Suggested fix:** Call `upsertDailySnapshot(db, project.id)` after the soft-delete transaction, consistent with the chapter delete handler.
- **Confidence:** High
- **Found by:** Logic & Correctness

### [I3] `handleClear` closes popover before awaiting save, silently losing errors
- **File:** `packages/client/src/components/ChapterTargetPopover.tsx:60-64`
- **Bug:** `handleClear` calls `handleSave(null)` (async, not awaited) then immediately `setOpen(false)`. If the save fails, `setSaveError(true)` fires but the popover is already closed, so the error is invisible. The UI shows the target as cleared, but the server retains the old value.
- **Impact:** Silent data loss -- the user thinks the target was cleared but it persists on the server until the next page refresh reveals the mismatch.
- **Suggested fix:** `await handleSave(null)` and only close the popover on success, or call `onUpdate()` in the catch path to force a re-fetch that restores the true server state.
- **Confidence:** High
- **Found by:** Concurrency & State

### [I4] Streaks count delete/restore-only days as writing days
- **File:** `packages/server/src/routes/velocity.ts:270-278`
- **Bug:** Streak calculation uses `daily_snapshots` dates. `upsertDailySnapshot` is called on chapter delete (`chapters.ts:160`) and restore (`chapters.ts:228`), not just content saves. A day with only delete/restore activity (no writing) creates a snapshot and counts toward the writing streak.
- **Impact:** The streak metric is inflated for days with only structural changes (deleting or restoring chapters), misrepresenting writing consistency.
- **Suggested fix:** Only call `upsertDailySnapshot` on content saves (already the case in `chapters.ts:104`), or filter streak dates to only include days with `save_events` entries.
- **Confidence:** High
- **Found by:** Logic & Correctness, Error Handling

### [I5] Raw string literal violates string externalization rule
- **File:** `packages/client/src/components/VelocityView.tsx:56`
- **Bug:** The error fallback `"Failed to load velocity data"` is a raw string literal. CLAUDE.md requires: "All UI strings in `packages/client/src/strings.ts` as constants, never raw literals in components."
- **Impact:** Violates project convention; blocks future i18n.
- **Suggested fix:** Add `error.loadVelocityFailed` to `packages/client/src/strings.ts` and reference it here.
- **Confidence:** High
- **Found by:** Contract & Integration

### [I6] Pre-window baseline fallback to 0 inflates first session net_words on query failure
- **File:** `packages/server/src/routes/velocity.ts:96` and `259`
- **Bug:** When the pre-window baseline query fails (caught silently at line 259), `preWindowBaselines` remains empty and `baselines[chapterId] ?? 0` falls back to 0 for all chapters. This makes the first session in the 30-day window show `net_words` equal to the full word count of every chapter touched, potentially tens of thousands of words.
- **Impact:** A transient DB error during baseline fetch silently inflates session net_words for the entire response.
- **Suggested fix:** When the baseline query fails, use the first event per chapter within the window as the baseline (net contribution = 0 for that first save) rather than defaulting to 0.
- **Confidence:** Medium
- **Found by:** Logic & Correctness, Error Handling

## Suggestions

- `packages/server/src/routes/velocity.ts:332-370` -- `chapter_names` map excludes soft-deleted chapters but sessions include them, showing "Untitled" for deleted chapters in recent sessions. Consider removing the `.whereNull("deleted_at")` filter from the names query (read-only display data).
- `packages/client/src/components/ProjectSettingsDialog.tsx:78-85` -- Invalid word count target (negative, zero, NaN) is silently discarded on blur with no user feedback. The field retains the invalid text with no error message. Consider showing a validation error or reverting to the previous value.
- `packages/server/src/routes/velocity.ts:312` + `packages/client/src/components/SummaryStrip.tsx:42` -- Negative `dailyAvg30d` (from net content deletion over 30 days) displays as a negative number instead of the "no average" em-dash. Consider clamping to `Math.max(0, ...)`.
- `packages/client/src/components/ProjectSettingsDialog.tsx:61-76` -- Error revert uses prop values that may not reflect the latest successful save due to async timing. Consider tracking last-known-good values in a ref.
- `packages/server/src/db/migrations/004_goals_velocity.js:52-53` -- Migration seed uses `now.slice(0, 10)` (UTC date) while runtime uses `getTodayDate()` (timezone-aware). Can cause a one-day offset for users in negative UTC offsets. Acceptable one-time migration edge case.
- `packages/server/src/routes/velocity.ts:244-255` -- Pre-window baseline query can return multiple rows per chapter if two events share an exact timestamp. Add a tie-breaker (e.g., `MAX(word_count)` or `LIMIT 1` per chapter).
- `packages/server/src/routes/settings.ts:49` -- User-supplied `value` is reflected verbatim in error messages with no length limit. Consider removing the value from the error or truncating it.
- `packages/shared/src/schemas.ts:62-71` -- Settings schema accepts arbitrary keys and unlimited-length values. Consider `z.enum(["timezone"])` for key and `.max(100)` for value.
- `packages/client/src/components/ProjectSettingsDialog.tsx:87-95` -- Rapid settings changes (deadline, threshold) fire concurrent unsequenced PATCH requests. Consider serializing saves or adding a sequence counter.

## Plan Alignment

- **Implemented:** All core features from the design doc are present: migration with baseline seeding, settings API, project/chapter target fields, velocity endpoint with sessions/streaks/projection/completion, adaptive dashboard display (summary strip, daily chart, burndown chart, recent sessions), project settings dialog, app settings dialog, chapter target popover, editor status bar last session, timezone handling.
- **Not yet implemented:** None identified -- the implementation appears feature-complete against the design.
- **Deviations:**
  - Velocity response includes three additive fields (`today`, `current_total`, `chapter_names`) beyond the design spec's JSON shape -- reasonable extensions for client display needs.
  - Streak calculation uses `daily_snapshots` instead of `save_events` as the design specifies -- documented as a performance optimization, functionally equivalent for content saves but not for structural changes (see I4).
  - Settings PATCH returns a flat error string instead of structured per-key errors as the design specifies.
  - Daily chart could show up to 89 days of data (from 90-day snapshot window) rather than the designed 30 days.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** 79 changed files + adjacent callers/callees (server routes, client components, shared schemas, migrations)
- **Raw findings:** 33 (before verification)
- **Verified findings:** 15 (after verification)
- **Filtered out:** 18
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** docs/plans/2026-04-01-goals-velocity-design.md, docs/plans/2026-04-01-goals-velocity-plan.md
