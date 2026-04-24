# Agentic Code Review: ovid/unified-error-mapper

**Date:** 2026-04-24 16:10:27
**Branch:** `ovid/unified-error-mapper` → `main`
**Commit:** `c57fd9a58f53e91a1768c3624d4ddf874cc08910`
**Files changed:** 57 | **Lines changed:** +7973 / -972
**Diff size category:** Large

## Executive Summary

This is the 6th agentic review of Phase 4b.3 (Unified API Error Mapper). Prior review rounds already closed the worst bugs — the mapper core, transport, cross-cutting rules, and the find-and-replace / snapshot migrations are in good shape. Two categories still have real teeth: **(C1) `possiblyCommitted` silently dropped at eight mutation call sites**, which is the branch's headline invariant failing in practice, and **(C2) a prototype-chain lookup in `byCode` that can return `Object.prototype` methods as the user-facing message**. A third concern worth attention: the new `sanitizer.ts` XSS boundary has zero unit tests.

## Critical Issues

### [C1] `possiblyCommitted` silently dropped at 8 mutation call sites

- **File:** `packages/client/src/pages/HomePage.tsx:51,65`; `packages/client/src/components/ImageGallery.tsx:189,208`; `packages/client/src/components/SnapshotPanel.tsx:281,305`; `packages/client/src/components/Editor.tsx:269`; `packages/client/src/components/ProjectSettingsDialog.tsx:281`
- **Bug:** Each scope (`project.create`, `project.delete`, `image.updateMetadata`, `snapshot.create`, `snapshot.delete`, `image.upload`, `settings.update`) declares `committed:` copy in `scopes.ts`, so the mapper emits `possiblyCommitted: true` on 2xx BAD_JSON. Every catch destructures only `{ message }`, dropping the signal.
- **Impact:** User retries a mutation the server already committed. Concrete breakages: paste-image-twice during transient BAD_JSON produces two multipart uploads; HomePage "Create" retry produces a duplicate project (second POST 409s); `ProjectSettingsDialog.handleTimezoneChange` reverts `setTimezone(confirmedTimezoneRef.current)` even though the server persisted the new value. This is the branch's own invariant ("2xx BAD_JSON is `possiblyCommitted`") failing at user-visible points.
- **Suggested fix:** Destructure `possiblyCommitted` and branch as `ImageGallery.handleFileSelect` and `ProjectSettingsDialog.saveField` already do — on true, refresh the affected list / promote optimistic state / skip the revert, then surface the committed copy rather than a retry banner.
- **Confidence:** High
- **Found by:** Logic & Correctness (B), Error Handling & Edge Cases (B) — 5 sites flagged by both specialists

### [C2] `scope.byCode` prototype-chain lookup returns `Object.prototype` methods as message

- **File:** `packages/client/src/errors/apiErrorMapper.ts:109`
- **Bug:** `scope.byCode?.[err.code]` performs a prototype-chain lookup on a plain object literal. If `err.code === "toString" | "hasOwnProperty" | "valueOf" | "constructor"`, the expression returns the inherited function. The `!== undefined` guard passes; the mapper returns `{ message: <function> }` typed as `string`. Downstream UI stringifies it to the function source or `"function toString() { [native code] }"`.
- **Impact:** CLAUDE.md invariant ("raw `err.message` must never reach the UI") violated in a specific way — a function renders through `String()` as source code. Requires a server that emits an `err.code` matching a `Object.prototype` method name, which a misconfigured proxy or a future enum-refactor regression can produce.
- **Suggested fix:** Guard with `Object.hasOwn(scope.byCode, err.code)` before indexing, or construct each `byCode` map with `Object.create(null)` in `scopes.ts`. One-line change.
- **Confidence:** Medium
- **Found by:** Logic & Correctness (A), Error Handling & Edge Cases (A)

## Important Issues

### [I1] `chapter.reorder` scope missing `REORDER_MISMATCH` byCode

