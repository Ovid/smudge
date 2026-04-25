# Agentic Code Review: ovid/unified-error-mapper

**Date:** 2026-04-25 09:04:39
**Branch:** ovid/unified-error-mapper -> main
**Commit:** 4be5b49afb8061f3ce0a453ede7db828f9a6068a
**Files changed:** 60 | **Lines changed:** +9683 / -1031
**Diff size category:** Large

## Executive Summary

The unified error mapper (Phase 4b.3) is well-engineered: the resolver matches the design contract closely, the registry is symmetric with the `ApiErrorScope` union, prototype-pollution guards and the DOMPurify sanitizer hold up under scrutiny, and the cross-cutting invariants (ABORTED silent, NETWORK transient, 2xx BAD_JSON gated on scope.committed) work as designed. However, this review identified three Critical findings — all in the call-site migrations rather than the mapper itself — where shared abort refs, an unseeded `confirmedStatusRef`, and a missing project-drift guard on `handleReorderChapters`'s possiblyCommitted branch combine to produce silent state corruption under realistic user actions (cross-mutation interference, mid-flight chapter switches, cross-project navigation). The Important tier is dominated by missed `possiblyCommitted` branches at non-editor mutation sites and a handful of asymmetries between `apiFetch`'s I14 fix and the inline blob/multipart paths.

## Critical Issues

### [C1] Shared `recoveryGetAbortRef` lets a status-revert silently kill an in-flight create-recovery
- **File:** `packages/client/src/hooks/useProjectEditor.ts:142, 538, 905, 1006`
- **Bug:** Three handlers — `handleStatusChange`, `handleCreateChapter`, and `handleUpdateProjectTitle` — share a single `recoveryGetAbortRef`. Each replaces `recoveryGetAbortRef.current` and aborts whatever was on it. If `handleCreateChapter` is mid-recovery (post-2xx-BAD_JSON `api.projects.get` to repaint the sidebar) and a `handleStatusChange` revert fires, the create's recovery GET is aborted. The create's recovery body is wrapped in a bare `try { ... } catch {}` (around line 565), so the abort is silently swallowed. The committed banner has already been surfaced via `onError(message)`, but the new chapter never lands in the sidebar.
- **Impact:** Writer sees "your chapter may have been created — refresh the page" while clicking around the project, but no new chapter ever appears in the sidebar even after waiting for the recovery to "succeed." Combined with the dialog still being closed, users will retry from the menu and create duplicates, or refresh and find the chapter exists — but the state on screen until refresh is misleading.
- **Suggested fix:** Give each recovery-firing handler its own AbortRef (e.g. `createRecoveryAbortRef`, `statusRecoveryAbortRef`, `titleRecoveryAbortRef`), each cleaned up on its own follow-up. Alternatively, change each recovery `try {...} catch (recoveryErr) {}` to inspect `signal.aborted` and treat it as supersession by a sibling rather than a true silent failure.
- **Confidence:** High
- **Found by:** Concurrency & State

### [C2] `confirmedStatusRef` is never seeded for chapters created or restored after initial load
- **File:** `packages/client/src/hooks/useProjectEditor.ts:201, 488` and `packages/client/src/hooks/useTrashManager.ts:50-66`
- **Bug:** `confirmedStatusRef.current` is seeded only inside `loadProject().then` (line 201). Newly-created chapters from `handleCreateChapter` (both happy path at line 488 and possiblyCommitted recovery), and restored chapters from `useTrashManager.handleRestore`, are inserted into project state but never seeded into `confirmedStatusRef`. If the user then clicks a status pill on such a chapter and the PATCH fails with a non-committed terminal code AND the recovery `api.projects.get` also fails, `previousStatus` is `undefined`, so the local-revert branch at `useProjectEditor.ts:1048` (`if (!reverted && previousStatus !== undefined)`) is silently skipped — leaving the optimistic status on screen even though the server never accepted it.
- **Impact:** Corrupts the displayed status vs. server truth on any post-load chapter that experiences a double-failure (PATCH + recovery GET). The I21 commit explicitly redirected the revert path through `confirmedStatusRef` to fix the X→A→B race, but the cache only reflects chapters present at project-load time.
- **Suggested fix:** Seed `confirmedStatusRef.current[newChapter.id] = newChapter.status` next to the `setActiveChapter(newChapter)` in `handleCreateChapter` (both happy and recovery branches), and in `useTrashManager.handleRestore` next to the `setProject(...)` block. Also seed inside the `chapter.create` recovery's `for (added) ... setActiveChapter(newest)` branch.
- **Confidence:** High
- **Found by:** Logic & Correctness (Callsites)

