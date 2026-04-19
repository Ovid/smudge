# Agentic Code Review: ovid/snapshots-find-and-replace

**Date:** 2026-04-17 14:20:34
**Branch:** ovid/snapshots-find-and-replace -> main
**Commit:** 9331c83fc677c13b788110186c88c35cf3afbbff
**Files changed:** 75 | **Lines changed:** +11,389 / -113
**Diff size category:** Large

## Executive Summary

This is the fifth review of the snapshots + find-and-replace branch. The prior round's Important findings (unified word-count walker, canonical marksEqual, match-cap skip in match_index mode, restore-within-tx, AbortController-wired saves, project-scope cache purge) are all correctly in place. One new **Critical** finding emerged: regex-mode replacement templates containing `$'` / `` $` `` can amplify chapter content without bound, since `MAX_REPLACE_LENGTH` caps only the template, not the expanded output — a plausible DoS/data-loss vector. Otherwise the remaining findings are hygiene: silent failure modes that trap users (skipped chapters, delete errors, timeout → "invalid regex" copy), a cross-project scope that returns 200 instead of 404, and one image-ref-count inconsistency on chapter restore.

## Critical Issues

### [C1] Replacement `$'` / `` $` `` can amplify chapter content without bound
- **File:** `packages/shared/src/tiptap-text.ts:128-145` (`expandReplacement`), cap lives at `packages/server/src/search/search.routes.ts:16` (`MAX_REPLACE_LENGTH`)
- **Bug:** `expandReplacement` supports regex back-references `$'` (right of match) and `` $` `` (left of match). `MAX_REPLACE_LENGTH = 10_000` bounds the raw template, but each `$'` expansion splices the entire run tail, so a crafted template like `$'$'$'$'` multiplied across thousands of matches produces output proportional to `matches × chapter_length`. No post-expansion size cap and no per-chapter stored-content cap exist.
- **Impact:** A single crafted replace (`search=".", replace="$'$'$'$'$'"`, regex on, scope=project) can balloon chapter content to hundreds of megabytes — wedging auto-save, ballooning the SQLite volume, and running the Node process out of memory. In a single-user app this is primarily a foot-gun / accidental-data-loss risk rather than an external attack, but the failure mode is silent until OOM.
- **Suggested fix:** Bound total output per chapter (reject if new content > e.g. 10× old or > a fixed hard cap like 10 MB) and/or strip / reject `$'` and `` $` `` tokens in replacement templates. A per-chapter stored-content byte cap in the chapter update path would cover the same class of bugs for autosave and restore too.
- **Confidence:** High
- **Found by:** Security

## Important Issues

### [I1] `restoreChapter` increments image refcounts without existence check
- **File:** `packages/server/src/chapters/chapters.service.ts:225-236`
- **Bug:** Every other caller of `incrementImageReferenceCount` (`updateChapter`, `restoreSnapshot`, `replaceInProject`) goes through `applyImageRefDiff`, which calls `findImageById` first and logs a warning on missing rows. `restoreChapter` loops over extracted image IDs directly, skipping the existence check.
- **Impact:** If an image was purged between chapter delete and restore, the refcount row may be incremented against nothing, or a later diff may see asymmetric state. Diverges from the documented symmetry of the other code paths and silences the operator-visible "image missing" warning.
- **Suggested fix:** Replace the manual loop with `await applyImageRefDiff(txStore, null, restoredRow.content)`.
- **Confidence:** High
- **Found by:** Logic & Correctness

### [I2] Cross-project chapter scope silently returns 0 replacements (200 OK)
- **File:** `packages/server/src/search/search.service.ts:196-200`
- **Bug:** When a chapter-scoped replace has a `chapter_id` that exists but belongs to a different project (or is soft-deleted), the service returns `{ replaced_count: 0, affected_chapter_ids: [] }` with a 200 response. The client cannot distinguish "no matches" from "wrong project."
- **Impact:** A misconfigured or buggy client sees "Replace All succeeded (0 replacements)" and has no way to detect the scope mismatch. Masks integration bugs that would otherwise fail loudly.
- **Suggested fix:** Return `null` so the route emits 404 `NOT_FOUND`.
- **Confidence:** High
- **Found by:** Error Handling

### [I3] `REGEX_TIMEOUT` server errors shown to user as "invalid regex"
- **File:** `packages/client/src/hooks/useFindReplaceState.ts:115-120`
- **Bug:** The error branch only checks `err.code === "MATCH_CAP_EXCEEDED"`; `REGEX_TIMEOUT` falls through to the `invalidRegex` user-facing string.
- **Impact:** A user whose pattern is syntactically valid but runs past the 2 s deadline sees "Invalid regular expression" — they'll assume it's a syntax error and waste time editing a pattern that was never wrong.
- **Suggested fix:** Add a `REGEX_TIMEOUT` branch mapped to a dedicated string (e.g. `S.searchTimedOut`).
- **Confidence:** High
- **Found by:** Error Handling

### [I4] `executeReplace` drops `skipped_chapter_ids` — corrupt chapters silently skipped
- **File:** `packages/client/src/pages/EditorPage.tsx:199-230`
- **Bug:** The server returns `skipped_chapter_ids` for chapters whose content could not be parsed. The client ignores the field; the user is told the replace succeeded.
- **Impact:** Replace-all appears to succeed globally, but corrupt chapters retain their old text. The user learns about it only when they open those chapters individually.
- **Suggested fix:** On non-empty `skipped_chapter_ids`, surface a warning banner enumerating the skipped chapter titles (look up from `listChapters`) and keep it visible until dismissed.
- **Confidence:** High
- **Found by:** Error Handling

### [I5] `SnapshotPanel.handleDelete` swallows delete failures silently
- **File:** `packages/client/src/components/SnapshotPanel.tsx:177-185`
- **Bug:** The catch does nothing. On 404/500 the snapshot row stays in the list, the confirm dialog closes, and the user receives no feedback.
- **Impact:** User believes a snapshot was deleted when it wasn't — a trust violation for a destructive action.
- **Suggested fix:** Surface a per-row error (or toast), keep the item in place, and log.
- **Confidence:** High
- **Found by:** Error Handling

### [I6] Initial snapshot-list fetch silently swallows errors
- **File:** `packages/client/src/hooks/useSnapshotState.ts:55-62`
- **Bug:** The initial list `.catch(() => {})` leaves `snapshotCount` at 0 after a transient network failure.
- **Impact:** Toolbar badge permanently reads 0 even though snapshots exist; user has no indication to retry.
- **Suggested fix:** Set an error/stale flag; retry on next chapter select or panel open, and annotate the badge.
- **Confidence:** High
- **Found by:** Error Handling

### [I7] `truncateForLabel` misses bidi / line-separator chars that `sanitizeSnapshotLabel` strips
- **File:** `packages/server/src/search/search.service.ts:46-65` vs `packages/shared/src/schemas.ts:120-127`
- **Bug:** Two independent sanitizers for snapshot labels. `sanitizeSnapshotLabel` (used by manual snapshots) strips bidi overrides (U+202A–202E, U+2066–2069) and line separators (U+2028/2029); `truncateForLabel` (used by auto-snapshots created during replace-all) strips only C0/C1 controls.
- **Impact:** A `search` / `replace` string containing bidi overrides lands verbatim in an auto-snapshot label and renders with reversed visual order — Trojan-Source-style spoofing in the snapshot list. Single-user context limits the threat, but the inconsistency is strictly wrong.
- **Suggested fix:** Share one sanitizer (promote `sanitizeSnapshotLabel` to `@smudge/shared` or have `truncateForLabel` call it) and apply it uniformly.
- **Confidence:** High
- **Found by:** Security, Contract & Integration (two specialists agreed)

### [I8] `SearchSchema` / `ReplaceSchema` accept unknown fields — option typos silently ignored
- **File:** `packages/server/src/search/search.routes.ts:18-41`
- **Bug:** Neither schema is `.strict()`. `{ regexp: true }` (typo for `regex`) or `{ whole_words: true }` (typo for `whole_word`) parse successfully and produce a default-options search.
- **Impact:** Integration authors (or the client itself, post-refactor) get "no results" with no indication that their option was dropped.
- **Suggested fix:** Add `.strict()` to both top-level schemas and to `SearchOptionsSchema`.
- **Confidence:** High
- **Found by:** Error Handling

## Suggestions

- **[S1]** `RegExpTimeoutError(0)` literal zero at `packages/shared/src/tiptap-text.ts:367, 456` — message reads "timed out after 0ms" if it ever surfaces without the service's re-wrap.
- **[S2]** `useSnapshotState.viewSnapshot` at `useSnapshotState.ts:88-92` swallows `JSON.parse` failures — viewing a corrupt snapshot looks like a no-op.
- **[S3]** `enrichChapterWithLabel` at `snapshots.service.ts:165-174` degrades `status_label` to the raw enum on DB lookup failure with no log.
- **[S4]** `useSnapshotState` at `useSnapshotState.ts:147-151` — `refreshCount` fires on mount (before any open→close transition), racing with the mount-effect list fetch.
- **[S5]** `handleDeleteChapter` at `useProjectEditor.ts:205-235` — secondary fetch is not guarded by `selectChapterSeqRef`; rapid chapter switch after delete could show the wrong chapter.
- **[S6]** `handleSelectChapter` at `useProjectEditor.ts:159-177` bumps `saveSeqRef` but does not abort an in-flight save; the server can still write stale content for the outgoing chapter.
- **[S7]** `api.snapshots.restore` at `client.ts:286` is typed `Chapter` but the service returns `Record<string, unknown>` — define a shared `RestoreSnapshotResponse` type.
- **[S8]** `ReplaceResult` is inline-duplicated between `client.ts:307-311` and `search.service.ts:169-176` — promote to `@smudge/shared`.

## Plan Alignment

Per the most recent prior review, Phase 4b (snapshots + find-replace) is implemented with the expected feature set. Prior-round fixes verified:

- **Implemented:** Unified word-count walker (I1/I2 from prior round), canonical `marksEqual`, match-cap skip in `match_index` mode (I3), `restoreSnapshot` reads inside transaction (I4), `useSnapshotState` seq-captured before await (I5/I6), `AbortController` wired through save PATCH (I7), project-scope `clearAllCachedContent` (I8), ReDoS heuristic + 2 s wall-clock deadline (I9/I10).
- **Not yet implemented:** n/a — the plan is fundamentally complete; open items are bug-level rather than scope-level.
- **Deviations:** None detected.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security (5 specialists, one pass each), then Verifier
- **Scope:** Server — snapshots/, search/, chapters/, images/, stores/, db/migrations/014; Shared — tiptap-text, wordcount, schemas, types; Client — hooks (useSnapshotState, useFindReplaceState, useProjectEditor, useContentCache, useKeyboardShortcuts), components (FindReplacePanel, SnapshotPanel, SnapshotBanner, EditorToolbar), pages (EditorPage), api/client
- **Raw findings:** 26 (before verification)
- **Verified findings:** 17 (1 Critical, 7 Important, 8 Suggestion — after verification + dedup)
- **Filtered out:** 9 (F24 mis-described; EH9 / EH10 not reproducible; C3 not-current-bug; CS3 / CS7 unverified; duplicates collapsed into I7)
- **Steering files consulted:** `/Users/poecurt/projects/smudge/CLAUDE.md` — no contradictions found
- **Plan/design docs consulted:** `docs/plans/2026-04-16-snapshots-find-replace-design.md`, `docs/plans/2026-04-16-snapshots-find-replace-plan.md`