- **File:** `packages/client/src/errors/scopes.ts:119-122`; server at `packages/server/src/projects/projects.routes.ts:135`
- **Bug:** Server returns `400 { code: "REORDER_MISMATCH" }` when the reorder ID set mismatches (another tab added/deleted a chapter). The scope has only `fallback` + `committed`, so all mismatches collapse to `reorderFailed` and retrying hits the same 400 indefinitely without a refresh hint.
- **Suggested fix:** Add `byCode: { REORDER_MISMATCH: STRINGS.error.reorderOutOfSync }` with a new string explaining a refresh is required.
- **Confidence:** High
- **Found by:** Logic & Correctness (A, B), Error Handling & Edge Cases (B)

### [I2] `export.run` scope collapses all server codes to generic fallback

- **File:** `packages/client/src/errors/scopes.ts:258`; server at `packages/server/src/export/export.routes.ts:14-32`
- **Bug:** Server emits `VALIDATION_ERROR` (400), `EXPORT_INVALID_CHAPTERS` (400), `NOT_FOUND` (404). The scope is only `{ fallback }`, with no `byCode`/`byStatus`/`network`. `EXPORT_INVALID_CHAPTERS` (user selected chapters that no longer belong — after rename/delete in another tab) has no recovery hint; transient network failures look identical to validation failures.
- **Suggested fix:** Add `byCode: { VALIDATION_ERROR, EXPORT_INVALID_CHAPTERS }`, `byStatus: { 404 }`, and `network` entries with distinct copy.
- **Confidence:** High
- **Found by:** Logic & Correctness (A, B), Error Handling & Edge Cases (B)

### [I3] `settings.update` scope missing `network:` entry

- **File:** `packages/client/src/errors/scopes.ts:285-288`
- **Bug:** Sibling `settings.get` has a network entry; `settings.update` does not. NETWORK errors on timezone save collapse to `settingsUpdateFailedGeneric` instead of a retry-able "check your connection" message. `transient: true` from the mapper still flows, so retry UX works mechanically — only the copy is weak.
- **Suggested fix:** Add `network: STRINGS.error.settingsUpdateFailedNetwork`.
- **Confidence:** Medium
- **Found by:** Logic & Correctness (A, B)

### [I4] `useTrashManager.handleRestore` has no abort / sequence / unmount guard

- **File:** `packages/client/src/hooks/useTrashManager.ts:31-74`
- **Bug:** `api.chapters.restore(chapterId)` is called without a signal; `setTrashedChapters` / `setProject` / `navigate` fire unconditionally on response. Double-click produces 409 `RESTORE_CONFLICT` on the second call while the first silently succeeded; unmount-during-restore emits setState warnings (CLAUDE.md zero-warnings rule); the captured `slug` closure in `navigate(...)` can redirect a user who has already moved on.
- **Suggested fix:** Extend `api.chapters.restore` to accept `signal?: AbortSignal`, add an abort ref + sequence token in the hook, abort on unmount and before new restore.
- **Confidence:** Medium-High
- **Found by:** Logic & Correctness (A), Error Handling & Edge Cases (A), Concurrency & State (A)

### [I5] `handleRenameChapter` has no abort / sequence discipline (parity gap with sibling handlers)

- **File:** `packages/client/src/hooks/useProjectEditor.ts:929-956`
- **Bug:** Two rapid PATCH `/chapters/:id {title}` calls run without a signal or sequence ref. Server arrival order wins rather than user order. `handleUpdateProjectTitle` (`titleChangeAbortRef`) and `handleStatusChange` (`statusChangeAbortRef`) got the fix (commits b024351, 480f8a2) — chapter title rename was missed.
- **Impact:** Rapid rename (e.g., "Chapter 1 → Chapter One → Chapter One: Beginnings") on a slow connection can persist an intermediate value server-side while the UI shows the final value. User-visible data loss on exactly the axis the sibling fix already closed.
- **Suggested fix:** Mirror `statusChangeAbortRef` — abort any in-flight rename before issuing a new one, thread signal into `api.chapters.update`.
- **Confidence:** High
- **Found by:** Concurrency & State (A)