### [C3] `handleReorderChapters` possiblyCommitted setProject lacks project drift guard
- **File:** `packages/client/src/hooks/useProjectEditor.ts:839-850`
- **Bug:** The success path of `handleReorderChapters` checks `projectRef.current?.id !== projectId` (and the slug) before applying the new order. The possiblyCommitted branch (lines 839-850) does NOT re-check, so if the user navigates A→B mid-PUT and the response lands as 2xx BAD_JSON on A, the optimistic-state apply commits A's `orderedIds` to B's `prev.chapters` via `find()`. With non-overlapping chapter IDs across projects, every `find()` returns undefined and the chapter list collapses to empty until the next refresh.
- **Impact:** Cross-project nav during a slow reorder + 2xx BAD_JSON wipes the new project's sidebar of every chapter. A reload restores it, but the intermediate state is alarming and could cause writers to think their chapters were deleted.
- **Suggested fix:** Wrap the possiblyCommitted `setProject` in the same `projectRef.current?.id === projectId` slug+id guard as the success path; if mismatched, skip the local apply and leave the committed banner as the only signal.
- **Confidence:** High
- **Found by:** Concurrency & State

## Important Issues

### [I1] `projects.export` blob-read missing TypeError → NETWORK reclassification
- **File:** `packages/client/src/api/client.ts:324-331`
- **Bug:** `apiFetch` (lines 200-202) and `images.upload` (lines 423-425) both catch `TypeError` from the 2xx body-read and re-throw via `classifyFetchError` so a stream-level fault becomes `NETWORK`/`transient`. The export blob-read at lines 324-330 only catches `AbortError` — a `TypeError` falls into the `BAD_JSON` arm with `status=res.status` (2xx). The I14 review-fix comment in `apiFetch` promises symmetric handling and the export branch silently violates it.
- **Impact:** A TCP reset between headers and the export body would be misclassified as `BAD_JSON`. With the current `export.run` scope (no `committed:`) this is benign today, but any future addition of `committed:` to the scope would falsely surface "your export may have completed" to the user.
- **Suggested fix:** Insert `if (err instanceof TypeError) throw classifyFetchError(err);` before the BAD_JSON throw at line 329, mirroring lines 200-202 and 423-425.
- **Confidence:** High
- **Found by:** Logic & Correctness (Core)

### [I2] `export.run` scope is missing `network:` (and `byStatus[413]`)
- **File:** `packages/client/src/errors/scopes.ts:284`
- **Bug:** Every other scope declares both `fallback` and `network`. `export.run` declares only `fallback`. A NETWORK classification yields the generic `STRINGS.export.errorFailed` ("Export failed") instead of a "check your connection" hint. The mapper still sets `transient: true`, but `ExportDialog.handleExport` doesn't consume that flag. A 413 export-too-large is also indistinguishable from a server error.
- **Impact:** Offline export and export-too-large both show identical generic copy with no actionable retry/reduce-scope guidance.
- **Suggested fix:** Add `network: STRINGS.export.errorFailedNetwork` (introducing the string) and a `byStatus[413]` entry; consider `committed:` if the server can ever 2xx-BAD_JSON an export. The handler doesn't need changes once the scope grows.
- **Confidence:** High
- **Found by:** Logic & Correctness (Core), Logic & Correctness (Callsites), Contract & Integration

