---
name: Agentic code review — ovid/snapshots-find-and-replace (2026-04-18 21:55)
description: Multi-agent bug-hunt review of the snapshots + find-and-replace branch at HEAD 41b1ea3. Found 1 Critical (cross-chapter clobber via Editor unmount), 8 Important (UX/error-path gaps, walker depth cap, replacement amplification), 5 Suggestions. Deferred items I3/S3/S6/S9/S10/S11 remain tracked in notes/TODO.md.
type: reference
---

# Agentic Code Review: ovid/snapshots-find-and-replace

**Date:** 2026-04-18 21:55:00
**Branch:** ovid/snapshots-find-and-replace -> main
**Commit:** 41b1ea3af34b79a6c6f12311a8c18cb8ff9d4ff4
**Files changed:** 95 | **Lines changed:** +15,151 / -153
**Diff size category:** Large

## Executive Summary

Full-branch review at HEAD after ~10 prior review/fix cycles. Most historical issues are resolved and the save/replace/snapshot-restore paths are rigorously seq-guarded. **One Critical finding remains:** the Editor's unmount-cleanup fire-and-forget save (`Editor.tsx:159-165`) reads `activeChapterRef.current` inside `handleSave` (`useProjectEditor.ts:68-75`), so a chapter-switch-after-failed-flush writes the old chapter's JSON to the new chapter's row — silent cross-chapter data loss. Seven Important findings cover error-path polish (stale result state on 404, missing action-info reset, missing setEditable guard on snapshot view), contract drift (`extractImageIds` has no depth cap; shared `ReplaceResult` type missing), and a memory-amplification angle in regex replacement via `$'` / `` $` ``. Five low-severity Suggestions round out the report.

## Critical Issues

### [C1] Cross-chapter content clobber via Editor unmount cleanup
- **File:** `packages/client/src/components/Editor.tsx:159-165` + `packages/client/src/hooks/useProjectEditor.ts:68-75`
- **Bug:** On chapter switch after a failed `flushSave`, the old Editor unmounts with `dirtyRef.current === true`. The cleanup fires `onSaveRef.current(editorInstanceRef.current.getJSON())` with chapter A's JSON. Inside `handleSave`, the target id is resolved via `const current = activeChapterRef.current; const savingChapterId = current.id;` — at this point the ref already points at chapter B. Result: PATCH `/api/chapters/B` carrying A's content.
- **Impact:** Silent cross-chapter data loss. Reachable whenever `flushSave` returns `false` (4xx, offline, retries exhausted) and the user switches chapters within the retry window (up to ~14 s). `switchToView`/`handleSelectChapterWithFlush` ignore the `flushSave` return value, so nothing gates the switch.
- **Suggested fix:** Pass the chapter id explicitly through the save path rather than resolving it from a ref at fire-time. Either (a) plumb `chapterId` as an Editor prop and capture it in the unmount closure, passing it through `onSave(content, chapterId)`; or (b) have `handleSelectChapterWithFlush` surface the `flushSave` failure (persistent banner) and refuse the switch until the save retries or the user discards.
- **Confidence:** High (75)
- **Found by:** Concurrency & State

## Important Issues

### [I1] `extractImageIds` walker has no depth cap
- **File:** `packages/server/src/images/images.references.ts:17-40`
- **Bug:** Recursive `walk()` over TipTap content has no depth parameter. The parallel walkers `collectLeafBlocks` and `extractText` both cap at `MAX_WALK_DEPTH = 64`; the canonicalize walker uses `MAX_TIPTAP_DEPTH`. This one is the only remaining unguarded walker and it runs on both **old** (pre-update, read from DB) and new content inside `applyImageRefDiff`.
- **Impact:** A row that predates the schema cap, or one written when the cap was looser, can stack-overflow inside replace-all, chapter PATCH, or snapshot restore — aborting the whole transaction.
- **Suggested fix:** Add the same depth parameter + cap as `collectLeafBlocks`; on overflow, treat as "corrupt content — skip refcount diff" (mirrors the existing corrupt-JSON fallback).
- **Confidence:** Medium (70)
- **Found by:** Contract & Integration

