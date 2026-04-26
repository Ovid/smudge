# Phase 4b.3a — 4b.3 Review Follow-ups (Design)

**Date:** 2026-04-25
**Author:** Ovid / Claude (collaborative)
**Roadmap phase:** 4b.3a
**Source review:** `paad/code-reviews/ovid-unified-error-mapper-2026-04-25-10-32-46-a68afd1.md`
**Predecessor phase:** 4b.3 — Unified API Error Mapper (merged in commit `46ae550`)

---

## Goal

Land the validated-but-unfixed items from the Phase 4b.3 code review so the unified-error-mapper migration is complete in spirit, not just in shape. [I13] already shipped on the 4b.3 branch (commit `3a3728f`). Each cluster below is a coherent follow-up to 4b.3; letting them rot would re-introduce the consumer-ladder duplication, partial abort discipline, and generic-copy drift the migration was meant to eliminate. Landing them before Phase 4b.4 also gives the raw-strings ESLint rule a clean baseline (no scope-coverage gaps that would be papered over by lint noise).

## Shape of the Phase

Five PRs land in sequence on `ovid/miscellaneous-fixes`, rebased on `main` between merges. One design document (this file) and one implementation plan cover the whole phase.

| Order | PR | Cluster | Theme | Items |
|---|---|---|---|---|
| 1 | D | Sanitizer hardening | `sanitizer.ts` + `scopes.ts` | [I14], [S21] |
| 2 | A | Scope-coverage gaps | `scopes.ts` + new strings | [I1], [I2], [S1] |
| 3 | B | AbortSignal threading | `api/client.ts` + ~7 call sites | [I6]–[I12], [S12] |
| 4 | C | Consumer recovery completeness | hooks/components/pages | 14 items (see §Cluster C) |
| 5 | E | Mapper internals + CLAUDE.md | typing, tests, docs | [S2], [S6], [S9], [S13], [S14], [S22]/[S23] |

Cluster F ([I15] retrospective) is resolved at the design level: see §Cluster F.

**Order rationale.** D first because [I14] is the only Security-classified finding in the source review and its fix is small and self-contained. A second because the user-visible misleading-copy items are small and unblock writers from a confusing failure mode. B before C because several C items ([S10], [S17], [S19]) assume B's signals are in place. E last so it can reference the pattern landed in prior clusters and unblock 4b.4's ESLint baseline.

## Cluster D — Sanitizer hardening (PR 1)

**Items:** [I14] (Security, Medium), [S21] (Security, Suggestion).

### [I14] Pin `ALLOWED_URI_REGEXP` in `packages/client/src/sanitizer.ts`

DOMPurify's defaults permit `data:` URIs in `<img src>`. A `data:image/svg+xml` SVG is a textbook XSS vector and is not blocked by `ALLOWED_TAGS` / `ALLOWED_ATTR` alone. The file's own header comment names the threat model — a hostile snapshot or server payload bypassing the editor — and this fix closes the gap.

The only legitimate `<img src>` value Smudge ever produces is `/api/images/{uuid}` (server-issued, opaque). Pin to a UUID-shaped path so that prefix-bypass variants (`/api/images/javascript:`, `/api/images/../etc/passwd`, `/api/images/?x=javascript:`) are rejected at the sanitizer layer:

```ts
const ALLOWED_URI_REGEXP =
  /^\/api\/images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:[?#].*)?$/i;
```

…and pass it to DOMPurify's `sanitize` options. Pair it with an `uponSanitizeAttribute` hook on a private `DOMPurify(window)` instance so that DOMPurify 3.x's hardcoded `DATA_URI_TAGS` carve-out (which lets `data:` URIs through `<img src>` even when `ALLOWED_URI_REGEXP` is set) cannot bypass the regex.

