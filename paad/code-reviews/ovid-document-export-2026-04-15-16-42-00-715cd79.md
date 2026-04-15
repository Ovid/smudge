# Agentic Code Review: ovid/document-export

**Date:** 2026-04-15 16:42:00
**Branch:** ovid/document-export -> main
**Commit:** 715cd791bbac0f170eb154c576f1af3f40495073
**Files changed:** 18 | **Lines changed:** +2833 / -18
**Diff size category:** Large

## Executive Summary

The document export feature (Phase 3b) adds Word (.docx) and EPUB renderers to the existing export pipeline. The implementation closely follows the design document and is well-tested. Four important issues were found: the EPUB renderer silently ignores the `includeToc` option (3 specialists agreed), the docx ordered list numbering doesn't reset between lists, H1/H2 heading levels are silently lost in docx export, and blockquote children that aren't paragraphs are silently dropped. Five additional suggestions for maintainability improvements.

## Critical Issues

None found.

## Important Issues

### [I1] `includeToc` option silently ignored for EPUB export
- **File:** `packages/server/src/export/epub.renderer.ts:40,63-74`
- **Bug:** The `_options` parameter (containing `includeToc`) is accepted but never read. The comment at line 63-65 claims "The includeToc option controls whether the TOC is prominently titled or given a minimal heading," but this behavior was never implemented. `tocTitle` is hardcoded to `"Table of Contents"` regardless.
- **Impact:** User unchecks "Include Table of Contents" in the export dialog, downloads an EPUB, and still gets a full TOC page. Behavioral inconsistency with HTML, Markdown, and plaintext renderers which all honor `includeToc`.
- **Suggested fix:** Either implement the option (pass `tocTitle: options.includeToc ? "Table of Contents" : ""` if the library supports it) or disable/hide the TOC checkbox in the UI when EPUB format is selected. Remove the misleading comment.
- **Confidence:** High
- **Found by:** Logic & Correctness, Contract & Integration, Plan Alignment

### [I2] Ordered list numbering does not reset between separate lists in docx
- **File:** `packages/server/src/export/docx.renderer.ts:159-161` and `:297-309`
- **Bug:** Every ordered list item in the entire document references the single numbering config `reference: "ordered-list"`. Word's numbering engine treats all paragraphs sharing the same reference as belonging to one continuous list. A document with two separate ordered lists shows items 1-2-3 then 4-5-6 (continuing) instead of 1-2-3 then 1-2-3 (resetting).
- **Impact:** Visibly wrong numbering in any docx export containing more than one ordered list.
- **Suggested fix:** Generate a unique numbering reference per `orderedList` node (e.g., `ordered-list-${counter++}`) and add a corresponding entry to the document's `numbering.config` array for each.
- **Confidence:** High
- **Found by:** Logic & Correctness

### [I3] H1 and H2 heading levels silently downgraded to normal paragraphs in docx
- **File:** `packages/server/src/export/docx.renderer.ts:104-112`
- **Bug:** `HEADING_MAP` maps only levels 3, 4, and 5. If TipTap content contains H1 or H2 headings (e.g., from pasted content), `HEADING_MAP[level]` returns `undefined`, the `if (heading)` branch is skipped, and the heading becomes a plain unstyled paragraph. No warning is logged (unlike the `default:` branch at line 189 which logs unknown node types).
- **Impact:** Silent data loss — headings typed at H1 or H2 lose their heading style on export with no indication to the user.
- **Suggested fix:** Log a warning for unmapped heading levels, analogous to line 189. Optionally map H1/H2 to Word's Heading 1 as a best-effort fallback.
- **Confidence:** High
- **Found by:** Logic & Correctness

### [I4] Blockquote renderer drops non-paragraph children silently
- **File:** `packages/server/src/export/docx.renderer.ts:114-128`
- **Bug:** The `blockquote` case iterates children and passes each `child.content` to `inlineToRuns()`. This works for `paragraph` children (whose content is inline). But TipTap allows blockquotes to contain headings, lists, nested blockquotes, etc. For those, `child.content` is an array of block nodes — `inlineToRuns()` processes only `"text"` and `"hardBreak"` nodes, so all others are silently skipped, producing empty paragraphs.
- **Impact:** Content loss for any blockquote containing headings, lists, or nested blockquotes in the docx export.
- **Suggested fix:** Check `child.type` inside the blockquote loop. For `paragraph` children, use `inlineToRuns` as now. For other block types, delegate to `blockToParagraphs(child)` and apply indent/italic styling to the resulting paragraphs.
- **Confidence:** High
- **Found by:** Logic & Correctness

## Suggestions

- [S1] `packages/client/src/api/client.ts:109` — Format type is manually re-declared as `"html" | "markdown" | "plaintext" | "docx" | "epub"` instead of importing `ExportFormatType` from `@smudge/shared`. Will require two-file update when a new format is added. (Contract & Integration)
- [S2] `packages/server/src/export/docx.renderer.ts:20-24` + `packages/server/src/export/export.renderers.ts:31-36` — Heading shift mapping is duplicated with different implementations (HEADING_MAP lookup vs. regex chain). Extract a shared constant for the mapping to prevent drift. (Contract & Integration)
- [S3] `packages/server/src/export/export.service.ts:74-90` — Switch has no `default` case or exhaustiveness assertion. Adding `default: { const _exhaustive: never = format; throw new Error(...); }` would catch future format additions at compile time. (Error Handling & Edge Cases)
- [S4] `packages/server/src/export/docx.renderer.ts:160,298` — Magic string `"ordered-list"` used in two places. Extract to a module-level constant. (Contract & Integration)
- [S5] `packages/server/src/export/export.renderers.ts:14` — `ExportProjectInfo.slug` is defined and populated but never read by any renderer. Remove dead field. (Contract & Integration)

## Plan Alignment

- **Implemented:** All 8 tasks from the implementation plan are reflected in this diff: dependencies + license audit, heading level shift, Word renderer, EPUB renderer, schema + service wiring, client UI updates, e2e tests.
- **Not yet implemented:** N/A — all planned tasks are present.
- **Deviations:** The `shiftHeadingLevels` regex processes in forward order (h3 first) rather than the plan's suggested reverse order (h5 first). Both orderings are correct because the input/output tag names are disjoint — this is a non-issue. The EPUB `includeToc` option was planned to be functional but was not implemented (see I1).

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** 18 changed files + export routes handler (unchanged but relevant) + app.ts error handling (unchanged but relevant)
- **Raw findings:** 22 (before verification)
- **Verified findings:** 9 (after verification)
- **Filtered out:** 13
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** docs/plans/2026-04-14-document-export-design.md, docs/plans/2026-04-14-document-export-plan.md
