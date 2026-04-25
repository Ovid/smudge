# Agentic Code Review: ovid/unified-error-mapper

**Date:** 2026-04-24 13:41:50
**Branch:** ovid/unified-error-mapper -> main
**Commit:** fd433e83755bed49f98bbe0a27ea222349282af0
**Files changed:** 49 | **Lines changed:** +6849 / -839
**Diff size category:** Large

## Executive Summary

The branch implements Phase 4b.3 (Unified API Error Mapping) with a new `packages/client/src/errors/` module, a rewritten transport in `api/client.ts`, and migration of every client catch block to `mapApiError(err, scope)`. Design quality is high — the scope registry, the `resolveError` precedence (ABORTED → BAD_JSON/2xx → NETWORK → byCode → byStatus → fallback), the `extractExtras` prototype-pollution defense, and the `[dev]` prefix discipline all hold up under six parallel specialist reviews. Two Critical findings remain: a drift guard in `useProjectEditor` that fails after a completed project switch (can corrupt project state across handlers), and an `onBlur` save in `Editor.tsx` that bypasses the `setEditable(false)` mutation gate. Six Important findings and eleven Suggestions follow — mostly missing `AbortController` wiring and minor scope-registry gaps.

## Critical Issues

### [C1] Two-part drift guard fails after a completed project switch
- **File:** `packages/client/src/hooks/useProjectEditor.ts:398-406, 664-665, 678-679, 730-731, 752-755`
- **Bug:** The guard `projectSlugRef.current !== slug && projectSlugRef.current !== projectRef.current?.slug` returns early only when BOTH clauses are true. After a user navigates A → B and `loadProject` has completed, both refs hold "b". A stale in-flight response for project "a" (create/reorder/rename) lands and the guard evaluates: `"b" !== "a"` → true AND `"b" !== "b"` → false, so the AND is false and the response IS NOT discarded. The response then merges into project B's state.
- **Impact:** A chapter POST that resolved after a project switch adds A's new chapter to B's sidebar. A reorder PUT for A applied to B's chapter array would filter away every id (ids don't match) and leave B with an empty chapters list until refresh. A rename PATCH for A would rewrite B's slug/title and change the URL. This is cross-project data corruption, reachable on any normal multi-project workflow with a flaky network.
- **Suggested fix:** Change the AND to OR — `projectSlugRef.current !== slug || projectSlugRef.current !== projectRef.current?.slug`. Drift on either axis means the response is stale. For the rename fall-through the comment cites, compare the response's returned slug (available after the await) rather than refs captured before it.
- **Confidence:** High (90)
- **Found by:** Logic & Correctness, Error Handling & Edge Cases

### [C2] `onBlur` save bypasses `setEditable(false)` gate
- **File:** `packages/client/src/components/Editor.tsx:210-225`
- **Bug:** The `onBlur` handler fires an immediate save whenever `dirtyRef.current` is true, with no check of `editor.isEditable`. TipTap dispatches blur events even when the editor is non-editable. During a mutation's `setEditable(false)` window — before `markClean()` clears `dirtyRef` — a focus loss (e.g. clicking Restore or Replace, or opening a panel) fires an immediate PATCH of pre-mutation content.
- **Impact:** Directly violates CLAUDE.md invariant #2 ("`setEditable(false)` around any mutation that can fail mid-typing"). A keystroke stream followed by a Restore click can commit the pre-restore draft on top of the server-committed restore. `handleSaveLockGated` catches this only once `editorLockedMessage` is set (post-reload-failure) — during the normal mutation happy path, onBlur's save is unprotected.
- **Suggested fix:** Gate the onBlur early-return on editability: `if (!dirtyRef.current || !ed.isEditable) return;`. One-line fix, closes the whole class of race.
- **Confidence:** Medium (72)
- **Found by:** Concurrency & State

## Important Issues

