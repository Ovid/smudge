# Agentic Code Review: ovid/unified-error-mapper

**Date:** 2026-04-24 09:56:08
**Branch:** ovid/unified-error-mapper → main
**Commit:** 54a8ba983ba93b12186a1e1d14474f4a9391c59d
**Files changed:** 38 | **Lines changed:** +4,938 / −787
**Diff size category:** Large

## Executive Summary

Phase 4b.3 — the unified API error mapper — is broadly sound. The core `mapApiError` resolver, scope registry, transport extras contract, and the migration of 45+ call sites all landed cleanly, and a prior code-review cycle (I1–I8, S1–S14) had already corrected the first pass. No Critical findings. The remaining issues cluster in three buckets: (1) **transport edge cases** around aborted body-reads and the blob download path that can leak raw DOMExceptions past the mapper contract; (2) **scope coverage gaps** — `image.upload` misses 413, `project.updateTitle`/`project.create` miss the "title exists" code, `trash.restoreChapter` misses `RESTORE_READ_FAILURE`, and `chapter.save`'s retry loop never sees a 2xx BAD_JSON branch; (3) **Definition-of-Done deviations** — a design-spec shared default (`STRINGS.error.possiblyCommitted`) was silently replaced with an S7 carve-out that drops the ambiguous-commit UX from 11 mutation scopes, and 8 call sites still branch on `err instanceof ApiRequestError` for control flow despite the DoD bullet forbidding it.

## Critical Issues

None found.

## Important Issues

### [I1] `image.upload` scope lacks 413 PAYLOAD_TOO_LARGE coverage — drag-dropped large images are told to "check your connection"
- **File:** `packages/client/src/errors/scopes.ts:97`
- **Bug:** Server emits 413 `PAYLOAD_TOO_LARGE` from multer at `packages/server/src/images/images.routes.ts:39-40`. The `image.upload` scope is `{ fallback: STRINGS.imageGallery.uploadFailedGeneric }` — no `byStatus`, no `byCode`. A 413 falls through to the generic fallback copy: *"Upload failed. Check your connection and try again."*
- **Impact:** Before the migration, `ImageGallery.tsx` interpolated the server message via `uploadFailed(reason)` and the user saw the correct "file too large" text. After migration, **the 413 path is misrouted to "check your connection"** — a functional regression. `ImageGallery.handleFileSelect` has a client-side size pre-check, so file-picker uploads are safe, but Editor.tsx drag-drop and paste paths bypass that guard and trigger the real 413.
- **Suggested fix:** Add `byStatus: { 413: STRINGS.imageGallery.fileTooLarge }` (and `byCode: { PAYLOAD_TOO_LARGE: STRINGS.imageGallery.fileTooLarge }` for defense-in-depth) to the `image.upload` scope. The `fileTooLarge` string already exists at `strings.ts:293`.
- **Confidence:** High
- **Found by:** Contract & Integration

### [I2] `readErrorEnvelope` swallows body-read AbortError — cancelled exports/uploads surface as fake errors
- **File:** `packages/client/src/api/client.ts:99`
- **Bug:** `readErrorEnvelope`'s `catch {}` swallows every `res.json()` failure including `DOMException` with `name === "AbortError"`. The sibling `apiFetch` body-read at `client.ts:139-141` correctly re-throws via `classifyFetchError`, preserving the ABORTED contract. Both `projects.export` (line 244) and `images.upload` (line 314) call `readErrorEnvelope`.
- **Impact:** When a user cancels an in-flight export or image upload after headers arrive but before the error body is parsed, they get an `ApiRequestError(fallbackMessage, status, undefined, undefined)` instead of the ABORTED signal. The mapper cannot silence a cancelled request the user explicitly initiated — an error toast appears for what the user just cancelled.
- **Suggested fix:** In `readErrorEnvelope`, mirror `apiFetch`'s pattern:
  ```ts
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw classifyFetchError(err);
    }
    return { message: fallbackMessage, code: undefined, extras: undefined };
  }
  ```
- **Confidence:** High
- **Found by:** Logic & Correctness, Error Handling & Edge Cases

