# Agentic Code Review: ovid/snapshots-find-and-replace

**Date:** 2026-04-17 11:43:59
**Branch:** ovid/snapshots-find-and-replace -> main
**Commit:** 767d2a075646ea4c7c5317ebaf826b007be0f89d
**Files changed:** 65 | **Lines changed:** +9586 / -103
**Diff size category:** Large

## Executive Summary

Snapshots and find-and-replace are broadly well-implemented with extensive tests, but the review surfaced three critical data-integrity or availability issues (ReDoS via user regex, dedup hashing on non-canonical JSON, silent catches hiding corrupt-snapshot errors) and a cluster of important concurrency bugs where `flushSave()` is not paired with `cancelPendingSaves()` — letting a late auto-save retry silently clobber a just-completed replace or restore. Most other findings are type/constant duplication across shared and server packages that risks contract drift.

## Critical Issues

### [C1] ReDoS in user-controlled regex
- **File:** `packages/server/src/search/search.service.ts:14-19, 64-70`; `packages/shared/src/tiptap-text.ts:82-87`
- **Bug:** `new RegExp(query)` runs user input with V8's backtracking engine against every leaf block of every chapter, inside a write transaction. Patterns like `(a+)+b` hang the event loop and hold the SQLite write lock.
- **Impact:** Any long-running regex freezes the server and blocks auto-saves across the app.
- **Suggested fix:** Cap query length more aggressively, reject catastrophic shapes, run regex in a worker_thread with a hard timeout, or use `node-re2` for a linear-time engine. Also cap total match count per request.
- **Confidence:** High
- **Found by:** Security, Error Handling

### [C2] Snapshot dedup hashes non-canonical JSON
- **File:** `packages/server/src/snapshots/snapshots.service.ts:22-23`; `packages/server/src/snapshots/snapshots.repository.ts:38-44`
- **Bug:** Dedup compares SHA-256 of the raw stored JSON string against the chapter's current raw string. TipTap round-trips and replace paths re-serialize content (e.g., `JSON.stringify(newDoc)` after `replaceInDoc`), so byte-for-byte equality is not preserved across semantically identical documents.
- **Impact:** Duplicate-protection silently fails → user accumulates identical manual snapshots; future-facing fragility if any path reorders JSON keys or whitespace.
- **Suggested fix:** Hash a canonical representation — e.g., walk the doc with stable key ordering, or hash `countWords + normalizedText`. Alternatively, compare on parsed structural equality.
- **Confidence:** High
- **Found by:** Error Handling

### [C3] Restore errors silently swallowed in client
- **File:** `packages/client/src/hooks/useSnapshotState.ts:72-74, 95, 98-100, 112`
- **Bug:** `restoreSnapshot`, `viewSnapshot`, and `refreshCount` use bare `catch {}`. The server's 422 `CORRUPT_SNAPSHOT` response is lost; the UI only surfaces a generic "restore failed" string.
- **Impact:** A user hitting a corrupt snapshot sees no specific guidance and cannot distinguish a network blip from a permanent corruption.
- **Suggested fix:** Propagate `ApiRequestError` to the caller and branch on `status === 422` / error code in `EditorPage.tsx` to display the server's human message.
- **Confidence:** High
- **Found by:** Error Handling

## Important Issues

### [I1] Replace, restore, and create-snapshot don't cancel in-flight save retries
- **File:** `packages/client/src/pages/EditorPage.tsx:186-211` (`executeReplace`), `:153-176` (`handleRestoreSnapshot`), `:752` (manual snapshot `onBeforeCreate`)
- **Bug:** All three paths `await editorRef.current?.flushSave()` but don't call `cancelPendingSaves()`. The `onView` path (`:748-749`) correctly pairs them. A save queued before the operation and still in exponential-backoff retry can fire after the server-side replace/restore and overwrite content.
- **Impact:** Data loss: replace-all or restore silently clobbered by a stale retry, with no recovery.
- **Suggested fix:** After each `flushSave()` call, also call `cancelPendingSaves()` before dispatching the server call.
- **Confidence:** High
- **Found by:** Concurrency, Logic

