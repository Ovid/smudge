# Alignment Review: Export Foundation (Phase 3a)

**Date:** 2026-04-14
**Commit:** 19ffae8

## Documents Reviewed

- **Intent:** `docs/plans/2026-04-14-export-foundation-design.md`
- **Action:** `docs/plans/2026-04-14-export-foundation-plan.md`
- **Design:** Same as intent (design doc serves as both spec and design)

## Source Control Conflicts

None — no conflicts with recent changes. The ProjectStore abstraction, chapter types, and route patterns are stable.

## Issues Reviewed

### [1] API path mismatch — design says `{id}`, codebase uses `{slug}`
- **Category:** contradictions
- **Severity:** Important
- **Documents:** Design doc API section vs. codebase route conventions
- **Issue:** Design doc used `{id}` in all API paths (`POST /api/projects/{id}/export`, `PATCH /api/projects/{id}`), but the codebase exclusively uses slugs for project routes.
- **Resolution:** Fixed design doc — all paths now use `{slug}`. Plan was already correct.

### [2] Missing strict chapter_ids validation
- **Category:** missing coverage
- **Severity:** Important
- **Documents:** Design doc validation requirements vs. plan Task 8
- **Issue:** Design requires "all IDs must belong to the project" but plan's service silently ignored unknown IDs (same as soft-deleted). User chose strict validation.
- **Resolution:** Added `invalidChapterIds` return type to service, `EXPORT_INVALID_CHAPTERS` error in routes, and integration test for cross-project ID rejection.

### [3] Missing "chapter with no title" test case
- **Category:** missing coverage
- **Severity:** Minor
- **Documents:** Design doc testing strategy vs. plan Task 6 renderer tests
- **Issue:** Design lists "Chapter with no title" as a required test case; plan omitted it.
- **Resolution:** Added empty-string title test case to HTML renderer tests.

### [4] Missing e2e test for chapter selection
- **Category:** missing coverage
- **Severity:** Minor
- **Documents:** Design doc e2e test list vs. plan Task 14
- **Issue:** Design lists "Export with chapter selection" as an e2e case; plan only had full-export and aXe tests.
- **Resolution:** Added e2e test that creates two chapters, unchecks one in the dialog, and verifies download.

### [5] Missing unit test for download trigger
- **Category:** missing coverage
- **Severity:** Minor
- **Documents:** Design doc client test list vs. plan Task 11
- **Issue:** Design lists "Download trigger on success" as a client test. Plan omits it.
- **Resolution:** No unit test added — the download flow (Blob/createObjectURL/anchor click) is DOM manipulation better verified in e2e. The e2e test already uses `page.waitForEvent("download")`.

## Alignment Summary

- **Requirements:** 22 total, 22 covered, 0 gaps
- **Tasks:** 15 total, 15 in scope, 0 orphaned
- **Status:** Aligned — ready for implementation

## TDD Status

The plan already follows TDD structure throughout (write test → verify failure → implement → verify pass → commit). No rewrite needed — the existing task format is equivalent to RED/GREEN/REFACTOR with explicit run commands and expected outputs at each step.
