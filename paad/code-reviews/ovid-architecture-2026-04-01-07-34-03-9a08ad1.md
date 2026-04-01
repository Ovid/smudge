# Agentic Code Review: ovid/architecture

**Date:** 2026-04-01 07:34:03 UTC
**Branch:** ovid/architecture -> main
**Commit:** 9a08ad1ab8260131180666febaaa70531bc1079f
**Files changed:** 27 | **Lines changed:** +434 / -94
**Diff size category:** Medium

## Executive Summary

This branch addresses 5 of 7 targeted architecture findings (F-8, F-9, F-11, F-12, F-13): shared constant extraction, error pattern alignment with surgical revert logic, localStorage error logging with boolean return, and helmet security headers. The fixes are well-targeted and the F-11 handleStatusChange refactor is notably thorough with a three-tier revert strategy. Three important issues remain: CSP is disabled wholesale rather than configured, the setCachedContent boolean return is unused by callers (leaving the safety-net gap partially open), and handleStatusChange lacks a sequencing ref creating a race condition present in no other handler.

## Critical Issues

None found.

## Important Issues

### [I1] `helmet({ contentSecurityPolicy: false })` disables CSP entirely instead of configuring it
- **File:** `packages/server/src/app.ts:20`
- **Bug:** CSP is disabled wholesale. TipTap only needs `style-src 'unsafe-inline'` for inline styles; the rest of the CSP directives could remain restrictive. Without CSP, there is no browser-level XSS mitigation. The app renders user content via `dangerouslySetInnerHTML` in PreviewMode (with DOMPurify), making CSP a valuable defense-in-depth layer.
- **Impact:** No script execution policy. If a DOMPurify bypass is discovered, or if TipTap content is rendered unsanitized in a future code path, there is no fallback.
- **Suggested fix:** Configure a tailored CSP:
  ```typescript
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  }));
  ```
- **Confidence:** High
- **Found by:** Logic & Correctness, Error Handling & Edge Cases, Security

### [I2] `setCachedContent` boolean return value ignored -- safety-net failure remains invisible
- **File:** `packages/client/src/hooks/useProjectEditor.ts:122`
- **Bug:** `setCachedContent` was changed to return `boolean` (false on localStorage failure), but the only caller (`handleContentChange`) ignores the return value: `setCachedContent(activeChapterRef.current.id, content)`. CLAUDE.md states: "client-side cache holds unsaved content until server confirms." If caching silently fails (e.g., quota exceeded), the user's safety net is broken with no indication.
- **Impact:** User could lose unsaved content if both the cache write and subsequent server save fail, with no warning that the safety net was inactive.
- **Suggested fix:** Check the return value and react when false -- either trigger an immediate save bypass of the debounce, or set a degraded-protection warning state.
- **Confidence:** High
- **Found by:** Logic & Correctness, Error Handling & Edge Cases

### [I3] No sequencing guard in `handleStatusChange` -- concurrent calls race
- **File:** `packages/client/src/hooks/useProjectEditor.ts:239-308`
- **Bug:** Unlike `handleSave` (which uses `saveSeqRef`) and `handleSelectChapter` (which uses `selectChapterSeqRef`), `handleStatusChange` has no mechanism to discard stale async results. Two rapid status changes (e.g., "outline" -> "rough_draft" -> "revised") can interleave: if Call A fails and triggers a server-reload revert while Call B succeeds, the revert overwrites Call B's correct optimistic update. Additionally, `previousStatus` is read from `projectRef.current` (line 242), which is synced via `useEffect` and may be stale in rapid succession.
- **Impact:** Chapter status in the UI can silently diverge from server state. Persists until page reload.
- **Suggested fix:** Add a `statusChangeSeqRef` following the existing pattern:
  ```typescript
  const seq = ++statusChangeSeqRef.current;
  // ... after await ...
  if (seq !== statusChangeSeqRef.current) return; // newer call owns state
  ```
- **Confidence:** High
- **Found by:** Concurrency & State

