# Semantic Duplicate Code Hunt: ovid/experimental-dedup (second pass)

**Date:** 2026-04-28 08:13:33
**Repository:** /workspace (Smudge — TypeScript monorepo)
**Scope:** Full repo (`packages/{shared,server,client}`); `.devcontainer/`, `dist/`, `coverage/`, `node_modules/` excluded
**Commit:** 4129d99 (working tree clean except for the report directory)
**Mode:** full scan, complementing prior pass (`ovid-experimental-dedup-2026-04-28-08-02-18-093074c.md`)

## Executive Summary

Three Important findings and one Suggestion remain after verification, all in the *route/orchestration boilerplate* layer rather than the editor pipeline (which the prior pass mined). The two highest-leverage extractions are a `notFound(res, "X")` route helper (~20 verbatim sites across 4 route files) and a `useAbortableAsyncOperation` hook (~7 hand-rolled `AbortController` + `signal.aborted` blocks across 4 cross-confirmed hooks/components, with ~8 additional production sites in the client deferred for per-site evaluation). Nine candidates that the specialists raised were rejected after reading the actual code — most because they confused architectural necessity (DOCX bypassing an HTML wrapper, snapshots lacking a delete-block guard) with semantic duplication.

## Findings by Severity

### Critical Issues

None.

### Important Issues

#### [I1] 404 not-found response envelope duplicated ~20 times across 4 route files

- **Canonical concept:** "Service returned `null` ⇒ emit `404 { error: { code: "NOT_FOUND", message: "<Resource> not found." } }` and return."
- **Duplicate locations (verified, not specialist-summarised):**
  - `packages/server/src/projects/projects.routes.ts:50–53, 84–87, 98–101, 121–124, 150–153, 163–167, 177–181` — 7 sites
  - `packages/server/src/chapters/chapters.routes.ts:14–17, 38–41, 77–80, 92–95` — 4 sites
  - `packages/server/src/snapshots/snapshots.routes.ts:50–53, 74–77, 97–100, 114–117, 131–137` — 5 sites
  - `packages/server/src/search/search.routes.ts:86–89, 94–97, 131–134, 146–149` — 4 sites
- **Why semantically duplicate:** Each site is the same five-line block with only the resource-name string changing. The pattern is the implementation of one rule from the API design (CLAUDE.md §API Design): a not-found returns this exact envelope. It is not a coincidence of similar code — it is repeated implementation of a single contract.
- **Important differences:** Two sites in `search.routes.ts` (`:94–97` and `:146–149`) emit `NOT_FOUND` for a different reason — the *project's chapters* collection was empty when the service was supposed to return at least one — but the envelope shape is identical. No site adds logging, headers, or extras. The message string is the only varying field.
- **Impact:** If the API contract evolves (request-id header for tracing, `details` field for human-readable hints, structured error metadata), every site must be updated in lockstep. The contract today is in CLAUDE.md and reviewer memory; the code carries no enforcement.
- **Suggested consolidation:** Add a one-line helper in `packages/server/src/app.ts`:
  ```ts
  export function notFound(res: Response, resource: string): void {
    res.status(404).json({ error: { code: "NOT_FOUND", message: `${resource} not found.` } });
  }
  ```
  Migrate the 20 sites to `if (!result) { notFound(res, "Project"); return; }`. Mechanical; fully test-covered today.
- **Confidence:** High (82). Verifier read all 20 sites.
- **Found by:** Server CRUD specialist; verified.

#### [I2] Validation-error envelope duplicated across 6+ routes (with one fork)

- **Canonical concept:** "Zod `safeParse` failed ⇒ emit `400 { error: { code: "VALIDATION_ERROR", message: <issues[0]> } }` and return."
- **Duplicate locations (verified):**
  - `packages/server/src/snapshots/snapshots.routes.ts:38–44` — `createSnapshot` body parse
  - `packages/server/src/snapshots/snapshots.routes.ts:16–22` — `validateUuidParam` UUID parse (same envelope)
  - `packages/server/src/search/search.routes.ts:70–76` — `searchProject`
  - `packages/server/src/search/search.routes.ts:115–121` — `replaceInProject`
  - `packages/server/src/settings/settings.routes.ts:22–28` — `PATCH /api/settings`
  - `packages/server/src/projects/projects.routes.ts:55–59, 126–130` — service-supplied `{ validationError }` reformatted
  - `packages/server/src/projects/projects.routes.ts:15–18` — `createProject` direct safeParse path