**Threat model (documented in code).** The sanitizer's threat model is XSS in the rendered DOM, not server-side path traversal; the server enforces path validity at request handling. The UUID-shaped regex above happens to reject traversal as a side effect of mirroring the server-issued URL shape — earlier round-1/round-2 designs used a prefix-only `/^\/api\/images\//i` which was widened to the UUID form in round-3 review after `<a href="/api/images/javascript:…">` was found to bypass the prefix check (XSS unreachable today because `<a>` is not in `ALLOWED_TAGS`, but the gap is latent if Link is later added to `editorExtensions`).

**Server/client divergence (documented in code).** The server's `IMAGE_SRC_RE` in `packages/server/src/images/images.references.ts` is wider — it accepts `^(?:https?://[^/]+)?/api/images/<uuid>` so pasted absolute URLs still increment the reference count (conservative delete-blocking). Sanitizer is intentionally narrower (relative form only); a future writer that emits absolute URLs would surface a "broken `<img>` survives delete-block" symptom that signals the divergence.

### [S21] Bound `extrasFrom` chapters validation (`scopes.ts`)

`image.delete`'s `extrasFrom` validates that each `chapters[].title` is a string but applies no length cap. A malicious server response could blow up rendering with megabyte titles. Cap at 50 entries; truncate per-title to 200 chars. **Truncation is silent** — no dev-warn. (Avoids re-introducing the bug [S6] in Cluster E fixes, where `import.meta.env?.DEV` access can throw in some test environments. The defensive bound is the value; observability of an attacker-shaped server response is not.)

### Cluster D tests

Unit tests for the sanitizer regression cases:

- `data:image/svg+xml;…` rejected.
- `javascript:` rejected.
- `http://example.com/foo.png` rejected (legitimate-looking but not Smudge-issued).
- `/api/images/<uuid>` accepted.

Unit tests for `extrasFrom` 50-chapter cap and 200-char title truncation. Cluster D also adds targeted e2e coverage via `e2e/sanitizer-snapshot-blob.spec.ts` to verify hostile snapshot content is sanitized end-to-end through the rendered app flow (the [I14] regex alone is unit-tested, but the full PATCH → snapshot → render path warrants e2e proof since the sanitizer call site lives in `EditorPage.renderSnapshotContent`).

### Cluster D out-of-scope

Anything in other clusters, even if `sanitizer.ts` or `scopes.ts` is touched there. Reviewers should reject any unrelated edit to those files in this PR.

## Cluster A — Scope-coverage gaps (PR 2)

**Items:** [I1] (Logic-Core, Medium), [I2] (Logic-Core, Medium), [S1] (Logic-Core, Suggestion). All in `packages/client/src/errors/scopes.ts`.

### [I1] `chapter.reorder` missing `byCode: { REORDER_MISMATCH }`

Server emits `400 + code: "REORDER_MISMATCH"` from `packages/server/src/projects/projects.routes.ts:132` when the chapter id list mismatches. Today the scope has no `byCode`, so the user sees the generic `STRINGS.error.reorderFailed`. Fix:

```ts
byCode: { REORDER_MISMATCH: STRINGS.error.reorderMismatch }
```

…with a new string communicating that the chapter list is out of sync and that refreshing will resolve it.

### [I2] `chapter.save` lacks `network:` and `byStatus: { 404 }`

Today `STRINGS.editor.saveFailed` ("Unable to save — check connection") doubles as both `fallback:` and the de-facto network message. When a chapter is soft-deleted in another tab and the user keeps typing, auto-save 404s and the user sees a network theory while typing into never-persisting content.

Fix:

- Add `network: STRINGS.editor.saveFailedNetwork`.
- Add `byStatus: { 404: STRINGS.editor.saveFailedChapterGone }`.
- Reword `saveFailed` fallback to be neutral.

Three new strings; no behavior change beyond copy.

### [S1] `trash.restoreChapter` missing `byStatus: { 404 }`

Restoring a chapter that's already been hard-purged falls through to fallback. Add `byStatus: { 404: STRINGS.error.restoreChapterAlreadyPurged }` plus the new string.

### Cluster A tests