### [I3] `apiFetch` !ok body-read and `readErrorEnvelope` don't classify TypeError as NETWORK
- **File:** `packages/client/src/api/client.ts:166-176, 122-135`
- **Bug:** The 2xx body-read branch correctly distinguishes TypeError (NETWORK/transient) from SyntaxError (BAD_JSON/possiblyCommitted) per the I14 fix. The 4xx/5xx body-read branch (apiFetch line 166-176) and `readErrorEnvelope` (used by `images.upload` and `projects.export` !ok handling) only catch AbortError; a TypeError falls through to a status-only error with no code, losing the stream-level classification. Asymmetric.
- **Impact:** A TCP reset mid-error-body shows a status-only "HTTP 5xx" error instead of a "check your connection" hint, and the mapper's NETWORK branch is unreachable for this path. Less severe than the 2xx case (the user still sees an error), but inconsistent with the deliberate I14 invariant.
- **Suggested fix:** Mirror the 2xx body-read branch: `if (err instanceof TypeError) throw classifyFetchError(err);` in both `apiFetch`'s !ok catch and `readErrorEnvelope`.
- **Confidence:** Medium-High
- **Found by:** Logic & Correctness (Core), Error Handling

### [I4] `ImageGallery.handleSave` and `handleInsert` ignore `possiblyCommitted`
- **File:** `packages/client/src/components/ImageGallery.tsx:236-242, 260-266`
- **Bug:** Both metadata-update catches destructure only `{ message }` from `mapApiError(err, "image.updateMetadata")`. The scope declares `committed: STRINGS.error.possiblyCommitted`, so a 2xx BAD_JSON yields `possiblyCommitted: true`. Sibling handlers `handleFileSelect` (line 197) and `handleDelete` (line 298) branch on `possiblyCommitted` and call `incrementRefreshKey()`; these two paths don't.
- **Impact:** On 2xx BAD_JSON metadata save, the detail view stays pinned to pre-save metadata while the server has the new metadata. A retry could 404 (the field was already committed) and the user has no way to know what state they're in.
- **Suggested fix:** Destructure `possiblyCommitted` and on `true` call `incrementRefreshKey()` (and refresh `selectedImage` similarly to the success branch) before announcing the message.
- **Confidence:** High
- **Found by:** Logic & Correctness (Callsites)

### [I5] `HomePage.handleCreate` ignores `possiblyCommitted` for `project.create`
- **File:** `packages/client/src/pages/HomePage.tsx:49-53`
- **Bug:** `mapApiError(err, "project.create")` is destructured to `{ message }` only. The `project.create` scope declares `committed: STRINGS.error.possiblyCommitted`, so 2xx BAD_JSON returns `possiblyCommitted: true`. Today the dialog stays open and shows the committed message without any list refresh — inviting a retry that would create a duplicate (project create is non-idempotent).
- **Impact:** Realistic write-amplification: writer clicks Create, sees an unreadable-response banner, clicks Create again (because the dialog is still open with their input), creates two projects.
- **Suggested fix:** Destructure `possiblyCommitted`; on true, refresh `api.projects.list` and close the dialog before showing the banner so the just-created row appears and the user has no live "Create" button to re-fire. The slug isn't available in the unreadable response, so navigation can't be performed automatically — refresh-and-close is the safe default.
- **Confidence:** High
- **Found by:** Logic & Correctness (Callsites)

### [I6] Stale-chapter possiblyCommitted snapshot-restore banner has no chapter-attribution
- **File:** `packages/client/src/pages/EditorPage.tsx:528-541`
- **Bug:** The possiblyCommitted branch of `handleRestoreSnapshot` surfaces `STRINGS.snapshots.restoreResponseUnreadable` via `setActionError(message)` after the user has already switched chapters mid-restore. The banner copy contains no chapter title or context, so the writer sees "the restore was committed; refresh" while looking at a chapter the restore did not target.
- **Impact:** Banner attribution drift — the user can mistakenly attribute the message to the chapter they're looking at and refresh against the wrong context, or simply lose track of which chapter has unverified state.
- **Suggested fix:** Include the originating chapter title in the action error string (e.g. `STRINGS.snapshots.restoreCommittedOnOtherChapter(activeChapter.title)`) so the banner identifies which chapter the user should refresh against.
- **Confidence:** Medium
- **Found by:** Logic & Correctness (Callsites)