### [I6] `useProjectEditor.handleSave` hard-codes terminal codes parallel to `scope.committedCodes`

- **File:** `packages/client/src/hooks/useProjectEditor.ts:281-294`
- **Bug:** The retry-loop terminal-code allowlist (`BAD_JSON`, `UPDATE_READ_FAILURE`, `CORRUPT_CONTENT`) is decoupled from `scope.committedCodes: ["UPDATE_READ_FAILURE"]` in `scopes.ts:100` and from the mapper's 2xx-BAD_JSON rule. Adding a new terminal code to `committedCodes` would not short-circuit this loop, producing up to 14 seconds of spurious "saving…" + three identical PATCHes the server will reject.
- **Suggested fix:** Derive the terminal-save predicate from `mapped.possiblyCommitted` plus a scope-level `terminalCodes: string[]` field (or similar), so the scope registry is the single owner of classification.
- **Confidence:** Medium-High
- **Found by:** Error Handling & Edge Cases (A), Contract & Integration (A)

### [I7] `ProjectSettingsDialog` unmount-abort races a server-committed PATCH on `key={project.slug}` remount

- **File:** `packages/client/src/components/ProjectSettingsDialog.tsx:140-146`
- **Bug:** Unmount cleanup aborts both `timezoneAbortRef` and `fieldAbortRef`. `EditorPage.tsx:2201` mounts the dialog with `key={project.slug}` — a rename remounts it, firing unmount cleanup. An in-flight target-word-count PATCH that has already committed server-side has its response aborted; the aborted-guards at `:192`/`:274` skip both `confirmedFieldsRef` promotion and `onUpdate()`. Parent's `ProgressStrip`/`DashboardView`/velocity keep rendering pre-save values until a full refresh.
- **Suggested fix:** Distinguish "user-initiated supersede" (abort OK) from "unmount during committed save" (let response run and fire `onUpdate`). Remove `fieldAbortRef.current?.abort()` from the unmount cleanup, or add a reconciliation step after remount.
- **Confidence:** Medium-High
- **Found by:** Logic & Correctness (B), Error Handling & Edge Cases (B)

### [I8] `ImageGallery` list/references/update/delete call sites lack `AbortSignal`

- **Files:** `packages/client/src/components/ImageGallery.tsx:61-86, 98-123, 179-241, 484-505`; `packages/client/src/api/client.ts:398-419`
- **Bug:** Multiple related gaps in the same component:
  1. The `list(projectId)` effect fires without the signal `api.images.list` already supports (added for ExportDialog at `client.ts:358`). The `ABORTED` branch in the catch at line 79 is therefore unreachable.
  2. `api.images.references` / `update` / `delete` / `upload` don't accept a signal at all.
  3. The on-click references refresh at `:484-505` has no stale-guard, unlike the sibling mount effect's `cancelled` flag — click Delete on image A, switch to image B, A's references overwrite B's detail panel.
  4. `handleSave`/`handleInsert`/`handleDelete` can setState on an unmounted component.
- **Suggested fix:** Thread the signal through `api.images.list(projectId, signal)`; extend `api.images.references/update/delete/upload` to accept `signal?: AbortSignal`; share one `AbortController` across the gallery's fetches; abort on project-id change and unmount.
- **Confidence:** Medium-High
- **Found by:** Logic & Correctness (B), Error Handling & Edge Cases (B), Contract & Integration (B), Concurrency & State (B)

### [I9] `useSnapshotState.restoreSnapshot` POST + follow-up list lack `AbortSignal`

- **File:** `packages/client/src/hooks/useSnapshotState.ts:345, 370-375`
- **Bug:** Both `api.snapshots.restore(snapshotId)` and the follow-up `api.snapshots.list(restoringChapterId)` are signalless. `api.snapshots.list` does accept a signal. Token guards state (response discarded on chapter switch / unmount), but the server continues to process both requests. Inconsistent with the I2 discipline explicitly established elsewhere in the same file. Also: an uncancellable restore POST whose response lands after unmount can schedule state updates on a torn-down hook.
- **Suggested fix:** Thread the abort signal through the follow-up list (safe). For the restore POST, consider that ABORTED after a commit-intent call must be treated as `possiblyCommitted` rather than silent — either add that nuance or leave the POST signalless with a comment pinning the semantics.
- **Confidence:** Medium-High
- **Found by:** Logic & Correctness (A), Error Handling & Edge Cases (A), Concurrency & State (A)

