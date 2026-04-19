# Agentic Code Review: ovid/snapshots-find-and-replace

**Date:** 2026-04-17 23:21:31
**Branch:** ovid/snapshots-find-and-replace -> main
**Commit:** 1279bf55fe85f020156fddff6e4d85c060ca02ac
**Files changed:** 82 | **Lines changed:** +13,064 / -149
**Diff size category:** Large

## Executive Summary

Two serious data-integrity bugs sit at the intersection of the Editor lifecycle and the new snapshot/replace flows. The rest of the branch — the result of many prior review rounds — is in good shape: transactional correctness, ReDoS defenses, soft-delete filters, and the shared TipTap walker all hold up under inspection. Ten Important findings remain, most concentrated around error surfacing (silent view/delete failures), cache-clearing ordering, and one steering-doc violation (HTTP 422).

## Critical Issues

### [C1] Editor unmount fire-and-forget save clobbers restore/replace/cross-chapter saves
- **File:** `packages/client/src/components/Editor.tsx:137-150`
- **Bug:** On unmount (including `key=${activeChapter.id}:${chapterReloadKey}` remounts triggered by `reloadActiveChapter`), the cleanup fires an unawaited PATCH with `editorInstanceRef.current.getJSON()` when `dirtyRef.current` is true. `cancelPendingSaves()` in `EditorPage` (used before snapshot restore and replace-all) does not reach into the Editor's `dirtyRef` or the unmount cleanup. If the unmount PATCH lands after the server already committed a restore/replace, the pre-restore content silently clobbers the new state.
- **Impact:** Silent data loss on snapshot restore, find/replace-all, and rapid chapter switches with unsaved keystrokes mid-flight.
- **Suggested fix:** Expose a `markClean()` on `EditorHandle` that `cancelPendingSaves` can invoke before the remount, or have the unmount cleanup skip when a "no-save" ref is set by the orchestration path. Alternative: put the Editor in read-only mode during the restore/replace round-trip.
- **Confidence:** High
- **Found by:** Logic & Correctness (client), Error Handling, Concurrency & State

### [C2] `applyImageRefDiff` mass-decrements image refs when `newContent` JSON is corrupt
- **File:** `packages/server/src/images/images.references.ts:80-91`
- **Bug:** A `JSON.parse` failure on `newContentJson` is caught and leaves `newContent = null`. `extractImageIds(null)` returns `[]`, so every id from `oldContent` is classified as "removed" and decremented. Reference counts can drop to (or below) zero and become eligible for future purge.
- **Impact:** Silent image data loss (orphaned/purged images) after any malformed content write. Today all incoming paths validate via Zod, so this is latent — but it's the shared surface every future writer will reach for.
- **Suggested fix:** On `newContent` parse failure, abort the diff (no increments or decrements) and log at `warn`. Ref counts must be conservative, not optimistic.
- **Confidence:** High
- **Found by:** Error Handling, Contract & Integration

## Important Issues

### [I1] Auto-snapshot label in `restoreSnapshot` bypasses sanitize + 500-char cap
- **File:** `packages/server/src/snapshots/snapshots.service.ts:136-149`
- **Bug:** `snapshotLabel = `Before restore to '${snapshot.label}'`` is inserted raw. The sibling auto-label pipeline in `search.service.ts:301-303` now goes through `sanitizeSnapshotLabel(...).slice(0, 500)` (commit 5ea591f); this path was missed.
- **Impact:** A long or control-character-bearing manual label produces a restore-auto-snapshot label that can overflow the schema cap, inject zero-width/bidi, or spoof the UI list rendering.
- **Suggested fix:** Wrap through `sanitizeSnapshotLabel(...).slice(0, 500)`, mirroring `search.service`.
- **Confidence:** High
- **Found by:** Logic & Correctness (server), Security

### [I2] `expandReplacement` emits literal `$NN` when `NN` exceeds group count — diverges from JS native `replace`
- **File:** `packages/shared/src/tiptap-text.ts:130-144`
- **Bug:** For a regex with 1 capture group, native `String.prototype.replace` expands `$12` as `<group1>` + literal `"2"`. Here, `idx = 12 >= match.length = 2` returns the whole literal `$12`. The docstring promises native-replace semantics.
- **Impact:** User-visible divergence for advanced users doing regex replace with many groups; silent wrong replacement.
- **Suggested fix:** Greedy-then-fall-back — try 2-digit; if out of range, fall back to 1-digit + literal remainder.
- **Confidence:** High
- **Found by:** Logic & Correctness (server)

