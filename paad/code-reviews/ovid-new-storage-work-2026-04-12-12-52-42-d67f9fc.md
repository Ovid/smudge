# Agentic Code Review: ovid/new-storage-work

**Date:** 2026-04-12 12:52:42
**Branch:** ovid/new-storage-work -> main
**Commit:** d67f9fccc43bbc43a758c637cb9950cbd8254d8f
**Files changed:** 13 | **Lines changed:** +913 / -90
**Diff size category:** Large

## Executive Summary

This branch introduces a well-executed `ProjectStore` interface between services and existing repositories, closely matching the design document. The migration is clean with no orphaned direct-repo imports in migrated services. Three findings rise to "Important" level: an unsafe cast in the `transaction()` method that allows undocumented nested transactions, an overly-broad `SQLITE_CONSTRAINT_UNIQUE` catch in chapter restoration, and inconsistent error handling between `updateProject` and `updateChapter` for read-after-write failures.

## Critical Issues

None found.

## Important Issues

### [I1] `transaction()` unsafe cast allows nested transactions via `txStore`
- **File:** `packages/server/src/stores/sqlite-project-store.ts:166`
- **Bug:** The `transaction()` method does `(this.db as Knex).transaction(...)` unconditionally. The `ProjectStore` interface exposes `transaction()` on every instance, including the `txStore` passed into transaction callbacks. If a future developer calls `txStore.transaction()`, Knex will silently create a savepoint instead of a new transaction, with different rollback semantics. The `as Knex` cast suppresses TypeScript's ability to catch this.
- **Impact:** Latent correctness risk. No current code nests transactions, but the API permits it and the behavior would be surprising (savepoint vs. new transaction). Could lead to partial rollbacks that leave data in an inconsistent state.
- **Suggested fix:** Add a runtime guard: check `this.db.isTransaction` and either throw `"Nested transactions are not supported"` or reuse the existing transaction. Alternatively, split the interface so the `txStore` type does not expose `transaction()`.
- **Confidence:** High
- **Found by:** Logic, Error Handling, Contract, Concurrency, Security (5/5 specialists)

### [I2] `restoreChapter` SQLITE_CONSTRAINT_UNIQUE catch is overly broad
- **File:** `packages/server/src/chapters/chapters.service.ts:173`
- **Bug:** The catch block checks `(err as Record<string, unknown>).code === "SQLITE_CONSTRAINT_UNIQUE"` to detect slug collisions when restoring a deleted project. However, any unique constraint violation (not just slug) would be caught and returned as `"conflict"`. If a future migration adds another unique constraint to the projects table, a violation of that constraint would be silently misreported. The error shape is also driver-specific to better-sqlite3.
- **Impact:** A non-slug unique constraint violation would be silently swallowed and returned as a slug conflict to the user, masking the real error.
- **Suggested fix:** Check the error message for the specific constraint name (e.g., `err.message?.includes('projects.slug')`) or wrap this into a typed error inside the store's `updateProjectIncludingDeleted` method.
- **Confidence:** Medium
- **Found by:** Logic, Error Handling (2 specialists)

### [I3] `updateProject` throws Error on read-after-write failure, inconsistent with chapter service
- **File:** `packages/server/src/projects/projects.service.ts:160-161`
- **Bug:** `updateProject` throws `new Error("Project ... not found after update")` when the post-transaction read fails, which propagates as an unhandled 500. In contrast, `updateChapter` (chapters.service.ts:102) returns `"read_after_update_failure"` and `createChapter` (projects.service.ts:213) returns `"read_after_create_failure"` -- both of which the route layer handles gracefully. This inconsistency means the same class of failure produces different error responses.
- **Impact:** A read-after-write failure in `updateProject` produces a raw 500 error instead of a structured error response.
- **Suggested fix:** Return a sentinel value (e.g., `"read_after_update_failure"`) instead of throwing, matching the pattern used elsewhere. Update the route handler to map this sentinel to an appropriate HTTP response.
- **Confidence:** High
- **Found by:** Error Handling (1 specialist)

## Suggestions

- **[S1]** `getDashboard` (projects.service.ts:265-268) manually rebuilds `statusLabelMap` via `Object.fromEntries(allStatuses.map(...))` when `store.getStatusLabelMap()` already exists and is used by other callers in the same file. Could use the store method for the label map while keeping `listStatuses()` for status summary initialization. *(Found by: Contract)*

- **[S2]** Multiple service functions read back data outside the transaction boundary (projects.service.ts:159, chapters.service.ts:101, projects.service.ts:212, chapters.service.ts:189). Safe on SQLite with WAL mode today, but fragile if storage ever moves to connection pooling. Consider moving reads inside transactions for defense-in-depth. *(Found by: Logic, Error Handling, Concurrency)*

- **[S3]** `setProjectStore()` is exported from the public barrel (`stores/index.ts:16`). Only test code uses it. Consider not re-exporting it from the barrel so production code can't accidentally import it. *(Found by: Security)*

- **[S4]** The injectable test (`project-store-injectable.test.ts:15`) uses `setProjectStore(null as unknown as ProjectStore)` to reset state. A dedicated `resetProjectStore()` function in the injectable module would be cleaner and avoid the unsafe cast. *(Found by: Concurrency)*

- **[S5]** Velocity service bypasses ProjectStore, using `getDb()` and direct repo imports for chapter/project data. Intentional per design, but worth documenting in the ProjectStore interface as a known gap for when per-project storage is implemented. *(Found by: Logic, Contract)*

## Plan Alignment

- **Implemented:** All 12 design decisions from the storage architecture design doc are implemented correctly. Interface matches character-for-character. File organization, singleton pattern, startup wiring, test helpers, and all three service migrations are complete and faithful to the plan.
- **Not yet implemented:** None -- all tasks in the implementation plan appear complete.
- **Deviations:** Velocity calls happen outside transactions as best-effort fire-and-forget, rather than inside transactions using the raw `trx` escape hatch as illustrated in the design doc. This is a reasonable deviation -- velocity failure should not roll back saves. The escape hatch mechanism exists but is unused.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** 13 changed files + adjacent repositories, velocity service, route handlers
- **Raw findings:** 11 (before verification)
- **Verified findings:** 9 (after verification)
- **Filtered out:** 2 (F6: chapter_statuses cleanup -- intentional seed data; below threshold)
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** docs/plans/2026-04-12-storage-architecture-design.md, docs/plans/2026-04-12-storage-architecture-plan.md