- **Why semantically duplicate:** Two different shapes funnel into the same envelope. Most sites do `Schema.safeParse(req.body)` directly in the route. Projects and chapters services return a `{ validationError: string }` discriminated branch, which the route then *re-wraps* into the same envelope (`projects.routes.ts:56–58`, `:127–129`). The wire contract is one thing; the codepaths to produce it are five or six.
- **Important differences:** The fallback string differs: routes that parse directly write `parsed.error.issues[0]?.message ?? "Invalid input"`; routes that consume a service `{ validationError }` branch use the service's message verbatim. If a future request needs the *field name* in the error, both shapes must change.
- **Impact:** Lower than I1 because a Zod major-version bump is the kind of thing that already requires repo-wide attention; but the duplication still means the validation envelope contract is implicit.
- **Suggested consolidation:** Same `app.ts` helper file as I1:
  ```ts
  export function validationError(res: Response, message: string): void {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message } });
  }
  export function respondValidationParse<T>(
    res: Response, parsed: SafeParseReturnType<unknown, T>
  ): T | undefined {
    if (parsed.success) return parsed.data;
    validationError(res, parsed.error.issues[0]?.message ?? "Invalid input");
    return undefined;
  }
  ```
  Routes use `const data = respondValidationParse(res, Schema.safeParse(req.body)); if (!data) return;`. The service-discriminant branches keep using `validationError(res, result.validationError)`.
- **Confidence:** Medium-High (76). Verified.
- **Found by:** Server CRUD specialist; verified.

#### [I3] AbortController + `signal.aborted` guard hand-rolled at 4 cross-confirmed sites (~7 refs); ~8 additional sites deferred

- **Canonical concept:** "On user-driven action that supersedes a prior in-flight request: abort prior controller, create fresh, thread `signal` into fetch, and check `controller.signal.aborted` (or equivalent) before any `setState`. On unmount, abort all outstanding."
- **Duplicate locations (verified):**
  - `packages/client/src/hooks/useTrashManager.ts:55–60` (`openTrash`) — `trashAbortRef`
  - `packages/client/src/hooks/useTrashManager.ts:80–85` (`handleRestore`) — `restoreAbortRef`
  - `packages/client/src/hooks/useFindReplaceState.ts:212–213` (instantiation in `search`); post-response cleanup at `:259`. The unmount cleanup at `:100–104` and the project-change cleanup at `:130–131` are mirror sites that the new hook's own cleanup effect would subsume.
  - `packages/client/src/components/ImageGallery.tsx:184–209` (`handleFileSelect`) — `mutateAbortRef`
  - `packages/client/src/components/ImageGallery.tsx:234–262` (`handleSave`) — `mutateAbortRef` (reused)
  Total ~7 distinct refs across these 4 files.
- **Sites considered and excluded:** `Editor.tsx:315–330` (paste/drop image upload) does **not** use an `AbortController` on verification (`grep -n "AbortController\|signal.aborted" packages/client/src/components/Editor.tsx` returns nothing); the path uses a `projectIdRef.current !== uploadProjectId` stale-id check, not `AbortController`. Not a member of this set. The original specialist hit was a false positive.
- **Sites deferred (verified via `grep -rln "new AbortController" packages/client/src`, ~8 additional production files):** `App.tsx`, `DashboardView.tsx`, `ExportDialog.tsx`, `ProjectSettingsDialog.tsx`, `SnapshotPanel.tsx`, `useProjectEditor.ts`, `useSnapshotState.ts`, `EditorPage.tsx`, `HomePage.tsx`. Each needs a per-site evaluation — some thread through `useAbortableSequence` already, some are one-shot fetches, some are dialogs with their own forthcoming lifecycle hook. Reassess after the four in-scope migrations land.
- **Why semantically duplicate:** Every in-scope site implements the same four-step state machine — `prior?.abort()` → `new AbortController()` → `signal` threaded into the request → post-response guard `if (controller.signal.aborted) return`. The pattern is meaningful enough that reviewers have left detailed inline comments explaining it (`useTrashManager.ts` carries multiple round-numbered comments). That review residue is itself the smell: if reviewers have to re-derive the invariant per site, the abstraction is missing.
- **Important differences (load-bearing):**
  - `useFindReplaceState` combines `AbortController` *and* `useAbortableSequence` — it needs both network cancellation and response-staleness arbitration.
  - `useTrashManager` uses two separate refs because trash-load and trash-restore can be independently in-flight.
  - `ImageGallery` uses the `.then().catch()` form, not async/await, so its post-response guard sits in the resolution callback rather than after `await`.
  These differences mean a one-size-fits-all hook will need optional knobs; they do not invalidate the duplication.
