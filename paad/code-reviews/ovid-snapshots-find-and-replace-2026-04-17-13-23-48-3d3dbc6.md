# Agentic Code Review: ovid/snapshots-find-and-replace

**Date:** 2026-04-17 13:23:48
**Branch:** ovid/snapshots-find-and-replace -> main
**Commit:** 3d3dbc6155f95243bb0c0f9a1e52ddabcbf0fe2a
**Files changed:** 69 | **Lines changed:** +10,770 / -104
**Diff size category:** Large

## Executive Summary

The branch delivers essentially the full snapshots + find-and-replace plan with strong test coverage and no critical security or data-loss bugs. The most important remaining issues cluster around two themes: (1) a shared-word-count invariant violation where `countWords` and `tiptap-text` traverse TipTap JSON with different separator rules, causing client/server word-count drift after find-replace; and (2) a family of concurrency races in the restore/replace pipelines (stale-closure chapter IDs, in-flight PUTs not aborted, and per-chapter client cache overlaying a project-scope replace). Security risk is dominated by a narrow ReDoS heuristic with no wall-clock timeout on user-supplied regex — fine for a single-user app but worth hardening since the service listens on a Docker-exposed port.

## Critical Issues

None found.

## Important Issues

### [I1] `countWords` and `tiptap-text` disagree on inter-node separator — client/server word count can drift after find-replace
- **File:** `packages/shared/src/wordcount.ts:10`, `packages/shared/src/tiptap-text.ts:98`
- **Bug:** `countWords` joins sibling text nodes with `" "` while `splitBlockRuns`/`replaceInDoc` concatenate text nodes with no separator. After a replace-all that merges or splits adjacent marked text nodes, `countWords(newDoc)` can count phantom word boundaries at mark transitions (e.g. `<b>foo</b><i>bar</i>` counts as 2 words, TipTap renders "foobar").
- **Impact:** Violates CLAUDE.md's explicit invariant that client and server word counts must always agree. Amplified by [I2] — adjacent nodes that *should* have merged don't.
- **Suggested fix:** Unify the tree walker between `wordcount.ts` and `tiptap-text.ts`. Use no separator for inline (text) siblings and a newline/space between block-level siblings.
- **Confidence:** High
- **Found by:** Logic & Correctness, Contract & Integration (two independent specialists)

### [I2] `marksEqual` is key-order-sensitive (JSON.stringify) — adjacent text nodes with semantically equal marks fail to coalesce
- **File:** `packages/shared/src/tiptap-text.ts:223-228`
- **Bug:** `JSON.stringify(ma) === JSON.stringify(mb)` returns false when attrs were inserted in different orders (e.g. `{href, target}` vs `{target, href}`). TipTap/Prosemirror can emit either ordering depending on how the mark was constructed.
- **Impact:** `cleanupTextNodes` stops merging, leaving the document fragmented. Each fragment produces a phantom word boundary via [I1].
- **Suggested fix:** Canonicalize mark attrs (sorted keys) before compare; reuse the pattern in `packages/server/src/snapshots/content-hash.ts`.
- **Confidence:** Medium
- **Found by:** Logic & Correctness

### [I3] Match-cap check fires in single-match (`match_index`) replace — legitimate single replacements fail on broad patterns
- **File:** `packages/shared/src/tiptap-text.ts:367-369`
- **Bug:** The cap `totalCount + allMatches.length >= MAX_MATCHES_PER_REQUEST` applies even when `opts.match_index` is set, meaning the caller wants exactly one replacement. A broad regex like `\w` on a large chapter will hit 10,000 matches while collecting `allMatches` to resolve the local index, and throw `MatchCapExceededError` before replacing the single target.
- **Impact:** User clicks "Replace this one" and gets a 400 `MATCH_CAP_EXCEEDED` for a single replacement the UI advertised as valid.
- **Suggested fix:** Break out of the `exec` loop as soon as `globalMatchCursor + allMatches.length > opts.match_index` in match_index mode; skip the cap guard in that mode.
- **Confidence:** High
- **Found by:** Logic & Correctness, Error Handling