### [I4] Purge deletes ALL chapters of expired projects, including potentially restored ones
- **File:** `packages/server/src/db/purge.ts:17`
- **Bug:** `trx("chapters").whereIn("project_id", ids).delete()` deletes all chapters belonging to purged projects with no `deleted_at` filter. If a chapter was individually restored (`deleted_at` set to null) while its parent project remained soft-deleted past the retention period, the purge permanently deletes the restored chapter.
- **Impact:** Data loss in an edge case where a chapter is restored but its parent project is not. The restore endpoint is supposed to restore both, but if the restore is partial or if a chapter is restored via direct DB manipulation, this safety net is missing.
- **Suggested fix:** Add `.whereNotNull("deleted_at")` to the orphan cleanup query for defense in depth, or add a test that confirms the restore endpoint always restores both chapter and project.
- **Confidence:** Medium
- **Found by:** Error Handling & Edge Cases

## Suggestions

- **[S1]** `packages/client/src/__tests__/useProjectEditor.test.ts:97`, `KeyboardShortcuts.test.tsx:221`, `api-client.test.ts:116` -- Three client test files still use hardcoded `"Untitled Chapter"` instead of importing `UNTITLED_CHAPTER` from `@smudge/shared`. Undermines single-source-of-truth benefit. Server tests correctly import the constant. (Found by: Contract & Integration, confidence 90%)
- **[S2]** 6+ client test files -- Identical `vi.mock("../hooks/useContentCache", ...)` block duplicated verbatim. When the API changes (as it did with the boolean return), all copies need independent updates. Extract to a shared test setup. (Found by: Contract & Integration, confidence 80%)
- **[S3]** `packages/client/src/hooks/useProjectEditor.ts:304` -- When `onError` is not provided, the error is silently swallowed after revert (no log, no state). Current callers always provide it, but the API permits silent failure. Add a `console.warn` fallback or make `onError` required. (Found by: Error Handling & Edge Cases, confidence 70%)
- **[S4]** `packages/client/src/components/Sidebar.tsx:25` -- `onStatusChange` typed as `(chapterId: string, status: string) => void` but receives an async function. TypeScript allows this but any synchronous throw would become an unhandled rejection. Consider typing as `void | Promise<void>`. (Found by: Contract & Integration, confidence 65%)
- **[S5]** `packages/server/src/db/migrations/001_create_projects_and_chapters.js:15` -- Migration still has hardcoded `"Untitled Chapter"` default. Acceptable since migrations are immutable, but the DB default is effectively dead code (server code uses the constant directly). (Found by: Contract & Integration, confidence 60%)
- **[S6]** Route handlers (`chapters.ts`, `projects.ts`) -- No UUID format validation on `:id` params before DB query. Not a security risk (Knex parameterizes), but malformed IDs reach DB unnecessarily. (Found by: Security, confidence 60%)

## Plan Alignment

- **Implemented:** F-8 (shared UNTITLED_CHAPTER constant), F-9 (shared TRASH_RETENTION_DAYS/MS constants), F-11 (handleStatusChange onError callback with three-tier revert), F-12 (console.warn in useContentCache + boolean return from setCachedContent), F-13 (helmet security headers)
- **Not yet implemented:** F-10 (structured server-side logging), F-14 (useProjectEditor god object decomposition)
- **Deviations:** F-12 boolean return is unused by callers (noted as I2). F-13 disables CSP entirely rather than configuring a tailored policy (noted as I1). Prior review issues I2 (CSP config) and I4 (sequencing guard) from the d034adc review remain open (noted as I1 and I3 above).
- **Prior review fixes confirmed:** `reverted = true` moved inside `if (revertedChapter)` (was I1 in d034adc review). Stale comment "handleStatusChange throws" updated. Server tests import constant. Hardcoded "30 days" now uses `TRASH_RETENTION_DAYS`.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** 27 changed files + callers/callees one level deep (useProjectEditor consumers, useContentCache consumers, purge callers, shared constant consumers, Sidebar prop types, PreviewMode rendering)
- **Raw findings:** 25 (before verification)
- **Verified findings:** 10 (after verification)
- **Filtered out:** 15 (ghost chapter revert is handled by existing guard, null projectRef guarded by previousStatus check, countWords throw is standard JS behavior, handleDeleteChapter stale ref is acknowledged/mitigated, TipTap passthrough is by design for attrs/marks, 5MB limit is reasonable, security header test is quality not bug, error handler messages are intentional validation responses, mock return type is consequence of I2, handleSave closure is safe due to flushSave pattern)
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** paad/architecture-reviews/2026-03-31-smudge-architecture-report.md, paad/code-reviews/ovid-architecture-2026-04-01-15-22-30-a03e940.md, paad/code-reviews/ovid-architecture-2026-04-01-16-45-00-d034adc.md
