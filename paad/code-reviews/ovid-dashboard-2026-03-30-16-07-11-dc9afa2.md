# Agentic Code Review: ovid/dashboard

**Date:** 2026-03-30 16:07:11
**Branch:** ovid/dashboard -> main
**Commit:** dc9afa274e0a0acfe378761c9500678fe3c34915
**Files changed:** 42 | **Lines changed:** +4590 / -186
**Diff size category:** Large

## Executive Summary

The dashboard feature is well-structured with solid test coverage and good accessibility work. Five important bugs were found: a stale closure in the status-change revert path that can silently corrupt UI state, missing `flushSave()` on the dashboard tab switch, silent error swallowing in the dashboard view, a stale-cache bug after 4xx save rejections, and an inconsistent state after delete-then-fetch failures. No critical issues. Overall confidence is moderate-to-high.

## Critical Issues

None found.

## Important Issues

### [I1] Stale closure in handleStatusChange error-revert path
- **File:** `packages/client/src/hooks/useProjectEditor.ts:234`
- **Bug:** The `catch` block in `handleStatusChange` checks `activeChapter?.id === chapterId` using the closure-captured `activeChapter`. If the user switches chapters while the API call is in flight, the closure holds the old chapter reference. The revert logic may then skip reverting the correct chapter or overwrite the wrong chapter's status in `setActiveChapter`.
- **Impact:** After a failed status change + chapter switch, the UI can permanently display the wrong status for a chapter with no indication of error.
- **Suggested fix:** Use `activeChapterRef.current?.id` (already maintained in the hook at line 17) instead of `activeChapter?.id` in the catch block at lines 221 and 234.
- **Confidence:** High
- **Found by:** Logic & Correctness, Concurrency & State

### [I2] Dashboard button doesn't flush pending saves
- **File:** `packages/client/src/pages/EditorPage.tsx:430-433`
- **Bug:** The Dashboard tab button calls `setViewMode("dashboard")` without first calling `editorRef.current?.flushSave()`. The Preview button (line 418) does call `flushSave()`. If the user has unsaved content (within the 1.5s debounce window) and clicks Dashboard, the save is never triggered.
- **Impact:** Content loss if the user navigates away from the dashboard tab before the debounce fires, or closes the browser (the `beforeunload` guard may not catch all cases).
- **Suggested fix:** Add `editorRef.current?.flushSave()` to the Dashboard button's onClick handler, matching the Preview button pattern.
- **Confidence:** High
- **Found by:** Logic & Correctness, Concurrency & State

### [I3] Dashboard fetch errors silently swallowed — permanent loading spinner
- **File:** `packages/client/src/components/DashboardView.tsx:30`
- **Bug:** The dashboard data fetch uses `.catch(console.error)` with no error state. When the fetch fails (network error, 404, server crash), `data` stays `null` and the component renders "Loading..." indefinitely.
- **Impact:** The user sees a permanent loading spinner with no explanation and no way to recover without navigating away.
- **Suggested fix:** Add an `error` state. In the `.catch` branch, set it and render a visible error message consistent with the rest of the app's error handling.
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases

### [I4] Stale cache persists after 4xx save rejection
- **File:** `packages/client/src/hooks/useProjectEditor.ts:86`
- **Bug:** When the server rejects content with a 4xx response, the `break` exits the retry loop and `setSaveStatus("error")` fires, but `clearCachedContent(savingChapterId)` is never called. In `handleSelectChapter` (lines 127-128), `getCachedContent(chapterId)` loads the cached content, overriding server data. So after a 4xx rejection, switching chapters and back reloads the rejected invalid content from cache.
- **Impact:** Invalid content that the server rejected is silently served from cache on every chapter switch, re-triggering 4xx failures each time with no indication that the content itself is the problem.
- **Suggested fix:** Call `clearCachedContent(savingChapterId)` on the `break` path (after the 4xx check at line 86) so the next load fetches last-known-good content from the server.
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases

### [I5] handleDeleteChapter leaves inconsistent state on secondary fetch failure
- **File:** `packages/client/src/hooks/useProjectEditor.ts:155-166`
- **Bug:** After `api.chapters.delete` succeeds, `setProject` removes the chapter from state (line 149). If `api.chapters.get(first.id)` at line 158 then throws, the catch at line 166 calls `setError`, but `activeChapter` was never updated — it still references the deleted chapter. The project has chapters but `activeChapter` points to a removed one.
- **Impact:** The user sees an error state but the underlying state is inconsistent. Recovery requires a page refresh.
- **Suggested fix:** Set `activeChapter` to `null` before attempting the secondary fetch, or catch the secondary fetch independently and fall through to `setActiveChapter(null)`.
- **Confidence:** Medium
- **Found by:** Error Handling & Edge Cases

