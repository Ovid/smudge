# Agentic Code Review: ovid/architecture

**Date:** 2026-04-14 07:32:06
**Branch:** ovid/architecture -> main
**Commit:** 9936cdae95998eb4a3c7b26489dfbdd827c368af
**Files changed:** 15 | **Lines changed:** +600 / -71
**Diff size category:** Large (but ~450 lines are documentation; ~150 lines are code changes)

## Executive Summary

Clean architecture refactoring that unifies data access through ProjectStore, extracts status label enrichment helpers, and restricts test-only singletons. Two important issues found: the enrichment helpers have an asymmetric `content_corrupt` stripping contract that creates a latent API leak risk, and the post-save enrichment call can return 500 to the client even when the save succeeded. Four suggestions cover a redundant DB query regression, a misleading documentation comment, a leaked implementation name, and a silent status counting inconsistency.

## Critical Issues

None found.

## Important Issues

### [I1] Inconsistent `content_corrupt` stripping between singular and plural enrichment helpers
- **File:** `packages/server/src/chapters/chapters.types.ts:84-99`
- **Bug:** `enrichChapterWithLabel` (singular) internally calls `stripCorruptFlag`, removing `content_corrupt` from output. `enrichChaptersWithLabels` (plural) does NOT strip — it's generic over `T extends { status: string }` and passes through all input fields. In `projects.service.ts:112-113`, the caller must manually strip before calling the plural version and then cast the result `as ChapterWithLabel[]` to satisfy the type system. A future caller passing `ChapterRow[]` directly to the plural version would silently leak the internal `content_corrupt` flag to the API response.
- **Impact:** Latent data leak risk. The `as` cast suppresses type safety that would otherwise catch this. The two helpers have nearly identical names but silently different behavior.
- **Suggested fix:** Either make the plural version also strip `content_corrupt` when given `ChapterRow[]` (matching the singular version's behavior), or rename one function to make the behavioral difference explicit.
- **Confidence:** High
- **Found by:** Logic & Correctness, Contract & Integration

### [I2] Post-save enrichment failure returns 500 despite successful save
- **File:** `packages/server/src/chapters/chapters.service.ts:112`
- **Bug:** In `updateChapter`, after the save transaction succeeds (line 81-86) and the chapter is re-read (line 103), `enrichChapterWithLabel(store, updated)` calls `store.getStatusLabel()` which queries the DB. If this read fails, the unhandled exception propagates as a 500 response. The client interprets 500 as a save failure, triggering retries and persistent "Unable to save" warnings — even though the data was already persisted.
- **Impact:** The save pipeline is the "core trust promise" (per CLAUDE.md). A transient DB read failure during label enrichment would cause the client to show false save-failure indicators and potentially retry an already-committed save.
- **Suggested fix:** Wrap the enrichment call in a try/catch. On failure, fall back to using `chapter.status` as the label (matching the `?? ch.status` fallback already used in `enrichChaptersWithLabels`), rather than failing the entire response.
- **Confidence:** Medium
- **Found by:** Error Handling & Edge Cases

## Suggestions

### [S1] `getDashboard` calls `getStatusLabelMap()` twice (regression)
- **File:** `packages/server/src/projects/projects.service.ts:253-255`
- **Bug:** `enrichChaptersWithLabels(store, chapters)` on line 253 internally calls `store.getStatusLabelMap()`. Then line 255 calls `store.getStatusLabelMap()` again for the `statusSummary` computation. Pre-refactor code fetched the map once and used it for both purposes. Redundant DB query.
- **Confidence:** High
- **Found by:** Contract & Integration, Concurrency & State

### [S2] Barrel comment claims `resetProjectStore` is "test-only" but production code uses it
- **File:** `packages/server/src/stores/index.ts:4-5`
- **Bug:** Comment says "setProjectStore and resetProjectStore are @internal (test-only)" but `resetProjectStore` is called during production graceful shutdown at `packages/server/src/index.ts:73`. The JSDoc on the function itself (project-store.injectable.ts:25) is internally contradictory: starts with "@internal Test-only" then adds "Production code uses this only during graceful shutdown."
- **Confidence:** High
- **Found by:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration

### [S3] `velocity.service.ts` JSDoc references concrete `SqliteProjectStore` by name
- **File:** `packages/server/src/velocity/velocity.service.ts:42,61`
- **Bug:** JSDoc comments read "SqliteProjectStore forbids nesting" — referencing the concrete implementation in the service layer, which should depend only on the `ProjectStore` interface. The "no nesting" constraint is a property of the `transaction()` contract, not specific to one implementation.
- **Confidence:** Medium
- **Found by:** Contract & Integration

### [S4] `getDashboard` silently drops chapters with unknown statuses from `status_summary`
- **File:** `packages/server/src/projects/projects.service.ts:260-264`
- **Bug:** The `statusSummary` is initialized from `statusLabelMap` keys, then chapters are counted only if `ch.status in statusSummary`. A chapter with an unknown status would appear in the `chapters` array but not in the counts, so `status_summary` values won't sum to `totals.chapter_count`.
- **Confidence:** Medium
- **Found by:** Error Handling & Edge Cases

## Plan Alignment

- **Implemented:**
  - **F-05** (dual data access paths): Fully addressed. `velocity.service.ts` and `settings.service.ts` now use `getProjectStore()` exclusively. ProjectStore interface expanded with 5 new methods.
  - **F-08** (repeated status label enrichment): Fully addressed. `enrichChapterWithLabel()` and `enrichChaptersWithLabels()` replace all 6 inline patterns. `StatusLabelProvider` interface enables narrow dependency.
  - **F-10** (public setter/resetter functions): Addressed. Barrel export excludes `setProjectStore`/`resetProjectStore`. All singleton modules have `@internal` JSDoc.
  - **F-13** (velocity outside save transaction): Correctly marked "Won't fix" with sound rationale.
- **Not yet implemented:** No claimed fixes are missing. Branch scope was limited to F-05, F-08, F-10, F-13.
- **Deviations:**
  - F-08 helpers placed in `chapters.types.ts` (types file) rather than a separate module — creates mixed concerns (pure types + async DB-calling functions).
  - F-10 restriction is convention-based (barrel exclusion + JSDoc), not compiler-enforced. Sufficient for a single-developer project.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** 15 changed files + callers/callees one level deep (services, repositories, stores, test helpers, index.ts)
- **Raw findings:** 16 (before verification)
- **Verified findings:** 6 (after verification)
- **Filtered out:** 10 (5 rejected as false positives or below threshold, 5 deduplicated across specialists)
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** paad/architecture-reviews/2026-04-12-smudge-architecture-report.md
