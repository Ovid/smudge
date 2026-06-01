# Inline Title-Editing Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the inline edit/cancel/commit state machine shared by `useChapterTitleEditing` and `useProjectTitleEditing` into one canonical `useInlineTitleEditing` hook, reducing the two existing hooks to thin adapters.

**Architecture:** A new generic, entity-agnostic React hook owns the edit/cancel/commit machine (state, refs, the cancel-on-entity-change effect, and the gated save flow). The two existing hooks become thin wrappers that adapt their differing save signatures and pass opt-in `driftCheck`/`onAfterSave`/`clearError` callbacks. Two incidental asymmetries between the originals are deliberately normalized to the safety-positive union (reset the in-flight latch and clear the error on entity change), each pinned by a new test.

**Tech Stack:** React 18 hooks (`useState`/`useRef`/`useEffect`), TypeScript (strict), Vitest + `@testing-library/react` (`renderHook`/`act`).

**Design doc:** `docs/plans/2026-06-01-inline-title-editing-hook-design.md`

**Repo constraints (CLAUDE.md):**
- TDD red-green-refactor (§Testing Philosophy).
- Coverage floors must hold or rise: 95% statements, 85% branches, 90% functions, 95% lines.
- Zero test-output warnings; client console spies only via `expectConsole()` (these tests install no console spies, so none is needed).
- One-feature PR: this is a single refactor. No bundling with Phase 4b.16.
- No CLAUDE.md change (confirmed in the design's step-7 review).

**Commands** (run from repo root):
- Single client test file: `npm test -w packages/client -- useInlineTitleEditing`
- A test by name: `npm test -w packages/client -- useProjectTitleEditing -t "no-ops"`
- Full client suite: `npm test -w packages/client`
- Typecheck + lint + coverage + e2e: `make all`

---

## File Structure

- **Create** `packages/client/src/hooks/useInlineTitleEditing.ts` — the canonical edit/cancel/commit machine. One responsibility: inline title editing state + gated save. Entity-agnostic (no `Chapter`/`Project` import).
- **Create** `packages/client/src/__tests__/useInlineTitleEditing.test.ts` — unit tests for the machine.
- **Modify** `packages/client/src/hooks/useChapterTitleEditing.ts` — rewrite as a thin wrapper; keep exact signature + return shape.
- **Modify** `packages/client/src/hooks/useProjectTitleEditing.ts` — rewrite as a thin wrapper; keep exact signature + return shape.
- **Modify** `packages/client/src/__tests__/useChapterTitleEditing.test.ts` — **append** one normalization test (latch reset on chapter change). Do not edit existing cases.
- **Modify** `packages/client/src/__tests__/useProjectTitleEditing.test.ts` — **append** a no-op characterization test and one normalization test (error cleared on project change). Do not edit existing cases.

`packages/client/src/pages/EditorPage.tsx` is **not** modified: both wrappers keep their exact signatures and return keys, so its destructures continue to work unchanged.

---

## Task 1: Project no-op characterization test (pushback Finding 1)

Pins the current project behavior — an unchanged title fires no mutation and no navigation — before the extraction centralizes the no-op skip. This test passes against the **current** hook (characterization); it guards the refactor.

**Files:**
- Test: `packages/client/src/__tests__/useProjectTitleEditing.test.ts` (append inside the existing `describe("saveProjectTitle gates", …)` block, after the last existing `it(...)`)

- [ ] **Step 1: Append the no-op characterization test**

Append this `it(...)` block immediately before the closing `});` of the `describe("saveProjectTitle gates", …)` block:

```ts
    it("no-ops when draft matches existing title (no mutation, no navigation)", async () => {
      const project = buildProject({ title: "Project" });
      const handleUpdateProjectTitle = vi.fn(async () => "project");
      const setProjectTitleError = vi.fn();
      const navigate = vi.fn();
      const isActionBusy = vi.fn(() => false);
      const isEditorLocked = vi.fn(() => false);

      const { result } = renderHook(() =>
        useProjectTitleEditing(
          project,
          "project",
          handleUpdateProjectTitle,
          setProjectTitleError,
          navigate,
          isActionBusy,
          isEditorLocked,
        ),
      );

      act(() => result.current.startEditingProjectTitle());
      act(() => result.current.setProjectTitleDraft("Project"));
      await act(async () => {
        await result.current.saveProjectTitle();
      });

      expect(handleUpdateProjectTitle).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
      expect(result.current.editingProjectTitle).toBe(false);
    });
```

- [ ] **Step 2: Run the test and verify it passes against the current hook**

Run: `npm test -w packages/client -- useProjectTitleEditing -t "no-ops when draft matches"`
Expected: PASS (this characterizes existing behavior — the current hook already skips the mutation when `trimmed === project.title`).

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/__tests__/useProjectTitleEditing.test.ts
git commit -m "test(4b.15): pin project title no-op (no mutation, no navigation)"
```

---

## Task 2: Create the `useInlineTitleEditing` hook (TDD)

**Files:**
- Create: `packages/client/src/hooks/useInlineTitleEditing.ts`
- Test: `packages/client/src/__tests__/useInlineTitleEditing.test.ts`

- [ ] **Step 1: Write the failing unit-test file**

Create `packages/client/src/__tests__/useInlineTitleEditing.test.ts` with this exact content:

```ts
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInlineTitleEditing } from "../hooks/useInlineTitleEditing";

