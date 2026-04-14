# Agentic Code Review: ovid/export-foundation

**Date:** 2026-04-14 16:23:37
**Branch:** ovid/export-foundation -> main
**Commit:** b5ce513a4e7aa83622b14bdcd0ba114570492740
**Files changed:** 49 | **Lines changed:** +4796 / -5
**Diff size category:** Large

## Executive Summary

The export foundation implementation is well-structured and closely follows its design document. The core architecture (routes, service, renderers) is clean and the integration contracts between shared types, server, and client are correctly wired. Three important bugs were found: a missing zero-chapter guard on the "export all" path, incorrect Unicode handling in the plaintext renderer, and missing cancellation/guard logic in the ExportDialog. No critical issues.

## Critical Issues

None found.

## Important Issues

### [I1] Zero-chapter export produces near-empty file when chapter_ids is omitted
- **File:** `packages/server/src/export/export.service.ts:38-54`
- **Bug:** When `chapter_ids` is not provided (export all), the service fetches all chapters at line 38 but never checks if the result is empty. The `noChapters` guard at line 51 only runs inside the `if (chapter_ids)` block. A project with zero chapters produces a file containing only the title/metadata.
- **Impact:** Confusing UX -- user exports a project with no chapters and receives a near-empty file with no indication that something went wrong. The `noChapters` return variant and route error handler exist but are unreachable for this path.
- **Suggested fix:** Add `if (!chapter_ids && chapters.length === 0) return { noChapters: true };` after line 38.
- **Confidence:** High
- **Found by:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration

### [I2] `String.fromCharCode` should be `String.fromCodePoint` for supplementary Unicode
- **File:** `packages/server/src/export/export.renderers.ts:64-65`
- **Bug:** The `stripHtmlTags` function decodes numeric HTML entities using `String.fromCharCode()`. This only handles code points up to U+FFFF (BMP). Supplementary Unicode characters (emoji, CJK extensions, mathematical symbols) encoded as `&#128512;` or `&#x1F600;` will produce incorrect output.
- **Impact:** Plaintext export of content containing emoji or supplementary characters encoded as numeric entities will be garbled. Two-character fix.
- **Suggested fix:** Replace `String.fromCharCode` with `String.fromCodePoint` on both lines.
- **Confidence:** High
- **Found by:** Logic & Correctness

### [I3] In-flight export not cancelled on dialog close; ghost download
- **File:** `packages/client/src/components/ExportDialog.tsx:69-106`
- **Bug:** `handleExport` initiates an async fetch+blob+download flow with no cancellation. If the user closes the dialog while the export is in progress, the async callback continues to completion, creating a download link, clicking it, and triggering a file download after the dialog is dismissed.
- **Impact:** Unexpected file download after user cancels the dialog.
- **Suggested fix:** Use an AbortController tied to the dialog's open state. Check a ref before proceeding with the download after the fetch completes.
- **Confidence:** High
- **Found by:** Concurrency & State

### [I4] Double-click on Export fires concurrent requests
- **File:** `packages/client/src/components/ExportDialog.tsx:229-236`
- **Bug:** The Export button disables via React state (`disabled={exporting}`), but `setExporting(true)` is async. A fast double-click fires `handleExport` twice before the state update disables the button, producing two concurrent requests and two downloads.
- **Impact:** Duplicate downloads and unnecessary server load.
- **Suggested fix:** Add a synchronous ref-based guard (`exportingRef.current`) at the top of `handleExport`.
- **Confidence:** Medium
- **Found by:** Concurrency & State

### [I5] Content-Disposition header should sanitize filename
- **File:** `packages/server/src/export/export.routes.ts:43` + `packages/server/src/export/export.service.ts:85`
- **Bug:** The filename in the Content-Disposition header is built from `project.slug` without explicit sanitization. While slugs are currently constrained to `[a-z0-9-]` by `generateSlug()`, the export code does not enforce this and trusts an upstream invariant.
- **Impact:** If slug validation is ever relaxed, this becomes a header injection vector. Defense-in-depth is warranted for HTTP headers.
- **Suggested fix:** Sanitize the filename: `filename.replace(/["\\\r\n]/g, "_")` or use RFC 5987 `filename*` encoding.
- **Confidence:** Medium
- **Found by:** Error Handling & Edge Cases

## Suggestions

- `packages/server/src/export/export.renderers.ts:41-47` — `escapeHtml` does not escape single quotes. Safe today (all attributes use double quotes), but a defense-in-depth gap. Add `.replace(/'/g, "&#39;")`. Found by: Logic & Correctness, Error Handling & Edge Cases.
- `packages/client/src/api/client.ts:106-132` — Export API method duplicates the fetch/error-handling pattern from `apiFetch` (justified by needing blob response, but error handling could be shared). Found by: Contract & Integration.
- `packages/shared/src/schemas.ts:82` — No upper bound on `chapter_ids` array size. Add `.max(1000)` for defense-in-depth. Found by: Security.
- `packages/server/src/export/export.renderers.ts:186` — Markdown TOC anchors use `<a id>` HTML tags which some strict Markdown renderers strip, potentially breaking TOC links. Documented tradeoff. Found by: Contract & Integration.

## Plan Alignment

- **Implemented:** All core features — export endpoint, three renderers (HTML/Markdown/plaintext), ExportDialog, author_name field, shared schemas, editor extension divergence test, e2e tests with aXe, all string externalization.
- **Not yet implemented:** N/A — this branch appears to be feature-complete for Phase 3a.
- **Deviations:**
  - HTML CSS styles differ slightly from design doc (cosmetic, arguably improvements matching app's visual system).
  - Markdown TOC uses index-based anchors (`#chapter-0`) instead of slug-based (`#chapter-1-the-beginning`) — deliberate improvement for duplicate titles and non-Latin characters.
  - Added `EXPORT_NO_CHAPTERS` error code not in original design — reasonable addition.
  - Test for `aria-busy` loading state and Escape key dismissal in ExportDialog are missing from client test coverage.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** 49 changed files + callers/callees one level deep (export module, shared schemas/types, project service, client components, EditorPage integration)
- **Raw findings:** 24 (before verification)
- **Verified findings:** 9 (5 Important + 4 Suggestions)
- **Filtered out:** 15
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** docs/plans/2026-04-14-export-foundation-design.md, docs/plans/2026-04-14-export-foundation-plan.md