### [I3] `replaceInDoc` match-cap check excludes earlier runs inside the same block
- **File:** `packages/shared/src/tiptap-text.ts:461`
- **Bug:** `totalCount + allMatches.length >= MAX_MATCHES_PER_REQUEST`. `totalCount` is only updated AFTER each run finishes (line 492). In a block with multiple runs (e.g., split by `hardBreak`), earlier runs' matches aren't folded into the cap until the run completes.
- **Impact:** Defeats the explicit purpose of the internal cap on multi-run blocks. The 2 s wall-clock deadline still caps total runtime, but one of two DoS defenses is weakened.
- **Suggested fix:** Track a block-local counter that's added to the cap check alongside `totalCount + allMatches.length`.
- **Confidence:** Medium
- **Found by:** Logic & Correctness (server)

### [I4] `handleReplaceOne` does not clear the per-chapter localStorage cache
- **File:** `packages/client/src/pages/EditorPage.tsx:337-389`
- **Bug:** After a successful single-match replace, `clearCachedContent(chapterId)` is not called (compare `executeReplace:241-245`). If the replace targets a non-active chapter with a cached pre-replace draft, later navigating to it restores the stale localStorage content, which autosaves over the replace.
- **Impact:** Silent undo of a Replace-One when the user had unsaved edits in the target chapter before invoking it and navigates back.
- **Suggested fix:** After a successful `api.search.replace` in `handleReplaceOne`, call `clearCachedContent(chapterId)` for the scoped chapter.
- **Confidence:** High
- **Found by:** Logic & Correctness (client), Contract & Integration

### [I5] A→B→A chapter-switch during snapshot restore skips the reload
- **File:** `packages/client/src/hooks/useSnapshotState.ts:126-132` + `packages/client/src/pages/EditorPage.tsx:184-193`
- **Bug:** `chapterSeqRef` increments on every `chapterId` change. If the user is on chapter A, starts a restore, switches to B, then back to A before the restore resolves, `seq` has moved forward twice. The handler returns `{staleChapterSwitch: true}` and `EditorPage` skips `reloadActiveChapter()` — even though the active chapter IS the restored one.
- **Impact:** User sees pre-restore content; subsequent autosave clobbers the successful restore.
- **Suggested fix:** Track the chapter id the restore targeted and compare to the current active chapter. Only skip the reload when they differ.
- **Confidence:** High
- **Found by:** Logic & Correctness (client), Contract & Integration

### [I6] `viewSnapshot` silently swallows all errors
- **File:** `packages/client/src/hooks/useSnapshotState.ts:95-107`
- **Bug:** `try { ... } catch {}` with the comment "Silently fail". 404, 500, NETWORK, or a `JSON.parse` failure on corrupt content all produce no user feedback.
- **Impact:** User clicks "View" in the snapshot list and nothing happens. Corrupt-content snapshots become silently undetectable from the UI.
- **Suggested fix:** Surface a viewer-level error state (parallel to `listError`). Distinguish 404 ("snapshot no longer available — refresh the list") from parse/network errors.
- **Confidence:** High
- **Found by:** Error Handling

### [I7] `SnapshotPanel.handleDelete` loops on 404 without refreshing the list
- **File:** `packages/client/src/components/SnapshotPanel.tsx:188-200`
- **Bug:** On delete error, it sets `deleteError` and keeps the confirmation dialog open. It does not call `fetchSnapshots()`. If the snapshot is already gone (deleted in another tab, or chapter soft-deleted so `deleteSnapshot` returns 404), the stale row remains in the list and every retry hits the same 404.
- **Impact:** User stuck in a retry loop on a phantom snapshot.
- **Suggested fix:** On `err.status === 404`, treat as success (server state already matches intent) and refresh. For other errors, still refresh so the user sees current state before retrying.
- **Confidence:** High
- **Found by:** Error Handling

### [I8] Replace-all `clearAllCachedContent()` runs AFTER `api.search.replace` response
- **File:** `packages/client/src/pages/EditorPage.tsx:225-253`
- **Bug:** During the `await api.search.replace(...)`, a chapter switch reads `getCachedContent` for the new chapter → gets a pre-replace draft → autosaves it over the server's replaced content. The cache clear only happens after the response returns.
- **Impact:** Same family as [C1] — pre-replace content can clobber post-replace for non-active chapters hit by a project-scoped replace.
- **Suggested fix:** Call `clearAllCachedContent()` (or scoped clears) BEFORE issuing the replace request; accept the small risk of a superfluous clear on replace failure.
- **Confidence:** High
- **Found by:** Logic & Correctness (client), Concurrency & State