- **Distinction from `useAbortableSequence`:** `useAbortableSequence` solves *response staleness* (an old response should be discarded if a newer request started). `AbortController` solves *network cancellation* (don't waste bandwidth on a result we're going to discard). Both correct uses; the hook does not subsume the pattern.
- **Impact:** Each new list/detail/upload pane is likely to copy the nearest neighbour. Off-by-one errors in cleanup-on-unmount are easy to make.
- **Suggested consolidation:** Add `useAbortableAsyncOperation` to `packages/client/src/hooks/`:
  ```ts
  export function useAbortableAsyncOperation() {
    const ref = useRef<AbortController | null>(null);
    useEffect(() => () => ref.current?.abort(), []);
    return {
      run<T>(fn: (signal: AbortSignal) => Promise<T>): { promise: Promise<T>; signal: AbortSignal } {
        ref.current?.abort();
        const c = new AbortController();
        ref.current = c;
        return { promise: fn(c.signal), signal: c.signal };
      },
      get aborted() { return ref.current?.signal.aborted ?? false; },
    };
  }
  ```
  The four in-scope sites become two-line: `const op = useAbortableAsyncOperation(); const { promise, signal } = op.run(fetchFn); ...; if (signal.aborted) return;`. Migrate one site at a time behind characterization tests.
- **Confidence:** Medium-High (78). Verifier confirmed the 4 in-scope sites; the 5th (Editor.tsx) was rejected on verification, and the additional ~8 production sites are flagged for separate evaluation.
- **Found by:** Save/sequencing specialist; image/snapshot specialist (cross-confirmed via `ImageGallery`); verified.

### Suggestions

#### [S1] `possiblyCommitted` refresh recipe duplicated at 3 image-upload sites

- **Concept:** When an image upload returns 2xx with a body the client could not parse (`mapApiError(...).possiblyCommitted === true`), the client must reload authoritative state before allowing retry — otherwise a retry would create a duplicate upload.
- **Locations:** `ImageGallery.tsx:204–206` (`handleFileSelect`), `ImageGallery.tsx:256–258` (`handleSave`), `Editor.tsx:328–329` (paste/drop). Each site calls `incrementRefreshKey()` (gallery) or fires `onImageUploadCommitted()` (editor → caller refresh).
- **Why a Suggestion not Important:** Three sites is small, two of them are in the same file, and the consolidation candidate (`useImageUploadWithCommittedRefresh(projectId)`) would couple the gallery and the editor's image-upload paths to a single hook. That coupling is currently handled via a callback prop (`onImageUploadCommitted`), which is a reasonable boundary. Consolidate only if a fourth image-upload entry point appears (drag-drop on detail view, bulk import).
- **Confidence:** 74.

## Type and Constraint Equivalence Notes

This pass found no new type/constraint duplicates. The prior pass already covered chapter-status drift (I3 in that report), the canonicalize unsafe-keys set (I4), and the `author_name` schema/DB length asymmetry (S2). UUID validation (image regex vs snapshot Zod) was specifically examined and rejected — see below.

## Rejected Candidate Duplicates