### [I7] `confirmedStatusRef` is not reset on `loadProject` start (only on success)
- **File:** `packages/client/src/hooks/useProjectEditor.ts:201`
- **Bug:** `confirmedStatusRef.current = Object.fromEntries(...)` runs only inside the `loadProject` success path. On a failed loadProject (network error, 5xx), the ref retains the previous project's status table. The hook persists across slug changes (refs survive); subsequent status-revert reads run against the stale baseline.
- **Impact:** Compounds [C2]. On project-switch with a failed load, status reverts on the new (partially-rendered) project use the prior project's confirmed-status cache.
- **Suggested fix:** Reset `confirmedStatusRef.current = {}` at the start of `loadProject` (inside the slug-change effect), alongside the other resets.
- **Confidence:** Medium-High
- **Found by:** Concurrency & State

### [I8] `useSnapshotState.restoreSnapshot` follow-up list shares the controller with the restore POST
- **File:** `packages/client/src/hooks/useSnapshotState.ts:387-392`
- **Bug:** The follow-up `api.snapshots.list(restoringChapterId, controller.signal)` reuses the same controller as the restore POST. If a new restore is then issued, `restoreAbortRef.current?.abort()` aborts that controller — including the in-flight follow-up list from the prior call.
- **Impact:** The toolbar `snapshotCount` badge stays stale through rapid restore-then-restore until the next chapter-switch refetch.
- **Suggested fix:** Allocate a separate AbortController for the follow-up list, or accept the staleness with an explicit comment.
- **Confidence:** Medium-High
- **Found by:** Concurrency & State