### [I3] `projects.export` blob body-read has no `.catch` — raw DOMException/TypeError escapes ApiRequestError contract
- **File:** `packages/client/src/api/client.ts:251`
- **Bug:** `return res.blob();` is bare. The sibling `images.upload` body-read (lines 324-330) wraps `res.json()` to distinguish AbortError from other parse failures and convert to `BAD_JSON`. `apiFetch` does the same (lines 152-158). An abort during blob download, or a truncated 2xx response, surfaces as a raw `DOMException`/`TypeError` that falls into the `!isApiRequestError` branch of the mapper and returns `scope.fallback` for `export.run`.
- **Impact:** An aborted export shows a "failed" toast instead of being silent. A truncated blob looks like a generic failure rather than `BAD_JSON` (which the mapper could route through a `committed:` arm if the scope opted in).
- **Suggested fix:** Wrap the blob read:
  ```ts
  return res.blob().catch((err: unknown) => {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw classifyFetchError(err);
    }
    const message = err instanceof Error ? err.message : "[dev] Malformed export response";
    throw new ApiRequestError(message, res.status, "BAD_JSON");
  });
  ```
- **Confidence:** High
- **Found by:** Logic & Correctness

### [I4] Design deviation: `STRINGS.error.possiblyCommitted` shared default omitted — 11 mutation scopes silently drop the ambiguous-commit UX
- **File:** `packages/client/src/errors/apiErrorMapper.ts:41-44` + `packages/client/src/errors/scopes.ts` (entries missing `committed:`)
- **Bug:** Design §2 step 3 specifies `{ message: scope.committed ?? STRINGS.error.possiblyCommitted, possiblyCommitted: true }`. The implementation instead uses the S7 carve-out: `possiblyCommitted: scope.committed !== undefined`. The shared `STRINGS.error.possiblyCommitted` string was never added. For mutation scopes without a `committed:` entry — `chapter.save`, `chapter.delete`, `chapter.rename`, `project.create`, `project.delete`, `image.upload`, `image.delete`, `image.updateMetadata`, `snapshot.create`, `snapshot.delete`, `settings.update`, `trash.restoreChapter` — a 2xx BAD_JSON is indistinguishable from a 500 and the caller cannot detect an ambiguous-commit state.
- **Impact:** The `chapter.save` path in particular is the app's most load-bearing mutation. A 2xx BAD_JSON on save returns `possiblyCommitted: false` and routes through the `saveFailed` fallback — the user is told the save failed when the server may have committed, and will retry. Design §2 "Key invariants enforced by the single code path" states *"2xx BAD_JSON is always `possiblyCommitted: true`. No scope can forget this and show a toast when it should lock."* The S7 carve-out directly contradicts this.
- **Suggested fix:** Pick one: (a) restore the design's shared default, add `STRINGS.error.possiblyCommitted`, and set `possiblyCommitted: true` unconditionally on 2xx BAD_JSON; or (b) audit every mutation scope and add a `committed:` entry (minimum set: `chapter.save`, `project.delete`, `image.delete`, `image.updateMetadata`, `snapshot.delete`, `settings.update`, `trash.restoreChapter`). The S7 rationale — "GET scopes don't commit" — is valid, but applying it as scope-opt-in to every mutation is stricter than the design intended.
- **Confidence:** High
- **Found by:** Logic & Correctness, Plan Alignment

### [I5] `chapter.save` retry loop lacks BAD_JSON / UPDATE_READ_FAILURE branches — server-committed saves shown as "Save failed"
- **File:** `packages/client/src/hooks/useProjectEditor.ts:237-277`
- **Bug:** The catch handles `ABORTED` and `err.status >= 400 && < 500`. A 2xx BAD_JSON (status 200, code BAD_JSON) falls into the `if (attempt < MAX_RETRIES)` backoff — the server likely committed the PATCH, but the client retries idempotently for up to 14s and then surfaces the generic `saveFailed` copy. Server 500s including `UPDATE_READ_FAILURE` (chapters.routes.ts:43-50 — "row was updated but re-read failed") and `CORRUPT_CONTENT` are also retried pointlessly. None of these codes are in the `chapter.save` scope's `byCode` (scopes.ts:66-70).
- **Impact:** Compounds I4. The user sees "Saving…" for 14s on what was actually a successful save, then a misleading failure banner. Either the retry loop commits again (harmless for identical content) or a user rage-type/refresh triggers a real race between the retry and the next keystroke.
- **Suggested fix:** Add a 2xx BAD_JSON branch that exits the retry loop and routes through a new `committed:` copy (see I4 first). Add `byCode: { UPDATE_READ_FAILURE: ..., CORRUPT_CONTENT: ... }` to the `chapter.save` scope. On BAD_JSON / UPDATE_READ_FAILURE, lock the editor per save-pipeline invariant #1 rather than retry.
- **Confidence:** High
- **Found by:** Error Handling & Edge Cases, Concurrency & State, Contract & Integration

