# Agentic Code Review: ovid/snapshots-find-and-replace

**Date:** 2026-04-17 22:21:49
**Branch:** ovid/snapshots-find-and-replace -> main
**Commit:** 5aa8ca2c7b21a1ca02e8d591d6596b6805216e83
**Files changed:** 78 | **Lines changed:** +12586 / -131
**Diff size category:** Large

## Executive Summary

The Phase 4b snapshots + find/replace feature is substantively complete and has been polished through six prior PAAD review rounds earlier today — the vast majority of previously-reported Critical and Important issues (C1, C2, I1–I10) verify as fixed. This review surfaces two remaining Critical items (cross-project image ref manipulation; client-side save out-of-order race), a set of user-visible Important issues clustered around the find-replace UX (empty-replacement foot-gun, stale-match loops, keyboard-shortcut inconsistency, Escape eating results, mis-attributed error messages), and a long tail of code-quality suggestions dominated by duplication and missing AbortSignals.

## Critical Issues

### [C1] Cross-project image reference count manipulation
- **File:** `packages/server/src/images/images.repository.ts:11-14` + `packages/server/src/images/images.references.ts:86-98`
- **Bug:** `findImageById` queries by id only, with no project filter. Any chapter `content` referencing `/api/images/{uuid}` of an image owned by a different project will increment/decrement that image's `reference_count` via `applyImageRefDiff`.
- **Impact:** Cross-project state corruption — a misbehaving (or stale) client can inflate another project's image ref counts (blocking delete) or decrement them toward the `MAX(0, …)` clamp. Violates the cross-project data boundary called out in CLAUDE.md even for this single-user app.
- **Suggested fix:** Scope `findImageById` by `projectId` (derivable from the enclosing chapter/project). Reject or ignore references to out-of-project images in `applyImageRefDiff`.
- **Confidence:** High
- **Found by:** Security, Contract & Integration — server

### [C2] Concurrent saves can commit out-of-order; silent data regression
- **File:** `packages/client/src/hooks/useProjectEditor.ts:75-80`
- **Bug:** `handleSave` creates a fresh `AbortController` and writes it to `saveAbortRef.current` without aborting the previous in-flight request. The `saveSeqRef` guard prevents stale state writes client-side, but the already-sent PATCH stays in flight. Debounce + blur + retry-backoff all produce overlapping sends; whichever the server commits last wins.
- **Impact:** Persisted chapter content can regress to an older version while the UI reports "Saved." Directly undermines CLAUDE.md's auto-save trust promise.
- **Suggested fix:** Before assigning a new controller, call `saveAbortRef.current?.abort();`. The existing `ABORTED` handling in the retry loop will treat the abort as a clean cancellation.
- **Confidence:** High
- **Found by:** Concurrency — client

## Important Issues

### [I1] Per-match "Replace" button skips the empty-replacement guard
- **File:** `packages/client/src/components/FindReplacePanel.tsx:258-264`
- **Bug:** The inline per-match Replace button omits `disabled={!hasReplacement}` even though both "Replace all in chapter" and "Replace all in Manuscript" carry it. The server accepts empty replacements without validation.
- **Impact:** Clicking Replace with an empty replacement field silently deletes the matched text — no confirmation, no Replace-All dialog gate. Easy to hit while experimenting.
- **Suggested fix:** Add `disabled={!hasReplacement}` matching the other buttons (or intentionally allow empties behind an explicit "Delete matches" affordance).
- **Confidence:** High
- **Found by:** Logic & Correctness — client

### [I2] `handleReplaceOne` doesn't refresh results when server returns `replaced_count === 0`
- **File:** `packages/client/src/pages/EditorPage.tsx:354-357`
- **Bug:** Sets `matchNotFound` and returns without re-searching. The stale match remains in the panel; clicking it again produces the same error.
- **Impact:** User stuck in a loop with no visible explanation that the results list is stale.
- **Suggested fix:** Call `void findReplace.search(slug)` before returning.
- **Confidence:** Medium
- **Found by:** Logic & Correctness — client

### [I3] Ctrl+H fires inside `<input>` / `<textarea>`, unlike Ctrl+Slash
- **File:** `packages/client/src/hooks/useKeyboardShortcuts.ts:123-127` (vs `:79-85` for Ctrl+Slash)
- **Bug:** Ctrl+Slash guards against INPUT/TEXTAREA targets; Ctrl+H does not. Typing in the Find input and pressing Ctrl+H toggles the panel closed.
- **Impact:** Muscle-memory keystroke closes the very panel the user is editing; the `closePanel` then wipes `results`/`resultsQuery`/`resultsOptions`.
- **Suggested fix:** Add the same INPUT/TEXTAREA guard, or scope Ctrl+H to only OPEN while in an input, never close.
- **Confidence:** High
- **Found by:** Logic & Correctness — client