### [I4] `restoreSnapshot` re-reads chapter outside the transaction — concurrent autosave can silently negate a restore
- **File:** `packages/server/src/snapshots/snapshots.service.ts:146-148`
- **Bug:** After the restore transaction commits, the service re-reads the chapter with a fresh `findChapterById` and returns it. A 1.5-s-debounced autosave landing between commit and re-read causes the response to contain post-autosave content. The client `useProjectEditor.reloadActiveChapter` then shows the user's old edits, not the restored snapshot.
- **Impact:** User clicks Restore, the server's row briefly holds the snapshot, then an in-flight PUT overwrites it and the UI reflects the overwritten state. Feels like the restore silently failed.
- **Suggested fix:** Return the state assembled from known-good transaction values (parsed new content, computed word_count, `now` timestamp) instead of re-reading, or re-read inside the transaction callback before commit. See also [I7] (client-side, abort in-flight PUT).
- **Confidence:** Medium
- **Found by:** Logic & Correctness

### [I5] `useSnapshotState.restoreSnapshot` captures `seq` AFTER the await — stale-closure `chapterId`
- **File:** `packages/client/src/hooks/useSnapshotState.ts:98-108`
- **Bug:** `seq` is read from `chapterSeqRef.current` *after* `await api.snapshots.restore()` resolves. If the user switched chapters during the await, `chapterSeqRef.current` has already incremented, so the follow-up `api.snapshots.list(chapterId)` uses the closure's old `chapterId` but compares against the new seq — the list result is applied to the wrong chapter's state.
- **Impact:** Snapshot count and viewingSnapshot diverge from the visible chapter after a rapid chapter switch during restore.
- **Suggested fix:** Capture `seq = chapterSeqRef.current` *before* the restore await and bail if it changed afterward.
- **Confidence:** Medium
- **Found by:** Error Handling, Concurrency & State

### [I6] `viewSnapshot` has no chapter-switch guard during fetch — can pin a stale snapshot to the wrong chapter
- **File:** `packages/client/src/hooks/useSnapshotState.ts:73-89`
- **Bug:** `await api.snapshots.get(snapshot.id)` resolves after the user has switched chapters; `setViewingSnapshot(...)` writes unconditionally. A subsequent Restore click uses `viewingSnapshot.id`, which is a snapshot belonging to the *previous* chapter — the server restores it into that chapter, while the user sees it happen in the new chapter's context.
- **Impact:** User can silently overwrite a chapter they aren't looking at with a snapshot from another chapter.
- **Suggested fix:** Capture `seq` and `chapterId` before the fetch; after the await, bail if either changed.
- **Confidence:** Medium
- **Found by:** Concurrency & State

### [I7] `cancelPendingSaves()` bumps a seq but does not abort in-flight HTTP — stale PUT can land after a restore
- **File:** `packages/client/src/pages/EditorPage.tsx:153-173`, `packages/client/src/hooks/useProjectEditor.ts:402` (or nearby)
- **Bug:** The Restore handler flushes → `cancelPendingSaves()` → `restoreSnapshot` → `reloadActiveChapter`. `cancelPendingSaves` only increments `saveSeqRef` (stopping *future* retries); it does not cancel an already-running `api.chapters.update`. Timeline: retry PUT in-flight at t=0 → user clicks Restore at t=100ms → restore commits at t=200ms → stale PUT lands at t=500ms → reload fetches and reads stale content.
- **Impact:** Restore is silently overwritten by a pre-restore autosave retry.
- **Suggested fix:** Wire an `AbortController` through the save pipeline; `cancelPendingSaves` calls `controller.abort()`. Alternatively, await any in-flight save before calling restore.
- **Confidence:** Medium
- **Found by:** Concurrency & State

### [I8] Project-scope replace-all ignores per-chapter client-side unsaved cache — replacements can silently revert
- **File:** `packages/client/src/pages/EditorPage.tsx:184-229`, `packages/server/src/search/search.service.ts:190`
- **Bug:** `executeReplace` only flushes `editorRef.current?.flushSave()` for the currently-open chapter. `getCachedContent()` in `useProjectEditor` retains unsaved content for previously-visited chapters. When the user later navigates to such a chapter, `effectiveChapter = cached ? { ...chapter, content: cached } : chapter` re-applies the pre-replace cached content over the server's replaced content.
- **Impact:** Replace-all appears to succeed, but navigating to a chapter with cached edits silently restores the old text, replacing nothing.
- **Suggested fix:** On replace-all, iterate all cached chapter IDs and flush them before the replace, or clear the cache for any chapter with `deleted_at IS NULL` afterward and force a reload.
- **Confidence:** Medium
- **Found by:** Concurrency & State

