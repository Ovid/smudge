# Agentic Code Review: ovid/document-export

**Date:** 2026-04-15 09:13:38
**Branch:** ovid/document-export -> main
**Commit:** c438af375922a1ad600580294734ffcfb26f5400
**Files changed:** 21 | **Lines changed:** +3193 / -26
**Diff size category:** Large

## Executive Summary

The document export feature (Word .docx and EPUB) is well-structured and follows the design closely. The main renderers, service wiring, shared schema, client UI, and test coverage are solid. Four important issues were found, all in the DOCX renderer's handling of nested/complex TipTap structures and in defense-in-depth sanitization. No critical bugs. Overall confidence in the implementation is high.

## Critical Issues

None found.

## Important Issues

### [I1] Nested blockquotes lose accumulated indent in DOCX
- **File:** `packages/server/src/export/docx.renderer.ts:203-206`
- **Bug:** The `blockquote` case creates a fresh `bqCtx` with `indent: { left: 720 }`, ignoring the incoming `ctx` parameter. A blockquote nested inside another blockquote gets the same 720-twip indent instead of accumulating (e.g., 1440 for double-nested).
- **Impact:** Nested blockquotes are visually flattened to a single indent level in Word output, losing document structure. Other formats (HTML, EPUB) correctly render nested indentation via native `<blockquote>` nesting.
- **Suggested fix:** Accumulate indent from the parent context:
  ```typescript
  const bqCtx: BlockContext = {
    indent: { left: (ctx?.indent?.left ?? 0) + 720 },
    extraRunProps: { italics: true, ...ctx?.extraRunProps },
  };
  ```
- **Confidence:** High
- **Found by:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration

### [I2] List items containing non-paragraph blocks silently flattened in DOCX
- **File:** `packages/server/src/export/docx.renderer.ts:214-255`
- **Bug:** Both `bulletList` and `orderedList` iterate over each list item's children and call `inlineToRuns()` on each block's `content`. This assumes every child is a paragraph with inline content. If a list item contains a nested list, blockquote, or other block-level node, `inlineToRuns` only handles `text` and `hardBreak` -- all other content is silently dropped.
- **Impact:** Nested lists and block content inside list items disappear from the DOCX export with no warning. TipTap supports nested lists, so this is a realistic user scenario causing silent data loss in exports.
- **Suggested fix:** Check each child block's `type` -- if it's a paragraph, use `inlineToRuns` as-is. For other block types, recursively call `blockToParagraphs(block, state, ctx)` to properly handle nesting.
- **Confidence:** High
- **Found by:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration

### [I3] `chapterContentToHtml` error fallback leaks into exports and bypasses EPUB empty-chapter guard
- **File:** `packages/server/src/export/export.renderers.ts:36-37`
- **Bug:** When `generateHTML()` throws, `chapterContentToHtml()` returns `"<p>[Content could not be exported]</p>"` instead of `""`. This non-empty error string: (a) appears as literal `[Content could not be exported]` in plain-text exports, (b) renders as `\[Content could not be exported\]` with escaped brackets in Markdown, and (c) bypasses the EPUB renderer's `if (html === "")` guard (epub.renderer.ts:58), embedding the error message in the EPUB instead of the `<p>&nbsp;</p>` placeholder the design specifies.
- **Impact:** Internal error messages leak into user-facing exported files. The EPUB renderer's graceful degradation for malformed content is bypassed.
- **Suggested fix:** Either (a) return `""` on error (original behavior) and let each renderer decide how to represent the failure, or (b) have each renderer check for the sentinel before format-specific conversion.
- **Confidence:** Medium
- **Found by:** Logic & Correctness, Error Handling & Edge Cases, Plan Alignment

### [I4] Content-Disposition filename uses denylist sanitization instead of allowlist
- **File:** `packages/server/src/export/export.service.ts:95` and `packages/server/src/export/export.routes.ts:43`
- **Bug:** `safeSlug` uses a denylist (`.replace(/["\\\r\n]/g, "_")`) that only removes four character classes. Characters like `;`, `%`, or non-ASCII bytes pass through to the `Content-Disposition` header. The header also lacks RFC 5987 `filename*=UTF-8''...` encoding for non-ASCII safety.
- **Impact:** Currently low risk because slugs are generated from project titles via a slug function that produces `[a-z0-9-]`. However, the defense-in-depth at point-of-use is incomplete -- if the slug invariant is ever broken (direct DB edit, migration, future code change), the header could be malformed.
- **Suggested fix:** Use an allowlist: `.replace(/[^a-z0-9_.-]/gi, "_")`.
- **Confidence:** Medium
- **Found by:** Error Handling & Edge Cases, Contract & Integration, Security

## Suggestions

- **[S1]** Ordered list `start` attribute is ignored in DOCX -- lists with `attrs.start` other than 1 reset to 1 in export. (`docx.renderer.ts:235-255`, Logic)
- **[S2]** Bullet list inside blockquote may have broken visual alignment due to interaction between `bullet: { level: 0 }` and explicit `indent`. Needs manual testing in Word. (`docx.renderer.ts:214-233`, Logic)
- **[S3]** Client filename construction (`ExportDialog.tsx:103`) diverges from server sanitization (`export.service.ts:95`). Browser typically uses server's `Content-Disposition` filename, but the code paths are decoupled. (Contract)
- **[S4]** Duplicated list-item iteration pattern in `bulletList` and `orderedList` cases -- nearly identical code that could diverge (and already has, per I2). Consider extracting a shared helper. (`docx.renderer.ts:214-255`, Contract)
- **[S5]** No server-side cancellation when client aborts export request -- server continues rendering to completion. Acceptable for a single-user app but worth noting for large documents. (Concurrency)

## Plan Alignment

- **Implemented:** All 8 plan tasks are complete. Both renderers, schema wiring, client UI, unit tests, integration tests, and e2e tests are in place.
- **Not yet implemented:** Manual smoke testing (Task 8 -- opening .docx in Word, .epub in reader) is a manual step not verifiable from code review.
- **Deviations:**
  - EPUB/HTML heading levels are preserved as H3/H4/H5 (not shifted) -- this is **correct per the design doc**, which overrides the plan's Task 2/4 test expectations. The plan's own note acknowledged this.
  - TOC `headingStyleRange` is `"1-4"` -- matches the design doc; the plan's Task 3 had `"1-3"` (typo in plan).
  - `chapterContentToHtml` error fallback returns visible error HTML instead of `""` -- differs from design assumption (see I3 above).
  - EPUB author metadata passes `undefined` instead of empty string when null -- functionally cleaner than the plan's specification.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** 21 changed files + adjacent callers (export.routes.ts, editorExtensions.ts)
- **Raw findings:** 16 (before verification)
- **Verified findings:** 9 (4 important + 5 suggestions)
- **Filtered out:** 7 (false positives or below threshold after verification)
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** docs/plans/2026-04-14-document-export-design.md, docs/plans/2026-04-14-document-export-plan.md
