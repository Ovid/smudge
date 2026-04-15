# Agentic Code Review: ovid/document-export

**Date:** 2026-04-15 08:06:52
**Branch:** ovid/document-export -> main
**Commit:** 1d47df5d91e3161013968bd3f32960edb2b3fc2a
**Files changed:** 21 | **Lines changed:** +3119 / -24
**Diff size category:** Large

## Executive Summary

The document export feature (Word/.docx and EPUB) is well-structured with good test coverage, correct type integration, and proper error handling patterns. Two important bugs were found in the DOCX renderer: multi-line code blocks lose line breaks, and blockquote nested content loses italic/indent formatting. Several suggestions for minor improvements were also identified.

## Critical Issues

None found.

## Important Issues

### [I1] Multi-line code blocks lose line breaks in DOCX export
- **File:** `packages/server/src/export/docx.renderer.ts:223-229`
- **Bug:** TipTap `codeBlock` nodes contain text with embedded `\n` characters. The `inlineToRuns()` function creates a single `TextRun` per text node. The `docx` library's `TextRun` does not interpret `\n` as `<w:br/>` elements -- it requires explicit `break` properties. Multi-line code blocks render as a single continuous line in Word.
- **Impact:** Any code block with multiple lines will be unreadable in the exported Word document.
- **Suggested fix:** In the `codeBlock` case, split each text node's content on `\n` and interleave `TextRun({ break: 1, ...extraProps })` between line segments, or emit separate paragraphs per line with the monospace/shading styling.
- **Confidence:** High
- **Found by:** Logic & Correctness

### [I2] Blockquote nested non-paragraph content loses italic and indent formatting
- **File:** `packages/server/src/export/docx.renderer.ts:174-176`
- **Bug:** When a blockquote contains non-paragraph children (headings, lists, nested blockquotes), the code recurses via `blockToParagraphs(child, state)` but does NOT pass the `{ italics: true }` styling or the `indent: { left: 720 }` formatting. Only paragraph children (lines 166-172) get the blockquote treatment.
- **Impact:** Headings or lists inside a blockquote will render without indentation or italic styling in the exported Word document, losing the visual blockquote context.
- **Suggested fix:** Pass indent and italic properties through the recursive path, or wrap the recursive results with indent/italic formatting applied.
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases, Logic & Correctness

## Suggestions

- [S1] **Redundant DB query in export service** (`packages/server/src/export/export.service.ts:43`): `listChapterIdsByProject()` is called to validate chapter IDs, but the full chapter list was already fetched on line 40 via `listChaptersByProject()`. The valid IDs could be extracted as `chapters.map(ch => ch.id)` from the existing array, eliminating one database round-trip. (Found by: Contract & Integration)

- [S2] **List items flatten nested content** (`packages/server/src/export/docx.renderer.ts:185-219`): Both `bulletList` and `orderedList` handlers treat every child block as a leaf paragraph via `inlineToRuns()`. Nested lists or other block-level content inside list items is flattened. Low practical impact for typical writing, but contrasts with the blockquote handler which correctly recurses for non-paragraph children. (Found by: Logic & Correctness)

- [S3] **Ordered list ignores `start` attribute** (`packages/server/src/export/docx.renderer.ts:202-220`): TipTap ordered lists can have `attrs.start` for a starting number other than 1, but the code doesn't read it. All ordered lists start at 1 in the DOCX export. (Found by: Logic & Correctness)

- [S4] **Design doc testing section contradicts design body on EPUB headings** (`docs/plans/2026-04-14-document-export-design.md:155`): The testing spec says "Heading level shift (H3->H1, H4->H2, H5->H3)" for EPUB, but the design body says headings are "preserved as-is." Implementation correctly matches the design body. The stale test spec could mislead future work. (Found by: Plan Alignment)

- [S5] **DOCX headings use serif font instead of design-specified sans-serif** (`packages/server/src/export/docx.renderer.ts:345-349`): Design says "clean sans-serif for headings" but the implementation sets only Cambria (serif) as the document default with no heading-specific font override. Word's built-in heading styles may use Calibri (sans-serif) depending on theme resolution, making this ambiguous. (Found by: Plan Alignment)

## Plan Alignment

- **Implemented:** All Phase 3b plan items are implemented: docx renderer with TipTap JSON walking, EPUB renderer with chapterContentToHtml pipeline, shared schema updates, service wiring with exhaustiveness check, client dialog with 5 format options, e2e tests, dependency license audit.
- **Not yet implemented:** No remaining plan items -- all 8 tasks are complete.
- **Deviations:** (1) The plan's Task 2 still contains `shiftHeadingLevels()` code that was abandoned during implementation (documented in the plan's implementation note). (2) TOC `headingStyleRange` is "1-4" in code, matching the design doc, though the plan architecture summary implies "1-3" would suffice.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** 21 changed files + adjacent callers (export.routes.ts, slugify.ts, shared types)
- **Raw findings:** 12 (before verification)
- **Verified findings:** 7 (after verification)
- **Filtered out:** 5 (L5 fromCodePoint unlikely, CS1 revokeObjectURL standard pattern, S1 slugs already constrained, S2 generateHTML uses configured extensions only)
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** docs/plans/2026-04-14-document-export-design.md, docs/plans/2026-04-14-document-export-plan.md