### [I1] Rapid-fire PATCHes without AbortController (multiple handlers)
- **File:** `packages/client/src/hooks/useProjectEditor.ts:716-769` (`handleUpdateProjectTitle`); `packages/client/src/components/ProjectSettingsDialog.tsx:159-222` (`saveField` word-count/deadline/author); `packages/client/src/components/ProjectSettingsDialog.tsx:246-268` (timezone — has AbortController client-side but server-side ordering still non-deterministic)
- **Bug:** None of the field-save paths thread an AbortController through `api.projects.update` / `api.settings.update`. Even the timezone path (which does abort client-side) still dispatches to the server before aborting, and multiple in-flight PATCHes against SQLite are FCFS on writer-lock acquisition, not on client dispatch.
- **Impact:** Rapid edits can silently commit in an order that disagrees with the last-typed value. Particularly concerning for project title (URL rewrite) and target word count (pacing calc input).
- **Suggested fix:** Mirror the `saveAbortRef` / `statusChangeAbortRef` discipline — one `fieldAbortRef` per dialog (or one per field) that aborts prior PATCH before issuing a new one; thread the signal into `api.projects.update`. For write-serialization ordering on the server, either (a) accept "last-client-dispatch wins eventually" and document the hazard, or (b) add a monotonic request id that the server echoes so the client drops stale responses.
- **Confidence:** High (75)
- **Found by:** Logic & Correctness (L2, L8), Concurrency & State (CS.2, CS.9)

### [I2] Snapshot/export transport methods accept no `AbortSignal`
- **File:** `packages/client/src/api/client.ts:399-415` (snapshots namespace); `packages/client/src/hooks/useSnapshotState.ts:231, 349`; `packages/client/src/components/ExportDialog.tsx:92-101`
- **Bug:** `api.snapshots.get/list/restore/create/delete` are signal-less. `useSnapshotState` discards stale RESPONSES via sequence tokens, but the underlying fetches never abort — server keeps reading snapshots for clicks the user has already superseded. Same for the export flow.
- **Impact:** Wasted server work under rapid clicks; no current correctness bug (tokens catch responses) but a pattern inconsistent with the rest of the transport (chapter updates, search, replace all wire signals).
- **Suggested fix:** Add optional `signal?: AbortSignal` to each snapshot method and thread through to `apiFetch`. In the hook, create a controller alongside each sequence token.
- **Confidence:** Medium (70)
- **Found by:** Logic & Correctness (L5), Contract & Integration (CI.1, CI.7)

### [I3] `DashboardView` velocity error wipes previously-loaded data
- **File:** `packages/client/src/components/DashboardView.tsx:72-86`
- **Bug:** On velocity error, `setVelocityWithSlug({ slug, data: null, error: message })` replaces prior good data with `null`. The dashboard.load effect above also has this shape, but the velocity strip is the more visible surface — a transient NETWORK blip on a refresh blanks the progress strip.
- **Impact:** A user reading the progress strip during a flaky connection sees it vanish after a silent `refreshKey` bump. Inconsistent with `useFindReplaceState.search()` which explicitly preserves prior results on transient errors.
- **Suggested fix:** On error, preserve `data` when the slug matches: `setVelocityWithSlug(prev => ({ slug, data: prev?.slug === slug ? prev.data : null, error: message }))`.
- **Confidence:** Medium (70)
- **Found by:** Error Handling & Edge Cases

### [I4] `SnapshotPanel` onView translator inverts byCode-vs-byStatus precedence
- **File:** `packages/client/src/pages/EditorPage.tsx:1990-1996`
- **Bug:** After calling `mapApiError(result.error, "snapshot.view")`, the translator re-reads `result.error.status === 404` BEFORE `result.error.code === SNAPSHOT_ERROR_CODES.CORRUPT_SNAPSHOT`. The mapper's documented S8 ordering is byCode-beats-byStatus; this inverts it. A hypothetical server response `{status:404, code:CORRUPT_SNAPSHOT}` would show "not found" in the panel though the mapper picked "corrupt".
- **Impact:** Latent today — the server does not ship the conflicting pair — but a drift hazard acknowledged by the S1 comment in-file which defers the fix to Phase 4b.4.
- **Suggested fix:** Flip the order: `if (code === SNAPSHOT_ERROR_CODES.CORRUPT_SNAPSHOT) return {ok: false, reason: "corrupt_snapshot"}` before `if (result.error.status === 404) return {ok: false, reason: "not_found"}`. Minimal change while the larger translator removal waits.
- **Confidence:** Medium (70)
- **Found by:** Contract & Integration

