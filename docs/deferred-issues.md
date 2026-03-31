# Deferred Issues

Issues identified during code review that need follow-up work. Each was verified but deferred because it requires design decisions or larger refactoring.

## From agentic review 2026-03-31 (ovid/architecture branch)

Source: `paad/code-reviews/ovid-architecture-2026-03-31-15-42-00-589336c.md`

### Corrupt chapter triggers misleading full-page error overlay

**Severity:** Important
**Files:** `packages/client/src/pages/EditorPage.tsx:324-342`, `packages/client/src/hooks/useProjectEditor.ts:143`

When a user clicks a chapter with corrupt content, the server returns 500 `CORRUPT_CONTENT`. The client catch block sets `error` state, which renders a full-page "Project not found" overlay hiding the sidebar. The user cannot navigate to other healthy chapters and the error message is misleading.

**What's needed:** Separate per-chapter errors from project-level errors. For `CORRUPT_CONTENT`, show an inline error in the editor area while keeping the sidebar navigable. Requires:
- A new error state (e.g., `chapterError`) distinct from the project-level `error`
- Client-side detection of the `CORRUPT_CONTENT` error code from the API response
- An editor-area error view that replaces the editor but not the sidebar

### handleSave discards 4xx server error messages

**Severity:** Important
**Files:** `packages/client/src/hooks/useProjectEditor.ts:92-104`

When a save attempt receives a 4xx response (e.g., 400 VALIDATION_ERROR), the retry loop correctly breaks immediately. However, the specific error message from the server is discarded. The user sees only the generic "Unable to save" message with no indication of what went wrong.

**What's needed:** Capture the error message from the 4xx response and surface it in the UI. Requires:
- Storing the server error message in state (e.g., `saveErrorMessage`)
- Updating the save status display in EditorPage to show the specific message
- Deciding whether to show a dismissible banner vs replacing the status text

### Status label enrichment duplicated across 6 call sites

**Severity:** Suggestion
**Files:** `packages/server/src/routes/chapters.ts`, `packages/server/src/routes/projects.ts`

The `{ ...chapter, status_label: ... }` pattern is repeated 6 times across two route files using two different lookup strategies (`getStatusLabel` for single chapters, `getStatusLabelMap` for arrays). Adding a field to the enrichment (e.g., status color) would require updating all 6 sites.

**What's needed:** An `enrichChapter(chapter, labelMap)` utility, or extend `queryChapter`/`queryChapters` to accept a label map and enrich in one step.

### content_corrupt flag not in shared Chapter type

**Severity:** Suggestion
**Files:** `packages/shared/src/types.ts`

The server can return `content_corrupt: true` on chapters with corrupt JSON, but the shared `Chapter` TypeScript interface has no such field. Client code cannot detect corrupt chapters without type assertions.

**What's needed:** Add `content_corrupt?: boolean` to the `Chapter` interface. Then update client code (particularly `useProjectEditor` and `EditorPage`) to handle it — e.g., disable auto-save for corrupt chapters, show a warning in the sidebar.

### Project detail and trash endpoints include corrupt chapters silently

**Severity:** Suggestion
**Files:** `packages/server/src/routes/projects.ts:203-218` (GET /:slug), `projects.ts:418-427` (GET /:slug/trash)

`GET /api/projects/:slug` and `GET /:slug/trash` return chapter arrays via `queryChapters`. If any chapter has corrupt JSON, it appears in the array with `content: null, content_corrupt: true` but no HTTP-level error. The client sidebar could show these chapters without warning.

**What's needed:** Depends on the `content_corrupt` type addition above. Once the client can detect the flag, the sidebar can render a warning icon. Alternatively, the server could strip content from project-level responses entirely (the client fetches individual chapters via GET anyway).
