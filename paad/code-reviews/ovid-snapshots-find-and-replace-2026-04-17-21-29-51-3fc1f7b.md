# Agentic Code Review: ovid/snapshots-find-and-replace

**Date:** 2026-04-17 21:29:51
**Branch:** ovid/snapshots-find-and-replace -> main
**Commit:** 3fc1f7bb899912be0a26555c571c4b2a358ac239
**Files changed:** 76 | **Lines changed:** +11,745 / -125
**Diff size category:** Large

## Executive Summary

This branch has been through ~20 prior review rounds and is in good shape overall — contracts are tight, schemas are largely `.strict()`, and ReDoS/amplification guards are in place. The two Critical findings that remain center on the auto-save retry loop silently dropping keystrokes typed during backoff (X2/X3) and the snapshot-restore flow mishandling chapter switches mid-flight (E5/E6), both of which can cause silent data-loss for the writer. Several Important error-path bugs misclassify 400/abort/network errors as generic failures in the find-replace UI.

## Critical Issues

### [C1] Save retry loop loses keystrokes typed during backoff
- **File:** `packages/client/src/hooks/useProjectEditor.ts:63-128` (and `:99`)
- **Bug:** `handleSave(content)` captures the `content` parameter in its closure for all 3 retries (2s/4s/8s). Keystrokes the user makes during the backoff land in the localStorage cache via `handleContentChange`. When a retry eventually succeeds with the *old* content, line 99 unconditionally runs `clearCachedContent(savingChapterId)` and wipes the newer cached keystrokes; `activeChapter.content` is also set to the stale payload.
- **Impact:** Silent data loss of user writing — exactly the class of failure the retry loop was supposed to prevent.
- **Suggested fix:** Re-read the latest content from a ref (updated in `handleContentChange`) on each retry; only `clearCachedContent` when cache equals the posted content; or bump `saveSeqRef` on every content change so a new save supersedes the retrying one.
- **Confidence:** High (85)
- **Found by:** Concurrency & State

### [C2] Restore succeeds on old chapter when user switches mid-flight, then client reloads the new chapter
- **File:** `packages/client/src/hooks/useSnapshotState.ts:109-131` + `packages/client/src/pages/EditorPage.tsx:154-183`
- **Bug:** If the user switches chapters while a snapshot restore is in flight, `restoreSnapshot` returns `{ok: true}` without signaling the stale-chapter case. The server has already rewritten chapter A, but `EditorPage.handleRestoreSnapshot` blindly calls `reloadActiveChapter()`, which reloads chapter B. Chapter A's displayed state is never refreshed; the restore happened silently on a chapter the user is no longer looking at.
- **Impact:** Silent content change to a chapter without UI confirmation; potential confusion if the user switches back and finds different content than what their client last rendered.
- **Suggested fix:** Capture chapter id at click time. Return `{ok: true, staleChapterSwitch: true}` from the hook when `seq !== chapterSeqRef.current`, and have the caller skip `reloadActiveChapter()` for that branch (or reload *the captured chapter id* if still in-project).
- **Confidence:** High (80)
- **Found by:** Error Handling + Concurrency & State (overlap)

## Important Issues

### [I1] `match_index` has no upper bound in Zod schema; match cap doesn't apply in match_index mode
- **File:** `packages/server/src/search/search.routes.ts:43` + `packages/shared/src/tiptap-text.ts:452-464`
- **Bug:** Route schema only requires `z.number().int().min(0)`. The walker explicitly skips `MAX_MATCHES_PER_REQUEST` in `match_index` mode. A client passing `match_index: 10_000_000` triggers unbounded enumeration bounded only by the 2s regex deadline.
- **Fix:** Clamp `match_index` ≤ `MAX_MATCHES_PER_REQUEST` in the schema, or honor the cap inside the walker and surface `MatchCapExceededError`.
- **Confidence:** Medium-High (75)
- **Found by:** Logic & Correctness

### [I2] Find-replace panel: every non-{MATCH_CAP,REGEX_TIMEOUT} 400 renders as "Invalid regex"
- **File:** `packages/client/src/hooks/useFindReplaceState.ts:115-121`
- **Bug:** `VALIDATION_ERROR` (query-too-long, bad request shape) gets shown as "Invalid regex." User sees the wrong diagnosis.
- **Fix:** Branch explicitly on `err.code === "INVALID_REGEX"`; otherwise use `err.message`.
- **Confidence:** High (82)
- **Found by:** Error Handling

