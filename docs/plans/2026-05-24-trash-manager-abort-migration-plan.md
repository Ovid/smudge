# Phase 4b.3a.3: Trash Manager Abort Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `useTrashManager` from two hand-rolled `useRef<AbortController>` refs (`trashAbortRef`, `restoreAbortRef`) + a combined unmount cleanup effect to two side-by-side `useAbortableAsyncOperation` instances (`trashOp`, `restoreOp`), preserving the existing two-ref / three-operation concurrency model with no user-visible behaviour change.

**Architecture:** `useTrashManager` allocates `trashOp = useAbortableAsyncOperation()` (shared by `openTrash` and `confirmDeleteChapter`'s post-delete refresh) and `restoreOp = useAbortableAsyncOperation()` (owned by `handleRestore`). The combined unmount cleanup `useEffect` at lines 45–51 of the current source is removed; both hook instances handle their own auto-abort. The `seedConfirmedStatusRef` `useEffect` at lines 24–26 is **untouched** — orthogonal to abort lifecycle. Unlike the 4b.3a.2 sibling (`useFindReplaceState`), this hook has no `useAbortableSequence` pairing, so each await is followed by exactly one `if (signal.aborted) return` gate per the design.

**Tech Stack:** TypeScript, React 18, Vitest + `@testing-library/react`, vi mocks. Hooks live in `packages/client/src/hooks/`; tests in `packages/client/src/__tests__/`. The `pendingUntilAbort` helper in `packages/client/src/__tests__/helpers/abortableMocks.ts` is already in use by the existing I5 tests.

**Source design:** `docs/plans/2026-05-24-trash-manager-abort-migration-design.md`

**Working branch:** `trash-manager-abort-migration` (already created off `main`).

---

## File Structure

Files modified by this plan:

- `packages/client/src/hooks/useTrashManager.ts` — source migration (Task 3)
- `packages/client/src/__tests__/useTrashManager.test.ts` — extended with five new tests (Tasks 1, 2)
- `packages/client/src/__tests__/migrationStructuralCheck.test.ts` — `useTrashManager.ts` appended to two `migrated` arrays + inline comment refresh (Task 4)

Files NOT modified (referenced for shape/import only):

- `packages/client/src/hooks/useAbortableAsyncOperation.ts` — the hook to migrate to; shipped in Phase 4b.3a.1
- `packages/client/src/hooks/useFindReplaceState.ts` — the first migrated consumer (4b.3a.2); referenced by the structural-check array
- `packages/client/src/__tests__/helpers/abortableMocks.ts` — `pendingUntilAbort` helper; already imported by the test file
- `packages/client/src/api/client.ts` — `api.projects.trash(slug, signal)` and `api.chapters.restore(chapterId, signal)` — signal is the 2nd positional arg in both
- `CLAUDE.md` — no edit required; rule 4 already documents `useAbortableAsyncOperation` as the canonical primitive and is consumer-agnostic in the prose

---

## Plan-vs-Design Notes

Two small divergences from the source design surfaced during plan-writing — both stem from the same root cause (the design overlooked that `trashOpen` is set *after* `openTrash`'s fetch resolves). Each is here for the alignment review to consider:

**[D1] Test #3 (`confirmDeleteChapter` refresh) cannot reach the refresh branch via a `pendingUntilAbort`-mocked `openTrash`.** The design's test #3 setup says to "call `openTrash` first to satisfy the `if (trashOpen && project)` guard, with `pendingUntilAbort` so the openTrash signal can be aborted by the refresh's abort-prior". But the source code's `openTrash` sets `setTrashOpen(true)` *after* `await api.projects.trash(...)` resolves (line 62 of `useTrashManager.ts`). If that fetch is `pendingUntilAbort`, `trashOpen` never becomes true, so `confirmDeleteChapter`'s `if (trashOpen && project)` guard is false and the refresh branch never fires. The test would silently not exercise the refresh path — the bug it's meant to pin would be invisible.

**Resolution in this plan:** Test #3 manually calls `result.current.setTrashOpen(true)` (the hook exposes this setter) to satisfy the guard, then fires `confirmDeleteChapter` directly without an `openTrash` precursor. The test's scope tightens to abort-on-unmount + signal-threading for the previously-unpinned refresh path — *one concern per test*. The "abort-prior on shared `trashOp`" claim (which the design folded into test #3 as a third assertion) belongs entirely to test #5, where it's the test's whole point. Net effect: cleaner test boundaries, same total invariant coverage.

**[D2] Test #5 (shared-`trashOp` behaviour) has the same `trashOpen`-gating issue.** The design's test #5 setup says to "mock `api.projects.trash` with `pendingUntilAbort(signal)` so the first call (openTrash) stays in flight ... The refresh inside `confirmDeleteChapter` will call `api.projects.trash` a second time." Same problem as [D1]: if `openTrash`'s fetch hangs, `trashOpen` stays false and the refresh branch in `confirmDeleteChapter` is skipped.

**Resolution in this plan:** Same shape as [D1]: before firing the in-flight `openTrash`, manually call `result.current.setTrashOpen(true)` so the subsequent `confirmDeleteChapter` actually reaches its refresh branch. All other test #5 assertions are unchanged. Once `trashOpen` is true, the in-flight `openTrash` can hang on `pendingUntilAbort` and the refresh can fire and abort it — the exact behaviour the test is meant to pin.

Both notes call for the alignment review to confirm: are these resolutions faithful to the design intent? The plan author believes yes — the design's intent is to pin the shared-`trashOp` behaviour and the refresh path's abort-on-unmount, and the `setTrashOpen(true)` setup is purely test plumbing that doesn't change what gets asserted.

---

## Task 1: Commit 1 — Characterization tests for `trashOp`

**Files:**

- Modify: `packages/client/src/__tests__/useTrashManager.test.ts`

This task adds three new tests pinning `trashOp` behaviour at the consumer's API surface: #1 (abort-prior on `openTrash`), #3 (refresh path: abort-on-unmount + signal-threading per [D1]), and #5 (shared-`trashOp` behaviour across `openTrash` and refresh per [D2]). All tests pass green against the current (pre-migration) source — these are characterization tests pinning behaviour the migration must preserve. The pre-migration source provides each assertion via different machinery (`trashAbortRef.current?.abort()`, the unmount cleanup effect at lines 45–51); post-migration the same assertions are provided by the hook's auto-abort and `run()`'s abort-prior. The tests are unchanged across the two phases — that's what makes them characterization tests.

**Design references:** §Test plan (5 new tests), Plan-vs-Design Notes [D1] and [D2] (setTrashOpen setup).

- [ ] **Step 1: Add new test #1 — `openTrash` aborts the prior in-flight signal when called again rapidly**

Open `packages/client/src/__tests__/useTrashManager.test.ts`. Locate the last `it("on PROJECT_PURGED ...")` test that ends around line 324 (the closing `});` at line 325 is the end of the `describe` block). Insert this test inside the `describe` block, just before its closing `});`:

```ts
it("openTrash aborts the prior in-flight signal when called again rapidly", async () => {
  // Pin the abort-prior contract on trashOp via the openTrash path. Pre-
  // migration: trashAbortRef.current?.abort() at line 55. Post-migration:
  // trashOp.run() aborts the prior controller before allocating a new
  // one. Either way, two rapid openTrash() calls must leave the first
  // signal aborted and the second signal fresh.
  const capturedSignals: AbortSignal[] = [];
  vi.mocked(api.projects.trash).mockImplementation((_slug, signal) => {
    if (signal) capturedSignals.push(signal);
    return pendingUntilAbort(signal);
  });

  const project = makeProject();
  const { result } = renderHook(() =>
    useTrashManager(project, project.slug, vi.fn(), vi.fn(), vi.fn()),
  );

  act(() => {
    void result.current.openTrash();
  });
  await waitFor(() => expect(api.projects.trash).toHaveBeenCalledTimes(1));
  expect(capturedSignals[0].aborted).toBe(false);

  act(() => {
    void result.current.openTrash();
  });
  await waitFor(() => expect(api.projects.trash).toHaveBeenCalledTimes(2));

  expect(capturedSignals[0].aborted).toBe(true);
  expect(capturedSignals[1].aborted).toBe(false);
});
```

- [ ] **Step 2: Run new test #1 in isolation**

Run: `npm test -w packages/client -- useTrashManager.test.ts -t "openTrash aborts the prior in-flight signal"`

Expected: PASS. The current code's `trashAbortRef.current?.abort()` at line 55 of `useTrashManager.ts` already provides this behaviour; the new test pins it.

- [ ] **Step 3: Add new test #3 — `confirmDeleteChapter`'s post-delete refresh aborts on unmount + threads the signal (per [D1])**

Append this test inside the `describe` block, after test #1:

```ts
it("confirmDeleteChapter's post-delete trash refresh aborts on unmount and threads the signal", async () => {
  // Pin abort-on-unmount + signal-threading for the post-delete refresh
  // path. Pre-migration: the refresh allocates its own AbortController
  // and stores it on trashAbortRef (lines 166–170); the combined unmount
  // cleanup effect at lines 45–51 aborts it. Post-migration: the refresh
  // calls trashOp.run() and the hook's auto-abort handles unmount.
  //
  // Per Plan-vs-Design Note [D1]: this test sets trashOpen=true manually
  // via the hook's exposed setter so confirmDeleteChapter's
  // `if (trashOpen && project)` guard reaches the refresh branch without
  // requiring a preceding openTrash() (whose pendingUntilAbort would
  // never set trashOpen=true).
  let refreshSignal: AbortSignal | undefined;
  vi.mocked(api.projects.trash).mockImplementation((_slug, signal) => {
    refreshSignal = signal;
    return pendingUntilAbort(signal);
  });

  const target = makeChapter({ id: "ch-target" });
  const project = makeProject();
  const handleDeleteChapter = vi.fn().mockResolvedValue(true);

  const { result, unmount } = renderHook(() =>
    useTrashManager(project, project.slug, vi.fn(), handleDeleteChapter, vi.fn()),
  );

  // [D1] setup: satisfy the `if (trashOpen && project)` guard without
  // calling openTrash (whose pendingUntilAbort would never resolve).
  act(() => {
    result.current.setTrashOpen(true);
    result.current.setDeleteTarget(target);
  });

  act(() => {
    void result.current.confirmDeleteChapter();
  });
  await waitFor(() => expect(api.projects.trash).toHaveBeenCalledTimes(1));

  expect(refreshSignal).toBeDefined();
  expect(refreshSignal?.aborted).toBe(false);

  unmount();
  expect(refreshSignal?.aborted).toBe(true);
});
```

- [ ] **Step 4: Run new test #3 in isolation**

Run: `npm test -w packages/client -- useTrashManager.test.ts -t "confirmDeleteChapter's post-delete trash refresh aborts on unmount"`

Expected: PASS. The current code's combined unmount cleanup effect at lines 45–51 of `useTrashManager.ts` aborts `trashAbortRef.current`, which holds the refresh's controller at unmount time.

- [ ] **Step 5: Add new test #5 — `openTrash` and `confirmDeleteChapter`'s refresh share `trashOp` (per [D2])**

Append this test inside the `describe` block, after test #3:

```ts
it("openTrash and confirmDeleteChapter's refresh share trashOp (shared-ref behaviour)", async () => {
  // Pin the shared-controller behaviour across openTrash and
  // confirmDeleteChapter's refresh. Pre-migration: both call sites
  // reference trashAbortRef, so the second one's
  // `trashAbortRef.current?.abort()` cancels the first's controller.
  // Post-migration: both call sites invoke trashOp.run() on the same
  // hook instance, so run()'s abort-prior cancels the first call's
  // controller. The shared-controller invariant is what makes
  // openTrash + refresh mutually exclusive — calling either while the
  // other is in flight aborts the prior.
  //
  // Per Plan-vs-Design Note [D2]: setTrashOpen=true is called manually
  // before the in-flight openTrash so confirmDeleteChapter's refresh
  // branch can fire without waiting for openTrash to resolve (which it
  // won't, with pendingUntilAbort).
  const capturedSignals: AbortSignal[] = [];
  vi.mocked(api.projects.trash).mockImplementation((_slug, signal) => {
    if (signal) capturedSignals.push(signal);
    return pendingUntilAbort(signal);
  });

  const target = makeChapter({ id: "ch-target" });
  const project = makeProject();
  const handleDeleteChapter = vi.fn().mockResolvedValue(true);

  const { result } = renderHook(() =>
    useTrashManager(project, project.slug, vi.fn(), handleDeleteChapter, vi.fn()),
  );

  // [D2] setup: trashOpen=true so confirmDeleteChapter reaches the
  // refresh branch; deleteTarget so confirmDeleteChapter has a chapter
  // to delete.
  act(() => {
    result.current.setTrashOpen(true);
    result.current.setDeleteTarget(target);
  });

  act(() => {
    void result.current.openTrash();
  });
  await waitFor(() => expect(api.projects.trash).toHaveBeenCalledTimes(1));
  const openTrashSignal = capturedSignals[0];
  expect(openTrashSignal.aborted).toBe(false);

  // Fire confirmDeleteChapter. It awaits handleDeleteChapter (resolves
  // true), then hits the refresh branch which calls api.projects.trash
  // a second time. Pre-migration the refresh aborts the prior
  // trashAbortRef.current; post-migration trashOp.run() aborts the prior
  // controller. Either way, the openTrash signal is aborted.
  act(() => {
    void result.current.confirmDeleteChapter();
  });
  await waitFor(() => expect(api.projects.trash).toHaveBeenCalledTimes(2));
  const refreshSignal = capturedSignals[1];

  expect(openTrashSignal.aborted).toBe(true);
  expect(refreshSignal.aborted).toBe(false);
});
```

- [ ] **Step 6: Run new test #5 in isolation**

Run: `npm test -w packages/client -- useTrashManager.test.ts -t "openTrash and confirmDeleteChapter's refresh share trashOp"`

Expected: PASS. Pre-migration: both call sites share `trashAbortRef`, so the refresh's `trashAbortRef.current?.abort()` aborts the in-flight openTrash signal.

- [ ] **Step 7: Run the full useTrashManager test file**

Run: `npm test -w packages/client -- useTrashManager.test.ts`

Expected: PASS — 7 existing tests + 3 new tests = 10 tests, all green.

- [ ] **Step 8: Confirm zero test warnings**

Inspect the test output stderr. The existing `errorSpy`/`warnSpy` setup in `beforeEach` (lines 57–63) suppresses `console.warn`/`console.error` from the hook's error paths; the new tests don't trigger those paths (none of them resolve to an error, only to abort signals). Verify no `console.warn` / `console.error` appears in stderr. If any appears, identify the source — likely a `mockImplementation` that returned an unexpected shape.

- [ ] **Step 9: Commit**

```bash
git add packages/client/src/__tests__/useTrashManager.test.ts
git commit -m "$(cat <<'EOF'
test(trash): characterization tests for trashOp behaviour (4b.3a.3)

Adds three characterization tests pinning trashOp's contract at the
useTrashManager API surface — invariants the 4b.3a.3 migration must
preserve:

1. openTrash aborts the prior in-flight signal when called again
   rapidly — pins the abort-prior contract on the openTrash path.
2. confirmDeleteChapter's post-delete trash refresh aborts on unmount
   and threads the signal — pins the previously-unpinned refresh path
   (existing I5 test covers openTrash unmount only).
3. openTrash and confirmDeleteChapter's refresh share trashOp — pins
   the shared-controller behaviour (calling either mid-flight of the
   other aborts the prior).

Per plan-vs-design notes [D1] and [D2], tests 2 and 3 call
result.current.setTrashOpen(true) manually to satisfy
confirmDeleteChapter's `if (trashOpen && project)` guard without a
preceding openTrash() (whose pendingUntilAbort would never resolve to
flip trashOpen).

All three tests pass green against the pre-migration source — they
characterize behaviour the migration must preserve, not new
functionality. The migration commit will keep them green via the
hook's auto-abort and run()'s abort-prior.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Commit 2 — Characterization tests for `restoreOp` + cross-ref independence

**Files:**

- Modify: `packages/client/src/__tests__/useTrashManager.test.ts`

This task adds two characterization tests: #2 (abort-prior on `handleRestore`) and #4 (cross-ref independence between `trashOp` and `restoreOp`). Both pass green against the pre-migration source. Test #4 is the load-bearing test the design's §Risks calls out — it pins the Out-of-Scope §"Folding `trashOp` and `restoreOp` into one instance" invariant.

**Design references:** §Test plan tests #2 and #4, §Risks "Cross-ref test (#4) is the load-bearing one — must not be deleted as 'redundant.'".

- [ ] **Step 1: Add new test #2 — `handleRestore` aborts the prior in-flight signal when called again rapidly**

Append this test inside the `describe` block, after the three tests from Task 1:

```ts
it("handleRestore aborts the prior in-flight signal when called again rapidly", async () => {
  // Pin the abort-prior contract on restoreOp via the handleRestore
  // path. Pre-migration: restoreAbortRef.current?.abort() at line 80.
  // Post-migration: restoreOp.run() aborts the prior controller.
  // Either way, two rapid handleRestore() calls must leave the first
  // signal aborted and the second signal fresh.
  const capturedSignals: AbortSignal[] = [];
  vi.mocked(api.chapters.restore).mockImplementation((_id, signal) => {
    if (signal) capturedSignals.push(signal);
    return pendingUntilAbort(signal);
  });

  const project = makeProject();
  const { result } = renderHook(() =>
    useTrashManager(project, project.slug, vi.fn(), vi.fn(), vi.fn()),
  );

  act(() => {
    void result.current.handleRestore("ch-1");
  });
  await waitFor(() => expect(api.chapters.restore).toHaveBeenCalledTimes(1));
  expect(capturedSignals[0].aborted).toBe(false);

  act(() => {
    void result.current.handleRestore("ch-2");
  });
  await waitFor(() => expect(api.chapters.restore).toHaveBeenCalledTimes(2));

  expect(capturedSignals[0].aborted).toBe(true);
  expect(capturedSignals[1].aborted).toBe(false);
});
```

- [ ] **Step 2: Run new test #2 in isolation**

Run: `npm test -w packages/client -- useTrashManager.test.ts -t "handleRestore aborts the prior in-flight signal"`

Expected: PASS. Pre-migration: `restoreAbortRef.current?.abort()` at line 80 of `useTrashManager.ts` provides the abort-prior behaviour.

- [ ] **Step 3: Add new test #4 — `trashOp` and `restoreOp` use independent controllers (cross-ref independence)**

Append this test inside the `describe` block, after test #2:

```ts
it("trashOp and restoreOp use independent controllers (cross-ref independence)", async () => {
  // Pin the cross-ref independence invariant. Pre-migration:
  // trashAbortRef and restoreAbortRef are distinct useRef<...> slots,
  // so openTrash (which touches only trashAbortRef) cannot abort an
  // in-flight handleRestore signal, and vice versa. Post-migration:
  // trashOp and restoreOp are two separate useAbortableAsyncOperation
  // instances with two distinct internal refs, preserving the same
  // independence.
  //
  // This is the load-bearing test the design's §Risks calls out —
  // without it, a future maintainer collapsing trashOp + restoreOp
  // into one shared instance would silently break the "user can be
  // restoring a chapter while the trash list refreshes" concurrency
  // model. The §Out of scope rule "Folding trashOp and restoreOp into
  // one instance" depends on this test for executable enforcement.
  const trashSignals: AbortSignal[] = [];
  vi.mocked(api.projects.trash).mockImplementation((_slug, signal) => {
    if (signal) trashSignals.push(signal);
    return pendingUntilAbort(signal);
  });
  const restoreSignals: AbortSignal[] = [];
  vi.mocked(api.chapters.restore).mockImplementation((_id, signal) => {
    if (signal) restoreSignals.push(signal);
    return pendingUntilAbort(signal);
  });

  const project = makeProject();
  const { result } = renderHook(() =>
    useTrashManager(project, project.slug, vi.fn(), vi.fn(), vi.fn()),
  );

  // Start both ops in flight.
  act(() => {
    void result.current.openTrash();
  });
  await waitFor(() => expect(api.projects.trash).toHaveBeenCalledTimes(1));
  act(() => {
    void result.current.handleRestore("ch-x");
  });
  await waitFor(() => expect(api.chapters.restore).toHaveBeenCalledTimes(1));

  const trashSignal1 = trashSignals[0];
  const restoreSignal1 = restoreSignals[0];
  expect(trashSignal1.aborted).toBe(false);
  expect(restoreSignal1.aborted).toBe(false);

  // Fire a second openTrash. It aborts the prior trash controller via
  // trashOp; restore controller is untouched.
  act(() => {
    void result.current.openTrash();
  });
  await waitFor(() => expect(api.projects.trash).toHaveBeenCalledTimes(2));
  expect(trashSignal1.aborted).toBe(true);
  expect(restoreSignal1.aborted).toBe(false);

  // Fire a second handleRestore. It aborts the prior restore controller
  // via restoreOp; the just-allocated second trash controller is
  // untouched.
  act(() => {
    void result.current.handleRestore("ch-y");
  });
  await waitFor(() => expect(api.chapters.restore).toHaveBeenCalledTimes(2));
  expect(restoreSignal1.aborted).toBe(true);
  // Sanity: the second trash signal (allocated by the second openTrash)
  // is still fresh — handleRestore did not reach into trashOp.
  expect(trashSignals[1].aborted).toBe(false);
});
```

- [ ] **Step 4: Run new test #4 in isolation**

Run: `npm test -w packages/client -- useTrashManager.test.ts -t "trashOp and restoreOp use independent controllers"`

Expected: PASS. Pre-migration: `trashAbortRef` and `restoreAbortRef` are independent refs; touching one does not affect the other. The test characterizes this independence at the API surface.

- [ ] **Step 5: Run the full useTrashManager test file**

Run: `npm test -w packages/client -- useTrashManager.test.ts`

Expected: PASS — 7 existing tests + 5 new tests = 12 tests, all green.

- [ ] **Step 6: Confirm zero test warnings**

Inspect stderr. Same expectation as Task 1 Step 8 — none of the new tests resolve to a non-abort error path, so `console.error("Failed to load trash:", ...)` and `console.error("Failed to restore chapter:", ...)` must not fire.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/__tests__/useTrashManager.test.ts
git commit -m "$(cat <<'EOF'
test(trash): characterization tests for restoreOp + cross-ref independence (4b.3a.3)

Adds two characterization tests pinning restoreOp's contract and the
cross-ref independence invariant — both must be preserved by the
4b.3a.3 migration:

1. handleRestore aborts the prior in-flight signal when called again
   rapidly — pins the abort-prior contract on the handleRestore path.
2. trashOp and restoreOp use independent controllers — pins the
   §Out-of-scope "Folding trashOp and restoreOp into one instance"
   invariant. Without this test, a future maintainer collapsing the
   two instances into one would silently break the concurrency model
   that lets a user restore a chapter while the trash list refreshes.

Both tests pass green against the pre-migration source (where the two
refs are simply distinct useRef<...> slots). The migration commit will
keep them green via the two separate useAbortableAsyncOperation
instances.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Commit 3 — Migration source

**Files:**

- Modify: `packages/client/src/hooks/useTrashManager.ts`

This task applies the 11-row behaviour mapping from the design to the source. All 12 tests (7 existing + 5 new from Tasks 1–2) must stay green. The migration is purely structural — no user-visible behaviour changes.

**Design references:** §Architecture, §Behaviour mapping (all 11 rows), §Risks "seedConfirmedStatusRef effect must not be touched" and "useEffect and useRef imports — careful with cleanup".

- [ ] **Step 1: Add the `useAbortableAsyncOperation` import**

Open `packages/client/src/hooks/useTrashManager.ts`. The current import line (line 1) reads:

```ts
import { useState, useCallback, useEffect, useRef } from "react";
```

Add the hook import on a new line beneath it. The current `import type { Chapter, ProjectWithChapters } from "@smudge/shared";` is on line 2 and the `api` import is on line 3. Insert between lines 3 and 4 (or wherever maintains the existing local-then-external grouping):

```ts
import { useAbortableAsyncOperation } from "./useAbortableAsyncOperation";
```

The full top of the file should now read:

```ts
import { useState, useCallback, useEffect, useRef } from "react";
import type { Chapter, ProjectWithChapters } from "@smudge/shared";
import { api } from "../api/client";
import { mapApiError } from "../errors";
import { useAbortableAsyncOperation } from "./useAbortableAsyncOperation";
```

Keep `useEffect` and `useRef` in the React import — both are still needed by the `seedConfirmedStatusRef` block at lines 23–26 of the current source.

- [ ] **Step 2: Replace `trashAbortRef` and `restoreAbortRef` with two hook instances; remove the combined unmount cleanup effect (rows 1, 2, 3)**

Locate this block in `useTrashManager.ts` (currently lines 27–51):

```ts
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashedChapters, setTrashedChapters] = useState<Chapter[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Chapter | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // I5 (review 2026-04-24): api.projects.trash now accepts a signal.
  // Abort any prior in-flight trash fetch before issuing a new one
  // (rapid openTrash clicks) and on unmount so the browser drops the
  // request rather than setState-ing into a torn-down hook. Gate
  // console.error on !aborted to uphold the zero-warnings invariant.
  const trashAbortRef = useRef<AbortController | null>(null);
  // User callout (2026-04-25 review): handleRestore had no
  // cancellation/unmount guard (unlike openTrash). If the hook's
  // owner unmounts (navigation / chapter switch) while
  // api.chapters.restore() is in flight, the catch path could log
  // and setState on a torn-down hook. Mirror the trashAbortRef
  // pattern: one controller per restore call, threaded into
  // api.chapters.restore, aborted on the next call AND on unmount.
  const restoreAbortRef = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      trashAbortRef.current?.abort();
      restoreAbortRef.current?.abort();
    },
    [],
  );
