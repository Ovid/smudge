# Agentic Code Review: ovid/simplify-progress-model

**Date:** 2026-04-12 15:30:00
**Branch:** ovid/simplify-progress-model -> main
**Commit:** 2793330b60b4cebd826e7de49222a5ea920ebe2b
**Files changed:** 63 | **Lines changed:** +2548 / -3102
**Diff size category:** Large

## Executive Summary

This is a clean, well-executed simplification that removes velocity complexity (save_events, sessions, streaks, charts) and replaces it with a lightweight ProgressStrip. No critical bugs were found. Four important issues involve stale documentation and dead code that should be cleaned up. The core velocity computation logic is correct with proper null handling and edge case guards.

## Critical Issues

None found.

## Important Issues

### [I1] Stale `.github/copilot-instructions.md` — references removed schema entities
- **File:** `.github/copilot-instructions.md:110-117`
- **Bug:** Data Model section says "Six tables" and lists `save_events`, `completion_threshold` (on projects), and `target_word_count` (on chapters) — all removed by migration 010. Line ~128 says "Save events and daily snapshots are recorded" — save events are no longer recorded.
- **Impact:** Copilot will generate code referencing non-existent tables/columns. This was also flagged in the previous PAAD review but not addressed.
- **Suggested fix:** Update to five tables. Remove `completion_threshold` from projects, `target_word_count` from chapters, remove `save_events` entry. Update any prose mentioning save events.
- **Confidence:** High
- **Found by:** Contract & Integration

### [I2] `docs/dependency-licenses.md` still lists `recharts`
- **File:** `docs/dependency-licenses.md:61`
- **Bug:** `recharts` listed as production dependency (`MIT | Charting library for velocity charts`) but was removed from `packages/client/package.json` and all source imports.
- **Impact:** License audit doc is a compliance artifact per CLAUDE.md. Listing a removed dependency misleads future audits.
- **Suggested fix:** Remove the `recharts` row from the production dependencies table.
- **Confidence:** High
- **Found by:** Contract & Integration

### [I3] `recordSave` carries dead parameters through the interface chain
- **File:** `packages/server/src/velocity/velocity.service.ts:47-53`
- **Bug:** `recordSave(projectId, _chapterId, _wordCount)` accepts two unused parameters (underscore-prefixed). The `VelocityServiceInterface` at `velocity.injectable.ts:4` still declares the full 3-parameter signature. The caller at `chapters.service.ts:98` passes all three including an `as number` cast for `updates.word_count`.
- **Impact:** Misleading interface, unnecessary `as number` cast that bypasses type safety.
- **Suggested fix:** Simplify `recordSave` to `recordSave(projectId: string): Promise<void>` in both the interface and implementation, and update the caller.
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases, Contract & Integration

### [I4] Migration 010 lacks atomicity — partial failure leaves inconsistent schema
- **File:** `packages/server/src/db/migrations/010_simplify_progress_model.js:8-21`
- **Bug:** `config = { transaction: false }` disables Knex transaction wrapper. Three sequential DDL operations (drop table, drop column x2) run without a transaction. If drop 2 succeeds but drop 3 fails, schema is half-migrated. The `try/finally` only protects the PRAGMA toggle.
- **Impact:** A partial failure would require manual DB repair. Risk is low (migration has likely already run, SQLite DDL failures are rare), but the pattern is fragile.
- **Suggested fix:** Wrap the two column drops in an explicit `BEGIN`/`COMMIT` within the `try` block, or add `IF EXISTS`-style guards so re-running after partial failure is safe.
- **Confidence:** Medium
- **Found by:** Error Handling & Edge Cases

## Suggestions

- `velocity.service.ts:95` — `words_today` can go negative when user deletes content. Consider clamping to `Math.max(0, ...)` or documenting the API contract. (Error Handling, Contract)
- `velocity.service.ts:32-44` — Double try/catch in `updateDailySnapshot` adds nesting for no practical benefit; a single try/catch would be equivalent. (Error Handling)
- `DashboardView.tsx:67-69` — Velocity fetch errors are silently swallowed into the "no data" appearance; user gets no feedback that the fetch failed vs. there simply being no data. (Error Handling)
- `ProgressStrip.tsx` — Does not display `words_today` or `projected_completion_date` from VelocityResponse. Server computes these but they go unused. May be intentional per design spec examples. (Contract)
- `velocity.service.ts:78-80` — `computeRollingAverage` returns `0` for negative diff instead of `null`, conflating "deleted content" with "no writing." Current UI handles both identically. (Error Handling)

## Plan Alignment

- **Implemented:** All items from the design document's removal table, retention table, and new features table are implemented. VelocityResponse matches the design interface field-for-field. ProgressStrip matches the design spec including accessibility requirements (role="progressbar", ARIA attributes, motion-reduce, sans-serif font). Migration drops all three targets. Server and client simplifications follow the design faithfully.
- **Not yet implemented:** None identified — implementation appears complete.
- **Deviations:** `projected_completion_date` and `words_today` are computed server-side but not displayed in ProgressStrip. The design's example status lines also omit these, so this is consistent with the spec rather than a deviation.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** 63 changed files + adjacent callers/callees (velocity service chain, chapters service, dashboard components, shared types)
- **Raw findings:** 11 (before verification)
- **Verified findings:** 9 (after verification)
- **Filtered out:** 2 (F1: ProgressStrip div-by-zero mitigated by Zod; F10: slug validation — no practical risk)
- **Steering files consulted:** CLAUDE.md, .github/copilot-instructions.md
- **Plan/design docs consulted:** docs/plans/2026-04-11-simplify-progress-model-design.md, docs/plans/2026-04-12-simplify-progress-model-plan.md