Per-scope unit tests in `errors/scopes.test.ts` covering the new branches. Integration test for [I2]: open a chapter, simulate 404 on PATCH, assert the chapter-gone copy renders.

**e2e:** one Playwright test for [I2] (load chapter, intercept PATCH with 404, assert correct banner copy). [I1] and [S1] are unit-test territory.

### Cluster A out-of-scope

Any string changes outside these three scopes. Any consumer-side changes (those belong in Cluster C).

## Cluster B — AbortSignal threading (PR 3)

**Items:** [I6]–[I12] (Concurrency / Contract, mostly Medium; [I10] High), [S12] (Contract, Suggestion). Eight items shipped as one PR.

### Scope-exception rationale (logged for the PR description)

Eight items in one PR. They are not eight features; they are one signal-threading refactor with eight touchpoints. The rest of the 4b.3 branch already established AbortSignal threading as the standard discipline; this PR finishes a partial migration. Splitting it into "API surface" and "call sites" PRs would create a stranded intermediate state where the API accepts signals nothing threads. Documented here as a deliberate scope decision.

### API surface additions (`packages/client/src/api/client.ts`)

Add `signal?: AbortSignal` parameter to:

- [I7] `projects.create`, `projects.delete`
- [I8] `chapters.create`
- [I9] `chapterStatuses.list`

Each forwards the signal to the underlying `fetch`. Mirror the existing pattern from `chapters.get` / `images.upload`. Pure additions; no breaking changes.

### Call-site threading

- **[I6] `Editor.tsx` paste/drop image upload (line 281).** Allocate a per-handler `AbortController` stored on a ref; thread `controller.signal` to `images.upload`; abort on Editor unmount and on chapter switch.
- **[I10] `useProjectEditor.loadProject` (lines 198–262).** Convert the `let cancelled = false` flag to an `AbortController`; thread `signal` through `projects.get` and `chapters.get`; abort in the effect cleanup. Mirrors the HomePage / DashboardView migration.
- **[I9] `EditorPage` chapterStatuses retry-with-backoff (lines 1228–1244).** Replace the `cancelled` flag + `setTimeout` queue with an `AbortController`; abort on unmount.
- **[I11] `EditorPage` `search.replace` (lines 775, 1018).** Allocate a `replaceAbortRef` at EditorPage scope; thread `controller.signal` to both `api.search.replace` calls; abort on unmount.
- **[I12] `ExportDialog` unmount cleanup (line 38).** Add a separate `useEffect(() => () => abortRef.current?.abort(), [])` distinct from the open-transition effect. Real path: `EditorPage:1551–1554` navigates away on settings-update 404 mid-export.
- **[S12] `chapters.get` skipped at `useProjectEditor.ts:239, 635, 688`.** Three remaining call sites (`loadProject`, `handleSelectChapter`, `reloadActiveChapter`) — thread the existing controllers in. Completes the partial migration started for `handleDeleteChapter`.

### HomePage handler changes (after [I7])

`handleCreate` / `handleDelete` allocate per-handler controllers, thread to `projects.create` / `projects.delete`, abort on unmount. Closes the gap left by [I13].

### Cluster B tests

- **Unit:** mock `fetch`, assert `signal` parameter is passed for each API method.
- **Integration:** render-and-unmount tests using React Testing Library — assert `AbortController.abort()` fires on unmount for each call site (one test per site is sufficient).
- **e2e:** one test that opens an export and navigates away mid-stream (asserts no error toast surfaces post-unmount); one test that triggers a project-wide replace and navigates away (same assertion).

### Cluster B out-of-scope

Any consumer-recovery behavior changes (Cluster C). [S10]'s `!signal.aborted` dev-warn relies on B's signals existing but lives in C.

## Cluster C — Consumer recovery completeness (PR 4)

**Items:** [I3], [I4], [I5], [S3]/[S7], [S4], [S5], [S8], [S10], [S11], [S15], [S16], [S17], [S18], [S19], [S20] — 14 items.