### [I6] `image.references` scope registered but both call sites silently swallow — user can click Delete on stale "no references" state
- **File:** `packages/client/src/components/ImageGallery.tsx:106-111` (initial load) and `:476-479` (pre-delete refresh)
- **Bug:** The `image.references` scope exists in `scopes.ts:94-96` but neither call site invokes `mapApiError`. Both silently `setReferences([]); setReferencesLoaded(true);`. The second site is critical: it's the refresh the user triggers when they click Delete to confirm intent. If the refresh fails, `isUsed` evaluates `false` and the UI presents the plain "Delete this image?" confirm — the server's 409 IMAGE_IN_USE recovers afterward, but the delete flow is already in motion.
- **Impact:** A user can issue a delete against a still-referenced image because a transient network failure silently cleared the references state. The server's 409 prevents actual data loss, but the UX invited a destructive action it shouldn't have.
- **Suggested fix:** In both catches, call `mapApiError(err, "image.references")`. On failure, keep `referencesLoaded=false` (render the "Loading…" state rather than the unsafe confirm) and surface the mapped message via `announce()` so the user knows references couldn't be verified.
- **Confidence:** High
- **Found by:** Logic & Correctness (hooks/pages), Error Handling, Plan Alignment

### [I7] `handleCreateChapter` possiblyCommitted path doesn't set the new chapter as active
- **File:** `packages/client/src/hooks/useProjectEditor.ts:388-401`
- **Bug:** The happy path calls `setActiveChapter(newChapter)` + `setChapterWordCount(0)` + appends to project chapters (lines 363-365). The possiblyCommitted / READ_AFTER_CREATE_FAILURE recovery path refreshes the project list (`api.projects.get(slug)` → `setProject(refreshed)`) but does not set `activeChapter`. The new chapter appears in the sidebar but the user stays on the previously-active chapter.
- **Impact:** Subtle UX regression. The committed-banner copy says "Chapter may have been created — refresh to see the current list"; the user then sees the new row in the sidebar (because of the background refresh) and clicks it manually. The intent of C1 was that the recovery path should leave the user on the created chapter the same way the happy path does.
- **Suggested fix:** After the refresh, diff `refreshed.chapters` against `projectRef.current?.chapters` to identify the new row, and call `setActiveChapter` on it. Alternatively, match on the chapter id if the server envelope included it (READ_AFTER_CREATE_FAILURE usually does).
- **Confidence:** Medium
- **Found by:** Logic & Correctness (hooks/pages)

### [I8] `ProjectSettingsDialog.saveField` possiblyCommitted branch skips `onUpdate()` — parent project state stays stale
- **File:** `packages/client/src/components/ProjectSettingsDialog.tsx:159-171`
- **Bug:** On happy path (line 144), `onUpdate()` fires, triggering EditorPage's `handleProjectSettingsUpdate` to refresh the project. On `possiblyCommitted` the code promotes optimistic state to confirmed locally but does NOT call `onUpdate()`. EditorPage's `project` (consumed by `ProgressStrip`, `DashboardView`, `velocity`) stays on pre-change values.
- **Impact:** User saves a new target_word_count → server returns 2xx BAD_JSON → dialog shows the "committed banner" copy and locally reflects the new value → user closes the dialog → dashboard/progress strip still render the old target. User concludes the save didn't actually work, re-opens settings, sees the confirmed value, and is confused. Contradicts the committed banner's message.
- **Suggested fix:** Call `onUpdate()` on the `possiblyCommitted` branch too. The parent's GET refresh is best-effort; on 404 it navigates home, which is correct if the server state has diverged.
- **Confidence:** High
- **Found by:** Logic & Correctness (hooks/pages)

