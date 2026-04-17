# Agentic Code Review: ovid/snapshots-find-and-replace

**Date:** 2026-04-17 10:27:01
**Branch:** `ovid/snapshots-find-and-replace` → `main`
**Commit:** 8d95766654af82f58b64e9802c88b10f4f75c28a
**Files changed:** 61 | **Lines changed:** +8771 / -83
**Diff size category:** Large

## Executive Summary

Big, well-tested feature branch (snapshots + project-wide find-and-replace). The tooling around it is thorough — Zod schemas, integration tests, e2e tests, DOMPurify, parameter-bound SQL — but three critical issues will silently corrupt manuscript content under ordinary use: the per-match "Replace" button actually runs a chapter-wide replace-all (mismatched UI/server contract), `replaceInProject` never checks that the scoped `chapter_id` belongs to the project in the URL, and `String.prototype.replace` interprets `$&`, `$1`, etc. in user replacement text even in literal mode. Secondary issues cluster around client/server race windows (flush vs. reload vs. typing), missing velocity updates on replace/restore, and a scattering of focus-management and UI-contract gaps.

## Critical Issues

### [C1] Per-match "Replace" button actually replaces every match in the chapter
- **File:** `packages/client/src/pages/EditorPage.tsx:162-180`, `packages/server/src/search/search.service.ts:70-78,83-130`, `packages/client/src/components/FindReplacePanel.tsx:237-243`
- **Bug:** The per-result "Replace" button calls `api.search.replace(slug, query, replacement, options, { type: "chapter", chapter_id })`. The server's `replaceInProject` with a chapter scope runs `replaceInDoc` over the chapter's entire content — it has no match-index parameter. The handler binds the match index as `_matchIndex` (unused). Clicking "Replace" on one occurrence silently rewrites every other matching occurrence in that chapter.
- **Impact:** Silent data corruption from a misleading action. The "Replace All in Chapter" button becomes redundant with the per-row "Replace" button. The e2e test comment at `e2e/find-replace.spec.ts` even acknowledges the discrepancy. User trust in the feature is on the line — "Replace" is a destructive verb that users will click with the expectation of touching one occurrence.
- **Suggested fix:** Either (a) extend the API with a `match_index` (or offset/length) field and have `replaceInDoc` honor it to rewrite only that occurrence, or (b) remove the per-row "Replace" button entirely and rely on "Replace All in Chapter" / "Replace All in Manuscript", or (c) at minimum relabel the button and its `aria-label` to "Replace all here" so the user knows what they're invoking.
- **Confidence:** High
- **Found by:** Plan Alignment, Frontend Logic, Contract & Integration

### [C2] `replaceInProject` chapter scope accepts chapter from a different project
- **File:** `packages/server/src/search/search.service.ts:70-78,126`
- **Bug:** `POST /api/projects/:slug/replace` with `scope: { type: "chapter", chapter_id }` resolves the slug to a project id, but `findChapterByIdRaw(scope.chapter_id)` never verifies that `chapter.project_id === projectId`. Any chapter UUID is accepted, content is mutated, an auto-snapshot is created against that chapter, and `updateProjectTimestamp(projectId, now)` then bumps the **wrong** project's `updated_at`.
- **Impact:** Cross-project data-integrity violation even in the single-user model. A stale client tab or buggy caller corrupts a different project's chapter and falsely timestamps the project from the URL. Velocity bookkeeping, trash semantics, and any future multi-user story all compound here. Easy to exploit accidentally by keeping two projects open.
- **Suggested fix:** After loading the chapter, assert `chapter.project_id === projectId`; return `{ replaced_count: 0, affected_chapter_ids: [] }` or a `VALIDATION_ERROR` envelope if mismatched. Apply the same guard either at the route or in the service.
- **Confidence:** High
- **Found by:** Security, Backend Logic, Contract & Integration