### [I9] ReDoS heuristic covers only a narrow subset; no wall-clock timeout on regex execution
- **File:** `packages/shared/src/tiptap-text.ts:163-194` (`assertSafeRegexPattern`), `packages/server/src/search/search.service.ts:57-79`
- **Bug:** The heuristic rejects only three shapes: overlapping alternation `(x|x)+`, flat nested quantifiers `(a+)+`, and `((a+))+`. Patterns like `a+a+a+a+a+a+b`, `(?:a|ab)+c`, and `\w*\w*\w*\w*x` pass unchecked. There is no wall-clock budget around `regex.exec(run.flat)`.
- **Impact:** A single POST to `/api/projects/:slug/search` or `/replace` can pin the Node event loop indefinitely, blocking every other request on the Docker-exposed port 3456. Single-user intent doesn't preclude untrusted processes on the host or LAN.
- **Suggested fix:** Either (a) bound each request with an `AbortController` + elapsed-time check inside the run loop (~500ms budget), (b) switch to a linear-time engine such as `node-re2` for user-supplied patterns, or (c) extend the heuristic to flag adjacent greedy quantifiers at top level.
- **Confidence:** High
- **Found by:** Security

### [I10] No per-request CPU/time budget on `replaceInProject` / `searchProject`
- **File:** `packages/server/src/search/search.service.ts:143-269`
- **Bug:** Termination is guaranteed only by `MAX_MATCHES_PER_REQUEST = 10,000` and pattern-length cap. Against a 50-chapter project with sizable stored documents, benign-looking patterns still process millions of match candidates before the cap short-circuits.
- **Impact:** Amplifies [I9]: a loaded project lets a milder pattern still freeze the server for seconds-to-minutes.
- **Suggested fix:** Add `Date.now()`-based elapsed-time budget per request, checked between chapters and inside the per-run exec loop; throw and return 400 on exceed.
- **Confidence:** Medium
- **Found by:** Security

## Suggestions

- **[S1]** `packages/shared/src/tiptap-text.ts` — `^`/`$` anchors bind per hardBreak-split run, not paragraph; document or switch to block-wide semantics.
- **[S2]** `packages/shared/src/tiptap-text.ts:436-462` — replacement text inherits the mark at match start, silently dropping mixed formatting across mark boundaries; document as deliberate or choose longest-overlap mark.
- **[S3]** `packages/server/src/snapshots/snapshots.service.ts:18-41` — `createSnapshot` read-check-insert is not transactional; two concurrent POSTs can both pass the dedup check and insert duplicate manual snapshots.
- **[S4]** `packages/server/src/snapshots/snapshots.service.ts:64-149` — no optimistic-concurrency check on restore (`If-Match` / `expected_chapter_updated_at`); rapid double-click or stale-view restore silently discards interim edits.
- **[S5]** `packages/server/src/snapshots/snapshots.service.ts:94` / routes — `GET /api/snapshots/:id` succeeds for snapshots of soft-deleted chapters/projects, but restore returns a confusing 404. Either filter GET through the parent's `deleted_at` or clarify the contract. (Overlaps S11.)
- **[S6]** `packages/shared/src/tiptap-text.ts:129` — out-of-range backrefs (e.g. `$99`) expand to `""` while native `String.replace` preserves the literal.
- **[S7]** `packages/server/src/snapshots/content-hash.ts:26-37` — corrupt-content snapshot silently dedups; user sees "duplicate" with no indication the underlying content is malformed.
- **[S8]** `packages/server/src/search/search.service.ts:121-129` — per-chapter `MatchCapExceededError` throws strictly (`>=`) while the project-wide accumulator uses soft compare; a single-chapter project hitting exactly MAX matches fails.
- **[S9]** `packages/server/src/snapshots/snapshots.routes.ts:132-139` — 422 status with `CORRUPT_SNAPSHOT` code is outside CLAUDE.md's documented set (200/201/400/404/500); either update the doc or use 400.
- **[S10]** `packages/server/src/snapshots/snapshots.repository.ts:11-14` — `insert()` returns the un-coerced input cast as `SnapshotRow`; future callers passing `is_auto: 0|1` would leak through to REST.
- **[S11]** `packages/client/src/api/client.ts:277` vs `snapshots.service.ts:146-148` — `api.snapshots.restore` response type is `Chapter` but the server does not run the chapter through `enrichChapterWithLabel` (so `status_label` is absent), unlike every other chapter-returning endpoint.
- **[S12]** `packages/shared/src/tiptap-text.ts:294, 358` — `buildRegex` is re-invoked per run inside the block loop; hoist once and reset `lastIndex` per run.
- **[S13]** `packages/server/src/search/search.service.ts:228-236` and `packages/server/src/snapshots/snapshots.service.ts:104-112` — both sites call `txStore.insertSnapshot` directly, bypassing the snapshot service; extract a shared `createAutoSnapshot(txStore, chapter, label)` helper.
- **[S14]** `packages/shared/src/tiptap-text.ts:44` — `LEAF_BLOCKS = ["paragraph", "heading", "codeBlock"]` is hardcoded and will silently exclude any new leaf-block node added to the editor extensions.
- **[S15]** `packages/server/src/db/migrations/014_create_chapter_snapshots.js` / `snapshots.repository.ts` — snapshot reads don't check the parent chapter's `deleted_at`; decide the contract for soft-deleted chapters and document it.
- **[S16]** `packages/server/src/search/search.service.ts:148` vs `search.routes.ts` — internal `replaceInProject` has `scope?:` optional, Zod route schema requires it; make them consistent.
- **[S17]** `packages/shared/src/schemas.ts:113-115` `CreateSnapshotSchema.label` — only `.trim()` applied; does not strip bidi overrides (U+202A-U+202E, U+2066-U+2069) or line separators (U+2028/U+2029), enabling Trojan-Source-style label spoofing.

