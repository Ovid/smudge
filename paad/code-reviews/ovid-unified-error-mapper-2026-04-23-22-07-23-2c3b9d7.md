# Agentic Code Review: ovid/unified-error-mapper

**Date:** 2026-04-23 22:07:23
**Branch:** ovid/unified-error-mapper -> main
**Commit:** 2c3b9d7e17e54071fb9d133871fe359b952213f9
**Files changed:** 35 | **Lines changed:** +3843 / -654
**Diff size category:** Large

## Executive Summary

The branch implements Phase 4b.3 (Unified API Error Mapper) cleanly against the plan: a `mapApiError(err, scope)` machinery, a 28-entry scope registry, and migration of most call sites away from ad-hoc ladders. The machinery itself is sound. The issues are all at call sites that either bypass the new machinery or fail to consult the `possiblyCommitted` signal the machinery produces. One Critical: `chapter.create` can double-POST on a 2xx BAD_JSON retry, because its catch ignores `possiblyCommitted`. Several Important: `chapter.updateStatus` / `chapter.reorder` / `project.updateTitle` have the same gap with less-severe outcomes, and two transport paths (`images.upload`, `projects.export`) bypass `apiFetch` — breaking the mapper contract for those scopes. Two parallel ladders (`mapSaveError` in `handleSave`, manual 2xx BAD_JSON checks in `executeReplace`/`handleReplaceOne`) duplicate scope entries and will drift.

## Critical Issues

### [C1] `chapter.create` ignores `possiblyCommitted` — retry creates a duplicate chapter
- **File:** `packages/client/src/hooks/useProjectEditor.ts:369-386`
- **Bug:** The `handleCreateChapter` catch block does not read `possiblyCommitted` from `mapApiError`. On a 2xx BAD_JSON response (mapApiError → `possiblyCommitted: true`, fallback message), the server committed the new row but the client has no id. The user sees a dismissible error banner, clicks "Add chapter" again, and the POST creates a second chapter.
- **Impact:** Data integrity / user-visible duplication. The endpoint is non-idempotent (POST → new row each call). Discovery requires a refresh to reveal two identical chapters. The server already defines a `READ_AFTER_CREATE_FAILURE` code for this class of failure, but the `chapter.create` scope has no `byCode` entry for it — so even that signal is lost to the user as generic "Failed to create chapter" copy.
- **Suggested fix:** Add `committed:` copy to the `chapter.create` scope (e.g. "Chapter may have been created. Refresh to see the latest list."). Add `byCode: { READ_AFTER_CREATE_FAILURE: ... }`. In `handleCreateChapter`'s catch, branch on `possiblyCommitted` to (a) surface the committed-specific copy and (b) fire a `project.get` refresh to load the new chapter without a duplicate POST.
- **Confidence:** High
- **Found by:** Error Handling (B), Contract (B), Logic (B)

## Important Issues

### [I1] `images.upload` and `projects.export` bypass `apiFetch` — NETWORK/ABORTED classification lost
- **File:** `packages/client/src/api/client.ts:167-196` (export) and `packages/client/src/api/client.ts:239-255` (upload)
- **Bug:** Both functions call raw `fetch()` and throw `new ApiRequestError(message, res.status)` with no `code`, no `extras`, and no `classifyFetchError` wrapping. Consequences:
  1. A real offline / DNS / CSP failure surfaces as bare `TypeError`, which `mapApiError` routes through the `!isApiRequestError` branch — `transient: false`, scope fallback. The whole point of the `network:` scope field is bypassed.
  2. AbortError bubbles raw as `DOMException`. `ExportDialog` masks via `controller.signal.aborted` check; `ImageGallery.handleFileSelect` has no such guard.
  3. `image.upload.byCode`/`byStatus` and `export.run.byCode`/`byStatus` are unreachable because `code` is never populated. The scope tests pass only because they construct synthetic ApiRequestError instances that the real transport never produces.