### [I9] `ProjectSettingsDialog` settings.get silently falls back to UTC — next save overwrites stored timezone with wrong baseline
- **File:** `packages/client/src/components/ProjectSettingsDialog.tsx:92-97`
- **Bug:** The dialog opens and calls `api.settings.get()`. The `.catch` silently falls back to `"UTC"` with no `mapApiError` routing and no scope in the registry (`settings.get` is listed in design §3 but absent from `scopes.ts`). A real settings-fetch failure (5xx, transient NETWORK, etc.) looks identical to "UTC is the stored value." The user then sees UTC in the dropdown, changes to their correct timezone, and saves — the save goes through, but now their stored value was overwritten from whatever-it-was to their new choice. If the fetch was a transient failure and the stored value was already their correct timezone, no harm; if the stored value was something different, silent data loss.
- **Impact:** Narrow — single-user local deployment, settings are write-rare — but the failure mode is silent. `useTimezoneDetection` has legitimate silent semantics because it only runs when no timezone exists; this path is the user-initiated dialog, where hiding a real failure from the user is wrong.
- **Suggested fix:** Add `settings.get` to `scopes.ts`, route the catch through `mapApiError(err, "settings.get")`, and surface the mapped message (and maybe keep the dropdown disabled) so the user knows to retry rather than silently save over their real timezone.
- **Confidence:** Medium
- **Found by:** Logic & Correctness (hooks/pages), Plan Alignment

### [I10] 8 call sites still use `err instanceof ApiRequestError` for control flow — DoD bullet explicitly forbids the pattern
- **Files:**
  - `packages/client/src/components/SnapshotPanel.tsx:284`
  - `packages/client/src/hooks/useFindReplaceState.ts:230`
  - `packages/client/src/hooks/useProjectEditor.ts:241, 244, 387`
  - `packages/client/src/hooks/useSnapshotState.ts:275, 360`
  - `packages/client/src/pages/EditorPage.tsx:1068, 1461`
- **Bug:** Design §12 DoD bullet 2 says: *"No call site in `packages/client/src/` contains inline error-to-text mapping (no `err instanceof ApiRequestError ? ... : ...`, no hand-rolled code ladders, no `err.message` reaching the UI)."* The sites above are control-flow uses (status-based results clearing, 404 short-circuits, ABORTED early-returns, READ_AFTER_CREATE_FAILURE branch) — not text mapping per se, but literally violate the DoD phrasing. The mapper's own `isApiRequestError` at `apiErrorMapper.ts:21` is the only sanctioned owner of this check.
- **Impact:** The `useFindReplaceState` site in particular reimplements "is this error transient?" via direct `err.status` inspection when `mapped.transient` would be the mapper-owned signal — future drift when the mapper's notion of transience broadens. Others are narrower but preserve the anti-pattern the migration was meant to eliminate.
- **Suggested fix:** For each site, either (a) add a discriminant to the mapper's `MappedError` (e.g. `aborted: boolean`, `notFound: boolean`) and consult that; or (b) add a helper in `errors/` (`isAborted(err)`, `isNotFound(err)`) so call sites depend on the mapper module rather than on `ApiRequestError` directly.
- **Confidence:** Medium
- **Found by:** Plan Alignment (overlaps Error Handling E7)

### [I11] `handleStatusChange` sends PATCH with no AbortController — rapid status clicks race at the server
- **File:** `packages/client/src/hooks/useProjectEditor.ts:734-735`
- **Bug:** `await api.chapters.update(chapterId, { status });` has no `signal` argument. `api.chapters.update` accepts one (client.ts:268). The `statusChangeSeq` token only discards response *processing* — both PATCHes still reach the server, and server ordering is undefined. Sibling patterns in the same file (`saveAbortRef`) and component (`timezoneAbortRef` in ProjectSettingsDialog) already use abort-then-reissue.
- **Impact:** Rapid A→B→C status clicks leave the server in indeterminate state while the client displays C. Desync persists until next chapter load. Low-probability but real.
- **Suggested fix:** Add `statusChangeAbortRef` mirroring `saveAbortRef`; abort the prior controller before issuing a new PATCH; thread the signal into `api.chapters.update`.
- **Confidence:** High
- **Found by:** Concurrency & State