### [I9] HTTP 422 `CORRUPT_SNAPSHOT` violates `CLAUDE.md` allowed-status-code list
- **File:** `packages/server/src/snapshots/snapshots.routes.ts:140`
- **Bug:** `CLAUDE.md` explicitly restricts HTTP status codes to `200, 201, 400, 404, 500`. Restore returns `422`.
- **Impact:** Project convention drift. Either the rule needs updating (409 already exists for image-delete conflict) or the code needs to align.
- **Suggested fix:** Return `400 CORRUPT_SNAPSHOT` (validation-style error) and adjust the client to key on `err.code`; OR update `CLAUDE.md` to enumerate allowed exceptions.
- **Confidence:** High
- **Found by:** Contract & Integration (steering rule)

### [I10] `mapReplaceErrorToMessage` returns raw server `err.message` for unhandled 400 codes
- **File:** `packages/client/src/utils/findReplaceErrors.ts:15-21`
- **Bug:** After the specific-code branches (INVALID_REGEX / MATCH_CAP_EXCEEDED / REGEX_TIMEOUT / CONTENT_TOO_LARGE), the function falls back to `err.message` — raw English server text (e.g., "Invalid request body.") surfaced verbatim.
- **Impact:** Breaks the `CLAUDE.md` string-externalization rule ("All UI strings in `packages/client/src/strings.ts` as constants, never raw literals"). Blocks future i18n.
- **Suggested fix:** Fall back to a generic `STRINGS.findReplace.*` constant. Log the raw message to `console.debug` for debugging.
- **Confidence:** High
- **Found by:** Error Handling, Contract & Integration (steering rule)

### [I11] `restoreSnapshot` corruption check accepts structurally malformed TipTap docs
- **File:** `packages/server/src/snapshots/snapshots.service.ts:107-128`
- **Bug:** Validates only `type === "doc"` + `Array.isArray(content)` + depth + byteLength. Does NOT run `TipTapDocSchema.safeParse` — the same schema that gates chapter PATCH. A snapshot with top-level shape right but malformed nested nodes (e.g., `{type: "image", attrs:{src: /api/images/<foreign-uuid>}}` or missing required attrs) passes.
- **Impact:** Restored chapter's next PATCH could 400; `countWords` returns 0; image-ref diff may misbehave on unexpected shapes.
- **Suggested fix:** Run `TipTapDocSchema.safeParse(parsed)` inside the corruption check; return `corrupt_snapshot` on failure.
- **Confidence:** High
- **Found by:** Error Handling, Logic & Correctness (server)

### [I12] Cross-project image references in restored snapshots are silently kept in the doc
- **File:** `packages/server/src/snapshots/snapshots.service.ts:164` + `packages/server/src/images/images.references.ts:100-106`
- **Bug:** `applyImageRefDiff` refuses to increment ref counts for foreign-project image ids (logs a warning). But `restoreSnapshot` still writes the doc with the foreign `src` intact. If the foreign project is later purged, the URL 404s.
- **Impact:** Broken images appear after an unrelated project purge; no user-visible warning at restore time.
- **Suggested fix:** During restore, `extractImageIds(parsed)` and verify each id belongs to the current project. Either strip/replace foreign nodes, or return a `corrupt_snapshot`-like code with a specific user message.
- **Confidence:** High
- **Found by:** Security, Contract & Integration

## Suggestions

