# Phase 4b.3a.4 — Image Gallery Abort Migration (Design)

**Date:** 2026-05-25
**Author:** Ovid / Claude (collaborative)
**Roadmap phase:** 4b.3a.4 (the third and final of three independent file-migrations consuming the Phase 4b.3a.1 hook; 4b.3a.2 — `useFindReplaceState` — and 4b.3a.3 — `useTrashManager` — already merged)
**Prerequisite phase:** 4b.3a.1 — `useAbortableAsyncOperation` (`docs/plans/2026-04-29-abortable-async-operation-hook-design.md`)
**Sibling phases already merged:**
- 4b.3a.2 — `useFindReplaceState` (`docs/plans/2026-05-01-find-replace-abort-migration-design.md`)
- 4b.3a.3 — `useTrashManager` (`docs/plans/2026-05-24-trash-manager-abort-migration-design.md`)
**Companion hook:** `useAbortableAsyncOperation` (`packages/client/src/hooks/useAbortableAsyncOperation.ts`)
**Working branch:** `image-gallery-abort-migration`

---

## Goal

Migrate `packages/client/src/components/ImageGallery.tsx`'s two hand-rolled `useRef<AbortController>` instances to two side-by-side `useAbortableAsyncOperation` instances:

- `const mutationOp = useAbortableAsyncOperation()` — shared by `handleFileSelect`, `handleSave`, `handleInsert`'s auto-save inner branch, and `handleDelete`. The four mutations are mutually exclusive at the user-action level; calling any one cancels the in-flight one of the others, by design.
- `const refsOp = useAbortableAsyncOperation()` — owned by the Delete-button click handler's references refresh, which this PR additionally extracts from the JSX `onClick` arrow into a named `handleOpenDeleteConfirm` function alongside the other top-level handlers.

The two ops are intentionally orthogonal: a refsRefresh in flight must NOT abort an in-progress mutation, and vice versa.

This phase is also the **last** of three sibling consumer-migrations (4b.3a.2 → 4b.3a.4) of the Phase 4b.3a.1 hook. It collapses `migrationStructuralCheck.test.ts`'s per-file `useRef<AbortController>` ban into one global `packages/client/src` ban (excluding the hook file itself), retiring the per-file checks that the two prior phases extended one entry at a time.

## Why now

Phase 4b.3a.1 shipped the `useAbortableAsyncOperation` primitive. Phase 4b.3a.2 gave it its first production-side validation against a one-instance, one-operation consumer. Phase 4b.3a.3 validated it against a two-instance, three-operation consumer with both shared and independent semantics. `ImageGallery` is the largest of the three consumers — **five operations across two hook instances** — so it's the strongest validation of the hook's coupling story. It is also the file that justifies the structural-check collapse: the per-file `migrated` arrays in `migrationStructuralCheck.test.ts` were always a stepping stone to a global ban once all three migrations landed.

## Writer-impact framing

No user-facing change. The win is reviewer-facing: the next person to touch `ImageGallery` sees two well-named hook instances owning their abort lifecycles, instead of two bespoke refs plus a hand-rolled unmount cleanup effect plus a 36-line inline JSX arrow that hides an abort dance inside a click handler. That review-residue is what motivated extracting the hook in 4b.3a.1; this phase realizes the payoff for the last consumer.

The bundled handler extraction (`handleOpenDeleteConfirm`) is a small adjacent refactor justified on readability grounds: the post-migration body is still 15+ lines of `setReferencesLoaded(false)` → `refsOp.run(...)` → `.then`/`.catch` with both `signal.aborted` and `selectedImageIdRef`-identity gates. Inline-arrow JSX of that length is awkward to point at in review, and every other handler in the file is already top-level.

## Architecture

`ImageGallery` allocates **two** `useAbortableAsyncOperation` instances side-by-side, one per existing ref:

```
ImageGallery
├── const mutationOp = useAbortableAsyncOperation()  → shared by handleFileSelect + handleSave + handleInsert (inner branch) + handleDelete
├── const refsOp     = useAbortableAsyncOperation()  → owned by handleOpenDeleteConfirm (extracted from JSX onClick)
├── selectedImageIdRef  (UNCHANGED — cross-axis identity gate, orthogonal to abort lifecycle)
└── list-load + detail-references useEffect controllers  (UNCHANGED — out of scope per roadmap)
```

The two `useEffect` blocks that allocate per-effect `AbortController`s (list-load at lines 98–127, detail-references at lines 145–170) stay as-is. Their lifecycle is "controller-per-effect, cleanup-on-dep-change" — a fundamentally different shape from the hook's "abort-prior-on-action" contract. The roadmap explicitly excludes them.

The combined unmount cleanup `useEffect` at lines 74–80 is removed entirely. Both hook instances handle their own auto-abort.

## Behaviour mapping (every touchpoint)