### [I10] Sanitizer has zero test coverage

- **File:** `packages/client/src/sanitizer.ts` (no `sanitizer.test.ts` exists)
- **Bug:** `sanitizeEditorHtml` is the only XSS boundary for `<div dangerouslySetInnerHTML>` in `PreviewMode` and snapshot view. Its comment says it's "defense-in-depth against a hostile backup/snapshot/server payload" — i.e., the threat model explicitly includes attacker-controlled payloads — but a regression in `ALLOWED_TAGS`, a DOMPurify swap, or an allowlist widening lands green today.
- **Suggested fix:** Add `packages/client/src/sanitizer.test.ts` asserting:
  - `<script>` / `<style>` / `<iframe>` / `<object>` / `<embed>` / `<link>` stripped
  - `<img src=x onerror=...>` drops `onerror`, keeps `src`
  - `<img src="javascript:...">` blocked by default URI filter
  - `<a>` tag stripped entirely (not in `ALLOWED_TAGS`)
  - benign editor output (paragraphs, headings, lists, strong/em, `<img src alt>`) passes through unchanged
- **Confidence:** High
- **Found by:** Security

### [I11] `ExportDialog` cover-image list failure is silent

- **File:** `packages/client/src/components/ExportDialog.tsx:106-114`
- **Bug:** On non-abort `image.list` failure the catch clears `setCoverImages([])` and surfaces nothing. User sees an empty cover dropdown indistinguishable from "no images uploaded yet" — even when the cause is transient network. The `image.list` scope has `network` / `fallback` strings that are mapped but thrown away.
- **Suggested fix:** Propagate the mapped message via a local `coverLoadError` state, rendered near the dropdown (e.g., "Unable to load cover images — {mapped message}").
- **Confidence:** Medium-High
- **Found by:** Error Handling & Edge Cases (B), Contract & Integration (B)

### [I12] `executeReplace` stage:"reload" path drops `skipped_chapter_ids` warning

- **File:** `packages/client/src/pages/EditorPage.tsx:796-806` (vs happy path at `:779-783`)
- **Bug:** `result.data` (a `ReplaceResponse`) carries `skipped_chapter_ids`. The happy path surfaces a warning banner when the skip list is non-empty; the reload-failed branch reads only `replaced_count` and drops the skip warning despite having the same data in hand. Partial-success replace whose reload fails loses the skipped-chapter signal entirely.
- **Suggested fix:** Mirror the `skipped_chapter_ids.length > 0` check inside the `stage === "reload"` branch, or centralize via a helper used by both.
- **Confidence:** Medium-High
- **Found by:** Contract & Integration (B)

### [I13] `chapter.load` scope missing `CORRUPT_CONTENT` byCode

- **File:** `packages/client/src/errors/scopes.ts:76-79`; server emits at `packages/server/src/chapters/chapters.routes.ts`
- **Bug:** Server returns 500 `CORRUPT_CONTENT` when stored chapter JSON is corrupt; scope has only `fallback` and `network`. User sees a generic "Unable to load chapter" with no indication the row is unrecoverable — retries forever.
- **Suggested fix:** Add `byCode: { CORRUPT_CONTENT: STRINGS.editor.loadFailedCorrupt }`.
- **Confidence:** Medium
- **Found by:** Contract & Integration (A)

### [I14] `chapter.save` scope has no `byStatus[404]` for chapter-gone save

