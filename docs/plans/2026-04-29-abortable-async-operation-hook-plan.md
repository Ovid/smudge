# Phase 4b.3a.1 — Abortable Async Operation Hook (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `useAbortableAsyncOperation` — a small client-side hook that encapsulates the "abort prior controller, fresh controller, signal-thread, abort-on-unmount" pattern — plus its unit tests, plus one CLAUDE.md paragraph documenting it. Zero consumer migrations.

**Architecture:** New file `packages/client/src/hooks/useAbortableAsyncOperation.ts` parallel to `useAbortableSequence.ts`. Returns a `useMemo`-stable object with `useCallback`-stable methods. StrictMode-aware via a `mountedRef` reset pattern that mirrors `useAbortableSequence`. Unit tests in `useAbortableAsyncOperation.test.ts` use Vitest + `@testing-library/react`'s `renderHook` + a `<StrictMode>` wrapper, mirroring `useAbortableSequence.test.ts`.

**Tech Stack:** TypeScript, React 18+, Vitest, `@testing-library/react`.

**Source-of-truth references:**
- Design: `docs/plans/2026-04-29-abortable-async-operation-hook-design.md` — behavioural-contract bullets in §"Behavioural contract"; implementation in §"Implementation sketch"; CLAUDE.md text in §"CLAUDE.md addition".
- Convention: `packages/client/src/hooks/useAbortableSequence.ts` (StrictMode-aware mountedRef, useMemo-stable return) and `useAbortableSequence.test.ts` (test shape).
- Generic syntax: `packages/client/src/hooks/useEditorMutation.ts` uses `<T>` (no trailing comma) inside `useCallback` in a `.ts` file — match this.

**Out of plan scope (do NOT execute):**
- The roadmap restructure (R1–R5 in the design) — already on the branch as commit `e5736e8`.
- Any consumer migration (those land in 4b.3a.2/3/4 as separate PRs).
- ESLint enforcement of the hand-rolled-AbortController pattern (deferred).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/client/src/hooks/useAbortableAsyncOperation.ts` | Create | Hook implementation + `AbortableAsyncOperation` type export |
| `packages/client/src/hooks/useAbortableAsyncOperation.test.ts` | Create | Unit tests pinning the 9 behavioural-contract bullets + zero-warnings + multi-instance independence |
| `CLAUDE.md` | Modify (one paragraph append in §Save-pipeline invariants rule 4 at line 130) | Document the new hook alongside `useAbortableSequence` |

Two commits expected:
1. Hook + test file (full TDD cycle inside this commit).
2. CLAUDE.md paragraph addition.

---

## Task 1: Build the hook with red-green-refactor TDD

**Files:**
- Create: `packages/client/src/hooks/useAbortableAsyncOperation.ts`
- Create: `packages/client/src/hooks/useAbortableAsyncOperation.test.ts`

This task runs TDD red-green-refactor cycles for each behavioural-contract bullet. Steps within a cycle: write failing test → run to confirm red → implement minimum to make green → run to confirm green. The hook is small enough that we run all cycles before the single commit at the end.

### Step 1 — Read companion files for convention

- [ ] Read `packages/client/src/hooks/useAbortableSequence.ts` (~70 lines) for the StrictMode `mountedRef` pattern, `useCallback` + `useMemo` discipline, and inline-comment style.
- [ ] Read `packages/client/src/hooks/useAbortableSequence.test.ts` (~175 lines) for the test shape, `<StrictMode>` wrapper, multi-instance test, and zero-console-output test.
- [ ] Read `packages/client/src/hooks/useEditorMutation.ts` lines 76–80 only — to confirm the `<T>` (no trailing comma) generic syntax convention for `useCallback` in `.ts` files.

### Step 2 — Write the first failing test (contract bullet 1: abort-prior on rerun)

- [ ] Create `packages/client/src/hooks/useAbortableAsyncOperation.test.ts` with the imports and the first test:

```ts
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAbortableAsyncOperation } from "./useAbortableAsyncOperation";

describe("useAbortableAsyncOperation", () => {
  it("run() aborts the prior controller before creating a fresh one", () => {
    const { result } = renderHook(() => useAbortableAsyncOperation());
    const first = result.current.run((s) => new Promise<void>(() => { void s; }));
    const second = result.current.run((s) => new Promise<void>(() => { void s; }));
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
  });
});
```

### Step 3 — Run; expect red because the module does not exist

- [ ] Run: `npm test -w packages/client -- useAbortableAsyncOperation.test.ts`
- [ ] Expected: test FAILS with `Cannot find module './useAbortableAsyncOperation'` (or equivalent module-resolution error).

### Step 4 — Implement minimum to make the first test pass

- [ ] Create `packages/client/src/hooks/useAbortableAsyncOperation.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef } from "react";

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