```

Replace it with (this consolidates rows 1, 2, 3, and applies row 11's tightened comment-prune rule to the surviving rationale comments):

```ts
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashedChapters, setTrashedChapters] = useState<Chapter[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Chapter | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // I5 (review 2026-04-24): api.projects.trash accepts a signal. The
  // trashOp instance aborts any prior in-flight trash fetch before
  // issuing a new one (rapid openTrash clicks; or the refresh in
  // confirmDeleteChapter that shares this instance) and auto-aborts
  // on unmount so the browser drops the request rather than
  // setState-ing into a torn-down hook. The downstream
  // `if (signal.aborted) return` gates uphold the zero-warnings
  // invariant by skipping console.error on a superseded/unmount abort.
  const trashOp = useAbortableAsyncOperation();
  // User callout (2026-04-25 review): handleRestore had no
  // cancellation/unmount guard (unlike openTrash) before this hook
  // was extracted. If the owner unmounts (navigation / chapter
  // switch) while api.chapters.restore() is in flight, the catch
  // path could log and setState on a torn-down hook. The restoreOp
  // instance mirrors trashOp's pattern: one controller per restore
  // call, threaded into api.chapters.restore, aborted on the next
  // call AND on unmount via the hook's auto-abort.
  const restoreOp = useAbortableAsyncOperation();
```

Notice the deletions: the two `useRef<AbortController | null>(null)` declarations and the combined `useEffect(...)` cleanup block are gone. The comments are pruned to retarget `trashAbortRef`/`restoreAbortRef` references to `trashOp`/`restoreOp` and to acknowledge the hook's auto-abort; the *why* (zero-warnings invariant, mirror-the-pattern rationale) is preserved.

The `seedConfirmedStatusRef` block immediately above this (current lines 23–26) is **not touched** — it remains exactly as-is.

- [ ] **Step 3: Migrate `openTrash`'s body (rows 4, 5)**

Locate `openTrash` (currently lines 53–71 of the file):

```ts
  const openTrash = useCallback(async () => {
    if (!project) return;
    trashAbortRef.current?.abort();
    const controller = new AbortController();
    trashAbortRef.current = controller;
    try {
      const trashed = await api.projects.trash(project.slug, controller.signal);
      if (controller.signal.aborted) return;
      setTrashedChapters(trashed);
      setTrashOpen(true);
    } catch (err) {
      if (controller.signal.aborted) return;
      const { message } = mapApiError(err, "trash.load");
      // message:null for ABORTED — skip both the log and the banner.
      if (message === null) return;
      console.error("Failed to load trash:", err);
      setActionError(message);
    }
  }, [project]);
```

Replace with:

```ts
  const openTrash = useCallback(async () => {
    if (!project) return;
    const { promise, signal } = trashOp.run((s) =>
      api.projects.trash(project.slug, s),
    );
    try {
      const trashed = await promise;
      if (signal.aborted) return;
      setTrashedChapters(trashed);
      setTrashOpen(true);
    } catch (err) {
      if (signal.aborted) return;
      const { message } = mapApiError(err, "trash.load");
      // message:null for ABORTED — skip both the log and the banner.
      if (message === null) return;
      console.error("Failed to load trash:", err);
      setActionError(message);
    }
  }, [project, trashOp]);
```

Note the changes:
- `trashAbortRef.current?.abort()` + `new AbortController()` + ref-store → `trashOp.run((s) => api.projects.trash(project.slug, s))` (row 4). The callback parameter is named `s` to avoid shadowing the outer destructured `signal`.
- `await api.projects.trash(project.slug, controller.signal)` → `await promise` (row 4).
- Both `if (controller.signal.aborted) return` → `if (signal.aborted) return` against the destructured per-call `signal` (row 5).
- The `useCallback` dependency array gains `trashOp` (the hook value is stable across renders — `useMemo`'d inside `useAbortableAsyncOperation` — but lint requires it for correctness).

- [ ] **Step 4: Migrate `handleRestore`'s body (rows 6, 7, 8)**

Locate `handleRestore` (currently lines 73–141):

```ts
  const handleRestore = useCallback(
    async (chapterId: string) => {
      // User callout (2026-04-25): abort any prior in-flight restore
      // and install the controller on the shared ref so the unmount
      // cleanup can sever a mid-flight restore. Threading the signal
      // into api.chapters.restore makes the abort propagate to the
      // network layer, not just gate the client-side response handler.
      restoreAbortRef.current?.abort();
      const controller = new AbortController();
      restoreAbortRef.current = controller;
      try {
        const restored = await api.chapters.restore(chapterId, controller.signal);
        if (controller.signal.aborted) return;
        if (restoreAbortRef.current === controller) restoreAbortRef.current = null;
        setTrashedChapters((prev) => prev.filter((c) => c.id !== chapterId));
        setProject((prev) => {
          // ... (unchanged) ...
        });
        // C2 (review 2026-04-25): seed the confirmed-status cache for
        // the restored chapter so a later status PATCH that double-fails
        // (PATCH + recovery GET) can fall back to the actual server-truth
        // baseline rather than silently skipping the revert.
        seedConfirmedStatusRef.current?.(restored.id, restored.status);
        // If the slug changed (project was also restored), update the URL
        if (restored.project_slug && restored.project_slug !== slug) {
          navigate(`/projects/${restored.project_slug}`, { replace: true });
        }
      } catch (err) {
        if (restoreAbortRef.current === controller) restoreAbortRef.current = null;
        // ... (rest of catch unchanged) ...
      }
    },
    [slug, setProject, navigate],
  );
```

Replace with (the row-11 comment retargeting in the leading comment block; row 6 in the run() call; row 7 in the post-await gate; row 8 deletes the two ref-nulling lines):

```ts
  const handleRestore = useCallback(
    async (chapterId: string) => {
      // User callout (2026-04-25): abort any prior in-flight restore
      // before issuing the new one. The restoreOp instance threads the
      // signal into api.chapters.restore so the abort propagates to the
      // network layer, not just gates the client-side response handler.
      // Auto-abort on unmount is provided by the hook itself.
      const { promise, signal } = restoreOp.run((s) =>
        api.chapters.restore(chapterId, s),
      );
      try {
        const restored = await promise;
        if (signal.aborted) return;
        setTrashedChapters((prev) => prev.filter((c) => c.id !== chapterId));
        setProject((prev) => {
          if (!prev) return prev;
          const updatedProject = {
            ...prev,
            chapters: [...prev.chapters, restored].sort((a, b) => a.sort_order - b.sort_order),
          };
          // If the restore also restored the parent project with a new slug, update it
          if (restored.project_slug && restored.project_slug !== prev.slug) {
            updatedProject.slug = restored.project_slug;
          }
          return updatedProject;
        });
        // C2 (review 2026-04-25): seed the confirmed-status cache for
        // the restored chapter so a later status PATCH that double-fails
        // (PATCH + recovery GET) can fall back to the actual server-truth
        // baseline rather than silently skipping the revert.
        seedConfirmedStatusRef.current?.(restored.id, restored.status);
        // If the slug changed (project was also restored), update the URL
        if (restored.project_slug && restored.project_slug !== slug) {
          navigate(`/projects/${restored.project_slug}`, { replace: true });
        }
      } catch (err) {
        // User callout (2026-04-25): unmount/supersession abort stays
        // silent. Without this guard the catch would log and setState
        // on a torn-down hook, polluting test output (CLAUDE.md zero-
        // warnings invariant) and risking React's setState-on-unmount
        // warning.
        if (signal.aborted) return;
        const { message, possiblyCommitted } = mapApiError(err, "trash.restoreChapter");
        // ABORTED returns message: null. Skip log + state update so a
        // late abort does not surface noise.
        if (message === null) return;
        console.error("Failed to restore chapter:", err);
        // I2 (2026-04-24 review) + S8 (2026-04-24 review): on a
        // committed-but-unreadable response (2xx BAD_JSON or 500
        // RESTORE_READ_FAILURE) the server actually restored the
        // chapter — the client just doesn't have the hydrated row.
        // Optimistically remove it from the trash list so the user
        // doesn't retry (retry would hit 409 RESTORE_CONFLICT, the
        // slug is already present) and surface a committed-specific
        // message. The scope's `committedCodes: ["RESTORE_READ_FAILURE"]`
        // means the mapper now sets possiblyCommitted=true for that
        // code too, so the call site doesn't need the inline code
        // check — adding a new committed-intent code in the future
        // only touches the scope definition.
        if (possiblyCommitted) {
          setTrashedChapters((prev) => prev.filter((c) => c.id !== chapterId));
        }
        setActionError(message);
      }
    },
    [slug, setProject, navigate, restoreOp],
  );
```

Note the changes:
- Row 6: the abort-prior + new controller + signal-thread block at the top of the body becomes one `restoreOp.run((s) => api.chapters.restore(chapterId, s))` call. The leading comment is retargeted per row 11.
- Row 7: both `if (controller.signal.aborted) return` → `if (signal.aborted) return` against the per-call destructured `signal`. Placement preserved (success-path gate before `setTrashedChapters`/`setProject`/`seedConfirmedStatusRef`; catch-path gate as first statement of catch, before `mapApiError`).
- Row 8: the two `if (restoreAbortRef.current === controller) restoreAbortRef.current = null` lines (success path at line 86, catch path at line 110) are deleted entirely. The hook owns the ref lifecycle.
- The C2 seed call (`seedConfirmedStatusRef.current?.(restored.id, restored.status)`) and its leading comment are **untouched** — orthogonal per the design.
- The catch-path comments at lines 111–115 (catch-silent-abort rationale) and lines 122–133 (possiblyCommitted UX rationale) are **untouched** — per row 11 they don't reference ref names and are orthogonal.
- `useCallback` deps gain `restoreOp`.

- [ ] **Step 5: Migrate `confirmDeleteChapter`'s refresh body (rows 9, 10)**

Locate `confirmDeleteChapter` (currently lines 143–179):

```ts
  const confirmDeleteChapter = useCallback(async () => {
    if (!deleteTarget) return;
    setActionError(null);
    let success: boolean;
    try {
      success = await handleDeleteChapter(deleteTarget, (message) => {
        setActionError(message);
      });
    } catch {
      // Unexpected throw — dismiss dialog so the user isn't stuck.
      setDeleteTarget(null);
      return;
    }
    setDeleteTarget(null);
    if (!success) return;
    if (trashOpen && project) {
      // S4 + S5 (review 2026-04-25): thread a signal so an unmount
      // between the successful delete and the trash refresh drops the
      // GET cleanly (was risking setTrashedChapters on a torn-down
      // hook), and route the catch through mapApiError so a non-
      // ABORTED failure surfaces an actionable banner instead of being
      // silently swallowed by `catch {}`. ABORTED stays silent
      // (mapper returns message: null).
      trashAbortRef.current?.abort();
      const controller = new AbortController();
      trashAbortRef.current = controller;
      try {
        const trashed = await api.projects.trash(project.slug, controller.signal);
        if (controller.signal.aborted) return;
        setTrashedChapters(trashed);
      } catch (err) {
        if (controller.signal.aborted) return;
        const { message } = mapApiError(err, "trash.load");
        if (message) setActionError(message);
      }
    }
  }, [deleteTarget, handleDeleteChapter, trashOpen, project]);
```

Replace the inner `if (trashOpen && project)` block with the migrated form (rows 9, 10). The surrounding code (the `handleDeleteChapter` call, the `setDeleteTarget(null)` step, the `if (!success) return` guard) is **unchanged**:

```ts
  const confirmDeleteChapter = useCallback(async () => {
    if (!deleteTarget) return;
    setActionError(null);
    let success: boolean;
    try {
      success = await handleDeleteChapter(deleteTarget, (message) => {
        setActionError(message);
      });
    } catch {
      // Unexpected throw — dismiss dialog so the user isn't stuck.
      setDeleteTarget(null);
      return;
    }
    setDeleteTarget(null);
    if (!success) return;
    if (trashOpen && project) {
      // S4 + S5 (review 2026-04-25): thread a signal via trashOp so an
      // unmount between the successful delete and the trash refresh
      // drops the GET cleanly (was risking setTrashedChapters on a
      // torn-down hook), and route the catch through mapApiError so a
      // non-ABORTED failure surfaces an actionable banner instead of
      // being silently swallowed by `catch {}`. ABORTED stays silent
      // (mapper returns message: null). trashOp is shared with
      // openTrash — calling either while the other is in flight
      // aborts the prior, by design.
      const { promise, signal } = trashOp.run((s) =>
        api.projects.trash(project.slug, s),
      );
      try {
        const trashed = await promise;
        if (signal.aborted) return;
        setTrashedChapters(trashed);
      } catch (err) {
        if (signal.aborted) return;
        const { message } = mapApiError(err, "trash.load");
        if (message) setActionError(message);
      }
    }
  }, [deleteTarget, handleDeleteChapter, trashOpen, project, trashOp]);
```

Note the changes:
- Row 9: the abort-prior + new controller + signal-thread becomes `trashOp.run((s) => api.projects.trash(project.slug, s))`.
- Row 10: both `if (controller.signal.aborted) return` → `if (signal.aborted) return`.
- The S4+S5 comment is retargeted to mention `trashOp` (not `trashAbortRef`) and to acknowledge the shared-`trashOp` semantics — this is part of row 11's intentional rephrase, since the original comment referenced "the trash refresh" implicitly through the shared-ref pattern.
- `useCallback` deps gain `trashOp`.

- [ ] **Step 6: Run the full useTrashManager test file against the migration**

Run: `npm test -w packages/client -- useTrashManager.test.ts`

Expected: PASS — all 12 tests (7 existing + 5 new) green. Migration preserves every behaviour the tests pin.

If any test fails, check the migration against the §Behaviour mapping in the design — most likely cause is a missed signal-gate placement (an `if (signal.aborted) return` that landed in the wrong spot or referenced the wrong variable) or a typo in the `s` callback parameter that left a `signal` shadow ambiguous.

- [ ] **Step 7: Run lint + format + typecheck**

Run: `make lint && make format && npm run typecheck -w packages/client`

Expected: PASS. The migration removes two `useRef<AbortController>` allocations and one `useEffect` block but keeps `useEffect` and `useRef` imports (still used by `seedConfirmedStatusRef`). If lint flags any unused imports, re-verify the `seedConfirmedStatusRef` block at lines 23–26 (it uses both `useRef` and `useEffect`).

- [ ] **Step 8: Sanity-check the post-migration source for residual ref references**

Run: `grep -nE '\b(trash|restore)AbortRef\b' packages/client/src/hooks/useTrashManager.ts`

Expected: no output. If any line is printed, those are stale references that escaped the migration — either uncovered code or a missed comment retargeting.

- [ ] **Step 9: Commit**

```bash
git add packages/client/src/hooks/useTrashManager.ts
git commit -m "$(cat <<'EOF'
refactor(trash): migrate trashAbortRef + restoreAbortRef to useAbortableAsyncOperation (4b.3a.3)

Replaces useTrashManager's two hand-rolled useRef<AbortController>
slots + combined unmount cleanup useEffect with two side-by-side
useAbortableAsyncOperation instances:

- trashOp: shared by openTrash and confirmDeleteChapter's post-delete
  refresh (mutually exclusive — calling either while the other is in
  flight aborts the prior, preserving the pre-migration shared-ref
  semantics)
- restoreOp: owned by handleRestore (independent of trashOp;
  preserves the "user can restore a chapter while the trash refreshes"
  concurrency model)

The combined unmount cleanup effect is removed — both hook instances
auto-abort on unmount. handleRestore's manual ref-nulling on
success/failure (lines 86, 110 pre-migration) is removed — the hook
owns ref lifecycle. The seedConfirmedStatusRef block (lines 23–26)
is untouched — orthogonal to abort lifecycle.

All controller.signal.aborted gates become signal.aborted against the
per-call destructured signal from run(); placement is preserved
exactly (success-path gates before setState/seed, catch-path gates
above mapApiError).

Row-11 comment retargeting: the three comment blocks that named
trashAbortRef / restoreAbortRef (lines 31–35, 37–43, 75–79
pre-migration) are rephrased to reference trashOp/restoreOp; the C2
seed rationale (100–104), catch-silent-abort rationale (111–115),
possiblyCommitted UX rationale (122–133), and S4+S5 refresh
rationale (159–165) are left untouched per design §Out of scope.

All 12 tests (7 existing + 5 new characterization tests from
commits 1–2) pass green. No user-visible behaviour change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Commit 4 — Structural check append

**Files:**

- Modify: `packages/client/src/__tests__/migrationStructuralCheck.test.ts`

This task appends `useTrashManager.ts` to the two `migrated` arrays in the existing structural-check tests and refreshes the inline comment to reflect that 4b.3a.3 has landed. The shared `USE_REF_ABORT_CONTROLLER_PATTERN` (line 20) and `importPatternFor` helper (line 29) landed in 4b.3a.2's cleanup pass — no new helpers or regex needed.

**Design references:** §Test plan §Structural check.

- [ ] **Step 1: Append `useTrashManager.ts` to the `useAbortableAsyncOperation is imported` test**

Open `packages/client/src/__tests__/migrationStructuralCheck.test.ts`. Locate the `it("useAbortableAsyncOperation is imported by every file that has been migrated to it", () => {` test (currently around line 109). Inside its body, find:

```ts
    // Phase 4b.3a.2 (find-replace) is the first migration of this hook;
    // 4b.3a.3 (useTrashManager) and 4b.3a.4 (ImageGallery) will append
    // their migrated files to this list. Whichever phase lands last can
    // collapse this per-file check into a global ban.
    const migrated = [resolve(clientSrcRoot, "hooks/useFindReplaceState.ts")];
```

Replace with:

```ts
    // Phase 4b.3a.2 (find-replace) and 4b.3a.3 (useTrashManager) have
    // migrated; 4b.3a.4 (ImageGallery) will append its migrated file
    // to this list. Once 4b.3a.4 lands, this per-file check can
    // collapse into a global ban.
    const migrated = [
      resolve(clientSrcRoot, "hooks/useFindReplaceState.ts"),
      resolve(clientSrcRoot, "hooks/useTrashManager.ts"),
    ];
```

- [ ] **Step 2: Append `useTrashManager.ts` to the `no raw useRef<AbortController>` test**

Locate the `it("migrated files do not contain raw useRef<AbortController>", () => {` test (currently around line 122). Inside its body, find:

```ts
    const migrated = [resolve(clientSrcRoot, "hooks/useFindReplaceState.ts")];
```

Replace with:

```ts
    const migrated = [
      resolve(clientSrcRoot, "hooks/useFindReplaceState.ts"),
      resolve(clientSrcRoot, "hooks/useTrashManager.ts"),
    ];
```

The surrounding comment (the explanation of `\b[^>]*>` regex shape) is unchanged — it explains the regex, not the array.

- [ ] **Step 3: Run the structural check**

Run: `npm test -w packages/client -- migrationStructuralCheck.test.ts`

Expected: PASS. Both extended tests assert against the post-migration `useTrashManager.ts` from Task 3 — the import is present (added in Task 3 Step 1), and no `useRef<AbortController>` remains (removed in Task 3 Step 2).

If either assertion fails, the migration is incomplete — revisit Task 3 Steps 1–8.

- [ ] **Step 4: Run the full client test suite**

Run: `npm test -w packages/client`

Expected: PASS. All client tests, including the newly extended structural check and the migrated `useTrashManager` tests.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/__tests__/migrationStructuralCheck.test.ts
git commit -m "$(cat <<'EOF'
test(structural): pin useTrashManager migration to useAbortableAsyncOperation (4b.3a.3)

Appends useTrashManager.ts to the two `migrated` arrays in
migrationStructuralCheck.test.ts:

1. useAbortableAsyncOperation is imported by every migrated file
2. migrated files do not contain raw useRef<AbortController>

Inline comment updated to reflect that 4b.3a.3 has landed; only
4b.3a.4 (ImageGallery) remains before the per-file check can
collapse into a global packages/client/src ban.

No new helpers or regex — uses USE_REF_ABORT_CONTROLLER_PATTERN
(line 20) and importPatternFor (line 29) from 4b.3a.2's cleanup.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Commit 5 — Cleanup (if needed)

**Files:**

- Modify: `packages/client/src/hooks/useTrashManager.ts` (only if residual cleanup surfaces)

This task inspects the migrated `useTrashManager.ts` for residual cruft that escaped Tasks 1–4: stale comments that survived row 11's pruning, unused imports, etc. If nothing surfaces, **skip this task and proceed to Task 6** — no commit is needed and the order matters more than the count.

**Design references:** §Migration order step 5 ("Cleanup (if needed)").

- [ ] **Step 1: Grep for residual ref-name references**

Run: `grep -nE '\b(trash|restore)AbortRef\b' packages/client/src/hooks/useTrashManager.ts`

Expected: no output. (This grep was already run at the end of Task 3; running it again confirms nothing slipped in between commits.)

If any line prints, retarget the reference per row 11's rule (token removal + sentence rephrase) and stage the change for this commit.

- [ ] **Step 2: Inspect the React imports**

Open `packages/client/src/hooks/useTrashManager.ts`. The first import line should read:

```ts
import { useState, useCallback, useEffect, useRef } from "react";
```

Verify all four names are still used in the post-migration file:

- `useState` — used by the 4 `useState` calls (trashOpen, trashedChapters, deleteTarget, actionError)
- `useCallback` — used by the 3 `useCallback` wrappers (openTrash, handleRestore, confirmDeleteChapter)
- `useEffect` — used by the seedConfirmedStatusRef sync effect (currently lines 24–26 of the pre-migration file)
- `useRef` — used by the seedConfirmedStatusRef declaration (currently line 23)

All four should still be needed. If lint flags any as unused, the migration broke the seedConfirmedStatusRef block — revisit Task 3 Step 2.

- [ ] **Step 3: Inspect for stale review-callout comments outside row 11's three blocks**

Open the migrated file and scan the comment blocks at:

- The C2 seed rationale comment block (immediately before `seedConfirmedStatusRef.current?.(...)`)
- The catch-silent-abort comment block (immediately before the `if (signal.aborted) return` at the top of handleRestore's catch)
- The I2+S8 possiblyCommitted UX comment block (immediately before the `if (possiblyCommitted)` block in handleRestore's catch)
- The S4+S5 refresh comment block (immediately before the `trashOp.run(...)` inside confirmDeleteChapter)

Per row 11 of the design and the [D1]-style pushback resolution, the C2, catch-silent-abort, and I2+S8 comments should be **untouched** by the migration. The S4+S5 comment was intentionally retargeted in Task 3 Step 5 (rephrased to mention `trashOp` and the shared-`trashOp` semantics). Confirm each block reads consistently with its surrounding code.

If any comment reads inconsistently (e.g., references `trashAbortRef` because Task 3's edit missed a line), retarget it now.

- [ ] **Step 4: Decide whether a Cleanup commit is warranted**

- If Steps 1–3 surfaced **no changes**: skip this commit. Proceed to Task 6.
- If Steps 1–3 surfaced **any change**: stage and commit.

```bash
git add packages/client/src/hooks/useTrashManager.ts
git commit -m "$(cat <<'EOF'
style(trash): cleanup residual references after abort migration (4b.3a.3)

Tidies post-migration cruft surfaced by Task 5's inspection grep —
[describe the actual change here, e.g., "rephrases an inline review
comment that escaped Task 3's row-11 pruning" or "removes an unused
import flagged by lint after the cleanup effect was deleted"].

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Final verification

**Files:**

- (No file modifications)

This task runs the full CI pass and inspects coverage to confirm the migration meets all DoD criteria. No commits — verification only.

**Design references:** §Definition of Done.

- [ ] **Step 1: Run the full CI pass**

Run: `make all`

Expected: PASS (lint + format + typecheck + coverage + e2e all green). The e2e suite shouldn't change behaviour — if any e2e test fails, investigate before considering the migration done. Likely failures point to a behavioural regression in the migration source (Task 3) that the unit tests didn't catch.

- [ ] **Step 2: Inspect coverage for useTrashManager.ts**

Run: `make cover`

Inspect the coverage report (typically `packages/client/coverage/index.html` if HTML reporter is configured, or the terminal summary) for `packages/client/src/hooks/useTrashManager.ts`. Confirm all four metrics meet or exceed CLAUDE.md §Testing Philosophy thresholds:

- statements ≥ 95%
- branches ≥ 85%
- functions ≥ 90%
- lines ≥ 95%

If any metric regresses below threshold, identify the uncovered branch and add a targeted test rather than relax the threshold (per CLAUDE.md §Testing Philosophy: "the goal is always to increase coverage as much as possible … never simply adjust the thresholds downward").

- [ ] **Step 3: Confirm zero test warnings**

Re-run `make test` and scan stderr for `console.warn`/`console.error` output. There should be none. If any noisy output appears, identify the source — likely an unsuppressed warning in a test that triggers an error path. Per CLAUDE.md §Testing Philosophy, spy on the output and assert the expected message rather than letting it leak.

- [ ] **Step 4: Walk the Definition of Done checklist from the design**

Verify each bullet from the design's §Definition of Done is met:

- [ ] `useTrashManager.ts` no longer contains `useRef<AbortController>` (verified by Task 5 Step 1 grep AND Task 4 structural check)
- [ ] `trashOp` and `restoreOp` are allocated side-by-side; `trashOp` is shared by `openTrash` and `confirmDeleteChapter`'s refresh; `restoreOp` is owned by `handleRestore` (Task 3 Steps 2–5)
- [ ] The combined abort-cleanup `useEffect` at lines 45–51 is removed; both hook instances handle their own auto-abort. The `seedConfirmedStatusRef` effect at lines 24–26 is untouched (Task 3 Step 2, verified Task 5 Step 2)
- [ ] All `controller`-sourced `if (controller.signal.aborted) return` gates are replaced with `if (signal.aborted) return` against the per-call destructured `signal`; placement preserved (Task 3 Steps 3, 4, 5)
- [ ] All seven existing tests in `__tests__/useTrashManager.test.ts` continue to pass (Step 1 above)
- [ ] Five new tests added: #1 (openTrash abort-prior), #2 (handleRestore abort-prior), #3 (refresh path), #4 (cross-ref independence), #5 (shared-`trashOp` behaviour) (Tasks 1, 2)
- [ ] `migrationStructuralCheck.test.ts` extended with `useTrashManager.ts` appended to both `migrated` arrays; inline comment updated (Task 4)
- [ ] `make all` green (Step 1 above)
- [ ] Coverage on `useTrashManager.ts` holds at or above 95/85/90/95 (Step 2 above)
- [ ] Zero test warnings (Step 3 above)
- [ ] No user-visible behaviour change (verified by all existing tests passing + e2e green)
- [ ] No `CLAUDE.md` change required (verified during /roadmap Step 7 — rule 4 is consumer-agnostic in its prose)

- [ ] **Step 5: Branch is ready for Ovid's PR-creation**

The working branch `trash-manager-abort-migration` is ready. Ovid handles PR creation and merge per the design's §Migration order. The plan does NOT push, create a PR, or merge.

Final commit count: **4 or 5 commits** (Tasks 1, 2, 3, 4, plus optionally Task 5 if cleanup was needed).