### [I2] `$'` / `` $` `` replacement amplification bypasses size cap
- **File:** `packages/shared/src/tiptap-text.ts:149-174` (expandReplacement) + `packages/server/src/search/search.service.ts:268-311` (replaceInProject)
- **Bug:** `expandReplacement` honors `$'` (right context) and `` $` `` (left context), each of which can splice in up to `match.input.length` characters per match. Replace-all allows up to `MAX_MATCHES_PER_REQUEST = 10 000` matches per chapter with `MAX_REPLACE_LENGTH = 10 000` template. The post-hoc `MAX_CHAPTER_CONTENT_BYTES` guard runs only after `JSON.stringify(newDoc)` — by which point the multi-GB string is already allocated. Node OOMs before the 400 fires.
- **Impact:** Single-user local, so no remote DoS, but a regex replace wedges / crashes the user's own process, rolls back the transaction, and risks data loss in the queued save pipeline.
- **Suggested fix:** Either (a) reject replacement templates containing `$'` or `` $` `` (document the restriction), or (b) compute a conservative per-match expansion budget up front (`template.length × match.input.length` bounds the worst case) and short-circuit to a dedicated error if the expected total exceeds the content cap.
- **Confidence:** High (75)
- **Found by:** Security

### [I3] `handleReplaceOne` leaves stale success banner on error
- **File:** `packages/client/src/pages/EditorPage.tsx` `handleReplaceOne` (try block, after `markClean()`)
- **Bug:** `executeReplace` calls `setActionInfo(null)` before issuing the request; `handleReplaceOne` does not. If the prior replace showed "Replaced N occurrences" and the per-match Replace then fails (network, 404, 0-replaced), the stale success banner continues to render alongside the new error.
- **Impact:** UX confusion — contradictory banners. No data corruption.
- **Suggested fix:** Add `setActionInfo(null);` at the top of the try block in `handleReplaceOne`, mirroring `executeReplace`.
- **Confidence:** High (70)
- **Found by:** Logic & Correctness

### [I4] `handleReplaceOne` 404 branch doesn't refresh find panel
- **File:** `packages/client/src/pages/EditorPage.tsx:~451-454` (catch branch)
- **Bug:** When `replaced_count === 0` (success path), the code calls `findReplace.search(slug)` to prune the stale match. When the server returns 404 `SCOPE_NOT_FOUND` (chapter soft-deleted since the last search), the catch branch only sets `actionError`. The stale match remains in the panel; clicking it again produces the same 404.
- **Impact:** UX — user can loop-click a stale match and see the same error repeatedly.
- **Suggested fix:** In the catch, when the error is `ApiRequestError` with `status === 404`, call `await findReplace.search(slug)` after setting the error message.
- **Confidence:** Medium (65)
- **Found by:** Error Handling

### [I5] `useFindReplaceState` preserves results on 404 NOT_FOUND
- **File:** `packages/client/src/hooks/useFindReplaceState.ts:170-184`
- **Bug:** Result-clearing only fires on `err.status === 400`. A 404 (project purged or renamed to a different slug mid-session) falls through to the "preserve results" branch. The panel continues to display matches pinned to a slug that no longer resolves.
- **Impact:** User sees a result list they cannot act on. Coupled with I4, clicks produce repeat errors.
- **Suggested fix:** Treat `err.status === 404` the same as 400 — clear `results`, `resultsQuery`, `resultsOptions`.
- **Confidence:** Medium (65)
- **Found by:** Error Handling

### [I6] SnapshotPanel `onView` doesn't disable editor before flushSave
- **File:** `packages/client/src/pages/EditorPage.tsx:~940-953`
- **Bug:** The replace paths (`executeReplace` ~L246, `handleReplaceOne` ~L400) both call `editorRef.current?.setEditable(false)` before awaiting `flushSave` to block keystrokes during the flush window. Snapshot-view entry does not. Between click and commit of `setViewingSnapshot(...)`, user keystrokes set `dirtyRef=true`; the subsequent Editor unmount fires a fire-and-forget save of typed-during-flush content (Editor.tsx:159-165).
- **Impact:** Narrow race, but the window widens to seconds if `flushSave` is in the retry backoff. User keystrokes can land transiently and then be wiped by the restore, never appearing in any auto-snapshot.
- **Suggested fix:** Mirror the `executeReplace` discipline: set editable false before awaiting flushSave, re-enable on any early-return/error path.
- **Confidence:** Medium (65)
- **Found by:** Concurrency & State

