# Agentic Code Review: ovid/snapshots-find-and-replace

**Date:** 2026-04-17 12:37:54
**Branch:** ovid/snapshots-find-and-replace -> main
**Commit:** f8d11139ca869d7a49cc8df7276a5ba1706aa7af
**Files changed:** 68 | **Lines changed:** +10339 / -104
**Diff size category:** Large

## Executive Summary

Since the prior review at `767d2a0`, the team has correctly closed the majority of critical and important findings (ReDoS guard added, dedup hashing canonicalized, restore errors propagated, `flushSave`/`cancelPendingSaves` paired, `u`-flag Unicode regex, response-shape unification, type consolidation, grapheme-safe label truncation, required `scope`). Two new critical issues remain: **replace-all paths still use live input state** instead of the frozen `resultsQuery`/`resultsOptions` (the I2 fix was applied only to `handleReplaceOne`), and the **"Replace All in Chapter" button lacks the empty-replacement guard** that protects the other replace entry points. Several important issues cluster around defense-in-depth: regex lookaround semantics in `replaceInDoc`, unbounded per-chapter match arrays before the service-level cap, a ReDoS heuristic that misses alternation/nested-group patterns, missing structural validation on snapshot restore, and error-code collapsing on the client.

## Critical Issues

### [C1] Replace-all paths use live input state, not the frozen `resultsQuery`/`resultsOptions`
- **File:** `packages/client/src/pages/EditorPage.tsx:231-262`
- **Bug:** `handleReplaceAllInManuscript` and `handleReplaceAllInChapter` populate `replaceConfirmation` (and the eventual `executeReplace` call) from `findReplace.query`, `findReplace.replacement`, and `findReplace.options` — the live input state. `handleReplaceOne` was fixed (I2) to read `resultsQuery`/`resultsOptions`, but the two replace-all paths were not.
- **Impact:** If the user tweaks the search input or toggles an option after results appear (within the 300ms debounce or before the next search fires) and then clicks Replace All, the confirmation dialog shows the old `total_count` while the server executes using the new query/options. Data loss: destructive replace-all with no recovery beyond per-chapter auto-snapshots.
- **Suggested fix:** Mirror the `handleReplaceOne` freeze — bail if `resultsQuery`/`resultsOptions` are null and drive both dialog copy and `executeReplace` from those frozen values. Consider disabling the replace-all buttons while live state differs from `resultsQuery`/`resultsOptions`.
- **Confidence:** High
- **Found by:** Logic, Error Handling, Concurrency

### [C2] "Replace All in Chapter" button is not disabled on empty replacement
- **File:** `packages/client/src/components/FindReplacePanel.tsx:262-268`
- **Bug:** The footer "Replace All in Manuscript" button (line 278) and the Enter-in-replace-input handler (lines 159-165, post-I10 fix) both guard on `replacement.length > 0`. The per-chapter "Replace All in Chapter" button has no such guard.
- **Impact:** A single click silently deletes every match in the chapter; no confirmation, no rollback beyond the auto-snapshot.
- **Suggested fix:** Add `disabled={!hasReplacement}` (and the analogous `aria-disabled`) to the chapter-scope button, matching the manuscript-scope button.
- **Confidence:** High
- **Found by:** Error Handling

## Important Issues

### [I1] `handleReplaceOne` freezes `query`/`options` but uses live `findReplace.replacement`
- **File:** `packages/client/src/pages/EditorPage.tsx:283`
- **Bug:** I2's fix froze `resultsQuery`/`resultsOptions` at search time, but `replacement` was not included in the snapshot. A per-match Replace click while the user is still typing in the Replace input sends the newest keystrokes as the replacement.
- **Impact:** Off-by-one-keystroke wrong text written to chapter; same class of bug as I2.
- **Suggested fix:** Snapshot `replacement` into `useFindReplaceState.search` alongside `resultsQuery`/`resultsOptions` and read it in `handleReplaceOne`.
- **Confidence:** High
- **Found by:** Concurrency, Logic

