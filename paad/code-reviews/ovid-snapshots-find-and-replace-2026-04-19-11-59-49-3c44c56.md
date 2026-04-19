# Agentic Code Review: ovid/snapshots-find-and-replace

**Date:** 2026-04-19 11:59:49
**Branch:** `ovid/snapshots-find-and-replace` → `main`
**Commit:** `3c44c563ef54952082904ca5f0fea7e91fca0d8a`
**Files changed:** 98 | **Lines changed:** +15,686 / -211
**Diff size category:** Large (17,376 diff lines)

## Executive Summary

The snapshots + find-and-replace feature has clearly been through multiple prior review rounds — most classic hazards (ReDoS deadline, TipTap depth caps, prototype-pollution in `canonicalize`, DOMPurify on snapshot HTML render, Zod at route boundary, replacement amplification caps, content-size limits) are already in place with explicit mitigations. Two critical findings remain: a **silent data-loss race** on snapshot restore (the one flow in `EditorPage.tsx` missing `setEditable(false)` around `flushSave`/reload), and a **pre-flight cache clear** in project-scope replace that destroys unsaved drafts before the server responds. Four important UX/trust bugs and ~17 suggestions round out the report.

## Critical Issues

### [C1] Snapshot restore can be silently undone by an unmount PATCH of pre-restore content
- **File:** `packages/client/src/pages/EditorPage.tsx:177-226` (`handleRestoreSnapshot`)
- **Bug:** `handleRestoreSnapshot` flushes and `markClean()`s before the restore request, but — unlike `executeReplace` (`:246`) and the SnapshotPanel `onView` handler (`:968`) — it never calls `editorRef.current?.setEditable(false)`. Between `markClean()` and `reloadActiveChapter()`, any keystroke re-dirties the editor; the subsequent Editor remount's unmount cleanup fires a fire-and-forget PATCH of pre-restore content that lands on the server **after** the restore commit and silently overwrites it.
- **Impact:** User clicks Restore, sees the "restored" UI, but whatever they typed during the round-trip flushes pre-restore content back on top. Silent data corruption of the user's most trust-sensitive action.
- **Suggested fix:** Wrap the flow in `setEditable(false)` / `setEditable(true)` in a `try/finally` exactly like `executeReplace`.
- **Confidence:** High
- **Found by:** Concurrency & State

### [C2] Replace-all (project scope) wipes unsaved drafts of every chapter before the server responds
- **File:** `packages/client/src/pages/EditorPage.tsx:268-274` (`executeReplace`)
- **Bug:** When scope is `project`, `clearAllCachedContent((project.chapters ?? []).map((c) => c.id))` runs **before** `api.search.replace(...)` is issued. If the request fails (network blip, 5xx, abort, server 400), the localStorage drafts for every chapter in the project are gone, violating the CLAUDE.md invariant: *"client-side cache holds unsaved content until server confirms."*
- **Impact:** A single network glitch during replace-all destroys every unsaved draft across the project — silent data loss.
- **Suggested fix:** Clear caches **after** a successful response, scoped to `result.affected_chapter_ids`. For the preflight, either defer the clear entirely or snapshot the caches and restore them on failure.
- **Confidence:** High
- **Found by:** Logic & Correctness (Client) / Concurrency & State

## Important Issues

### [I1] `viewSnapshot` leaves editor silently read-only on transient failure
- **File:** `packages/client/src/pages/EditorPage.tsx:951-981` (SnapshotPanel `onView`)
- **Bug:** The handler calls `editorRef.current?.setEditable(false)` before awaiting `viewSnapshot`. When `viewSnapshot` resolves with `{ ok: false, reason: "network" | "not_found" | "corrupt_snapshot" | "unknown" }` (as opposed to throwing), execution returns the failure object at line 977 without ever re-enabling the editor. `viewingSnapshot` stays null so the normal editor renders, but it is invisibly read-only.
- **Impact:** One transient View failure makes the manuscript read-only with no feedback. User must switch chapters or reload.
- **Suggested fix:** Inspect `result.ok`; if false, call `editorRef.current?.setEditable(true)` before returning. Consider the same for the `staleChapterSwitch` early-return branch.
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases

### [I2] 4xx save rejection leaves localStorage draft, creating a persistent unrecoverable save-error loop
- **File:** `packages/client/src/hooks/useProjectEditor.ts:155-158` (break) + 173-177 (error state)
- **Bug:** On a 4xx response, the retry loop breaks and `saveStatus` becomes `"error"`, but `clearCachedContent(savingChapterId)` is never called. On next session the same rejected content re-hydrates into the editor and every subsequent save 400s again.
- **Impact:** User is stuck in persistent "Unable to save" state on one chapter with no UI path to recovery other than clearing localStorage. CLAUDE.md's API contract is: *"rejects invalid JSON with 400 (preserves previous content)"* — the server still has the prior good content, but the client refuses to use it.
- **Suggested fix:** On 4xx specifically: surface the server `err.message` to the user, then clear the cached draft so the next load pulls the server's preserved content.
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases

