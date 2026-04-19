# Agentic Code Review: ovid/snapshots-find-and-replace

**Date:** 2026-04-18 11:06:19
**Branch:** ovid/snapshots-find-and-replace → main
**Commit:** 3343faf2ed1bb8b70a90ed4176d10b3a670004fb
**Files changed:** 84 | **Lines changed:** +13770 / -150
**Diff size category:** Large

## Executive Summary

This is the ninth PAAD review on a branch that adds chapter snapshots and project-wide find-and-replace. Prior rounds fixed the large majority of race, validation, and contract issues — most newly-flagged items turned out to already be handled in current code. One **Critical** data-corruption bug remains in the shared regex builder: combining `whole_word` with a top-level alternation (`foo|bar`) in regex mode produces matches that violate word boundaries. Three **Important** issues are worth fixing before merge: a stale snapshot-count badge after replace-all, raw-English error messages leaking into the find panel, and silently entering snapshot read-only view after a failed save.

## Critical Issues

### [C1] Whole-word regex wrapper splits on top-level alternation
- **File:** `packages/shared/src/tiptap-text.ts:162`
- **Bug:** `buildRegex` composes the whole-word pattern by string concatenation: `` `(?<![\p{L}\p{N}_])${pattern}(?![\p{L}\p{N}_])` ``. When the user supplies a regex pattern containing `|`, JS alternation binds wider than the wrappers, so `foo|bar` becomes `(?<!W)foo|bar(?!W)` — parsed as *`(?<!W)foo` OR `bar(?!W)`*. Verified by running the compiled regex against `'xbar'`: it returns `['bar']` even though `bar` is preceded by `x`, violating the left word-boundary assertion.
- **Impact:** A user who combines **regex mode + whole-word mode** and writes an alternation gets silently-wrong replacements in replace-all. For alternations of 2+ alternatives, every alternative except the first loses its leading boundary and every alternative except the last loses its trailing boundary. Data corruption across the manuscript with no warning.
- **Suggested fix:** Wrap the user's pattern in a non-capturing group before applying the boundary lookarounds: `` `(?<![\p{L}\p{N}_])(?:${pattern})(?![\p{L}\p{N}_])` ``.
- **Confidence:** High
- **Found by:** Logic-Server, Security

## Important Issues

### [I1] Snapshot count badge goes stale after replace when panel is closed
- **File:** `packages/client/src/pages/EditorPage.tsx:265,392` (and corresponding replace-one path)
- **Bug:** After a successful replace, `executeReplace`/`handleReplaceOne` call `snapshotPanelRef.current?.refreshSnapshots()`. But `SnapshotPanel` is conditionally mounted (around line 872), so the ref is `null` whenever the snapshot panel is closed. `useSnapshotState.refreshCount` only runs on panel close. The toolbar's snapshot-count badge therefore does not reflect the N auto-snapshots that replace-all just created.
- **Impact:** The badge silently lies to the user after a project-wide replace — they may see "3" when 15 snapshots now exist. Users rely on this count to decide whether to manage snapshots.
- **Suggested fix:** Expose `refreshCount()` from `useSnapshotState` and invoke it directly from the replace handlers in addition to the panel-scoped ref refresh.
- **Confidence:** High
- **Found by:** Logic-Client

### [I2] Search error path leaks raw server English into UI
- **File:** `packages/client/src/hooks/useFindReplaceState.ts:139,144`
- **Bug:** The catch block in `search` routes only four known 400 codes (`MATCH_CAP_EXCEEDED`, `REGEX_TIMEOUT`, `INVALID_REGEX`, `CONTENT_TOO_LARGE`) to externalized strings. Any other 400 and every non-`ApiRequestError` falls through to `setError(err.message)` — which is the raw server message (e.g. "Search query is too long") or a raw exception string. The sibling replace path centralizes this through `mapReplaceErrorToMessage`; search doesn't.
- **Impact:** Violates `strings.ts` externalization policy (CLAUDE.md §String externalization). Blocks future i18n and exposes backend implementation language to users.
- **Suggested fix:** Mirror `findReplaceErrors.ts`: on unknown 400, use a search-specific externalized string (add `STRINGS.findReplace.invalidSearchRequest` if missing); on network/other, use `STRINGS.findReplace.searchFailed`.
- **Confidence:** High
- **Found by:** ErrorHandling

