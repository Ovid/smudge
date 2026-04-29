# Phase 4b.3a.1 — Abortable Async Operation Hook (Design)

**Date:** 2026-04-29
**Author:** Ovid / Claude (collaborative)
**Roadmap phase:** 4b.3a.1 (narrowed; sibling phases 4b.3a.2/3/4 added by this design)
**Source dedup report:** `paad/duplicate-code-reports/ovid-experimental-dedup-2026-04-28-08-13-33-4129d99.md`, finding [I3]
**Companion hooks:** `useAbortableSequence` (`packages/client/src/hooks/useAbortableSequence.ts`), `useEditorMutation` (`packages/client/src/hooks/useEditorMutation.ts`)

---

## Goal

Extract `useAbortableAsyncOperation` — a small client-side hook that encodes the "abort prior controller on a new run, auto-abort on unmount, expose a per-call signal" pattern hand-rolled at multiple sites in `useTrashManager`, `useFindReplaceState`, and `ImageGallery`. **This phase ships the hook and its unit tests only.** Three subsequent phases (4b.3a.2, 4b.3a.3, 4b.3a.4 — added by this design to `docs/roadmap.md`) migrate the consumer files one at a time.

The motivation is dedup-report finding [I3]: every in-scope site implements the same four-step state machine (`prior?.abort()` → `new AbortController()` → `signal` threaded into the request → post-response guard `if (controller.signal.aborted) return`). The pattern is meaningful enough that reviewers have left detailed inline comments explaining it across multiple round-numbered review iterations. That review residue is itself the smell: if reviewers have to re-derive the invariant per site, the abstraction is missing.

## Scope correction (the migration set is bigger than the roadmap section originally captured)

The legacy 4b.3a.1 prose enumerated **5 in-scope sites**: `useTrashManager.openTrash`, `useTrashManager.handleRestore`, `useFindReplaceState.search`, `ImageGallery.handleFileSelect`, `ImageGallery.handleSave`. The brainstorm's code survey on 2026-04-29 found that the named sites share `useRef<AbortController>` instances with **unnamed sibling operations**:

- **`useTrashManager.ts`** — `trashAbortRef` is used by `openTrash` (named) **and** `confirmDeleteChapter`'s post-delete trash refresh at lines 166–177 (unnamed). The two operations are intentionally serialized through one ref so that a delete-triggered refresh aborts an outstanding open-trash fetch.
- **`ImageGallery.tsx`** — `mutateAbortRef` is used by `handleFileSelect` + `handleSave` (named) **and** `handleInsert` at lines 269–295 + `handleDelete` at lines 304–349 (unnamed). The four operations are deliberately mutually exclusive (each aborts the others) so a delete cannot race a save which cannot race an insert which cannot race an upload.
- **`ImageGallery.tsx`** — a *separate* `refsAbortRef` for the click-time references-load refresh at lines 599–622 (unnamed; orthogonal to `mutateAbortRef`). This ref must be migrated as a *second* hook instance in the same file, since it is intentionally NOT coupled to mutations (a delete in flight should not abort an in-progress references refresh).

Because the new hook owns *one* `AbortController` ref per instance, you cannot migrate `handleFileSelect` + `handleSave` to the hook while leaving `handleInsert` + `handleDelete` on the raw `mutateAbortRef`: doing so would create two refs that no longer abort each other, silently breaking the mutual-exclusion contract. **The migration unit is the file, not the named operation.** The corrected in-scope set is **9 operations across 3 files** (1 in `useFindReplaceState`, 3 in `useTrashManager`, 5 in `ImageGallery`), executed as 3 file-PRs after the hook lands. The hand-rolled `Editor.tsx:315–330` paste/drop site stays out of scope per the dedup verification (it uses a `projectIdRef` stale-id check, not an `AbortController`).

## Shape of the phase

The roadmap is restructured into four sequential sub-phases, each shipping as one PR. This file is the design doc for Phase 4b.3a.1 only; sub-phases 4b.3a.2/3/4 will get their own design docs via subsequent `/roadmap` runs.

| Order | Phase | Scope | Status after this design |
|---|---|---|---|
| 1 | **4b.3a.1** | Extract hook + unit tests + CLAUDE.md addition; zero consumer migrations | In Progress (this design) |
| 2 | **4b.3a.2** | Migrate `useFindReplaceState.search` (single op, sequence-paired) | Planned |
| 3 | **4b.3a.3** | Migrate `useTrashManager` (`openTrash` + `confirmDeleteChapter` refresh sharing one hook instance; `handleRestore` on a second hook instance) | Planned |
| 4 | **4b.3a.4** | Migrate `ImageGallery` (4 mutations on one hook instance + 1 references-load on a second hook instance) | Planned |