### [I4] Search `loading` sticks true after `closePanel` cancels in-flight request
- **File:** `packages/client/src/hooks/useFindReplaceState.ts:144-146`
- **Bug:** `finally` sets `loading=false` only when `seq === searchSeqRef.current`. `closePanel` bumps the seq, so the in-flight response never clears loading.
- **Impact:** Reopening the panel mid-flight shows a stuck "Searching…" banner that obscures error state and is spoken to screen readers.
- **Suggested fix:** Set `loading=false` unconditionally in the finally, or clear it in `closePanel`.
- **Confidence:** High
- **Found by:** Error Handling — client

### [I5] Escape while Replace-All confirm is open also closes the find-replace panel
- **File:** `packages/client/src/components/FindReplacePanel.tsx:86-95` + `packages/client/src/components/ConfirmDialog.tsx:31-40`
- **Bug:** Both components attach document-level `keydown` handlers for Escape with no `stopPropagation`/`stopImmediatePropagation`. A single Escape fires both: the dialog cancels AND the panel's `closePanel` clears results/query/options.
- **Impact:** Cancelling a "Replace All in Manuscript" prompt wipes the user's search context. Combined with the 300ms debounce, results blink empty on re-search.
- **Suggested fix:** Have `ConfirmDialog` call `e.stopImmediatePropagation()` when it handles Escape, or have the panel early-return when `replaceConfirmOpen` is set.
- **Confidence:** High
- **Found by:** Concurrency — client

### [I6] Snapshot restore 404 surfaces as a retryable network error
- **File:** `packages/client/src/hooks/useSnapshotState.ts:143-151`
- **Bug:** Only discriminates `status === 422 && code === "CORRUPT_SNAPSHOT"`. A 404 (snapshot deleted between listing and restore) collapses into `reason: "network"`, and EditorPage shows `restoreFailed` ("Try again") — retrying will always 404.
- **Impact:** User gets stuck retrying an unrecoverable action.
- **Suggested fix:** Add a 404 branch (`reason: "not_found"`) with its own message ("This snapshot no longer exists.").
- **Confidence:** Medium
- **Found by:** Error Handling — client

### [I7] Failed save-flush is reported as "restore failed" / "replace failed"
- **File:** `packages/client/src/pages/EditorPage.tsx:158-162, 200-203, 340-344`
- **Bug:** When `editorRef.current?.flushSave()` returns `false` the user sees `STRINGS.snapshots.restoreFailed` or `STRINGS.findReplace.replaceFailed`. The root cause was the save, which never got attempted.
- **Impact:** Misleading diagnosis; user can't tell their unsaved edits are the obstacle.
- **Suggested fix:** Add a dedicated "Unable to save pending changes — retry when connection recovers" string; use it on every `!flushed` branch.
- **Confidence:** Medium
- **Found by:** Error Handling — client

### [I8] Partially-successful replace shows only the skipped-chapters warning via error banner
- **File:** `packages/client/src/pages/EditorPage.tsx:235-239`
- **Bug:** On a successful project-scoped replace where some chapters were skipped (corrupt JSON), `setActionError(STRINGS.findReplace.skippedAfterReplace(n))` is the sole UI feedback. No "replaced N occurrences" toast for the successful portion. A fully-successful replace shows nothing at all.
- **Impact:** Users can't tell success from failure on a destructive bulk action.
- **Suggested fix:** Surface a distinct success/info status (aria-live + visible) separate from the skipped warning.
- **Confidence:** Medium
- **Found by:** Logic & Correctness — client

### [I9] `deleteSnapshot` skips parent-chapter soft-delete check; inconsistent with `getSnapshot`
- **File:** `packages/server/src/snapshots/snapshots.service.ts:69-73` (vs `:57-67`)
- **Bug:** `getSnapshot` and `listSnapshots` return null when the parent chapter has `deleted_at IS NOT NULL`. `deleteSnapshot` has no such filter — a stale client can delete snapshots belonging to a trashed chapter, even though GET would 404 for that snapshot. Also flagged as concurrency/TOCTOU: no transaction around the chapter check + delete.
- **Impact:** API inconsistency. Soft-deleted chapter's snapshot history can be silently truncated; if the chapter is restored, snapshot list will be shorter than last displayed. Violates CLAUDE.md's "all queries must filter `deleted_at IS NULL`."
- **Suggested fix:** Mirror `getSnapshot` — look up snapshot, then `findChapterByIdRaw(snap.chapter_id)`; return false on null. Wrap both reads + delete in `store.transaction`.
- **Confidence:** High
- **Found by:** Logic & Correctness — server, Concurrency — server, Security

