# Agentic Code Review: ovid/document-export

**Date:** 2026-04-15 10:21:34
**Branch:** ovid/document-export -> main
**Commit:** 3cf4093317c7c2d026291edcf094bff3fed54d64
**Files changed:** 24 | **Lines changed:** +3557 / -26
**Diff size category:** Large

## Executive Summary

The document export feature (Word/.docx and EPUB) is well-structured and follows the existing patterns. No critical issues were found. The main verified findings are: nested list indentation in DOCX doesn't reflect nesting depth (all lists render at level 0), the blockquote `extraRunProps` spread order is semantically backwards (fragile but not currently triggered), and the `noChapters` guard in the export service is dead code. Overall confidence in the implementation is high.

## Critical Issues

None found.

## Important Issues

### [I1] Nested lists always use `level: 0` in DOCX — no visual indentation for sub-lists
- **File:** `packages/server/src/export/docx.renderer.ts:225,251`
- **Bug:** Both `bulletList` and `orderedList` handlers always create list paragraphs with `level: 0`. When a list item contains a nested list, the nested list is processed via `blockToParagraphs` which allocates a new numbering reference but still uses `level: 0`. Word uses the `level` property to determine indentation and numbering format for nested lists. All levels render identically.
- **Impact:** Nested ordered/bullet lists in TipTap content export as flat (non-indented) lists in Word. The content is preserved but the hierarchical structure is lost visually.
- **Suggested fix:** Track nesting depth through `BlockContext` and pass it to bullet/numbering level. Define multiple levels in `allocateOrderedListRef`.
- **Confidence:** High
- **Found by:** Logic & Correctness

### [I2] Blockquote `extraRunProps` spread order inverts italics precedence
- **File:** `packages/server/src/export/docx.renderer.ts:205`
- **Bug:** The spread `{ italics: true, ...ctx?.extraRunProps }` means parent context properties override blockquote's forced `italics: true`. The correct order is `{ ...ctx?.extraRunProps, italics: true }` so blockquotes always force italic regardless of parent context.
- **Impact:** Currently no parent context sets `italics: false`, so the bug is latent. But the spread order is semantically backwards — the blockquote's own styling should win over inherited context, not the other way around.
- **Suggested fix:** Change to `extraRunProps: { ...ctx?.extraRunProps, italics: true }`.
- **Confidence:** Medium
- **Found by:** Logic & Correctness, Error Handling & Edge Cases

## Suggestions

### [S1] `noChapters` guard is dead code
- **File:** `packages/server/src/export/export.service.ts:52-54`
- **Bug:** The `{ noChapters: true }` return is inside the `if (chapter_ids)` block. At that point, all IDs have already passed the `invalidChapterIds` validation (they must exist in the live chapter set). Since `chapter_ids` is required to have `.min(1)` by Zod, the filtered array will always contain at least one element. The `noChapters` branch can never execute. Separately, projects with zero chapters that don't provide `chapter_ids` silently produce title-page-only exports.
- **Suggested fix:** Either remove the dead branch from the return type and route handler, or move the zero-chapter check outside the `chapter_ids` block if blocking empty exports is desired.
- **Confidence:** High
- **Found by:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration

### [S2] `bulletList` and `orderedList` handlers are nearly identical — duplication risk
- **File:** `packages/server/src/export/docx.renderer.ts:214-263`
- **Bug:** The two handlers differ only in `bullet: { level: 0 }` vs `numbering: { reference: listRef, level: 0 }`. Any future fix to one (e.g., nested list depth, context forwarding) must be manually mirrored to the other.
- **Suggested fix:** Extract a shared `listItemsToParagraphs(listItems, markerProps, state, ctx)` helper.
- **Confidence:** High
- **Found by:** Contract & Integration

### [S3] TipTap H1/H2 body headings silently become plain paragraphs in DOCX only
- **File:** `packages/server/src/export/docx.renderer.ts:21-25`
- **Bug:** `HEADING_MAP` only maps levels 3, 4, 5. TipTap H1/H2 in body content (from paste or future editor changes) hit the fallback path and render as unstyled paragraphs with a logger warning. EPUB/HTML/Markdown preserve all heading levels natively, creating a format-specific inconsistency.
- **Suggested fix:** Either extend `HEADING_MAP` to handle H1/H2 (mapping to appropriate Word heading levels) or add a comment documenting this as an intentional constraint.
- **Confidence:** Medium
- **Found by:** Error Handling & Edge Cases, Contract & Integration

### [S4] `String.fromCodePoint` can throw on invalid HTML entities in plain-text renderer
- **File:** `packages/server/src/export/export.renderers.ts:64-65`
- **Bug:** The entity decoder uses `String.fromCodePoint(Number(n))` without range checking. A numeric entity exceeding `0x10FFFF` (e.g., `&#9999999;`) throws `RangeError`, crashing the plain-text export.
- **Suggested fix:** Add a range guard: `const cp = Number(n); return cp >= 0 && cp <= 0x10FFFF ? String.fromCodePoint(cp) : '';`
- **Confidence:** Medium
- **Found by:** Security

### [S5] EPUB error message includes raw project title
- **File:** `packages/server/src/export/epub.renderer.ts:89-91`
- **Bug:** The thrown error includes `project.title` verbatim. While the global error handler returns a generic message to the client, the raw title appears in server logs. Low risk in a single-user app.
- **Suggested fix:** Log the title separately via `logger.warn` and throw a generic error message.
- **Confidence:** Low
- **Found by:** Security

## Plan Alignment

- **Implemented:** All 8 plan tasks are reflected in the diff — dependencies, renderers, schema, client UI, e2e tests, and validation.
- **Not yet implemented:** None — the plan appears fully executed.
- **Deviations:**
  - Plan Task 3 prose says "H3→Word Heading 1" but the plan's own table and design doc say H3→Heading 2. Implementation correctly follows the table/design. Plan prose is stale.
  - Plan Task 3 shows `headingStyleRange: "1-3"` but design doc and implementation use `"1-4"`. Implementation matches design.
  - Plan Task 2 RED tests assert heading shift behavior that was intentionally abandoned. Tests were correctly rewritten to assert preserved headings, but plan RED section was not updated.
  - Filename sanitization (allowlist regex) was added post-plan as a security fix. Improvement over plan.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** 24 changed files + adjacent callers (export.routes.ts, app.ts global error handler, client API, shared schemas)
- **Raw findings:** 25 (before verification)
- **Verified findings:** 7 (after verification)
- **Filtered out:** 18
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** docs/plans/2026-04-14-document-export-design.md, docs/plans/2026-04-14-document-export-plan.md