Sub-phases 4b.3a.2/3/4 are independent of each other (no inter-migration dependencies); each depends only on the hook landing in 4b.3a.1. They may land in any order. Phase 4b.3b's existing dependency on "4b.3a.1 landing first" stays accurate — it depends on the *hook* existing so its per-site evaluation can adopt the hook where fit; it does not depend on the migrations 4b.3a.2/3/4.

## Hook API

**File:** `packages/client/src/hooks/useAbortableAsyncOperation.ts` (companion to `useAbortableSequence.ts` in the same directory).

```ts
export type AbortableAsyncOperation = {
  /**
   * Abort the prior controller (if any), allocate a fresh AbortController,
   * and call fn(signal). Returns the promise from fn and the per-call
   * AbortSignal — use that signal (NOT a hook-level state probe) for
   * "did THIS operation abort" gates after the await.
   */
  run<T>(fn: (signal: AbortSignal) => Promise<T>): { promise: Promise<T>; signal: AbortSignal };
  /**
   * Abort the currently-tracked controller, if any. Use for explicit
   * external cancellation (panel-close, project-id change) that is NOT
   * paired with starting a new operation. After abort(), the next run()
   * starts fresh.
   */
  abort(): void;
};

export function useAbortableAsyncOperation(): AbortableAsyncOperation;
```

`run` returns an inline structural type `{ promise: Promise<T>; signal: AbortSignal }` rather than a separately-exported named type. This matches `useAbortableSequence`'s convention: `SequenceToken` is exported because consumers persist tokens across calls; an "abortable run" is an immediate-use shape that consumers destructure at the call site, not a thing they store. Keeping the shape inline keeps the public surface minimal.

There is deliberately **no** component-level `aborted` getter. The roadmap §S10 reordering note at line 857 already documents that the per-call signal is the right input for "did this operation abort" gates — a hook-level getter reads true after *any* operation in that hook has aborted (including unmount cleanup), which would over-suppress dev warnings firing on catches whose own operation had not aborted. The `signal` returned from `run()` is per-call and immune to that footgun.

The returned object is `useMemo`-stable across renders (matching `useAbortableSequence`); `run` and `abort` are `useCallback`-stable with `[]` dependencies. Consumers may safely place the hook's returned object in a `useEffect` dependency array.

## Implementation sketch

```ts
import { useCallback, useEffect, useMemo, useRef } from "react";

export type AbortableAsyncOperation = {
  run<T>(fn: (signal: AbortSignal) => Promise<T>): { promise: Promise<T>; signal: AbortSignal };
  abort(): void;
};

export function useAbortableAsyncOperation(): AbortableAsyncOperation {
  const ref = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    // React 18 StrictMode runs mount/cleanup/mount in development. Reset
    // mountedRef on each mount so the second mount revives the post-cleanup
    // false. Without it, every subsequent run() returns a pre-aborted
    // signal in dev. Mirrors useAbortableSequence's StrictMode discipline.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      ref.current?.abort();
      ref.current = null;
    };
  }, []);

  const run = useCallback(<T,>(fn: (signal: AbortSignal) => Promise<T>) => {
    ref.current?.abort();
    const controller = new AbortController();
    if (!mountedRef.current) {
      // Post-unmount call: pre-abort so the consumer's
      // `if (signal.aborted) return` short-circuits without firing the
      // request. Matches useAbortableSequence's mountedRef gate.
      controller.abort();
    }
    ref.current = controller;
    return { promise: fn(controller.signal), signal: controller.signal };
  }, []);

  const abort = useCallback(() => {
    ref.current?.abort();
    ref.current = null;
  }, []);

  return useMemo(() => ({ run, abort }), [run, abort]);
}
```

## Behavioural contract

The contract the unit tests pin (one test per bullet):