### [I3] Snapshot view ignores `flushSave` result after failed save
- **File:** `packages/client/src/pages/EditorPage.tsx:883`
- **Bug:** The `SnapshotPanel onView` handler `await editorRef.current?.flushSave()` returns a boolean signalling save success. The code discards it and unconditionally calls `cancelPendingSaves()` then enters the snapshot read-only view. If the flush failed (server 5xx, regex-locked DB, etc.), the user enters view mode believing their content is durably saved — while the in-memory/cached edits may still be lost on the next remount. `SnapshotPanel.handleCreate` handles this correctly (aborts on `!flushed`); `onView` does not.
- **Impact:** Silent save-failure swallowing on a common flow. The user's recent edits may not be on the server, and re-entering edit mode can surface a stale cache or the pre-edit state — data loss disguised as a successful snapshot view.
- **Suggested fix:** Check the flush result. On `false`, set `actionError` (e.g. `STRINGS.snapshots.viewFailedSaveFirst`) and do not enter view mode.
- **Confidence:** High
- **Found by:** Concurrency, Logic-Client

## Suggestions

- **[S1]** `packages/server/src/search/search.routes.ts:154` — `SCOPE_NOT_FOUND` message "belongs to another project" is unreachable on a slug-scoped endpoint.
- **[S2]** `packages/client/src/utils/findReplaceErrors.ts:24` — 404 + code `NOT_FOUND` (project gone) falls through to generic `replaceFailed`; only `SCOPE_NOT_FOUND` is mapped.
- **[S3]** `packages/server/src/snapshots/snapshots.service.ts:157` — auto-restore label uses UTF-16 `slice(0,500)`; reuse grapheme-aware `truncateForLabel` used by replace labels.
- **[S4]** `packages/server/src/snapshots/snapshots.service.ts:125` — oversize snapshot emits the same `CORRUPT_SNAPSHOT` sentinel as schema-corrupt content; a distinct size code would drive clearer copy.
- **[S5]** `packages/server/src/snapshots/snapshots.service.ts:143-145` — missing/cross-project image reference also emits `CORRUPT_SNAPSHOT`; consider `MISSING_IMAGE_REFERENCE`.
- **[S6]** `packages/client/src/hooks/useSnapshotState.ts:138-143` — `viewSnapshot` catch maps every non-404 to `reason: 'network'`, including 500 and `ABORTED`.
- **[S7]** `packages/client/src/components/SnapshotPanel.tsx:184` — `handleCreate` catch-all maps every error to generic `createFailed`; does not distinguish 400 label-validation from 404 chapter-gone.
- **[S8]** `packages/client/src/hooks/useFindReplaceState.ts:146-148` — on any caught error the catch unconditionally wipes prior `setResults(null)`; a transient blip erases the user's visible results.
- **[S9]** `packages/client/src/hooks/useContentCache.ts:38` — `clearAllCachedContent` clears every `smudge:draft:*` key globally. Project-wide replace in project A clears unsaved caches for project B in other tabs. Namespace by `projectId`.
- **[S10]** `packages/server/src/search/search.routes.ts:64,109` — route uses `/api/projects/:slug/...`; design doc (2026-04-16-snapshots-find-replace-design.md §93,120) specifies `:id`. Reconcile.
- **[S11]** `packages/shared/src/tiptap-text.ts:17-23` — `SearchMatch` exposes `{ blockIndex, offset, length, context }`; design doc specifies `{ position: { node_path, offset } }`. Drift.
- **[S12]** `packages/server/src/snapshots/snapshots.service.ts:218-219` — `enrichChapterWithLabel` catch fallback sets `status_label = status` (raw code like `rough_draft` instead of display label).
- **[S13]** `packages/client/src/hooks/useSnapshotState.ts:126` — `typeof full.content === 'string' ? JSON.parse(full.content) : full.content`: the fallback is dead code given `SnapshotRow.content: string`.
- **[S14]** `packages/server/src/search/search.service.ts:37` vs `packages/server/src/app.ts:40` — `MAX_CHAPTER_CONTENT_BYTES` (5 MiB) duplicated with `express.json({ limit: '5mb' })`. Single source of truth.
- **[S15]** `packages/server/src/search/search.service.ts:40` — `SEARCH_ERROR_CODES` is server-only; the client uses string literals. Move to `@smudge/shared` for drift protection.
- **[S16]** `packages/server/src/snapshots/content-hash.ts:39` — on `JSON.parse` failure, falls back to raw-bytes hash; dedup treats byte-identical corrupt content as same but semantically-equivalent-byte-diff corrupt as different. Edge behavior, no practical impact for valid content.
- **[S17]** `packages/server/src/snapshots/snapshots.repository.ts:17` — `insert` returns `coerceRow(data)` echoing the input rather than re-reading the persisted row. A future server-side default would silently diverge.