### [I12] `project.updateTitle` and `project.create` scopes miss `PROJECT_TITLE_EXISTS` — most-common rename failure shows generic copy
- **File:** `packages/client/src/errors/scopes.ts:49-54`
- **Bug:** Server emits `PROJECT_TITLE_EXISTS` (400) from both `POST /projects` and `PATCH /projects/:slug` (`packages/server/src/projects/projects.routes.ts:25, 66`). Neither scope has a matching `byCode`. The user renaming to an existing title sees generic "Failed to update the project title" instead of "A project with that title already exists" — no actionable information.
- **Impact:** The title-exists error is likely the single most-common rename failure. The mapper's purpose is to make copy actionable; missing the most-common specific code here forces every rename failure into a generic bucket.
- **Suggested fix:** Add a new string `STRINGS.error.projectTitleExists` ("A project with this title already exists. Choose a different title.") and wire it to both scopes via `byCode: { PROJECT_TITLE_EXISTS: STRINGS.error.projectTitleExists }`.
- **Confidence:** High
- **Found by:** Contract & Integration

### [I13] `make all` does not pass — `eslintSequenceRule.test.ts` has 2 pre-existing failing tests
- **File:** `packages/client/src/__tests__/eslintSequenceRule.test.ts:26, 46`
- **Bug:** The tests expect the `no-restricted-syntax` rule to fire and produce exactly one lint message; 0 messages are produced on this branch. The file is unchanged in the branch diff — this is a pre-existing failure. Design §12 DoD explicitly requires *"`make all` green: lint + format + typecheck + coverage (95%/85%/90%/95% floors) + e2e."*
- **Impact:** A DoD bullet is not satisfied. Likely orthogonal to Phase 4b.3, but ignoring it erodes the DoD discipline that previous phases (see CLAUDE.md §Pull Request Scope and the 16-round snapshots review) relied on.
- **Suggested fix:** Before merging, investigate whether the test is environment-specific or a real rule regression on main. If pre-existing, land a separate fix commit on main first; if branch-induced, fix here.
- **Confidence:** Medium
- **Found by:** Plan Alignment

## Suggestions

One-line entries only. Not blocking; future-polish.

- `packages/client/src/api/client.ts:70-79` — `extractExtras` `out[k] = rest[k]` can reparent `out` via `__proto__` setter (scope-local, not global pollution). Use `Object.create(null)` or skip `__proto__`/`constructor` keys.
- `packages/client/src/api/client.ts:68` — `MAX_EXTRAS_KEYS = 16` truncates top-level keys only; nested arrays/strings are unbounded (DoS-theoretical on `chapters` join).
- `packages/client/src/api/client.ts:68` — `MAX_EXTRAS_KEYS` truncation is order-sensitive; a padded envelope could drop `chapters` silently with no warning.
- `packages/client/src/api/client.ts:57` — NETWORK path forwards browser `err.message` without the `[dev]` prefix used elsewhere in the file.
- `packages/client/src/errors/scopes.ts:106-117` — `image.delete` `extrasFrom` is all-or-nothing (one malformed chapter drops the full list); consider returning the validated subset.
- `packages/client/src/errors/scopes.ts:179-186` — `trash.restoreChapter` missing `RESTORE_READ_FAILURE` code → generic copy when the row was actually restored.
- `packages/client/src/errors/apiErrorMapper.ts:28-52` — reserved synthetic codes `ABORTED`/`NETWORK`/`BAD_JSON` could collide with a future server code; reserve with a prefix or require status discriminant.
- `packages/client/src/pages/EditorPage.tsx:1465` — settings-update follow-up GET uses `project.load` scope copy ("Failed to load the project") — wrong attribution.
- `packages/client/src/pages/EditorPage.tsx:1441-1452` — `handleProjectSettingsUpdate` post-await merge could stomp a concurrent same-project field write; narrow window.
- `packages/client/src/hooks/useTrashManager.ts:25, 53` and `packages/client/src/components/ProjectSettingsDialog.tsx:146, 224` — use `console.error` vs the `console.warn` convention used elsewhere; test noise risk per CLAUDE.md §Testing Philosophy.
- `packages/client/src/hooks/useProjectEditor.ts:639-650` — `handleReorderChapters` possiblyCommitted branch does not fire a project refresh (unlike sibling `handleCreateChapter` / `handleUpdateProjectTitle`).
- `packages/client/src/hooks/useProjectEditor.ts:245` — `console.warn("...", err)` logs full `ApiRequestError` with server message; console is one click from the user.
- `packages/client/src/hooks/useProjectEditor.ts:737-807` — `handleStatusChange` catch doesn't early-return on `mapped.message === null` (ABORTED); latent when I11's controller is added.
- `packages/client/src/hooks/useProjectEditor.ts:812-839` — `handleRenameChapter` has the same abort gap as I11 (lower impact — blur-triggered).
- `packages/client/src/hooks/useTimezoneDetection.ts:3-20` — `detectAndSetTimezone` race against explicit timezone choice in the settings dialog; bounded to app-boot window.
- `packages/client/src/components/ProjectSettingsDialog.tsx:129-183` — `saveField` lacks abort/seq; sibling `handleTimezoneChange` in the same file has both.
- `packages/client/src/components/DashboardView.tsx:79` and `packages/client/src/components/ImageGallery.tsx:77` — `message ?? STRINGS.*.loadError` fallback substitutes the generic copy when ABORTED (null); latent.
- `packages/client/src/components/SnapshotPanel.tsx:292` and `packages/client/src/components/ImageGallery.tsx:212` — on ABORTED the delete confirm dialog state isn't reset; latent.

