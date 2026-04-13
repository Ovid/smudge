# Agentic Code Review: ovid/architecture

**Date:** 2026-04-13 08:22:36
**Branch:** ovid/architecture -> main
**Commit:** a1e69a5709e1723178532f5d68aa6e381973949b
**Files changed:** 37 | **Lines changed:** +1219 / -619
**Diff size category:** Large

## Executive Summary

This branch implements fixes for 14 architecture report findings (structured logging via pino, interface cleanup, component decomposition, dead code removal) plus CI improvements. All 14 architecture fixes are verified as correctly and completely addressed. One Important issue was found (dashboard refresh wiring gap) along with 8 Suggestions. No Critical issues.

## Critical Issues

None found.

## Important Issues

### [I1] Dashboard refresh not triggered outside nav button click
- **File:** `packages/client/src/components/ViewModeNav.tsx:47-51`, `packages/client/src/pages/EditorPage.tsx:147-153`
- **Bug:** `onDashboardRefresh()` (which increments `dashboardRefreshKey`) is only called inside ViewModeNav's dashboard button `.then()` chain. The `switchToView` callback in EditorPage sets `viewMode` but never calls `handleDashboardRefresh`. If a future keyboard shortcut or code path calls `switchToView("dashboard")` directly, the dashboard will show stale velocity data. Currently no keyboard shortcut targets dashboard directly (`Ctrl+Shift+P` only toggles editor/preview), so the bug is latent but architecturally fragile.
- **Impact:** Stale velocity data displayed when switching to dashboard via any path other than the nav button click.
- **Suggested fix:** Move `handleDashboardRefresh()` into `switchToView` when `mode === "dashboard"`, or wire it into the `useEffect` that watches `viewMode`.
- **Confidence:** High
- **Found by:** Logic & Correctness, Concurrency & State

## Suggestions

### [S1] Backoff array/retry count coupling is fragile
- **File:** `packages/client/src/hooks/useProjectEditor.ts:66-68`
- **Bug:** `BACKOFF_MS = [2000, 4000, 8000]` (3 elements) and `MAX_RETRIES = 3` are independent constants. If `MAX_RETRIES` is ever increased without extending `BACKOFF_MS`, `setTimeout(r, undefined)` fires immediately (no backoff). The save pipeline is the "core trust promise."
- **Suggested fix:** `const MAX_RETRIES = BACKOFF_MS.length;`
- **Found by:** Error Handling & Edge Cases

### [S2] Dead `.catch` in ViewModeNav — `flushSave` swallows errors upstream
- **File:** `packages/client/src/components/ViewModeNav.tsx:18-21, 32-35, 48-51`
- **Bug:** `switchToView` calls `flushSave()` which swallows its own errors internally. `onSwitchToView` therefore never rejects. The `.catch((err) => console.warn(...))` in each ViewModeNav button handler is dead code, giving a false impression of error handling. Rapid clicks can also launch parallel `switchToView` promises — last `setViewMode` wins.
- **Suggested fix:** Either propagate `flushSave` errors so the catch is meaningful, or remove the dead `.catch`. For the race condition, consider disabling buttons while a flush is in progress.
- **Found by:** Error Handling & Edge Cases, Concurrency & State

### [S3] Test naming mismatch: `isCorruptChapter`/`stripCorruptFlag` under wrong describe block
- **File:** `packages/server/src/__tests__/chapters.service.test.ts:51-81`
- **Bug:** Tests for `isCorruptChapter` and `stripCorruptFlag` live under `describe("chapters.service")` but the functions now live in `chapters.types` (moved by F-06 fix). Coverage attribution may be incorrect.
- **Suggested fix:** Move these test suites to `chapters.types.test.ts` or nest them under `describe("chapters.types helpers")`.
- **Found by:** Contract & Integration