### [I5] `DashboardView` / `useTimezoneDetection` fetches have no AbortController — zero-warnings rule violation + user-input race
- **File:** `packages/client/src/components/DashboardView.tsx:41-90`; `packages/client/src/hooks/useTimezoneDetection.ts`
- **Bug:** DashboardView's velocity/dashboard effects use a `cancelled` flag to prevent setState but `console.warn("Failed to load …", err)` fires BEFORE the gate, producing stderr output on unmount that violates CLAUDE.md's zero-warnings-in-test-output rule. `useTimezoneDetection` has no signal and can race a user-initiated timezone PATCH from `ProjectSettingsDialog` on first launch — the startup PATCH lands AFTER the user's selection and overwrites it.
- **Impact:** Test noise plus a real first-launch data race where a user who opens Settings quickly enough to change timezone during detection will have their choice silently reverted to the auto-detected value.
- **Suggested fix:** Thread AbortController through both effects (including the velocity and dashboard GETs and the `api.settings.get/update` calls); short-circuit the warn on `signal.aborted`. For useTimezoneDetection, accept a cancellation signal from the caller and cancel on app unmount.
- **Confidence:** Medium (68)
- **Found by:** Concurrency & State, Contract & Integration, Error Handling & Edge Cases

### [I6] Duplicated `stage:"reload"` bookkeeping between `handleRestoreSnapshot` and `finalizeReplaceSuccess`
- **File:** `packages/client/src/pages/EditorPage.tsx:430-465` (restore) vs `593-672` (finalizer, used at 777-786 and 1025-1036)
- **Bug:** `finalizeReplaceSuccess` consolidates replace's stage:"reload" bookkeeping (lock banner, setEditable(false), cache-clear, snapshot refresh, count refresh, success banner). `handleRestoreSnapshot`'s stage:"reload" branch inlines the same sequence. The snapshots/find-and-replace branch needed 16 review rounds on exactly this class of divergence — a fix in one finalizer won't propagate to the other.
- **Impact:** No user-visible bug today; a future invariant change to the replace finalizer will silently diverge from restore.
- **Suggested fix:** Extract `finalizeMutationReloadFailed({ targetChapterId, chapterToClear, bannerMessage, refreshSnapshots, onStaleChapter })` used by both call sites. The stale-chapter-switch divergence in restore maps cleanly onto a callback parameter.
- **Confidence:** Medium (70)
- **Found by:** Contract & Integration

## Suggestions