### [I3] `executeReplace` error handling misclassifies abort/404/5xx as generic `replaceFailed`
- **File:** `packages/client/src/pages/EditorPage.tsx:234-248`
- **Bug:** Only 400s are discriminated by code. `ABORTED` shows a failure banner despite being a user-initiated cancel; 404 (scope not found) and 5xx all collapse to the same "replace failed" copy.
- **Fix:** Silently swallow `err.code === "ABORTED"`; distinguish 404 ("chapter no longer exists"); surface `err.message` for 5xx.
- **Confidence:** Medium-High (70)
- **Found by:** Error Handling

### [I4] `apiFetch` lets `TypeError: Failed to fetch` bypass the `ApiRequestError` envelope
- **File:** `packages/client/src/api/client.ts:32-56`
- **Bug:** The `.catch` only wraps `AbortError` as `ApiRequestError`. Raw network failures re-throw as bare `TypeError`, so `err instanceof ApiRequestError` is `false` at every call site and error copy falls back to a generic message on the exact path (offline/network loss) that most needs clarity.
- **Fix:** Wrap remaining failures as `new ApiRequestError(err.message, 0, "NETWORK")`.
- **Confidence:** High (80)
- **Found by:** Error Handling

### [I5] `handleReplaceOne` bare `catch {}` — no code discrimination, swallowed error
- **File:** `packages/client/src/pages/EditorPage.tsx:348`
- **Bug:** Unlike `executeReplace`, the Replace-one path shows generic `replaceFailed` for every error — including `MATCH_CAP_EXCEEDED`, `REGEX_TIMEOUT`, `CONTENT_TOO_LARGE`, `INVALID_REGEX`, and `ABORTED`. The caught error instance is thrown away entirely.
- **Fix:** Mirror `executeReplace`'s discriminated handling.
- **Confidence:** High (85)
- **Found by:** Error Handling

### [I6] `cancelPendingSaves` does not reset `saveStatus` — UI can stay stuck on "Saving…"
- **File:** `packages/client/src/hooks/useProjectEditor.ts:416-423`
- **Bug:** After `cancelPendingSaves()` (e.g., before snapshot restore), the in-flight save's status-write is guarded by the chapter/seq check and short-circuits. `saveStatus` remains "saving" indefinitely.
- **Fix:** Set `setSaveStatus("idle")` inside `cancelPendingSaves`.
- **Confidence:** Medium-High (75)
- **Found by:** Concurrency & State

### [I7] Keyboard shortcut guard omits `replaceConfirmation` — Ctrl+H toggles panel while confirm dialog is open
- **File:** `packages/client/src/hooks/useKeyboardShortcuts.ts:104-119`
- **Bug:** The modal-open guard includes `shortcutHelpOpen`, `deleteTarget`, `projectSettingsOpen`, `exportDialogOpen` — but not the Replace All confirmation dialog. Ctrl+H with that dialog open closes/reopens the panel underneath, leaving the dialog confirming against hidden state.
- **Fix:** Pipe `replaceConfirmation !== null` into the deps and the guard.
- **Confidence:** High (85)
- **Found by:** Concurrency & State

### [I8] Zod schema strictness gaps: `TipTapDocSchema.passthrough()` + `CreateSnapshotSchema` missing `.strict()`
- **File:** `packages/shared/src/schemas.ts:42-47, 133-139`
- **Bug:** `TipTapDocSchema` uses `.passthrough()` (unknown keys silently stored) and has no depth/recursion cap. `CreateSnapshotSchema` lacks `.strict()`, diverging from every other body schema. Deeply nested TipTap docs up to the 5 MB body limit can stack-overflow recursive walkers (`collectLeafBlocks`, `canonicalize`, `countWords`).
- **Fix:** Add `.strict()` on `CreateSnapshotSchema`. Enforce a depth cap (~50-128) for TipTap content at validation time, or make walkers iterative.
- **Confidence:** Medium-High (75)
- **Found by:** Error Handling + Security (cross-specialist agreement)

### [I9] `snapshots.repository.ts:insert()` returns raw input, bypassing `coerceRow`
- **File:** `packages/server/src/snapshots/snapshots.repository.ts:11-14`
- **Bug:** Every other read path uses `coerceRow()` to normalize `is_auto` to a JS boolean. `insert()` returns the caller-provided `data as SnapshotRow` unchanged. Works today (input is already boolean) but a future change that round-trips through SQLite or swaps the store silently breaks consumers.
- **Fix:** `return coerceRow(data as SnapshotRow)`, or re-fetch via `findById` after insert.
- **Confidence:** High (85)
- **Found by:** Contract & Integration

