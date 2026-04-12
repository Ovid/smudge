# Agentic Code Review: ovid/new-storage-work

**Date:** 2026-04-12 21:45:22
**Branch:** ovid/new-storage-work -> main
**Commit:** c8a6563dea55aa17efbcf6198ef601f819ecc629
**Files changed:** 22 | **Lines changed:** +1252 / -170
**Diff size category:** Large

## Executive Summary

The ProjectStore interface migration is well-executed — a clean abstraction layer that delegates 1:1 to existing repositories with proper transaction support, singleton lifecycle management, and comprehensive test coverage. One important bug found: the `restoreChapter` error path returns a factually incorrect error code/message to the client when a chapter (not its parent project) has been purged. The remaining findings are suggestions around error-handling layering, abstraction consistency, and minor type safety gaps.

## Critical Issues

None found.

## Important Issues

### [I1] `restoreChapter` returns wrong error code when chapter is purged
- **File:** `packages/server/src/chapters/chapters.service.ts:173-179` and `packages/server/src/chapters/chapters.routes.ts:97-105`
- **Bug:** Both `"PARENT_PURGED"` and `"CHAPTER_PURGED"` error cases map to the same return value `"purged"`. The route handler translates `"purged"` to HTTP 404 with error code `"PROJECT_PURGED"` and message `"The parent project has been permanently deleted."` — factually wrong when the chapter itself was hard-purged but its project still exists.
- **Impact:** The client receives a misleading error message. If UI logic branches on `code === "PROJECT_PURGED"` (e.g., to redirect to the project list), it fires incorrectly for a purged chapter.
- **Suggested fix:** Return a separate sentinel `"chapter_purged"` from the service for the `CHAPTER_PURGED` case, and add a distinct route handler mapping (e.g., code `"CHAPTER_PURGED"`, message `"This chapter has been permanently deleted."`).
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases

## Suggestions

- **Double error suppression in velocity:** `updateDailySnapshot` (`velocity.service.ts:38-49`) has an internal try/catch that swallows all errors. Its callers in `chapters.service.ts` (lines 130-134, 195-199) also wrap in try/catch. The outer catches are dead code for snapshot failures — they only fire if `getVelocityService()` itself throws. Pick one suppression layer. *(Logic & Correctness, Error Handling & Edge Cases)*

- **Mixed `getDb()`/`getProjectStore()` in velocity.service.ts:** The file uses both `getDb()` (for VelocityRepo and SettingsRepo) and `getProjectStore()` (for chapter/project queries). This creates an inconsistent abstraction boundary and means tests that inject a custom store still depend on the real DB for velocity paths. *(Contract & Integration, Concurrency & State)*

- **Fragile SQLITE_CONSTRAINT_UNIQUE detection:** `chapters.service.ts:181-190` matches `/slug/i` against `err.message` to identify slug constraint violations. SQLite error message strings are implementation-defined and could change across versions. Consider matching on error code alone or inspecting constraint metadata. *(Error Handling & Edge Cases)*

- **Duplicated label-resolution pattern:** Three functions in `projects.service.ts` repeat `statusLabelMap[ch.status] ?? ch.status`, while `chapters.service.ts` uses the single-fetch `store.getStatusLabel()`. The batch approach in `projects.service.ts` is actually more efficient for multi-chapter contexts, but the fallback logic is duplicated inline. *(Contract & Integration)*

- **`setProjectStore` bypasses init guard:** `initProjectStore()` throws if already initialized, but `setProjectStore()` silently overwrites. Consider adding a comment marking `setProjectStore` as test-only, or adding a guard with reset-first requirement. *(Concurrency & State)*

- **Shutdown missing `resetProjectStore()`:** `index.ts` shutdown handler calls `closeDb()` but not `resetProjectStore()`. Harmless in production (process exits), but would cause `initProjectStore()` to throw on any in-process restart scenario. *(Concurrency & State)*

- **`getTodayDate()` resolved outside transaction:** In `velocity.service.ts:38-48`, the date is resolved before the transaction opens. A concurrent timezone setting change could cause the snapshot to land on the wrong date. Negligible risk under SQLite's single-writer model. *(Concurrency & State)*

- **`CreateChapterRow` missing `status` field:** The type relies on the DB default (`'outline'`) rather than making the field explicit. Works today but is a latent type safety gap if the default changes. *(Contract & Integration)*

## Plan Alignment

- **Implemented:** Tasks 1-9 (ProjectStore interface, AssetStore/SnapshotStore types, SqliteProjectStore impl, injectable/barrel, server bootstrap wiring, test helper wiring, chapter-statuses migration, chapters migration, projects migration). All tasks match the plan with minor improvements (nested transaction guard, `resetProjectStore()` helper, improved error handling).
- **Not yet implemented:** No remaining tasks — all 9 planned tasks are complete.
- **Deviations:**
  - **Velocity service partially migrated** despite the plan explicitly excluding it ("Settings and velocity remain independent"). `velocity.service.ts` now uses `getProjectStore()` for chapter/project queries while still using `getDb()` for VelocityRepo calls, creating the mixed-abstraction issue noted above.
  - **`restoreChapter` error handling more defensive** than planned (slug-specific regex on constraint errors, separate purge detection for chapter vs project).
  - **`getDashboard` uses `getStatusLabelMap()` directly** instead of the plan's manual map construction from `listStatuses()` — an improvement.
  - **`updateProject` returns result from transaction directly** instead of re-fetching after commit — more efficient than planned.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** 22 changed files + adjacent callers/callees (routes, repositories, test files, plan docs)
- **Raw findings:** 13 (before verification)
- **Verified findings:** 11 (after verification)
- **Filtered out:** 2 (1 false positive: `isTransaction` is in Knex public types; 1 by-design: `.passthrough()` required for TipTap JSON)
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** docs/plans/2026-04-12-storage-architecture-plan.md, docs/plans/2026-04-12-storage-architecture-design.md
