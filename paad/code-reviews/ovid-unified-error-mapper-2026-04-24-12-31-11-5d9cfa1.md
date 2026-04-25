# Agentic Code Review: ovid/unified-error-mapper

**Date:** 2026-04-24 12:31:11
**Branch:** ovid/unified-error-mapper -> main
**Commit:** 5d9cfa1e8984c2333553fa6f84dfc819a2435c66
**Files changed:** 47 | **Lines changed:** +6170 / -829
**Diff size category:** Large

## Executive Summary

Phase 4b.3 (Unified API Error Mapper) is substantially complete and implemented with unusual rigor — the cross-cutting contract tests (ABORTED/NETWORK/BAD_JSON across all scopes, hostile `err.message` discard, extras validation) are load-bearing and faithful. One critical security invariant break surfaced: `extractExtras` does not guard against `__proto__` keys in error envelopes, allowing a hostile server response to pollute the prototype of the returned extras object. Four Important issues concern scope gaps (image upload validation/404 mapping; trash restore committed-code mapping; image upload ignoring `possiblyCommitted`; timezone dialog missing unmount abort). The remaining findings are latent defensive gaps and consistency drift suitable for follow-up PRs.

## Critical Issues

### [C1] Prototype pollution via `__proto__` in error envelope extras
- **File:** `packages/client/src/api/client.ts:75-84`
- **Bug:** `extractExtras` uses `const { code, message, ...rest } = err; ...; for (const k of keys) out[k] = rest[k];`. `JSON.parse` treats `__proto__` as an own enumerable property, so `Object.keys(rest)` returns it. The assignment `out["__proto__"] = value` sets the prototype of `out` instead of creating an own property. A hostile envelope like `{"error":{"code":"IMAGE_IN_USE","__proto__":{"chapters":[{"title":"X","trashed":false}]}}}` poisons `out` so `extras.chapters` returns attacker-controlled data via the prototype chain while `Object.keys(out)` is empty.
- **Impact:** Fundamental invariant break. Today the observable effect is narrow because `image.delete` validator at `scopes.ts:143-150` reads `chapters` through normal property access and passes the attacker-shaped array to `STRINGS.imageGallery.deleteBlocked`, which JSX-escapes. But any future consumer using `for (k in extras)`, `Object.keys(extras)`, `Object.hasOwn`, or a missing-property lookup will behave inconsistently with the validator. Threat model is narrow (requires a compromised server or hostile proxy) but the invariant should hold regardless.
- **Suggested fix:** Construct `out` with `Object.create(null)` AND skip `__proto__` / `constructor` / `prototype` during the loop. Minimal patch:
  ```ts
  const kept = keys
    .filter(k => k !== "__proto__" && k !== "constructor" && k !== "prototype")
    .slice(0, MAX_EXTRAS_KEYS);
  const out: Record<string, unknown> = Object.create(null);
  for (const k of kept) out[k] = rest[k];
  ```
  Add a test with a hostile envelope that asserts `Object.getPrototypeOf(err.extras) === null` (or `=== Object.prototype` if you prefer to keep the default prototype) and that `__proto__` is not an own key.
- **Confidence:** High
- **Found by:** Security

## Important Issues

### [I1] `image.upload` scope maps only 413 — validation errors and project-gone show network-blame copy
- **File:** `packages/client/src/errors/scopes.ts:125-130`
- **Bug:** Server (`packages/server/src/images/images.routes.ts:50-74`) emits `400 VALIDATION_ERROR` for missing file, unsupported MIME type, MIME/content mismatch, and empty file; and `404 NOT_FOUND` when the project was deleted. Client scope only wires `PAYLOAD_TOO_LARGE` (byCode) + `413` (byStatus). Everything else collapses to fallback `STRINGS.imageGallery.uploadFailedGeneric` = "Upload failed. Check your connection and try again." — misleadingly blaming the network for deterministic server-side validation failures.
- **Impact:** User repeatedly retries a file the server will always reject. Same issue hits the in-editor paste path (`Editor.tsx:249-264`) which uses the same scope.
- **Suggested fix:** Add `byCode: { VALIDATION_ERROR: STRINGS.imageGallery.unsupportedType /* new string */, PAYLOAD_TOO_LARGE: STRINGS.imageGallery.fileTooLarge }` and `byStatus: { 413: fileTooLarge, 404: uploadProjectGone /* new string */ }`. Mirror the enumeration pattern used by `findReplace.search`.
- **Confidence:** High
- **Found by:** Contract & Integration

