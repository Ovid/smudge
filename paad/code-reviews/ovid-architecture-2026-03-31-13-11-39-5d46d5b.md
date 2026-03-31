# Agentic Code Review: ovid/architecture

**Date:** 2026-03-31 13:11:39
**Branch:** ovid/architecture -> main
**Commit:** 5d46d5b2aaebf6cb5268bb60a8b08272dc234ead
**Files changed:** 23 | **Lines changed:** +2267 / -179
**Diff size category:** Large

## Executive Summary

This branch adds architecture review fixes including corrupt content handling, query helpers, dashboard improvements, coverage thresholds, and e2e tests. The code is generally well-structured with good defensive patterns. The most significant issues found are: a misleading error overlay that shows "Project not found" for all error types, missing save-status reset on chapter switch, a content cache leak on chapter delete that can silently overwrite restored chapters, and missing security headers on a network-exposed application.

## Critical Issues

None found.

## Important Issues

### [I1] Error overlay shows "Project not found" for all error types
- **File:** `packages/client/src/pages/EditorPage.tsx:324-341`
- **Bug:** When `error` state is truthy, the component renders `STRINGS.error.projectNotFound` unconditionally, ignoring the actual error message. The `error` state is set to various messages (load failed, create chapter failed, corrupt content, etc.) but all are displayed as "Project not found" with a full-page overlay that hides the sidebar.
- **Impact:** Users receive misleading error messages for all failure modes. Corrupt content, network errors, and chapter load failures all appear as "Project not found." Users cannot navigate to other healthy chapters.
- **Suggested fix:** Display the actual `error` message, or differentiate between "not found" and other error types. Consider showing non-project errors as inline banners rather than full-page overlays.
- **Confidence:** High
- **Found by:** Logic & Correctness

### [I2] Save status not reset on chapter switch
- **File:** `packages/client/src/hooks/useProjectEditor.ts:130-144`
- **Bug:** `handleSelectChapter` increments `saveSeqRef` to cancel in-flight retries but never calls `setSaveStatus("idle")`. If the previous chapter's save was in "error" or "saving" state, that indicator persists for the newly selected chapter.
- **Impact:** Users see "Unable to save" for a chapter that hasn't been modified, or "Saving..." when nothing is being saved.
- **Suggested fix:** Add `setSaveStatus("idle")` in `handleSelectChapter` around line 133.
- **Confidence:** High
- **Found by:** Concurrency & State

### [I3] Content cache not cleared on chapter delete — stale draft overwrites restored content
- **File:** `packages/client/src/hooks/useProjectEditor.ts:152-183`
- **Bug:** `handleDeleteChapter` never calls `clearCachedContent(chapter.id)`. The localStorage draft entry persists after deletion. If the chapter is later restored, `handleSelectChapter` (line 137-138) loads the stale cached draft, which then triggers auto-save, silently overwriting the server's restored content.
- **Impact:** Data integrity risk. Restored chapters can silently lose content, replaced by an outdated cached draft from before deletion.
- **Suggested fix:** Add `clearCachedContent(chapter.id)` after the successful `api.chapters.delete` call, around line 154.
- **Confidence:** High
- **Found by:** Concurrency & State

### [I4] `resolveUniqueSlug` ignores soft-deleted slugs — restore can be permanently blocked
- **File:** `packages/server/src/routes/resolve-slug.ts:11` and `packages/server/src/routes/chapters.ts:187-210`
- **Bug:** `resolveUniqueSlug` filters `.whereNull("deleted_at")`, only checking active projects. If the DB has a UNIQUE constraint on `slug` covering all rows (including deleted), a soft-deleted project's slug blocks the restore. The catch returns 409 "Please try again" but retrying produces the identical result since the conflicting soft-deleted row persists.
- **Impact:** Chapter restore can be permanently blocked with a misleading retry suggestion. The user has no way to resolve this.
- **Suggested fix:** Either make `resolveUniqueSlug` check all projects (including deleted) when generating slugs, null out slugs on soft-delete, or add a partial UNIQUE index. Update the error message to be actionable.
- **Confidence:** Medium
- **Found by:** Logic & Correctness, Security

### [I5] No security headers (helmet)
- **File:** `packages/server/src/app.ts`
- **Bug:** The Express app sets no security-related HTTP headers. No `helmet()`, CSP, X-Frame-Options, or X-Content-Type-Options. The app is exposed via Docker on port 3456.
- **Impact:** Missing defense-in-depth. Clickjacking, MIME-type sniffing, and content injection risks for a network-exposed application.
- **Suggested fix:** Add `helmet()` middleware in `createApp()`.
- **Confidence:** High
- **Found by:** Security

### [I6] No CORS configuration — DNS rebinding risk
- **File:** `packages/server/src/app.ts`
- **Bug:** No CORS middleware configured. For a no-auth app exposed on a network port, DNS rebinding can bypass same-origin policy, allowing a malicious page to read/modify/delete all data.
- **Impact:** A malicious page visited by the user could interact with the Smudge API if the app is network-accessible.
- **Suggested fix:** Add explicit CORS middleware restricting `Origin` to expected values. Consider `Host` header validation.
- **Confidence:** Medium
- **Found by:** Security