- `useProjectEditor.ts:266-292` — Inline retry-terminal code ladder duplicates `scope.byCode` for `chapter.save`; encode terminality as a scope-level field to prevent drift. (CI.9, conf 65)
- `Editor.tsx:249-264` — Image-paste upload on 2xx BAD_JSON announces the mapped message but doesn't trigger gallery refresh; risk of duplicate uploads on retry. (E6, conf 60)
- `ExportDialog.tsx:92-101` — `.catch(() => setCoverImages([]))` swallows all errors silently; should route through `mapApiError(err, "image.list")`. (CI.10, conf 65)
- `scopes.ts:59-70` — `project.updateTitle` has no `byStatus[404]` though it hits the same endpoint as `project.updateFields` (which does). (CI.12, conf 70)
- `scopes.ts:122-124, 196` — `image.references` and `snapshot.list` are GET scopes with only `fallback`; siblings declare `network:` so NETWORK errors get transient-retry copy. (CI.1, conf 70)
- `ProjectSettingsDialog.tsx:257-267` — Timezone post-success abort race: if response resolves then abort fires before the `!aborted` guard runs, `confirmedTimezoneRef` is not updated though server committed. (E7, conf 60)
- `useProjectEditor.ts:693-704` — `handleReorderChapters` possiblyCommitted has no sequence guard; two rapid drags both hitting 2xx BAD_JSON could leave client state disagreeing with server. (E16, conf 62)
- `useTrashManager.ts:63-66` — `err.code === "RESTORE_READ_FAILURE"` check duplicates what `scope.committed` should express; drift risk if new committed-intent codes are added. (L7, conf 60)
- `useEditorMutation.ts:326-361` — S5 late-lock only fires when `editorAfterMutate === null`; a double-remount window (successful re-lock, then unmount, then re-mount before reload) leaves the new editor writable. (L9, conf 60)
- `EditorPage.tsx:1147-1149` — `editorLockedMessage` cleared on any `activeChapter?.id` change; a future direct caller to `handleDeleteChapter` without the banner guard would silently dismiss the lock. (L14, conf 60)
- `EditorPage.tsx:64` + `PreviewMode.tsx:76` — `DOMPurify.sanitize(html)` uses default config; pinning explicit ALLOWED_TAGS/ATTR is defense-in-depth against compromised-backup/snapshot-server threat model. (SEC.1, conf 62)
- `useSnapshotState.ts:253-259` — Snapshot content only structurally validated; consider `TipTapDocSchema.safeParse` client-side so generateHTML never sees a malformed doc (today `renderSnapshotContent` wraps in try/catch so impact is bounded). (SEC.2, conf 60)

## Plan Alignment

**Plan docs consulted:** `docs/plans/2026-04-23-unified-error-mapper-design.md`, `docs/plans/2026-04-23-unified-error-mapper-plan.md`, `docs/roadmap.md`.

- **Implemented:** All five planned commits landed (new `errors/` module; transport + ImageGallery; centralized-already sites; generic-fallback sites; raw-message leak kills + CLAUDE.md). All 30 scopes from design §3 are present plus legitimate expansions (`projectList.load`, `project.updateFields`, `image.list`, `image.references`). S1–S14 and I1–I13 + C1 review-fix IDs are traceable in code comments (~40 references). Resolver unit suite is table-driven; call-site tests updated across all affected files. No raw `err.message` reaches the UI outside the `[dev]`-prefixed transport layer.
- **Not yet implemented (expected — partial is fine):** Phase 4b.4 ESLint enforcement of the mapper contract is explicitly deferred per plan §8 / CLAUDE.md. The SnapshotPanel reason-string translator (EditorPage.tsx:1983-1996) is left in place pending 4b.4 per S1 in-file comment.
- **Deviations:** `possiblyCommitted` is gated on `scope.committed` being defined (apiErrorMapper.ts:80, S7), rather than unconditionally true on 2xx BAD_JSON as design §2 Rule 3 specified. Intentional per review comment — avoids misleading "possibly committed" on GETs where commit semantics don't apply. Worth updating the design doc to match.
- **Scope creep:** Borderline. Node 22 LTS pin + DEP0040 suppression + `CONTRIBUTING.md` (196 lines) + vitest worker-concurrency cap + ESLint warm-up fix are test-infrastructure work bundled here. Comment tied them to the zero-warnings-in-test-output rule the mapper tests depend on. Does not bundle other roadmap phases — only Phase 4b.3.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment, Verifier (filter + severity)
- **Scope:** 15 client files (errors/, api/client.ts, all affected hooks, EditorPage, ImageGallery, ProjectSettingsDialog, DashboardView, Editor.tsx, strings.ts) + 1 server file (for E15 cross-check) + plan/steering docs
- **Raw findings:** 56 pre-verification
- **Verified findings:** 20 (2 Critical, 6 Important, 12 Suggestions)
- **Filtered out:** 36 (false positives, design decisions, out-of-scope, or withdrawn by the originating specialist)
- **Steering files consulted:** `CLAUDE.md`
- **Plan/design docs consulted:** `docs/plans/2026-04-23-unified-error-mapper-design.md`, `docs/plans/2026-04-23-unified-error-mapper-plan.md`, `docs/roadmap.md`