Each row maps a current-code touchpoint (line numbers as of HEAD on `main` at design time) to its post-migration form. **The design names changes by behaviour, not by line, so plan-execution is robust to line drift between design and implementation.**

| # | Current behaviour | Current location | Post-migration form |
|---|---|---|---|
| 1 | `mutateAbortRef = useRef<AbortController \| null>(null)` | line 67 | Removed. New: `const mutationOp = useAbortableAsyncOperation();` allocated alongside the other top-level refs. |
| 2 | `refsAbortRef = useRef<AbortController \| null>(null)` | line 73 | Removed. New: `const refsOp = useAbortableAsyncOperation();` allocated immediately after `mutationOp`. |
| 3 | Combined unmount cleanup: `useEffect(() => () => { mutateAbortRef.current?.abort(); refsAbortRef.current?.abort(); }, [])` | lines 74–80 | Removed entirely. Subsumed by both hooks' auto-abort on unmount. The announcement-timer cleanup effect at lines 129–135 is **not** touched — orthogonal. |
| 4 | `handleFileSelect` body — `mutateAbortRef.current?.abort(); const controller = new AbortController(); mutateAbortRef.current = controller; ... api.images.upload(projectId, file, controller.signal).then(...).catch(...)` | lines 184–208 | `const { promise, signal } = mutationOp.run((s) => api.images.upload(projectId, file, s)); promise.then(...).catch(...)`. Callback param named `s` to avoid shadowing the destructured `signal` used by the two existing `if (controller.signal.aborted) return` gates (lines 190, 195), which become `if (signal.aborted) return` against the per-call `signal`. Placement preserved exactly. |
| 5 | `handleSave` body — same shape as row 4 against `api.images.update` | lines 234–262 | `const { promise, signal } = mutationOp.run((s) => api.images.update(selectedImage.id, formState, s)); const updated = await promise;`. The two `if (controller.signal.aborted) return` gates (lines 239, 244) become `if (signal.aborted) return` against the per-call `signal`. The success-path `setSelectedImage(updated)`, `setSaveStatus("saved")`, `incrementRefreshKey()` AND the catch-path `setSaveStatus("idle")`, `mapApiError`, `possiblyCommitted` handling all stay exactly as-is. |
| 6 | `handleInsert` inner-branch body — same shape as row 5, conditional on `saveStatus !== "saved"` | lines 269–295 | Same swap as row 5. The `if (saveStatus !== "saved")` outer guard is untouched. The post-success `imageToInsert = updated` reassignment stays inside the new gate (so it runs only when the signal is NOT aborted). The post-block `onInsertImage(...)` + `announce(...)` (lines 297–298) are unchanged. |
| 7 | `handleDelete` body — same shape as row 5 against `api.images.delete` | lines 304–343 | Same swap as row 5. Two `if (controller.signal.aborted) return` gates (lines 309, 315) become `if (signal.aborted) return`. The catch's `!message` early-return, `possiblyCommitted` branch, `extras?.chapters` 409 IMAGE_IN_USE branch, and trailing `setConfirmingDelete(false)` all stay as-is. |
| 8 | Inline JSX `onClick` arrow for the link-style "Delete" button — captures `imageId`, calls `setReferencesLoaded(false)`, aborts prior, allocates controller, fires `api.images.references(imageId, controller.signal)`, then `setConfirmingDelete(true)` | lines 587–625 | **Extracted** to a named `function handleOpenDeleteConfirm()` declared alongside the other top-level handlers (after `handleDelete`, before `updateField`). JSX becomes `onClick={handleOpenDeleteConfirm}`. **Body migration:** `refsAbortRef.current?.abort(); const controller = ...; refsAbortRef.current = controller;` (lines 599–601) becomes `const { promise, signal } = refsOp.run((s) => api.images.references(imageId, s));`. The two `if (controller.signal.aborted) return` checks (lines 605, 611) become `if (signal.aborted) return` against the per-call `signal`. The two `if (selectedImageIdRef.current !== imageId) return` identity gates (lines 606, 612) stay **immediately after** the abort gates in both `.then` and `.catch`. The `setReferencesLoaded(false)` (line 596) stays **before** the `refsOp.run` call to preserve UI-reset-then-fire ordering. `setConfirmingDelete(true)` (line 624) stays as the last statement, outside the `if (selectedImage)` guard. |
| 9 | Inline review-callout comments referencing `mutateAbortRef` / `refsAbortRef` by name | lines 62–66 (I10+I11 block) and lines 68–72 (S2 block, which closes with "Mirror mutateAbortRef.") | **Within these two comment blocks only**: rephrase to reference `mutationOp` / `refsOp` instead of the ref names. Preserve the *why* — the I10+I11 rationale (overlapping clicks cannot race + multi-MB upload should not keep running server-side) in 62–66, the S2 rationale (late refresh resolving after navigate-away would mis-gate / surface stale data) in 68–72. **Do not touch any other inline comment**, including: the I9 comments in the list/detail useEffect blocks (lines 99–104, 147), the I8 callout for `externalRefreshKey` (lines 11–14), the I3/I4 `possiblyCommitted` UX rationale (lines 197–204, 247–256, 284–296), the C3 BAD_JSON delete rationale (lines 320–327), the I6 references-failure rationale (lines 158–165, 613–620), the `selectedImageIdRef` capture-time-identity rationale (lines 54–60, 138–144, 590–594), and the S2 click-handler signal-thread comment (lines 597–598). Those blocks are orthogonal to the abort-primitive change. |