export function useAbortableAsyncOperation(): AbortableAsyncOperation {
  const ref = useRef<AbortController | null>(null);

  const run = useCallback(<T>(fn: (signal: AbortSignal) => Promise<T>) => {
    ref.current?.abort();
    const controller = new AbortController();
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

### Step 5 — Run; expect green

- [ ] Run: `npm test -w packages/client -- useAbortableAsyncOperation.test.ts`
- [ ] Expected: test PASSES.

### Step 6 — Add test for contract bullet 2 (returned signal identity)

- [ ] Append to the test file inside the `describe(...)` block:

```ts
  it("run() returns the same AbortSignal that fn() receives", () => {
    const { result } = renderHook(() => useAbortableAsyncOperation());
    let received: AbortSignal | null = null;
    const { signal } = result.current.run((s) => {
      received = s;
      return Promise.resolve();
    });
    expect(received).toBe(signal);
  });
```

### Step 7 — Run; expect green (already covered by minimum impl)

- [ ] Run: `npm test -w packages/client -- useAbortableAsyncOperation.test.ts`
- [ ] Expected: PASS. The implementation already returns `controller.signal` for both `signal` and the `fn` argument.

### Step 8 — Add test for contract bullet 3 (explicit abort)

- [ ] Append:

```ts
  it("abort() aborts the currently-tracked controller", () => {
    const { result } = renderHook(() => useAbortableAsyncOperation());
    const { signal } = result.current.run((s) => new Promise<void>(() => { void s; }));
    result.current.abort();
    expect(signal.aborted).toBe(true);
  });

  it("a run() after abort() returns a fresh non-aborted signal", () => {
    const { result } = renderHook(() => useAbortableAsyncOperation());
    result.current.run((s) => new Promise<void>(() => { void s; }));
    result.current.abort();
    const next = result.current.run((s) => { void s; return Promise.resolve(); });
    expect(next.signal.aborted).toBe(false);
  });
```

### Step 9 — Run; expect green

- [ ] Run: `npm test -w packages/client -- useAbortableAsyncOperation.test.ts`
- [ ] Expected: both tests PASS. The minimum impl already includes `abort()`.

### Step 10 — Add test for contract bullet 7 (idempotent abort)

- [ ] Append:

```ts
  it("abort() on an empty hook (no in-flight controller) is a no-op and does not throw", () => {
    const { result } = renderHook(() => useAbortableAsyncOperation());
    expect(() => result.current.abort()).not.toThrow();
  });
```

### Step 11 — Run; expect green

- [ ] Run: `npm test -w packages/client -- useAbortableAsyncOperation.test.ts`
- [ ] Expected: PASS. `ref.current?.abort()` is a no-op when `ref.current` is null.

### Step 12 — Add test for contract bullet 4 (unmount aborts)

- [ ] Append:

```ts
  it("unmount aborts the in-flight controller", () => {
    const { result, unmount } = renderHook(() => useAbortableAsyncOperation());
    const { signal } = result.current.run((s) => new Promise<void>(() => { void s; }));
    unmount();
    expect(signal.aborted).toBe(true);
  });
```

### Step 13 — Run; expect red

- [ ] Run: `npm test -w packages/client -- useAbortableAsyncOperation.test.ts`
- [ ] Expected: this test FAILS — the implementation has no cleanup effect, so unmount does not abort.

### Step 14 — Add the unmount cleanup effect

- [ ] Modify `useAbortableAsyncOperation.ts` — insert the `useEffect` after the `ref` declaration:

```ts
export function useAbortableAsyncOperation(): AbortableAsyncOperation {
  const ref = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      ref.current?.abort();
      ref.current = null;
    };
  }, []);

  const run = useCallback(<T>(fn: (signal: AbortSignal) => Promise<T>) => {
    // (unchanged)
    ref.current?.abort();
    const controller = new AbortController();
    ref.current = controller;
    return { promise: fn(controller.signal), signal: controller.signal };
  }, []);

  // ... rest unchanged
}
```

### Step 15 — Run; expect green

- [ ] Run: `npm test -w packages/client -- useAbortableAsyncOperation.test.ts`
- [ ] Expected: all tests PASS, including the unmount-aborts test.

### Step 16 — Add test for contract bullet 5 (post-unmount run pre-aborts)

- [ ] Append:

```ts
  it("run() called after unmount returns a pre-aborted signal", () => {
    const { result, unmount } = renderHook(() => useAbortableAsyncOperation());
    unmount();
    const { signal } = result.current.run((s) => { void s; return Promise.resolve(); });
    expect(signal.aborted).toBe(true);
  });
```

### Step 17 — Run; expect red

- [ ] Run: `npm test -w packages/client -- useAbortableAsyncOperation.test.ts`
- [ ] Expected: FAILS — the post-unmount `run()` creates a fresh non-aborted controller because there is no `mountedRef` gate.

### Step 18 — Add `mountedRef` and the gate inside `run()`

- [ ] Modify `useAbortableAsyncOperation.ts`:

```ts
export function useAbortableAsyncOperation(): AbortableAsyncOperation {
  const ref = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      ref.current?.abort();
      ref.current = null;
    };
  }, []);

  const run = useCallback(<T>(fn: (signal: AbortSignal) => Promise<T>) => {
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

### Step 19 — Run; expect green

- [ ] Run: `npm test -w packages/client -- useAbortableAsyncOperation.test.ts`
- [ ] Expected: all tests PASS.

### Step 20 — Add test for contract bullet 9 (StrictMode double-mount survives)

- [ ] Append:

```ts
  it("survives React StrictMode's mount→cleanup→mount double-effect", async () => {
    // React 18 StrictMode runs useEffect twice in development: mount,
    // cleanup, mount. A naive cleanup-only `mountedRef = false` would
    // flip the flag on the first cleanup and never revive it, silently
    // breaking every consumer because every subsequent run() returns a
    // pre-aborted signal in dev. Pin that re-mount restores the mounted
    // flag so StrictMode dev builds behave like prod.
    const React = await import("react");
    const { result } = renderHook(() => useAbortableAsyncOperation(), {
      wrapper: ({ children }) => React.createElement(React.StrictMode, null, children),
    });
    const { signal } = result.current.run((s) => { void s; return Promise.resolve(); });
    expect(signal.aborted).toBe(false);
  });
```

### Step 21 — Run; expect red

- [ ] Run: `npm test -w packages/client -- useAbortableAsyncOperation.test.ts`
- [ ] Expected: FAILS. The cleanup effect sets `mountedRef.current = false` on the first cleanup; the second mount does not re-set it; subsequent `run()` calls produce a pre-aborted signal.

### Step 22 — Add the StrictMode-safe mountedRef reset on each mount

- [ ] Modify `useAbortableAsyncOperation.ts` — extend the `useEffect` body to reset `mountedRef.current` on each mount:

```ts
  useEffect(() => {
    // React 18 StrictMode runs mount/cleanup/mount in development. Reset
    // mountedRef on each mount so the second mount revives the post-
    // cleanup false. Without it, every subsequent run() returns a pre-
    // aborted signal in dev. Mirrors useAbortableSequence's StrictMode
    // discipline.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      ref.current?.abort();
      ref.current = null;
    };
  }, []);
```

### Step 23 — Run; expect green

- [ ] Run: `npm test -w packages/client -- useAbortableAsyncOperation.test.ts`
- [ ] Expected: all tests PASS, including the StrictMode test.

### Step 24 — Add test for contract bullet 6 (stable returned object across renders)

- [ ] Append:

```ts
  it("returns a stable AbortableAsyncOperation object across renders", () => {
    const { result, rerender } = renderHook(() => useAbortableAsyncOperation());
    const first = result.current;
    rerender();
    const second = result.current;
    expect(second).toBe(first);
    expect(second.run).toBe(first.run);
    expect(second.abort).toBe(first.abort);
  });
```

### Step 25 — Run; expect green

- [ ] Run: `npm test -w packages/client -- useAbortableAsyncOperation.test.ts`
- [ ] Expected: PASS. The returned object is already wrapped in `useMemo`; `run`/`abort` are `useCallback`-stable.

### Step 26 — Add test for contract bullet 8 (concurrent run discipline) and multi-instance independence

The "concurrent run" bullet is already covered by the abort-prior test (Step 2) — back-to-back `run()` calls abort the prior controller. Add the explicit multi-instance test that proves two hook instances in the same component are independent (this is the test the migration phases will rely on, since `useTrashManager` and `ImageGallery` use 2 instances each).

- [ ] Append:

```ts
  it("two instances in the same component are independent", () => {
    const { result } = renderHook(() => ({
      a: useAbortableAsyncOperation(),
      b: useAbortableAsyncOperation(),
    }));
    const aRun = result.current.a.run((s) => new Promise<void>(() => { void s; }));
    const bRun = result.current.b.run((s) => new Promise<void>(() => { void s; }));
    act(() => {
      result.current.a.abort();
    });
    expect(aRun.signal.aborted).toBe(true);
    expect(bRun.signal.aborted).toBe(false);
  });
```

### Step 27 — Run; expect green

- [ ] Run: `npm test -w packages/client -- useAbortableAsyncOperation.test.ts`
- [ ] Expected: PASS. Each `useAbortableAsyncOperation` call gets its own `ref`, so the two instances are naturally independent.

### Step 28 — Add the no-console-output test

The hook does not log. CLAUDE.md `§Testing Philosophy` requires zero test warnings. Pin this with an explicit assertion so a future refactor that introduces a `console.warn`/`console.error` path is caught at this hook's tests, not just at suite-level zero-warnings enforcement.

- [ ] Append:

```ts
  // Pins design §Test strategy: the hook never logs. Without an explicit
  // assertion, a future refactor could introduce a warn/error path that
  // the suite-level zero-warnings rule would catch but not attribute to
  // this primitive specifically.
  it("emits no console output during any operation", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, unmount } = renderHook(() => useAbortableAsyncOperation());
    result.current.run((s) => { void s; return Promise.resolve(); });
    result.current.run((s) => { void s; return Promise.resolve(); });
    result.current.abort();
    unmount();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
```

### Step 29 — Run; expect green

- [ ] Run: `npm test -w packages/client -- useAbortableAsyncOperation.test.ts`
- [ ] Expected: PASS.

### Step 30 — Refactor pass: confirm the implementation file matches the design's "Implementation sketch" exactly

The implementation should now be substantively identical to the design's `§Implementation sketch` (lines 71–116 of the design doc). Diff it mentally:

- [ ] Compare your `useAbortableAsyncOperation.ts` body against the design's implementation sketch. Differences should only be:
  - Comment wording (acceptable to be slightly tighter or expanded inline).
  - Minor stylistic preferences within the same logic shape.
- [ ] If anything substantive differs, fix it now to match the design.

### Step 31 — Final test-suite check (whole hooks directory)

- [ ] Run: `npm test -w packages/client -- packages/client/src/hooks/`
- [ ] Expected: all hook tests PASS, including the new file. No console warnings or errors in stderr.

### Step 32 — Coverage check on the new file

- [ ] Run: `make cover`  *(from `/workspace`; full suite with coverage enforcement, per CLAUDE.md `§Build & Run Commands`)*
- [ ] Inspect the coverage report and confirm `packages/client/src/hooks/useAbortableAsyncOperation.ts` reads 100/100/100/100 (statements/branches/functions/lines). The hook is small enough that anything less indicates an unexercised path; investigate any miss before continuing.
- [ ] If the coverage table flags any other regression in client coverage, that's a separate problem — flag it but do not let it block this PR (the new hook itself should still be at 100%).

### Step 33 — Commit the hook + tests

- [ ] Stage and commit:

```bash
git add packages/client/src/hooks/useAbortableAsyncOperation.ts \
        packages/client/src/hooks/useAbortableAsyncOperation.test.ts
git commit -m "$(cat <<'EOF'
hooks(client): add useAbortableAsyncOperation primitive (4b.3a.1)

New client-side hook encoding the "abort prior controller, fresh
controller, signal-thread, abort-on-unmount" pattern. Companion to
useAbortableSequence: the two are orthogonal — that one arbitrates
response staleness via epoch tokens; this one cancels network
requests via AbortController. Both can apply to one operation.

API:
  run<T>(fn: (signal: AbortSignal) => Promise<T>):
    { promise: Promise<T>; signal: AbortSignal }
  abort(): void

The returned object is useMemo-stable; run/abort are useCallback-
stable. mountedRef pattern mirrors useAbortableSequence so
StrictMode mount→cleanup→mount in dev does not poison subsequent
run() calls.

Hook ships unused; consumer migrations in useTrashManager,
useFindReplaceState, ImageGallery follow in 4b.3a.2/3/4.

See docs/plans/2026-04-29-abortable-async-operation-hook-design.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add the CLAUDE.md paragraph documenting the new hook

**Files:**
- Modify: `CLAUDE.md` (line 130 area — `§Save-pipeline invariants` rule 4)

### Step 1 — Locate the existing rule 4 closing line

- [ ] Open `CLAUDE.md` and find rule 4 in the `§Save-pipeline invariants` section. The rule is a single bolded numbered item starting `4. **Bump the sequence ref before the request, not after.**` and ending `Hand-rolled \`useRef<number>\` sequence counters are rejected by ESLint.` (line 130 today).

### Step 2 — Append the new paragraph as a continuation of rule 4

The new paragraph belongs inside the rule-4 list item (so it stays attached to the "abort/sequence-cancellation" topic). In Markdown, a paragraph inside a numbered list item is indented with 3 spaces (matching the list-item content indent).

- [ ] Edit `CLAUDE.md` to extend rule 4. The exact transformation:

**Before** (line 130):

```markdown
4. **Bump the sequence ref before the request, not after.** Any in-flight response for an older sequence is discarded on return. Bumping after creates a window where stale responses land. Use `useAbortableSequence` (`packages/client/src/hooks/useAbortableSequence.ts`): `start()` bumps and returns a token, `capture()` snapshots the current epoch for cross-axis checks, `abort()` invalidates outstanding tokens, and component unmount auto-aborts. Hand-rolled `useRef<number>` sequence counters are rejected by ESLint.
```

**After:**

```markdown
4. **Bump the sequence ref before the request, not after.** Any in-flight response for an older sequence is discarded on return. Bumping after creates a window where stale responses land. Use `useAbortableSequence` (`packages/client/src/hooks/useAbortableSequence.ts`): `start()` bumps and returns a token, `capture()` snapshots the current epoch for cross-axis checks, `abort()` invalidates outstanding tokens, and component unmount auto-aborts. Hand-rolled `useRef<number>` sequence counters are rejected by ESLint.

   For network-cancellation (as distinct from response-staleness), route through `useAbortableAsyncOperation` (`packages/client/src/hooks/useAbortableAsyncOperation.ts`): `run<T>(fn)` aborts the prior controller and returns `{ promise, signal }` per call (use the per-call `signal` for "did this operation abort" gates after the await — there is deliberately no hook-level `aborted` getter), `abort()` cancels the currently-tracked controller for explicit external-cancellation flows that aren't paired with starting a new operation (panel-close, project-id change), and component unmount auto-aborts. The two hooks are orthogonal: `useAbortableSequence` arbitrates response staleness via epoch tokens; `useAbortableAsyncOperation` cancels network requests via `AbortController`. Both can apply to one operation — `useFindReplaceState.search` pairs them to get both guarantees. Hand-rolled `useRef<AbortController>` allocations at consumer call sites are reviewed against this hook (lint enforcement deferred).
```

The new paragraph is indented with **three spaces** (` ` × 3) at the start so it stays inside the numbered list item. The blank line between the existing closing line and the new paragraph is required for Markdown to render them as separate paragraphs.

### Step 3 — Verify formatting

- [ ] Run: `git diff CLAUDE.md` and confirm:
  - Only line 130's area has changes.
  - The new paragraph starts with three spaces of indentation.
  - There is one blank line between the existing rule 4 line and the new paragraph.
  - The next numbered item (`5.`) is unaffected and still rendered as part of the list.

### Step 4 — Commit the CLAUDE.md addition

- [ ] Stage and commit:

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
CLAUDE.md: document useAbortableAsyncOperation in §Save-pipeline rule 4

Extends rule 4 with a parallel paragraph for network-cancellation,
mirroring how the rule already documents useAbortableSequence for
response-staleness. The two hooks are orthogonal; both can apply to
one operation (useFindReplaceState.search pairs them).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Final verification — `make all` green

**Files:** none (verification only)

### Step 1 — Run the full CI gate

- [ ] Run: `make all`  *(lint + format + typecheck + coverage + e2e per CLAUDE.md §Build & Run Commands)*
- [ ] Expected: PASS. Specifically:
  - Lint clean.
  - Format clean (or formatter applies and the next run is clean).
  - TypeScript compiles with no errors.
  - Coverage thresholds met (95/85/90/95 floor; the new hook should be at 100%).
  - E2e suite unchanged (this PR does not touch any e2e-tested code path).

### Step 2 — Inspect for unexpected warnings in test output

- [ ] Run: `make test 2>&1 | grep -i 'warn\|error' | head -20`  *(skim — should be empty or only test-name strings, never actual `console.warn`/`console.error` output)*
- [ ] Expected: zero unexpected warnings. The "no console output" test (Task 1, Step 28) pins this for the new hook specifically.

### Step 3 — Check git log shape before opening PR

- [ ] Run: `git log --oneline main..HEAD`
- [ ] Expected commits on the branch (in order, from oldest):
  1. `0c15b0b docs/plans: 4b.3a.1 — abortable async operation hook design`
  2. `e5736e8 roadmap: split 4b.3a.1 into hook PR + 4b.3a.2/3/4 migration PRs`
  3. `35dea77 design(4b.3a.1): pushback resolutions — drop AbortableRun, annotate DoD`
  4. `<hash> hooks(client): add useAbortableAsyncOperation primitive (4b.3a.1)`
  5. `<hash> CLAUDE.md: document useAbortableAsyncOperation in §Save-pipeline rule 4`
- [ ] Confirm: no stray commits, no unrelated changes.

### Step 4 — Phase 4b.3a.1 is PR-ready

- [ ] All Definition-of-Done bullets from the design satisfied:
  - ✅ `packages/client/src/hooks/useAbortableAsyncOperation.ts` created with the documented API.
  - ✅ `packages/client/src/hooks/useAbortableAsyncOperation.test.ts` covers all 9 behavioural-contract bullets plus stability + zero-warnings + multi-instance.
  - ✅ `CLAUDE.md` `§Save-pipeline invariants` rule 4 extended.
  - ✅ `docs/roadmap.md` restructured (already on branch; no work in this plan).
  - ✅ Plan comment for the design (already on branch; no work in this plan).
  - ✅ Zero consumer migrations.
  - ✅ `make all` green.
  - ✅ Coverage on the new hook ≥ thresholds.
  - ✅ Zero test warnings.

PR title suggestion: `hooks(client): add useAbortableAsyncOperation primitive (Phase 4b.3a.1)`.

PR body should cite:
- Roadmap phase: `docs/roadmap.md#phase-4b3a1-abortable-async-operation-hook` (or the line/anchor).
- Design doc: `docs/plans/2026-04-29-abortable-async-operation-hook-design.md`.
- This plan: `docs/plans/2026-04-29-abortable-async-operation-hook-plan.md`.
- One-line summary that 4b.3a.2/3/4 are the follow-up migration PRs.

---

## Self-Review Checklist (executed by the plan author before handing off)

**1. Spec coverage** — every design requirement is traced to at least one task step:

| Design requirement | Task / Step |
|---|---|
| Hook file with public `AbortableAsyncOperation` type | Task 1 Step 4 (initial), Step 22 (final) |
| `run<T>(fn)` returns `{ promise, signal }` per call | Task 1 Step 4 |
| `abort()` cancels currently-tracked controller | Task 1 Step 4 |
| Auto-abort on unmount | Task 1 Step 14 |
| `mountedRef` post-unmount gate | Task 1 Step 18 |
| StrictMode mount-reset | Task 1 Step 22 |
| `useMemo`-stable returned object, `useCallback`-stable methods | Task 1 Step 4 |
| Test for abort-prior on rerun (bullet 1) | Task 1 Step 2 |
| Test for returned signal identity (bullet 2) | Task 1 Step 6 |
| Test for explicit abort (bullet 3) | Task 1 Step 8 |
| Test for unmount aborts (bullet 4) | Task 1 Step 12 |
| Test for post-unmount run pre-aborts (bullet 5) | Task 1 Step 16 |
| Test for stable returned object (bullet 6) | Task 1 Step 24 |
| Test for idempotent abort (bullet 7) | Task 1 Step 10 |
| Test for concurrent run discipline (bullet 8) | Task 1 Step 2 (covered) + Step 26 (multi-instance) |
| Test for StrictMode double-mount (bullet 9) | Task 1 Step 20 |
| No-console-output test | Task 1 Step 28 |
| CLAUDE.md `§Save-pipeline invariants` rule 4 paragraph | Task 2 |
| Coverage at or above thresholds | Task 1 Step 32 + Task 3 Step 1 |
| `make all` green | Task 3 Step 1 |
| No consumer migrations | Confirmed at Task 3 Step 4 |
| Roadmap restructure | Out of plan (already on branch) |

**2. Placeholder scan** — searched for "TBD", "TODO", "implement later", "appropriate error handling", "similar to". None present.

**3. Type consistency** — `AbortableAsyncOperation` type, `run<T>` signature, `abort(): void` are consistent across the design, the implementation steps, and the tests. No drift.

**4. No bundling** — Two commits: hook + tests (Task 1) and CLAUDE.md paragraph (Task 2). No feature creep.