- **Impact:** Users see generic "Upload failed" / "Export failed" instead of connection-specific guidance; retry affordance decisions (transient vs permanent) cannot be made. The contract claim in CLAUDE.md — "every message goes through the scope registry" — is violated at the transport layer for these two paths.
- **Suggested fix:** Extract a shared helper (`fetchClassified`) that wraps `fetch()` with `classifyFetchError` and extracts `{message, code, extras}` from the error envelope, then specialize for JSON (`apiFetch`), blob (`projects.export`), and multipart (`images.upload`). At minimum, add `.catch((err) => { throw classifyFetchError(err); })` and populate `code`/`extras` in the thrown ApiRequestError in both functions.
- **Confidence:** High
- **Found by:** Error Handling (A, B), Contract (A), Security, Logic (B)

### [I2] `restoreSnapshot` synthesizes NETWORK for post-success throws while EditorPage comment claims BAD_JSON — invites double-restore
- **File:** `packages/client/src/hooks/useSnapshotState.ts:343` and `packages/client/src/pages/EditorPage.tsx:484-487`
- **Bug:** After `await api.snapshots.restore(...)`, any non-ApiRequestError throw is normalized by `makeClientNetworkError()` (status 0, code `"NETWORK"`). That maps to `transient: true`. The `transient` branch in `handleRestoreSnapshot` (EditorPage.tsx:537-544) sets `actionError` and keeps the SnapshotBanner visible — the user is invited to retry. The EditorPage comment at 484-487 asserts the exact opposite: *"the hook now synthesizes a 200 BAD_JSON ApiRequestError for non-ApiRequestError post-success throws, so they land here and get the same pessimistic lock treatment."* Code and comment contradict.
  
  If a post-success statement throws (`localStorage.removeItem` in Safari private mode, an extension proxying storage, a React `setState` reaching a torn-down boundary), the server HAS committed the restore (plus the pre-restore auto-snapshot). A user retry re-POSTs `/snapshots/:id/restore` → double-restore + second pre-restore auto-snapshot. The pre-refactor "unknown → lock banner" pessimism is regressed.
- **Impact:** Latent but real: the `localStorage.removeItem` call on line 299 CAN throw in Safari private mode. The defense comment on line 334-342 enumerates current post-await statements and claims none can throw; that inventory is a load-bearing assumption enforced only by review.
- **Suggested fix:** Either (a) change the synthesis to 200 BAD_JSON so it routes through the `possiblyCommitted` arm (matching the comment and the pessimistic intent) — this is the correct long-term fix; or (b) update the EditorPage comment to acknowledge the optimistic NETWORK routing and accept the double-restore risk. Option (a) preserves the save-pipeline invariant that any ambiguous-commit outcome raises the lock banner.
- **Confidence:** High
- **Found by:** Logic (B), Concurrency

### [I3] `project.updateTitle` ignores `possiblyCommitted` — slug desync on ambiguous commit
- **File:** `packages/client/src/hooks/useProjectEditor.ts:639-646`
- **Bug:** On 2xx BAD_JSON, the server may have committed the rename (new slug) but the client's `projectSlugRef.current` stays on the old slug. Every subsequent request (save/create/reorder/delete) POSTs against the dead slug and 404s.
- **Impact:** Cascading failure — the user doesn't know why operations keep failing until they refresh. Distinct from the sibling F2/F3 cases (status / reorder) because the slug is load-bearing state, not just optimistic UI.
- **Suggested fix:** Add `committed:` copy to `project.updateTitle` scope. On `possiblyCommitted`, fire a `project.get` refresh to resync `projectSlugRef` from the server (or raise a lock-banner that forces a refresh).
- **Confidence:** High
- **Found by:** Error Handling (B)

### [I4] `mapSaveError` in `handleSave` duplicates the `chapter.save` scope; scope is otherwise dead
- **File:** `packages/client/src/hooks/useProjectEditor.ts:194-198`
- **Bug:** The inline helper re-implements exactly what `SCOPES["chapter.save"]` encodes (byStatus[413], byCode[VALIDATION_ERROR], fallback). No production call site passes `"chapter.save"` to `mapApiError` — the scope is consumed only by tests. Additionally, `mapSaveError` checks status BEFORE code, inverse to `mapApiError`'s byCode-first order; a hypothetical 413 + VALIDATION_ERROR response would produce different strings from each.
- **Impact:** Violates the CLAUDE.md invariant "All client code that surfaces a user-visible message from an API error must route through `mapApiError(err, scope)`". Two sources of truth for the same mapping will drift. This is the canonical example of the pattern the refactor was meant to retire.
- **Suggested fix:** Replace `mapSaveError(err)` at lines 257 and 308 with `mapApiError(err, "chapter.save").message`. The cache-clear decision at line 294 still needs `err.code === "VALIDATION_ERROR"` — preserve that directly from the ApiRequestError (`err.code` is still available). Optional: consult `possiblyCommitted` on 2xx BAD_JSON to stop the retry loop rather than letting backoff retry an unreadable-body response that may have committed.
- **Confidence:** High
- **Found by:** Logic (A, B), Error Handling (A), Contract (A, B) — 5 specialists