- **File:** `packages/client/src/hooks/useProjectEditor.ts:295-307`
- **Bug:** A 404 on save (chapter soft-deleted by another device/tab) maps to the generic fallback "Unable to save…". No byStatus distinguishes it from other 4xx cases. The retry loop correctly aborts, but user gets a misleading banner and no recovery hint.
- **Suggested fix:** Add `byStatus: { 404: STRINGS.error.chapterGoneDuringSave }` to `chapter.save`.
- **Confidence:** Medium
- **Found by:** Contract & Integration (A)

### [I15] `ScopeEntry.byCode` typed as `Partial<Record<string, string>>` — typos compile cleanly

- **File:** `packages/client/src/errors/apiErrorMapper.ts:15`
- **Bug:** Free-form string keys in `byCode` and `committedCodes: string[]` mean a typo (`PAYLOD_TOO_LARGE`, `RESTROE_CONFLICT`) compiles without warning and silently falls back. The unified mapper's "single owner of classification" promise erodes by a typo's width.
- **Suggested fix:** Export a `ServerErrorCode` union from `@smudge/shared` and narrow `byCode` keys to `Partial<Record<ServerErrorCode, string>>`. Same for `committedCodes`.
- **Confidence:** Medium
- **Found by:** Contract & Integration (A)

## Suggestions

- [S1] Empty-string `err.code` skips all byCode entries (latent — no server emits `""`) — `packages/client/src/errors/apiErrorMapper.ts:109`
- [S2] `extractExtras` accepts JSON arrays as valid envelopes (rest-destructure yields `{"0":…}`) — `packages/client/src/api/client.ts:91-102`
- [S3] `useSnapshotState.viewSnapshot` re-checks `err.code === "BAD_JSON" && err.status in [200,300)` inline; mapper should own this discriminant — `packages/client/src/hooks/useSnapshotState.ts:315`
- [S4] `extrasFrom` runs on byStatus/fallback branches, bypassing validation intent — `packages/client/src/errors/apiErrorMapper.ts:122-136`
- [S5] `extras` null-prototype contract undocumented; `hasOwnProperty` calls will throw — `packages/client/src/api/client.ts:99`
- [S6] `SnapshotPanel.onView` three-hop translator (scopes → EditorPage translator → panel case ladder) is drift-prone; acknowledged for Phase 4b.4 — `packages/client/src/pages/EditorPage.tsx:1990-2024`
- [S7] `const { message } = mapApiError(...); if (message) setFoo(message);` duplicated at 20+ sites — consider a shared helper — multiple
- [S8] `EditorPage.handleProjectSettingsUpdate` GET lacks signal — `packages/client/src/pages/EditorPage.tsx:1452-1490`
- [S9] `api.chapterStatuses.list()` doesn't accept a signal — `packages/client/src/api/client.ts:354`
- [S10] `useProjectEditor.loadProject` uses a `cancelled` flag only, no `AbortController` — `packages/client/src/hooks/useProjectEditor.ts:137-186`
- [S11] `useFindReplaceState.search` abort-ref has narrow teardown-race memory leak — `packages/client/src/hooks/useFindReplaceState.ts:99-104, 212-214`
- [S12] `HomePage.handleCreate/handleDelete` no unmount guard for navigate-away race — `packages/client/src/pages/HomePage.tsx:43-69`
- [S13] `ProjectSettingsDialog.handleTimezoneChange` and `saveField` separate abort refs — double `onUpdate` possible — `packages/client/src/components/ProjectSettingsDialog.tsx:263-285`
- [S14] `ApiRequestError.message` `[dev]` prefix not enforced in constructor (convention only) — `packages/client/src/api/client.ts:41-51`
- [S15] Nested prototype-pollution in `extractExtras` (only top-level guards) — `packages/client/src/api/client.ts:91`
- [S16] `readErrorEnvelope` / `res.json()` no size cap — low in single-user threat model — `packages/client/src/api/client.ts:117,157,186,388`
- [S17] `ExportDialog` filename uses `projectSlug` with no secondary safety check — `packages/client/src/components/ExportDialog.tsx:153`
- [S18] Image `src` URLs interpolated without `encodeURIComponent` — defense-in-depth — `ImageGallery.tsx:290,333`, `Editor.tsx:264`
- [S19] `useTrashManager.confirmDeleteChapter` has no unmount guard — `packages/client/src/hooks/useTrashManager.ts:76-99`

