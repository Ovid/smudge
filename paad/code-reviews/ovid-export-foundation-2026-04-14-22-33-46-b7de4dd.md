# Agentic Code Review: ovid/export-foundation

**Date:** 2026-04-14 22:33:46
**Branch:** ovid/export-foundation -> main
**Commit:** b7de4dd788d400620c1e27bada3f15695065967f
**Files changed:** 51 | **Lines changed:** +4954 / -11
**Diff size category:** Large

## Executive Summary

The export foundation feature is well-implemented overall, with solid validation, proper error handling patterns, and good test coverage. Three important issues were identified: a design-doc deviation where zero-chapter exports return 400 instead of a title-page-only file, an AbortSignal that isn't wired to the actual fetch call (confirmed by three independent specialists), and silent content omission when chapter rendering fails. No critical issues found.

## Critical Issues

None found.

## Important Issues

### ~~[I1] Zero-chapter export returns 400 instead of title-page-only file~~ RESOLVED
- **File:** `packages/server/src/export/export.service.ts:52-54`
- **Resolution:** Moved the `noChapters` guard inside the `if (chapter_ids)` block so it only triggers when explicit chapter selection yields zero results. Without `chapter_ids`, empty projects now produce a title-page-only export (200). Tests updated. Fixed in `e8da8d1`.
- **Found by:** Plan Alignment

### ~~[I2] AbortSignal not passed to fetch in export API~~ RESOLVED
- **File:** `packages/client/src/api/client.ts:106-132` and `packages/client/src/components/ExportDialog.tsx:82-99`
- **Resolution:** Added `signal?: AbortSignal` parameter to `api.projects.export()`, forwarded it to `fetch()`, and wired `controller.signal` from `ExportDialog.handleExport`. Tests updated. Fixed in `648932b`.
- **Found by:** Logic & Correctness, Error Handling & Edge Cases, Concurrency & State

### [I3] Corrupt chapter content silently omitted from export
- **File:** `packages/server/src/export/export.renderers.ts:31-38`
- **Bug:** When `generateHTML()` throws on malformed TipTap JSON, `chapterContentToHtml()` catches the error, logs a warning, and returns `""`. The chapter heading still renders but the body is empty. The user receives an exported file with missing chapter content and no indication that anything went wrong.
- **Impact:** In a writing application where content integrity is the core trust promise, silently dropping chapter content is problematic. The user may treat the export as authoritative without realizing content was lost.
- **Suggested fix:** Either include a visible marker in the exported content (e.g., "[Chapter content could not be rendered]") or track rendering failures and return a warning header/field in the API response indicating which chapters had issues.
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases

## Suggestions

- `packages/client/src/api/client.ts:106-132` — `export()` method duplicates the error-handling pattern from `apiFetch` (lines 26-45). Consider extracting shared error-handling logic. (Contract & Integration)
- `packages/client/src/components/ExportDialog.tsx:103` — Client constructs its own download filename, ignoring the server's `Content-Disposition` header. The server's filename sanitization is dead code from the client's perspective. (Error Handling, Contract & Integration)
- `packages/client/src/components/ProjectSettingsDialog.tsx:172-175` — `handleAuthorNameBlur` fires `saveField` on every blur even when the value hasn't changed. A dirty check against `confirmedFieldsRef.current.authorName` would prevent unnecessary API calls. (Concurrency & State)
- `packages/server/src/export/export.routes.ts:29` — Error message "One or more chapter IDs do not belong to this project" is misleading when chapters were soft-deleted. Consider "One or more selected chapters are no longer available." (Error Handling)

## Plan Alignment

- **Implemented:** Tasks 1-12 from the implementation plan are reflected in the diff — database migration, author_name wiring, editor extensions, export renderers, Zod schema, export service, routes, client API, ExportDialog component, EditorPage integration, and tests.
- **Not yet implemented:** None identified — this appears to be a complete implementation of the plan.
- **Deviations:**
  - **(Important)** Zero-chapter export returns 400 instead of title-page-only 200 as specified in design doc (see I1 above).
  - **(Positive)** `EXPORT_FILE_EXTENSIONS` and `EXPORT_CONTENT_TYPES` moved to shared package, eliminating client/server duplication.
  - **(Positive)** `ExportSchema` adds `.max(1000)` on `chapter_ids` for defense-in-depth (not in plan).
  - **(Positive)** Markdown TOC uses index-based anchors (`#chapter-0`) instead of slugified anchors for cross-renderer compatibility.
  - **(Positive)** ExportDialog adds AbortController, double-click prevention via `exportingRef`, and `useCallback` wrappers for robustness (not in plan).
  - **(Positive)** `escapeHtml` adds single-quote escaping (`&#39;`) as a security fix.
  - **(Minor)** ExportDialog omits the close (X) button from the header that was in the plan — dialog is still closable via Cancel, Escape, or backdrop click.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment, Verifier
- **Scope:** 51 changed files (source + tests + docs + config), plus adjacent callers/callees one level deep
- **Raw findings:** 14 (before verification)
- **Verified findings:** 7 (3 Important, 4 Suggestions)
- **Filtered out:** 7 (false positives or below confidence threshold after verification)
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** docs/plans/2026-04-14-export-foundation-plan.md, docs/plans/2026-04-14-export-foundation-design.md