### Why each `if (signal.aborted) return` gate stays put

The pre-migration gates exist for the zero-warnings invariant (CLAUDE.md §Testing Philosophy): a superseded or unmount-time abort must not fire `console.error` or call `setState` on a torn-down component. Today the gates read `controller.signal.aborted`; post-migration they read the destructured `signal` returned by `mutationOp.run` / `refsOp.run`. Same object identity (the hook guarantees the signal it returns is the one passed to `fn` — see `useAbortableAsyncOperation.ts:48` and the 4b.3a.1 design's behavioural-contract bullet #2), same behaviour, same test coverage.

The placement of catch-path gates *before* `mapApiError(err, "image.…")` is preserved exactly: aborted errors take the silent path; non-aborted errors flow through the mapper. The mapper itself returns `message: null` for ABORTED today, so the gate is belt-and-suspenders against a future change to that contract — same rationale as the sibling phases.

### Why `selectedImageIdRef` identity gates stay alongside `signal.aborted`

The `signal.aborted` gate catches "this operation was superseded by abort." The `selectedImageIdRef.current !== imageId` gate catches "the user navigated to a different image before resolution, but this operation was never aborted." Both can be true; both can be false; they cover different staleness axes. The migration preserves both at both call sites (`.then` and `.catch`).

### Cross-instance independence is structural, not gated

`handleOpenDeleteConfirm`'s `refsOp.run(...)` allocates a fresh controller via the hook's internal `useRef`, distinct from `mutationOp`'s internal `useRef`. They cannot collide. This is the load-bearing invariant the §Out of Scope section warns against folding away — pinned by test #6 below, defended by both the architectural separation and the prose comment in §Out of Scope.

### Imports

`useRef` stays in the imports — still needed for `fileInputRef`, `announcementTimerRef`, `selectedImageIdRef`. `useEffect` stays — still needed for the list-load effect, detail-references effect, announcement-timer cleanup, and `selectedImageIdRef` sync. `useReducer`, `useCallback`, `useState` are all still in use. The only new import is `useAbortableAsyncOperation` from `../hooks/useAbortableAsyncOperation`.

## Test plan

All test changes land in `packages/client/src/__tests__/ImageGallery.test.tsx` (the existing 978-line file) and `packages/client/src/__tests__/migrationStructuralCheck.test.ts`. Per the roadmap "characterization tests BEFORE migration" requirement, the new tests land *first*. They pass green against the pre-migration source (they pin behaviour the current code already provides) and continue to pass against the post-migration source. This is the expected shape for a migration characterization test — see §Risks.

### Seven new characterization tests

All seven use `pendingUntilAbort(signal)` from `__tests__/helpers/abortableMocks.ts` for never-resolving mocks. All seven follow the signal-capture idiom from existing abort-tests at lines 737 (I9, list-load) and 810 (I6, references-fetch):

```ts
const capturedSignals: AbortSignal[] = [];
vi.mocked(api.images.upload).mockImplementation((_p, _f, signal) => {
  if (signal) capturedSignals.push(signal);
  return pendingUntilAbort(signal);
});
```

**Important capture-pattern note for `api.images.references` (tests #5 and #6):** the detail-references `useEffect` at lines 145–170 ALSO fires `api.images.references` on every `selectedImageId` change. A mock on `api.images.references` therefore captures both the `useEffect`'s controller signal AND the `refsOp`'s signal into the same array, in interleaved order. The cleanest discriminator is to drain-and-clear the useEffect's call before triggering the `refsOp` path:

```ts
// Open detail — fires the detail-references useEffect.
await openDetail(image);
// Drain the useEffect's pending call before mocking-clear and exercising refsOp.
await waitFor(() => expect(api.images.references).toHaveBeenCalledTimes(1));
vi.mocked(api.images.references).mockClear();
// Re-install the capture mock for the refsOp interactions only.
vi.mocked(api.images.references).mockImplementation((_id, signal) => { ... });
// Click first Delete — fires refsOp.run; from here `capturedSignals` is refsOp-only.
```

The implementation plan picks the exact mechanics, but the test must not assert on `capturedSignals[0]` without first ensuring the array contains only `refsOp`-triggered signals — otherwise the assertion silently measures the useEffect's signal and passes for the wrong reason. Tests #1, #2, #3, #4, #7 are unaffected (they mock different API surfaces with no `useEffect` competitor).

1. **`handleFileSelect aborts prior, threads signal, aborts on unmount`.** Render gallery in grid view. Trigger first file-select; capture signal1; assert `!aborted` (signal-threading + initial state). Trigger second file-select; capture signal2; assert `signal1.aborted === true` (abort-prior) and `signal2.aborted === false`. Call `unmount()`; assert `signal2.aborted === true` (abort-on-unmount). Three axes, one test.

2. **`handleSave threads signal, aborts on unmount`.** Setup: `openDetail(image)`. Click Save; capture signal1; assert `!aborted` (signal-threading + initial state). Unmount; assert `signal1.aborted === true` (abort-on-unmount). **Two axes, not three:** `handleSave`'s "abort-prior" axis is **not** DOM-testable. The Save button is disabled while `saveStatus === "saving"` (`ImageGallery.tsx:514`), and no public DOM path can transition `saveStatus` back to a non-`"saving"` value while the first `handleSave` is in flight via `pendingUntilAbort`. The contract is implicitly pinned by test #7: any other `mutationOp` handler fired while `handleSave` is in flight aborts the prior — the abort-prior contract holds at the hook layer (which has its own unit tests in `useAbortableAsyncOperation.test.ts`) regardless of which handler triggers the next `run()`.

3. **`handleInsert auto-save inner branch threads signal, aborts on unmount`.** Setup: `openDetail(image)`; `updateField` to set `saveStatus` to `"idle"` so the auto-save inner branch fires. Click Insert; capture signal1 (against `api.images.update`); assert `!aborted`. Unmount; assert `signal1.aborted`. **Pinning intent:** "the auto-save inner branch shares the same `mutationOp` as `handleSave`." **Two axes, not three:** same reasoning as test #2 — the Insert button is disabled while `saveStatus === "saving"` (`ImageGallery.tsx:522`), and `handleInsert`'s inner branch sets `saveStatus` to `"saving"` itself. Abort-prior is implicitly pinned by test #7. **Mandatory:** the test asserts `expect(api.images.update).toHaveBeenCalledTimes(1)` between the trigger and the signal-state assertion so a setup mistake that leaves `saveStatus === "saved"` (and therefore SKIPS the inner branch) fails loudly instead of passing silently.

4. **`handleDelete aborts prior, threads signal, aborts on unmount`.** Setup: `openDetail(unusedImage)`; click first Delete button (transitions to `confirmingDelete: true`); click confirm Delete (capture signal1 against `api.images.delete`; assert `!aborted`). Click confirm Delete again (the confirm button stays rendered because the first call is held by `pendingUntilAbort` — neither success nor catch resolves until the second click's `mutationOp.run` aborts the first signal, at which point the first call's `.catch` runs but the `if (signal.aborted) return` gate at the top of the catch returns before reaching the `setConfirmingDelete(false)` line); capture signal2; assert `signal1.aborted`. Unmount; assert `signal2.aborted`.

5. **`handleOpenDeleteConfirm (references refresh) aborts prior, threads signal, aborts on unmount`.** Setup: `openDetail(image)`. Click first Delete button (which fires the references refresh via `refsOp.run` AND sets `confirmingDelete: true`); capture signal1 against `api.images.references`; assert `!aborted`. The first Delete button is no longer rendered (replaced by confirm UI), so trigger the second `refsOp.run` by `backToGrid` → `openDetail(image)` → click first Delete again; capture signal2; assert `signal1.aborted`. Unmount; assert `signal2.aborted`. **Note:** `backToGrid` does NOT abort the in-flight refsRefresh — it only resets state — so the first signal remains alive until the second `refsOp.run` call aborts-prior.

6. **`mutationOp and refsOp are independent (no cross-abort)`.** Pins the §Out of Scope "do not fold the two ops" invariant — without this test a future maintainer collapsing them would silently regress the "delete-in-flight does not abort an in-progress references refresh" non-relationship.
   - `openDetail(image)`; click Save (capture `updateSig`; assert `!aborted`).
   - Click first Delete button (capture `refsSig`; assert `!aborted`). Assert `updateSig.aborted === false` — refs call did NOT abort the mutation.
   - `backToGrid`; trigger second `handleFileSelect` (capture `uploadSig`). Assert `updateSig.aborted === true` (the new mutation aborted the prior one in the same op) AND `refsSig.aborted === false` (the mutation action did NOT reach into `refsOp`).
   - Unmount; assert `refsSig.aborted === true` AND `uploadSig.aborted === true` (both hooks auto-abort independently).
   - Add an inline code comment at the test referencing the §Out of Scope rationale: this test is the executable enforcement of the rule that the prose comment alone cannot enforce.

7. **`four mutations share mutationOp (cross-handler abort within one op)`.** Pins the shared-ref behavior so a future maintainer who reflexively allocates one hook per handler ("isolation is cleaner") would see CI fail.
   - Trigger `handleFileSelect` (capture `uploadSig`; assert `!aborted`).
   - `openDetail(image)`; click Save (capture `updateSig`). Assert `uploadSig.aborted === true` — the new mutationOp call aborted the prior one even though it's a different handler. Assert `updateSig.aborted === false`.
   - Add an inline code comment referencing the §Out of Scope rationale, same as test #6.

### Existing tests (all stay green by construction)

The migration is a structural ref-replacement; the assertions that existing tests make (success-path setState, error-path announcements, possiblyCommitted branches, ABORTED-silent gates) all key on observable component behavior, not on the controller-ref identity. Specific callouts:

| Existing test | Why it still passes post-migration |
|---|---|
| `stays silent when upload is aborted` (line 221) | Covers `handleFileSelect`'s catch-path gate. Post-migration the gate reads `signal.aborted` instead of `controller.signal.aborted`; same behaviour. |
| `silently swallows an ABORTED delete` (line 881) | Same shape for `handleDelete`'s catch-path gate. |
| `aborts in-flight images.list on unmount (I9)` (line 737) | Out of scope — the list-load `useEffect` controller is not migrated. |
| `stays silent when list request is aborted` (line 752) | Same — list-load effect, untouched. |
| `stays silent when references fetch is aborted (I6)` (line 810) | Same — detail-references effect, untouched. |
| `re-fetches references when delete button is clicked` (line 587) | Fires `refsOp.run` post-migration via the extracted `handleOpenDeleteConfirm`. Still passes; implicitly pins the `setReferencesLoaded(false)`-before-fire ordering. |
| `delete-click references refresh does not leak across image-selection change` (line 616) | Pins the `selectedImageIdRef.current !== imageId` identity gate that row 8 preserves. |
| `on 2xx BAD_JSON, announces committed copy and re-fetches gallery (I3)` (line 193) | Covers `handleFileSelect`'s `possiblyCommitted` branch — orthogonal to abort lifecycle. |
| `on 2xx BAD_JSON metadata save, re-fetches gallery (I4)` (line 376) | Same for `handleSave`. |
| `on 2xx BAD_JSON during handleInsert auto-save (I4)` (line 404) | Same for the inner branch. |
| `on 2xx BAD_JSON delete, closes detail view and re-fetches (C3)` (line 536) | Same for `handleDelete`. |

### Structural-check collapse (in `migrationStructuralCheck.test.ts`)

Replace the two per-file abort-migration tests at lines 109–147 (`useAbortableAsyncOperation is imported by every file that has been migrated to it` and `migrated files do not contain raw useRef<AbortController>`) with one global ban:

```ts
it("no file in packages/client/src (excluding __tests__ and the hook itself) contains raw useRef<AbortController>", () => {
  const HOOK_FILE = resolve(clientSrcRoot, "hooks/useAbortableAsyncOperation.ts");
  const files = collectTsSources(clientSrcRoot);
  const offenders: string[] = [];
  for (const file of files) {
    if (file === HOOK_FILE) continue;
    const source = readFileSync(file, "utf-8");
    if (USE_REF_ABORT_CONTROLLER_PATTERN.test(source)) {
      offenders.push(file.replace(clientSrcRoot, "packages/client/src"));
    }
  }
  expect(offenders).toEqual([]);
});
```

The existing per-file `useAbortableAsyncOperation` import-presence check (line 109) is **deleted** — it was a per-migration stepping stone whose job is done. TypeScript's own "no using undefined identifiers" enforcement covers the "is the symbol resolved" question. The post-collapse symmetry parallels the existing SeqRef ban at line 57 (which is also a global walk).

The four helper / regex / internal tests (the SeqRef ban at line 57, the `collectTsSources` skip-test at line 75, the `useAbortableSequence` per-file import check at line 92, and the two internal regex tests at lines 149 and 182) remain unchanged. The exported `USE_REF_ABORT_CONTROLLER_PATTERN`, `importPatternFor`, and `collectTsSources` helpers stay — they're still used by other tests in this file.

Update the comment above the new global ban: "4b.3a.4 was the last per-file consumer migration; the per-file checks collapsed into this global ban once `ImageGallery` no longer contained `useRef<AbortController>`."

### Coverage & noise

Coverage thresholds (CLAUDE.md §Testing Philosophy: 95/85/90/95) are already met by the existing `ImageGallery.test.tsx`; the migration is a structural ref-replacement and adds no new branches the existing tests don't reach. The seven new tests strictly *add* branch coverage by pinning behaviors that today have no dedicated assertion. Verify via `make cover` and inspect the report for `ImageGallery.tsx`; if it regresses on any axis, add a targeted test rather than relax thresholds.

Zero test warnings (CLAUDE.md §Testing Philosophy): the existing test file already disciplines `console.warn`/`console.error` via spy-and-restore. New tests inherit that discipline; no new warning-pin sites.

## Migration order & PR shape

### Commit ordering (one PR, five commits)

Per the roadmap "characterization tests BEFORE migration" requirement:

1. **Commit 1 — Characterization tests for `mutationOp` handlers.** Add tests #1 (`handleFileSelect`), #2 (`handleSave`), #3 (`handleInsert` auto-save inner branch), and #4 (`handleDelete`). All four exercise the same future `mutationOp` hook instance — grouping them by shared instance keeps the diff scannable. All pass green against pre-migration source.

2. **Commit 2 — Characterization tests for `refsOp` and cross-instance contracts.** Add tests #5 (`handleOpenDeleteConfirm` references refresh), #6 (cross-instance independence), and #7 (shared `mutationOp` across handlers). #5 pins the second hook instance; #6 and #7 pin the cross-cutting invariants the §Out of Scope rules defend. All pass green against pre-migration source.

3. **Commit 3 — Extract inline handler and migrate source.** Apply the §Behaviour mapping in one atomic source change: (a) extract the JSX `onClick` arrow to a named `handleOpenDeleteConfirm` declared alongside the other top-level handlers, AND (b) swap both `useRef<AbortController>` allocations for `useAbortableAsyncOperation` instances, remove the combined unmount cleanup effect, and replace every `controller.signal.aborted` gate with `signal.aborted` against the per-call destructured signal. All existing + 7 new tests stay green. **If reviewers prefer extraction-as-separate-commit for review readability, the implementation plan may split this into 3a (pure extraction, no abort-primitive change) and 3b (migrate); the constraint is that both end states satisfy the same test set.**

4. **Commit 4 — Collapse structural check to a global ban.** Replace the two per-file abort-migration tests at `migrationStructuralCheck.test.ts:109–147` with the global `useRef<AbortController>` ban described in §Test plan. Update the surrounding comment to note: 4b.3a.4 was the last per-file consumer migration; the per-file checks collapsed once `ImageGallery` no longer contained `useRef<AbortController>`. Both the new global ban and all six other structural-check tests pass.

5. **Commit 5 — Cleanup (if needed).** Inspect the migrated `ImageGallery.tsx` for residual cruft: stale comments referencing `mutateAbortRef` / `refsAbortRef` that survived row 9's pruning, and any `const controller =` that the migration left behind. All of `useRef`, `useEffect`, `useReducer`, `useCallback`, `useState` are still in use — verify before touching imports. If nothing needs tidying, omit this commit; the order matters, not the count.

**This phase's tests are characterization tests — they pin behaviour the source change must preserve. They are not red-then-green tests in the strict sense, since the pre-migration code already satisfies them.** The commit ordering preserves the discipline (no source change without prior test); it does not pretend the test commits go red against current source. Splitting commits this way keeps the diff scannable: the test commits prove behaviour is pinned before the source change, and the migration commit isolates the source change from any test additions.

### One PR, one refactor (CLAUDE.md §Pull Request Scope)

- **One file's worth of migration.** No other consumer files touched. (`useFindReplaceState.ts`, `useTrashManager.ts` already migrated in 4b.3a.2 / 4b.3a.3; the list/refs `useEffect` controllers in `ImageGallery.tsx` itself stay as-is.)
- **The inline-handler extraction is bundled.** Per Ovid's call, this PR includes one adjacent refactor (extracting the JSX `onClick` arrow to `handleOpenDeleteConfirm`). Acknowledged as a one-feature-rule trade-off; defensible in review on readability grounds because the post-migration body is still 15+ lines and matches the existing pattern of every other named handler in the file.
- **The structural-check collapse is bundled** because it is the test that proves this migration is final — exactly the same scoping argument both prior phases made for their per-file appends to `migrated`.
- **No touching:** the list-load / detail-references `useEffect` controllers, the `selectedImageIdRef` cross-axis identity gate, the announcement-timer cleanup effect, the `possiblyCommitted` UX logic, the `externalRefreshKey` prop, or the `incrementRefreshKey` reducer. All orthogonal.

### Branch

Working branch `image-gallery-abort-migration` (already created off `main`). Merge handled by Ovid post-PR-approval; the implementation plan does not push or merge.

### CLAUDE.md edit (one sentence, bundled)

Rule 4 under §Save-pipeline invariants currently ends with: *"Hand-rolled `useRef<AbortController>` allocations at consumer call sites are reviewed against this hook (lint enforcement deferred)."* With the global structural-check ban in place after this phase, that sentence understates the actual enforcement layer. Replace with: *"Hand-rolled `useRef<AbortController>` allocations at consumer call sites are banned (enforced by `packages/client/src/__tests__/migrationStructuralCheck.test.ts`; lint enforcement deferred to Phase 4b.4)."* The edit lands in Commit 4 alongside the test collapse — the prose change is causally tied to the enforcement-layer change.

## Risks & mitigations

- **"Characterization tests don't go red against current code."** All seven new tests pass green against the pre-migration source — that's the *expected* shape for a migration characterization test. **Not** a TDD-violation flag for the reviewer. Call it out in the PR description so the green-green-green commit sequence isn't read as cargo-culted RED-GREEN-REFACTOR. Both prior phases (4b.3a.2, 4b.3a.3) set the precedent; the reviewer is familiar with the shape.

- **Signal-capture mock-call index fragility.** If a future test reorders the args of `api.images.upload` / `update` / `delete` / `references`, an `arg[N]`-based capture breaks silently. Mitigate by following the existing abort-test idiom at lines 737 (I9) and 810 (I6): `mockImplementation((... , signal) => { capturedSignals.push(signal); return pendingUntilAbort(signal); })` — the destructured parameter name makes the capture order-resilient.

- **Tests #6 (cross-instance independence) and #7 (shared-handler within `mutationOp`) are load-bearing — must not be deleted as "structural / obviously true."** A future maintainer reading test #6 may conclude "the two hook instances obviously don't share state — this test is structural noise" and they would be right *for the implementation that exists today* but wrong about the contract the test documents. Add a one-line code comment at each test referencing the §Out of Scope rationale: tests #6 and #7 are the executable enforcement of rules that the prose comment alone cannot enforce.

- **The inline-handler extraction is adjacent scope.** If a reviewer flags `handleOpenDeleteConfirm` extraction as a one-feature-rule violation, the defense is: the post-migration body is still 15+ lines (UI reset → `refsOp.run` → `.then`/`.catch` with both `signal.aborted` and identity gates) and matches the existing pattern of every other named handler (`handleFileSelect`, `handleSave`, `handleInsert`, `handleDelete`). Extraction is not net-new code; it is moving five lines of `function …` declaration plus changing the `onClick` to a reference.

- **`handleInsert` inner-branch test (#3) must assert the mock was called.** The inner branch is conditional on `saveStatus !== "saved"`; if the test setup leaves `saveStatus === "saved"`, the test silently passes without exercising the abort behaviour. Mitigate by asserting `expect(api.images.update).toHaveBeenCalledTimes(N)` between the trigger and the signal-state assertion — codified in test #3's spec above.

- **`setReferencesLoaded(false)` ordering must be preserved BEFORE `refsOp.run`.** Otherwise the UI briefly shows stale `references` between the old `setReferences(...)` (from the prior refresh) and the new fetch's resolution. Pinned implicitly by existing test at line 587 (`re-fetches references when delete button is clicked`), which would observe the stale state if the order flipped.

- **`useEffect`-owned controllers may confuse a future maintainer.** Someone reads "Phase 4b.3a.4 migrated `ImageGallery` to `useAbortableAsyncOperation`" and wonders why the list-load and detail-references `useEffect` blocks still allocate raw `AbortController`. Mitigate by preserving the existing I9 inline comments at lines 99–104 and 147 (which already explain the "controller-per-effect, cleanup-on-dep-change" lifecycle). Do not remove or rephrase those comments — they are the precise answer to the future question.

- **Structural-check collapse expands the assertion set.** Every `.ts`/`.tsx` file in `packages/client/src` (except `__tests__/` and `useAbortableAsyncOperation.ts`) is now grepped on every test run. Performance impact is negligible (`collectTsSources` already runs for the SeqRef ban; the additional `USE_REF_ABORT_CONTROLLER_PATTERN.test()` per file is a simple regex). Coverage impact is strictly tighter: every file with a raw `useRef<AbortController>` outside the hook now fails the ban, with no per-file exclusion. Today's `clientSrcRoot` walk should yield zero offenders post-migration.

- **`pendingUntilAbort`-based tests with multiple in-flight operations require careful sequencing.** Tests #6 and #7 keep multiple operations in flight simultaneously. None should be awaited (or they hang the test); the assertions key on `signal.aborted` state, not on promise resolution. Existing I9 tests (lines 737, 752, 810) demonstrate the pattern: trigger via DOM event, then `await waitFor(() => expect(mock).toHaveBeenCalled())` to ensure the mock fired before asserting on signals.

## Definition of Done

- `packages/client/src/components/ImageGallery.tsx` no longer contains `useRef<AbortController>`; the only abort primitives are `mutationOp = useAbortableAsyncOperation()` and `refsOp = useAbortableAsyncOperation()`. Verified by the new global structural-check ban.
- `mutationOp` is shared by `handleFileSelect`, `handleSave`, `handleInsert`'s inner-branch auto-save, and `handleDelete`. `refsOp` is owned by `handleOpenDeleteConfirm` (the extracted Delete-button click handler).
- The combined unmount cleanup `useEffect` at the old lines 74–80 is removed; both hook instances handle their own auto-abort. The announcement-timer cleanup effect is **untouched**.
- The list-load `useEffect` and detail-references `useEffect` (and their per-effect `AbortController` cleanup pattern) are **unchanged** — they fall outside this hook's contract.
- All `controller.signal.aborted` gates replaced with `signal.aborted` against the per-call destructured signal. Placement preserved: gates stay immediately after each `await` (or in `.then`'s body), and stay as the first statement of `catch` blocks above `mapApiError`. The `selectedImageIdRef.current !== imageId` identity gates stay immediately after the signal gates in the references refresh.
- The JSX `onClick` for the link-style Delete button is now `onClick={handleOpenDeleteConfirm}`; the named function lives at the top level of the component alongside the other handlers.
- All existing tests in `__tests__/ImageGallery.test.tsx` continue to pass (no regressions; the migration is a structural ref-replacement that preserves observable behaviour).
- Seven new characterization tests added to `__tests__/ImageGallery.test.tsx`: four `mutationOp`-handler tests, one `refsOp`-handler test, one cross-instance independence test, one shared-`mutationOp` test.
- `__tests__/migrationStructuralCheck.test.ts` collapsed: the two per-file abort-migration tests at lines 109–147 are replaced by one global `useRef<AbortController>` ban that walks `clientSrcRoot` (excluding `__tests__/` via the existing `collectTsSources` helper, and excluding `hooks/useAbortableAsyncOperation.ts` via an explicit filter). The four helper / regex / internal tests in the same file are preserved.
- CLAUDE.md §Save-pipeline invariants rule 4 prose updated to reflect the post-collapse enforcement layer.
- `make all` green at PR close (lint, format, typecheck, coverage, e2e — e2e shouldn't change).
- Coverage on `ImageGallery.tsx` and `migrationStructuralCheck.test.ts` holds at or above CLAUDE.md §Testing Philosophy thresholds (95/85/90/95).
- Zero test warnings.
- No user-visible behaviour change.
- The PR commit sequence honors the §Migration order ordering. Branch (`image-gallery-abort-migration`) ready for Ovid's handling at merge time.

## Out of scope (explicit)

- **Folding `mutationOp` and `refsOp` into one instance.** They serve different concurrency models — the user can be refreshing references while a mutation is in flight, and a delete attempt should not abort an in-progress references refresh (and vice versa). Pinned by test #6 (cross-instance independence). Out of scope to fold; explicit guard against future regression.
- **The list-load `useEffect` (lines 98–127) and detail-references `useEffect` (lines 145–170).** Their lifecycle is "controller-per-effect, cleanup-on-dep-change" — fundamentally different from `useAbortableAsyncOperation`'s "abort-prior-on-action" contract. Roadmap explicitly excluded them. Their cleanup-function approach is correct as-is. Comments and code stay verbatim.
- **The `selectedImageIdRef` cross-axis identity gate** (lines 54–60, 138–144, 590–594, 606, 612). Pinned by existing test at line 616 (`delete-click references refresh does not leak across image-selection change`). Preserved by row 8 of §Behaviour mapping.
- **The `possiblyCommitted` UX branches** (lines 197–204, 247–256, 284–296, 320–327). Orthogonal to abort lifecycle. Pinned by existing I3/I4/C3 tests.
- **The `externalRefreshKey` prop and `incrementRefreshKey` reducer.** Orthogonal — they are an external refresh-signaling mechanism, not an abort primitive.
- **Restructuring or renaming any *other* JSX inline arrow handlers** (e.g., the upload button `onClick` at line 357, the retry button at line 375, the back-to-grid button at line 425, the metadata-field `onChange` arrows). Only the Delete-button `onClick` is extracted, because only it carries the abort dance whose readability the extraction improves.
- **Other consumers of `useAbortableAsyncOperation`.** None remain after this phase. The global ban enforces this.
- **Lint enforcement of "no hand-rolled `useRef<AbortController>` outside the hook."** Deferred to Phase 4b.4 per the prerequisite design. The structural-check ban this phase ships is the test-layer enforcement.
- **`Editor.tsx` paste/drop image upload and the remaining client `AbortController` sites** — out of scope here; covered by Phase 4b.3b's per-site evaluation.

## Dependencies

- **Phase 4b.3a.1** — the `useAbortableAsyncOperation` hook must exist. Already shipped.
- **Phase 4b.3a.2** — the structural-check helpers (`USE_REF_ABORT_CONTROLLER_PATTERN`, `importPatternFor`, `collectTsSources`) and the `pendingUntilAbort` test helper must exist. Already shipped on `main`.
- **Phase 4b.3a.3** — strictly speaking, 4b.3a.4 doesn't depend on 4b.3a.3 being merged (the per-file → global collapse works whether the `migrated` array had one or two entries). But reviewing this PR while 4b.3a.3 is still open would create a confusing diff: the structural-check collapse would be deleting code that 4b.3a.3 had just added. 4b.3a.3 is already merged as of 2026-05-25; this phase proceeds from that baseline.
- **Does not block any downstream phase.** Phase 4b.3b's per-site evaluation depends on the hook existing (4b.3a.1), not on this consumer migration. Phase 4b.4 (raw-strings ESLint rule) is independent.
