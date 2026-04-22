# Abortable Sequence Hook Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace every ad-hoc `useRef<number>(0)` sequence counter in `packages/client/src/` with a single tested primitive (`useAbortableSequence`), codify the "discard stale response" contract at the type level, and add ESLint enforcement preventing reintroduction.

**Architecture:** A single hook owns a monotonic counter and hands out tokens via `start()` (bumps + returns token), `capture()` (reads current epoch without bumping, for cross-axis checks), and `abort()` (bumps without returning a token, for cancellation). Tokens expose `isStale()` — comparison against the internal counter. Auto-abort on unmount closes the "forgot to bump on unmount" foot-gun that produced past data-loss bugs. The returned object is stable across renders so consumers can wire it into `useCallback`/`useEffect` dependency arrays without provoking churn.

**Tech Stack:** React 18, TypeScript (strict), Vitest + @testing-library/react, ESLint 9 flat config (`eslint.config.js`).

**Design source:** `docs/plans/2026-04-22-abortable-sequence-hook-design.md`

**Deviation from design §PR scope & sequencing:** The design lists the ESLint rule as step 2, before the migrations. If the rule is added to the main config while existing seq-refs remain in four files, `make lint` fails on every intermediate commit. This plan reorders the rule to **Task 7** (after migrations complete), so every commit keeps `make lint` green. The rule's fixture test is still wired programmatically, and the DoD is unchanged.

**Reference conventions in this plan:**
- `L.N` = file path line N (e.g. `useProjectEditor.ts:L.212` = line 212 of that file).
- Each commit runs `make test` (fast, no coverage) before commit unless otherwise noted. Final commits additionally run `make cover` per DoD.
- "Red" in TDD terms for a pure refactor = a test that asserts the post-migration structural property (e.g. "hook imports `useAbortableSequence`" or "direct seq-ref regex returns 0 matches in this file"). Existing behavioral tests stay green throughout — they're the safety net, not the Red step.

---

## Task 1: Create the `useAbortableSequence` hook

**Files:**
- Create: `packages/client/src/hooks/useAbortableSequence.ts`
- Create: `packages/client/src/hooks/useAbortableSequence.test.ts`

### Step 1.1: Write the failing test file with all 9 contract tests

Create `packages/client/src/hooks/useAbortableSequence.test.ts` with this content:

```ts
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAbortableSequence } from "./useAbortableSequence";

describe("useAbortableSequence", () => {
  it("a fresh start() token is not stale", () => {
    const { result } = renderHook(() => useAbortableSequence());
    const token = result.current.start();
    expect(token.isStale()).toBe(false);
  });

  it("start() invalidates the previous start() token", () => {
    const { result } = renderHook(() => useAbortableSequence());
    const first = result.current.start();
    const second = result.current.start();
    expect(first.isStale()).toBe(true);
    expect(second.isStale()).toBe(false);
  });

  it("capture() does NOT invalidate prior tokens", () => {
    const { result } = renderHook(() => useAbortableSequence());
    const started = result.current.start();
    const captured = result.current.capture();
    expect(started.isStale()).toBe(false);
    expect(captured.isStale()).toBe(false);
  });

  it("abort() invalidates all outstanding tokens (start- and capture-issued)", () => {
    const { result } = renderHook(() => useAbortableSequence());
    const started = result.current.start();
    const captured = result.current.capture();
    result.current.abort();
    expect(started.isStale()).toBe(true);
    expect(captured.isStale()).toBe(true);
  });

  it("capture() called after abort() is fresh", () => {
    const { result } = renderHook(() => useAbortableSequence());
    result.current.abort();
    const token = result.current.capture();
    expect(token.isStale()).toBe(false);
  });

  it("capture() called after start() is fresh (tracks current epoch)", () => {
    const { result } = renderHook(() => useAbortableSequence());
    result.current.start();
    const token = result.current.capture();
    expect(token.isStale()).toBe(false);
  });

  it("unmount invalidates all outstanding tokens", () => {
    const { result, unmount } = renderHook(() => useAbortableSequence());
    const started = result.current.start();
    const captured = result.current.capture();
    unmount();
    expect(started.isStale()).toBe(true);
    expect(captured.isStale()).toBe(true);
  });

  it("two sequences in the same component are independent", () => {
    const { result } = renderHook(() => ({
      a: useAbortableSequence(),
      b: useAbortableSequence(),
    }));
    const aToken = result.current.a.start();
    const bToken = result.current.b.start();
    act(() => {
      result.current.a.abort();
    });
    expect(aToken.isStale()).toBe(true);
    expect(bToken.isStale()).toBe(false);
  });

  it("returns a stable AbortableSequence object across renders", () => {
    const { result, rerender } = renderHook(() => useAbortableSequence());
    const firstRender = result.current;
    rerender();
    const secondRender = result.current;
    expect(secondRender).toBe(firstRender);
    expect(secondRender.start).toBe(firstRender.start);
    expect(secondRender.capture).toBe(firstRender.capture);
    expect(secondRender.abort).toBe(firstRender.abort);
  });

  // Pins design §Testing strategy: "The hook must not log anything; its
  // operations are infallible pure-function-level primitives. No
  // console.warn/console.error paths." Without an explicit assertion,
  // a future refactor could introduce a warn/error path that the global
  // zero-warnings rule would catch at suite level but not attribute to
  // this primitive specifically.
  it("emits no console output during any operation", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, unmount } = renderHook(() => useAbortableSequence());
    const t1 = result.current.start();
    const t2 = result.current.capture();
    result.current.abort();
    t1.isStale();
    t2.isStale();
    unmount();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
```