### [I6] Most/least recent chapter identification mixes server and client data
- **File:** `packages/client/src/components/DashboardView.tsx:56-59, 111-123`
- **Bug:** The server provides `totals.most_recent_edit` (a timestamp) while the client independently identifies `mostRecentChapter` via a `.reduce()` over the chapters array. The UI then displays the server's timestamp alongside the client-identified chapter's title. If two chapters share the same `updated_at` value, `.reduce()` is not stable across engines — the title and timestamp could belong to different chapters.
- **Impact:** The dashboard could display "Most recent: Mar 28 (Chapter 3)" when the timestamp actually belongs to Chapter 5. A cosmetic but confusing inconsistency.
- **Suggested fix:** Either have the server return `most_recent_chapter_title` in `totals`, or derive both date and title entirely client-side. Don't mix sources.
- **Confidence:** Medium
- **Found by:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration

## Suggestions

- **STATUS_COLORS duplicated** (`DashboardView.tsx:16-22`, `Sidebar.tsx:21-27`): Identical constant in two files. Extract to a shared module to prevent divergence. *(Contract & Integration, conf 95%)*
- **STRINGS.status is dead code** (`strings.ts:84-90`): No component references `STRINGS.status`. Labels come from the DB via `ChapterStatusRow.label`. Remove to avoid confusion. *(Contract & Integration, conf 93%)*
- **Server-side statusLabelMap duplicated** (`projects.ts:208-211` and `:348-350`): Same DB query and `Object.fromEntries` pattern in two route handlers. Extract a helper function. *(Contract & Integration, conf 88%)*
- **handleRestore errors silently consumed** (`EditorPage.tsx:130-132`): `console.error` only. Show user-visible feedback for restore failures. *(Error Handling, conf 85%)*
- **openTrash errors silently consumed** (`EditorPage.tsx:108-111`): Same pattern. Show user-visible feedback. *(Error Handling, conf 82%)*
- **flushSave not awaited on Preview toggle** (`EditorPage.tsx:173, 418`): `flushSave()` returns a Promise but it's not awaited. The view switches before the save completes. *(Concurrency & State, conf 82%)*
- **Chapter type lacks status_label field** (`types.ts`): Server adds `status_label` to chapter responses but `Chapter` interface doesn't include it. Add `status_label?: string` to `Chapter` or create a `ChapterWithLabel` type. *(Contract & Integration, conf 80%)*
- **ChapterStatus Zod enum hardcodes DB-owned values** (`schemas.ts:5`): The Zod enum is static while the DB is authoritative. Adding a status to the DB without updating the enum causes a 400 at the Zod layer. Consider deriving valid statuses from the DB only. *(Logic & Correctness, conf 65%)*
- **slug as string type assertion** (`EditorPage.tsx:467`): `useParams` returns possibly-undefined `slug`, cast with `as string`. Add an early guard: `if (!slug) return <Navigate to="/" replace />;`. *(Contract & Integration + Security, conf 75%)*
- **Server PATCH: SELECT outside transaction** (`chapters.ts:92`): Post-update SELECT is outside the transaction. Move inside for consistency, though SQLite serialization makes this extremely unlikely to trigger. *(Error Handling, conf 70%)*
- **navAnnouncement never cleared** (`EditorPage.tsx:546`): After keyboard navigation, the aria-live region keeps stale content. Clear after a short delay. *(Concurrency & State, conf 68%)*
- **Unvalidated route parameters** (`chapters.ts`, `projects.ts`): `:id` and `:slug` params are not validated for format/length. Knex parameterization prevents SQL injection, but add UUID/slug format validation for defense-in-depth. *(Security, conf 68%)*

## Plan Alignment

- **Implemented:** All 6 tasks (migration, server API, sidebar badges, resizable sidebar, peer tabs + dashboard, chapter navigation shortcuts) are implemented and functional.
- **Not yet implemented:** N/A — all planned tasks are reflected in the diff.
- **Deviations:**
  - `STRINGS.dashboard.emptyState` is `"No chapters yet"` vs plan's `"No chapters yet. Add one to start writing."` — may cause test assertion failures *(conf 95%)*
  - `STRINGS.dashboard.columnWordCount` is `"Word Count"` vs plan's `"Words"` *(conf 92%)*
  - `mostRecentEdit`/`leastRecentEdit` format uses parentheses + year vs plan's em-dash + no year *(conf 90%)*
  - StatusBadge label text is always visible vs plan's `hidden sm:inline` responsive hiding *(conf 82%)*
  - Status summary bar uses `Object.entries(status_summary)` for ordering vs plan's explicit `statuses.map()` — subtly less deterministic *(conf 72%)*
  - Minor improvements over plan: loading state instead of `return null`, ARIA value attributes on resize handle

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** 42 changed files + adjacent callers/callees (useProjectEditor, EditorPage, DashboardView, Sidebar, PreviewMode, api/client, server routes, shared schemas/types, migration)
- **Raw findings:** 32 (before verification)
- **Verified findings:** 18 (after verification)
- **Filtered out:** 14 (2 false positives, 12 below threshold or duplicates merged)
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** docs/plans/2026-03-30-writers-dashboard-plan.md, docs/plans/2026-03-30-writers-dashboard-design.md