### [I2] `replaceInDoc` regex-mode replacement silently drops for lookaround patterns
- **File:** `packages/shared/src/tiptap-text.ts:332-335`
- **Bug:** For each selected match, replacement runs as `flat.slice(mp.start, mp.end).replace(buildRegex(query, opts), effectiveReplacement)`. With regex mode and a lookbehind/lookahead (e.g., `(?<=foo)bar`), the sliced matchStr lacks the outer context, so `.replace` returns it unchanged. `totalCount` has already been incremented — server reports a success count that overstates actual changes.
- **Impact:** Users get false "N replaced" counts with unchanged content. On subsequent save, unchanged text is persisted as "post-replace."
- **Suggested fix:** Don't re-run the regex on a sliced fragment. Either expand replacement in one pass over `flat` (regex replace there and splice by offsets), or capture `m[0]` at match time and expand `$n` backreferences explicitly.
- **Confidence:** Medium-High
- **Found by:** Logic

### [I3] `replaceInDoc` / `searchInDoc` build unbounded match arrays before the cap
- **File:** `packages/shared/src/tiptap-text.ts:247-256, 305-310`; `packages/server/src/search/search.service.ts:96-103, 193-195`
- **Bug:** The `while ((m = re.exec(flat)))` loops have no internal ceiling. The service checks `MAX_MATCHES_PER_REQUEST` only after each chapter returns its full `matches[]` / `allPositions[]`. A single large chapter with `.*` or a prolific pattern fully materializes before the cap triggers a rollback.
- **Impact:** Event-loop stall and memory spikes under adversarial or accidental patterns; the "catastrophic" path is not bounded.
- **Suggested fix:** Push the cap inside the walker: throw `MatchCapExceededError` as soon as `matches.length` (plus any running total across chapters) exceeds the cap. Service catches and converts to `validationError`.
- **Confidence:** High
- **Found by:** Error Handling, Security

### [I4] `assertSafeRegexPattern` heuristic misses common ReDoS shapes
- **File:** `packages/shared/src/tiptap-text.ts:143-151`
- **Bug:** The check is a single regex `/\([^()]*[+*?][^()]*\)\s*[+*?{]/`. `[^()]*` cannot span nested parens, so `((a+))+`, `(a|a)+`, `(a|ab)*b`, `(?:(x+))+` all pass. Combined with I3 (unbounded loop) and no execution timeout, a crafted pattern hangs the Node event loop.
- **Impact:** Self-DoS on a single-user app: the writer freezes their own editor. Auto-saves queued behind the request also stall.
- **Suggested fix:** Keep the heuristic as a cheap pre-filter but do not rely on it. Add a real execution time budget — either run regex evaluation in a worker thread with a wall-clock timeout, or swap to `re2`/`node-re2` for linear-time semantics.
- **Confidence:** High
- **Found by:** Security, Error Handling

### [I5] `restoreSnapshot` does not structurally validate snapshot content
- **File:** `packages/server/src/snapshots/snapshots.service.ts:75-79`
- **Bug:** `JSON.parse` succeeds on any valid JSON (`{"foo":1}`, `[]`, `42`). The code accepts these, calls `countWords(parsed)` which returns 0, and writes the non-doc content to the chapter.
- **Impact:** Chapter becomes unrenderable by TipTap; user sees a blank or error state with no clear recovery.
- **Suggested fix:** Assert `parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.type === "doc" && Array.isArray(parsed.content)`; return the existing `CORRUPT_SNAPSHOT` 422 on mismatch.
- **Confidence:** High
- **Found by:** Error Handling

### [I6] Match-cap-exceeded is indistinguishable from invalid-regex on the client
- **File:** `packages/server/src/search/search.service.ts:99-103, 193-194`; `packages/client/src/hooks/useFindReplaceState.ts:111-112`
- **Bug:** Both errors surface as 400 `VALIDATION_ERROR`. The client maps any 400 to `S.invalidRegex`. A user searching for a literal word with too many matches sees "Invalid regex".
- **Impact:** Misleading error message that hides actionable information.
- **Suggested fix:** Add a distinct server error code (e.g., `MATCH_CAP_EXCEEDED`) and branch on it in the hook to display the server's human message.
- **Confidence:** High
- **Found by:** Logic

