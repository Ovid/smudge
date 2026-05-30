# Editor State Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scattered editor-state refs (`editorLockedMessage`/`editorLockedMessageRef`/`reloadFailed`/`reloadSucceeded` + the imperative `setEditable` calls) with one `useReducer` machine that owns `{ editable, busy, lock }`, and add a `committed_but_unreloaded` mutation stage for the "server committed, display unconfirmed" case.

**Architecture:** A pure, exported reducer (`editorMutationReducer`) lives in `packages/client/src/hooks/useEditorMutationMachine.ts`, wrapped by a hook that mirrors state to a ref *in render* (house style) so synchronous gates survive. `EditorPage` owns the machine instance and passes `dispatch` into `useEditorMutation` and `applyReloadFailedLock`. Per **Decided Q3 (hybrid)** of the design, two transitions stay synchronous-imperative for timing safety — the lock-down `setEditable(false)` (blocks input before the first `await`) and the `inFlightRef` re-entrancy latch — while a single effect reconciles the `editable=true` / re-assert direction. The PR is split **additive-then-subtractive**: PR A adds `committed_but_unreloaded` alongside a retained `stage:"reload"`; PR B migrates consumers then removes `stage:"reload"`.

**Tech Stack:** React 18 `useReducer`/`useRef`/`useEffect`, TypeScript discriminated unions, Vitest + Testing Library (`@testing-library/react`, `renderHook`), TipTap `EditorHandle`.

---

## Design clarifications encoded by this plan

The design doc (`2026-05-29-editor-state-machine-design.md`) leaves three mechanisms implicit. This plan makes them concrete; the alignment step (and Ovid) should ratify them, folding any wording back into the design:

1. **Who dispatches `COMMITTED_UNRELOADED`.** The hook (`useEditorMutation`) can detect the *reload-failure* and *race-only-supersession* cases and returns `stage:"committed_but_unreloaded"`, but it does **not** know the user-facing banner copy (that is scope-specific). So `COMMITTED_UNRELOADED { message }` is dispatched by the **consumer**, realized through the existing `applyReloadFailedLock(message)` choke point whose body changes from `setEditorLockedMessage + safeSetEditable(false)` to `dispatch({ type: "COMMITTED_UNRELOADED", message })`. On the committed path the hook dispatches **no** terminal re-enable event, so `editable` stays `false` (from `MUTATION_STARTED`) until the consumer's dispatch lands the banner — no flip.

2. **Where 2xx `BAD_JSON` is classified.** `mapApiError(...).possiblyCommitted` (CLAUDE.md §Unified API error mapping) owns 2xx-BAD_JSON detection, and it runs in the **consumer**, not the hook. So a 2xx-BAD_JSON throw inside `mutate()` keeps the hook stage `"mutate"`; the consumer's existing `possiblyCommitted` branch routes it to the **same** `COMMITTED_UNRELOADED` machine event via `applyReloadFailedLock`. The machine event — not the hook's `MutationResult` stage — is the convergence point for "server committed, display unconfirmed." `committed_but_unreloaded` as a `MutationResult` stage covers only the cases the hook itself detects (former `stage:"reload"` + race-only supersession).

3. **`busy` vs `inFlightRef`.** The machine's `busy` is the canonical/testable busy state; `inFlightRef` is retained as the synchronous re-entrancy latch and as the read-path for `isBusy()` (the synchronous probe external callers gate on). They are two representations of one logical value, written in lockstep by the hook (the sole writer of both): both set true in the synchronous entry block, both cleared on settle. This satisfies the DoD's "single machine owns the state" while meeting the synchronous-read requirement of Decided Q3.

---

## File structure

- **New:** `packages/client/src/hooks/useEditorMutationMachine.ts` — `EditorMutationState`, `EditorMutationEvent`, the pure `editorMutationReducer`, the `INITIAL_EDITOR_MUTATION_STATE`, and the `useEditorMutationMachine()` hook.
- **New:** `packages/client/src/hooks/__tests__/useEditorMutationMachine.test.tsx` — pure-reducer unit tests (every event) + hook stateRef-mirror test.
- **Modify:** `packages/client/src/hooks/useEditorMutation.ts` — add `committed_but_unreloaded` to `MutationResult` (PR A) / remove `stage:"reload"` (PR B); accept `dispatch`; drop the `isLocked` arg; replace the `finally`'s imperative re-enable with terminal `dispatch`; keep `inFlightRef` (latch) and the lock-down `setEditable(false)` calls (now via `safeSetEditable`).
- **Modify:** `packages/client/src/pages/EditorPage.tsx` — instantiate the machine; delete `editorLockedMessage` `useState`, the `editorLockedMessageRef` mirror, and the line-448 clear-effect; add the `editable` reconcile effect; re-point `isEditorLocked`/`handleSaveLockGated`/`isActionBusy` and `applyReloadFailedLock` at the machine; pass `dispatch` to `useEditorMutation`.
- **Modify:** `packages/client/src/hooks/useSnapshotController.ts` — rename the `stage:"reload"` branch to `stage:"committed_but_unreloaded"`; add the exhaustive `: never` default (PR B).
- **Modify:** `packages/client/src/hooks/useFindReplaceController.ts` — same stage rename + exhaustive default at both `executeReplace` and `handleReplaceOne` sites (PR B).
- **Modify:** `packages/client/src/hooks/useEditorMutation.test.tsx` — re-point assertions from `editorRef.setEditable` spy counts to machine-state/effect outcomes; add the three Critical regression tests, the one-commit-tick window test, and the hybrid-supersession tests.
- **Modify:** `CLAUDE.md` — add the "Editor operational state lives in one machine" paragraph (final task).

Existing helpers reused verbatim: `safeSetEditable` (`packages/client/src/utils/editorSafeOps.ts:34`), `clientWarn` (`packages/client/src/errors`).

---

# PR A — Machine + hook migration (adds `committed_but_unreloaded`, retains `stage:"reload"`)

PR A is independently shippable: it adds the new stage and rewires `useEditorMutation` + `EditorPage` onto the machine, while `stage:"reload"` remains in the union so the as-yet-unmigrated consumers still typecheck and behave identically.

## Task A1: The pure reducer — state, events, initial value