### [I7] `ReplaceResult` shape inlined on both sides of the API boundary
- **File:** `packages/client/src/api/client.ts:318-322` + `packages/server/src/search/search.service.ts:192-197, 210-214`
- **Bug:** The response shape `{ replaced_count, affected_chapter_ids, skipped_chapter_ids? }` is declared three times: client inline generic, server return type, server internal alias. No shared type.
- **Impact:** Contract drift — a future field added server-side (e.g. `created_snapshot_ids`) silently skews the client. The pattern is already inconsistent with `SearchResult`, which lives in `@smudge/shared/types.ts`.
- **Suggested fix:** Export `ReplaceResult` from `@smudge/shared/types.ts`, re-export via `@smudge/shared/index.ts`, consume on both sides.
- **Confidence:** High (72)
- **Found by:** Contract & Integration

### [I8] Enrichment fallback duplicates `stripCorruptFlag` logic
- **File:** `packages/server/src/snapshots/snapshots.service.ts:241-248`
- **Bug:** The post-commit enrichment-failure fallback inlines `const { content_corrupt: _c, ...clean } = chapterRow;`. A `stripCorruptFlag` helper (`chapters/chapters.types.ts:72`) already exists and is used on the success path.
- **Impact:** Future changes to the corrupt-flag surface (e.g. adding `content_corrupt_reason`) must be mirrored in both places or they drift.
- **Suggested fix:** Import `stripCorruptFlag` and call it; preserve the `status_label` fallback override.
- **Confidence:** Medium (68)
- **Found by:** Contract & Integration

## Suggestions

- **[S1]** `packages/shared/src/tiptap-text.ts:511, 523, 530` — `globalMatchCursor` under-counts in `replaceInDoc` match_index mode. When `allMatches.length > localTarget` triggers the early break, only `localTarget + 1` matches are enumerated; the cursor advance at 523/530 therefore lies about "total matches seen." Today `targetFound` short-circuits every subsequent run/block, so the lie is never read — but the invariant is broken, making any future code that reads the cursor after a found target silently wrong. Fix: either rename to document the "last enumerated index" semantics, or fully enumerate matches in match_index mode so the counter stays accurate. Confidence 65. Found by Logic & Correctness.
- **[S2]** `packages/server/src/snapshots/snapshots.repository.ts:44-48` — `getLatestContentHash` uses `.orderBy("created_at", "desc").first()` with no tiebreaker. Two manual snapshots created in the same millisecond (test harness, scripted clicks) return a nondeterministic row, making dedup flaky. Fix: add a secondary order by `id DESC`. Confidence 60. Found by Logic & Correctness.
- **[S3]** `packages/client/src/hooks/useProjectEditor.ts:147-149` — `cancelPendingSaves` aborts the controller and bumps seq, but the `setTimeout(r, BACKOFF_MS[attempt])` sleep keeps running. The seq check on wake-up handles correctness; the timer is just dangling reference. Fix: store the timer id and `clearTimeout` in `cancelPendingSaves`, or race the sleep against an abort promise. Confidence 70. Found by Error Handling.
- **[S4]** `packages/server/src/snapshots/content-hash.ts:47-65` — `canonicalContentHash` falls back to raw-bytes hashing on JSON parse error / depth error and logs at `logger.debug`. Production levels rarely include debug; operators have zero visibility into a chapter producing dedup hashes against raw bytes. Fix: emit at `warn` on first occurrence per chapter id (dedupe via cache), or surface a counter/metric. Confidence 60. Found by Error Handling.
- **[S5]** `packages/shared/src/schemas.ts:155-186` — `sanitizeSnapshotLabel` strips C0/C1, bidi overrides, zero-width, unpaired surrogates. It does NOT strip Unicode non-characters (U+FFFE, U+FFFF, the block U+FDD0..U+FDEF, and the plane-terminal non-characters). Minor list-display spoof. Fix: extend the zero-width replace regex with `\uFDD0-\uFDEF\uFFFE\uFFFF` and walk by code point for the supplementary-plane non-characters. Confidence 60. Found by Security.