### [I7] `skipped_chapter_ids` returned by server but never surfaced in UI
- **File:** `packages/server/src/search/search.service.ts:112`; `packages/client/src/components/FindReplacePanel.tsx`
- **Bug:** The replace pipeline populates `skipped_chapter_ids` for chapters with unparseable JSON, but the panel never reads it. Writers see "Replaced N" with no signal that some chapters were skipped.
- **Impact:** Silent omission; user believes a global replace covered the project when it did not.
- **Suggested fix:** Render a warning strip when `skipped_chapter_ids?.length > 0`, ideally listing the skipped chapter titles.
- **Confidence:** High
- **Found by:** Logic, Error Handling

### [I8] SnapshotPanel silently swallows `onBeforeCreate` failure
- **File:** `packages/client/src/components/SnapshotPanel.tsx:138-141`
- **Bug:** When `onBeforeCreate` returns false (the editor flush failed), `handleCreate` returns with no error state, no aria-live announcement, no visual feedback.
- **Impact:** User clicks "Create snapshot," sees nothing happen, assumes it worked.
- **Suggested fix:** Set a local error state or have `onBeforeCreate` throw with a typed reason. Render an aria-live error inside the panel.
- **Confidence:** Medium-High
- **Found by:** Logic, Error Handling

### [I9] Validation regex compiles without `u` flag / `whole_word` wrapper
- **File:** `packages/server/src/search/search.service.ts:57`
- **Bug:** Upfront validation does `new RegExp(pattern)` (no flags). The effective regex used at search time is `buildRegex` with `"gu"`/`"giu"` flags and a lookbehind/lookahead wrapper for whole-word. Patterns valid without `u` but invalid with `u` (or broken by the wrapper) pass validation and then throw 500 at search time.
- **Impact:** 500 instead of 400; potential stack leak through the error handler.
- **Suggested fix:** In validation, compile via the same `buildRegex` that will run, or call `buildRegex` inside a try/catch and bubble the same `validationError`.
- **Confidence:** Medium-High
- **Found by:** Security

### [I10] `SnapshotPanel.fetchSnapshots` imperative path lacks chapter-seq guard
- **File:** `packages/client/src/components/SnapshotPanel.tsx:63-71`
- **Bug:** The chapter-change effect (`:76-90`) uses a local `cancelled` flag, and `useSnapshotState`'s own fetch uses `chapterSeqRef`. But `fetchSnapshots`, invoked via `snapshotPanelRef.current?.refreshSnapshots()` after replace/restore, has no seq guard — the chapter captured in closure is trusted on resolution.
- **Impact:** On rapid chapter switch after a replace/restore, a late list response can clobber the newer chapter's snapshot list.
- **Suggested fix:** Thread a `chapterSeqRef` through SnapshotPanel, bump on chapter change, compare in `fetchSnapshots`' resolution.
- **Confidence:** Medium
- **Found by:** Concurrency, Logic

## Suggestions