### Scope-exception rationale (logged for the PR description)

Single PR by deliberate decision, including [S15]'s 30-site refactor. The items share one theme — *the consumer is dropping or mishandling something the mapper already produced* — and diluting them across three smaller PRs would slow the phase past the point of usefulness. Reviewers should treat the PR as one feature. **Recurrence requires explicit phase-level justification, per the precedent this design sets.** Commits should be one item per commit where feasible so reviewers can navigate by commit.

### Sub-themes (organization for review only — not separate PRs)

#### `possiblyCommitted` handling completeness

- **[I3] `SnapshotPanel.handleCreate`** — branch on `possiblyCommitted`: hide form, clear label, set `duplicateMessage = false`, `await fetchSnapshots()` before surfacing the message.
- **[I4] `useTrashManager.handleRestore`** — `possiblyCommitted` branch runs `api.projects.get(project.slug, signal)` and re-seeds `confirmedStatusRef`, mirroring `handleCreateChapter`'s recovery branch. Plain trash-list filter is insufficient.
- **[S4] `handleStatusChange`** — when `possiblyCommitted`, mirror `handleReorderChapters`' `if (onError) onError(message); else setError(message);` so the message is never dropped when the caller omits `onError`.
- **[S20] `handleReorderChapters`** — `possiblyCommitted` branch adds an epoch re-check before `setProject`. Either move `setProject` into the existing projectId-match guard or duplicate it.

#### Failure-mode dispatching into the mapper

- **[S3]/[S7] `chapter.save` BAD_JSON in scope.** Today the call site hardcodes the byCode allowlist. Move the BAD_JSON dispatch into `chapter.save`'s scope by extending `committedCodes` semantics (or adding a parallel `terminalCodes`). Removes the consumer-side ladder and aligns with the mapper's role as the single owner of code-to-string translation.
- **[S5] `restoreSnapshot` `dispatched` flag.** Currently synthesizes 200 BAD_JSON for ALL non-`ApiRequestError` throws, including pre-send bugs. Add a `dispatched` boolean set after the request leaves the wire; only synthesize 200 BAD_JSON when `dispatched === true`.

#### Silent-failure observability

- **[I5] `useTrashManager.confirmDeleteChapter`** — `try/catch` around `handleDeleteChapter` currently silently dismisses the dialog. Route through `mapApiError(err, "chapter.delete")` into `setActionError` before dismissing.
- **[S10] Dev-only `console.warn` in silent recovery-catches.** `useProjectEditor.handleStatusChange:1079` and `handleCreateChapter:604`. Gate the warn on `!signal.aborted` so it doesn't fire for cancellations.

#### Stale-state recovery UX

- **[S11] `chapter.create` 404 redirect.** Gate `isNotFound(err)` and call `navigate("/")`. **Rationale:** matches the existing convention in `EditorPage:1552` for the parallel 404-on-stale-project case (settings update against a deleted project), with the same comment justifying it. Not a new UX pattern; closing a gap in an established one.
- **[S16] `chapter.flushBeforeNavigate` scope.** `EditorPage.handleSelectChapterWithFlush:1481–1485` currently uses `chapter.load` for flush failure, which is the wrong scope. Add a dedicated scope and switch the call site.

#### Validation edge case

- **[S8] `image.delete` `extrasFrom`.** Currently returns `undefined` if any element of `chapters` is malformed. Return `{ chapters: valid }` whenever `valid.length > 0`. Loses no information; gains graceful degradation.

#### AbortRef hygiene

- **[S17] `createRecoveryAbortRef` not nulled on success.** `useProjectEditor.ts:566–608`. After the recovery flow completes, `if (createRecoveryAbortRef.current === recoveryController) createRecoveryAbortRef.current = null;`.
- **[S19] `viewAbortRef` not nulled on success.** `useSnapshotState.ts:265–345`. Same pattern.

#### Cross-chapter announcement race