### [C3] `$` in replacement text is interpreted as regex replacement patterns in literal mode
- **File:** `packages/shared/src/tiptap-text.ts:221`
- **Bug:** `matchStr.replace(buildRegex(query, opts), replacement)` passes the user-provided `replacement` string to regex-based `String.prototype.replace`, which always interprets `$&`, `$1`, `$2`, `$$`, `$'`, `` $` `` as replacement specials — regardless of whether the user ticked the `regex` option. Replacing "foo" → `$$bar` yields `$bar`; replacing "X" → `$&Y` yields `XY`; replacing "cost" → `$1 cents` yields ` cents` (empty backref).
- **Impact:** Silent corruption of the user's manuscript. Any legitimate text containing `$` — currency prices, shell snippets, LaTeX macros — becomes wrong text on replace, with no warning. No test currently covers this.
- **Suggested fix:** In literal mode, escape `$` in the replacement (`replacement.replace(/\$/g, "$$$$")`) before the `.replace()` call. Cleaner: pass a replacement *function* `() => replacement` so JavaScript never parses it. In regex mode, keep the current behavior (users expect capture groups) but document it in the UI near the regex toggle.
- **Confidence:** High
- **Found by:** Backend Logic, Error Handling, Security

## Important Issues

### [I1] `flushSave()` failures are swallowed; `reloadActiveChapter` then wipes the client cache
- **File:** `packages/client/src/components/Editor.tsx:137-150`, `packages/client/src/hooks/useProjectEditor.ts:165-186`, `packages/client/src/pages/EditorPage.tsx:124-152`
- **Bug:** `flushSave()` returns `Promise<void>` and catches its own errors internally. Callers (`executeReplace`, `handleRestoreSnapshot`) cannot distinguish flush-success from flush-failure. Then `reloadActiveChapter` unconditionally calls `clearCachedContent(current.id)` before fetching server content. If flushSave failed (network down, 500), the user's unsaved keystrokes are wiped from the client cache even though the server never received them — directly contradicting CLAUDE.md's contract "client-side cache holds unsaved content until server confirms".
- **Impact:** Silent data loss on restore and replace-all whenever saving is offline/flaky. The persistent "Unable to save" warning may still be visible but the content it promised to protect is gone.
- **Suggested fix:** Make `flushSave` return a boolean. If false, block the destructive operation and surface the existing save-error UX (or prompt "You have unsaved changes that could not be saved — continue anyway?"). Do not call `clearCachedContent()` when the pre-operation flush failed.
- **Confidence:** High
- **Found by:** Concurrency/State, Error Handling

### [I2] Snapshot create from panel does not flush pending auto-save first
- **File:** `packages/client/src/components/SnapshotPanel.tsx:121-136`
- **Bug:** `handleCreate` invokes `api.snapshots.create(chapterId, ...)` immediately with no `flushSave` call. A 1.5s-debounced pending save carrying the user's latest keystrokes has not yet committed to the DB, so the server captures stale content.
- **Impact:** The snapshot — the feature that exists precisely to preserve a known state — silently omits the last few seconds of edits. Actively misleading for the one feature whose value depends on fidelity.
- **Suggested fix:** Expose a `flushSave` callback from `EditorPage` to `SnapshotPanel` (analogous to how the panel already wires `onRestore`), and await it in `handleCreate` before POSTing. Or route snapshot creation through a page-level wrapper that calls `editorRef.current?.flushSave()` first.
- **Confidence:** High
- **Found by:** Concurrency/State

### [I3] Corrupt snapshot restore silently writes corrupt content into the chapter
- **File:** `packages/server/src/snapshots/snapshots.service.ts:87-99`
- **Bug:** If `JSON.parse(snapshot.content)` throws inside `restoreSnapshot`, `newParsed` is `null`, `newWordCount` becomes `0`, and the chapter is updated with `content: snapshot.content` (the corrupt string). `applyImageRefDiff` on `null` also can't decrement previously-referenced images, so image ref counts drift.
- **Impact:** One corrupt snapshot row permanently corrupts the chapter. The only user signal is an unusable chapter on next load. Contradicts the existing contract on `PATCH /api/chapters/{id}` ("rejects invalid JSON with 400 — preserves previous content").
- **Suggested fix:** If `JSON.parse` fails, abort the transaction with a distinguishable error (e.g., `CORRUPT_SNAPSHOT`) mapped by the route to 400/422. Do not overwrite the chapter with bad content.
- **Confidence:** High
- **Found by:** Backend Logic, Error Handling

### [I4] `executeReplace` captures stale `activeChapter` in its closure
- **File:** `packages/client/src/pages/EditorPage.tsx:134-152`
- **Bug:** The gate `if (activeChapter && result.affected_chapter_ids.includes(activeChapter.id))` uses the `activeChapter` captured when the callback was created, not the current one. `reloadActiveChapter` reads from `activeChapterRef.current` (the new chapter). If the user switches chapters between clicking "Replace All" and the response arriving, the gate checks the OLD id; when the NEW chapter was actually affected, reload is skipped and the editor shows pre-replace content for a chapter that the server has already rewritten.
- **Impact:** After reload, typing and saving will overwrite the replacement with the pre-replace text — the user silently loses the find-and-replace result on the new active chapter. Same pattern in `handleRestoreSnapshot` and `handleReplaceOne`.
- **Suggested fix:** Expose `activeChapterRef` (or pass a `getCurrentChapterId` callback) and gate on the CURRENT active id. Do the same in `handleReplaceOne` and `handleRestoreSnapshot`.
- **Confidence:** High
- **Found by:** Concurrency/State

### [I5] No input-size or match-count cap; regex mode trivially DOSes the server
- **File:** `packages/server/src/search/search.routes.ts:15-31`, `packages/server/src/app.ts:40`, `packages/server/src/search/search.service.ts:80-130`
- **Bug:** `SearchSchema`/`ReplaceSchema` enforce `z.string().min(1)` but no `.max()`. The global body limit is 5MB. `options.regex: true` compiles user input as `new RegExp(query, "gi")` and runs it against every chapter's flat text inside a single SQLite write transaction. A catastrophic-backtracking pattern like `(a+)+$` pins the Node event loop for seconds-to-minutes. There's no cap on the number of matches either — a one-character query against a book-sized manuscript allocates unbounded match arrays and holds the write lock while every chapter is re-stringified.
- **Impact:** Accidental self-DOS (still a single-user app), blocking auto-saves and causing the save retry loop to exhaust. Concurrent reads wait on the write lock.
- **Suggested fix:** Add `.max(1000)` (or similar) on `query`/`search`/`replace`. Enforce a server-side replacement cap (e.g., 10,000 matches) that aborts with `TOO_MANY_MATCHES`. Consider a smaller per-route body limit for these endpoints. For regex mode, reject patterns over some length or known-bad shapes, and/or precompute a total match count before starting the transaction.
- **Confidence:** High
- **Found by:** Security

### [I6] Regex validation is asymmetric: `searchProject` doesn't validate upfront
- **File:** `packages/server/src/search/search.service.ts` (searchProject ~11-42, replaceInProject ~54-60), `packages/server/src/search/search.routes.ts:71-83`
- **Bug:** `replaceInProject` validates regex upfront and returns a `{ validationError }` → 400. `searchProject` does not — `buildRegex` is called lazily inside `searchInDoc` per block, only if the block has non-empty flat text. If a project has no chapters or only empty content, an invalid regex silently returns 200 with zero matches. The route's fallback catch matches the V8-specific English substring "Invalid regular expression" — fragile across Node locales and future engine versions.
- **Impact:** Same invalid input behaves as "no results" on an empty project and "400 validation error" on a populated one. The client interprets silence as "no matches" rather than "broken query". Fragile i18n-style error classification.
- **Suggested fix:** Validate regex upfront in `searchProject` (mirror `replaceInProject`). Return a structured validation error the route maps to 400. Remove the English-substring check.
- **Confidence:** High
- **Found by:** Backend Logic, Error Handling, Contract & Integration

### [I7] Replace and restore do not update velocity / daily_snapshots
- **File:** `packages/server/src/search/search.service.ts` (replaceInProject), `packages/server/src/snapshots/snapshots.service.ts` (restoreSnapshot)
- **Bug:** Neither path calls `getVelocityService().recordSave(projectId)` or `updateDailySnapshot(projectId)`. `chapters.service.updateChapter` does. After a bulk replace or a restore, `chapters.word_count` changes without a corresponding entry in `daily_snapshots` — the velocity chart silently underreports (or overreports) a multi-chapter word-count swing.
- **Impact:** Writing-velocity is a documented feature of this app. A 5,000-word replace-to-empty won't show on the velocity chart. A restore can rewind progress without recording it.
- **Suggested fix:** After the transaction commits in both functions, call `getVelocityService().recordSave(projectId)` inside a try/catch (match the pattern in `chapters.service.ts`).
- **Confidence:** High
- **Found by:** Backend Logic, Contract & Integration

### [I8] Restore silently keeps broken image refs when a referenced image has been purged
- **File:** `packages/server/src/snapshots/snapshots.service.ts:103`, `packages/server/src/images/images.references.ts:55-87`, `packages/server/src/images/images.repository.ts:42-52`
- **Bug:** `applyImageRefDiff` loops `incrementImageReferenceCount(id, +1)` for newly-added refs. The repository implementation (`update().where("id", id)`) silently updates 0 rows when the image row no longer exists. A snapshot captured before an image was purged will, on restore, re-introduce an `<img src="/api/images/{uuid}">` pointing at a non-existent resource, with no warning.
- **Impact:** Broken-image icon in the restored chapter, no user-visible signal. Explicitly in-scope per the review prompt.
- **Suggested fix:** Check `findImageById` first; if missing, either (a) fail the restore with a specific code so the client can show "Snapshot references deleted images — restore aborted", (b) strip the image nodes before writing, or (c) include a `warnings: [...]` field in the response so the UI can surface which images are broken.
- **Confidence:** Medium
- **Found by:** Error Handling

### [I9] `highlightMatch` ignores `options.case_sensitive` and `options.regex`
- **File:** `packages/client/src/components/FindReplacePanel.tsx:25-48`
- **Bug:** `highlightMatch` unconditionally lowercases both sides of `indexOf(query.toLowerCase())`. When the user enables `case_sensitive`, the highlighter can still land on the wrong casing. When the user enables `regex`, the literal `indexOf` will usually fail to find the pattern string, so nothing is highlighted — making regex search appear broken.
- **Impact:** Visible UX bug in the two options the panel deliberately advertises. The server already returns per-match offsets; the client is ignoring them.
- **Suggested fix:** Drive the highlight from `match.offset`/`match.length` (already in `SearchMatch`) rather than string-searching the context. Fall back gracefully when offsets are absent.
- **Confidence:** High
- **Found by:** Frontend Logic, Contract & Integration, Error Handling

### [I10] Panel `triggerRef` is never passed; focus returns to `<body>` on close
- **File:** `packages/client/src/pages/EditorPage.tsx:637-663`, `packages/client/src/components/EditorToolbar.tsx`
- **Bug:** Both `SnapshotPanel` and `FindReplacePanel` accept an optional `triggerRef` prop for focus return (plumbed through their internals and unit-tested), but EditorPage mounts them without passing one, and the toolbar buttons don't expose refs. On Escape, focus falls back to `<body>`.
- **Impact:** WCAG 2.1 AA focus-management regression — CLAUDE.md calls accessibility a first-class constraint. Keyboard-only users lose their place after closing a panel.
- **Suggested fix:** Declare `useRef<HTMLButtonElement>(null)` for each trigger button, forward it from `EditorToolbar`, and pass it into the panels.
- **Confidence:** High
- **Found by:** Frontend Logic, Contract & Integration

### [I11] `useFindReplaceState.search` has no AbortController; slow responses can overwrite newer ones
- **File:** `packages/client/src/hooks/useFindReplaceState.ts:59-83`
- **Bug:** `search()` lacks both an `AbortController` and a sequence counter. A slow earlier response for "fo" can `setResults` after a newer response for "foob" has already landed, leaving the panel showing the old matches while the input shows the new query.
- **Impact:** The "Replace All in Chapter" and per-result Replace buttons operate on the current `query` + (stale) `results` view. Users can trigger a bulk replacement based on a match list that no longer corresponds to the query they see.
- **Suggested fix:** Add a monotonic `searchSeqRef` (mirror `saveSeqRef` in `useProjectEditor`), or switch to `AbortController`. Discard responses whose seq/signal doesn't match the latest.
- **Confidence:** High
- **Found by:** Concurrency/State, Error Handling

### [I12] Ctrl+S and Ctrl+H fire through open modals
- **File:** `packages/client/src/hooks/useKeyboardShortcuts.ts:86-107`
- **Bug:** The Ctrl+S (line 87-91) and Ctrl+H (line 94-98) handlers run BEFORE the dialog-open guard at lines 101-107. Every other shortcut (Ctrl+Shift+N, sidebar toggle, etc.) correctly short-circuits when a modal is open. During the replace-all confirmation dialog, Ctrl+H toggles the find panel behind the dialog; Ctrl+S fires a background flush the user cannot observe.
- **Impact:** State confusion around destructive operations. Closing the find panel underneath the confirm dialog produces exactly the stale-state scenario that the confirm dialog was added to avoid.
- **Suggested fix:** Move the Ctrl+S/Ctrl+H blocks below the modal-open guard. Keep only `e.preventDefault()` on Ctrl+S (to suppress the browser's save dialog) before the guard if desired, then early-return.
- **Confidence:** High
- **Found by:** Frontend Logic

### [I13] Snapshot restore failure produces no user-visible feedback
- **File:** `packages/client/src/hooks/useSnapshotState.ts:83-103`, `packages/client/src/pages/EditorPage.tsx:124-132`
- **Bug:** `restoreSnapshot` catches every error and returns `false`. `handleRestoreSnapshot` only acts on success (`if (ok) { reload... }`). On failure, the UI shows nothing — no toast, no banner, no error state.
- **Impact:** Silent failure of a destructive operation. User confirms "Restore" and sees no evidence of either success or failure.
- **Suggested fix:** Distinguish error types, surface them via the existing `ActionErrorBanner` or an inline banner. At minimum show "Unable to restore snapshot — try again" on any failure.
- **Confidence:** High
- **Found by:** Error Handling

### [I14] Replace-all confirm dialog reads live state — user can edit the query while the dialog is open
- **File:** `packages/client/src/pages/EditorPage.tsx:677-708`
- **Bug:** The `ConfirmDialog` body is rendered with live `findReplace.results.total_count`/`findReplace.query`/`findReplace.replacement`. The `FindReplacePanel` remains mounted and interactive behind the modal. On confirm, `executeReplace` reads `findReplace.query`/`.replacement`/`.options` live. The user can type in the panel while the dialog is open, making the confirmed sentence ("Replace 12 of 'cat' with 'dog'") not match what actually runs.
- **Impact:** Defeats the purpose of the confirmation safeguard for a destructive operation.
- **Suggested fix:** Snapshot `query`, `replacement`, `options`, and `results` into a `replaceConfirmation` state object the moment the user clicks "Replace All", and pass those frozen values into `executeReplace`. Or disable the panel inputs while the dialog is open.
- **Confidence:** High
- **Found by:** Error Handling

### [I15] Unused `deleteSnapshotsByChapter` store method; purge bypasses the store
- **File:** `packages/server/src/stores/project-store.types.ts:102`, `packages/server/src/stores/sqlite-project-store.ts:277`, `packages/server/src/db/purge.ts:21-27,58-63`
- **Bug:** `deleteSnapshotsByChapter` is declared on the `ProjectStore` interface and implemented in `SqliteProjectStore`, but is never called. `purge.ts` uses `trx("chapter_snapshots").whereIn(...).delete()` directly — bypassing the store abstraction that the project's layering (Routes → Services → Repositories) otherwise enforces.
- **Impact:** Dead method plus a store-abstraction leak. Future in-memory/fake stores would have to implement an unused method; anyone reading purge.ts can't see the snapshot-cleanup pattern in one place.
- **Suggested fix:** Either refactor `purge.ts` to call through the store (preferred), or remove the unused interface method and its impl.
- **Confidence:** High
- **Found by:** Contract & Integration

### [I16] Snapshot `word_count` is computed two different ways
- **File:** `packages/server/src/search/search.service.ts:110`, `packages/server/src/snapshots/snapshots.service.ts:32`
- **Bug:** `replaceInProject`'s auto-snapshot stores `word_count: countWords(parsed)` (recomputed from the just-parsed pre-replace JSON). `createSnapshot` stores `word_count: chapter.word_count` (the DB column). If a chapter's stored `word_count` ever diverges from a fresh recomputation (e.g., transient invariant break, future algorithm change), the two paths encode different truths into snapshot rows.
- **Impact:** Low-severity contract smell, but future debugging into word-count inconsistencies has to consider two paths instead of one.
- **Suggested fix:** Pick one convention. `chapter.word_count` is cheaper and consistent across all manual snapshots. Either route `replaceInProject` to use it (by having `listChapterContentByProject` return `word_count` too), or make `createSnapshot` recompute — but not both.
- **Confidence:** Medium
- **Found by:** Backend Logic, Contract & Integration

### [I17] `updateProjectTimestamp` is called once per affected chapter
- **File:** `packages/server/src/search/search.service.ts:126`
- **Bug:** Inside the per-chapter loop of `replaceInProject`, `updateProjectTimestamp(projectId, now)` fires once per affected chapter. For a manuscript-wide replace touching 50 chapters, that's 50 redundant UPDATE statements against `projects`.
- **Impact:** Mostly a minor performance issue inside the transaction; also a contract smell that future readers will find surprising.
- **Suggested fix:** Hoist the call out of the loop; fire it once after the loop when `affected_chapter_ids.length > 0`.
- **Confidence:** Medium
- **Found by:** Contract & Integration

### [I18] Snapshot view mode does not bump `saveSeqRef`; retries from earlier saves can still write
- **File:** `packages/client/src/hooks/useProjectEditor.ts:62-114`, `packages/client/src/hooks/useSnapshotState.ts:61-77`, `packages/client/src/components/Editor.tsx:137-150`
- **Bug:** `viewSnapshot` sets `viewingSnapshot` state but does not cancel in-flight debounced saves or retries. A retry scheduled before entering view mode (e.g., first save failed → 2s backoff → user clicks "View Snapshot" → retry fires) writes pre-view content to the server. Separately, the Editor's unmount effect fires a best-effort save when dirty — if the editor unmounts entering view mode, that save can race with a subsequent restore and overwrite the restored content.
- **Impact:** The "read-only while viewing a snapshot" invariant is not actually enforced; a save can land while the user believes they're safely inspecting history.
- **Suggested fix:** In `viewSnapshot`, call a `cancelPendingSaves()` helper exposed by `useProjectEditor` that bumps `saveSeqRef` and clears the debounce timer. Also explicitly clear `editorRef.current` when the editor unmounts so stale `flushSave` closures don't continue executing.
- **Confidence:** Medium
- **Found by:** Concurrency/State

## Suggestions

- **[S1]** `snapshots.service.ts:8-38` — dedup against auto-snapshots makes manual snapshot-as-marker silently no-op. Filter `getLatestSnapshotContentHash` by `is_auto=false`, or bypass dedup for manual intent. Found by Error Handling.
- **[S2]** `db/migrations/014_create_chapter_snapshots.js:4` — no `ON DELETE CASCADE` on `chapter_id`. Works today because `purge.ts` deletes snapshots first, but brittle for any future hard-delete path. Add `.onDelete("CASCADE")` in a follow-up migration. Found by Backend Logic, Error Handling, Contract, Concurrency.
- **[S3]** `snapshots.service.ts:15,67` — dead `|| chapter.deleted_at` guard: `chapters.repository.findByIdRaw` already filters `whereNull("deleted_at")`. Simplify to `if (!chapter) return null`. Found by Contract & Integration.
- **[S4]** `useFindReplaceState.ts:41-45` — state (query/replacement/options/results) persists across project navigations. Reset in an effect keyed on `projectSlug`. Found by Frontend Logic.
- **[S5]** `useProjectEditor.ts` + `Editor.tsx` — two in-flight saves can race the `dirtyRef = !ok` write. If the superseded call resolves last, dirty flips back to true falsely. Gate `handleSave` entry on an `inFlight` boolean, or serialize via AbortSignal. Found by Concurrency/State.
- **[S6]** `search.service.ts:66-133` — one long-running SQLite write transaction covers JSON parse + replaceInDoc + countWords + image diff + snapshot insert for all affected chapters. Concurrent auto-save retries can queue or time out. Consider computing outside the transaction, then opening a short transaction for the writes. Found by Concurrency/State.
- **[S7]** `tiptap-text.ts:33-44` — `LEAF_BLOCKS` hard-codes `paragraph/heading/codeBlock`. Nested paragraphs inside blockquote/listItem are still traversed via recursion, but any future extension placing inline text directly in a non-listed container is silently unsearchable. Derive the set from "nodes whose `content` contains `text`" or keep the list in sync with the TipTap schema. Found by Plan Alignment, Contract & Integration.
- **[S8]** `chapters.service.ts:82-114` — `findChapterById` runs after the transaction closes; under concurrent PATCHes for the same chapter, the response body can reflect the other request's content. Read the row inside the transaction. Found by Concurrency/State.
- **[S9]** `snapshots.routes.ts:56-105` — GET/DELETE/restore routes accept `req.params.id` as raw string. Use `z.string().uuid().safeParse(...)` to return 400 on malformed UUIDs, matching the `ReplaceSchema.chapter_id` convention. Found by Security.
- **[S10]** `FindReplacePanel.tsx:151-158` — no `onKeyDown` on the replace input; plan called for Enter to trigger "Replace All in Manuscript" with confirmation. Found by Plan Alignment.

## Plan Alignment

**Plan docs:** `docs/plans/2026-04-16-snapshots-find-replace-design.md`, `docs/plans/2026-04-16-snapshots-find-replace-plan.md`

- **Implemented:** Migration 014; snapshot types/schemas; repository with insert/findById/listByChapter/remove/getLatestContentHash/deleteByChapter; snapshot service (create/list/get/delete/restore with auto-snapshot and dedup); snapshot HTTP routes and mounting; purge cascade for snapshots; Ctrl/Cmd+S flush shortcut; API client `snapshots` and `search` namespaces; `SnapshotPanel`, `SnapshotBanner`, `FindReplacePanel`; `useSnapshotState` + `useFindReplaceState`; tiptap-text walker with search/replace; search service (searchProject + replaceInProject); search routes; toolbar wiring for all three shortcuts; panel exclusivity; confirm-before-replace-all; editor reload after restore/replace; e2e tests for both features; refactor of `applyImageRefDiff` into `images.references.ts` shared by both snapshot restore and chapter update paths.
- **Not yet implemented:** Enter-key-in-replace-field triggering Replace All in Manuscript (plan keyboard flow, flagged as [S10]). Design's styling for auto-snapshot entries ("italic label, or 'auto' tag") — a `auto: "auto"` string exists but visual differentiation is not fully verified. Task 20 (Coverage & Cleanup) cannot be verified from the static diff.
- **Deviations:**
  - **[D1]** Plan: "Replace-one — handled client-side by locating the match in the live editor and applying it there. No special API needed." Diff: per-match Replace calls the server-side chapter-scope replace-all. Also captured as [C1].
  - **[D2]** Plan: `/api/projects/:id/search` and `/replace`. Diff: routes use `:slug` and resolve to id internally. Consistent with the rest of the codebase's project URL convention; not a bug — flagged only for audit trail.

## Review Metadata

- **Agents dispatched:** Logic & Correctness (backend), Logic & Correctness (frontend), Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment, Verifier
- **Scope:** All 61 files changed on the branch + adjacent callers/callees (image repo, chapter repo/service, editor component, store types, migrations, purge logic)
- **Raw findings:** ~70 (across 7 specialists, with substantial overlap/dedup needed)
- **Verified findings:** 31 (3 Critical, 18 Important, 10 Suggestions) after deduplication
- **Filtered out:** ~39 duplicates and below-60-confidence items
- **Steering files consulted:** `/Users/poecurt/projects/smudge/CLAUDE.md`
- **Plan/design docs consulted:** `docs/plans/2026-04-16-snapshots-find-replace-design.md`, `docs/plans/2026-04-16-snapshots-find-replace-plan.md`