### Step 1.2: Run tests to verify they fail

```
npx vitest run packages/client/src/hooks/useAbortableSequence.test.ts
```

Expected: FAIL with "Cannot find module './useAbortableSequence'" (all 10 tests fail to load).

### Step 1.3: Write the minimal hook implementation

Create `packages/client/src/hooks/useAbortableSequence.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef } from "react";

export type SequenceToken = {
  isStale(): boolean;
};

export type AbortableSequence = {
  start(): SequenceToken;
  capture(): SequenceToken;
  abort(): void;
};

export function useAbortableSequence(): AbortableSequence {
  const counterRef = useRef(0);

  const makeToken = (epoch: number): SequenceToken => ({
    isStale: () => counterRef.current !== epoch,
  });

  const start = useCallback((): SequenceToken => {
    counterRef.current += 1;
    return makeToken(counterRef.current);
  }, []);

  const capture = useCallback((): SequenceToken => {
    return makeToken(counterRef.current);
  }, []);

  const abort = useCallback((): void => {
    counterRef.current += 1;
  }, []);

  useEffect(() => {
    return () => {
      counterRef.current += 1;
    };
  }, []);

  return useMemo(() => ({ start, capture, abort }), [start, capture, abort]);
}
```

### Step 1.4: Run tests to verify all 10 pass

```
npx vitest run packages/client/src/hooks/useAbortableSequence.test.ts
```

Expected: PASS (10 tests — 9 staleness-contract + 1 no-console-output).

### Step 1.5: Run lint & typecheck

```
make lint
make typecheck
```

Expected: PASS.

### Step 1.6: Commit

```bash
git add packages/client/src/hooks/useAbortableSequence.ts packages/client/src/hooks/useAbortableSequence.test.ts
git commit -m "feat(client): add useAbortableSequence primitive

Introduces a typed primitive for the 'discard stale response' contract:
start() bumps and returns a token, capture() snapshots the current
epoch without bumping (for cross-axis checks), abort() invalidates
outstanding tokens. Auto-abort on unmount. Returned object is stable
across renders.

Part of Phase 4b.2 (see docs/plans/2026-04-22-abortable-sequence-hook-design.md)."
```

---

## Task 2: Migrate `useFindReplaceState` (simplest, single-axis)

**Files:**
- Modify: `packages/client/src/hooks/useFindReplaceState.ts`
- Verify: `packages/client/src/__tests__/useFindReplaceState.test.ts` (no changes expected to test content)

### Step 2.1: Write a structural Red test