### [I2] `handleReplaceOne` uses live state, not the query that produced `match_index`
- **File:** `packages/client/src/pages/EditorPage.tsx:256-291`; `packages/client/src/hooks/useFindReplaceState.ts:69-96`
- **Bug:** `match_index` values on displayed results refer to a prior search (300ms debounce). `handleReplaceOne` reads the current `findReplace.query/replacement/options` and sends them with the stale `match_index` — the server replaces at the wrong location.
- **Impact:** Wrong text replaced during rapid edits; the design's "Match no longer found" fallback never fires.
- **Suggested fix:** Freeze `{query, replacement, options}` into each result row at render-time, or re-verify against the current search before replace. Also show the `matchNotFound` string when `replaced_count === 0`.
- **Confidence:** High
- **Found by:** Logic, Error Handling, Concurrency

### [I3] Whole-word `\b` is ASCII-only; regex missing `u` flag
- **File:** `packages/shared/src/tiptap-text.ts:82-87`
- **Bug:** `buildRegex` uses `"gi"`/`"g"` without `u`. `\b` only breaks on ASCII word chars, so CJK and accented-Latin "whole word" searches never match intended words; astral-plane chars misbehave; `\p{…}` is unavailable.
- **Impact:** Whole-word and regex search silently wrong for anyone writing non-English fiction — and CLAUDE.md explicitly calls out CJK/Unicode correctness as a constraint.
- **Suggested fix:** Add `u` flag. For whole-word, use a Unicode boundary shim like `(?<!\p{L}\p{M}*)…(?!\p{L}\p{M}*)`.
- **Confidence:** High
- **Found by:** Error Handling

### [I4] `snapshots.service.createSnapshot` uses raw chapter lookup while list uses filtered
- **File:** `packages/server/src/snapshots/snapshots.service.ts:16, 44`
- **Bug:** `createSnapshot` calls `findChapterByIdRaw` (ignores `deleted_at`); `listSnapshots` uses `findChapterById` (filters). A soft-deleted chapter can have a snapshot created that no subsequent list call exposes.
- **Impact:** Inconsistent policy; write/read contracts for snapshots diverge by chapter state.
- **Suggested fix:** Pick one — most likely filter `deleted_at IS NULL` in all snapshot ops, matching `listSnapshots`.
- **Confidence:** Medium
- **Found by:** Contract & Integration

### [I5] "Duplicate snapshot" returns HTTP 200 with `{message}`; success returns 201 with row
- **File:** `packages/server/src/snapshots/snapshots.routes.ts:48-52`
- **Bug:** Response shape and status differ by outcome, with no discriminator in the body. Typed client expecting `SnapshotRow` will read undefined fields on a duplicate.
- **Impact:** Client can't reliably act on the duplicate case; bugs surface silently.
- **Suggested fix:** Always return 201 with `{duplicate: boolean, snapshot: SnapshotRow}`, or have the client branch on status explicitly.
- **Confidence:** High
- **Found by:** Error Handling

### [I6] Corrupt-JSON chapters silently skipped during project-wide replace
- **File:** `packages/server/src/search/search.service.ts:33-37, 103-107`
- **Bug:** `JSON.parse` failure inside the replace loop is swallowed with `continue`. The response's `replaced_count`/`affected_chapter_ids` doesn't flag skipped chapters.
- **Impact:** Writer thinks replace covered the entire project; a corrupt chapter retains the original term with no signal.
- **Suggested fix:** Include `skipped_chapter_ids` in the response and surface in the UI; log a server-side warning.
- **Confidence:** High
- **Found by:** Error Handling

### [I7] `applyImageRefDiff` passes un-coalesced `chapter.content` — `snapshots.service.ts:109`
- **File:** `packages/server/src/snapshots/snapshots.service.ts:109`
- **Bug:** Line 82 defines `currentContent = chapter.content ?? '{"type":"doc","content":[]}'` and uses it for the pre-restore auto-snapshot. But line 109 passes the un-coalesced `chapter.content` (which can be NULL for never-saved chapters) to `applyImageRefDiff`.
- **Impact:** Image refcounts can be skewed on restore when the target chapter was never saved.
- **Suggested fix:** Pass `currentContent` on line 109 to match the auto-snapshot.
- **Confidence:** Medium
- **Found by:** Concurrency

