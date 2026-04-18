# Agentic Code Review: ovid/snapshots-find-and-replace

**Date:** 2026-04-18 16:10:05
**Branch:** ovid/snapshots-find-and-replace → main
**Commit:** 65a72e22c291273a263597c9dec4c7c2a3d64722
**Files changed:** 88 | **Lines changed:** +14057 / -152
**Diff size category:** Large

## Executive Summary

Tenth PAAD review on a branch that adds chapter snapshots and project-wide find-and-replace. Prior nine rounds have already closed most race, validation, and contract issues; the branch is in cleanup/hardening mode. This pass surfaces one **Critical** data-loss race — typing during an in-flight replace can silently undo the replacement via the Editor's unmount-save path — plus five **Important** issues (one cross-project cache wipe, one asymmetric cache-clear, one UI state leak between chapters, one surrogate-split in the auto-restore snapshot label, and a missing in-flight guard on replace). The rest are suggestions: mostly shared-helper consolidations and code-hygiene items the team can sweep in a follow-up.

## Critical Issues

### [C1] Typing during in-flight replace can undo the replacement via unmount save
- **File:** `packages/client/src/components/Editor.tsx:144-158` (unmount effect), interacting with `packages/client/src/pages/EditorPage.tsx:251-264` (`executeReplace`) and `:372-396` (`handleReplaceOne`)
- **Bug:** `executeReplace`/`handleReplaceOne` call `editorRef.current?.markClean()` and `cancelPendingSaves()` *before* awaiting `api.search.replace(...)`. Comments at lines 232-236 / 369-371 explicitly state markClean is there to stop the unmount cleanup from PATCHing pre-replace content. But the Editor remains editable for the entire round trip. If the user types anywhere during the in-flight replace, `onUpdate` at `Editor.tsx:169` sets `dirtyRef.current = true`. When the response arrives and `reloadActiveChapter()` bumps `chapterReloadKey`, the Editor unmounts; its cleanup at `Editor.tsx:150-156` sees `dirtyRef=true` and fires a fire-and-forget PATCH with `getJSON()` — which is the *pre-replace* content plus the user's keystrokes, sent AFTER the replace committed. The replacement is silently reverted on the server.
- **Impact:** Data loss on the core save-trust promise flow. Any user who types during replace-all gets their replacement undone without any error surface. Likelihood is high for project-wide replaces that take 1-2s; hardest to reproduce manually but automation hits it consistently.
- **Suggested fix:** Disable the editor for the duration of the replace round trip — e.g., `editor.setEditable(false)` inside the `try`, restored in a `finally`. Alternatively, in the unmount save guard, only fire if `latestSentContent !== getJSON()` — but the editability gate is simpler and matches the user's mental model (replace is a "busy" operation).
- **Confidence:** High
- **Found by:** Concurrency

## Important Issues

### [I1] `handleReplaceOne` clears the target chapter's cache AFTER the replace, not before
- **File:** `packages/client/src/pages/EditorPage.tsx:392`
- **Bug:** `executeReplace` clears the localStorage draft cache on lines 246/248 *before* the replace request — the comment at 238-244 spells out the reason: "a chapter switch during the in-flight replace would read a pre-replace draft from localStorage and autosave it over the server's replaced content." `handleReplaceOne` does the opposite: it awaits the replace at line 373, then only calls `clearCachedContent(chapterId)` at line 392. For a chapter-scoped replace-one targeting a non-active chapter, if the user switches to that chapter mid-flight via the sidebar, `useProjectEditor.handleSelectChapter` reads `getCachedContent(chapterId)` — yielding the pre-replace draft — and the editor's auto-save PATCHes it over the server's replaced content.
- **Impact:** Same class of data-loss as C1, narrower trigger: requires the replace-one target to be a different chapter than the active one AND a sidebar click during the ~300-1000 ms replace window.
- **Suggested fix:** Move `clearCachedContent(chapterId)` to before the `api.search.replace` call, matching `executeReplace`.
- **Confidence:** High
- **Found by:** Logic-Client, Concurrency