- **[S1]** `viewingSnapshot` not cleared on chapter switch (`packages/client/src/hooks/useSnapshotState.ts:47-60`) — snapshot banner can linger from prior chapter.
- **[S2]** `cancelPendingSaves()` is called after `flushSave()` in replace/restore/snapshot flows (`EditorPage.tsx:157-164, 192-197, 273-278`). A retry scheduled mid-flush can fire in the microtask gap. Reverse the order.
- **[S3]** `canonicalContentHash` doesn't sort `marks` arrays; TipTap usually normalizes order, but semantically equal snapshots may still hash differently (`packages/server/src/snapshots/content-hash.ts:8-17`).
- **[S4]** `canonicalContentHash` falls back to raw-string on parse failure with no `console.warn` — diagnosing corrupt content is harder (`:25-30`).
- **[S5]** `truncateForLabel` can emit empty strings for all-control-char input (`packages/server/src/search/search.service.ts:22-41`).
- **[S6]** `applyImageRefDiff` is passed raw `chapter.content` without parse guard during restore; corrupt current content throws and blocks restore (`snapshots.service.ts:115`).
- **[S7]** `ReplaceSchema` remains inline in `search.routes.ts:26-41` instead of `packages/shared/src/schemas.ts` (prior S3).
- **[S8]** `SearchOptions` shape duplicated across `tiptap-text.ts`, `search.routes.ts` (Zod), `api/client.ts`, `useFindReplaceState.ts` (as `SearchOptionsShape` with *required* booleans vs shared's optional), and `FindReplacePanel.tsx` (prior S2, partial).
- **[S9]** Replace response shape `{replaced_count, affected_chapter_ids, skipped_chapter_ids?}` inlined in both `search.service.ts` and `api/client.ts` — no shared type.
- **[S10]** `CreateSnapshotData = SnapshotRow` conflates insertable-row and wire-row; `is_auto` boolean↔int repo-boundary translation is hidden (prior S7).
- **[S11]** Three independent TipTap walkers (`tiptap-text.ts::collectLeafBlocks`, `wordcount.ts::extractText`, `images/images.references.ts::walk`) — drift risk (prior S4).
- **[S12]** `CONTEXT_RADIUS = 40` duplicated in `tiptap-text.ts:168` (inline literal) and `FindReplacePanel.tsx:29` — drift misaligns highlights silently (prior S1).
- **[S13]** Chapter switch triggers two redundant snapshot list fetches (`useSnapshotState.ts:47` + `:132`). Wasted request.
- **[S14]** `truncateForLabel` bounds each side to 30 graphemes but not the concatenated label.

## Plan Alignment

**Plan docs consulted:**
- `docs/plans/2026-04-16-snapshots-find-replace-design.md`
- `docs/plans/2026-04-16-snapshots-find-replace-plan.md`

**Implemented:** Snapshots migration/types/schemas, repository, service (with canonical dedup guard, restore auto-snapshot, image-ref diff, word-count recalc), routes with uniform `{duplicate, snapshot}` response shape, SnapshotPanel/Banner, `useSnapshotState` with chapter-seq guard, keyboard shortcuts (Ctrl+S intercept, Ctrl+H), toolbar entries, snapshots & find-replace e2e suites. Find-and-replace shared text walker, search service (scoped project/chapter) with ReDoS pre-filter, match cap, Unicode-aware boundaries, replace service with auto-snapshots, routes with required `scope`, `useFindReplaceState` with search-seq guard, `FindReplacePanel`, confirmation dialog.

**Not yet implemented:** Task 20 (final coverage + cleanup) still has the duplication residue (S7–S12) open.

**Deviations (neutral — documented intent):**
- Replace-one uses server-side `match_index` rather than client-side TipTap replace. Intentional, but I1 (replacement freeze) is the residual correctness gap.
- Chapter→snapshot cascade via FK `ON DELETE CASCADE` rather than explicit purge path. Depends on `PRAGMA foreign_keys = ON` at all runtime/test contexts.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security (Plan Alignment folded into Logic/Contract)
- **Scope:** Current HEAD (`f8d1113`) with focus on delta since the 767d2a0 review; priority files re-read: `tiptap-text.ts`, `search.service.ts`, `search.routes.ts`, `snapshots.service.ts`, `snapshots.repository.ts`, `snapshots.routes.ts`, `content-hash.ts`, `useFindReplaceState.ts`, `useSnapshotState.ts`, `useProjectEditor.ts`, `EditorPage.tsx`, `FindReplacePanel.tsx`, `SnapshotPanel.tsx`, `api/client.ts`, shared types/schemas/index, migration 014.
- **Raw findings:** 35
- **Verified findings:** 26 (2 Critical, 10 Important, 14 Suggestion)
- **Filtered out:** 1 rejected (soft-deleted project race on replace — not branch-specific, low confidence). Remaining merged into overlapping entries.
- **Steering files consulted:** `CLAUDE.md`
- **Plan/design docs consulted:** `docs/plans/2026-04-16-snapshots-find-replace-design.md`, `docs/plans/2026-04-16-snapshots-find-replace-plan.md`
- **Prior review consulted:** `paad/code-reviews/ovid-snapshots-find-and-replace-2026-04-17-11-43-59-767d2a0.md` (fixes for C2, C3, I1, I3, I4, I5, I7, I8, I9, I10, I12, I13, I14, I15 verified; C1 partial, I2 partial, I6 partial; I11 partial)