### [I2] `trash.restoreChapter` scope has no `RESTORE_READ_FAILURE` handling
- **File:** `packages/client/src/errors/scopes.ts:222-230`
- **Bug:** Server (`packages/server/src/chapters/chapters.routes.ts:124-131`) emits `500 RESTORE_READ_FAILURE` after a successful restore when the post-restore read fails — i.e. the chapter is restored on disk, the client just can't see it. Client scope has neither a `byCode` entry for this code nor a `committed:` string, so the response falls through to fallback `restoreChapterFailed`.
- **Impact:** User sees "Unable to restore…" with no hint the restore actually committed. Retry issues a second restore → server hits 409 `RESTORE_CONFLICT` (slug already present) → user is confused. Meanwhile the chapter silently appears after a page reload.
- **Suggested fix:** Add a `committed:` string (e.g. "The chapter may have been restored. Refresh to confirm.") and a `byCode: { RESTORE_READ_FAILURE: <same-or-related-string> }` entry. Consider surfacing this like the committed path in `useTrashManager.handleRestore` — optimistically remove from `trashedChapters` and advise refresh.
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases

### [I3] Image upload 2xx BAD_JSON ignored → silent duplicate rows on retry
- **File:** `packages/client/src/components/ImageGallery.tsx:137-146`, `packages/client/src/components/Editor.tsx:249-264`
- **Bug:** Both call `mapApiError(err, "image.upload")` and destructure only `message`. When the server stored the upload but the JSON body was unreadable (2xx BAD_JSON), the scope surfaces the committed copy ("...may have completed, refresh…") — but neither site calls `incrementRefreshKey()` nor re-lists the gallery. The gallery still shows the stale list; a user retry uploads the same file a second time (the server does not dedupe), creating a second DB row and storing a second blob. The in-editor paste path is even worse: nothing visible appears, user drags again, two image rows for one intended insertion.
- **Impact:** Silent storage inflation on retry; duplicate image references.
- **Suggested fix:** Branch on `possiblyCommitted`. In `ImageGallery`, call `incrementRefreshKey()` so the list re-fetches the authoritative state. In `Editor`, surface the committed message and refuse to insert anything (we don't have the server-assigned id) — direct the user to the gallery.
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases

### [I4] `ProjectSettingsDialog` does not abort timezone PATCH on unmount
- **File:** `packages/client/src/components/ProjectSettingsDialog.tsx:44-47, 225-247`
- **Bug:** `timezoneAbortRef` is aborted only by subsequent timezone clicks. No unmount effect calls `timezoneAbortRef.current?.abort()`. If the dialog unmounts mid-save (parent navigates away, `key={project.slug}` remount on rename), the in-flight PATCH continues, and `.then`/`.catch` runs `setTimezone` / `setTimezoneSaveError` on an unmounted component.
- **Impact:** React setState-on-unmount warning in test output, violating CLAUDE.md's "zero warnings in test output" contract. Same bottle applies to the parallel `settings.get` effect which uses a `let cancelled = false` guard but never aborts the fetch — the server keeps processing.
- **Suggested fix:** Add `useEffect(() => () => { timezoneAbortRef.current?.abort(); }, [])`. For the settings GET, wire an AbortController and abort on cleanup.
- **Confidence:** High
- **Found by:** Concurrency & State

## Suggestions

- **S1.** `scopes.ts:140-151` — `image.delete` `extrasFrom` returns `{chapters: []}` when server ships an empty array (validator passes 0===0); consumer then produces ungrammatical "This image is used in: . Remove…". Require `valid.length > 0`.
- **S2.** `useSnapshotState.ts:293-295` — 2xx BAD_JSON on snapshot view is remapped to `CORRUPT_SNAPSHOT`; transient body-read issues would mislabel a fine snapshot as corrupt. Consider a separate "response unreadable" synthetic code.
- **S3.** `scopes.ts:217` — `export.run` has no `network:` override; offline export shows generic fallback.
- **S4.** `scopes.ts:59-63` — `project.updateTitle` missing `network:` override.
- **S5.** `scopes.ts:93-97` — `chapter.create` missing `network:` override.
- **S6.** `apiErrorMapper.test.ts:364` — `CROSS_PROJECT_IMAGE_REF` test uses HTTP 400; server emits 409 (`snapshots.routes.ts:155`). Test fidelity only.
- **S7.** `EditorPage.tsx:1971-1996` — `mapApiError(..., "snapshot.view")` message computed then discarded; SnapshotPanel keeps its own reason→string ladder. Scope registry is no longer the single source of truth for the view path. Flagged in-file as Phase 4b.4 work.
- **S8.** `scopes.ts:140-151` — chapter-array shape drift: validator accepts `{title, trashed?}` but server ships `{id, title, trashed}`. Validator is broader than the server contract.
- **S9.** `useProjectEditor.ts:266-271` — terminal-code retry gate lists `BAD_JSON`/`UPDATE_READ_FAILURE`/`CORRUPT_CONTENT` that the scope registry also knows about. Future "don't retry" code must be updated in both places.
- **S10.** `SnapshotPanel.tsx:46` — redeclares `"chapter" | "sameChapterNewer"` inline rather than importing exported `ViewSupersededReason` from `useSnapshotState.ts:71-79`. Adding a reason won't trigger a type error in the panel.
- **S11.** `useSnapshotState.ts:9-24` — top-of-file synthesis comment slightly out of sync with current helpers.
- **S12.** `useProjectEditor.ts:342` — final retry-exhausted path writes `STRINGS.editor.saveFailed` directly instead of re-using mapped message; string drift risk.
- **S13.** `useProjectEditor.ts:557-564` — `reloadActiveChapter` returns `"failed"` when mapped message is null (ABORTED). Caller raises lock banner; wrong for abort. Latent — no current abort path.
- **S14.** `apiErrorMapper.ts:69` — `possiblyCommitted` gated on `status >= 200 && < 300`. Hypothetical synthetic `{status: 0, code: BAD_JSON}` would bypass. Defensive.
- **S15.** `apiErrorMapper.ts:108-116` — `byStatus: {0}` unreachable because NETWORK/ABORTED early-return. Documentation/defensive only.
- **S16.** `api/client.ts:99-103` — `body.error?.code` typed as string but not validated at runtime. Hostile number-valued code would propagate; harmless under strict `===` checks.
- **S17.** `useProjectEditor.ts:266-279` — terminal-code branch matches `BAD_JSON` without gating status=2xx. Today only 2xx emits this code; future 4xx BAD_JSON would mis-route to committed branch.
- **S18.** `useSnapshotState.ts:199-202, 385-394` — count-refresh path silently swallows `api.snapshots.list` errors. Documented intent; consider telemetry.
- **S19.** `useProjectEditor.ts:340-343` — terminal BAD_JSON/UPDATE_READ_FAILURE sets `saveStatus=error` but does not lock the editor via `editorLockedMessage`. Inconsistent with the snapshot-restore/replace possiblyCommitted UX.
- **S20.** `useProjectEditor.ts:780` — `handleStatusChange` captures `previousStatus` from optimistic state; A→B→C failure reverts to optimistic-B, not confirmed-A.
- **S21.** `ProjectSettingsDialog.tsx:138-201` — `saveField` has no AbortController; same-field rapid re-blur can race, set `confirmedFieldsRef` out of order.
- **S22.** `ImageGallery.tsx:137-231` — `handleFileSelect`/`handleSave`/`handleInsert`/`handleDelete` fire-and-forget with no abort; project-switch unmount can produce setState-on-unmount warnings.
- **S23.** `EditorPage.tsx:1455` — `handleProjectSettingsUpdate` merges `prev.chapters` into the refreshed project, discarding server's authoritative chapter list. Settings dialog doesn't mutate chapters, so impact is minor.
- **S24.** `api/client.ts` — `api.snapshots.restore` accepts no signal; mid-restore unmount surfaces setState warnings in `useSnapshotState.restoreSnapshot:341`.
- **S25.** `useProjectEditor.ts:119-123` — unmount cleanup aborts `saveAbortRef` but not `statusChangeAbortRef`. Status PATCH continues after unmount; token auto-stale prevents state bleed.
- **S26.** `api/client.ts:62-63, 172-174, 277, 356-357` — NETWORK / BAD_JSON arms interpolate `err.message` into `ApiRequestError.message` (with `[dev]` prefix on NETWORK; plain on some BAD_JSON). Mapper never displays. Convention, not guard — a future `console.error(err)` could leak.

## Plan Alignment

Plan and design: `docs/plans/2026-04-23-unified-error-mapper-design.md`, `docs/plans/2026-04-23-unified-error-mapper-plan.md` (Phase 4b.3).

- **Implemented:** All five planned commits landed (Core module, Transport, Centralized-already sites, Generic-fallback migration, Raw-message leaks) plus 20+ review-driven `fix(errors):` follow-ups (I1–I13). `apiErrorMapper.ts` + `scopes.ts` + `index.ts` + `apiErrorMapper.test.ts` present; `ALL_SCOPES` cross-cutting tests exercise every scope for ABORTED/NETWORK/BAD_JSON/hostile-err.message. 33 scopes registered. CLAUDE.md updated with "Unified API error mapping" block and `errors/` in the project structure.
- **Not yet implemented:** Phase 4b.4 ESLint enforcement of `mapApiError` — explicitly deferred to a later phase. `eslint.config.js` still carries only the sequence-ref rule from Phase 4b.2. `docs/TODO.md` enumerates 12 deferred suggestion-level findings from the prior PAAD reviews; most of those are reflected in the Suggestions section above.
- **Deviations (all intentional):**
  - `possiblyCommitted` is gated on `scope.committed !== undefined` (tightening vs the design's "always true for 2xx BAD_JSON"). CLAUDE.md's higher-level wording was not updated to reflect the gate.
  - Scope enum expanded from design's 30 to 33 (`projectList.load`, `project.updateFields`, `image.list`, `image.references`).
  - `useSnapshotState` calls `mapApiError` once internally as a shared abort predicate (does not leak UI strings); synthesizes typed `ApiRequestError` for non-ApiRequestError throws.
  - `SnapshotPanel.onView` kept its own reason ladder rather than routing through the scope (see S7).
  - `chapter.save` resolved plan's open item #2 with a new `saveCommittedUnreadable` string.

## Review Metadata

- **Agents dispatched:** 6 specialists (Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment) + 1 Verifier.
- **Scope:** Full diff (47 files, 6,170 insertions / 829 deletions). Focus: new `packages/client/src/errors/` module, `packages/client/src/api/client.ts`, migrated hooks (`useProjectEditor`, `useSnapshotState`, `useFindReplaceState`, `useTrashManager`, `useTimezoneDetection`), pages (`EditorPage`, `HomePage`), components (`DashboardView`, `ProgressStrip`, `ProjectSettingsDialog`, `ImageGallery`, `SnapshotPanel`, `ExportDialog`, `Editor`), `strings.ts`, shared types. Callers/callees traced one level deep.
- **Raw findings:** 31 (after specialists, pre-verification)
- **Verified findings:** 28 (1 Critical + 4 Important + 23 Suggestions + 3 doc/consistency items)
- **Filtered out:** 3 false positives (dropped by Verifier):
  - `executeReplace` clearing wrong chapter's cache on mid-replace switch — blocked upstream by `isActionBusy()` guard in `handleSelectChapter`.
  - `ProjectSettingsDialog` timezone revert losing ABORTED classification — `controller.signal.aborted` is always true for the abort path, so the revert is unreachable on abort.
  - `DashboardView` discarding `transient` flag — `DashboardView.tsx` only destructures `message`; the specialist misread the code.
- **Steering files consulted:** `CLAUDE.md` (project root), `CONTRIBUTING.md`.
- **Plan/design docs consulted:** `docs/plans/2026-04-23-unified-error-mapper-design.md`, `docs/plans/2026-04-23-unified-error-mapper-plan.md`, `docs/roadmap.md`, `docs/TODO.md`, both prior PAAD reviews on this branch (`ovid-unified-error-mapper-2026-04-23-22-07-23-2c3b9d7.md`, `ovid-unified-error-mapper-2026-04-24-09-56-08-54a8ba9.md`).