### [I5] Manual 2xx BAD_JSON checks in `executeReplace` and `handleReplaceOne` duplicate scope-level routing
- **File:** `packages/client/src/pages/EditorPage.tsx` (executeReplace and handleReplaceOne paths)
- **Bug:** Both handlers manually inspect `err.code === "BAD_JSON" && err.status >= 200 && err.status < 300` — the exact predicate `mapApiError` already applies (`apiErrorMapper.ts:31`). The `findReplace.replace` scope has a `committed:` entry; the mapper already returns `possiblyCommitted: true` for this case. The manual checks are dead weight and a drift risk parallel to [I4].
- **Impact:** Same failure mode as [I4] — if the BAD_JSON predicate ever broadens (e.g. to handle 3xx edge cases), the snapshot.restore caller gets the new behavior but these findReplace callers silently diverge.
- **Suggested fix:** Restructure to read `possiblyCommitted` from `mapApiError(err, "findReplace.replace")`; drop the manual status/code checks.
- **Confidence:** High
- **Found by:** Contract (A)

### [I6] `chapter.updateStatus` and `chapter.reorder` ignore `possiblyCommitted`
- **Files:** `packages/client/src/hooks/useProjectEditor.ts:670-729` (updateStatus), `packages/client/src/hooks/useProjectEditor.ts:601-615` (reorder)
- **Bug:** Both handlers fail to consult `possiblyCommitted` on 2xx BAD_JSON. Consequences:
  - **updateStatus:** the revert-via-project-get path succeeds (server already committed the new status), so the "revert" is a silent no-op, but the error banner still fires — misleading UX.
  - **reorder:** drag-and-drop visually snaps back despite the server having committed the new order; the next PUT re-applies the same order, idempotent but confusing.
- **Impact:** User-visible UX regression / confusion on an ambiguous commit. Lower severity than C1 (no data corruption) and I3 (no cascading failures), but the pattern is consistent.
- **Suggested fix:** Add `committed:` copy to `chapter.updateStatus` and `chapter.reorder` scopes. Branch on `possiblyCommitted` in the catch blocks to surface the committed-specific copy and skip the revert (updateStatus) or skip the visual revert (reorder).
- **Confidence:** Medium
- **Found by:** Error Handling (B)

### [I7] `ProjectSettingsDialog.saveField` bypasses `mapApiError`
- **File:** `packages/client/src/components/ProjectSettingsDialog.tsx:129-159`
- **Bug:** `saveField` (for `target_word_count`, `target_deadline`, `author_name`) hardcodes `STRINGS.projectSettings.saveError` on the catch. `handleTimezoneChange` on the same file (line 198-204) DOES use `mapApiError(err, "settings.update")`. Inconsistent within the same component; no `project.update` scope exists for non-title fields. VALIDATION_ERROR / 413 / NETWORK distinctions are all collapsed to one generic message.
- **Impact:** Violates the CLAUDE.md invariant at a clear call site. When the Phase 4b.4 ESLint rule lands, this site will fail the rule.
- **Suggested fix:** Add a scope (e.g. `project.update` or `project.updateFields`) to `scopes.ts` and route `saveField`'s catch through it. Or migrate to `project.updateTitle` if the copy is intended to be identical.
- **Confidence:** Medium
- **Found by:** Logic (B), Error Handling (B), Contract (B) — 3 specialists

### [I8] Missing scopes for `images.list`, `images.references`, `projects.velocity`
- **Files:** 
  - `packages/client/src/components/ImageGallery.tsx:71-73, 100-104, 470`
  - `packages/client/src/components/DashboardView.tsx:68-74`