## Plan Alignment

Plan docs: `docs/plans/2026-04-16-snapshots-find-replace-design.md`, `docs/plans/2026-04-16-snapshots-find-replace-plan.md`.

**Implemented:**
- Migration `014_create_chapter_snapshots` with `(chapter_id, created_at)` index
- Snapshot types, `CreateSnapshotSchema`, ProjectStore extensions, `snapshots.repository.ts`
- `snapshots.service.ts` (create/list/get/delete/restore) with pre-restore auto-snapshot and image-ref diff
- All snapshot routes + cascade delete on chapter purge (`db/purge.ts`)
- Ctrl/Cmd+S (flush save) and Ctrl/Cmd+H (find/replace) shortcuts
- SnapshotPanel, SnapshotBanner, `useSnapshotState`, toolbar clock icon + badge
- Shared `tiptap-text.ts` (extract/search/replace) with tests including cross-mark cases
- Server `search/search.service.ts` with regex validation, auto-snapshots, image-ref adjustment
- Search/replace routes with Zod validation; FindReplacePanel, `useFindReplaceState`
- EditorPage integration including force-save-before-replace and reload-on-affected
- E2e specs `e2e/snapshots.spec.ts` and `e2e/find-replace.spec.ts` (incl. aXe, regex, case, whole-word)
- Strings namespaces for snapshots + findReplace
- Content-hash dedup guard for manual snapshots (`snapshots/content-hash.ts`)

**Not yet implemented:**
- Plan's optional refactor to share tree-walking between `extractImageIds`, `countWords`, and `tiptap-text` (would also fix [I1]/[I2])
- No explicit dedicated coverage pass for Task 20, though thresholds remain enforced

**Deviations:**
- Snapshot-insert logic lives in three places (see [S13]) instead of one helper
- Restore response type is richer than the plan's `Record<string, unknown>` but omits `status_label` enrichment (see [S11])

## Review Metadata

- **Agents dispatched:** Logic & Correctness; Error Handling & Edge Cases; Contract & Integration; Concurrency & State; Security; Plan Alignment
- **Scope:** All 69 changed files + adjacent modules (wordcount, chapter repository/service, purge, editor hooks)
- **Raw findings:** 35 (pre-verification, across 5 bug-hunting specialists)
- **Verified findings:** 27 (10 Important, 17 Suggestions, 0 Critical)
- **Filtered out:** 8 (mostly rationalized on second read or rejected by the specialists themselves before verification)
- **Steering files consulted:** `CLAUDE.md`
- **Plan/design docs consulted:** `docs/plans/2026-04-16-snapshots-find-replace-design.md`, `docs/plans/2026-04-16-snapshots-find-replace-plan.md`