### [I3] ReDoS heuristic rejects safe disjoint-class patterns like `\w+\s+\w+`, `\d+\.\d+`
- **File:** `packages/shared/src/tiptap-text.ts:266-275` (`assertSafeRegexPattern`)
- **Bug:** The adjacent-unbounded-quantifier check flags any two quantified atoms in sequence, including provably-disjoint ones (`\d`/`\s`, `\w`/`\s`, uppercase/lowercase classes). Common user tokenization patterns — `\w+\s+\w+`, `\d+\.\d+`, `[A-Z]+[a-z]+` — are rejected with 400 `INVALID_REGEX`. The heuristic also *doesn't* catch actual catastrophic patterns like `(a|ab)+c` or `(.*a){25}`; those rely on the 2s deadline.
- **Impact:** Legitimate find/replace patterns fail with no workaround; feature feels broken for power users.
- **Suggested fix:** Special-case the `\d`/`\s`/`\w` family (and their complements) as mutually disjoint. Minimum: skip the warning when the two adjacent atoms reference disjoint character classes.
- **Confidence:** High
- **Found by:** Logic & Correctness (Server); related to Security

### [I4] Search 404 surfaces retry-suggesting copy while the panel clears results
- **File:** `packages/client/src/utils/findReplaceErrors.ts:47-62` + `packages/client/src/hooks/useFindReplaceState.ts:170-180`
- **Bug:** `mapSearchErrorToMessage` has no 404 branch, so a 404 falls through to `STRINGS.findReplace.searchFailed` (generic retry copy). Meanwhile the hook treats 404 as terminal and clears `results`/`resultsQuery`. The user sees "Search failed, try again" with an empty result pane — retry will 404 forever. The sibling replace mapper correctly has `replaceScopeNotFound` terminal copy for this case.
- **Impact:** Misleading UX that invites a retry loop on a terminal failure.
- **Suggested fix:** Add a 404 branch to `mapSearchErrorToMessage` returning terminal copy (e.g. project-gone message mirroring `replaceScopeNotFound`).
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases

## Suggestions

- `packages/client/src/hooks/useSnapshotState.ts:140-180` — `viewSnapshot` lacks a per-request seq guard (uses only `chapterSeqRef`); rapid View clicks on same chapter can return out-of-order. Add `viewSeqRef`.
- `packages/client/src/hooks/useFindReplaceState.ts:80-92` — project-id change effect does not call `searchAbortRef.current?.abort()`; server keeps walking a project the user left.
- `packages/server/src/snapshots/snapshots.service.ts:170` — `truncateGraphemes(snapshot.label, 450)` runs **before** sanitization; bidi/control chars count toward the budget then get stripped, yielding oddly-short or empty-looking labels. Sanitize first, then truncate.
- `packages/server/src/snapshots/snapshots.repository.ts` + `service.ts:24-52` — concurrent manual-snapshot POSTs are theoretically racy with Knex default `BEGIN DEFERRED`. Single-process Node + synchronous better-sqlite3 make the window narrow but not impossible. Consider `BEGIN IMMEDIATE` or a unique partial index `(chapter_id, content_hash) WHERE is_auto = 0`.
- `packages/server/src/snapshots/content-hash.ts:47,67-68` — `warnedFallbackDigests` Set is unbounded; cap with FIFO eviction (~256 entries).
- `packages/server/src/app.ts:81-92` — global error handler discards `err.message` for all non-SyntaxError 400s, masking specific validation failures behind generic copy.
- `packages/server/src/search/search.routes.ts:149-150` + `packages/shared/src/constants.ts` — `"SCOPE_NOT_FOUND"` is a raw string literal on both sides; all peer codes live in `SEARCH_ERROR_CODES`. Add it to the shared enum.
- `packages/shared/src/tiptap-text.ts:67` — `MAX_WALK_DEPTH = 64` is inlined with a comment admitting it duplicates `MAX_TIPTAP_DEPTH` to avoid a circular import. Restructure imports; drift risk.
- `packages/shared/src/tiptap-text.ts:340-357` — `canonicalJSON` duplicates `content-hash.ts:28-39` `canonicalize` without UNSAFE_KEYS filter or depth cap. Extract a single shared helper.
- `packages/server/src/snapshots/snapshots.service.ts:232` — `as unknown as Record<string, unknown>` cast with outer type weakened. Use `ChapterWithLabel`.
- `packages/shared/src/schemas.ts:183-191` — `CreateSnapshotSchema.label` runs `.transform(sanitizeSnapshotLabel)` before any `.max()`; add `.max(5000)` before transform for defense-in-depth. Also: the 500-char cap is code-unit post-sanitize while auto-labels grapheme-truncate; consider unifying.
- `packages/server/src/images/images.references.ts:11` — `IMAGE_SRC_RE` is unanchored; pasted URLs like `?ref=/api/images/<uuid>/x` can inflate refcounts. Anchor to full src or require pathname match.
- `packages/server/src/search/search.routes.ts:47-49` — match_index cap of 9999 combined with the walker's `isMatchIndexMode` skip of the count cap lets a single request enumerate ~10k matches. Either document the intent or lower the route cap.
- `packages/server/src/search/search.service.ts:283` — auto-label renders nested apostrophes `'foo's bar'`. Cosmetic; consider escaping or smart quotes.
- Snapshot retention: auto-snapshots grow unbounded (replace-all creates one per affected chapter; 5 MB each). `listByChapter` has no LIMIT. Single-user self-DoS only, but worth a retention policy / pagination.
- `packages/client/src/hooks/useProjectEditor.ts:213-231, 259-298` — `handleSelectChapter` / `handleDeleteChapter` bump `saveSeqRef` but don't `saveAbortRef.current?.abort()`; server-side `deleted_at IS NULL` filter neuters the race, but aborting still saves the wasted PATCH.
- `packages/server/src/chapters/chapters.service.ts:119-120` — `findChapterById` read is after tx commit; a concurrent write could be reflected in the returned `word_count`. Single-user mitigates; low priority.
- `packages/server/src/snapshots/snapshots.service.ts:96-116` — `restoreSnapshot` reads snapshot + validates outside the transaction. A concurrent delete surfaces as null inside the tx (already handled); style only.