### [I8] Snapshot count stale across chapter switches
- **File:** `packages/client/src/hooks/useSnapshotState.ts:35-51, 83-103, 105-113`
- **Bug:** (a) The load effect does not reset `snapshotCount` to 0 before fetching; the badge shows the previous chapter's count during the gap. (b) The post-restore `listSnapshots` call and `refreshCount` are not cancellation-guarded, so a fast chapter switch can be clobbered by a late response.
- **Suggested fix:** Reset to 0 inside the effect; guard post-restore/refresh with a `chapterSeq` ref mirroring `searchSeqRef`.
- **Confidence:** Medium
- **Found by:** Logic, Concurrency

### [I9] `useFindReplaceState` empty-query clear races in-flight search
- **File:** `packages/client/src/hooks/useFindReplaceState.ts:71-75`
- **Bug:** Early-return on empty query clears state without bumping `searchSeqRef`. An in-flight response from the previous non-empty query passes the seq check on fulfillment and resurrects stale results.
- **Suggested fix:** Increment `searchSeqRef.current` in the empty-query branch and set `loading = false`.
- **Confidence:** Medium
- **Found by:** Error Handling

### [I10] Enter-to-replace bypasses the `hasReplacement` guard
- **File:** `packages/client/src/components/FindReplacePanel.tsx:156-161` vs the footer button
- **Bug:** Footer button disables when `replacement.length === 0`, but the Enter key handler in the replace input fires `onReplaceAllInManuscript` whenever `total_count > 0`. An accidental Enter with an empty replacement deletes every match.
- **Suggested fix:** Add `&& replacement.length > 0` to the keydown guard.
- **Confidence:** High
- **Found by:** Logic, Concurrency

### [I11] Unbounded match count / regex cost per request
- **File:** `packages/server/src/search/search.routes.ts:26-31`; `tiptap-text.ts`
- **Bug:** No cap on number of matches returned or replaced. Patterns like `.*` on a large manuscript produce enormous arrays inside an `IMMEDIATE` transaction with per-chapter snapshots.
- **Suggested fix:** Cap per-request match count (e.g., 10,000) and return a 400 when exceeded.
- **Confidence:** Medium
- **Found by:** Error Handling, Security

### [I12] Snapshot/chapter label truncation slices UTF-16 code units
- **File:** `packages/server/src/search/search.service.ts:121-123`
- **Bug:** `search.slice(0, 30)` / `replace.slice(0, 30)` can split surrogate pairs, producing malformed labels for emoji or non-BMP chars. Control chars from the search text are copied through verbatim.
- **Suggested fix:** Truncate by grapheme via `Intl.Segmenter` and strip/escape control chars before storing.
- **Confidence:** Medium
- **Found by:** Logic, Error Handling

### [I13] Duplicate `SnapshotRow` / `SnapshotListItem` / `SearchResult` types across shared and server
- **File:** `packages/shared/src/types.ts:76-93, 109-116` vs `packages/server/src/snapshots/snapshots.types.ts:1-18` and `packages/server/src/search/search.types.ts:3-10`
- **Bug:** Same types declared in two places. Any field change in one location silently breaks the wire contract.
- **Suggested fix:** Server types should re-export from `@smudge/shared`; keep server-only types (`CreateSnapshotData`) local.
- **Confidence:** High
- **Found by:** Contract & Integration

### [I14] Zero-length regex match may split a surrogate pair
- **File:** `packages/shared/src/tiptap-text.ts:168-177, 216-219`
- **Bug:** After a zero-width match, `re.lastIndex++` steps by one UTF-16 code unit; inside an astral-plane character this produces corrupt downstream matches. Compounded by I3 (missing `u` flag).
- **Suggested fix:** Step by `flat.codePointAt(lastIndex) > 0xffff ? 2 : 1` (or use `u` flag).
- **Confidence:** Medium
- **Found by:** Error Handling

### [I15] `ReplaceSchema.scope` has a silent default of `{type: "project"}`
- **File:** `packages/server/src/search/search.routes.ts:42-43`
- **Bug:** Missing `scope` becomes a project-wide replace. A client bug that drops the scope field destructively affects the whole project with no error.
- **Suggested fix:** Make `scope` required.
- **Confidence:** Medium
- **Found by:** Contract & Integration

## Suggestions

