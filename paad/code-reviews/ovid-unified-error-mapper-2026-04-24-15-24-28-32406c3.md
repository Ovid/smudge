# Agentic Code Review: ovid/unified-error-mapper

**Date:** 2026-04-24 15:24:28
**Branch:** ovid/unified-error-mapper -> main
**Commit:** 32406c3222c8598e0614590d90351cc353949f00
**Files changed:** 55 | **Lines changed:** +7740 / -950
**Diff size category:** Large

## Executive Summary

Phase 4b.3 (Unified API Error Mapping) is well-implemented: the `packages/client/src/errors/` module owns `resolveError`'s precedence, all 33 scopes are declared, and the transport layer wraps every failure as `ApiRequestError` with the `[dev]` prefix discipline. The branch has been through four prior PAAD reviews, so the obvious classes of bugs (drift guards, 2xx BAD_JSON routing, extras validation, prototype-pollution defense) are closed. The dominant residual pattern — surfaced here in nine call sites — is **`possiblyCommitted` destructured-away at the consumer**: the scope registry faithfully emits the signal, but many catch blocks ignore it. Until the Phase 4b.4 ESLint enforcement lands, this is the single biggest compliance gap. Two server error codes (REORDER_MISMATCH, EXPORT_INVALID_CHAPTERS) also have no scope byCode mapping, and the ProjectSettingsDialog unmount cleanup aborts in-flight PATCHes that likely already committed server-side. No Critical issues.

## Critical Issues

None found.

## Important Issues

### [I1] `possiblyCommitted` silently dropped at 9 call sites
- **Files:**
  - `packages/client/src/hooks/useProjectEditor.ts:679` (chapter.delete)
  - `packages/client/src/hooks/useProjectEditor.ts:948` (chapter.rename)
  - `packages/client/src/pages/HomePage.tsx:49` (project.create)
  - `packages/client/src/pages/HomePage.tsx:63` (project.delete)
  - `packages/client/src/components/ImageGallery.tsx:189` (image.updateMetadata, handleSave)
  - `packages/client/src/components/ImageGallery.tsx:208` (image.updateMetadata, handleInsert)
  - `packages/client/src/components/SnapshotPanel.tsx:281` (snapshot.create)
  - `packages/client/src/components/SnapshotPanel.tsx:305` (snapshot.delete)
  - `packages/client/src/components/Editor.tsx:269` (image.upload, paste/drop path)
- **Bug:** each scope declares `committed:` in `scopes.ts` (and some also declare `committedCodes`), so the mapper emits `possiblyCommitted: true` on 2xx BAD_JSON or on the explicit committed codes. All nine catch blocks destructure only `{ message }`, dropping the signal.
- **Impact:** on an ambiguous-commit outcome the user sees a generic failure banner and either (a) retries and double-creates/double-uploads (project.create, image.upload, snapshot.create), (b) retries and hits a confusing 404/409 (delete paths) while the row silently disappears, or (c) sees a stale value until reload (updateMetadata, rename). The Editor image-paste case (line 269) is the most real: a user who sees "upload failed" will naturally paste again, creating a second multipart upload and a duplicate row — exactly what the matching `ImageGallery.handleFileSelect:144-155` refresh-on-`possiblyCommitted` branch was added to prevent.
- **Suggested fix:** destructure `possiblyCommitted` at each site; on true, do the committed-branch work (refresh the relevant list, present the committed copy, do NOT retry). For chapter.delete/rename the local state also needs an optimistic apply so the UI matches the server (mirror `handleReorderChapters:722-743`).
- **Confidence:** High (85)
- **Found by:** Logic & Correctness (L1, L2), Error Handling & Edge Cases (E1, E11), Contract & Integration (C3)