1. **Abort-prior on rerun.** `run(fn)` aborts the prior controller (if any) before creating a fresh one. The first run's signal reads `aborted === true` after the second run.
2. **Returned signal identity.** The `signal` returned from `run()` is the same object as the controller's `signal` — `signal.aborted` and the controller's abort state are equivalent. `fn` receives the same signal that the call site sees.
3. **Explicit abort.** `abort()` aborts the currently-tracked controller, if any. After `abort()`, a follow-up `run()` starts fresh and returns a non-aborted signal.
4. **Unmount aborts.** Component unmount aborts the currently-tracked controller. The pre-unmount `signal.aborted` reads true after `unmount()`.
5. **Post-unmount run.** A `run()` call after unmount returns a pre-aborted signal synchronously. The consumer's `if (signal.aborted) return` guard trips immediately.
6. **Stable returned object.** The returned object is reference-equal across re-renders (pinned by `result.current` comparison across forced re-renders).
7. **Idempotent abort.** `abort()` on an empty hook (no in-flight controller) is a no-op and does not throw.
8. **Concurrent run discipline.** Two `run()` calls back-to-back: the second aborts the first's controller. Two-operation use cases (e.g., `useTrashManager`'s `openTrash` + `handleRestore` running in parallel) must use *two* hook instances; the migration phases are responsible for honoring that.
9. **StrictMode double-mount.** The hook survives mount/cleanup/mount in development; subsequent `run()` calls produce non-pre-aborted signals after the second mount completes.

## Test strategy

**Hook unit tests** — `packages/client/src/hooks/useAbortableAsyncOperation.test.ts`. Vitest + `@testing-library/react`'s `renderHook`, matching the `useAbortableSequence.test.ts` shape. One test per behavioural-contract bullet above. Coverage target: at or above CLAUDE.md `§Testing Philosophy` thresholds (95/85/90/95). The hook is small enough that 100/100/100/100 should be achievable; aim for that and accept what the run reports.

**Zero test warnings** — the hook itself never logs. Tests must not produce `console.warn`/`console.error` output. If a test deliberately exercises a path that would log (none currently planned), use the warning-pin pattern from CLAUDE.md `§Testing Philosophy`.

**Characterization tests for migrations** — out of scope for this phase. Each migration phase (4b.3a.2/3/4) writes characterization tests *before* swapping to the hook, pinning the abort-prior, abort-on-unmount, and signal-threaded behaviour at the consumer's API surface. After the swap, the same tests must pass. The migration phases own those tests, not 4b.3a.1.

## CLAUDE.md addition

Extend `§Save-pipeline invariants` rule 4 with a new paragraph (the rule already names `useAbortableSequence`; co-locating preserves discoverability for "abort" / "AbortController" searches). Append after the existing rule 4 closing line:

> For network-cancellation (as distinct from response-staleness), route through `useAbortableAsyncOperation` (`packages/client/src/hooks/useAbortableAsyncOperation.ts`): `run<T>(fn)` aborts the prior controller and returns `{ promise, signal }` per call (use the per-call `signal` for "did this operation abort" gates after the await — there is deliberately no hook-level `aborted` getter), `abort()` cancels the currently-tracked controller for explicit external-cancellation flows that aren't paired with starting a new operation (panel-close, project-id change), and component unmount auto-aborts. The two hooks are orthogonal: `useAbortableSequence` arbitrates response staleness via epoch tokens; `useAbortableAsyncOperation` cancels network requests via `AbortController`. Both can apply to one operation — `useFindReplaceState.search` pairs them to get both guarantees. Hand-rolled `useRef<AbortController>` allocations at consumer call sites are reviewed against this hook (lint enforcement deferred).

The CLAUDE.md edit lands in the same PR as the hook so subsequent migration PRs (4b.3a.2/3/4) can already cite the invariant in their PR descriptions and code reviews.

## Roadmap restructure

This design instructs the implementation plan to make the following edits to `docs/roadmap.md`:

### R1. Phase Structure table (around line 28)

Replace the existing single row for `4b.3a.1` with four rows:

| `4b.3a.1` | Abortable Async Operation Hook | Extract `useAbortableAsyncOperation()` + unit tests + CLAUDE.md addition; consumer migrations follow in 4b.3a.2/3/4 | In Progress |
| `4b.3a.2` | Find/Replace Abort Migration | Migrate `useFindReplaceState.search` (sequence-paired single op) to `useAbortableAsyncOperation` | Planned |
| `4b.3a.3` | Trash Manager Abort Migration | Migrate `useTrashManager` (`openTrash` + `confirmDeleteChapter` refresh sharing one hook instance; `handleRestore` on a second hook instance) to `useAbortableAsyncOperation` | Planned |
| `4b.3a.4` | Image Gallery Abort Migration | Migrate `ImageGallery` (4 mutations sharing one hook instance + references-load on a second instance) to `useAbortableAsyncOperation` | Planned |

