# Alignment Review: Sidebar + Chapter Management & Preview Mode

**Date:** 2026-03-29
**Commit:** 4305cc7

## Documents Reviewed

- **Intent:** `docs/plans/mvp.md` (PRD v0.3.0)
- **Design:** `docs/plans/2026-03-29-sidebar-and-preview-design.md`
- **Action:** `docs/plans/2026-03-29-sidebar-preview-implementation.md`

## Source Control Conflicts

None — no conflicts with recent changes.

## Issues Reviewed

### [1] Project delete does not cascade soft-delete to chapters
- **Category:** Missing coverage
- **Severity:** Critical
- **Documents:** MVP P5 vs existing `DELETE /api/projects/:id` route
- **Issue:** MVP requires project deletion to soft-delete all chapters. The existing route only sets `deleted_at` on the project, orphaning chapters.
- **Resolution:** Added Task 1a to fix the existing route with a test.

### [2] Unified trash view and hard delete omitted
- **Category:** Design gap (intentional simplification)
- **Severity:** Important
- **Documents:** MVP §6.4 (`GET /api/trash`, `DELETE /api/trash/:id`) vs design decisions
- **Issue:** MVP defines a unified trash endpoint listing all deleted items (projects + chapters) and a hard-delete endpoint. The design chose per-project chapter-only trash and no manual hard delete (auto-purge only). This means deleted projects cannot be restored from the UI.
- **Resolution:** Accepted as intentional simplification for MVP. Project-level trash view on home page is a future TODO. PRD should be updated to note the scope change.

### [3] Preview endpoint not needed (correct simplification)
- **Category:** Out of scope (correctly)
- **Severity:** Minor
- **Documents:** MVP §6.5 vs design
- **Issue:** MVP defines `GET /api/projects/:id/preview`. Design uses client-side `generateHTML()` instead.
- **Resolution:** No action needed — simpler and data is already loaded.

### [4] Auto-save retry and beforeunload not in scope
- **Category:** Pre-existing gap
- **Severity:** Minor
- **Documents:** MVP §6.1 vs current codebase
- **Issue:** Exponential backoff retry (2s/4s/8s) and `beforeunload` guard are not implemented. This predates this plan.
- **Resolution:** Noted as out of scope for this plan. Separate follow-up.

### [5] Total manuscript word count missing from footer
- **Category:** Missing coverage
- **Severity:** Important
- **Documents:** MVP W5
- **Issue:** Footer only shows chapter word count, not total manuscript word count.
- **Resolution:** Added total word count display to footer in EditorPage (calculated from `project.chapters`).

### [6] Inline chapter rename in sidebar missing
- **Category:** Partial coverage
- **Severity:** Important
- **Documents:** MVP C2
- **Issue:** C2 requires "Chapter titles are editable inline in the sidebar." The Sidebar component only had select and delete.
- **Resolution:** Added double-click inline rename to Sidebar component with `onRenameChapter` prop and `handleRenameChapter` in the hook.

### [7] `aria-current` missing from active chapter in sidebar
- **Category:** Missing coverage
- **Severity:** Important
- **Documents:** MVP §8.4
- **Issue:** Active chapter only highlighted visually, no `aria-current="true"`.
- **Resolution:** Added `aria-current="true"` to active chapter `<li>` in Sidebar.

### [8] `aria-current` missing from active TOC link in preview
- **Category:** Missing coverage
- **Severity:** Minor
- **Documents:** MVP §8.4
- **Issue:** Active TOC link only styled visually, no `aria-current`.
- **Resolution:** Added `aria-current="true"` to active TOC `<a>` in PreviewMode.

### [9] Confirmation dialogs use `role="dialog"` instead of `role="alertdialog"`
- **Category:** Missing coverage
- **Severity:** Minor
- **Documents:** MVP §8.4
- **Issue:** MVP requires `role="alertdialog"` with `aria-describedby` for destructive confirmations.
- **Resolution:** Changed to `role="alertdialog"` with `aria-describedby` on delete confirmation dialog.

### [10] Reorder API body field name mismatch
- **Category:** Design gap
- **Severity:** Minor
- **Documents:** MVP §6.3 vs plan
- **Issue:** MVP uses `chapter_ids` (snake_case), plan used `chapterIds` (camelCase).
- **Resolution:** Changed to `chapter_ids` in API body to match MVP spec. Also changed error code to `REORDER_MISMATCH` per MVP §6.1.

## Unresolved Issues

- **Project-level trash/restore UI** — deleted projects cannot be recovered from the UI (Issue 2). Future TODO.
- **Auto-save retry with exponential backoff** — not yet implemented (Issue 4). Separate follow-up.
- **`beforeunload` guard** — not yet implemented (Issue 4). Separate follow-up.

## Alignment Summary

- **Requirements:** 10 relevant (C2-C6, R1-R4, W5), 9 covered, 1 deferred (unified trash)
- **Tasks:** 23 total (22 original + 1 added), all in scope
- **Design items:** 8 decisions, all aligned after fixes
- **Status:** Aligned — ready for implementation