### [I9] `Editor.tsx` paste-upload fires gallery-refresh on the wrong project after a project switch
- **File:** `packages/client/src/components/Editor.tsx:271-292`
- **Bug:** The paste-upload handler reads `projectIdRef.current` at upload-START to invoke `api.images.upload`. On 2xx BAD_JSON or success, the response handler calls `onImageUploadCommittedRef.current?.()` and `onImageAnnouncementRef.current?.()` against whichever ref values are current at response time. If the user navigates A→B mid-upload (the Editor doesn't necessarily remount on project change), the gallery-refresh callback fires for project B for an upload that landed against project A. This is the gallery-refresh-on-wrong-project case the design doc note hinted at but did not seal.
- **Impact:** Wrong gallery refreshes; misleading announcement copy. The image was committed to project A but the user is on project B and sees no evidence — and a refresh of B's gallery shows nothing new.
- **Suggested fix:** Capture `projectIdRef.current` at upload-start and gate the gallery-refresh / committed callback on `projectIdRef.current` still matching the captured value.
- **Confidence:** Medium-High
- **Found by:** Concurrency & State

### [I10] `ProjectSettingsDialog` field/timezone abort refs not aborted on dialog re-open
- **File:** `packages/client/src/components/ProjectSettingsDialog.tsx:55, 140-146`
- **Bug:** `fieldAbortRef` and `timezoneAbortRef` are aborted only on unmount. The dialog can close→reopen within the same component lifetime; an in-flight PATCH from the prior open-cycle can land after re-open and baseline `confirmedFieldsRef.current.X = data.X` against stale input. The next save's revert restores the wrong value.
- **Impact:** Edge-case state corruption when a user closes the dialog mid-PATCH and reopens it before the response arrives.
- **Suggested fix:** Abort `fieldAbortRef.current` and `timezoneAbortRef.current` on the `open=false→true` transition (in the existing `useEffect([open])` block) — or on the close transition.
- **Confidence:** Medium-High
- **Found by:** Concurrency & State

### [I11] `EditorPage.handleProjectSettingsUpdate` GET lacks AbortController
- **File:** `packages/client/src/pages/EditorPage.tsx:1471-1510`
- **Bug:** The post-update `api.projects.get(slug)` uses no signal. If the component unmounts (project switch via `navigate('/')`) between dispatch and resolve, `setProject(prev => …)` fires post-unmount, and the 404 branch's `navigate("/")` runs without an unmount guard.
- **Impact:** Post-unmount setState; React 18 swallows but it's still leaky and inconsistent with the rest of the branch's I22-style abort threading.
- **Suggested fix:** Thread an AbortController, abort on unmount via a ref, gate setState/navigate on `signal.aborted`.
- **Confidence:** High
- **Found by:** Concurrency & State

### [I12] `EditorPage.handleProjectSettingsUpdate` catch path doesn't gate on busy
- **File:** `packages/client/src/pages/EditorPage.tsx:1497-1510`
- **Bug:** The success path skips the merge when `mutation.isBusy() || isActionBusy()` returns true (line 1483); the catch path always sets `actionError` regardless of busy state. Inconsistent.
- **Impact:** A settings GET that fails while the editor is mid-mutation will surface a banner that fights with the mutation's own UI state.
- **Suggested fix:** Mirror the busy gate in the catch branch, or abort the GET on busy entry.
- **Confidence:** Medium
- **Found by:** Concurrency & State

## Suggestions

- `EditorPage.tsx:35` imports `ApiRequestError` directly from `../api/client` — breaks the I16 barrel-only invariant; switch to `import { ApiRequestError } from "../errors"`.
- `ImageGallery.tsx:568-569` Delete-click `api.images.references` refresh path doesn't thread an AbortSignal (load effect at line 142 does).
- `useTrashManager.ts:53` is the only migrated mutation without an AbortSignal — `api.chapters.restore` doesn't accept one yet (transport gap at `api/client.ts:367-370`).
- `useTrashManager.ts:111-117` post-delete trash refresh lacks an AbortSignal; setState fires on torn-down component if delete completes near unmount.
- `useTrashManager.ts:103-117` `confirmDeleteChapter` has bare `catch {}` blocks; trash-refresh failure after a successful delete is silently accepted.
- `useProjectEditor.ts:189-242` initial load still uses `let cancelled = false` — pattern intentionally replaced elsewhere on this branch.
- `HomePage.tsx`, `DashboardView.tsx`, `useTrashManager.ts` — `console.warn`/`error` ordering before vs after the `message === null` check drifts across siblings; tighten by always logging after the null-check.
- `useEditorMutation.ts:254` re-lock-fail catch runs `cancelPendingSaves` but the new Editor's local `debounceTimer` ref survives until naturally fired; the fired save would bail on `isStale()` so data integrity holds, only wasted work.
- `useTimezoneDetection.ts:24` auto-detect PATCH races a dialog timezone PATCH; SQLite serialization order determines winner. Already acknowledged in the comment.
- `useSnapshotState.ts:210` panel-toggle-during-chapter-switch can fire two GETs (hook effect + panel mount); token guards prevent stale data; just duplicate GETs.
- `apiErrorMapper.ts:96` 2xx BAD_JSON branch includes 204; only reachable via hand-constructed `ApiRequestError` since `apiFetch` short-circuits 204. Latent.
- `apiErrorMapper.ts:126` byCode lookup is case-sensitive UPPER_SNAKE; a future server drift to lower-case or whitespace-padded codes would silently miss byCode entries and fall through to byStatus.
- `scopes.ts` `image.upload` has both `byCode.VALIDATION_ERROR` and `byStatus[404]` — byCode beats byStatus. If the server ever pairs (404, VALIDATION_ERROR), the user sees "check the file" instead of "project gone." Latent.
- `scopes.ts:87-108` `chapter.save` is missing `network:`; the save retry loop hard-codes `STRINGS.editor.saveFailed` for the post-retry message, so adding `network:` alone has no UX effect today (would need a call-site change to consume the mapper's network field).
- `api/client.ts:91-102` `extractExtras` doesn't reject array `errorBody` — `{"error":["a","b"]}` would yield extras with numeric-string keys. Server contract never ships array-as-error. Latent.
- `api/client.ts:118, 158` `body.error?.message ?? fallbackMessage` keeps empty-string messages; `[dev]` prefix invariant silently broken on empty-string messages. Server contract doesn't ship empty strings. Latent.
- `api/client.ts:41-51` `ApiRequestError.code` is typed `string | undefined` but runtime accepts any JSON value; mapper guards via `Object.hasOwn` + `typeof === "string"`, so type-laundering doesn't reach the UI but isn't enforced at construction.

## Plan Alignment

The branch is genuinely a single-feature implementation of Phase 4b.3 per `docs/plans/2026-04-23-unified-error-mapper-design.md`. The 5-commit plan-shape is identifiable in the log; everything after is review-fix iteration (105 commits total).

- **Implemented:** `mapApiError`/`MappedError`/`ScopeEntry` resolver matches the design's 7-step algorithm; `findReplaceErrors.ts` deleted; `useSnapshotState` failure arm carries `ApiRequestError` (success-arm `superseded`/`staleChapterSwitch`/`restoredChapterId` preserved); `ApiError` widened with `[key: string]: unknown`; `ApiRequestError` carries `extras`; `images.delete` no longer has the DELETE special case; CLAUDE.md §Key Architecture Decisions has the "Unified API error mapping" entry; §Target Project Structure lists `errors/`. Coverage thresholds intact at 95/85/90/95.
- **Deviations from plan:** `MappedError.message` is `string | null` (not `string`) — defensible refinement. `committedCodes` array on scope entries (not in plan §3) added in S8 to avoid per-call-site code allowlists for `RESTORE_READ_FAILURE` / `READ_AFTER_CREATE_FAILURE`. `EditorPage` retains a thin `RestoreFailedError` / `RestoreAbortedError` sentinel-wrapper around `ApiRequestError` to thread errors through `useEditorMutation` — not strictly an inline ladder but not anticipated by the plan.
- **Scope creep / out-of-band:** Broad AbortSignal-threading sweep (10+ files via I3-I11, C5) that grew during review iteration — causally tied to the mapper's silent-ABORTED invariant but is a meaningful sibling refactor by itself. New `sanitizer.ts` (+42 lines) and tests (+107) — incidental hardening of the snapshot-render path discovered during review. CONTRIBUTING.md (+196 lines), package.json engine pin / DEP0040 suppression, Makefile changes, vitest worker concurrency cap — review-iteration plumbing.
- **Not yet implemented:** ESLint enforcement of the mapper invariant — deferred to Phase 4b.4 by design.

By CLAUDE.md §Pull Request Scope's "one-feature rule" the AbortSignal sweep is borderline; it could have been a sibling PR but is justifiable as a load-bearing prerequisite for the mapper's silent-ABORTED guarantee.

## Review Metadata

- **Agents dispatched:** Logic & Correctness (Core), Logic & Correctness (Callsites), Error Handling & Edge Cases, Contract & Integration, Concurrency & State, Security, Plan Alignment
- **Scope:** All 60 changed files in `packages/client/src/`, `packages/shared/src/`, plus design/plan/CLAUDE.md/CONTRIBUTING.md context
- **Raw findings:** 38 (before verification)
- **Verified findings:** 31 (3 Critical, 13 Important, 15 Suggestion)
- **Filtered out:** 7 (4 outright rejected — F15, F17, F18, F37; 3 merged into other findings — F19 into I3, F12 into Suggestions, F22 into Suggestions)
- **Steering files consulted:** `CLAUDE.md`
- **Plan/design docs consulted:** `docs/plans/2026-04-23-unified-error-mapper-design.md`, `docs/plans/2026-04-23-unified-error-mapper-plan.md`, `docs/roadmap.md`