### R2. Phase 4b.3a.1 section body (around line 731)

Narrow the section to "extract hook + unit tests + CLAUDE.md addition." Remove the per-site migration enumerations, the "(Note on counts: …)" dedup-count-clarification paragraph, and the "PR Shape" paragraph (those move to the appropriate sub-phase sections). Keep:

- **Goal** — rephrased to "extract hook" rather than "extract and migrate."
- **Why Now** — preserves the reorder rationale and the dependency-on-Phase-4b.3b note.
- **Scope** — narrow to "add hook + tests + CLAUDE.md text."
- **Out of Scope** — carry over the existing "remaining ~8 production sites," "fold into useAbortableSequence," "Editor.tsx paste/drop," and "lint enforcement" exclusions, plus a new bullet "Consumer migrations (those live in 4b.3a.2/3/4)."
- **Definition of Done** — hook ships, unit tests pass, CLAUDE.md updated, roadmap restructured, `make all` green, zero consumer migrations in this PR.
- **Dependencies** — independent; blocks 4b.3a.2/3/4 and 4b.3b.

### R3. Add three new `## Phase` sections (4b.3a.2 / 4b.3a.3 / 4b.3a.4)

In document order between 4b.3a.1 and 4b.3b. Each follows the existing block shape (Goal / Why Now / Scope / Out of Scope / Definition of Done / Dependencies / PR Shape note where helpful). Each declares dependency on Phase 4b.3a.1. Each cites the corrected 9-operation-across-3-files migration count and references this design's "Scope correction" section. Each section explicitly enumerates the operations it migrates so future `/roadmap` runs against those phases see the same level of detail the original 4b.3a.1 prose had.

Indicative skeletons (the implementation plan turns these into final text):

- **4b.3a.2** scope: `useFindReplaceState.search` migrates to one `useAbortableAsyncOperation` instance. Existing `useAbortableSequence` pairing stays — both guarantees coexist on this operation. Cleanup effects at lines 99–104 and 130–131 are subsumed by the hook's auto-abort. `closePanel`'s explicit `searchAbortRef.current?.abort()` becomes `op.abort()`.
- **4b.3a.3** scope: `useTrashManager` migrates `openTrash` + `confirmDeleteChapter` refresh to one shared `useAbortableAsyncOperation` instance (replaces `trashAbortRef`); `handleRestore` migrates to a *second* instance (replaces `restoreAbortRef`). The two instances stay separate because the two operations can be in flight concurrently. The unmount cleanup effect at lines 45–51 is subsumed by both hook instances' auto-abort.
- **4b.3a.4** scope: `ImageGallery` migrates the four mutation operations (`handleFileSelect`, `handleSave`, `handleInsert`, `handleDelete`) to one shared `useAbortableAsyncOperation` instance (replaces `mutateAbortRef`); the click-time references refresh at lines 599–622 migrates to a *second* instance (replaces `refsAbortRef`). The unmount cleanup at lines 74–80 is subsumed by both hook instances' auto-abort. The list-load and detail-load `useEffect` controllers at lines 105–126 and 145–169 stay as-is (controller-per-effect lifecycle, cleanup-on-dep-change pattern; not within this hook's contract).

### R4. Phase 4b.3b dependency note (around line 796)

Tidy the existing parenthetical "(originally numbered 4b.14)" — the renumbering trail is now two layers deep and the parenthetical is getting long. Rest of the paragraph stays. The substantive dependency claim ("4b.3a.1 must land first") is unchanged and accurate.

### R5. Plan comment

Insert `<!-- plan: 2026-04-29-abortable-async-operation-hook-design.md -->` on the line after the `---` separator before the new Phase 4b.3a.1 heading, per the `/roadmap` skill's standard placement rule. Sub-phases 4b.3a.2/3/4 do **not** receive plan comments yet — they are picked up by future `/roadmap` runs.

## Out of scope (Phase 4b.3a.1)