Add one new test to `useFindReplaceState.test.ts` that asserts the migration's structural property. At the top of the file, alongside existing imports, add:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
```

Then add one describe block:

```ts
describe("useFindReplaceState migration structural check", () => {
  it("no longer uses raw seq-ref patterns", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../hooks/useFindReplaceState.ts", import.meta.url)),
      "utf-8",
    );
    expect(source).not.toMatch(/searchSeqRef/);
    expect(source).toMatch(/useAbortableSequence/);
  });
});
```

### Step 2.2: Run the new test to verify it fails

```
npx vitest run packages/client/src/__tests__/useFindReplaceState.test.ts -t "migration structural check"
```

Expected: FAIL (file still contains `searchSeqRef`, does not contain `useAbortableSequence`).

### Step 2.3: Perform the migration

Edit `packages/client/src/hooks/useFindReplaceState.ts`:

1. Add import at the top alongside existing React imports:
   ```ts
   import { useAbortableSequence } from "./useAbortableSequence";
   ```

2. Replace `const searchSeqRef = useRef(0);` with:
   ```ts
   const searchSeq = useAbortableSequence();
   ```

3. Inside the `useEffect(() => { ... }, [projectId])` block (around `L.126`):
   - Replace `searchSeqRef.current++;` with `searchSeq.abort();`
   - Preserve the surrounding `setLoading(false)`, `searchAbortRef.current?.abort()` etc. (non-seq-ref work).

4. Inside `closePanel` (around `L.165`):
   - Replace `searchSeqRef.current++;` with `searchSeq.abort();`

5. Inside `search` (around `L.189`):
   - Replace `const seq = ++searchSeqRef.current;` with `const token = searchSeq.start();`

6. Inside the try-block (around `L.218`):
   - Replace `if (seq !== searchSeqRef.current) return;` with `if (token.isStale()) return;`

7. Inside the catch-block (around `L.223`):
   - Replace `if (seq !== searchSeqRef.current) return;` with `if (token.isStale()) return;`

8. Inside the finally-block (around `L.257`):
   - Replace `if (seq === searchSeqRef.current) { setLoading(false); }` with `if (!token.isStale()) { setLoading(false); }`

9. Remove the comment at `L.119` referencing `searchSeqRef` if it became stale.

### Step 2.4: Run the full test file to verify all tests pass

```
npx vitest run packages/client/src/__tests__/useFindReplaceState.test.ts
```

Expected: PASS (including the new structural test and all preexisting behavioral tests). **Specifically verify** the project-change reset regression test at `useFindReplaceState.test.ts:L.645` (the test whose pre-fix version stuck the spinner when `searchSeqRef` was bumped without clearing `loading`) — it must pass without any change to its assertions, since the new primitive preserves the same observable behavior.

### Step 2.5: Run lint & typecheck

```
make lint
make typecheck
```

Expected: PASS.

### Step 2.6: Verify grep shows no remaining seq-refs in this file

```
grep -n "searchSeqRef" packages/client/src/hooks/useFindReplaceState.ts
```

Expected: no output.

### Step 2.7: Commit

```bash
git add packages/client/src/hooks/useFindReplaceState.ts packages/client/src/__tests__/useFindReplaceState.test.ts
git commit -m "refactor(client): useFindReplaceState uses useAbortableSequence

Replaces searchSeqRef with useAbortableSequence(). start() for new
searches, abort() for project-change reset and closePanel, token.isStale()
for the two result-write guards and the finally-clause loading reset.

No behavior change. Part of Phase 4b.2."
```

---

## Task 3: Migrate `SnapshotPanel` (component-level, single-axis)

**Files:**
- Modify: `packages/client/src/components/SnapshotPanel.tsx`
- Verify: `packages/client/src/__tests__/SnapshotPanel.test.tsx` (no semantic changes)

### Step 3.1: Write a structural Red test

Add to `packages/client/src/__tests__/SnapshotPanel.test.tsx`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("SnapshotPanel migration structural check", () => {
  it("no longer uses raw seq-ref patterns", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../components/SnapshotPanel.tsx", import.meta.url)),
      "utf-8",
    );
    expect(source).not.toMatch(/chapterSeqRef/);
    expect(source).toMatch(/useAbortableSequence/);
  });
});
```

### Step 3.2: Run the structural test to verify it fails

```
npx vitest run packages/client/src/__tests__/SnapshotPanel.test.tsx -t "migration structural check"
```

Expected: FAIL.

### Step 3.3: Perform the migration in `SnapshotPanel.tsx`

Edit `packages/client/src/components/SnapshotPanel.tsx`:

1. Add import alongside the hooks imports at the top:
   ```ts
   import { useAbortableSequence } from "../hooks/useAbortableSequence";
   ```

2. Replace `const chapterSeqRef = useRef(0);` (around `L.109`) with:
   ```ts
   const chapterSeq = useAbortableSequence();
   ```

3. Inside `fetchSnapshots` (around `L.113`):
   - Replace `const seq = chapterSeqRef.current;` with `const token = chapterSeq.capture();`
     (Rationale: `fetchSnapshots` is the imperative refresh path — it should depend on the current epoch, not bump it. The `chapterId` useEffect below is what bumps.)
   - Replace `if (seq !== chapterSeqRef.current) return;` (both places — try and catch) with `if (token.isStale()) return;`

4. Inside the `useEffect(() => { ... }, [isOpen, chapterId, onSnapshotsChange])` block (around `L.135`):
   - Replace `chapterSeqRef.current++;` with `chapterSeq.abort();` — bump on every chapter/open change to invalidate the prior chapter's in-flight list response.
   - Replace `const seq = chapterSeqRef.current;` (after the abort) with `const token = chapterSeq.capture();`
   - Replace the two `if (seq !== chapterSeqRef.current) return;` checks with `if (token.isStale()) return;`