### [I10] `listContentByProject` returns rows in unspecified order
- **File:** `packages/server/src/chapters/chapters.repository.ts:196-204`
- **Bug:** No `ORDER BY sort_order`. Both `searchProject` and `replaceInProject` iterate the returned rows.
- **Impact:** `affected_chapter_ids` order in the response is non-deterministic; if the `MAX_MATCHES_PER_REQUEST` cap trips mid-iteration, which chapters were processed depends on SQLite's rowid order. Makes behavior non-reproducible and complicates debugging.
- **Suggested fix:** Add `.orderBy("sort_order", "asc")` matching `listByProject` and `listMetadataByProject`.
- **Confidence:** High
- **Found by:** Concurrency — server

### [I11] `restoreSnapshot` has no per-chapter size cap on restored content
- **File:** `packages/server/src/snapshots/snapshots.service.ts:115-132` + `packages/server/src/search/search.service.ts:37`
- **Bug:** `replaceInProject` enforces `MAX_CHAPTER_CONTENT_BYTES` before writing. `restoreSnapshot` writes `snapshot.content` verbatim with no size check. A legacy or imported snapshot exceeding the cap can be restored into a chapter that subsequent saves (bound by the same 5MB body limit) will then reject.
- **Impact:** Chapter becomes un-savable after restore; feedback is a downstream 413 instead of a clear upstream error.
- **Suggested fix:** Add a shared `assertChapterContentWithinCap` helper and call it before `updateChapter` in the restore path; reject with a distinct error code.
- **Confidence:** Medium
- **Found by:** Contract & Integration — server

### [I12] Restore proceeds using a cancelled `viewingSnapshot` captured before the flush await
- **File:** `packages/client/src/pages/EditorPage.tsx:154-189`
- **Bug:** `handleRestoreSnapshot` awaits `flushSave()` (potentially seconds on flaky networks), then calls `restoreSnapshot(viewingSnapshot.id)` using the closure's captured value. If the user hits "Back to editing" during the await, `viewingSnapshot` is cleared in state but the pending restore still proceeds.
- **Impact:** Restore commits despite the user revoking consent; unrecoverable without another snapshot.
- **Suggested fix:** After the await, re-read `viewingSnapshotRef.current` and bail if null; or expose an explicit cancel flag.
- **Confidence:** Medium
- **Found by:** Concurrency — client

### [I13] Client error mapping in `useFindReplaceState` omits `CONTENT_TOO_LARGE`
- **File:** `packages/client/src/hooks/useFindReplaceState.ts:127-134`
- **Bug:** Branches on MATCH_CAP_EXCEEDED, REGEX_TIMEOUT, INVALID_REGEX but not CONTENT_TOO_LARGE (which `EditorPage.executeReplace` does handle). Search-side paths that could surface it fall through to the raw server message.
- **Impact:** Inconsistent localized messages depending on which entry point emitted the error.
- **Suggested fix:** Add the branch; ideally centralize with a shared `mapReplaceErrorToMessage` helper (see S1).
- **Confidence:** Medium
- **Found by:** Contract & Integration — client

### [I14] Replace auto-snapshot label bypasses the 500-char `CreateSnapshotSchema` cap
- **File:** `packages/server/src/search/search.service.ts:295`
- **Bug:** Auto-label is built as ``Before find-and-replace: '${truncateForLabel(search)}' → '${truncateForLabel(replace)}'``. `truncateForLabel` caps each component at 30 graphemes and `sanitizeSnapshotLabel` runs on insert, but the overall 500-char validator that manual labels pass through isn't applied to the auto-label path.
- **Impact:** Low-risk robustness gap today; silently breakable if `truncateForLabel` grows or the template changes.
- **Suggested fix:** Run the final label through the same `sanitizeSnapshotLabel` + 500-char clamp pipeline as manual labels.
- **Confidence:** Medium
- **Found by:** Security

## Suggestions