**Files:**
- Create: `packages/client/src/hooks/useEditorMutationMachine.ts`
- Test: `packages/client/src/hooks/__tests__/useEditorMutationMachine.test.tsx`

- [ ] **Step 1: Write the failing reducer tests**

Create `packages/client/src/hooks/__tests__/useEditorMutationMachine.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import {
  editorMutationReducer,
  INITIAL_EDITOR_MUTATION_STATE,
  type EditorMutationState,
} from "../useEditorMutationMachine";

const LOCKED: EditorMutationState = {
  editable: false,
  busy: false,
  lock: { message: "refresh the page" },
};

describe("editorMutationReducer", () => {
  it("starts editable, not busy, unlocked", () => {
    expect(INITIAL_EDITOR_MUTATION_STATE).toEqual({ editable: true, busy: false, lock: null });
  });

  it("MUTATION_STARTED: busy true, editable false, lock unchanged", () => {
    expect(
      editorMutationReducer(INITIAL_EDITOR_MUTATION_STATE, { type: "MUTATION_STARTED" }),
    ).toEqual({ editable: false, busy: true, lock: null });
    // lock unchanged when a prior lock exists
    expect(editorMutationReducer(LOCKED, { type: "MUTATION_STARTED" })).toEqual({
      editable: false,
      busy: true,
      lock: { message: "refresh the page" },
    });
  });

  it("MUTATION_SETTLED_OK: re-enables only when unlocked", () => {
    const busy: EditorMutationState = { editable: false, busy: true, lock: null };
    expect(editorMutationReducer(busy, { type: "MUTATION_SETTLED_OK" })).toEqual({
      editable: true,
      busy: false,
      lock: null,
    });
    // a persistent lock keeps the editor read-only after a successful run
    const busyLocked: EditorMutationState = { ...LOCKED, busy: true };
    expect(editorMutationReducer(busyLocked, { type: "MUTATION_SETTLED_OK" })).toEqual({
      editable: false,
      busy: false,
      lock: { message: "refresh the page" },
    });
  });

  it("MUTATION_SETTLED_SUPERSEDED: clears a stale prior lock, re-enables", () => {
    const busyLocked: EditorMutationState = { ...LOCKED, busy: true };
    expect(editorMutationReducer(busyLocked, { type: "MUTATION_SETTLED_SUPERSEDED" })).toEqual({
      editable: true,
      busy: false,
      lock: null,
    });
  });

  it("RELOADED: fresh content on screen — editable, unlocked", () => {
    const busyLocked: EditorMutationState = { ...LOCKED, busy: true };
    expect(editorMutationReducer(busyLocked, { type: "RELOADED" })).toEqual({
      editable: true,
      busy: false,
      lock: null,
    });
  });

  it("COMMITTED_UNRELOADED: read-only + banner, busy cleared", () => {
    const busy: EditorMutationState = { editable: false, busy: true, lock: null };
    expect(
      editorMutationReducer(busy, { type: "COMMITTED_UNRELOADED", message: "committed; refresh" }),
    ).toEqual({ editable: false, busy: false, lock: { message: "committed; refresh" } });
  });

  it("EDITOR_REMOUNTED: clears lock, re-enables, busy untouched", () => {
    const busyLocked: EditorMutationState = { ...LOCKED, busy: true };
    expect(editorMutationReducer(busyLocked, { type: "EDITOR_REMOUNTED" })).toEqual({
      editable: true,
      busy: true, // untouched
      lock: null,
    });
  });

  it("UNLOCK: clears lock only", () => {
    expect(editorMutationReducer(LOCKED, { type: "UNLOCK" })).toEqual({
      editable: false,
      busy: false,
      lock: null,
    });
  });

  it("is a pure function (does not mutate input)", () => {
    const frozen = Object.freeze({ ...INITIAL_EDITOR_MUTATION_STATE });
    expect(() => editorMutationReducer(frozen, { type: "MUTATION_STARTED" })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w packages/client -- useEditorMutationMachine`
Expected: FAIL — `Cannot find module '../useEditorMutationMachine'`.

- [ ] **Step 3: Implement the state, events, and reducer**

Create `packages/client/src/hooks/useEditorMutationMachine.ts`:

```ts
import { useReducer, useRef, useCallback, useMemo, type Dispatch } from "react";

/**
 * The editor's operational state. Owned by one machine (Phase 4b.5) so the
 * lock banner, the TipTap `editable` flag, and mutation-busy can never drift
 * apart by hand. See the design doc's Decided Q3 for why two transitions stay
 * synchronous-imperative in `useEditorMutation` rather than effect-driven.
 */
export type EditorMutationState = {
  /** Intent; a sync-effect in EditorPage pushes this into TipTap (re-enable). */
  editable: boolean;
  /** Mutation-busy (canonical/testable). The synchronous re-entrancy latch is
   * a retained `inFlightRef` in useEditorMutation, kept in lockstep with this. */
  busy: boolean;
  /** Persistent read-only lock banner; null = unlocked. */
  lock: { message: string } | null;
};

export type EditorMutationEvent =
  | { type: "MUTATION_STARTED" }
  | { type: "MUTATION_SETTLED_OK" }
  | { type: "MUTATION_SETTLED_SUPERSEDED" }
  | { type: "RELOADED" }
  | { type: "COMMITTED_UNRELOADED"; message: string }
  | { type: "EDITOR_REMOUNTED" }
  | { type: "UNLOCK" };

export const INITIAL_EDITOR_MUTATION_STATE: EditorMutationState = {
  editable: true,
  busy: false,
  lock: null,
};

export function editorMutationReducer(
  state: EditorMutationState,
  event: EditorMutationEvent,
): EditorMutationState {
  switch (event.type) {
    case "MUTATION_STARTED":
      // Lock-down intent. The hook also calls safeSetEditable(false)
      // synchronously (Decided Q3) so input is blocked before the first await.
      return { ...state, busy: true, editable: false };
    case "MUTATION_SETTLED_OK":
      // Happy/flush/mutate terminal: re-enable ONLY when not locked, preserving
      // today's `!reloadFailed && !lockedByCaller` guard — a successful run
      // cannot re-enable typing under a persistent banner.
      return { ...state, busy: false, editable: state.lock === null };
    case "MUTATION_SETTLED_SUPERSEDED":
      // Benign supersession: clear a stale (prior-chapter) lock and re-enable,
      // mirroring today's reloadSuperseded bypass.
      return { editable: true, busy: false, lock: null };
    case "RELOADED":
      // Fresh server content is on screen.
      return { editable: true, busy: false, lock: null };
    case "COMMITTED_UNRELOADED":
      // Server committed, display unconfirmed: stay read-only, raise the banner.
      return { editable: false, busy: false, lock: { message: event.message } };
    case "EDITOR_REMOUNTED":
      // Chapter switch or post-reload remount: the prior lock no longer applies
      // and TipTap mounts editable=true. Busy is untouched (a mutation may be
      // mid-flight across the remount). Mirrors today's
      // [activeChapter?.id, chapterReloadKey] clear-effect.
      return { ...state, editable: true, lock: null };
    case "UNLOCK":
      // Reserved: no production dispatcher today (the lock banner is
      // non-dismissible; only EDITOR_REMOUNTED clears it in production). Kept
      // for a future dismissible-lock path and exercised by the reducer unit
      // test so the machine vocabulary stays complete without a coverage gap.
      return { ...state, lock: null };
    default: {
      const _exhaustive: never = event;
      return state;
    }
  }
}
```