- **[S1]** `CONTEXT_RADIUS = 40` duplicated in `FindReplacePanel.tsx:29` and `tiptap-text.ts:90` — export from shared.
- **[S2]** Search options `{case_sensitive, whole_word, regex}` shape duplicated across routes, service, api client, hook, panel — import `SearchOptions` from shared.
- **[S3]** `ReplaceSchema` lives inline in routes; move to `packages/shared/src/schemas.ts` alongside `CreateSnapshotSchema`.
- **[S4]** Three TipTapNode walkers (`tiptap-text.ts`, `wordcount.ts`, `images.references.ts`) — consolidate into one shared walker utility.
- **[S5]** `replaceInDoc` rebuilds regex per match on a sliced substring (`tiptap-text.ts:238-241`) — fragile for future regex features; compute replacements once on `flat`.
- **[S6]** `useProjectEditor` returns `cancelPendingSaves` / `getActiveChapter` as inline arrows (`:402-404`) — wrap in `useCallback`.
- **[S7]** `snapshots.repository.insert()` returns caller-supplied data without DB round-trip — will silently miss DB defaults in future.
- **[S8]** `restoreSnapshot` stores raw `snapshot.content` but recomputes word_count from `JSON.parse(...)` — minor asymmetry.
- **[S9]** `FindReplacePanel.highlightMatch` silently returns un-highlighted on offset mismatch — add dev-mode warn.
- **[S10]** No cap on per-chapter snapshot count; a long find-and-replace session can balloon `chapter_snapshots`.
- **[S11]** `applyImageRefDiff` scans the stringified content with a regex; replace text containing `/api/images/<uuid>` substrings can skew refcounts. Walk the parsed doc instead.
- **[S12]** `collectLeafBlocks` uses unbounded recursion — convert to an iterative walk to be stack-safe on pathological JSON.
- **[S13]** `createSnapshot` trusts `chapter.content` without parse-check; restore path validates. Symmetrize.
- **[S14]** `match_index` out-of-range silently returns `replaced_count = 0`; surface the "match not found" string in the UI.

## Plan Alignment

**Plan docs consulted:**
- `docs/plans/2026-04-16-snapshots-find-replace-design.md`
- `docs/plans/2026-04-16-snapshots-find-replace-plan.md`

**Implemented:** Snapshots migration/types/schemas, repository, service (with dedup guard, restore auto-snapshot, image-ref diff, word-count recalc), routes, SnapshotPanel/Banner, `useSnapshotState`, keyboard shortcuts (Ctrl+S intercept, Ctrl+H), toolbar entries, snapshots & find-replace e2e suites. Find-and-replace shared text walker, search service (scoped project/chapter), replace service with auto-snapshots, routes, `useFindReplaceState`, `FindReplacePanel`.

**Not yet implemented:** Task 20 (final coverage + cleanup pass) not yet visible in the diff.

**Deviations (neutral — documented intent):**
- Replace-one uses a server-side `match_index` parameter instead of the plan's "client locates match in TipTap and replaces there" approach. Intentional per the recent commit series; it fixes the prior review's single-match bug at the cost of I2 above.
- Chapter→snapshot cascade implemented via `ON DELETE CASCADE` in migration 014 rather than an explicit `store.deleteSnapshotsByChapter` call in purge. Reasonable simplification; requires `PRAGMA foreign_keys = ON` in all runtime/test contexts (worth verifying).

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** Full branch diff (65 files, ~10.5k lines) plus current-state reads of priority files (tiptap-text, search/snapshots server modules, chapters.service, useFindReplaceState, useSnapshotState, EditorPage, FindReplacePanel, SnapshotPanel/Banner, api client, shared types/schemas, migration 014)
- **Raw findings:** 49
- **Verified findings:** 32 (3 Critical, 15 Important, 14 Suggestion — after merging overlaps)
- **Filtered out:** 3 rejected (L6 restoreSnapshot-outside-tx; R3 dedup TOCTOU; R4 replace-read-outside-IMMEDIATE) plus overlapping duplicates merged
- **Steering files consulted:** `CLAUDE.md`
- **Plan/design docs consulted:** `docs/plans/2026-04-16-snapshots-find-replace-design.md`, `docs/plans/2026-04-16-snapshots-find-replace-plan.md`