- **[S18] `Editor.tsx` paste announcement on cross-chapter switch.** Today the guard catches cross-project but not same-project chapter switch. Capture the editor instance at upload-start; gate the announcement on `editor === editorInstanceRef.current`.

#### Helper extraction (refactor)

- **[S15] `applyMappedError` helper.** Add to `errors/`:
  ```ts
  applyMappedError<S extends keyof Scopes>(
    mapped: MappedError<S>,
    handlers: {
      onMessage: (message: string) => void;
      onTransient?: (transient: boolean) => void;
      onCommitted?: (possiblyCommitted: boolean) => void;
      onExtras?: (extras: ScopeExtras<S>) => void;
    },
  ): void
  ```
  All four mapper outputs (`message`, `transient`, `possiblyCommitted`, `extras`) are reachable by callback. **`ScopeExtras<S>` is introduced here as part of [S15]** (Cluster E's [S9] becomes "verify the cast at `ImageGallery.tsx:334–338` is unnecessary and drop it" — the type already exists by the time E ships).

  **Migration discipline (per pushback Issue 4):**
  - Land `applyMappedError` itself with **dedicated unit tests covering all callback combinations** (null-message, transient, possiblyCommitted, extras-with-and-without scope entry, every callback omitted, etc.) **before** migrating any site.
  - Migrate sites incrementally — **one commit per site**, so a regression bisects to a single migration.
  - Sites with mixed catch logic (e.g. `useTrashManager.handleRestore` interleaving `confirmedStatusRef` updates with `setActionError`) are flagged in the implementation plan for closer review; do not assume "existing tests pin behavior" — verify the behavior surface explicitly per site.
  - Helper is observably-equivalent to the manual ladder for sites with simple `setX(message)` shape; the existing tests do pin those.

### Cluster C tests

- **Unit / integration:** every item gets a new branch test. [S15] requires updating call-site tests but should not change observable behavior.
- **e2e:** [S11] redirect after stale-project chapter create; [I3] possiblyCommitted snapshot create then panel refresh; [I5] silent-dismiss now surfaces error.

### Cluster C out-of-scope

Any AbortSignal *threading* changes (those are Cluster B). New scopes other than `chapter.flushBeforeNavigate`. New API error codes or HTTP status codes.

## Cluster E — Mapper internals + CLAUDE.md updates (PR 5)

**Items:** [S2], [S6], [S9], [S13], [S14], [S22]/[S23] (transparency only).

### [S6] `safeExtrasFrom` dev-log try/catch (`apiErrorMapper.ts:173`)

`import.meta.env?.DEV` access can throw in some test environments, which inverts `safeExtrasFrom`'s must-never-throw guard. Wrap the `console.warn` block in `try {} catch {}`. Regression test uses a `Proxy` that throws on `import.meta` access.

### [S9] Verify and drop the `ImageGallery` `extras.chapters` cast

`ScopeExtras<S>` is introduced by Cluster C's [S15] (it's required by the helper signature). By the time Cluster E ships, the type exists. [S9] in this cluster is the consumer-side cleanup: **verify the cast at `ImageGallery.tsx:334–338` is no longer necessary and drop it**, replacing it with the typed accessor. Type-only change; verifies via `npm run typecheck` plus a type-test in `errors/scopes.test.ts`.

### [S13] Extract `refreshTrashList()` (`useTrashManager.ts`)

`confirmDeleteChapter:158–178` duplicates `openTrash:53–71` almost verbatim. Extract to a shared helper; both sites call it. Existing tests pin behavior.

### [S14] `SnapshotPanel` mount-effect dedup

`SnapshotPanel.tsx:139–159` and `:164–189` both call `fetchSnapshots`. Have the mount effect call `fetchSnapshots()` directly; move `chapterSeq.abort()` into it. Existing tests pin behavior.

### [S2] + [F retrospective] CLAUDE.md updates

Edit **§Key Architecture Decisions / "Unified API error mapping"** to:

1. Describe both `possiblyCommitted` mechanisms — 2xx BAD_JSON for `committed:`-declaring scopes **and** the `committedCodes` extension that maps specific server codes (`UPDATE_READ_FAILURE`, `READ_AFTER_CREATE_FAILURE`, `RESTORE_READ_FAILURE`) to the same flag.
2. Reference `ScopeExtras<S>` (introduced by Cluster C's [S15]) as the typed accessor for `extras`.
3. Reference `applyMappedError(mapped, handlers)` (introduced by [S15]) as the canonical consumer pattern for routing mapper output into UI state — parallel with how the doc already names `useEditorMutation` for save-pipeline invariants and `useAbortableSequence` for the bump-before-request contract. Hand-rolled `if (message === null) return; if (message) setX(message)` ladders are the deprecated form.

Edit **§Pull Request Scope** to add a one-line note acknowledging the 4b.3 bundling as a logged exception:

> The unified-error-mapper migration (4b.3) shipped with sanitizer hardening + CONTRIBUTING + Node-engines pin attached, in violation of the one-feature rule. Phase 4b.3a accepts this as a logged exception; recurrence requires explicit per-phase justification.

### [S22]/[S23] PR-shape transparency

No code change. The vitest worker-cap tuning and ESLint sequence-rule test-infra adjustments shipped in 4b.3 are documented here (Cluster F retrospective) as part of accepted-exception scope. Reviewers verify this design entry exists; no further action.

### Cluster E tests

- Unit coverage for [S6].
- Type-test for [S9].
- Existing tests cover [S13] and [S14] refactors.
- CLAUDE.md edits are doc-only.

### Cluster E out-of-scope

Any consumer-recovery changes (Cluster C); any new scope/byCode entries (Cluster A).

## Cluster F — PR-shape retrospective (resolved at design level)

**Item:** [I15] (PlanAlignment, High).

### Decision

**Accept and document.** The unified-error-mapper PR (4b.3) bundled the error-mapper migration with sanitizer hardening + CONTRIBUTING.md + Node-engines pin — a one-feature-rule violation. The PR is merged; retro-splitting is mostly cosmetic and burns time. Instead:

1. This design document logs the bundling as an explicit exception.
2. Cluster E's CLAUDE.md edit reinforces the recurrence rule (see [S2] + [F retrospective] above).
3. The vitest worker-cap tuning ([S22]) and ESLint sequence-rule test-infra adjustments ([S23]) are reclassified from "split or justify" to "documented as part of the accepted exception." No code action.

No retro-added phase entry in `docs/roadmap.md` for the bundled work — the design + CLAUDE.md note is the ledger.

## Cross-cutting

### Definition of Done (phase)

- All five PRs (D, A, B, C, E) merged to `main`.
- `make all` green at the close of each PR (lint + format + typecheck + coverage + e2e).
- No coverage regression — existing thresholds in `vitest.config.ts` (95% statements / 85% branches / 90% functions / 95% lines) hold or improve.
- Zero new warnings in test output (CLAUDE.md §Testing Philosophy).
- Roadmap updated: Phase 4b.3a row → Done; Phase 4b.3 row → Done.

### Per-PR DoD

Each cluster's PR description references this design doc, lists the items it closes (e.g. "Closes [I1], [I2], [S1]"), and includes the scope-exception rationale where applicable (Cluster B, Cluster C).

### Inter-cluster dependencies

- D → A: independent; D first because of security priority.
- A → B: independent.
- **B → C:** Only [S10] in Cluster C depends on Cluster B (the `!signal.aborted` dev-warn requires the signals threaded by [I8] in B). [S17] and [S19] are independent ref-nulling on `createRecoveryAbortRef` / `viewAbortRef` — both refs already exist in the code today; the fix is hygiene on success paths and does not depend on Cluster B.
- **C → E:** Cluster C's [S15] introduces `ScopeExtras<S>`; Cluster E's [S9] consumes it (drops the existing `ImageGallery` cast). CLAUDE.md updates in E ([S2], [F retrospective]) reference patterns landed in prior clusters.

### Risks

1. **Save-pipeline invariants (CLAUDE.md §Key Architecture Decisions).** Clusters B and C touch `useProjectEditor.handleSave`, `loadProject`, and editor-mutation paths. The five invariants — `markClean()` before invalidating server calls, `setEditable(false)` around mid-typing mutations, cache-clear after server success, sequence-bump before request, error-code allowlist — must be upheld. **Mitigation:** any path that mutates editor content routes through `useEditorMutation`; any path whose response must be discarded on supersession routes through `useAbortableSequence` (the existing ESLint rule rejects hand-rolled `useRef<number>` counters). New tests assert invariant order at every changed call site. Reviewers verify against the invariants checklist.
2. **Cluster C's bundled scope.** 14 items in one PR is the largest review surface in this phase. **Mitigation:** organize commits by sub-theme (one item per commit where feasible) so reviewers can navigate by commit; the §Sub-themes structure above maps directly onto commit groups.
3. **e2e flakiness from race-condition tests.** Cluster B's "navigate mid-export" and Cluster C's "rapid create-then-navigate" e2e tests inherently exercise timing. **Mitigation:** use Playwright's network interception to deterministically slow the relevant request, then assert the unmount path; do not rely on real network timing.
4. **Coverage regression as test surface grows.** Adding many small fixes can dilute coverage if tests are perfunctory. **Mitigation:** CLAUDE.md §Testing Philosophy applies — every fix gets a meaningful test, never a minimum-bar test; aim to push thresholds up, not coast at the floor.

### Test strategy summary

- **Unit (`packages/{shared,server,client}/src/**/*.test.ts`):** every new branch in `scopes.ts`, `apiErrorMapper.ts`, `sanitizer.ts`. Type-tests for `ScopeExtras<S>`. Sanitizer regression cases for `data:` / `javascript:` / non-Smudge URIs.
- **Integration (Vitest + React Testing Library):** consumer-recovery branches; AbortSignal-on-unmount per call site (one render-then-unmount test per site); `applyMappedError` helper.
- **e2e (Playwright + aXe-core):**
  - [I2] chapter-save 404 banner copy.
  - [I14] sanitizer rejection of `data:` / `javascript:` URIs in rendered snapshot content (use a server-fixture snapshot blob).
  - [I11] navigate mid-replace: no error toast post-unmount.
  - [I12] navigate mid-export: same.
  - [S11] chapter-create 404 redirect to home.
  - [I3] possiblyCommitted snapshot create then panel refresh.
  - [I5] silent dismiss now surfaces error.
- **Coverage:** all new code lands at or above thresholds. Reviewers reject perfunctory tests.

### Out-of-scope (whole phase)

- Phase 4b.4 work (raw-strings ESLint rule).
- Phase 4b.5 work (Editor State Machine).
- New API error codes or HTTP status codes (allowlist stays per CLAUDE.md §API Design).
- Any user-visible behavior change beyond:
  - Fixing misleading copy ([I1], [I2], [S1], [S16]).
  - Defense-in-depth rejection of malicious image src ([I14]).
  - Graceful navigation on stale-project state ([S11]) — explicitly logged as consistency with `EditorPage:1552`.
  - Surfacing previously silent failures ([I5], [S10]).

## Branching

All five PRs land on `ovid/miscellaneous-fixes`, rebased on `main` between merges. The branch name predates this phase; we accept it as-is rather than rename.

## Roadmap update

After this design lands, `docs/roadmap.md` is updated:

1. Insert `<!-- plan: 2026-04-25-4b3a-review-followups-design.md -->` on the line after the `---` separator preceding `## Phase 4b.3a:`.
2. Mark Phase 4b.3a "In Progress" in the Phase Structure table.
3. Mark Phase 4b.3 "Done" in the Phase Structure table.

## Open questions

None at design time. All decisions logged in this document.