- [ ] **Step 4: Run to verify the reducer tests pass**

Run: `npm test -w packages/client -- useEditorMutationMachine`
Expected: PASS (8 reducer cases).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/hooks/useEditorMutationMachine.ts packages/client/src/hooks/__tests__/useEditorMutationMachine.test.tsx
git commit -m "feat(4b.5): pure editor-mutation reducer + state/events"
```

## Task A2: The `useEditorMutationMachine` hook (render-mirrored stateRef)

**Files:**
- Modify: `packages/client/src/hooks/useEditorMutationMachine.ts`
- Test: `packages/client/src/hooks/__tests__/useEditorMutationMachine.test.tsx`

- [ ] **Step 1: Write the failing hook test**

Append to the test file:

```tsx
import { act, renderHook } from "@testing-library/react";
import { useEditorMutationMachine } from "../useEditorMutationMachine";

describe("useEditorMutationMachine", () => {
  it("exposes state + synchronous probes backed by a render-mirrored ref", () => {
    const { result } = renderHook(() => useEditorMutationMachine());
    expect(result.current.state).toEqual(INITIAL_EDITOR_MUTATION_STATE);
    expect(result.current.isLocked()).toBe(false);
    expect(result.current.isBusy()).toBe(false);

    act(() => result.current.dispatch({ type: "COMMITTED_UNRELOADED", message: "x" }));
    expect(result.current.state.lock).toEqual({ message: "x" });
    // synchronous probe reflects the committed render
    expect(result.current.isLocked()).toBe(true);
    expect(result.current.getState().lock).toEqual({ message: "x" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w packages/client -- useEditorMutationMachine`
Expected: FAIL — `useEditorMutationMachine is not a function`.

- [ ] **Step 3: Implement the hook**

Append to `useEditorMutationMachine.ts`:

```ts
export type UseEditorMutationMachineReturn = {
  state: EditorMutationState;
  dispatch: Dispatch<EditorMutationEvent>;
  /** Synchronous probe (render-mirrored ref). `lock !== null`. */
  isLocked: () => boolean;
  /** Synchronous probe (render-mirrored ref). Mirrors machine.busy; the hard
   * re-entrancy guard lives in useEditorMutation's inFlightRef. */
  isBusy: () => boolean;
  /** Synchronous full-state read (render-mirrored ref). */
  getState: () => EditorMutationState;
};

export function useEditorMutationMachine(): UseEditorMutationMachineReturn {
  const [state, dispatch] = useReducer(editorMutationReducer, INITIAL_EDITOR_MUTATION_STATE);

  // Mirror state to a ref DURING render (house style — matches
  // editorLockedMessageRef / useProjectEditor) so synchronous gates read the
  // current value without waiting for an effect commit.
  const stateRef = useRef(state);
  // eslint-disable-next-line react-hooks/refs
  stateRef.current = state;

  const isLocked = useCallback(() => stateRef.current.lock !== null, []);
  const isBusy = useCallback(() => stateRef.current.busy, []);
  const getState = useCallback(() => stateRef.current, []);

  return useMemo(
    () => ({ state, dispatch, isLocked, isBusy, getState }),
    [state, isLocked, isBusy, getState],
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w packages/client -- useEditorMutationMachine`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/hooks/useEditorMutationMachine.ts packages/client/src/hooks/__tests__/useEditorMutationMachine.test.tsx
git commit -m "feat(4b.5): useEditorMutationMachine hook with render-mirrored stateRef"
```

## Task A3: Add `committed_but_unreloaded` to `MutationResult` (additive)

**Files:**
- Modify: `packages/client/src/hooks/useEditorMutation.ts:7,24-34`
- Test: `packages/client/src/hooks/useEditorMutation.test.tsx`

- [ ] **Step 1: Write the failing type/behavior test**

Add to `useEditorMutation.test.tsx` (near the existing reload-stage test):

```tsx
it("exposes committed_but_unreloaded as a distinct stage carrying data", () => {
  // Compile-time + runtime: a result of this shape is assignable and narrows.
  const r: MutationResult<{ n: number }> = {
    ok: false,
    stage: "committed_but_unreloaded",
    data: { n: 3 },
  };
  expect(r.ok).toBe(false);
  if (!r.ok && r.stage === "committed_but_unreloaded") {
    expect(r.data.n).toBe(3);
  }
});
```

(Ensure `MutationResult` is imported in the test file's import block.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w packages/client -- useEditorMutation`
Expected: FAIL — type error / `stage:"committed_but_unreloaded"` not assignable.

- [ ] **Step 3: Add the stage additively (keep `stage:"reload"`)**

In `useEditorMutation.ts`, line 7:

```ts
export type MutationStage = "flush" | "mutate" | "reload" | "committed_but_unreloaded" | "busy";
```

In the `MutationResult` union (lines 24-34), add the new variant alongside the retained `reload`:

```ts
export type MutationResult<T = void> =
  | { ok: true; data: T }
  // reload: retained through PR A so unmigrated consumers still typecheck;
  // removed in PR B once snapshot/find-replace controllers migrate.
  | { ok: false; stage: "reload"; data: T }
  // committed_but_unreloaded: server-side mutation committed but the client
  // cannot confirm what is on screen (follow-up GET failed, or race-only
  // supersession). Same data-carrying, error-less shape as reload — callers
  // render their own strings.ts banner via applyReloadFailedLock.
  | { ok: false; stage: "committed_but_unreloaded"; data: T }
  | { ok: false; stage: "flush" | "mutate"; error: unknown }
  | { ok: false; stage: "busy" };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w packages/client -- useEditorMutation`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/hooks/useEditorMutation.ts packages/client/src/hooks/useEditorMutation.test.tsx
git commit -m "feat(4b.5): add committed_but_unreloaded MutationResult stage (additive)"
```

## Task A4: `useEditorMutation` — accept `dispatch`, drop `isLocked`, emit machine events

This task rewires the hook to drive the machine. **Preserve byte-for-byte:** the `inFlightRef` re-entrancy latch (lines 75/79/132), the synchronous entry `cancelPendingSaves` + `setEditable(false)` (lines 146/159), the post-mutate re-lock (line 214) and S5 late-lock (line 331), all routed through `safeSetEditable`. **Change:** the `finally`'s imperative `setEditable(true)` becomes a terminal `dispatch`; the hook emits the former `stage:"reload"` returns as `stage:"committed_but_unreloaded"`; add a `MUTATION_STARTED` dispatch at entry; the `isLocked` arg and `isLockedRef` are deleted.

**Files:**
- Modify: `packages/client/src/hooks/useEditorMutation.ts`
- Test: `packages/client/src/hooks/useEditorMutation.test.tsx`

- [ ] **Step 1: Write the failing test (machine wiring)**

Add to `useEditorMutation.test.tsx`. Build a fake dispatch and assert the event sequence on the happy path and the committed path. (Reuse the existing `buildHandles`/`editorRef` harness; only the new `dispatch` arg and event assertions are new.)

```tsx
it("dispatches MUTATION_STARTED then MUTATION_SETTLED_OK on a no-reload happy path", async () => {
  const events: EditorMutationEvent[] = [];
  const dispatch = (e: EditorMutationEvent) => events.push(e);
  const { result } = renderHook(() =>
    useEditorMutation({ editorRef, projectEditor, dispatch }),
  );
  const res = await result.current.run(async () => ({
    clearCacheFor: [],
    reloadActiveChapter: false,
    data: undefined,
  }));
  expect(res).toEqual({ ok: true, data: undefined });
  expect(events.map((e) => e.type)).toEqual(["MUTATION_STARTED", "MUTATION_SETTLED_OK"]);
});

it("on reload-GET failure: returns committed_but_unreloaded and dispatches NO re-enable", async () => {
  const events: EditorMutationEvent[] = [];
  const dispatch = (e: EditorMutationEvent) => events.push(e);
  projectEditor.reloadActiveChapter = vi.fn(async () => "failed" as const);
  const { result } = renderHook(() =>
    useEditorMutation({ editorRef, projectEditor, dispatch }),
  );
  const res = await result.current.run(async () => ({
    clearCacheFor: ["c1"],
    reloadActiveChapter: true,
    reloadChapterId: "c1",
    data: { x: 1 },
  }));
  expect(res).toEqual({ ok: false, stage: "committed_but_unreloaded", data: { x: 1 } });
  // hook leaves editable:false (no terminal re-enable); consumer raises the banner.
  expect(events.map((e) => e.type)).toEqual(["MUTATION_STARTED"]);
});

it("re-entrancy: a second run() while busy returns stage:busy and dispatches nothing", async () => {
  const events: EditorMutationEvent[] = [];
  const dispatch = (e: EditorMutationEvent) => events.push(e);
  const { result } = renderHook(() =>
    useEditorMutation({ editorRef, projectEditor, dispatch }),
  );
  let release!: () => void;
  const first = result.current.run(
    () => new Promise((r) => (release = () => r({ clearCacheFor: [], reloadActiveChapter: false, data: undefined }))),
  );
  const second = await result.current.run(async () => ({
    clearCacheFor: [],
    reloadActiveChapter: false,
    data: undefined,
  }));
  expect(second).toEqual({ ok: false, stage: "busy" });
  release();
  await first;
});
```

(Import `EditorMutationEvent` from `useEditorMutationMachine`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w packages/client -- useEditorMutation`
Expected: FAIL — `dispatch` not in args / events not emitted.

- [ ] **Step 3: Rewire the hook**

In `useEditorMutation.ts`:

(a) Imports — add the event type:

```ts
import type { EditorMutationEvent } from "./useEditorMutationMachine";
import { safeSetEditable } from "../utils/editorSafeOps";
```

(b) `UseEditorMutationArgs` — replace the `isLocked` field with `dispatch`:

```ts
export type UseEditorMutationArgs = {
  editorRef: MutableRefObject<EditorHandle | null>;
  projectEditor: Pick<
    UseProjectEditorReturn,
    "cancelPendingSaves" | "reloadActiveChapter" | "getActiveChapter"
  >;
  /** Editor-state machine dispatch (EditorPage owns the machine). The hook
   * emits MUTATION_STARTED at entry and one terminal event on settle
   * (MUTATION_SETTLED_OK / _SUPERSEDED / RELOADED). On the committed path it
   * dispatches NO terminal event — the consumer raises COMMITTED_UNRELOADED
   * with its own strings.ts copy via applyReloadFailedLock. */
  dispatch: Dispatch<EditorMutationEvent>;
};
```

Add `Dispatch` to the React import on line 1:

```ts
import { useRef, useCallback, useMemo, type Dispatch, type MutableRefObject } from "react";
```

(c) Delete `isLockedRef` (lines 72-73). Keep `inFlightRef` (line 75).

(d) At entry inside the `try` (around lines 131-132), add the dispatch immediately after setting `inFlightRef`, and route the entry `setEditable(false)` through `safeSetEditable`:

```ts
        inFlightRef.current = true;
        args.dispatch({ type: "MUTATION_STARTED" });
```
Replace line 159 `editor?.setEditable(false);` (inside its existing try/catch) with:
```ts
          safeSetEditable(args.editorRef, false);
```
(The existing `try { ... } catch { return stage:"flush" }` wrapper stays; `safeSetEditable` already absorbs throws and returns false, so the catch becomes belt-and-suspenders — keep it to preserve the `stage:"flush"` contract if a future `safeSetEditable` throws.)

(e) The post-mutate re-lock (line 214) and S5 late-lock (line 331): replace `editorAfterMutate.setEditable(false)` and `lateMounted.setEditable(false)` with `safeSetEditable(args.editorRef, false)`. Leave the surrounding `markClean()` / `cancelPendingSaves()` and the catch logic unchanged (they still promote to the committed stage — see (f)).

(f) Every `return { ok: false, stage: "reload", data: ... }` (lines 298-302, 307-311, 354-359, 390-394, 398-402) becomes:

```ts
                return { ok: false, stage: "committed_but_unreloaded", data: directive.data };
```

Keep the `reloadFailed = true;` assignments preceding them (they still gate the `finally` away from re-enabling).

(g) Replace the entire `finally` block re-enable logic (lines 490-557) with: keep `inFlightRef.current = false;`, delete the `lockedByCaller` predicate try/catch and the imperative `editorForUnlock?.setEditable(true)`, and dispatch the terminal event from the run-local flags:

```ts
      } finally {
        // Release the synchronous re-entrancy latch FIRST (order matters: a
        // throw must not leave the latch set for the session).
        inFlightRef.current = false;
        // Terminal machine event. The committed path (reloadFailed) dispatches
        // NOTHING here: editable stays false (from MUTATION_STARTED) and the
        // consumer raises COMMITTED_UNRELOADED with its own banner copy. The
        // re-enable is now machine intent reconciled by EditorPage's effect —
        // no imperative setEditable(true) here (Decided Q3).
        if (reloadFailed) {
          // no-op: consumer owns COMMITTED_UNRELOADED
        } else if (reloadSucceeded) {
          args.dispatch({ type: "RELOADED" });
        } else if (reloadSuperseded) {
          args.dispatch({ type: "MUTATION_SETTLED_SUPERSEDED" });
        } else {
          // happy ok:true, or flush/mutate failure: re-enable unless locked
          // (the reducer applies editable:(lock===null)).
          args.dispatch({ type: "MUTATION_SETTLED_OK" });
        }
      }
```

(h) `isBusy` (line 563) stays reading `inFlightRef`. Remove `isLockedRef` usages. The `run` `useCallback` dep array (line 560) stays `[args.editorRef]` (dispatch and projectEditorRef are refs/stable; `args.dispatch` from `useReducer` is stable, but include it for lint: `[args.editorRef, args.dispatch]`).

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w packages/client -- useEditorMutation`
Expected: PASS for the new wiring tests. (Existing tests that assert `editorRef.setEditable` re-enable counts will be re-pointed in Task A6 — if any fail now on the re-enable assertion, leave them red and fix in A6; do NOT weaken them here. If that is disruptive, reorder A6 before this step's full green.)

- [ ] **Step 4b: REFACTOR**

With tests green, clean up what the rewrite touched:
- The five former `stage:"reload"` return sites now all return `{ ok: false, stage: "committed_but_unreloaded", data: directive.data }` — verify they are textually identical and consider a single local `const committed = { ok: false, stage: "committed_but_unreloaded", data: directive.data } as const;` if it reads clearer than five literals (only if it does not obscure the surrounding catch logic).
- Confirm no dead `isLocked` / `isLockedRef` remnants survive: `git grep -n "isLocked" packages/client/src/hooks/useEditorMutation.ts` should return nothing.
- Confirm the entry/post-mutate/S5 lock-downs all route through `safeSetEditable` (no bare `.setEditable(false)` left in the file): `git grep -n "\.setEditable(" packages/client/src/hooks/useEditorMutation.ts` should return nothing.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/hooks/useEditorMutation.ts packages/client/src/hooks/useEditorMutation.test.tsx
git commit -m "feat(4b.5): useEditorMutation drives the state machine via dispatch"
```

## Task A5: `EditorPage` — instantiate the machine, sync-effect, re-point gates

**Files:**
- Modify: `packages/client/src/pages/EditorPage.tsx` (lines 51, 81, 147, 158-164, 176-201, 213-218, 309-314, 446-448)

- [ ] **Step 1: Write/extend the failing EditorPage test**

In the EditorPage test suite (`packages/client/src/pages/__tests__/EditorPage.test.tsx` or the nearest existing render test), add an assertion that a restore-reload-failure leaves the editor read-only **and** shows the banner, driven through the machine (no `editorLockedMessage` state). If a focused integration test does not exist yet, this assertion is added as part of Task B-tests; for A5, rely on the existing EditorPage render tests passing unchanged (the machine wiring must be behavior-preserving).

- [ ] **Step 2: Run the existing EditorPage tests (baseline)**

Run: `npm test -w packages/client -- EditorPage`
Expected: PASS (record the baseline before editing).

- [ ] **Step 3: Wire the machine**

(a) Near the other hook calls (above `useEditorMutation`), instantiate the machine:

```tsx
import { useEditorMutationMachine } from "../hooks/useEditorMutationMachine";
// ...
const editorMachine = useEditorMutationMachine();
```

(b) **Delete** the `editorLockedMessage` `useState` (line 147) and the `editorLockedMessageRef` mirror (lines 158-164).

(c) `handleSaveLockGated` (line 178): `editorLockedMessageRef.current !== null` → `editorMachine.isLocked()`.

(d) `useEditorMutation` call (lines 187-201): drop `isLocked`, add `dispatch`:

```tsx
const mutation = useEditorMutation({
  editorRef,
  projectEditor: { cancelPendingSaves, reloadActiveChapter, getActiveChapter },
  dispatch: editorMachine.dispatch,
});
```

(e) `isActionBusy` (line 213) stays `mutation.isBusy() || actionBusyRef.current` (synchronous probe via inFlightRef — unchanged).

(f) `isEditorLocked` (line 218): `() => editorMachine.isLocked()`.

(g) `applyReloadFailedLock` (lines 309-314) — body becomes a dispatch:

```tsx
const applyReloadFailedLock = useCallback(
  (bannerMessage: string) => {
    // COMMITTED_UNRELOADED sets the banner AND editable:false in one machine
    // transition — the invariant pair can no longer drift. The reconcile
    // effect pushes editable:false into TipTap; the lock-down setEditable(false)
    // already ran synchronously inside useEditorMutation for the mutation path,
    // and for the terminal-save-error path (useProjectEditor.onRequestEditorLock)
    // the effect applies it.
    editorMachine.dispatch({ type: "COMMITTED_UNRELOADED", message: bannerMessage });
  },
  [editorMachine],
);
```

(The `applyReloadFailedLockRef` indirection at line 51/81/323 stays — `onRequestEditorLock` still routes terminal save errors here.)

(h) **Replace** the line-448 clear-effect with the `EDITOR_REMOUNTED` dispatch + the `editable` reconcile effect:

```tsx
import { safeSetEditable } from "../utils/editorSafeOps";
// ...
// Remount (chapter switch or chapterReloadKey bump) clears the lock and
// re-asserts editable — replaces the old setEditorLockedMessage(null) effect.
useEffect(() => {
  editorMachine.dispatch({ type: "EDITOR_REMOUNTED" });
}, [activeChapter?.id, chapterReloadKey, editorMachine.dispatch]);

// Reconcile editable intent → TipTap (re-enable / re-assert direction only;
// the lock-down false is synchronous-imperative in useEditorMutation). Reuses
// safeSetEditable so a mid-remount throw is absorbed + logged once.
useEffect(() => {
  safeSetEditable(editorRef, editorMachine.state.editable);
}, [editorMachine.state.editable, activeChapter?.id, chapterReloadKey]);
```

(i) The banner render: wherever `editorLockedMessage` was read for the JSX banner, read `editorMachine.state.lock?.message ?? null`.

(j) **Re-point every remaining lock gate.** Deleting `editorLockedMessageRef` (step b) breaks *all* its readers, not just the two named above. Replace **each** `editorLockedMessageRef.current !== null` site with `editorMachine.isLocked()`. Per the pushback verification there are 10 readers in total: `handleSaveLockGated` (~178, done in c), `isEditorLocked` (~218, done in f), plus the eight at approximately lines 505 (`handleStatusChangeWithError`), 528 (`handleRenameChapterWithError`), 553 (`handleReorderChaptersGuarded`), 582 (`switchToView`), 674 (`handleCreateChapterGuarded`), 695 (`requestDeleteChapter`), 712 (`openTrashGuarded`), and 853 (the `flushSave` keyboard shortcut). Line numbers will drift as edits land — find them by content, not line.

- [ ] **Step 4: Run to verify behavior is preserved + no dangling ref**

Run: `git grep -n "editorLockedMessageRef\|editorLockedMessage\b" packages/client/src`
Expected: **no matches** (the state, the ref, and every reader are gone). A surviving match is an unmigrated gate — fix before proceeding.

Run: `npm test -w packages/client -- EditorPage`
Expected: PASS (same as baseline). Then `npm test -w packages/client` for the whole client.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/pages/EditorPage.tsx
git commit -m "feat(4b.5): EditorPage owns the editor-mutation machine + reconcile effect"
```

## Task A6: Re-point existing `useEditorMutation` tests to machine state

**Files:**
- Modify: `packages/client/src/hooks/useEditorMutation.test.tsx`

- [ ] **Step 1: Identify the re-enable assertions**

Run: `grep -n "setEditable).toHaveBeenCalled\|setEditable).toHaveBeenLastCalled\|toHaveBeenCalledTimes" packages/client/src/hooks/useEditorMutation.test.tsx`
These are the spots that count `editorRef.setEditable(true)` calls — the hook no longer makes the imperative re-enable call (it dispatches).

- [ ] **Step 2: Re-point each to the dispatched event**

For each test that asserted a trailing `setEditable(true)`, assert instead that the captured `events` ended with `MUTATION_SETTLED_OK` (or `RELOADED` / `MUTATION_SETTLED_SUPERSEDED` as appropriate), and — where the test verifies the user-visible effect — feed the events through `editorMutationReducer` from `INITIAL_EDITOR_MUTATION_STATE` and assert the resulting `editable`. Keep all lock-down `setEditable(false)` assertions: those calls still happen via `safeSetEditable`.

Example transform:

```tsx
// BEFORE
expect(editorRef.current!.setEditable).toHaveBeenLastCalledWith(true);
// AFTER
const final = events.reduce(editorMutationReducer, INITIAL_EDITOR_MUTATION_STATE);
expect(final.editable).toBe(true);
expect(events.at(-1)?.type).toBe("MUTATION_SETTLED_OK");
```

- [ ] **Step 3: Run to verify the whole hook suite passes**

Run: `npm test -w packages/client -- useEditorMutation`
Expected: PASS, zero warnings.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/hooks/useEditorMutation.test.tsx
git commit -m "test(4b.5): assert useEditorMutation via machine events, not setEditable spy"
```

## Task A7: One-commit-tick window + re-entrancy regression tests

**Files:**
- Modify: `packages/client/src/hooks/useEditorMutation.test.tsx`

- [ ] **Step 1: Write the window + latch tests**

```tsx
it("blocks input synchronously: setEditable(false) runs before the first await", async () => {
  const order: string[] = [];
  editorRef.current = buildHandles({
    setEditable: (v: boolean) => order.push(`setEditable(${v})`),
    flushSave: async () => {
      order.push("flushSave");
      return true;
    },
  });
  const { result } = renderHook(() =>
    useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }),
  );
  await result.current.run(async () => ({ clearCacheFor: [], reloadActiveChapter: false, data: undefined }));
  // The lock-down setEditable(false) precedes flushSave (the first await),
  // proving TipTap input is blocked before any yield (Decided Q3).
  expect(order.indexOf("setEditable(false)")).toBeLessThan(order.indexOf("flushSave"));
});
```

(The re-entrancy `stage:"busy"` test from A4 already proves the latch; if it lives elsewhere, leave it.)

- [ ] **Step 2: Run to verify**

Run: `npm test -w packages/client -- useEditorMutation`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/hooks/useEditorMutation.test.tsx
git commit -m "test(4b.5): synchronous lock-down + re-entrancy latch regression"
```

---

# PR B — Consumer migration + remove `stage:"reload"`

PR B migrates the two controllers onto `committed_but_unreloaded` with an exhaustive `: never` default, then deletes `stage:"reload"`. Each step keeps the suite green.

## Task B1: `useSnapshotController` — migrate the reload branch + exhaustive default

**Files:**
- Modify: `packages/client/src/hooks/useSnapshotController.ts` (lines 217-243; the mutate/possiblyCommitted branch at 244-322 is unchanged — it already routes through `applyReloadFailedLock`)
- Test: `packages/client/src/hooks/__tests__/useSnapshotController.test.tsx`

- [ ] **Step 1: Write the failing test**

Add a test asserting that a restore whose hook result is `stage:"committed_but_unreloaded"` calls `applyReloadFailedLock(STRINGS.snapshots.restoreSucceededReloadFailed)`, clears the cache, and refreshes the count — identical to today's `stage:"reload"` behavior.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w packages/client -- useSnapshotController`
Expected: FAIL — controller still keys on `"reload"`.

- [ ] **Step 3: Rename the branch + add exhaustive default**

At line 217, change `if (result.stage === "reload")` to `if (result.stage === "committed_but_unreloaded")`. Leave the body verbatim (it already calls `applyReloadFailedLock`, which is now a dispatch). After the final `// stage === "mutate"` block, add:

```ts
      // Exhaustive guard: every MutationResult failure stage is handled above.
      // A future stage forces a compile error here until handled.
      else {
        const _exhaustive: never = result;
        void _exhaustive;
      }
```

(Adjust to the file's actual control-flow shape — the existing branches are sequential `if (...) return;` guards, so the `: never` assignment goes after the last `return`, asserting the union is exhausted. If the branches all `return`, place `const _exhaustive: never = result;` as the final statement of the handler.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w packages/client -- useSnapshotController`
Expected: PASS.

- [ ] **Step 4b: REFACTOR**

- Confirm the `: never` default is the *only* new control flow added — the existing `reload`-branch body moved verbatim (no logic change, just the stage name).
- `git grep -n '"reload"' packages/client/src/hooks/useSnapshotController.ts` should return nothing.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/hooks/useSnapshotController.ts packages/client/src/hooks/__tests__/useSnapshotController.test.tsx
git commit -m "feat(4b.5): snapshot controller handles committed_but_unreloaded exhaustively"
```

## Task B2: `useFindReplaceController` — migrate both reload branches + exhaustive default

**Files:**
- Modify: `packages/client/src/hooks/useFindReplaceController.ts` (lines 286-294 and 542-550; the `finalizeReplaceSuccess` body is unchanged)
- Test: `packages/client/src/hooks/__tests__/useFindReplaceController.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add tests for both `executeReplace` and `handleReplaceOne`: a hook result of `stage:"committed_but_unreloaded"` calls `finalizeReplaceSuccess({ reloadFailed: true, ... })` exactly as the old `"reload"` path did (lock banner for the non-stale case, dismissible error for the stale case).

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w packages/client -- useFindReplaceController`
Expected: FAIL.

- [ ] **Step 3: Rename both branches + add exhaustive defaults**

At lines 286 and 542, change `if (result.stage === "reload")` to `if (result.stage === "committed_but_unreloaded")`. Leave the `finalizeReplaceSuccess({ reloadFailed: true, ... })` calls verbatim. Add the `const _exhaustive: never = result;` final-statement guard to both `executeReplace` and `handleReplaceOne` stage handlers (same pattern as B1).

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w packages/client -- useFindReplaceController`
Expected: PASS.

- [ ] **Step 4b: REFACTOR**

- Both `executeReplace` and `handleReplaceOne` got the same rename + `: never` default — confirm the two handlers stay structurally parallel (a divergence here is a bug, per the file's existing symmetry).
- The `finalizeReplaceSuccess` call shape (`{ reloadFailed: true, ... }`) is unchanged at both sites — verify no accidental edit slipped in.
- `git grep -n '"reload"' packages/client/src/hooks/useFindReplaceController.ts` should return nothing.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/hooks/useFindReplaceController.ts packages/client/src/hooks/__tests__/useFindReplaceController.test.tsx
git commit -m "feat(4b.5): find-replace controller handles committed_but_unreloaded exhaustively"
```

## Task B3: Remove `stage:"reload"` from the union (subtractive)

**Files:**
- Modify: `packages/client/src/hooks/useEditorMutation.ts:7,24-34`

- [ ] **Step 1: Delete the stage**

Remove `"reload"` from `MutationStage` (line 7) and delete the `| { ok: false; stage: "reload"; data: T }` variant from `MutationResult`. Update the comment to note `committed_but_unreloaded` subsumes it.

- [ ] **Step 2: Run the full typecheck + client suite**

Run: `npm test -w packages/client && npm run typecheck -w packages/client` (or `make cover`)
Expected: PASS — no consumer references `"reload"` (B1/B2 migrated them; the `: never` defaults prove exhaustiveness).

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/hooks/useEditorMutation.ts
git commit -m "refactor(4b.5): remove subsumed stage:\"reload\" from MutationResult"
```

## Task B4: The three Critical regression tests

These assert the editor stays **read-only AND the lock banner stays visible** for each 2026-04-20 Critical. Place them at the integration level where the machine + consumer + reconcile-effect run together (EditorPage render test, or a controller+machine harness).

**Files:**
- Modify: `packages/client/src/hooks/__tests__/useSnapshotController.test.tsx`, `useFindReplaceController.test.tsx`, and/or `pages/__tests__/EditorPage.test.tsx`

- [ ] **Step 1: Write the three tests**

1. **Stale-`expectedChapterId` skip (race-only branch):** now-active chapter ∈ `clearCacheFor` and the second reload fails → result `committed_but_unreloaded` → `applyReloadFailedLock` → machine `lock !== null` and `editable === false`. A plain supersession (chapter not affected, or second reload succeeds) → `ok:true` / `MUTATION_SETTLED_SUPERSEDED` → `editable === true`, `lock === null`.
2. **2xx `BAD_JSON` on project-wide replace:** the `possiblyCommitted` branch in `executeReplace` → `finalizeReplaceSuccess({ reloadFailed: true })` (non-stale) → `applyReloadFailedLock` → machine locked + read-only.
3. **2xx `BAD_JSON` on snapshot restore:** the `possiblyCommitted` branch in the restore handler → `applyReloadFailedLock(message)` → machine locked + read-only.

Each asserts both `editorMachine.state.lock` is non-null and the reconciled TipTap `editable` is `false` (assert via the reconcile effect's `safeSetEditable` spy receiving `false` and never a subsequent `true`).

- [ ] **Step 2: Run to verify**

Run: `npm test -w packages/client`
Expected: PASS, zero warnings (spy on `clientWarn` where error paths log; assert + restore).

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/hooks/__tests__/ packages/client/src/pages/__tests__/
git commit -m "test(4b.5): three Critical regressions — read-only + banner across machine"
```

## Task B5: Hybrid-supersession tests

**Files:**
- Modify: `packages/client/src/hooks/useEditorMutation.test.tsx`

- [ ] **Step 1: Write the two cases** (these test the hook in isolation against a fake dispatch)

```tsx
it("race-only supersession (active ∈ clearCacheFor, 2nd reload fails) → committed_but_unreloaded", async () => {
  projectEditor.getActiveChapter = vi.fn(() => ({ id: "c2" }) as never);
  projectEditor.reloadActiveChapter = vi
    .fn()
    .mockResolvedValueOnce("superseded")
    .mockResolvedValueOnce("failed");
  const events: EditorMutationEvent[] = [];
  const { result } = renderHook(() =>
    useEditorMutation({ editorRef, projectEditor, dispatch: (e) => events.push(e) }),
  );
  const res = await result.current.run(async () => ({
    clearCacheFor: ["c2"],
    reloadActiveChapter: true,
    reloadChapterId: "c1",
    data: { n: 1 },
  }));
  expect(res).toEqual({ ok: false, stage: "committed_but_unreloaded", data: { n: 1 } });
  expect(events.map((e) => e.type)).toEqual(["MUTATION_STARTED"]); // no terminal re-enable
});

it("plain supersession (active ∉ clearCacheFor) → benign ok:true, editor re-enabled", async () => {
  projectEditor.getActiveChapter = vi.fn(() => ({ id: "other" }) as never);
  projectEditor.reloadActiveChapter = vi.fn(async () => "superseded" as const);
  const events: EditorMutationEvent[] = [];
  const { result } = renderHook(() =>
    useEditorMutation({ editorRef, projectEditor, dispatch: (e) => events.push(e) }),
  );
  const res = await result.current.run(async () => ({
    clearCacheFor: ["c2"],
    reloadActiveChapter: true,
    reloadChapterId: "c1",
    data: { n: 1 },
  }));
  expect(res).toEqual({ ok: true, data: { n: 1 } });
  expect(events.at(-1)?.type).toBe("MUTATION_SETTLED_SUPERSEDED");
});
```

- [ ] **Step 2: Run to verify**

Run: `npm test -w packages/client -- useEditorMutation`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/hooks/useEditorMutation.test.tsx
git commit -m "test(4b.5): hybrid supersession — race-only locks, plain stays benign"
```

## Task B6: Full-suite gate + coverage

**Files:** none (verification only)

- [ ] **Step 1: Run lint + typecheck + coverage**

Run: `make cover`
Expected: PASS; coverage at or above the floors (95% statements, 85% branches, 90% functions, 95% lines). The new reducer is exhaustively unit-tested; verify the `UNLOCK` and `default` branches are covered (the reducer test hits every event).

- [ ] **Step 2: Run e2e (save-failure recovery paths)**

Run: `make e2e`
Expected: PASS — the snapshot-restore and find-replace save-failure recovery e2e flows still raise the persistent banner and keep the editor read-only.

- [ ] **Step 3: Commit (if any lint/format fixups)**

```bash
git add -A && git commit -m "chore(4b.5): lint/format fixups"
```

## Task B7: CLAUDE.md — record the machine as the source-of-truth

**Files:**
- Modify: `CLAUDE.md` (§Key Architecture Decisions, immediately after the `useEditorMutation` paragraph at line 137)

- [ ] **Step 1: Insert the paragraph** (exact text confirmed in the design doc's §CLAUDE.md impact)

Add the "Editor operational state lives in one machine." paragraph after the existing `useEditorMutation` paragraph. It names `useEditorMutationMachine` as owner of `{ editable, locked, busy }`, lists the events, bans free-standing `editorLockedMessage`/`reloadFailed`/`reloadSucceeded` refs/state, notes the two synchronous-imperative transitions (lock-down `setEditable(false)` + `inFlightRef` latch), and documents `committed_but_unreloaded` as the canonical "server committed, display unconfirmed" outcome.

- [ ] **Step 2: Verify no other CLAUDE.md section drifted**

Confirm §API Design, §Data Model, §Testing Philosophy, §Target Project Structure, §Pull Request Scope need no change (per the design's CLAUDE.md-review).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(4b.5): CLAUDE.md — editor operational state lives in one machine"
```

---

## Self-review notes

- **Spec coverage:** machine (A1/A2) ↔ design Component 1; reconcile effect (A5) ↔ Component 2; `committed_but_unreloaded` + hook wiring (A3/A4) ↔ Component 3; consumer migration (B1/B2) ↔ Component 4; `chapterReloadKey`/`EDITOR_REMOUNTED` (A5) ↔ Component 5; PR split (A/B) ↔ design PR-scope; the three Criticals (B4), reducer tests (A1), window test (A7), hybrid-supersession (B5), re-pointed existing tests (A6), clientWarn-spy discipline (B4/B6) ↔ design Testing §1-6; CLAUDE.md (B7) ↔ design CLAUDE.md impact.
- **Decided Q3 (hybrid):** preserved by keeping `inFlightRef` (A4 finally) and the synchronous lock-down `safeSetEditable(false)` (A4 entry/re-lock), with only the re-enable moved to the effect (A5).
- **Ratified by alignment (2026-05-29):** the three "Design clarifications encoded by this plan" (COMMITTED_UNRELOADED dispatched by consumers via `applyReloadFailedLock`; 2xx-BAD_JSON classified consumer-side via `mapApiError`; `busy`/`inFlightRef` duality) were ratified and folded back into the design doc (Component 1 event table, Component 3, Decided Q1). `UNLOCK` is kept as a reserved, unit-tested event with no production dispatcher.