### [I2] `clearAllCachedContent` wipes drafts for OTHER projects in other tabs
- **File:** `packages/client/src/hooks/useContentCache.ts:38-49`, called from `EditorPage.tsx:246`
- **Bug:** The draft cache uses a flat key namespace `smudge:draft:<chapterId>`. When a project-wide replace-all runs in project A, `clearAllCachedContent` iterates `localStorage` and removes every `smudge:draft:*` key — including drafts for project B currently in use in another tab. The other tab has no storage event listener; its in-memory editor will eventually auto-save and repopulate its own key, but until that save fires any unsaved keystrokes are unrecoverable across a browser crash. This was already flagged as S9 in the 2026-04-17 review round and is still open.
- **Impact:** Multi-tab users who run replace-all in one project can silently lose unsaved edits in a different project's tab if the browser crashes before the next autosave completes.
- **Suggested fix:** Key the cache by `smudge:draft:<projectSlug>:<chapterId>` (or `<projectId>:<chapterId>`) and narrow `clearAllCachedContent` to the prefix of the acting project. Update `getCachedContent`/`setCachedContent` callers in `useProjectEditor` and tests.
- **Confidence:** High
- **Found by:** Concurrency

### [I3] `SnapshotPanel` does not clear `viewError` on chapter or open/close transition
- **File:** `packages/client/src/components/SnapshotPanel.tsx:147-158`
- **Bug:** The conditional reset block at lines 149-158 (triggered when `resetKey = "${chapterId}:${isOpen}"` changes) clears `showCreateForm`, `createLabel`, `duplicateMessage`, `createError`, `confirmDeleteId`, `deleteError`, and `listError` — but not `viewError`. Result: a user clicks View, it fails with "snapshot not found"; they close the panel, open it for a different chapter; the red alert banner for the previous View error is still displayed and incorrectly attributed to the new chapter's snapshots.
- **Impact:** Wrong UI state; user sees an error banner pointing at a snapshot they're not looking at.
- **Suggested fix:** Add `setViewError(null);` to the reset block at line 157.
- **Confidence:** High
- **Found by:** Logic-Client

### [I4] Auto-restore snapshot label: grapheme truncate + code-unit slice can split a surrogate pair
- **File:** `packages/server/src/snapshots/snapshots.service.ts:163-167`
- **Bug:** The label for the auto-pre-restore snapshot is built as `truncateGraphemes(snapshot.label, 450)` embedded in a template, then the whole thing is passed through `sanitizeSnapshotLabel(...).slice(0, 500)`. `truncateGraphemes` caps at 450 **graphemes**, which in UTF-16 can be well over 500 code units for emoji, CJK with combining marks, or complex ZWJ sequences. The final code-unit-based `.slice(0, 500)` then happily splits a surrogate pair, storing a lone surrogate in the DB and returning it to the client.
- **Impact:** Stored corrupt-UTF-16 label; breaks round-trip through any component that re-encodes to UTF-8 (e.g., JSON.stringify on a lone surrogate emits `\udXXX`; some downstream consumers may throw). Same class of bug exists at `packages/server/src/search/search.service.ts:289` for the replace auto-label, though the window is narrower there (search/replace capped at 30 graphemes each).
- **Suggested fix:** Use `truncateGraphemes(raw, 500)` after sanitize in both places instead of `.slice(0, 500)`. Lower the internal embedded cap so the final result stays well under 500 code units even with wide graphemes (or share a single `clampLabel` helper — see S6).
- **Confidence:** High
- **Found by:** Logic-Server

### [I5] No in-flight guard on replace handlers — overlapping replace requests possible
- **File:** `packages/client/src/pages/EditorPage.tsx:217-299` (`executeReplace`) and `:354-420` (`handleReplaceOne`)
- **Bug:** Neither `executeReplace` nor `handleReplaceOne` checks whether a replace is already in flight. The confirm dialog blocks a rapid double-confirm for the all/chapter paths, but `handleReplaceOne` has no dialog and fires directly on button click; click-storming or an accidental double-tap launches N overlapping requests. Each creates its own auto-snapshot on the server, each triggers its own `reloadActiveChapter()` and `findReplace.search()` on the client. The responses can resolve out of order, interacting with the C1 edit window and producing undefined state ordering in `actionInfo`/`actionError`.
- **Impact:** Duplicate auto-snapshots on the server (user sees N "Before Replace foo→bar" entries for one intended replace); unpredictable UI state; magnifies the C1 race surface.
- **Suggested fix:** Add a `replaceInFlightRef` guard that early-returns on re-entry; disable the replace buttons while the ref is true.
- **Confidence:** Medium-High
- **Found by:** Concurrency

## Suggestions