### [I2] `chapter.reorder` scope missing byCode for REORDER_MISMATCH
- **File:** `packages/client/src/errors/scopes.ts:119-122`
- **Bug:** server emits `{ status: 400, code: "REORDER_MISMATCH" }` from `packages/server/src/projects/projects.routes.ts:135` when the provided chapter ID list has the right length but wrong values (tested at `packages/server/src/__tests__/projects.test.ts:381`). The scope only declares `fallback` + `committed`, so the error surfaces as the generic "Unable to reorder chapters" copy.
- **Impact:** the client's sidebar is out of sync with the server (typical cause: a chapter was created/deleted in another tab or a prior delete committed silently). Retrying the same reorder will 400 identically until the user reloads. The mapper-driven copy gives no hint that a refresh is the recovery path.
- **Suggested fix:** add `byCode: { REORDER_MISMATCH: STRINGS.error.reorderOutOfSync }` + new strings entry explaining the chapters list changed and a refresh is needed.
- **Confidence:** High (80)
- **Found by:** Contract & Integration (C2)

### [I3] `export.run` scope missing byCode/byStatus for server-emitted codes
- **File:** `packages/client/src/errors/scopes.ts:258`
- **Bug:** server emits `VALIDATION_ERROR` (400), `EXPORT_INVALID_CHAPTERS` (400), and `NOT_FOUND` (404) from `packages/server/src/export/export.routes.ts:14-32`. The scope declares only `{ fallback: STRINGS.export.errorFailed }`, collapsing all three to one string.
- **Impact:** `EXPORT_INVALID_CHAPTERS` is particularly actionable (the user selected chapters that no longer belong — e.g. after a rename/delete in another tab) but the UI presents no way forward. `NOT_FOUND` (the project was deleted) is also user-actionable and silently generic.
- **Suggested fix:** add `byCode: { VALIDATION_ERROR: ..., EXPORT_INVALID_CHAPTERS: ... }` and `byStatus: { 404: ... }`, with corresponding strings.
- **Confidence:** High (85)
- **Found by:** Contract & Integration (C1)

### [I4] ProjectSettingsDialog unmount-abort races a server-committed PATCH
- **File:** `packages/client/src/components/ProjectSettingsDialog.tsx:140-146` (unmount cleanup), `:169-239` (saveField), `:263-285` (handleTimezoneChange)
- **Bug:** the unmount cleanup `useEffect(() => () => { timezoneAbortRef.current?.abort(); fieldAbortRef.current?.abort(); }, [])` aborts any in-flight field/timezone PATCH on teardown. If the server has already committed but the response has not yet reached the client, the abort causes the `await` to reject; the aborted-guard on line 178/282 skips `onUpdate()` and `confirmedFieldsRef` promotion.
- **Impact:** `EditorPage.tsx:2201` mounts the dialog with `key={project.slug}`, so any rename remounts the dialog and fires the unmount cleanup. A concurrent target-word-count save would then abort silently, the server has the new value, but the parent's `ProgressStrip`/`DashboardView`/velocity continue rendering the pre-save value until a full-load bump. If the user then edits the same field again and that second save errors with a non-committed failure, the revert writes the stale baseline back.
- **Suggested fix:** don't abort in the unmount cleanup; let the response run (success handlers are no-ops on an unmounted parent, and setState on a stale ref is harmless). Alternatively, promote `confirmedFieldsRef` and call `onUpdate()` unconditionally after the await succeeds, before the aborted check.
- **Confidence:** High (80)
- **Found by:** Concurrency & State (CS1, CS2)