### Step 3.4: Run the full test file to verify all tests pass

```
npx vitest run packages/client/src/__tests__/SnapshotPanel.test.tsx
```

Expected: PASS.

### Step 3.5: Run lint & typecheck

```
make lint
make typecheck
```

Expected: PASS.

### Step 3.6: Verify grep

```
grep -n "chapterSeqRef\|SeqRef" packages/client/src/components/SnapshotPanel.tsx
```

Expected: no output.

### Step 3.7: Commit

```bash
git add packages/client/src/components/SnapshotPanel.tsx packages/client/src/__tests__/SnapshotPanel.test.tsx
git commit -m "refactor(client): SnapshotPanel uses useAbortableSequence

Replaces chapterSeqRef with useAbortableSequence(). abort() on chapter/
open-state change, capture() for the imperative fetchSnapshots path and
the mount effect, token.isStale() for the post-await guards.

No behavior change. Part of Phase 4b.2."
```

---

## Task 4: Migrate `useSnapshotState` (two sequences, cross-axis)

**Files:**
- Modify: `packages/client/src/hooks/useSnapshotState.ts`
- Verify: `packages/client/src/__tests__/useSnapshotState.test.ts`

### Step 4.1: Write a structural Red test

Add to `useSnapshotState.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("useSnapshotState migration structural check", () => {
  it("no longer uses raw seq-ref patterns", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../hooks/useSnapshotState.ts", import.meta.url)),
      "utf-8",
    );
    expect(source).not.toMatch(/chapterSeqRef/);
    expect(source).not.toMatch(/viewSeqRef/);
    expect(source).toMatch(/useAbortableSequence/);
  });
});
```

### Step 4.2: Run structural test to verify it fails

```
npx vitest run packages/client/src/__tests__/useSnapshotState.test.ts -t "migration structural check"
```

Expected: FAIL.

### Step 4.3: Perform the migration in `useSnapshotState.ts`

Edit `packages/client/src/hooks/useSnapshotState.ts`:

1. Add import:
   ```ts
   import { useAbortableSequence } from "./useAbortableSequence";
   ```

2. Replace the two refs (`L.102` and `L.107`):
   ```ts
   const chapterSeq = useAbortableSequence();
   const viewSeq = useAbortableSequence();
   ```

3. Inside the `useEffect(() => { ... }, [chapterId])` block (around `L.126`):
   - Replace `const seq = ++chapterSeqRef.current;` with:
     ```ts
     chapterSeq.abort(); // invalidate the prior chapter's list response
     const token = chapterSeq.capture();
     ```
   - Replace `if (seq === chapterSeqRef.current) setSnapshotCount(data.length);` with `if (!token.isStale()) setSnapshotCount(data.length);`

4. Inside `viewSnapshot` (around `L.158`):
   - Replace `const seq = chapterSeqRef.current;` with `const cToken = chapterSeq.capture();`
   - Replace `const vseq = ++viewSeqRef.current;` with `const vToken = viewSeq.start();`
   - Replace BOTH try-block checks (`L.176`, `L.177`):
     ```ts
     if (cToken.isStale()) return { ok: true, staleChapterSwitch: true };
     if (vToken.isStale()) return { ok: true, staleChapterSwitch: true };
     ```
   - Replace BOTH catch-block checks (`L.208`, `L.209`) with the same two lines.

5. Inside `restoreSnapshot` (around `L.238`):
   - Replace `const seq = chapterSeqRef.current;` with `const token = chapterSeq.capture();`
   - Replace `const seqMoved = seq !== chapterSeqRef.current;` with `const seqMoved = token.isStale();`
   - Replace `const freshSeq = chapterSeqRef.current;` (around `L.282`) with `const freshToken = chapterSeq.capture();`
   - Replace `if (freshSeq === chapterSeqRef.current) setSnapshotCount(data.length);` with `if (!freshToken.isStale()) setSnapshotCount(data.length);`

6. Check `refreshCount` (around `L.345`) and the other remaining touchpoint: same capture-then-check-not-stale pattern.

### Step 4.4: Run the full test file

```
npx vitest run packages/client/src/__tests__/useSnapshotState.test.ts
```

Expected: PASS. **Specifically verify** the chapter-switch mid-flight regression test at `useSnapshotState.test.ts:L.293` — it asserts the `{ ok: true, staleChapterSwitch: true }` return shape on a chapter change during an in-flight snapshot fetch, and must pass without change to its assertions (the consumer contract is preserved).

### Step 4.5: Run lint & typecheck

```
make lint
make typecheck
```

Expected: PASS.

### Step 4.6: Verify grep