- **[S1]** `packages/shared/src/tiptap-text.ts:379` — per-chapter match cap uses `>= MAX_MATCHES_PER_REQUEST` (throws at exactly 10000) while service aggregate `search.service.ts:170` uses strict `>`. Error message references `>10000`. Align to one bound.
- **[S2]** `packages/shared/src/schemas.ts:172-180` — `CreateSnapshotSchema` accepts empty-string labels post-sanitize; service at `snapshots.service.ts:41` coerces to null. Reject empty in the schema or document the coercion.
- **[S3]** `packages/server/src/snapshots/snapshots.service.ts:93` — `restoreSnapshot` reads the snapshot row outside the transaction. A concurrent `deleteSnapshot` can land between read and tx; restore still proceeds with the stale content. Re-read inside the tx, or document that snapshot metadata is not tx-consistent.
- **[S4]** `packages/client/src/hooks/useProjectEditor.ts:190-208` — `handleSelectChapter` bumps `saveSeqRef` but does not `saveAbortRef.current?.abort()`. In-flight PATCH for chapter A runs to completion on the server after a switch. Client discards via seq check, but the server write is wasted and racy with subsequent operations on chapter A.
- **[S5]** `packages/client/src/components/SnapshotPanel.tsx:41` — `onView` prop's `reason` typed as `string` instead of `"not_found" | "corrupt_snapshot" | "save_failed" | "network" | "unknown"`. Caller compares against sentinels; a rename on either side drifts silently.
- **[S6]** `packages/client/src/utils/findReplaceErrors.ts:27-33` — 404 with codes `NOT_FOUND` (project gone) and `SCOPE_NOT_FOUND` (chapter gone) both map to `replaceScopeNotFound`. Branch on code and use distinct strings.
- **[S7]** `packages/server/src/images/images.references.ts:113-128` — added-ref path warns on missing/cross-project; removed-ref path silently skips with no log. Symmetric warn aids ref-count drift diagnostics.
- **[S8]** `packages/client/src/components/FindReplacePanel.tsx:158-167` — Enter in the replace input is silently ignored when `replacement === ""`; the button is also disabled but the keyboard path has no feedback. Either accept empty (delete-matches semantics) or announce via aria-live why nothing happened.
- **[S9]** Inline `SearchOptions` shape `{ case_sensitive, whole_word, regex }` duplicated across `packages/client/src/api/client.ts`, `packages/server/src/search/search.service.ts`, `packages/client/src/pages/EditorPage.tsx`, `packages/client/src/components/FindReplacePanel.tsx` — `@smudge/shared` already exports `SearchOptions` at `packages/shared/src/tiptap-text.ts:25`. Import it.
- **[S10]** Two canonical-JSON implementations: `packages/server/src/snapshots/content-hash.ts:18-28` (`canonicalize`, depth-guarded) and `packages/shared/src/tiptap-text.ts:289-295` (`canonicalJSON`, no guard). Drift between them would cause snapshot dedup to disagree with mark-equality comparisons. Consolidate to one shared helper.
- **[S11]** Error-code discriminator duplicated: `packages/client/src/hooks/useFindReplaceState.ts:140-144` (search strings) vs `packages/client/src/utils/findReplaceErrors.ts:11-35` (replace strings). Parameterize `mapReplaceErrorToMessage` with a STRINGS bundle and share.
- **[S12]** `packages/client/src/pages/EditorPage.tsx:217-420` — `executeReplace` and `handleReplaceOne` share a long flushSave → cancel → markClean → replace → reload → refresh flow. Extract into a single `runReplace(scope, replacement, { clearCache, successMessage })` helper.
- **[S13]** `packages/server/src/snapshots/snapshots.service.ts:41` — `label?.trim() || null` re-trims a label that `CreateSnapshotSchema` (at `shared/src/schemas.ts:177`) already sanitized + trimmed. Pick one source of truth.
- **[S14]** Pattern `sanitize + .slice(0, 500)` repeated at three sites: `shared/src/schemas.ts:177` (Zod `.max(500)` — throws on overflow), `server/src/snapshots/snapshots.service.ts:167` (silent clamp), `server/src/search/search.service.ts:289` (silent clamp). Inconsistent enforcement for the same column invariant.
- **[S15]** `500` (snapshot label max chars) appears as a magic number in at least four places (3 above + design doc). Extract `SNAPSHOT_LABEL_MAX_CHARS` to `packages/shared/src/constants.ts` mirroring how `MAX_CHAPTER_CONTENT_BYTES` was centralized.
- **[S16]** `packages/client/src/components/Editor.tsx:126,133-142` — `beforeunload` guard: `dirtyRef` is cleared inside `debouncedSave` finally regardless of whether the user has typed during the in-flight save. Narrow window where a tab-close between save-resolve and the next keystroke bypasses the warning. Only clear dirty when `latestContent === postedContent`.
- **[S17]** `packages/server/src/search/search.service.ts:267-307` — `expandReplacement` with `$'` / `` $` `` / `$&` amplifies memory per-match; `MAX_CHAPTER_CONTENT_BYTES` is only checked AFTER `JSON.stringify(newDoc)`. Peak memory can reach ~match_count × chapter_size before the cap rejects. Bounded by match cap × chapter size, not unbounded, but consider rejecting `$'` / `` $` `` upfront or running a running-size estimate during the per-match loop.
- **[S18]** `packages/shared/src/tiptap-text.ts:278-282` + `FindReplacePanel.tsx:40-45` — `SearchMatch.context` returns the raw 80-code-unit slice without sanitizing bidi overrides (U+202A..U+202E, U+2066..U+2069) or zero-width chars. Renders into the match list unescaped. In a single-user local app this only lets the user spoof their own UI, but the codebase already ships the right filter (`sanitizeSnapshotLabel`) for the same class of vector on labels. Apply a display-time sanitizer to `context`.