- **Bug:** These catches collapse the error to a boolean flag (`loadError`, `velocityError`) with hardcoded generic copy. No corresponding scope entries exist in `scopes.ts`. Sibling paths in both files (ImageGallery upload/delete/save, DashboardView dashboard fetch) DO use `mapApiError` — the inconsistency is within a single component.
- **Impact:** CLAUDE.md invariant violation at three clear call sites. User cannot distinguish transient network from 5xx from 404 (project gone).
- **Suggested fix:** Add `image.list`, `image.references`, `project.velocity` scope entries and route the three catches through `mapApiError`. Change `loadError: boolean` / `velocityError: boolean` to `loadError: string | null` / `velocityError: string | null` and render the message directly.
- **Confidence:** Medium
- **Found by:** Contract (B)

## Suggestions

- **[S1]** `EditorPage.tsx:1984` — `TODO(commit-4): drop this re-derivation once SnapshotPanel consumes MappedError directly` is stale (commit 4 / `6669458` has merged). The three-hop reason-code translation (scopes → EditorPage translator → SnapshotPanel case ladder) is a drift risk — resolve the TODO or retag it to a named follow-up phase. Found by: Plan Alignment, Contract (A, B), Logic (B).
- **[S2]** `trash.restoreChapter` scope has only `fallback` — server emits `PROJECT_PURGED`, `CHAPTER_PURGED`, `RESTORE_CONFLICT` codes that all collapse to "Failed to restore chapter." Add `byCode` entries. `scopes.ts:120`. Found by: Contract (B).
- **[S3]** Stored `ApiRequestError.message` carries English fallbacks (`"Request failed: ${status}"`, raw JSON-parser errors). No current UI reader, but a hazard if anyone logs `err.message`. `api/client.ts:61, 103, 250`. Found by: Logic (A), Error Handling (A), Contract (B).
- **[S4]** `apiFetch`'s extras capture has no size/key cap. Upstream `express.json` limits to 5 MB. Add a defensive `MAX_EXTRAS_KEYS` cap. `api/client.ts:73-78`. Found by: Security.
- **[S5]** `image.delete` extras validation only checks `Array.isArray(chapters)`; element shape not validated. ImageGallery casts to `Array<{title: string; trashed?: boolean}>` without per-element check. Tighten the `extrasFrom` narrowing. `scopes.ts:58-61`, `ImageGallery.tsx:207-211`. Found by: Security, Contract (A).
- **[S6]** GET scopes (project.load, chapter.load, projectList.load, etc.) have no `network:` override — NETWORK errors produce the generic fallback instead of "check your connection" copy. Add `network:` overrides. Found by: Error Handling (B).
- **[S7]** Mapper unconditionally sets `possiblyCommitted: true` for 2xx BAD_JSON regardless of scope. Latent: no GET caller reads the flag today, but codified as correct by parametric tests. Either (a) gate on `scope.committed !== undefined`, or (b) add a `readOnly` scope flag. Found by: Logic (A).
- **[S8]** byCode precedes byStatus in the resolver; a hypothetical `{status: 413, code: "INVALID_REGEX"}` would route differently from the pre-refactor helper. Latent — server contract today holds. `apiErrorMapper.ts:45-62`. Found by: Logic (A), Error Handling (A), Logic (B).
- **[S9]** URL template literals in `api/client.ts` are not `encodeURIComponent`-wrapped. Slugs are validated server-side to `[a-z0-9-]`, so today no characters alter the URL. Defensive only. Found by: Security.
- **[S10]** Mapper has no tests for hostile/malformed envelope content (e.g. `err.message` with HTML). Add a test pinning "mapper never surfaces raw err.message" to guard against future regressions. Found by: Security, Error Handling (A).
- **[S11]** `useSnapshotState.viewSnapshot` unsafe on a 204 response — `full.content` would throw on undefined, routing through the synthetic-NETWORK catch. Unreachable today (snapshot GET never returns 204); add a defensive `if (!full)` guard. `useSnapshotState.ts:209-226`. Found by: Error Handling (B).
- **[S12]** EditorPage `stage:"reload"` restore branch: cache-clear runs before `setEditable(false)`. Not data-losing (hook already held editable=false) but contradicts the "cache-clear after server success" invariant pattern elsewhere. Swap the two lines. `EditorPage.tsx:445-456`. Found by: Logic (B).
- **[S13]** Synthetic ApiRequestError instances (`makeClientNetworkError`, `makeCorruptViewError`) carry developer-facing English in `.message`. Today `mapApiError` never reads `.message`, but if a future consumer logs `.message` this would produce misleading logs. Either use empty strings or mark the synthetics. `useSnapshotState.ts:24-33`. Found by: Contract (B).
- **[S14]** Style inconsistency: `useSnapshotState` uses `err.code === "ABORTED"`; `useFindReplaceState` uses `message === null`. Both work; pick one convention. Found by: Contract (B).