## Plan Alignment

All 20 tasks in `docs/plans/2026-04-16-snapshots-find-replace-plan.md` remain implemented at HEAD. One meaningful design/plan reconciliation: replace-one is routed through the server via `match_index` (as the design specified) rather than applied client-side via TipTap (as the plan's Task 18 Step 3 suggested). The design won; the client calls `api.search.replace` with `match_index`. Unplanned but legitimate extracted helpers: `snapshots/content-hash.ts`, `snapshots/labels.ts`, `utils/grapheme.ts`, `shared/src/constants.ts` (housing `MAX_TIPTAP_DEPTH`), and client `utils/findReplaceErrors.ts`. Recent commits (`41b1ea3`, `b9ceae6`, `574a349`) extend Task 20 cleanup rather than adding new scope.

## Deferred Items (tracked in `notes/TODO.md`)

The following were identified in prior review cycles and deliberately excluded from this pass:

- **I3:** Catastrophic `regex.exec()` can exceed wall-clock deadline.
- **S3:** `extractContext` splits surrogate pairs in find-panel preview.
- **S6:** `canonicalize` / `canonicalJSON` are near-duplicate walkers.
- **S9:** Cross-project image URL handling differs between chapter PATCH and snapshot restore.
- **S10:** Manual-snapshot dedup is application-enforced, not DB-enforced.
- **S11:** `canonicalize` depth counter isn't `content[]`-scoped.

## Rejected Candidate Findings

- **`flushSave` throws unhandled in replace paths** — both `executeReplace` and `handleReplaceOne` wrap the body in try/catch with a finally that re-enables the editor; the throw case is covered. Confidence post-verify <60.
- **Null-content substitution in snapshots.service:29** — the `chapter.content ?? JSON.stringify({type:"doc",content:[]})` substitution is intentional and consistent across hash and stored content; no bug.
- **`err instanceof DOMException` in api/client.ts** — the client runs only in the browser (Vite SPA, JSDOM in tests); Node fetch is not the runtime.
- **`handleSelectChapter` not detaching `saveAbortRef`** — `handleSave` aborts any prior controller when a new save starts (`useProjectEditor.ts:82`); the seq guard prevents A's in-flight save from affecting B's UI. The design is coherent.
- **Editor-scoped `beforeunload`** — Editor is always mounted while a chapter is active; the remount window is within the same React tick. Real risk near zero.
- **TOCTOU on `match_index`** — the server re-validates the match position inside `replaceInDoc`; a stale coordinate yields `allMatches[localTarget] === undefined` and returns 0 replaced, with `scope_not_found`/zero-match paths handled client-side. No exploit.
- **Walker duplication as a separate finding** — folded into I1 (`extractImageIds` depth cap) since the concrete bug lives there.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment.
- **Scope:** Full branch (`main...HEAD`), 95 files, with prior-review reports consulted to avoid duplicates.
- **Raw findings:** 20 (across specialists, post-60% threshold).
- **Verified findings:** 14 (1 Critical, 8 Important, 5 Suggestions).
- **Filtered out:** 7 (false positives or duplicates of tracked deferred items).
- **Steering files consulted:** `CLAUDE.md`.
- **Plan/design docs consulted:** `docs/plans/2026-04-16-snapshots-find-replace-design.md`, `docs/plans/2026-04-16-snapshots-find-replace-plan.md`.
- **Deferred-item tracker consulted:** `notes/TODO.md`.
- **Prior review consulted:** `paad/code-reviews/ovid-snapshots-find-and-replace-2026-04-18-20-28-15-9a93432.md`.