```
grep -n "chapterSeqRef\|viewSeqRef\|SeqRef" packages/client/src/hooks/useSnapshotState.ts
```

Expected: no output.

### Step 4.7: Commit

```bash
git add packages/client/src/hooks/useSnapshotState.ts packages/client/src/__tests__/useSnapshotState.test.ts
git commit -m "refactor(client): useSnapshotState uses useAbortableSequence

Replaces chapterSeqRef and viewSeqRef with two useAbortableSequence()
instances. Chapter axis uses abort() on chapterId change and capture()
inside viewSnapshot/restoreSnapshot; view axis uses start() per view
click. staleChapterSwitch: true consumer contract is preserved.

No behavior change. Part of Phase 4b.2."
```

---

## Task 5: Migrate `useProjectEditor` (three sequences)

**Files:**
- Modify: `packages/client/src/hooks/useProjectEditor.ts`
- Modify: `packages/client/src/__tests__/useProjectEditor.test.ts` (update the `L.1415-1460` regression test's comments/assertions)

### Step 5.1: Write a structural Red test

Add to `useProjectEditor.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("useProjectEditor migration structural check", () => {
  it("no longer uses raw seq-ref patterns", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../hooks/useProjectEditor.ts", import.meta.url)),
      "utf-8",
    );
    expect(source).not.toMatch(/selectChapterSeqRef/);
    expect(source).not.toMatch(/saveSeqRef/);
    expect(source).not.toMatch(/statusChangeSeqRef/);
    expect(source).toMatch(/useAbortableSequence/);
  });
});
```

### Step 5.2: Run structural test to verify it fails

```
npx vitest run packages/client/src/__tests__/useProjectEditor.test.ts -t "migration structural check"
```

Expected: FAIL.

### Step 5.3: Perform the migration in `useProjectEditor.ts`

Edit `packages/client/src/hooks/useProjectEditor.ts`:

1. Add import:
   ```ts
   import { useAbortableSequence } from "./useAbortableSequence";
   ```

2. Replace the three refs (`L.65`, `L.66`, `L.77`):
   ```ts
   const selectChapterSeq = useAbortableSequence();
   const saveSeq = useAbortableSequence();
   const statusChangeSeq = useAbortableSequence();
   ```

3. Update `cancelInFlightSave` (around `L.85-96`) — replace `++saveSeqRef.current;` with `saveSeq.abort();`. The rest of the function (`AbortController.abort()`, backoff clear) is untouched.

4. **Delete `cancelInFlightSelect` (`L.111-113`) entirely.** Its sole job is bumping `selectChapterSeqRef`, which `useAbortableSequence`'s auto-abort on unmount now handles for the unmount case. For the non-unmount cases where it was called explicitly (search for remaining call sites), replace each call with `selectChapterSeq.abort();`.

5. **In the unmount effect (`L.122-127`):** delete the `cancelInFlightSelect();` line. Keep `cancelInFlightSave();` — it does non-seq-ref work (controller abort + backoff clear) that still has to run on unmount. Update the effect's dep array to remove `cancelInFlightSelect` (now undefined) and keep `cancelInFlightSave`. Update the comment at `L.115-121` to drop the reference to `cancelInFlightSelect`.

6. Search the rest of the file for remaining `cancelInFlightSelect()` calls (e.g. `handleDeleteChapter` around `L.520`) and replace each with `selectChapterSeq.abort();`.

7. Inside `handleSave` (around `L.186`):
   - Replace `const seq = ++saveSeqRef.current;` with `const token = saveSeq.start();`
   - Replace `if (seq !== saveSeqRef.current) return false;` (around `L.212` and `L.223`) with `if (token.isStale()) return false;`
   - Replace `seq === saveSeqRef.current` at `L.305` with `!token.isStale()` — this is the "still-fresh" negative check for the VALIDATION_ERROR cache preservation.

8. Around `L.407` (inside `handleSelectChapter`):
   - Replace `const seq = ++selectChapterSeqRef.current;` with `const token = selectChapterSeq.start();`
   - Replace `if (seq !== selectChapterSeqRef.current) return;` (both at `L.410` and `L.417`) with `if (token.isStale()) return;`

9. Around `L.459` (inside `reloadActiveChapter`):
   - Replace `const seq = ++selectChapterSeqRef.current;` with `const token = selectChapterSeq.start();`
   - Replace both `if (seq !== selectChapterSeqRef.current) return "superseded";` (at `L.462` and `L.477`) with `if (token.isStale()) return "superseded";`

10. Around `L.537` (inside `handleDeleteChapter`):
    - Replace `const seq = ++selectChapterSeqRef.current;` with `const token = selectChapterSeq.start();`
    - Replace both `if (seq !== selectChapterSeqRef.current) return true;` (at `L.540`, `L.552`) with `if (token.isStale()) return true;`

11. Around `L.646` (inside `handleStatusChange`):
    - Replace `const seq = ++statusChangeSeqRef.current;` with `const token = statusChangeSeq.start();`
    - Replace all three `if (seq !== statusChangeSeqRef.current) return;` (at `L.664`, `L.677`, `L.703`) with `if (token.isStale()) return;`

12. Update the comment at `L.345-347` referencing `bare ++saveSeqRef.current` — reword to reference `saveSeq.abort()` or remove if stale.

### Step 5.4: Update the regression test at `L.1415-1460`

Open `useProjectEditor.test.ts` and update the test "reloadActiveChapter in flight during unmount does not setState on a gone component (I5)" (around `L.1415`):

- Update the comment block (`L.1417-1422`) to reflect the new mechanism:
  ```ts
  // The save path had unmount protection via cancelInFlightSave bumping
  // saveSeq, but reloadActiveChapter was guarded only by
  // selectChapterSeq — and the unmount effect used to need an explicit
  // cancelInFlightSelect() bump. Under useAbortableSequence, each hook
  // instance auto-aborts on unmount, so a post-unmount GET resolution
  // is discarded by selectChapterSeq's isStale() check without any
  // explicit unmount-effect line. This test pins that behavior.
  ```
- The test body itself does NOT need changes — it tests observable behavior, not internals. The `unmount()` call must still produce zero `state update on unmounted` warnings.

### Step 5.5: Run the full test file

```
npx vitest run packages/client/src/__tests__/useProjectEditor.test.ts
```

Expected: PASS (including the updated regression test and the new structural test).

### Step 5.6: Run lint, typecheck, and the full unit test suite

```
make lint
make typecheck
make test
```

Expected: PASS.

### Step 5.7: Verify grep across the whole client package

```
grep -rn "SeqRef\|seqRef\|sequenceRef" packages/client/src/
```

Expected: no output.

### Step 5.8: Commit

```bash
git add packages/client/src/hooks/useProjectEditor.ts packages/client/src/__tests__/useProjectEditor.test.ts
git commit -m "refactor(client): useProjectEditor uses useAbortableSequence

Replaces selectChapterSeqRef, saveSeqRef, and statusChangeSeqRef with
three useAbortableSequence() instances. cancelInFlightSelect is deleted
(pure-bump responsibility subsumed by auto-abort-on-unmount); its
non-unmount call sites use selectChapterSeq.abort(). cancelInFlightSave
remains — its non-seq-ref work (AbortController abort, backoff clear)
still has to run on unmount.

Updates the I5 regression test comment to reflect auto-abort as the
mechanism. No behavior change.

Part of Phase 4b.2."
```

---

## Task 6: Verify coverage floors on `packages/client`

**Files:** none modified.

### Step 6.1: Run coverage

```
make cover
```

Expected: PASS — coverage thresholds 95% statements, 85% branches, 90% functions, 95% lines held or exceeded on `packages/client`.

### Step 6.2: If floors drop on any file

For any file that dropped below threshold:
- Inspect the coverage report (`coverage/index.html`) to find newly-uncovered branches.
- Write targeted tests for those branches.
- Rerun `make cover`.
- **Do NOT lower thresholds** (CLAUDE.md §Testing Philosophy).
- Commit the added tests separately:
  ```bash
  git add packages/client/src/__tests__/<file>
  git commit -m "test(client): restore coverage on <file> after 4b.2 migration"
  ```

### Step 6.3: If floors pass

Proceed to Task 7. No commit needed — no files changed.

---

## Task 7: Add the `no-restricted-syntax` ESLint rule + fixture test

**Files:**
- Modify: `eslint.config.js` (project root)
- Create: `packages/client/src/__tests__/eslintSequenceRule.test.ts`

### Step 7.1: Write the failing fixture test

Create `packages/client/src/__tests__/eslintSequenceRule.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";
import { resolve } from "node:path";

async function lint(code: string): Promise<ESLint.LintResult[]> {
  const eslint = new ESLint({
    overrideConfigFile: resolve(__dirname, "../../../../eslint.config.js"),
  });
  return eslint.lintText(code, { filePath: resolve(__dirname, "fixture.ts") });
}

describe("no-restricted-syntax sequence-ref rule", () => {
  it("rejects `seq !== xSeqRef.current` — the classic staleness pattern", async () => {
    const code = `
      import { useRef } from "react";
      export function x() {
        const ref = useRef(0);
        const seq = ++ref.current;
        if (seq !== ref.current) return;
      }
    `;
    const [result] = await lint(code);
    const msgs = result.messages.filter((m) => m.ruleId === "no-restricted-syntax");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].message).toMatch(/useAbortableSequence/);
  });

  it("rejects `seq === xSeqRef.current` — the still-fresh negative check", async () => {
    const code = `
      import { useRef } from "react";
      export function x() {
        const ref = useRef(0);
        const seq = ref.current;
        if (seq === ref.current) return;
      }
    `;
    const [result] = await lint(code);
    const msgs = result.messages.filter((m) => m.ruleId === "no-restricted-syntax");
    expect(msgs).toHaveLength(1);
  });

  it("allows `activeChapterRef.current?.id === savingChapterId` — MemberExpression on the LEFT", async () => {
    const code = `
      import { useRef } from "react";
      export function x(savingChapterId: string) {
        const ref = useRef<{ id: string } | null>(null);
        if (ref.current?.id === savingChapterId) return;
      }
    `;
    const [result] = await lint(code);
    const msgs = result.messages.filter((m) => m.ruleId === "no-restricted-syntax");
    expect(msgs).toHaveLength(0);
  });
});
```

### Step 7.2: Run the fixture test to verify it fails

```
npx vitest run packages/client/src/__tests__/eslintSequenceRule.test.ts
```

Expected: FAIL — `no-restricted-syntax` rule not yet configured to target the pattern, so the "rejects" tests find zero matching messages.

### Step 7.3: Add the rule to `eslint.config.js`

Edit `/Users/ovid/projects/smudge/eslint.config.js`. Inside the `rules` block of the object targeting `packages/client/**/*.{ts,tsx}` (the React-hooks block at `L.31-40`), add:

```js
"no-restricted-syntax": [
  "error",
  {
    // Sequence-ref staleness pattern: `local !== ref.current` or
    // `local === ref.current`. Both operators express the same
    // underlying anti-pattern (catching only `!==` leaves an obvious
    // bypass via `===`). MemberExpression on the LEFT — common
    // legitimate patterns like `activeChapterRef.current?.id === id`
    // — does not match this selector. Use useAbortableSequence instead.
    // esquery attribute-matching: a BinaryExpression whose operator is
    // either !== or ===, whose left is an Identifier, and whose right
    // is a MemberExpression ending in `.current`. Using attribute paths
    // (`left.type`, `right.type`, `right.property.name`) rather than
    // child/sibling combinators because BinaryExpression's left/right
    // are named fields, not positional siblings.
    selector:
      "BinaryExpression[operator=/^[!=]==$/][left.type='Identifier'][right.type='MemberExpression'][right.property.name='current']",
    message:
      "Sequence-ref staleness check detected. Use useAbortableSequence (packages/client/src/hooks/useAbortableSequence.ts): start() bumps and returns a token, capture() reads current epoch, abort() invalidates outstanding tokens, and unmount auto-aborts.",
  },
],
```

### Step 7.4: Run the fixture test to verify it passes

```
npx vitest run packages/client/src/__tests__/eslintSequenceRule.test.ts
```

Expected: PASS (all 3 fixture tests).

### Step 7.5: Run `make lint` across the whole repo

```
make lint
```

Expected: PASS — no violations because all seq-refs were migrated in Tasks 2–5.

### Step 7.6: Run the full test suite once more

```
make test
```

Expected: PASS.

### Step 7.6a: Document the escape hatch

Per design §ESLint enforcement, the rule supports `// eslint-disable-next-line no-restricted-syntax -- <reason>` for legitimate exceptions. No exceptions are expected — every existing use case is migrated to `useAbortableSequence` in Tasks 2–5 — but if a reviewer encounters a future disable-comment without a reason, or with a weak reason (e.g. "unrelated"), push back. The reason string is load-bearing: it's how we prevent the rule from quietly degrading into noise over time. No code change is needed in this step; this is an instruction to future reviewers, codified in the PR description and reinforced by the rule's error message.

### Step 7.7: Commit

```bash
git add eslint.config.js packages/client/src/__tests__/eslintSequenceRule.test.ts
git commit -m "chore(lint): reject raw sequence-ref staleness patterns

Adds a no-restricted-syntax rule to eslint.config.js flagging
'local !== ref.current' and 'local === ref.current' with a message
pointing at useAbortableSequence. A fixture test (run via the ESLint
programmatic API in Vitest) pins both the positive and false-positive
cases so the rule cannot silently regress.

Part of Phase 4b.2."
```

---

## Task 8: Update CLAUDE.md §Save-Pipeline Invariants

**Files:**
- Modify: `CLAUDE.md` (project root)

### Step 8.1: Edit rule 4

Open `CLAUDE.md` and locate the numbered invariant list under §Save-Pipeline Invariants. Replace the text of rule 4:

**Current:**
```
4. **Bump the sequence ref before the request, not after.** Any in-flight response for an older sequence is discarded on return. Bumping after creates a window where stale responses land.
```

**New:**
```
4. **Bump the sequence ref before the request, not after.** Any in-flight response for an older sequence is discarded on return. Bumping after creates a window where stale responses land. Use `useAbortableSequence` (`packages/client/src/hooks/useAbortableSequence.ts`): `start()` bumps and returns a token, `capture()` snapshots the current epoch for cross-axis checks, `abort()` invalidates outstanding tokens, and component unmount auto-aborts. Hand-rolled `useRef<number>` sequence counters are rejected by ESLint.
```

### Step 8.2: Edit the closing paragraph

Locate the paragraph in §Save-Pipeline Invariants that references `useEditorMutation`:

**Current:**
```
For mutation-via-server flows (snapshot restore, project-wide replace, and future similar operations), route through `useEditorMutation` in `packages/client/src/hooks/useEditorMutation.ts` — it enforces invariants 1–4 by construction. Hand-composing these steps is reserved for flows outside its scope (e.g. snapshot view, which does not mutate content).
```

**Add this sentence at the end of that paragraph** (inside the same paragraph, not a new one):
```
For any client flow whose response must be discarded when superseded by a newer request or an external epoch change (chapter switch, project switch, unmount), route through `useAbortableSequence` — it encodes the "bump before, check after" contract as tokens, auto-aborts on unmount, and is enforced by ESLint.
```

### Step 8.3: Verify CLAUDE.md rendering

Read back the edited section and confirm both edits are present and grammatically correct.

### Step 8.4: Commit

```bash
git add CLAUDE.md
git commit -m "docs(claude): CLAUDE.md cites useAbortableSequence in rule 4

Updates §Save-Pipeline Invariants to name the primitive that now
encodes rule 4 ('bump before, check after') and extends the closing
paragraph to cover non-editor-mutation flows (search, status change,
snapshot view, chapter select).

Part of Phase 4b.2."
```

---

## Task 9: Final DoD verification

**Files:** none modified.

### Step 9.1: Run the full CI pipeline

```
make all
```

This runs: `lint`, `format-check`, `typecheck`, `cover`, `e2e`.

Expected: PASS on all five stages.

### Step 9.2: Grep assertion

```
grep -rn "SeqRef\|seqRef\|sequenceRef" packages/client/src/
```

Expected: no output.

### Step 9.3: Confirm the 10 hook tests still pass

```
npx vitest run packages/client/src/hooks/useAbortableSequence.test.ts
```

Expected: PASS (10/10 — 9 staleness-contract + 1 no-console-output).

### Step 9.4: Confirm the ESLint fixture tests still pass

```
npx vitest run packages/client/src/__tests__/eslintSequenceRule.test.ts
```

Expected: PASS (3/3).

### Step 9.5: Confirm the regression tests at their original locations pass

```
npx vitest run -t "reloadActiveChapter in flight during unmount"
npx vitest run -t "project-change"
npx vitest run -t "chapter-switch mid-flight"
```

Expected: PASS (each test group).

### Step 9.6: Push and open PR

If everything passes, push the branch and open a PR per repo convention. Reference Phase 4b.2 of the roadmap in the PR description.

---

## Out of scope — do NOT include in this PR

- Changes to `AbortController` / fetch-abort propagation on `fetch` calls.
- Server-side sequencing.
- Extending `useEditorMutation`'s `inFlightRef` (different concern: concurrency guard, not staleness).
- Raw-strings or other ESLint rules (Phase 4b.4's territory).
- Generic cancellable-promise primitive.
- Any schema, API, or UI changes.

## Definition of Done (mirrors design §Definition of Done)

- [ ] `packages/client/src/hooks/useAbortableSequence.ts` exists with `start` / `capture` / `abort` and auto-abort on unmount.
- [ ] 9 direct unit tests covering the staleness contract pass.
- [ ] `grep -rn 'SeqRef\|seqRef\|sequenceRef' packages/client/src/` returns no matches.
- [ ] The `no-restricted-syntax` ESLint rule fails `make lint` on its fixture and passes on the migrated code.
- [ ] Existing consumer integration tests pass without semantic change.
- [ ] `useProjectEditor.test.ts:L.1415-1460` regression test updated to reflect auto-abort mechanism.
- [ ] CLAUDE.md §Save-Pipeline Invariants carries both edits (rule 4 + closing paragraph).
- [ ] `make cover` verified on `packages/client`; floors met or exceeded.
- [ ] No user-visible behavior change.