| Candidate | Reason rejected |
|-----------|-----------------|
| **DOCX renderer "bypasses" image-resolver pipeline** (`docx.renderer.ts:315–389`) | The DOCX path *does* call the shared `resolveImage()` and `buildCaptionText()`. It skips `resolveImageSrcs` only because that wrapper builds an HTML `<figure>` element that DOCX cannot use — DOCX needs `ImageRun + Paragraph` from the docx library. Architectural necessity, not duplication. |
| **HTML+Markdown TOC anchor policy** (`export.renderers.ts:120–126` and `:185–191`) | Two sites in the *same file*, ~60 lines apart. Co-located is the right factoring; "extract to a helper" would reduce two literals to one literal at the cost of a function call. Net negative. |
| **`daysAgoDate` in `velocity.test.ts` reimplementing `velocity.service.ts`** | The test helper exists because the test freezes time. Both implementations use `setUTCDate` + `toISOString().slice(0,10)`; no current drift. Test-only utility duplication is not actionable per the skill (skill §"What Does Not Count": "Repeated test setup unless it obscures behavior or regularly diverges"). |
| **UUID validation: regex (`images.paths.ts:9`) vs Zod (`snapshots.routes.ts:7`)** | Different domains. The regex is part of `IMAGE_SRC_REGEX` for *scanning HTML attribute values* during reference extraction (`images.references.ts:60`, `docx.renderer.ts:320`). The Zod schema validates `req.params.id` as a route param. They never validate the same input; they just both happen to match UUIDs. |
| **`MS_PER_DAY = 86_400_000`** (single occurrence in `velocity.service.ts:5`) | Single named constant, not a duplicate at all. False positive from the specialist. |
| **Snapshot-delete missing image-style reference-block guard** | Absence of a feature in one place is not duplication. Snapshots cascade-delete on chapter delete (migration 014 `onDelete CASCADE`); images use app-level scan-and-block because they are project-scoped, not chapter-scoped. Different bounded contexts, intentional. |
| **Image metadata length bounds (none) vs snapshot label length cap (500 graphemes)** | Asymmetry is not duplication. If image metadata needs a length cap, that's a hardening task, not a dedup task. |
| **ImageGallery vs SnapshotPanel list+detail+delete structural similarity** | The shared mechanism is the abort/sequence pattern, captured in I3. The list+detail+delete UI is otherwise correctly distinct (grid vs timeline, different selection models). |
| **Image+snapshot canonicalize+walk** | Already covered as I4 and I5 in the prior report. The image-references walker was specifically called out there. |

## Consolidation Strategy

**Order of work, lowest-risk first:**

1. **I1 — `notFound(res, "X")` helper.** Add to `packages/server/src/app.ts`. Migrate the 20 sites in one PR (mechanical, all currently test-covered). Estimated 30–45 min including running the test suite. Single feature per CLAUDE.md.
2. **I2 — `validationError(res, msg)` and `respondValidationParse(res, parsed)` helpers.** Same `app.ts` file. Migrate the 6 direct-safeParse sites; leave the service-discriminant sites using just `validationError()`. ~45 min.
3. **I3 — `useAbortableAsyncOperation` hook.** Add to `packages/client/src/hooks/`. Write the hook + tests; migrate one call site at a time behind characterization tests. ~2 hours for the four in-scope sites; each migration is independently shippable, do not bundle all four. The remaining ~8 client AbortController sites are deferred per the I3 "Sites deferred" list.
4. **S1 — defer.** Reassess if a fourth image-upload entry point appears.

**Per CLAUDE.md's one-feature rule:** I1, I2, and I3 are three distinct refactors. They should be three PRs. I1 and I2 share a file but address different envelopes; combining them is borderline acceptable since both are server-side error-envelope helpers. I3 is client-side and unambiguously its own PR.

**Safe migration sequence for each:**
1. Add the helper in a separate commit.
2. Migrate one consumer + its tests; run the full suite.
3. Continue migrating; squash if the per-consumer commits are tiny.
4. Final commit removes any now-dead error-envelope literals.
5. No public-API change; no compat wrappers needed.

## Review Metadata

- **Agents dispatched:** 5 specialists (server CRUD, save/sequencing/error, export pipeline, date/velocity/timezone, image/snapshot pipeline) + 1 verifier
- **Files scanned:** ~80 source files across the three packages and `packages/server/src/db/migrations/`
- **Candidate pairs/groups discovered:** 13 across the 5 specialists
- **Verified findings:** 4 (3 Important, 1 Suggestion)
- **Rejected candidates:** 9
- **Cross-confirmed by ≥2 specialists:** I3 (the AbortController pattern was independently noticed by the save/sequencing specialist and surfaced again by the image/snapshot specialist looking at `ImageGallery`)
- **Generated/vendor paths excluded:** `dist/`, `node_modules/`, `coverage/`, `.devcontainer/`, `test-results/`, `playwright-report/`
- **Steering files consulted:** `CLAUDE.md` (API design §, save-pipeline invariants, mapApiError contract, one-feature PR rule, .devcontainer exclusion)
- **Tests consulted:** `chapters.routes.test.ts`, `snapshots.routes.test.ts`, `search.routes.test.ts`, `useTrashManager.test.ts`, `useFindReplaceState.test.ts`, `velocity.test.ts`, `velocityHelpers.test.ts`, `images.routes.test.ts`
- **Prior report cross-referenced:** `paad/duplicate-code-reports/ovid-experimental-dedup-2026-04-28-08-02-18-093074c.md`. C1, I1–I5 from that report excluded from this scan's reportable surface.
