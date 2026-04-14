# Agentic Code Review: ovid/export-foundation

**Date:** 2026-04-14 12:19:53
**Branch:** ovid/export-foundation -> main
**Commit:** fc3b8b0bed48ed4f33ae90ba2bc6527f0e57c74b
**Files changed:** 45 | **Lines changed:** +4276 / -5
**Diff size category:** Large

## Executive Summary

The export foundation is well-structured and thoroughly tested. Four important issues were found: a design doc deviation where soft-deleted chapter IDs are rejected instead of silently omitted, Markdown TOC anchors that break for non-Latin titles and duplicate chapter names, the ExportDialog swallowing specific server error messages, and a React effect dependency that can reset user-configured export options mid-dialog. No security issues. No critical bugs.

## Critical Issues

None found.

## Important Issues

### [I1] Soft-deleted chapter IDs rejected instead of silently omitted
- **File:** `packages/server/src/export/export.service.ts:54-60`
- **Bug:** The design doc says "Soft-deleted chapters in the list are silently omitted." But `listChapterIdsByProject()` only returns non-deleted IDs, so a soft-deleted chapter ID in `chapter_ids` triggers a 400 `EXPORT_INVALID_CHAPTERS` error instead of being silently filtered out.
- **Impact:** If a writer opens the export dialog, deletes a chapter in another tab, then exports with the stale chapter list, they get a confusing 400 error instead of a successful export of the remaining chapters. The alignment review (Issue #2) notes the user chose strict validation, but the design doc was not updated to reflect this decision.
- **Suggested fix:** Either update the service to silently filter out soft-deleted IDs (matching the design doc), or update the design doc to document the stricter behavior as intentional.
- **Confidence:** High
- **Found by:** Logic & Correctness, Contract & Integration, Plan Alignment

### [I2] Markdown TOC anchors break for non-Latin titles and duplicate chapter names
- **File:** `packages/server/src/export/export.renderers.ts:63-70, 168, 178`
- **Bug:** Three related issues: (a) `slugifyAnchor()` uses `\w` which in JavaScript only matches `[A-Za-z0-9_]` — CJK, Cyrillic, and other non-Latin characters are stripped, producing empty anchors. (b) Duplicate chapter titles produce identical slugs with no deduplication. (c) The generated anchors may not match what Markdown renderers (GitHub, VS Code, etc.) auto-generate from heading text, since there are no explicit anchor targets.
- **Impact:** TOC links in exported Markdown files are non-functional for non-ASCII chapter titles and for duplicate titles. The project explicitly supports CJK via `Intl.Segmenter` for word counting, so non-Latin content is a supported use case.
- **Suggested fix:** Use Unicode-aware regex (`\p{L}` with `u` flag), add deduplication logic (append `-1`, `-2` for repeats), or switch to index-based anchors like the HTML renderer uses.
- **Confidence:** High
- **Found by:** Logic & Correctness, Error Handling & Edge Cases

### [I3] ExportDialog swallows specific server error messages
- **File:** `packages/client/src/components/ExportDialog.tsx:105-106`
- **Bug:** The catch block uses the generic `STRINGS.export.errorFailed` string. The `ApiRequestError` thrown by the API client carries the server's specific error message (e.g., "One or more chapter IDs do not belong to this project"), but the catch doesn't even bind the error variable (`catch {`).
- **Impact:** When export fails, the user sees "Export failed. Please try again." with no actionable information about what went wrong.
- **Suggested fix:** Catch the error, check for `ApiRequestError`, and display its `message` property: `catch (err) { setError(err instanceof ApiRequestError ? err.message : STRINGS.export.errorFailed); }`
- **Confidence:** High
- **Found by:** Contract & Integration

### [I4] Reset effect fires on every `chapters` array reference change
- **File:** `packages/client/src/components/ExportDialog.tsx:26-35`
- **Bug:** The reset effect depends on `[open, chapters]`. In `EditorPage.tsx:455-459`, chapters are passed as `project.chapters.map(...)`, creating a new array reference on every render. While the dialog is open, any parent re-render (e.g., auto-save status changes) resets all dialog state — format, TOC checkbox, chapter selections — back to defaults.
- **Impact:** Users' export configuration choices are silently reverted during use. In a writing app with auto-save, parent re-renders are frequent.
- **Suggested fix:** Track the `open` transition edge with a ref, only resetting state when `open` transitions from `false` to `true`.
- **Confidence:** High
- **Found by:** Concurrency & State

## Suggestions

- `packages/server/src/export/export.renderers.ts:30-33` — `chapterContentToHtml()` calls `generateHTML()` without try/catch. Malformed TipTap JSON would crash the entire export with an unhelpful 500. Wrap in try/catch and return empty string or placeholder on failure. (Logic & Correctness, Error Handling)

- `packages/server/src/export/export.service.ts:25-29` and `packages/client/src/components/ExportDialog.tsx:88-92` — File extension mapping (`html/md/txt`) is duplicated in server and client. Client ignores server's `Content-Disposition` filename. Consider moving to `packages/shared/` or reading the header. (Contract & Integration)

- `packages/client/src/components/ExportDialog.tsx:95-102` — `URL.revokeObjectURL()` called synchronously after `a.click()`. Most modern browsers handle this correctly, but a `setTimeout` deferral is the defensive standard pattern. (Concurrency & State)

- `packages/server/src/__tests__/editorExtensions.test.ts:55-61` — Divergence test uses a snapshot instead of importing and comparing client extensions at runtime. Changes to client-side `editorExtensions.ts` would not be caught. Design doc specified runtime comparison. (Plan Alignment)

- `packages/client/src/components/ExportDialog.tsx:237-238` — `aria-busy` on the export button doesn't trigger screen reader announcements. Consider adding an `aria-live="polite"` region for the loading state, per the project's WCAG 2.1 AA requirement. (Plan Alignment)

## Plan Alignment

- **Implemented:** All 15 tasks from the implementation plan are complete. Migration, service, routes, renderers, client dialog, e2e tests, dependency licenses — all present and functional.
- **Not yet implemented:** N/A — this is the full Phase 3a scope.
- **Deviations:**
  - Soft-deleted chapter IDs are rejected (400) instead of silently omitted — intentional decision per alignment review Issue #2, but design doc not updated.
  - Extension divergence test uses snapshot approach instead of runtime client/server comparison.
  - HTML TOC uses `<ol>` (ordered list) — arguably more appropriate than the implied `<ul>`.
  - CSS values in HTML export differ slightly from design doc examples (cosmetic, non-prescriptive).

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** 45 changed files + adjacent callers/callees (project store, project service, project types, shared schemas/types, app.ts, client API, EditorPage)
- **Raw findings:** 12 (before verification)
- **Verified findings:** 9 (after verification)
- **Filtered out:** 3 (F2: intentional per design doc, F11: slug is ASCII-only, F12: no spec requirement)
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** docs/plans/2026-04-14-export-foundation-design.md, docs/plans/2026-04-14-export-foundation-plan.md, paad/alignment-reviews/2026-04-14-export-foundation-alignment.md