### [I7] Word count display lacks `aria-live` attribute (spec deviation)
- **File:** `packages/client/src/pages/EditorPage.tsx:584-595`
- **Bug:** The word count `<div>` has no `aria-live` attribute. The sibling save-status `<div>` at line 596 has `aria-live="polite"`, but the word count is in a separate element without it. CLAUDE.md and the MVP spec require `aria-live="polite"` for word count. Additionally, word count updates on every keystroke rather than per-save as the spec recommends.
- **Impact:** Screen reader users are not notified of word count changes. Per-keystroke updates would also be noisy if `aria-live` were added without debouncing.
- **Suggested fix:** Add `aria-live="polite"` to the word count container. Consider updating word count display only on save to match the spec and avoid screen-reader noise.
- **Confidence:** High
- **Found by:** Plan Alignment

### [I8] Chapter soft-delete doesn't update project `updated_at`
- **File:** `packages/server/src/routes/chapters.ts:145-146`
- **Bug:** The delete handler does a bare `UPDATE` without a transaction and does not update the parent project's `updated_at` timestamp. Chapter create (projects.ts:240-258) and chapter update (chapters.ts:99-104) both update the project timestamp inside transactions.
- **Impact:** The project list (sorted by `updated_at`) and dashboard "most recent edit" won't reflect chapter deletions. Inconsistent with sibling mutations.
- **Suggested fix:** Wrap in a transaction that also updates `projects.updated_at`, matching the pattern in PATCH and POST handlers.
- **Confidence:** Medium
- **Found by:** Concurrency & State

## Suggestions

- **[S1]** `packages/server/src/routes/projects.ts:361-366` — Dashboard endpoint duplicates `getStatusLabelMap()` logic inline. The utility is already imported in the same file. Use it. (Contract & Integration, conf 90)
- **[S2]** `packages/shared/src/types.ts` — `content_corrupt` field not in shared `Chapter` type. Server sets it, client cannot detect it. Already tracked in `docs/deferred-issues.md`. (Contract & Integration, Plan Alignment)
- **[S3]** `packages/server/src/routes/chapters.ts:106-127` — Post-update corrupt check can return 500 after the update transaction committed successfully, misrepresenting the outcome to the client. (Contract & Integration)
- **[S4]** `packages/client/src/hooks/useProjectEditor.ts:92-104` — Save failure discards server's specific 4xx error message. User sees generic "Unable to save" instead of actionable validation feedback. Already tracked in `docs/deferred-issues.md`. (Plan Alignment)
- **[S5]** `packages/client/src/hooks/useProjectEditor.ts:93` — CORRUPT_CONTENT (500) during PATCH triggers 3 save retries with 14s backoff even though retrying corrupt content is pointless. (Error Handling & Edge Cases)
- **[S6]** `packages/client/src/hooks/useProjectEditor.ts:278` — `handleStatusChange` re-throws unlike all sibling handlers which catch internally. Inconsistent API contract for callers. (Error Handling & Edge Cases)
- **[S7]** `CLAUDE.md:11` — "Current status: Greenfield — spec complete, no source code yet" is stale. Project has substantial source code. (Plan Alignment)
- **[S8]** `packages/shared/src/schemas.ts:16-21` — TipTapDocSchema uses `.passthrough()` accepting arbitrary nested content. Combined with `generateHTML()`, consider validating known node types. (Security)
- **[S9]** `packages/server/src/routes/resolve-slug.ts:18-25` — Sequential slug queries (up to 1000 individual SELECTs) inside a transaction. Could be a single `LIKE` query. Negligible with SQLite but worth noting. (Contract & Integration)

## Plan Alignment

- **Implemented:** Coverage thresholds enforced in vitest.config.ts, corrupt content handling (parseChapterContent + content_corrupt flag + 500 responses), queryChapter/queryChapters helpers encapsulate JSON parsing, e2e tests for save pipeline and failure recovery, dashboard endpoint with status summary
- **Not yet implemented:** Unified trash endpoint (spec defines `GET /api/trash`, implementation uses per-project `GET /api/projects/:slug/trash`), hard-delete from trash endpoint (`DELETE /api/trash/{id}`), dedicated preview endpoint (`GET /api/projects/{id}/preview`)
- **Deviations:**
  - CLAUDE.md status line says "no source code yet" (stale)
  - API uses slug-based routing (`/:slug`) where spec uses ID-based (`/{id}`) — likely intentional improvement
  - `status` column and `chapter_statuses` table extend beyond MVP data model — undocumented scope addition
  - Word count display updates per-keystroke instead of per-save as spec requires

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** 23 changed files + adjacent callers/callees (status-labels.ts, resolve-slug.ts, app.ts, api/client.ts, useContentCache.ts, schemas.ts)
- **Raw findings:** 33 (before verification)
- **Verified findings:** 17 (8 Important, 9 Suggestions)
- **Filtered out:** 16
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** docs/plans/mvp.md, docs/deferred-issues.md