- **Ctrl+H** `preventDefault()` fires even when `toggleFindReplaceRef` is undefined — latent footgun. `packages/client/src/hooks/useKeyboardShortcuts.ts:129-135`
- **AbortError classification** in `api/client.ts:32-48` requires `instanceof DOMException`; brittle across polyfills. Prefer `err?.name === "AbortError"`.
- **`skipped_chapter_ids`** returns IDs only — user cannot locate the corrupt chapter. Consider `skipped_chapters: [{id, title}]`. `packages/server/src/search/search.service.ts:259-278`, `pages/EditorPage.tsx:262-266`
- **Deadline check ordering** in search/replace iterates all empty-content chapters before checking wall-clock. Minor, not a DoS. `search.service.ts:158-159, 263-264`
- **Duplicated error mapping** — `useFindReplaceState.search` reimplements the 400-code → `STRINGS` table already centralized in `findReplaceErrors.ts`. Consolidate with a `mapSearchErrorToMessage` helper. `useFindReplaceState.ts:131-145`
- **`api.search.find/replace`** lack `AbortSignal` — `closePanel` can't cancel server CPU work; rapid open/close floods the server. `api/client.ts:298-324`
- **ReDoS heuristic blind spots** (e.g., disjunctive overlap `(a|ab)+c`); wall-clock deadline only fires between `exec` calls — a single `exec` over a large flat text can still block the loop. Consider `re2` (BSD-3-Clause) or chunked scanning. `tiptap-text.ts:178-228`
- **No cumulative project-total cap** on regex replace — each chapter has a 5 MB cap, but a project-wide `$'`-amplifying replace could accumulate significant bytes across chapters + auto-snapshots. `search.service.ts:319-322`
- **Purge** relies on FK `ON DELETE CASCADE` (migration 014) rather than the plan-prescribed explicit `deleteSnapshotsByChapter` call. Equivalent behavior; the repository method is now dead code. `packages/server/src/db/purge.ts:18`
- **`LEAF_BLOCKS`** = `{paragraph, heading, codeBlock}` — future custom leaf-text nodes would be silently skipped. Task-list paragraphs still work because they nest a real `paragraph`. `tiptap-text.ts:51`
- **`truncateForLabel`** lives in server only; its grapheme-aware sibling to `sanitizeSnapshotLabel` (in `@smudge/shared`) would sit better next to it. `search.service.ts:61-79`

## Plan Alignment

Plan docs: `docs/plans/2026-04-16-snapshots-find-replace-design.md`, `docs/plans/2026-04-16-snapshots-find-replace-plan.md`.

**Implemented:**
- Migration 014 (`chapter_snapshots`) with FK `ON DELETE CASCADE`
- Snapshot types, Zod schemas, repository, service, routes (list/create/get/delete/restore)
- Snapshot panel + banner + `useSnapshotState` hook
- TipTap text walker (`extractBlockTexts`, `searchInDoc`, `replaceInDoc`) with ReDoS guard + match cap
- Search/replace service (transactional, auto-snapshot on replace-all, image-ref diff)
- Search/replace routes + client bindings
- `FindReplacePanel` + `useFindReplaceState`, Ctrl+H + Ctrl+S shortcuts
- Replace-all confirmation dialog, single-match replace (design supersedes plan Task 18)
- Comprehensive unit/integration coverage of all of the above

**Not yet implemented (neutral — partial is expected):**
- aXe audits in `e2e/snapshots.spec.ts` and `e2e/find-replace.spec.ts` (plan Task 11, 19; other e2e files do use AxeBuilder)
- E2e assertion that auto-snapshots are created after replace-all (plan Task 19 scenario 3)

**Deviations:**
- **Ctrl+S always calls `flushSave`** rather than a no-op when already-saved. Behavior is idempotent in practice (`flushSave` short-circuits on `!dirtyRef.current`), but the plan promised visible "already saved" feedback.
- **Cascade-on-purge** uses DB-level FK instead of explicit `deleteSnapshotsByChapter` call. Equivalent; `deleteSnapshotsByChapter` is now dead.
- **`CONTENT_TOO_LARGE`** (5 MB per-chapter cap) is a legitimate defense against `$'`/`` $` `` amplification but is undocumented in the design doc.
- **`FindReplacePanel`** does not render its own confirmation dialog — `EditorPage` does. Cleaner split but the keyboard-shortcut guard wiring (`replaceConfirmOpenRef`) is a consequence not described in the plan.
- **LEAF_BLOCKS** does not include blockquote/list containers as "separate blocks" the plan mentions; for standard TipTap schemas this is equivalent (inner `paragraph` is still walked).

## Review Metadata

- **Agents dispatched:** 7 specialists in parallel + 1 verifier
  - Logic & Correctness (server + shared)
  - Logic & Correctness (client)
  - Error Handling & Edge Cases
  - Contract & Integration
  - Concurrency & State
  - Security
  - Plan Alignment
- **Scope:** All 82 changed files — reviewed changed code + callers/callees one level deep, plus steering docs (`CLAUDE.md`) and plan docs.
- **Raw findings:** 37 (across specialists, pre-dedup)
- **Verified findings:** 24 (2 Critical + 10 Important + 11 Suggestions + 1 deviation captured in Plan Alignment)
- **Filtered out:** 13 (6 rejected as unreproducible / by-design; 7 merged into other findings)
- **Steering files consulted:** `CLAUDE.md`
- **Plan/design docs consulted:** `docs/plans/2026-04-16-snapshots-find-replace-design.md`, `docs/plans/2026-04-16-snapshots-find-replace-plan.md`