### [I5] Startup timezone detection can overwrite a user-chosen timezone
- **Files:** `packages/client/src/hooks/useTimezoneDetection.ts:14-28`, `packages/client/src/App.tsx:8-17`
- **Bug:** `detectAndSetTimezone` runs a `GET /settings` → `PATCH /settings` sequence at app mount, cancellable only on App unmount. If the user opens Settings during the detection GET and chooses a timezone before the detection PATCH fires, both PATCHes race at the server; the detection PATCH can land AFTER the user's choice and overwrite it. The code comment at `useTimezoneDetection.ts:11-13` names this race but the fix only handles tab/app teardown.
- **Impact:** user picks a timezone in Settings on first launch, sees the dialog revert it seconds later, has no error indication.
- **Suggested fix:** after the detection GET resolves and before issuing the PATCH, re-read a module-scoped "user-chose-a-timezone" flag (or consult ProjectSettingsDialog's `userChangedTimezoneRef` via a shared ref) and skip the PATCH if set. A server-side "only write if still null" PATCH route is a robuster fix.
- **Confidence:** High (80)
- **Found by:** Concurrency & State (CS3)

### [I6] ExportDialog AbortController is not plumbed into `api.images.list`
- **File:** `packages/client/src/components/ExportDialog.tsx:98-119`
- **Bug:** the cover-image list effect creates an `AbortController` and guards the `.then`/`.catch` on `controller.signal.aborted`, but `api.images.list(projectId)` (`packages/client/src/api/client.ts:357`) takes no signal. The controller is effectively decorative.
- **Impact:** the browser-side fetch finishes on its own schedule; on rapid dialog open/close or format flip the app fans out redundant reads. Also inconsistent with snapshots/settings/projects transport surfaces that thread signals through.
- **Suggested fix:** extend the `images.list` signature to accept an optional `AbortSignal` (mirror `api.snapshots.list`), thread the controller's signal in, and drop the now-redundant aborted guard.
- **Confidence:** Medium (70)
- **Found by:** Error Handling & Edge Cases (E5)

### [I7] `useTrashManager.handleRestore` has no abort or sequence discipline
- **File:** `packages/client/src/hooks/useTrashManager.ts:31-74`
- **Bug:** unlike every other async hook in the branch, `handleRestore` carries no AbortController, no sequence token, no cancelled flag. `setTrashedChapters`, `setProject`, and `navigate(...)` fire unconditionally after the await.
- **Impact:** closing the Trash dialog or unmounting EditorPage mid-restore fires setState on a torn-down component (React warning — violates CLAUDE.md's zero-warnings-in-test-output rule). Rapid double-click of Restore can land two POSTs; the second hits `RESTORE_CONFLICT` and surfaces a confusing error for a row that actually restored successfully. `navigate(...)` on slug change can route to a stale URL.
- **Suggested fix:** wire an `AbortController` + `useAbortableSequence` pair (pattern: `useProjectEditor.handleSelectChapter`). Accept optional `AbortSignal` on `api.chapters.restore`.
- **Confidence:** Medium (70)
- **Found by:** Logic & Correctness (L4), Error Handling & Edge Cases (E6)

### [I8] ImageGallery delete-button on-demand references refresh has no stale-guard
- **File:** `packages/client/src/components/ImageGallery.tsx:484-505`
- **Bug:** clicking Delete triggers a background `api.images.references(...)` fetch; the `.then((data) => { setReferences(data.chapters); setReferencesLoaded(true); })` writes state without comparing `selectedImage.id` against the value captured when the click fired.
- **Impact:** if the user clicks Delete on image A, switches to image B via `openDetail` before A's references resolve, A's references list overwrites B's detail panel. The delete-confirmation gate then permits or blocks the wrong action.
- **Suggested fix:** snapshot `selectedImage.id` into a local before the fetch; gate `.then`/`.catch` on `selectedImage?.id === snappedId` (matches the pattern in the sibling mount effect at `:96-123`). Or wire an AbortController aborted by selection change.
- **Confidence:** Medium (72)
- **Found by:** Error Handling & Edge Cases (E2)

### [I9] `settings.update` scope missing `network` entry
- **File:** `packages/client/src/errors/scopes.ts:285-288`
- **Bug:** the scope declares `fallback` + `committed` but no `network`. An offline PATCH of settings falls to `network: scope.network ?? scope.fallback`, producing the generic "Unable to save settings."
- **Impact:** a user on a flaky connection sees the generic failure and has no copy-level hint that retrying once reconnected will work. Sibling scope `settings.get` correctly declares `network`.
- **Suggested fix:** add `network: STRINGS.error.settingsUpdateFailedNetwork` (new string mirroring `settingsLoadFailedNetwork`).
- **Confidence:** Medium (68)
- **Found by:** Error Handling & Edge Cases (E4)

## Suggestions

- `useProjectEditor.ts:278-283` — `chapter.save` retry ladder hardcodes `BAD_JSON || UPDATE_READ_FAILURE || CORRUPT_CONTENT`, duplicating intent already encoded in scope `committedCodes: ["UPDATE_READ_FAILURE"]`. Adding a future committed-intent code to the registry would not short-circuit this loop. Consult `mapApiError(err, "chapter.save").possiblyCommitted` + a scope-level terminal predicate for CORRUPT_CONTENT instead. [L6, C5]
- `useSnapshotState.ts:369-376` — `restoreSnapshot`'s follow-up `api.snapshots.list(restoringChapterId)` omits the signal param, unlike sibling `refreshCount` and chapter-switch effect. [L5, CS7]
- `useSnapshotState.ts:315` — inline `err.code === "BAD_JSON" && err.status >= 200 && err.status < 300` re-implements the mapper's 2xx BAD_JSON predicate. Intentional per comment; candidate for a mapper-exposed helper once the remap pattern is needed elsewhere. [C4]
- `useProjectEditor.ts:926-953` — `handleRenameChapter` has no AbortController (`handleStatusChange`/`handleUpdateProjectTitle` do); `api.chapters.update` already accepts an optional signal. [E7]
- `useProjectEditor.ts:687-753` — `handleReorderChapters` has no AbortController; `api.projects.reorderChapters` (`api/client.ts:242`) doesn't accept one either. [E8]
- `SnapshotPanel.tsx:271,289` — `api.snapshots.create` / `delete` accept signals but `handleCreate` / `handleDelete` pass none. [E9]
- `useSnapshotState.ts:415-421` — `refreshCount`'s `.catch(() => {})` bypasses the mapper. Silent count update is deliberate, but losing a real-connectivity signal entirely is inconsistent with the "single owner of classification" intent. [E10]
- `useProjectEditor.ts:797-809` and `:463-491` — recovery GETs on committed branches use captured `slug`. A rename that lands between the original POST and the recovery GET would make that captured slug stale; the inner GET 404s, the inner `catch {}` swallows it, the user sees the committed banner without the recovery effect. Narrow race but a known hazard. [L3, CS4, CS5]
- `useProjectEditor.ts:869` — `handleStatusChange` revert GET has no signal (token guards correctness; only wasted work). [CS8]
- `useProjectEditor.ts:755-816` — `handleUpdateProjectTitle` never nulls `titleChangeAbortRef` on success, unlike `handleStatusChange:842`. No correctness impact; consistency nit. [CS9]
- `ImageGallery.tsx:117,502` — `mapApiError(err, "image.references")` + announce duplicated at two sites; extract a helper. [C7]
- `ImageGallery.tsx:182-192` vs `:199-212` — `image.updateMetadata` catch duplicated between `handleSave` and `handleInsert`; fixing [I1] should collapse both through a shared helper. [C6]
- `apiErrorMapper.ts:109` — `scope.byCode?.[err.code]` walks the prototype chain. A hostile `err.code === "__proto__"` would return `Object.prototype`, which passes `!== undefined` and becomes the "message" (an object). Not exploitable in this single-user local deployment and the server doesn't emit such codes, but a one-line hardening (`Object.hasOwn(scope.byCode, err.code)` or a null-prototype-backed `byCode` map) closes the theoretical bypass. Same area: the lookup uses `err.code ?` (truthy) — an empty-string code would skip the byCode map entirely. [S1, L8]
- `sanitizer.ts:38` — `ALLOWED_ATTR = ["src", "alt"]` omits `title`. TipTap's Image extension schema declares `title`; a pasted image with a title attribute silently loses it on every round-trip through `sanitizeEditorHtml`. Smudge's current code never sets a title, so this is latent, but a future import/paste path will silently drop data. [S2]
- `sanitizer.ts` — no explicit `ALLOWED_URI_REGEXP` / `FORBID_PROTOCOLS`. TipTap disables base64 at input (`allowBase64: false`), but defense-in-depth is cheap: pin `ALLOWED_URI_REGEXP: /^https?:\/\/|^\/api\/images\//i` to match the only legitimate `<img src>` sources the app produces. [S3]
- `api/client.ts:117,157,186` — `await res.json()` has no client-side size cap. Not exploitable in single-user local; flag for future multi-tenant hardening. [S4]
- `apiErrorMapper.test.ts:560-598` — scope-completeness test uses a hand-typed literal list of all scopes, which drifts on any rename/add. Generate from `ALL_SCOPES` + a type-level `satisfies` check to eliminate the second source of truth. [C8]

## Plan Alignment

**Plan docs consulted:** `docs/plans/2026-04-23-unified-error-mapper-design.md`, `docs/plans/2026-04-23-unified-error-mapper-plan.md`, `docs/roadmap.md`.

- **Implemented:** All five planned commits landed (new `errors/` module, transport rewrite, centralized-already call sites, generic-fallback migration, raw-message-leak kills + CLAUDE.md). All scopes from design §3 are present plus four legitimate additions (`projectList.load`, `project.updateFields`, `image.list`, `image.references`). The resolver precedence matches design §2. `findReplaceErrors.ts` and test file are deleted (not just unused). Raw `err.message` reaches the UI from 0 sites — every path runs through `mapApiError`. Review-iteration commits I1–I13 + S1–S14 + C1 are traceable by in-code comment markers.
- **Not yet implemented (expected — partial is fine):** Phase 4b.4 ESLint enforcement of the mapper contract is explicitly deferred per plan §8 / CLAUDE.md. The `I10` removal of `err instanceof ApiRequestError` control-flow checks in favor of `isApiError`/`isAborted`/`isNotFound`/`isClientError` has landed in most sites; full migration remains a code-quality follow-up.
- **Deviations:**
  - Design §2 Rule 3 says 2xx BAD_JSON → `possiblyCommitted: true` unconditionally; implementation at `apiErrorMapper.ts:79-93` gates on `scope.committed !== undefined` (per the S7 in-code justification — GETs have no commit semantics). Behavior deviation documented in code but the design doc was not amended to match.
  - `committedCodes` on `ScopeEntry` is an architectural addition beyond the published §2 surface (added during S8). Genuine extension; correct; design doc not updated.
- **Scope creep (borderline):** `CONTRIBUTING.md` (196 lines), Node 22 LTS pin + DEP0040 suppression, vitest worker-concurrency cap, ESLint warm-up fix. The Node 22/DEP0040 and vitest/ESLint work is tied to the zero-warnings-in-test-output rule the mapper tests depend on. `CONTRIBUTING.md` is harder to justify as part of Phase 4b.3 and could ship as its own PR per CLAUDE.md's one-feature rule. Does not bundle other roadmap phases — only 4b.3.

## Review Metadata

- **Agents dispatched:** Logic & Correctness, Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment, Verifier (filter + severity)
- **Scope:** 15 client files (errors/, api/client.ts, affected hooks, EditorPage, ImageGallery, ProjectSettingsDialog, DashboardView, Editor.tsx, sanitizer.ts, strings.ts), 2 server files cross-checked for emitted error codes, plan/steering docs
- **Raw findings:** 51 pre-verification
- **Verified findings:** 9 Important + 16 Suggestions = 25 (down from 51 raw)
- **Filtered out:** 26 (duplicates merged into consolidated findings, false positives, design decisions, or out-of-scope)
- **Steering files consulted:** `CLAUDE.md`
- **Plan/design docs consulted:** `docs/plans/2026-04-23-unified-error-mapper-design.md`, `docs/plans/2026-04-23-unified-error-mapper-plan.md`, `docs/roadmap.md`