## Plan Alignment

Plan/design docs: `docs/plans/2026-04-16-snapshots-find-replace-design.md`, `docs/plans/2026-04-16-snapshots-find-replace-plan.md`.

### Implemented
- Migration 014 `chapter_snapshots` with `ON DELETE CASCADE` (small enhancement beyond plan).
- Full snapshot domain: `snapshots.types`, `snapshots.repository`, `snapshots.service`, `snapshots.routes`, `content-hash` with depth-capped canonicalization.
- All five planned endpoints with dedup, auto-pre-restore snapshots, image-ref diff on restore, word-count recalc, transactional atomicity.
- Server search/replace services with Zod validation, project/chapter scoping, auto-pre-replace snapshots, image-ref adjustment, match cap, regex deadline, ReDoS heuristic.
- Shared TipTap text walker in `tiptap-text.ts` with search/replace, mark preservation, capture-group expansion, hardBreak preservation, Unicode-aware regex.
- Client hooks and components: `useSnapshotState`, `useFindReplaceState`, `SnapshotPanel`, `SnapshotBanner`, `FindReplacePanel` with toggles, debounce, aria-live, per-match/per-chapter/per-manuscript replace, confirmation dialog, Enter-to-replace-all.
- Ctrl/Cmd+S interception, Ctrl+H to open find panel.
- Coverage & cleanup pass (S1, S8, S14, S15, CP2, CP3 and batch S2/S3/S6/S12/S13/S17 from prior review rounds landed in recent commits).

### Not yet implemented
- Optional "Already saved" Ctrl+S flash on clean state (plan marked optional).
- aXe audit assertions inside `e2e/snapshots.spec.ts` / `e2e/find-replace.spec.ts` — specs cover functional flow but do not appear to invoke the aXe audit step the plan required.
- Plan Task 6 specified an explicit `deleteSnapshotsByChapter` call in purge; implementation uses FK `ON DELETE CASCADE`. Functionally equivalent, but intentionally diverges from the worded plan step.

### Deviations (carried over from prior review rounds)
- Endpoint paths use `:slug`, not `:id`: `packages/server/src/search/search.routes.ts:64,109`. Design §93/§120 says `:id`. Prior review tagged as S10 — still unresolved. Decide: update doc or route.
- `SearchMatch` shape exposes `{ blockIndex, offset, length, context }`; design §108-113 specifies `{ position: { node_path, offset } }`. Prior review S11. Unchanged.
- Snapshot `POST` uses unified response shape rather than the plan's 200-with-message vs 201-with-snapshot split. Client handles both; external clients would need to adapt. Not a correctness issue.

## Review Metadata

- **Agents dispatched:** Logic-Server, Logic-Client, ErrorHandling, Contract & Integration, Concurrency & State, Security, Plan Alignment (7 parallel specialists + 1 Verifier)
- **Scope:** All source files under `packages/{shared,server,client}/src/` changed on this branch + design/plan docs + prior review reports
- **Raw findings:** 40 (across 7 specialists, before dedup)
- **Verified findings:** 24 (1 Critical, 5 Important, 18 Suggestions) + plan-alignment section
- **Filtered out:** 16 (intentional design behavior, already-guarded, already-fixed, or unreproducible)
- **Steering files consulted:** `CLAUDE.md`
- **Plan/design docs consulted:** `docs/plans/2026-04-16-snapshots-find-replace-design.md`, `docs/plans/2026-04-16-snapshots-find-replace-plan.md`, `docs/TODO.md`, `docs/roadmap.md`
- **Prior reviews on this branch:** 9 (under `paad/code-reviews/ovid-snapshots-find-and-replace-*`)