const noBusy = () => false;
const notLocked = () => false;
const gates = { isActionBusy: noBusy, isEditorLocked: notLocked };

describe("useInlineTitleEditing", () => {
  it("start() enters edit mode, seeds the draft, and clears the error", () => {
    const clearError = vi.fn();
    const onSave = vi.fn(async () => true);
    const { result } = renderHook(() =>
      useInlineTitleEditing<true>("e1", "Title", onSave, gates, { clearError }),
    );

    act(() => result.current.start());

    expect(result.current.editing).toBe(true);
    expect(result.current.draft).toBe("Title");
    expect(clearError).toHaveBeenCalledTimes(1);
  });

  it("start() is a no-op when currentId is undefined", () => {
    const onSave = vi.fn(async () => true);
    const { result } = renderHook(() =>
      useInlineTitleEditing<true>(undefined, undefined, onSave, gates),
    );

    act(() => result.current.start());

    expect(result.current.editing).toBe(false);
  });

  it("save() commits and runs onAfterSave on success, then exits", async () => {
    const onSave = vi.fn(async () => "result-value");
    const onAfterSave = vi.fn();
    const { result } = renderHook(() =>
      useInlineTitleEditing<string>("e1", "Old", onSave, gates, { onAfterSave }),
    );

    act(() => result.current.start());
    act(() => result.current.setDraft("New"));
    await act(async () => {
      await result.current.save();
    });

    expect(onSave).toHaveBeenCalledWith("e1", "New");
    expect(onAfterSave).toHaveBeenCalledWith("result-value");
    expect(result.current.editing).toBe(false);
  });

  it("save() skips onSave and onAfterSave when the draft is unchanged", async () => {
    const onSave = vi.fn(async () => "x");
    const onAfterSave = vi.fn();
    const { result } = renderHook(() =>
      useInlineTitleEditing<string>("e1", "Same", onSave, gates, { onAfterSave }),
    );

    act(() => result.current.start());
    act(() => result.current.setDraft("Same"));
    await act(async () => {
      await result.current.save();
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(onAfterSave).not.toHaveBeenCalled();
    expect(result.current.editing).toBe(false);
  });

  it("save() keeps edit mode open when onSave returns undefined (failure)", async () => {
    const onSave = vi.fn(async () => undefined);
    const onAfterSave = vi.fn();
    const { result } = renderHook(() =>
      useInlineTitleEditing<string>("e1", "Old", onSave, gates, { onAfterSave }),
    );

    act(() => result.current.start());
    act(() => result.current.setDraft("New"));
    await act(async () => {
      await result.current.save();
    });

    expect(onSave).toHaveBeenCalled();
    expect(onAfterSave).not.toHaveBeenCalled();
    expect(result.current.editing).toBe(true);
  });

  it("save() bails and keeps edit mode open when driftCheck returns true", async () => {
    const onSave = vi.fn(async () => "x");
    const { result } = renderHook(() =>
      useInlineTitleEditing<string>("e1", "Old", onSave, gates, { driftCheck: () => true }),
    );

    act(() => result.current.start());
    act(() => result.current.setDraft("New"));
    await act(async () => {
      await result.current.save();
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(result.current.editing).toBe(true);
  });

  it("save() bails when isActionBusy is true", async () => {
    const onSave = vi.fn(async () => "x");
    const { result } = renderHook(() =>
      useInlineTitleEditing<string>("e1", "Old", onSave, {
        isActionBusy: () => true,
        isEditorLocked: notLocked,
      }),
    );

    act(() => result.current.start());
    act(() => result.current.setDraft("New"));
    await act(async () => {
      await result.current.save();
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(result.current.editing).toBe(true);
  });

  it("save() bails when isEditorLocked is true", async () => {
    const onSave = vi.fn(async () => "x");
    const { result } = renderHook(() =>
      useInlineTitleEditing<string>("e1", "Old", onSave, {
        isActionBusy: noBusy,
        isEditorLocked: () => true,
      }),
    );

    act(() => result.current.start());
    act(() => result.current.setDraft("New"));
    await act(async () => {
      await result.current.save();
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(result.current.editing).toBe(true);
  });

  it("save() exits silently when cancel() set the escape sentinel", async () => {
    const onSave = vi.fn(async () => "x");
    const { result } = renderHook(() =>
      useInlineTitleEditing<string>("e1", "Old", onSave, gates),
    );

    act(() => result.current.start());
    act(() => result.current.setDraft("New"));
    act(() => result.current.cancel());
    await act(async () => {
      await result.current.save();
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(result.current.editing).toBe(false);
  });

  it("save() exits without committing when the draft is whitespace-only", async () => {
    const onSave = vi.fn(async () => "x");
    const { result } = renderHook(() =>
      useInlineTitleEditing<string>("e1", "Old", onSave, gates),
    );

    act(() => result.current.start());
    act(() => result.current.setDraft("   "));
    await act(async () => {
      await result.current.save();
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(result.current.editing).toBe(false);
  });

  it("save() ignores re-entry while a save is already in flight", async () => {
    let resolve: ((v: string) => void) | undefined;
    const onSave = vi.fn(() => new Promise<string>((r) => {
      resolve = r;
    }));
    const { result } = renderHook(() =>
      useInlineTitleEditing<string>("e1", "Old", onSave, gates),
    );

    act(() => result.current.start());
    act(() => result.current.setDraft("New"));
    let first!: Promise<void>;
    act(() => {
      first = result.current.save();
    });
    // Second call while the first is pending must be ignored.
    await act(async () => {
      await result.current.save();
    });

    expect(onSave).toHaveBeenCalledTimes(1);

    resolve?.("done");
    await act(async () => {
      await first;
    });
  });

  it("cancels edit mode when currentId changes", () => {
    const onSave = vi.fn(async () => "x");
    const { result, rerender } = renderHook(
      ({ id, title }: { id: string; title: string }) =>
        useInlineTitleEditing<string>(id, title, onSave, gates),
      { initialProps: { id: "e1", title: "One" } },
    );

    act(() => result.current.start());
    expect(result.current.editing).toBe(true);

    rerender({ id: "e2", title: "Two" });
    expect(result.current.editing).toBe(false);
  });

  it("resets the in-flight latch on currentId change so a new save proceeds (normalization)", async () => {
    let resolveFirst: ((v: string) => void) | undefined;
    let calls = 0;
    const onSave = vi.fn(() => {
      calls += 1;
      if (calls === 1) {
        return new Promise<string>((r) => {
          resolveFirst = r;
        });
      }
      return Promise.resolve("ok");
    });
    const { result, rerender } = renderHook(
      ({ id, title }: { id: string; title: string }) =>
        useInlineTitleEditing<string>(id, title, onSave, gates),
      { initialProps: { id: "e1", title: "One" } },
    );

    act(() => result.current.start());
    act(() => result.current.setDraft("One edited"));
    let firstSave!: Promise<void>;
    act(() => {
      firstSave = result.current.save();
    });
    expect(onSave).toHaveBeenCalledTimes(1);

    // Entity changes while the first save is still pending (latch held).
    rerender({ id: "e2", title: "Two" });

    // A fresh edit+save on the new entity must proceed despite the pending save.
    act(() => result.current.start());
    act(() => result.current.setDraft("Two edited"));
    await act(async () => {
      await result.current.save();
    });

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith("e2", "Two edited");

    resolveFirst?.("late");
    await act(async () => {
      await firstSave;
    });
  });

  it("calls clearError on currentId change (normalization)", () => {
    const clearError = vi.fn();
    const onSave = vi.fn(async () => "x");
    const { result, rerender } = renderHook(
      ({ id, title }: { id: string; title: string }) =>
        useInlineTitleEditing<string>(id, title, onSave, gates, { clearError }),
      { initialProps: { id: "e1", title: "One" } },
    );

    act(() => result.current.start());
    clearError.mockClear();

    rerender({ id: "e2", title: "Two" });
    expect(clearError).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w packages/client -- useInlineTitleEditing`
Expected: FAIL — `Failed to resolve import "../hooks/useInlineTitleEditing"` (module does not exist yet).

- [ ] **Step 3: Implement the hook**

Create `packages/client/src/hooks/useInlineTitleEditing.ts` with this exact content:

```ts
import { useState, useRef, useEffect } from "react";

export interface InlineTitleGates {
  isActionBusy: () => boolean;
  isEditorLocked: () => boolean;
}

export interface InlineTitleOptions<T> {
  // true ⇒ bail and keep edit mode open (e.g. the project slug-drift window).
  driftCheck?: () => boolean;
  // Runs on success only, with the defined save result.
  onAfterSave?: (result: T) => void;
  // Called on edit-start AND on entity (currentId) change.
  clearError?: () => void;
}

export interface InlineTitleEditing {
  editing: boolean;
  draft: string;
  setDraft: (value: string) => void;
  inputRef: React.RefObject<HTMLInputElement>;
  start: () => void;
  save: () => Promise<void>;
  cancel: () => void;
}

// Canonical inline edit/cancel/commit machine shared by useChapterTitleEditing
// and useProjectTitleEditing. Entity-agnostic: takes the current id + title as
// plain values and a unified onSave callback. Returns undefined from onSave to
// signal failure (edit mode stays open); any defined value is success and runs
// options.onAfterSave.
export function useInlineTitleEditing<T>(
  currentId: string | undefined,
  currentTitle: string | undefined,
  onSave: (id: string, title: string) => Promise<T | undefined>,
  gates: InlineTitleGates,
  options?: InlineTitleOptions<T>,
): InlineTitleEditing {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const escapePressedRef = useRef(false);
  const isSavingRef = useRef(false);
  const prevIdRef = useRef<string | undefined>(currentId);

  // Hold the latest options so the entity-change effect can read clearError
  // without taking `options` (a fresh object each render) as a dependency,
  // which would refire the effect every render.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Cancel editing when the entity changes (e.g. keyboard navigation) so a
  // pending blur cannot save the draft to the wrong entity. Skip the initial
  // undefined → first id transition: nothing to cancel, and it can race a
  // double-click that enters edit mode before the effect flushes.
  useEffect(() => {
    if (prevIdRef.current !== undefined && prevIdRef.current !== currentId) {
      escapePressedRef.current = true;
      // Normalization (Phase 4b.15): reset the in-flight latch and clear the
      // error on entity change. Both are safety-positive — escapePressedRef is
      // also set here, so the next save() bails before any mutation.
      isSavingRef.current = false;
      setEditing(false);
      optionsRef.current?.clearError?.();
    }
    prevIdRef.current = currentId;
  }, [currentId]);

  function start() {
    if (currentId === undefined || currentTitle === undefined) return;
    escapePressedRef.current = false;
    options?.clearError?.();
    setDraft(currentTitle);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  async function save() {
    if (isSavingRef.current) return;
    if (escapePressedRef.current) {
      setEditing(false);
      return;
    }
    if (currentId === undefined || !draft.trim()) {
      setEditing(false);
      return;
    }
    // Opt-in drift bail (project slug-drift). Keep edit mode open so the typed
    // draft survives for retry once the entity state settles.
    if (options?.driftCheck?.()) {
      return;
    }
    // Refuse mid-mutation or while the lock banner is up. Keep edit mode open
    // so the draft is preserved for retry — closing here would discard it.
    if (gates.isActionBusy() || gates.isEditorLocked()) {
      return;
    }
    isSavingRef.current = true;
    try {
      const trimmed = draft.trim();
      if (trimmed !== currentTitle) {
        const result = await onSave(currentId, trimmed);
        if (result === undefined) return; // keep edit mode open on failure
        options?.onAfterSave?.(result);
      }
      // Prevent the blur handler (fired when the input unmounts) from
      // re-entering save().
      escapePressedRef.current = true;
      setEditing(false);
    } finally {
      isSavingRef.current = false;
    }
  }

  function cancel() {
    escapePressedRef.current = true;
    setEditing(false);
  }

  return {
    editing,
    draft,
    setDraft,
    inputRef,
    start,
    save,
    cancel,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w packages/client -- useInlineTitleEditing`
Expected: PASS (all 15 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/hooks/useInlineTitleEditing.ts packages/client/src/__tests__/useInlineTitleEditing.test.ts
git commit -m "feat(4b.15): add canonical useInlineTitleEditing hook"
```

---

## Task 3: Rewrite `useChapterTitleEditing` as a thin wrapper

The chapter normalization test (latch reset on chapter change) is **red** against the current hook and **green** after the rewrite, driving the change. The existing chapter tests must stay green throughout.

**Files:**
- Modify: `packages/client/src/hooks/useChapterTitleEditing.ts` (full rewrite)
- Test: `packages/client/src/__tests__/useChapterTitleEditing.test.ts` (append one test)

- [ ] **Step 1: Append the normalization test (red)**

Append this `it(...)` block immediately before the closing `});` of the `describe("saveTitle gates", …)` block:

```ts
    it("resets the in-flight save latch when the active chapter changes (4b.15 normalization)", async () => {
      const chapter1 = buildChapter({ id: "c1", title: "One" });
      const chapter2 = buildChapter({ id: "c2", title: "Two" });
      let resolveFirst: (() => void) | undefined;
      let calls = 0;
      const handleRenameChapter = vi.fn((): Promise<void> => {
        calls += 1;
        if (calls === 1) {
          return new Promise<void>((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve();
      });
      const isActionBusy = vi.fn(() => false);
      const isEditorLocked = vi.fn(() => false);

      const { result, rerender } = renderHook(
        ({ ch }: { ch: typeof chapter1 }) =>
          useChapterTitleEditing(ch, handleRenameChapter, isActionBusy, isEditorLocked),
        { initialProps: { ch: chapter1 } },
      );

      // Start a save on c1 that hangs, holding the in-flight latch.
      act(() => result.current.startEditingTitle());
      act(() => result.current.setTitleDraft("One edited"));
      let firstSave!: Promise<void>;
      act(() => {
        firstSave = result.current.saveTitle();
      });
      expect(handleRenameChapter).toHaveBeenCalledTimes(1);

      // Navigate to c2 mid-save: the normalization resets the latch.
      rerender({ ch: chapter2 });

      // A fresh edit+save on c2 must proceed despite the still-pending save.
      act(() => result.current.startEditingTitle());
      act(() => result.current.setTitleDraft("Two edited"));
      await act(async () => {
        await result.current.saveTitle();
      });

      expect(handleRenameChapter).toHaveBeenCalledTimes(2);
      expect(handleRenameChapter).toHaveBeenLastCalledWith(
        "c2",
        "Two edited",
        expect.any(Function),
      );

      // Release the now-stale first save to avoid a dangling pending promise.
      resolveFirst?.();
      await act(async () => {
        await firstSave;
      });
    });
```

- [ ] **Step 2: Run the chapter test file and verify the new test fails**

Run: `npm test -w packages/client -- useChapterTitleEditing`
Expected: the new test FAILS — `expected "handleRenameChapter" to be called 2 times, but got 1`. (The current hook does not reset `isSavingTitleRef` on chapter change, so the second `saveTitle` early-returns on the still-set latch.) All pre-existing chapter tests PASS.

- [ ] **Step 3: Rewrite the chapter hook as a thin wrapper**

Replace the entire contents of `packages/client/src/hooks/useChapterTitleEditing.ts` with:

```ts
import { useState } from "react";
import type { Chapter } from "@smudge/shared";
import { useInlineTitleEditing } from "./useInlineTitleEditing";

export function useChapterTitleEditing(
  activeChapter: Chapter | null,
  handleRenameChapter: (
    id: string,
    title: string,
    onError?: (message: string) => void,
  ) => Promise<void>,
  // I1: All chapter-title PATCH entry points share the busy gate so no second
  // entry point slips past during a 2–14s save backoff or in-flight replace.
  isActionBusy: () => boolean,
  // I2: A title PATCH during the lock-banner window would race a possibly-
  // committed restore/replace — the fragility the lock banner exists to prevent.
  isEditorLocked: () => boolean,
) {
  const [titleError, setTitleError] = useState<string | null>(null);

  const inline = useInlineTitleEditing<true>(
    activeChapter?.id,
    activeChapter?.title,
    // Adapt the onError-callback save into the unified onSave contract:
    // undefined ⇒ failure (keep edit mode open), true ⇒ success.
    async (id, title) => {
      let failed = false;
      await handleRenameChapter(id, title, (message) => {
        setTitleError(message);
        failed = true;
      });
      return failed ? undefined : true;
    },
    { isActionBusy, isEditorLocked },
    { clearError: () => setTitleError(null) },
  );

  return {
    editingTitle: inline.editing,
    titleDraft: inline.draft,
    setTitleDraft: inline.setDraft,
    titleError,
    titleInputRef: inline.inputRef,
    startEditingTitle: inline.start,
    saveTitle: inline.save,
    cancelEditingTitle: inline.cancel,
  };
}
```

- [ ] **Step 4: Run the chapter test file and verify all tests pass**

Run: `npm test -w packages/client -- useChapterTitleEditing`
Expected: PASS — all pre-existing cases plus the new normalization test.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/hooks/useChapterTitleEditing.ts packages/client/src/__tests__/useChapterTitleEditing.test.ts
git commit -m "refactor(4b.15): reduce useChapterTitleEditing to a thin wrapper"
```

---

## Task 4: Rewrite `useProjectTitleEditing` as a thin wrapper

The project normalization test (error cleared on project change) is **red** against the current hook and **green** after the rewrite. Existing project tests (including Task 1's no-op test) stay green.

**Files:**
- Modify: `packages/client/src/hooks/useProjectTitleEditing.ts` (full rewrite)
- Test: `packages/client/src/__tests__/useProjectTitleEditing.test.ts` (append one test)

- [ ] **Step 1: Append the normalization test (red)**

Append this `it(...)` block immediately before the closing `});` of the `describe("saveProjectTitle gates", …)` block:

```ts
    it("clears the project title error when the project changes (4b.15 normalization)", () => {
      const project1 = buildProject({ id: "p1", title: "Alpha", slug: "alpha" });
      const project2 = buildProject({ id: "p2", title: "Beta", slug: "beta" });
      const handleUpdateProjectTitle = vi.fn(async () => "alpha");
      const setProjectTitleError = vi.fn();
      const navigate = vi.fn();
      const isActionBusy = vi.fn(() => false);
      const isEditorLocked = vi.fn(() => false);

      const { result, rerender } = renderHook(
        ({ p, s }: { p: typeof project1; s: string }) =>
          useProjectTitleEditing(
            p,
            s,
            handleUpdateProjectTitle,
            setProjectTitleError,
            navigate,
            isActionBusy,
            isEditorLocked,
          ),
        { initialProps: { p: project1, s: "alpha" } },
      );

      act(() => result.current.startEditingProjectTitle());
      // startEditing already cleared the error once; isolate the change effect.
      setProjectTitleError.mockClear();

      rerender({ p: project2, s: "beta" });

      expect(setProjectTitleError).toHaveBeenCalledWith(null);
    });
```

- [ ] **Step 2: Run the project test file and verify the new test fails**

Run: `npm test -w packages/client -- useProjectTitleEditing`
Expected: the new test FAILS — `expected "setProjectTitleError" to be called with [ null ]` but it was not called after the rerender. (The current hook does not clear the error on project change.) All pre-existing project tests PASS (including Task 1's no-op test).

- [ ] **Step 3: Rewrite the project hook as a thin wrapper**

Replace the entire contents of `packages/client/src/hooks/useProjectTitleEditing.ts` with:

```ts
import type { ProjectWithChapters } from "@smudge/shared";
import { useInlineTitleEditing } from "./useInlineTitleEditing";

export function useProjectTitleEditing(
  project: ProjectWithChapters | null,
  slug: string | undefined,
  handleUpdateProjectTitle: (title: string) => Promise<string | undefined>,
  setProjectTitleError: (error: string | null) => void,
  navigate: (path: string, options?: { replace: boolean }) => void,
  // I4: Renaming the project rewrites the slug; gating on the busy latch keeps
  // an in-flight replace's old-slug closure from racing the new slug. S7:
  // required, not optional — a caller omitting it would disable the guard.
  isActionBusy: () => boolean,
  // I2: A project-title PATCH during the lock-banner window races a possibly-
  // committed restore/replace — gate here alongside isActionBusy.
  isEditorLocked: () => boolean,
) {
  const inline = useInlineTitleEditing<string>(
    project?.id,
    project?.title,
    (_id, title) => handleUpdateProjectTitle(title),
    { isActionBusy, isEditorLocked },
    {
      // C3: refuse if the URL slug has drifted ahead of loaded project state.
      // project is non-null here: the shared hook's empty-id guard
      // (currentId = project?.id) returns before driftCheck when project is
      // null, so the assertion cannot throw.
      driftCheck: () => project!.slug !== slug,
      onAfterSave: (newSlug) => {
        if (newSlug !== slug) {
          navigate(`/projects/${newSlug}`, { replace: true });
        }
      },
      clearError: () => setProjectTitleError(null),
    },
  );

  return {
    editingProjectTitle: inline.editing,
    projectTitleDraft: inline.draft,
    setProjectTitleDraft: inline.setDraft,
    projectTitleInputRef: inline.inputRef,
    startEditingProjectTitle: inline.start,
    saveProjectTitle: inline.save,
    cancelEditingProjectTitle: inline.cancel,
  };
}
```

- [ ] **Step 4: Run the project test file and verify all tests pass**

Run: `npm test -w packages/client -- useProjectTitleEditing`
Expected: PASS — all pre-existing cases, Task 1's no-op test, and the new normalization test.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/hooks/useProjectTitleEditing.ts packages/client/src/__tests__/useProjectTitleEditing.test.ts
git commit -m "refactor(4b.15): reduce useProjectTitleEditing to a thin wrapper"
```

---

## Task 5: Full verification

Confirms the extraction is complete, the consumer is unaffected, type/lint/coverage all pass, and nothing else regressed.

**Files:** none modified (verification only).

- [ ] **Step 1: Confirm `EditorPage` is untouched and still compiles against the wrappers**

Run: `git status --porcelain packages/client/src/pages/EditorPage.tsx`
Expected: empty output (the file was not modified — both wrappers kept their exact signatures and return keys).

- [ ] **Step 2: Run the full client suite with no warnings**

Run: `npm test -w packages/client`
Expected: PASS, with zero `console.warn`/`console.error` output in stderr.

- [ ] **Step 3: Run the full CI pass**

Run: `make all`
Expected: lint, format, typecheck, coverage (≥ 95% statements / 85% branches / 90% functions / 95% lines), and e2e all green. If coverage on `useInlineTitleEditing.ts` is below the floor, add a targeted test for the uncovered branch (do not lower thresholds).

- [ ] **Step 4: Commit (only if `make all` produced incidental formatting changes)**

```bash
git add -A
git commit -m "chore(4b.15): formatting/lint after inline-title-editing extraction"
```

If `git status` is clean after `make all`, skip this commit.

---

## Self-Review

**1. Spec coverage** (design → task):
- Shared `useInlineTitleEditing` hook with full contract → Task 2.
- Both wrappers reduced to thin adapters, exact signatures/returns preserved → Tasks 3 & 4 (and Task 5 Step 1 verifies the consumer is untouched).
- Slug-drift check + post-save navigate preserved as opt-ins in the project wrapper → Task 4 Step 3.
- Save-result contract generalized to `T | undefined`; chapter returns `true` sentinel → Task 3 Step 3.
- Two normalizations (latch reset + clearError on entity change), each test-pinned → generic tests (Task 2) + chapter test (Task 3) + project test (Task 4).
- Project no-op characterization test (pushback Finding 1) → Task 1.
- "Do not `useCallback`-wrap save/start" (pushback Finding 2) → satisfied by the Task 2 implementation, which returns plain per-render closures; no memoization introduced.
- CLAUDE.md discoverability deferred (pushback Finding 3) → no task; recorded in design step-7 review.
- Existing wrapper tests pass unmodified → Tasks 3 & 4 append-only; Task 5 Step 2 runs the full suite.
- Coverage floors / zero warnings → Task 5 Step 3.

**2. Placeholder scan:** No "TBD"/"TODO"/"handle edge cases"/"similar to". Every code step contains complete, runnable content. ✓

**3. Type consistency:** `InlineTitleGates`, `InlineTitleOptions<T>`, `InlineTitleEditing`, and `useInlineTitleEditing<T>(currentId, currentTitle, onSave, gates, options?)` are used identically across Task 2 (definition), Task 3 (`<true>`, `clearError`), and Task 4 (`<string>`, `driftCheck`/`onAfterSave`/`clearError`). Return keys (`editing`/`draft`/`setDraft`/`inputRef`/`start`/`save`/`cancel`) match between the hook's return and both wrappers' destructures. The chapter adapter returns `true | undefined` matching `<true>`; the project adapter returns `Promise<string | undefined>` matching `<string>`. ✓