- **Consumer migrations.** Zero call-site changes in this PR. The hook ships unused by production code; only unit tests exercise it. Migrations land in 4b.3a.2/3/4.
- **The remaining ~8 client AbortController sites** (`App.tsx`, `DashboardView.tsx`, `ExportDialog.tsx`, `ProjectSettingsDialog.tsx`, `SnapshotPanel.tsx`, `useProjectEditor.ts`, `useSnapshotState.ts`, `EditorPage.tsx`, `HomePage.tsx`). Each gets re-evaluated by Phase 4b.3b's brainstorm.
- **Folding `useAbortableSequence` into the new hook.** Two distinct concerns (response staleness vs. network cancellation); both stay separate primitives.
- **`useEditorMutation` save-cancellation.** Canonical for editor mutations; not a `useAbortableAsyncOperation` candidate.
- **`Editor.tsx` paste/drop image upload.** Uses a `projectIdRef` stale-id check, not an `AbortController` — not a member of this dedup set. Bytes-on-wire concern is handled by the deferral note in 4b.3b's [I6] rationale; the editor-instance-capture concern is addressed by 4b.3c [S18].
- **ESLint enforcement** that flags hand-rolled `useRef<AbortController>` outside the hook. Deferred to a future phase if drift returns.
- **`ImageGallery` list-load and detail-load `useEffect` controllers** (lines 105–126, 145–169). Their lifecycle is "controller-per-effect, cleanup-on-dep-change," which is a different shape from this hook's "abort-prior-on-action" contract. Not in scope here or in 4b.3a.4.

## Risks & mitigations

- **StrictMode double-mount.** The implementation re-sets `mountedRef.current = true` on each mount (matching `useAbortableSequence`'s pattern) so the cleanup/re-mount cycle in dev does not poison subsequent `run()` calls. Pinned by unit test #9.
- **Concurrent `run()` from two callers in the same instance.** By contract, the second call aborts the first's controller. Two-operation use cases must use two hook instances. The migration phases are responsible for honoring this — and the design doc for each migration phase will explicitly call out how many instances the consumer needs.
- **Post-unmount `run()` synchronously firing `fn`.** The hook hands `fn` a pre-aborted signal but still calls `fn(signal)`. Consumers must check `signal.aborted` before any side effect. Matches the existing hand-rolled pattern; no behaviour change.
- **A migration phase discovers the hook unfit for some site.** If a future migration phase's brainstorm reveals the hook does not fit (e.g., a multi-call retry-with-backoff with a single logical operation, like Phase 4b.3b's [I9] `EditorPage` chapterStatuses retry), the migration phase keeps the hand-rolled controller with a per-site justification. The hook does not move to accommodate; the migration scope adjusts. The roadmap text for sub-phases 4b.3a.2/3/4 explicitly carries this re-evaluate-per-site clause forward.
- **Bundling risk.** All four sub-phases (4b.3a.1/2/3/4) reference the same hook. The hook PR (4b.3a.1) is the only one that introduces new public API. The migration PRs are mechanical applications. To avoid the 16-round-review hazard from Phase 4b.3, each PR honors the one-feature rule: the hook PR adds *only* the hook + tests + CLAUDE.md text; each migration PR migrates *only* one file's worth of coupled operations. Roadmap restructuring is part of the hook PR (4b.3a.1) so it lands once, in the same PR that establishes the canonical pattern.

## Definition of Done (Phase 4b.3a.1)

- New file `packages/client/src/hooks/useAbortableAsyncOperation.ts` with the API above.
- New file `packages/client/src/hooks/useAbortableAsyncOperation.test.ts` covering the nine behavioural-contract cases.
- CLAUDE.md `§Save-pipeline invariants` rule 4 extended per the "CLAUDE.md addition" section.
- `docs/roadmap.md` restructured per R1–R5 above. *(Already executed during brainstorming on 2026-04-29; carried in this branch as commit `e5736e8`. The implementation plan does not re-execute these edits.)*
- Plan comment for this design lands per R5. *(Already executed in the same `e5736e8` commit alongside the restructure.)*
- Zero consumer migrations.
- `make all` green at PR close (lint, format, typecheck, coverage thresholds, e2e — though e2e shouldn't change).
- Coverage on the new hook ≥ CLAUDE.md `§Testing Philosophy` thresholds (95/85/90/95).
- Zero test warnings.

## Dependencies

- **Independent** of all prior phases. The signal-bearing API surface in `api/client.ts` was shipped in 4b.3a; this hook does not consume that surface (it's the consumers in 4b.3a.2/3/4 that thread the signal through to `api.*` calls).
- **Blocks** Phase 4b.3a.2 / 4b.3a.3 / 4b.3a.4 — each migration depends on the hook existing.
- **Blocks** Phase 4b.3b — its per-site evaluation (per the existing 2026-04-28 reorder note) depends on the hook existing so each call site can be evaluated against it.