## Plan Alignment

### Implemented (from Design §12 DoD)
- Only `apiErrorMapper.ts` owns API-error → UI-string translation; `findReplaceErrors.ts` deleted; `useSnapshotState.ts` failure-arm carries `ApiRequestError` (success-arm `staleChapterSwitch`/`restoredChapterId`/`superseded` preserved).
- All strings emitted by the mapper come from `strings.ts`.
- Transport: `ApiError` has `[key: string]: unknown`; `ApiRequestError` carries `extras`; `deleteImage` special-case removed; every non-2xx throws (modulo I2/I3 edge cases).
- Regression tests from 2026-04-20 review present and asserting `mapApiError`'s `possiblyCommitted` output drives the editor lock (`useProjectEditor.test.ts`, `EditorPageFeatures.test.tsx`, `useSnapshotState.test.ts`).
- CLAUDE.md §Key Architecture Decisions "Unified API error mapping" entry landed; §Target Project Structure lists `errors/`.
- Rollout order (Design §8): commits `90d3f30` → `1274ebe` → `5e76da5` → `6669458` → `2c3b9d7` match the expected 5-commit sequence, plus review-cleanup trailers.
- 45+ `mapApiError` call sites across hooks, pages, and components.
- Shared and server tests pass (133/133 shared; 621/621 server).

### Not yet implemented (expected — not a bug)
- ESLint rule enforcement of the `mapApiError` invariant (explicitly deferred to Phase 4b.4).
- `STRINGS.error.possiblyCommitted` shared default (see I4 — implemented as S7 carve-out instead).

### Deviations (reported above)
- **I4** — S7 carve-out replaces design §2's universal-possiblyCommitted rule.
- **I10** — 8 residual `instanceof ApiRequestError` control-flow sites.
- **I13** — `make all` not literally green.
- Scope registry expanded beyond design §3 list (additions: `projectList.load`, `project.updateFields`, `image.list`, `image.references`, `project.velocity`; omission: `settings.get`). Expansion is design-consistent (design explicitly called §3 "abridged"); `settings.get` omission is the one gap (see I9).

## Review Metadata

- **Agents dispatched:**
  - Logic & Correctness (Partition A — mapper + transport)
  - Logic & Correctness (Partition B — hooks + pages)
  - Error Handling & Edge Cases (all)
  - Contract & Integration (client + server envelope cross-check)
  - Concurrency & State (save pipeline, sequences, aborts)
  - Security (prototype pollution, URL injection, XSS, DoS)
  - Plan Alignment (diff vs. design §1–12 + DoD)
- **Scope:** 38 changed files plus adjacent server routes (images, chapters, projects, snapshots) for server-emitted error-code coverage; `CLAUDE.md`; design/plan docs; prior code review at `paad/code-reviews/ovid-unified-error-mapper-2026-04-23-22-07-23-2c3b9d7.md`.
- **Raw findings:** 47 (pre-verification, with overlap)
- **Verified findings:** 32 (after verification and deduplication — 13 Important + 19 Suggestions)
- **Filtered out:** 15 (5 rejected by verifier as wrong/dead-path/guarded; 10 deduplicated into consolidated findings)
- **Steering files consulted:** `CLAUDE.md`, `packages/client/src/hooks/useAbortableSequence.ts` (canonical seq helper).
- **Plan/design docs consulted:** `docs/plans/2026-04-23-unified-error-mapper-design.md`, `docs/plans/2026-04-23-unified-error-mapper-plan.md`, `docs/roadmap.md`.