## Plan Alignment

- **Implemented:** All five planned commits landed (`d70e9ef`, `90d3f30`, `1274ebe`, `5e76da5`, `6669458`, `2c3b9d7` — plus three review-followup commits). The resolver algorithm matches the plan's 7-rule ladder; the `ApiError` widening landed; every pre-refactor ad-hoc ladder identified in the plan has been deleted (`packages/client/src/utils/findReplaceErrors.ts` is gone). Parametric `it.each(ALL_SCOPES)` tests cover ABORTED, NETWORK, 2xx BAD_JSON, non-ApiRequestError for every scope. CLAUDE.md §Unified API error mapping block is accurate against on-disk state.
- **Not yet implemented (neutral — all explicitly deferred):**
  - Phase 4b.4 ESLint rule enforcing the mapper contract (CLAUDE.md line 100-101 explicitly defers this).
  - `STRINGS.error.possiblyCommitted` shared default (plan §12 "Open Items" explicitly allowed dropping if unreachable — it was unreachable; dropping is within the plan's latitude).
  - Unification of `images.upload` multipart path into `apiFetch` — not required by the plan.
- **Deviations:**
  - `project.velocity` and `settings.get` scopes were planned but dropped in a follow-up review commit with documented rationale (both discarded their result). Intentional.
  - New `projectList.load` scope added (not in plan) to fix a copy regression (plural vs singular). Documented in commit message.
  - Minor naming: `snapshot.delete` uses `STRINGS.snapshots.deleteFailed` instead of the plan's `deleteFailedGeneric`. Behavioral no-op.
- **Roadmap alignment:** Phase 4b.3 is correctly marked "In Progress" at `docs/roadmap.md:33`; phase 4b.4 is correctly "Planned". This branch implements exactly one phase per CLAUDE.md's one-feature/phase-boundary rules.

## Review Metadata

- **Agents dispatched (9):**
  - Logic & Correctness A (mapper core)
  - Logic & Correctness B (call sites)
  - Error Handling & Edge Cases A (core / transport)
  - Error Handling & Edge Cases B (call sites)
  - Contract & Integration A (mapper core contract + direct consumers)
  - Contract & Integration B (call-site contract consistency)
  - Concurrency & State
  - Security
  - Plan Alignment
- **Verifier:** 1 (reviewed every cluster against current code)
- **Scope:** 35 files changed; read in full or via targeted line ranges: `apiErrorMapper.ts`, `scopes.ts`, `index.ts`, `api/client.ts`, `shared/types.ts`, all 5 migrated hooks, 8 migrated components, `EditorPage.tsx` (2193 lines), `HomePage.tsx`, test files, plan + design + roadmap + CLAUDE.md. Adjacent code read via grep for `err.message`, `mapApiError`, and `ApiRequestError` usage.
- **Raw findings:** ~50 specialist findings (many overlapping across 9 agents)
- **Verified findings:** 23 (1 Critical, 7 Important, 14 Suggestion; the stale TODO was subsumed into S1)
- **Filtered out:** ~27 (duplicates across specialists, non-findings, and findings below 60 confidence after verification)
- **Steering files consulted:** `CLAUDE.md` (project root). No contradictions between CLAUDE.md and actual code surfaced.
- **Plan/design docs consulted:** `docs/plans/2026-04-23-unified-error-mapper-plan.md`, `docs/plans/2026-04-23-unified-error-mapper-design.md`, `docs/roadmap.md`.