## Plan Alignment

**Plan documents consulted:** `docs/plans/2026-04-23-unified-error-mapper-design.md`, `docs/plans/2026-04-23-unified-error-mapper-plan.md`, `docs/roadmap.md`. This PR implements Phase 4b.3 as scoped.

**Implemented:** All DoD items from design §12 are visible in the diff — the mapper core, scope registry, transport unification (`ApiError` index signature, `extras`), `findReplace`/snapshot migration, generic-fallback migrations across all listed sites, raw-`err.message` kills, CLAUDE.md invariant addition. Beyond-plan hardening landed in review rounds: `committedCodes` scope field (S8), `extractExtras` prototype-pollution guard (977a70e), `MAX_EXTRAS_KEYS = 16` bound, `isApiRequestErrorWithCode` type-guard helpers (I10), scope additions (`projectList.load`, `project.updateFields`, `image.list`, `image.references`).

**Not yet implemented (neutral — deferred by design):**
- ESLint rule enforcing `mapApiError` usage (Phase 4b.4).
- `strings.ts` namespacing (Phase 4b.4).
- Editor state machine tightening 2xx BAD_JSON to compile-time invariants (Phase 4b.5).
- Suggestion-level items explicitly deferred to `docs/TODO.md`.

**Deviations (all defensible):**
- Scope registry grew beyond the 30 enumerated in design §3; the design audit missed several real API surfaces. Consistent with the "new API surfaces add a scope entry" architectural invariant.
- `committedCodes` scope field added (S8 commit a200d49) — not in the original design; small `ScopeEntry` extension. Worth documenting in the next design update.

**Scope-creep candidates:**
- **Node 22 LTS migration** (commit a3dd69f): CLAUDE.md change, new CONTRIBUTING.md, Makefile env var, `package.json` engines pin. Unrelated to the error mapper — would cleanly be its own PR. Flag for explicit acknowledgment in the PR description.
- **Abort-signal hardening across unrelated call sites** (I1/I3/I6/I8/I11 commits): defensible as "bug fix alongside the feature" because review rounds surfaced them on touched files, but borderline.
- **`useEditorMutation` invariant-pair helper extraction** (f9dc78a): Phase 4b.1 territory, not 4b.3. Small, low-risk.
- **Dashboard: preserve prior velocity on refresh failure** (564879d): user-visible behavior change contradicting the design's "no user-visible behavior changes" clause. Acknowledged as fix to a pre-existing bug surfaced during migration.

## Review Metadata

- **Agents dispatched:** 11 total — Logic & Correctness (A, B), Error Handling & Edge Cases (A, B), Contract & Integration (A, B), Concurrency & State (A, B), Security (whole diff), Plan Alignment (whole diff); Verifier (whole consolidation).
- **Partitioning:** Group A = errors infrastructure + hooks + API client + shared types. Group B = pages + components + strings + App.
- **Scope:** 57 changed files, +7973/-972, reviewed end-to-end including callers/callees one level deep.
- **Raw findings:** ~70 across all specialists (many duplicates across lenses — `possiblyCommitted` drops, abort signal gaps, and scope gaps surfaced from 3+ lenses each).
- **Verified findings:** 2 Critical + 15 Important + 19 Suggestions after verification and dedup.
- **Steering files consulted:** `CLAUDE.md`, `CONTRIBUTING.md`, `packages/client/CLAUDE.md` (implicit via CLAUDE.md).
- **Plan/design docs consulted:** `docs/plans/2026-04-23-unified-error-mapper-design.md`, `docs/plans/2026-04-23-unified-error-mapper-plan.md`, `docs/roadmap.md`.
- **Prior review context:** 5 prior PAAD reviews on this branch were consulted; many I-numbered items in prior reviews that are still unfixed were carried forward and re-verified.