### [I10] `useFindReplaceState.closePanel` does not clear result state
- **File:** `packages/client/src/hooks/useFindReplaceState.ts:75-77`
- **Bug:** Toggling the panel closed and reopening (Ctrl+H → Esc → Ctrl+H) shows the stale last result set, still carrying frozen query/options. `handleReplaceOne` then operates against potentially outdated match offsets.
- **Fix:** Reset `results`, `resultsQuery`, `resultsOptions` in `closePanel`.
- **Confidence:** Medium-High (70)
- **Found by:** Concurrency & State

## Suggestions

- **L4** `tiptap-text.ts:439-482` — `globalMatchCursor` miscount is latent; correct today only via the `targetFound` guard. Add assert or simplify.
- **E2** `schemas.ts:133-139` — label that sanitizes to empty becomes NULL silently; consider 400.
- **E3** Replace-all `skipped_chapter_ids` surfaced only as a count; list chapter titles.
- **X6** `useSnapshotState.ts:147-151` refreshCount effect fires on mount, duplicating chapterId-effect fetch.
- **X12** `reloadActiveChapter` should abort `saveAbortRef` itself (callers currently do it).
- **S3** V8 regex is uninterruptible inside `exec()`; heuristic is best-effort. Consider `node-re2` or a worker with hard kill.
- **S4** Content size cap is post-pass — peak RSS during replace is unchecked; estimate upper bound before materializing.
- **S8** `sanitizeSnapshotLabel` does not strip U+200E/200F or zero-width chars.
- **S9** `listByChapter` has no `LIMIT`.
- **C2** `useSnapshotState.ts:83` defensive `typeof content === "string"` branch is dead code; remove or enforce via type.
- **C3** Restore enrichment fallback uses raw status key as label when `enrichChapterWithLabel` throws.
- **C4** Shared `SearchOptions` includes `deadline?: number` that would fail server `.strict()`; split public vs internal types.
- **C10** `truncateForLabel` + `sanitizeSnapshotLabel` duplication across shared/server.

## Plan Alignment

**Plan docs consulted:** `docs/plans/2026-04-16-snapshots-find-replace-design.md`, `...-plan.md`

- **Implemented:** All 20 plan tasks for 4b-i (snapshots) and 4b-ii (find-and-replace) have corresponding code and tests — migration 014, snapshot types/repo/service/routes, cascade purge, Ctrl+S interception, SnapshotPanel/Banner, useSnapshotState, tiptap-text walker, search service/routes, FindReplacePanel, useFindReplaceState, Ctrl+H wiring, and e2e specs.
- **Not yet implemented:** Nothing substantive missing from the plan.
- **Deviations (beyond plan, generally improvements):**
  - Route uses `:slug` not `:id` (plan said `:id`) — functionally equivalent in this slug-addressed app.
  - Extra hardening: `assertSafeRegexPattern`, `REGEX_DEADLINE_MS`, `MAX_MATCHES_PER_REQUEST`, `MAX_CHAPTER_CONTENT_BYTES`, distinct error codes, `sanitizeSnapshotLabel`, grapheme-aware truncation.
  - `createSnapshot` wraps dedup+insert in a tx; `restoreSnapshot` returns `CORRUPT_SNAPSHOT` 422; `canonicalContentHash` canonicalizes JSON rather than hashing raw bytes.
  - Velocity `recordSave` side-effects after restore/replace (not in plan).
  - `skipped_chapter_ids` returned when chapters have corrupt JSON; `scope_not_found` → 404.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment (6 parallel specialists + 1 verifier)
- **Scope:** Changed files + adjacent/caller files one level deep; search, snapshots, tiptap-text walker, editor hooks, EditorPage, API client, schemas, migration 014
- **Raw findings:** 52 (before verification)
- **Verified findings:** 12 (2 Critical, 10 Important) + 13 Suggestions
- **Filtered out:** 27 (design intent, already mitigated, or type/ergonomic nits)
- **Steering files consulted:** `CLAUDE.md`
- **Plan/design docs consulted:** `docs/plans/2026-04-16-snapshots-find-replace-design.md`, `docs/plans/2026-04-16-snapshots-find-replace-plan.md`