## Plan Alignment

### Implemented
- Migration 014 with `chapter_snapshots` table (adds `ON DELETE CASCADE` beyond the plan — small enhancement).
- Full snapshot domain: types, repository, service, routes, `CreateSnapshotSchema`.
- All five planned endpoints (POST/GET list, GET/DELETE one, POST restore) with dedup, auto-snapshot-on-restore, image-ref diff, word-count recalc, transactional atomicity.
- Cascade-delete on chapter purge via FK.
- Ctrl/Cmd+S interception, Ctrl+H for find panel.
- `SnapshotPanel`, `SnapshotBanner`, `useSnapshotState` with view/restore/delete.
- `FindReplacePanel`, `useFindReplaceState` with toggles, debounce, aria-live, per-match/per-chapter/per-manuscript replace, confirm dialog, Enter-to-replace-all.
- Shared TipTap text walker (`tiptap-text.ts`) with search/replace, mark preservation, capture-group expansion, hardBreak preservation, Unicode-aware regex.
- Server-side search/replace services with Zod validation, project/chapter scoping, auto-snapshots, image-ref adjustment.
- E2e specs for both features.
- Hardening beyond the plan: ReDoS heuristic + wall-clock budget, match cap, content-size caps, canonical dedup hash, snapshot depth/size caps, label sanitization, cross-project scope guards.

### Not yet implemented
- Explicit Task 20 "Coverage & Cleanup" finalizing commit.
- Optional "Already saved" Ctrl+S indication on clean state (plan marked optional).
- aXe-core assertions may not be present inside the new panel e2e specs — worth verifying.

### Deviations
- **Replace-one is server-side** (aligned with the updated design doc, diverges from original plan Task 18 which described it as client-side TipTap edit). Intentional and documented in commit `d70866b`.
- **Snapshot create uses unified response shape** (commit `c016558`), not the plan's 200/201 split with distinct `"message"` — minor API-shape refinement, client handles both.
- **FK `ON DELETE CASCADE`** replaces explicit `deleteSnapshotsByChapter` cleanup (commit `01bfe53`). Functionally equivalent, cleaner than planned.
- **Extra error codes** (`MATCH_CAP_EXCEEDED`, `REGEX_TIMEOUT`, `CONTENT_TOO_LARGE`, `CORRUPT_SNAPSHOT`, `SCOPE_NOT_FOUND`) extend beyond the plan but match the design doc. No concern.

No contradictory deviations found.

## Review Metadata

- **Agents dispatched:** 7 specialists (Logic-Server, Logic-Client, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment) + 1 Verifier.
- **Scope:** Changed files and their callers/callees one level deep; `packages/{shared,server,client}/src/` and `docs/plans/2026-04-16-snapshots-find-replace-*.md`.
- **Raw findings:** 49 (before verification and dedup).
- **Verified findings:** 21 (1 Critical, 3 Important, 17 Suggestions).
- **Filtered out:** 28 (already handled in current code, mis-read, or duplicate).
- **Steering files consulted:** `CLAUDE.md`.
- **Plan/design docs consulted:** `docs/plans/2026-04-16-snapshots-find-replace-design.md`, `docs/plans/2026-04-16-snapshots-find-replace-plan.md`.