- **[S1]** Extract shared `mapReplaceErrorToMessage` helper — error-code→STRING mapping is duplicated verbatim in `EditorPage.tsx:240-264`, `:364-390`, and (with drift) in `useFindReplaceState.ts:127-140`.
- **[S2]** `EditorToolbar.tsx:21` — raw `"Snapshots"` literal; move to `STRINGS.snapshots.toolbarLabel(count)` per the externalization rule.
- **[S3]** `chapters.service.ts:144-160` — `deleteChapter` inlines extractImageIds + decrement loop; use `applyImageRefDiff(tx, chapter.content, null)`.
- **[S4]** Consolidate `canonicalJSON` (`tiptap-text.ts:279-285`) and `canonicalize` (`content-hash.ts:9-18`) into one shared helper.
- **[S5]** Move inline `ReplaceResult` shape (`client.ts:316-320`, `search.service.ts:205-210`) to `@smudge/shared/types.ts`.
- **[S6]** Move `CreateSnapshotResponse` discriminated union (`client.ts:281-286`) to `@smudge/shared`.
- **[S7]** `useSnapshotState.ts:60-78` + `:168-172` — double `list` fetch on chapterId change. Remove `refreshCount` from the effect deps or rewire to depend on a close signal.
- **[S8]** `content-hash.ts:31-36` — demote corrupt-JSON log from `warn` to `debug`, or emit once per chapter_id. Currently a single corrupt chapter logs twice per manual snapshot attempt; violates zero-warnings policy.
- **[S9]** `db/connection.ts:27, 37` — move `PRAGMA foreign_keys = ON` into a pool `afterCreate` hook so a recycled connection can't silently drop FK enforcement (would break snapshot cascade).
- **[S10]** Recursive walkers in `content-hash.ts::canonicalize`, `wordcount.ts::extractText`, `tiptap-text.ts:54-62` have no depth cap. TipTap POSTs are capped at depth 64 but stored/imported content bypasses this. Consider iterative walkers or a shared depth guard.
- **[S11]** `search.service.ts:152-155` — set `REGEX_DEADLINE_MS` deadline BEFORE `listChapterContentByProject`; add deadline checks between per-chapter snapshot/update/imageDiff operations inside replace.
- **[S12]** `tiptap-text.ts:368-376, 456-466` — deadline is checked only between matches, not during a single `exec()` call. V8 regex execution is non-preemptible. Consider `node-re2` for user-supplied patterns or run in a killable worker.
- **[S13]** `tiptap-text.ts:128-145` — `$'` / `` $` `` expansion is O(N·L); 10000 matches × 100KB run = ~1GB peak heap before the post-pass size cap catches it. Bound per-replacement output length during expansion.
- **[S14]** `search.service.ts:152, 254` — `listChapterContentByProject` loads every chapter's full JSON in memory. Stream via Knex `.stream()` to cap RSS.
- **[S15]** `snapshots.service.ts:88-102` (validation) vs `:104-146` (tx) — snapshot JSON validation runs outside the transaction; move it inside or re-validate on re-read.
- **[S16]** `snapshots.service.ts:89-102` — restore validation only checks `type === "doc"` and `Array.isArray(content)`. Feed snapshot content through the same Zod `TipTapDocSchema` as chapter updates (and/or a recursive object-shape check for nested `content[]` entries).
- **[S17]** `images/images.references.ts:19` — hoist the image-src regex to module scope (it's stateless without `g`).
- **[S18]** `types.ts:76-84` + `snapshots.routes.ts:102` — `SnapshotRow.content` returned as a stringified JSON is inconsistent with every other content-bearing endpoint. Parse server-side before returning, or narrow the shared type to a parsed form for the GET response (and wrap the client `JSON.parse` in try/catch; dead `typeof === "string"` fallback at `useSnapshotState.ts:98`).
- **[S19]** `client.ts:289, 295` — `api.snapshots.delete` typed `<undefined>` while other DELETEs use `{message}`; `api.snapshots.restore` typed `<Chapter>` while server returns `Record<string, unknown>`. Pick shared typed envelopes.
- **[S20]** Plumb AbortSignal through `api.snapshots.*` and abort on chapterId change/unmount; the hook can't cancel stale snapshot list/create/restore/delete calls.
- **[S21]** Plumb AbortSignal through `api.search.find`; closed-panel fetches still consume server work.
- **[S22]** Extract reusable `<Icon>` component — inline SVGs duplicated across `EditorToolbar.tsx:133-148, 170-184` and `EditorPage.tsx:667-681`.
- **[S23]** `search.service.ts:361-371` (also `snapshots.service.ts`) — velocity `recordSave` failure is logged but returns 200. Either retry-queue or document the eventual-consistency semantics.
- **[S24]** `tiptap-text.ts:178-229` — `assertSafeRegexPattern` heuristic misses `(a|ab)+c`, backrefs `(.*)\1`, lookaheads with quantifiers. Already acknowledged in comments; worth revisiting alongside S12.
- **[S25]** `search.service.ts:237-244` — `scope_not_found` collapses wrong-project and soft-deleted-chapter into one error code; client can't distinguish "reload needed" from routing bug.
- **[S26]** `schemas.ts:148-155` — `sanitizeSnapshotLabel` leaves TAB (U+0009) and zero-width chars (ZWJ/ZWNJ/ZWSP/BOM) intact. Allows label spoofing and column-layout disruption.
- **[S27]** `Editor.tsx:166-180` — onBlur calls `onSaveRef.current(...)` without awaiting or gating; combines with C2 to widen the concurrent-save race window.
- **[S28]** `useKeyboardShortcuts.ts:164-181` — Alt+Up/Down doesn't serialize `handleSelectChapterWithFlush` calls; rapid key repeats can queue concurrent flushes.
- **[S29]** `EditorPage.tsx:231, 362` — post-replace `findReplace.search(slug)` uses live state, not the frozen query. If the user typed during the confirm dialog, they see results for the new query.

## Plan Alignment

Plan docs consulted: `docs/plans/2026-04-16-snapshots-find-replace-design.md`, `docs/plans/2026-04-16-snapshots-find-replace-plan.md`.

**Implemented:** Migration 014 + `chapter_snapshots` cascade; snapshot service/repo/routes (`POST/GET /api/chapters/:id/snapshots`, `GET/DELETE /api/snapshots/:id`, `POST /api/snapshots/:id/restore`); manual dedup via content hash; auto-snapshot-on-restore; shared `applyImageRefDiff`; Ctrl/Cmd+S flush; shared TipTap text walker; search/replace service + routes (project + chapter + match_index scope); replace-one via server round-trip; Ctrl+H find-replace; e2e suites for both flows.

**Not yet implemented:** None material — all 20 plan tasks appear addressed.

**Deviations (all deliberate; worth reconciling with docs):**
- **D1** Search/replace endpoints use `:slug` not `:id` (`search.routes.ts:64, 109`). Matches rest of app; contradicts plan/design docs.
- **D2** `SearchMatch` shape is `{ index, context, blockIndex, offset, length }`; design doc specified `{ index, context, position: { node_path, offset } }` (`tiptap-text.ts:17-23`).
- **D3** `ReplaceSchema.scope` is required (`search.routes.ts:38-55`); plan called for optional default `{ type: "project" }`. Intentional TS typing decision (commit `c282c3e`).
- **D4** `match_index` capped at `MAX_MATCHES_PER_REQUEST - 1` (`search.routes.ts:48-52`); spec imposed no cap.
- **D5** `POST /api/chapters/:id/snapshots` returns `{ duplicate, snapshot | message }` envelope (`snapshots.routes.ts:55-62`); plan described a flat snapshot body.
- **D6** Restore can return 422 `CORRUPT_SNAPSHOT` (`snapshots.service.ts:87-102`, `snapshots.routes.ts:139-146`); plan listed only 200/404.
- **D7** Replace emits `INVALID_REGEX`, `CONTENT_TOO_LARGE`, `SCOPE_NOT_FOUND` beyond plan's `MATCH_CAP_EXCEEDED`/`REGEX_TIMEOUT` (`search.service.ts:40-45`, `search.routes.ts:150-157`).
- **D8** Snapshot count badge hidden when `null` or `0` (`EditorToolbar.tsx:21, 149`); plan/design implied always visible with live count in aria-label.
- **D9** Replace-One is server-side via `match_index` scope; plan task 18 still describes the older client-side TipTap approach (design doc updated in `d70866b`; plan doc was not).

## Review Metadata

- **Agents dispatched:** 11 — Logic & Correctness (server), Logic & Correctness (client), Error Handling (server), Error Handling (client), Contract & Integration (server), Contract & Integration (client), Concurrency (server), Concurrency (client), Security, Plan Alignment, Test Integrity
- **Scope:** server + shared + client + e2e; 78 changed files + adjacent callers one level deep. Large diff partitioned into server/shared and client partitions; specialists for each.
- **Raw findings:** 89 specialist findings + 9 plan deviations = 98
- **Verified findings (Critical + Important + Suggestion):** 2 + 14 + 29 = **45**
- **Filtered out (false positives, duplicates, below-threshold):** 53
- **Steering files consulted:** `CLAUDE.md`
- **Plan/design docs consulted:** `docs/plans/2026-04-16-snapshots-find-replace-design.md`, `docs/plans/2026-04-16-snapshots-find-replace-plan.md`
- **Prior reviews consulted (to avoid re-flagging):** 6 reports under `paad/code-reviews/` from 2026-04-17 earlier passes; all Critical and Important issues from those (C1–C2, I1–I10, Copilot CP1–CP5) verify as fixed on this commit.