## Plan Alignment

**Plan/design docs consulted:** `docs/plans/2026-04-16-snapshots-find-replace-design.md`, `docs/plans/2026-04-16-snapshots-find-replace-plan.md`

- **Implemented:** Migration 014 (`chapter_snapshots` table), snapshot service/repository/routes with dedup via content hash + restore flow + auto-snapshot + image ref diff + word-count recalc, snapshot API client surface, `SnapshotPanel` / `SnapshotBanner` / `useSnapshotState` wiring, Ctrl/Cmd+S flush, snapshot e2e tests; `tiptap-text` shared search/replace with ReDoS safety and deadline + match cap, replace service with per-chapter auto-snapshots, search/replace routes with Zod validation, `FindReplacePanel` / `useFindReplaceState`, Ctrl/Cmd+H toggle, find-replace e2e tests. All 20 plan tasks appear to have produced committed artifacts.
- **Not yet implemented:** None obvious.
- **Deviations (neutral, appear intentional):**
  - Search/replace routes are slug-scoped (`:slug`), not id-scoped as written in the plan.
  - POST snapshot returns `{ status: "created"|"duplicate", snapshot }` envelope instead of a bare body, so the client can distinguish dedup.
  - Restore adds 400 paths `CORRUPT_SNAPSHOT` and `CROSS_PROJECT_IMAGE_REF` beyond the plan's 404.
  - Replace has an additional 404 with code `SCOPE_NOT_FOUND` for soft-deleted/cross-project chapter targets.
  - Auto-label embedded user strings run through `sanitizeSnapshotLabel` and grapheme truncation (plan didn't specify).
  - `ReplaceSchema.scope` is required (not defaulted) and uses `.strict()`.
  - `SearchResult` also includes `skipped_chapter_ids` (plan only showed it on replace).
  - `restoreSnapshot` return type is still `Record<string, unknown>` rather than the stronger `ChapterWithLabel` suggested in the plan.
  - Ctrl+S no-ops when a modal is open (plan didn't specify).

## Review Metadata

- **Agents dispatched:** 7 — Logic & Correctness (server), Logic & Correctness (client), Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** changed files + callers/callees one level deep; key packages: `packages/server/src/snapshots/`, `packages/server/src/search/`, `packages/shared/src/tiptap-text.ts`, `packages/shared/src/tiptap-depth.ts`, `packages/client/src/hooks/useSnapshotState.ts`, `packages/client/src/hooks/useFindReplaceState.ts`, `packages/client/src/hooks/useProjectEditor.ts`, `packages/client/src/pages/EditorPage.tsx`, `packages/client/src/components/{SnapshotPanel,SnapshotBanner,FindReplacePanel}.tsx`, `packages/client/src/utils/findReplaceErrors.ts`.
- **Raw findings:** 36 (before verification)
- **Verified findings:** 24 (after verification — 2 Critical, 4 Important, 18 Suggestions)
- **Filtered out:** 12 false positives or duplicates (notably: `scanImageReferences` image-purge-through-snapshot scenario was not reachable because `deleteImage` blocks via a broader scan; `snapshots.get(id)` "unused" — it is called from `useSnapshotState.ts:152`; client-disconnect cancelation not reachable in single-user threat model; ReDoS in single-user app; walker-consolidation maintainability note; `reloadActiveChapter` "redundant GET" is not a correctness issue).
- **Steering files consulted:** `CLAUDE.md`
- **Plan/design docs consulted:** `docs/plans/2026-04-16-snapshots-find-replace-design.md`, `docs/plans/2026-04-16-snapshots-find-replace-plan.md`
