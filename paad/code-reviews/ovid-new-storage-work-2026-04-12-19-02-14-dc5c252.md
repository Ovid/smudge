# Agentic Code Review: ovid/new-storage-work

**Date:** 2026-04-12 19:02:14
**Branch:** ovid/new-storage-work -> main
**Commit:** dc5c252ec49693582d5893d4dcff08aaa7a79faf
**Files changed:** 19 | **Lines changed:** +1236 / -158
**Diff size category:** Large

## Executive Summary

This branch cleanly introduces the `ProjectStore` interface between services and repositories, closely matching the design document. The migration is thorough: all three target services (chapter-statuses, chapters, projects) now use `getProjectStore()` instead of direct repository access. One important finding: the velocity service was intentionally scoped out but still creates a parallel access path that undermines the abstraction. Two suggestions relate to tightening the interface and barrel export consistency.

## Critical Issues

None found.

## Important Issues

### [I1] Velocity service bypasses ProjectStore entirely
- **File:** `packages/server/src/velocity/velocity.service.ts`
- **Bug:** The velocity service imports `getDb()` directly and calls `ChapterRepo.sumWordCountByProject()`, `ProjectRepo.findBySlug()`, and `VelocityRepo` via raw repository access. It also creates its own `db.transaction()` (line ~43) rather than using `store.transaction()`. This breaks the architectural pattern established by the other three migrated services.
- **Impact:** Velocity cannot be tested via store mocking. If a future `ProjectStore` implementation (e.g., per-project SQLite in Phase 8) replaces the backing store, velocity will still hit the old database. The design doc explicitly lists velocity as a non-goal for this phase, so this is expected -- but it creates a tracked gap.
- **Suggested fix:** Track as a follow-up task. When velocity is migrated, have it use `getProjectStore()` for chapter/project queries and accept `trx` via the store's transaction callback for snapshot upserts.
- **Confidence:** High
- **Found by:** Logic & Correctness, Contract & Integration

## Suggestions

- **[S1]** `transaction()` callback exposes raw `trx: Knex.Transaction` parameter (`project-store.types.ts:60`). No current caller uses it -- all use `txStore`. Consider removing the `trx` parameter to tighten the abstraction. The design doc justifies it as an "escape hatch for repos not covered by this store (e.g., velocity)," so this is an intentional trade-off, but worth revisiting once velocity is migrated. *(Found by: Error Handling & Edge Cases)*

- **[S2]** `setProjectStore` is defined in `project-store.injectable.ts` but not exported from the barrel (`stores/index.ts`), while `resetProjectStore` (also test-focused) is exported. Minor inconsistency -- test-helpers import `setProjectStore` directly from the injectable module, bypassing the barrel. Consider either exporting both or neither test-focused helpers from the barrel. *(Found by: Contract & Integration)*

## Plan Alignment

- **Implemented:** All design goals met -- ProjectStore interface, SqliteProjectStore implementation, AssetStore/SnapshotStore type-only interfaces, module-level singleton, startup wiring, and all three service migrations (chapter-statuses -> chapters -> projects).
- **Not yet implemented:** `purgeDeletedProjects`/`restoreProject` methods (intentionally deferred per YAGNI). AssetStore/SnapshotStore implementations (Phase 4a/4b).
- **Deviations:**
  - `restoreChapter` returns `Promise<number>` (row count) instead of `Promise<void>` as specified in the design doc. This is an improvement -- callers use the count to detect purged chapters.
  - Barrel exports `resetProjectStore` instead of `setProjectStore`. `resetProjectStore` (not in design) was added for test teardown. `setProjectStore` exists but is not barrel-exported.
  - `initProjectStore()` throws on double-init (commit `3592987`). Design doc did not specify this guard. Defensive addition.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** 19 changed files + adjacent callers/repositories (chapters.repository.ts, projects.repository.ts, velocity.service.ts)
- **Raw findings:** 10 (before verification)
- **Verified findings:** 3 (after verification)
- **Filtered out:** 7 (mostly TOCTOU patterns that are theoretical under SQLite's serialized writes in a single-user app)
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** docs/plans/2026-04-12-storage-architecture-design.md