### [S4] `updateDailySnapshot` nested transaction trap undocumented
- **File:** `packages/server/src/velocity/velocity.service.ts:45-52`
- **Bug:** `updateDailySnapshot` unconditionally calls `store.transaction()`. Currently safe because always called outside transactions (best-effort, after main tx commits). But `SqliteProjectStore.transaction()` throws `"Nested transactions are not supported"` if called on a transaction-scoped store. No JSDoc or comment warns future callers.
- **Suggested fix:** Add JSDoc: `/** Must not be called from within a store.transaction() callback. */`
- **Found by:** Contract & Integration, Error Handling & Edge Cases

### [S5] `getTodayDate()` called outside transaction boundary
- **File:** `packages/server/src/velocity/velocity.service.ts:47`
- **Bug:** `getTodayDate()` is called before `store.transaction()` opens. If midnight passes between the call and transaction commit, the snapshot records under yesterday's date. With synchronous SQLite the window is microseconds wide and purely theoretical.
- **Suggested fix:** Move `getTodayDate()` inside the transaction callback.
- **Found by:** Concurrency & State

### [S6] Missing defensive padding in `formatDateFromParts`
- **File:** `packages/server/src/velocity/velocity.service.ts:19-27`
- **Bug:** Relies on `Intl.DateTimeFormat` with `"2-digit"` to produce zero-padded values. `"2-digit"` always zero-pads on Node 20 V8/ICU, but `.padStart(2, "0")` would make the guarantee explicit at zero cost.
- **Suggested fix:** `return \`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}\`;`
- **Found by:** Error Handling & Edge Cases

### [S7] Raw `err.message` echoed to client for non-SyntaxError 4xx
- **File:** `packages/server/src/app.ts:71`
- **Bug:** For 4xx errors that aren't `SyntaxError`, `err.message` is returned verbatim. If middleware or a dependency throws with internal details in the message (file paths, SQL fragments), those would leak to the client. Zero practical risk in single-user no-auth deployment.
- **Suggested fix:** Return `err.message` only for known application error classes; use a generic message for others.
- **Found by:** Security

### [S8] SyntaxError message may log content snippet
- **File:** `packages/server/src/chapters/chapters.repository.ts:19`
- **Bug:** `JSON.parse` SyntaxError message on V8 includes a snippet of the unparseable input. Pino serializes `err.message`, so fragments of chapter content could appear in structured logs if the stored JSON is corrupt. Low risk in single-user context.
- **Suggested fix:** Log only `err.name` instead of the full error object: `{ parseError: (err as Error).name, chapter_id: ... }`
- **Found by:** Security

## Plan Alignment

All 14 architecture report findings were verified as correctly and completely addressed:
- **Implemented:** F-01 (structured logging), F-02 (client catch blocks), F-03 (Knex.Transaction leak), F-04 (EditorPage decomposition), F-06 (stripCorruptFlag cross-import), F-07 (velocity re-exports), F-09 (temporal coupling), F-11 (dead store interfaces), F-12 (error handler codes), F-14 (msPerDay), F-15 (useReducedMotion), F-16 (listChapterIdTitleStatusByProject), F-17 (test-only exports), F-18 (locale strings)
- **Not yet implemented:** N/A — all targeted items addressed
- **Deviations:** None. `logger.ts` correctly uses `console.warn` as a bootstrap fallback before pino is configured (F-01). Several intentionally bare client catch blocks remain in fallback/cleanup paths with inline documentation (F-02).

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment, Verifier
- **Scope:** 37 changed files + adjacent callers/callees (server: logger, app, chapters, velocity, stores, index, timezone; client: EditorPage, ViewModeNav, EditorFooter, ActionErrorBanner, useProjectEditor, HomePage, DashboardView)
- **Raw findings:** 20 (before verification)
- **Verified findings:** 9 (after verification)
- **Filtered out:** 11 (false positives, below threshold, pre-existing documented issues, theoretical in single-user SQLite)
- **Steering files consulted:** CLAUDE.md
- **Plan/design docs consulted:** paad/architecture-reviews/2026-04-12-smudge-architecture-report.md
