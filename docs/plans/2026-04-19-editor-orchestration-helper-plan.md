# Editor Orchestration Helper — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract the shared "mutate editor content via the server" shape into a single `useEditorMutation` hook, enforcing CLAUDE.md Save-pipeline invariants 1–4 by construction, and migrate the three ad-hoc call sites (`handleRestoreSnapshot`, `executeReplace`, `handleReplaceOne`) to it — with zero user-visible behavior change.

**Architecture:** A new hook in `packages/client/src/hooks/useEditorMutation.ts` exposes a generic `run<T>(mutate)` that sequences `setEditable(false)` → `flushSave` → `cancelPendingSaves` → `markClean` → `mutate()` → `clearAllCachedContent` → `reloadActiveChapter` → `setEditable(true)`. The hook uses a latest-ref pattern to tolerate unstable method identities on `useProjectEditor`'s return. Failures return a discriminated `{ ok: false, stage }` result; callers route each stage to the existing UI treatment. No public state is exposed.

**Tech Stack:** React 18 hooks, TypeScript, Vitest + `@testing-library/react` (`renderHook`), jsdom.

**Design reference:** `docs/plans/2026-04-19-editor-orchestration-helper-design.md`

**Red/green/refactor discipline:** Per CLAUDE.md §Testing Philosophy, every new test goes in red first, minimal implementation makes it green, then refactor. One commit per task unless noted.

**Zero warnings discipline:** Any test that deliberately triggers an error path must spy on `console.warn`/`console.error`, assert the expected message, and restore the spy. Per CLAUDE.md.

**Coverage floor:** 95% statements, 85% branches, 90% functions, 95% lines (vitest.config.ts).

---

## Task 1: Hook file skeleton + types

**Files:**
- Create: `packages/client/src/hooks/useEditorMutation.ts`
- Create: `packages/client/src/hooks/useEditorMutation.test.tsx`

**Step 1: Write the failing smoke test**

Create `packages/client/src/hooks/useEditorMutation.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { useEditorMutation } from "../hooks/useEditorMutation";

describe("useEditorMutation", () => {
  it("exports a hook", () => {
    expect(typeof useEditorMutation).toBe("function");
  });
});
```

**Step 2: Run it; verify it fails**

```
npm test -w packages/client -- useEditorMutation
```
Expected: FAIL (module not found).

**Step 3: Create the hook file with types + stub**

```ts
import { useRef, useEffect, useCallback, type MutableRefObject } from "react";
import type { EditorHandle } from "../components/Editor";
import type { useProjectEditor } from "./useProjectEditor";
import { clearAllCachedContent } from "./useContentCache";

export type MutationStage = "flush" | "mutate" | "reload" | "busy";

export type MutationDirective<T = void> = {
  clearCacheFor: string[];
  reloadActiveChapter: boolean;
  data: T;
};

export type MutationResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; stage: "reload"; data: T; error?: unknown }
  | { ok: false; stage: "flush" | "mutate" | "busy"; error?: unknown };

export type UseEditorMutationArgs = {
  editorRef: MutableRefObject<EditorHandle | null>;
  projectEditor: Pick<
    ReturnType<typeof useProjectEditor>,
    "cancelPendingSaves" | "reloadActiveChapter"
  >;
};

export type UseEditorMutationReturn = {
  run: <T>(
    mutate: () => Promise<MutationDirective<T>>,
  ) => Promise<MutationResult<T>>;
};

export function useEditorMutation(
  args: UseEditorMutationArgs,
): UseEditorMutationReturn {
  const projectEditorRef = useRef(args.projectEditor);
  useEffect(() => {
    projectEditorRef.current = args.projectEditor;
  });

  const run = useCallback(async <T,>(): Promise<MutationResult<T>> => {
    throw new Error("not implemented");
  }, []);

  // Suppress unused variable until later tasks wire it in.
  void args.editorRef;
  void clearAllCachedContent;

  return { run };
}
```

**Step 4: Run the test; verify it passes**

```
npm test -w packages/client -- useEditorMutation
```
Expected: PASS.

**Step 5: Commit**

```
git add packages/client/src/hooks/useEditorMutation.ts packages/client/src/hooks/useEditorMutation.test.tsx
git commit -m "feat(client): scaffold useEditorMutation hook types"
```

---

## Task 2: Happy path — full sequence ordering

**Files:**
- Modify: `packages/client/src/hooks/useEditorMutation.ts`
- Modify: `packages/client/src/hooks/useEditorMutation.test.tsx`

**Step 1: Write the failing test**

Add to the test file (replace or augment the smoke test):

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { MutableRefObject } from "react";
import type { EditorHandle } from "../components/Editor";
import { useEditorMutation } from "../hooks/useEditorMutation";

vi.mock("./useContentCache", () => ({
  clearAllCachedContent: vi.fn(),
}));

function buildHandles() {
  const calls: string[] = [];
  const editor: EditorHandle = {
    flushSave: vi.fn(async () => {
      calls.push("flushSave");
      return true;
    }),
    editor: null,
    insertImage: vi.fn(),
    markClean: vi.fn(() => {
      calls.push("markClean");
    }),
    setEditable: vi.fn((editable: boolean) => {
      calls.push(`setEditable(${editable})`);
    }),
  };
  const editorRef: MutableRefObject<EditorHandle | null> = { current: editor };
  const projectEditor = {
    cancelPendingSaves: vi.fn(() => {
      calls.push("cancelPendingSaves");
    }),
    reloadActiveChapter: vi.fn(async () => {
      calls.push("reloadActiveChapter");
      return true;
    }),
  };
  return { calls, editor, editorRef, projectEditor };
}

describe("useEditorMutation — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs steps in the required order", async () => {
    const { calls, editorRef, projectEditor } = buildHandles();
    const { clearAllCachedContent } = await import("./useContentCache");
    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor }),
    );

    const res = await result.current.run(async () => {
      calls.push("mutate");
      return { clearCacheFor: ["c1"], reloadActiveChapter: true, data: undefined };
    });

    expect(res).toEqual({ ok: true, data: undefined });
    expect(calls).toEqual([
      "setEditable(false)",
      "flushSave",
      "cancelPendingSaves",
      "markClean",
      "mutate",
      "reloadActiveChapter",
      "setEditable(true)",
    ]);
    expect(vi.mocked(clearAllCachedContent)).toHaveBeenCalledWith(["c1"]);
    expect(vi.mocked(clearAllCachedContent).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(projectEditor.reloadActiveChapter).mock.invocationCallOrder[0],
    );
  });
});
```

**Step 2: Run; verify failure**

```
npm test -w packages/client -- useEditorMutation
```
Expected: FAIL (the stub throws).

**Step 3: Implement the happy path in the hook**

Replace the `run` body in `useEditorMutation.ts`:

```ts
const run = useCallback(async <T,>(
  mutate: () => Promise<MutationDirective<T>>,
): Promise<MutationResult<T>> => {
  const editor = args.editorRef.current;
  editor?.setEditable(false);
  await editor?.flushSave();
  projectEditorRef.current.cancelPendingSaves();
  editor?.markClean();
  const directive = await mutate();
  if (directive.clearCacheFor.length > 0) {
    clearAllCachedContent(directive.clearCacheFor);
  }
  if (directive.reloadActiveChapter) {
    await projectEditorRef.current.reloadActiveChapter();
  }
  editor?.setEditable(true);
  return { ok: true, data: directive.data };
}, [args.editorRef]);
```

Remove the `void` suppression lines. Keep `void args.editorRef` removed.

**Step 4: Run; verify pass**

Expected: PASS.

**Step 5: Commit**

```
git add packages/client/src/hooks/useEditorMutation.ts packages/client/src/hooks/useEditorMutation.test.tsx
git commit -m "feat(client): implement useEditorMutation happy path"
```

---

## Task 3: Directive honored — skip reload, empty cache-clear

**Files:**
- Modify: `packages/client/src/hooks/useEditorMutation.test.tsx`

**Step 1: Add failing tests**

```tsx
it("skips reloadActiveChapter when directive says false", async () => {
  const { editorRef, projectEditor } = buildHandles();
  const { result } = renderHook(() =>
    useEditorMutation({ editorRef, projectEditor }),
  );

  await result.current.run(async () => ({
    clearCacheFor: [],
    reloadActiveChapter: false,
    data: undefined,
  }));

  expect(projectEditor.reloadActiveChapter).not.toHaveBeenCalled();
});

it("skips clearAllCachedContent when directive.clearCacheFor is empty", async () => {
  const { editorRef, projectEditor } = buildHandles();
  const { clearAllCachedContent } = await import("./useContentCache");
  const { result } = renderHook(() =>
    useEditorMutation({ editorRef, projectEditor }),
  );

  await result.current.run(async () => ({
    clearCacheFor: [],
    reloadActiveChapter: true,
    data: undefined,
  }));

  expect(vi.mocked(clearAllCachedContent)).not.toHaveBeenCalled();
});
```

**Step 2: Run; verify pass (already satisfied by Task 2's implementation)**

Expected: PASS — the `if (directive.clearCacheFor.length > 0)` and `if (directive.reloadActiveChapter)` guards already cover this. If failing, adjust implementation.

**Step 3: Commit**

```
git add packages/client/src/hooks/useEditorMutation.test.tsx
git commit -m "test(client): cover useEditorMutation directive guards"
```

---

## Task 4: Generic `run<T>` threads data through

**Files:**
- Modify: `packages/client/src/hooks/useEditorMutation.test.tsx`

**Step 1: Add failing test**

```tsx
it("threads typed data through to the success result", async () => {
  const { editorRef, projectEditor } = buildHandles();
  const { result } = renderHook(() =>
    useEditorMutation({ editorRef, projectEditor }),
  );

  const res = await result.current.run<{ replaced: number }>(async () => ({
    clearCacheFor: [],
    reloadActiveChapter: false,
    data: { replaced: 7 },
  }));

  expect(res.ok).toBe(true);
  if (res.ok) {
    expect(res.data).toEqual({ replaced: 7 });
  }
});
```

**Step 2: Run; expect PASS** (already satisfied by Task 2).

**Step 3: Commit**

```
git add packages/client/src/hooks/useEditorMutation.test.tsx
git commit -m "test(client): cover useEditorMutation generic data threading"
```

---

## Task 5: Flush-stage failure

**Files:**
- Modify: `packages/client/src/hooks/useEditorMutation.ts`
- Modify: `packages/client/src/hooks/useEditorMutation.test.tsx`

**Step 1: Add failing tests**

```tsx
describe("useEditorMutation — flush failure", () => {
  it("returns stage 'flush' when flushSave rejects and does not proceed", async () => {
    const { editorRef, projectEditor } = buildHandles();
    editorRef.current!.flushSave = vi.fn(async () => {
      throw new Error("boom");
    });
    const mutate = vi.fn();
    const { clearAllCachedContent } = await import("./useContentCache");

    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor }),
    );
    const res = await result.current.run(mutate as never);

    expect(res).toEqual({
      ok: false,
      stage: "flush",
      error: expect.objectContaining({ message: "boom" }),
    });
    expect(mutate).not.toHaveBeenCalled();
    expect(vi.mocked(clearAllCachedContent)).not.toHaveBeenCalled();
    expect(projectEditor.reloadActiveChapter).not.toHaveBeenCalled();
    expect(editorRef.current!.setEditable).toHaveBeenLastCalledWith(true);
  });
});
```

**Step 2: Run; verify failure**

Expected: FAIL (the hook rethrows).

**Step 3: Implement flush-stage handling**

Wrap step 3 of the sequence in try/catch. Update `run`:

```ts
const run = useCallback(async <T,>(
  mutate: () => Promise<MutationDirective<T>>,
): Promise<MutationResult<T>> => {
  const editor = args.editorRef.current;
  editor?.setEditable(false);
  try {
    try {
      await editor?.flushSave();
    } catch (error) {
      return { ok: false, stage: "flush", error };
    }
    projectEditorRef.current.cancelPendingSaves();
    editor?.markClean();
    const directive = await mutate();
    if (directive.clearCacheFor.length > 0) {
      clearAllCachedContent(directive.clearCacheFor);
    }
    if (directive.reloadActiveChapter) {
      await projectEditorRef.current.reloadActiveChapter();
    }
    return { ok: true, data: directive.data };
  } finally {
    editor?.setEditable(true);
  }
}, [args.editorRef]);
```

**Step 4: Run; verify pass**

Expected: PASS.

**Step 5: Commit**

```
git add packages/client/src/hooks/useEditorMutation.ts packages/client/src/hooks/useEditorMutation.test.tsx
git commit -m "feat(client): useEditorMutation surfaces flush-stage failures"
```

---

## Task 6: Mutate-stage failure

**Files:**
- Modify: `packages/client/src/hooks/useEditorMutation.ts`
- Modify: `packages/client/src/hooks/useEditorMutation.test.tsx`

**Step 1: Add failing tests**

```tsx
describe("useEditorMutation — mutate failure", () => {
  it("returns stage 'mutate' on throw and skips cache/reload", async () => {
    const { editorRef, projectEditor } = buildHandles();
    const { clearAllCachedContent } = await import("./useContentCache");

    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor }),
    );
    const res = await result.current.run(async () => {
      throw new Error("server-no");
    });

    expect(res).toEqual({
      ok: false,
      stage: "mutate",
      error: expect.objectContaining({ message: "server-no" }),
    });
    expect(vi.mocked(clearAllCachedContent)).not.toHaveBeenCalled();
    expect(projectEditor.reloadActiveChapter).not.toHaveBeenCalled();
    expect(editorRef.current!.setEditable).toHaveBeenLastCalledWith(true);
    expect(editorRef.current!.markClean).toHaveBeenCalled(); // markClean runs before mutate
  });
});
```

**Step 2: Run; verify failure**

Expected: FAIL (the mutate throw bubbles out of the try/finally).

**Step 3: Wrap the mutate call in try/catch**

Update the middle of `run`:

```ts
editor?.markClean();
let directive: MutationDirective<T>;
try {
  directive = await mutate();
} catch (error) {
  return { ok: false, stage: "mutate", error };
}
if (directive.clearCacheFor.length > 0) {
  clearAllCachedContent(directive.clearCacheFor);
}
```

**Step 4: Run; verify pass**

**Step 5: Commit**

```
git add packages/client/src/hooks/useEditorMutation.ts packages/client/src/hooks/useEditorMutation.test.tsx
git commit -m "feat(client): useEditorMutation surfaces mutate-stage failures"
```

---

## Task 7: Reload-stage failure

**Files:**
- Modify: `packages/client/src/hooks/useEditorMutation.ts`
- Modify: `packages/client/src/hooks/useEditorMutation.test.tsx`

**Context:** `reloadActiveChapter` returns `Promise<boolean>` and accepts an optional `onError(msg)` callback. It does **not** throw (see `useProjectEditor.ts:273–308`). The hook must pass an `onError` callback to prevent the legacy `setError` full-page error branch, capture the message, and convert the `false` return into a `stage: "reload"` result.

**Step 1: Add failing test**

```tsx
describe("useEditorMutation — reload failure", () => {
  it("returns stage 'reload' when reloadActiveChapter invokes onError", async () => {
    const { editorRef, projectEditor } = buildHandles();
    projectEditor.reloadActiveChapter = vi.fn(async (onError) => {
      onError?.("reload-failed-msg");
      return false;
    });

    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor }),
    );
    const res = await result.current.run<{ replaced: number }>(async () => ({
      clearCacheFor: ["c1"],
      reloadActiveChapter: true,
      data: { replaced: 3 },
    }));

    expect(res).toEqual({
      ok: false,
      stage: "reload",
      data: { replaced: 3 },
      error: "reload-failed-msg",
    });
    expect(editorRef.current!.setEditable).toHaveBeenLastCalledWith(true);
    // cache-clear still happened — server committed the mutation
    const { clearAllCachedContent } = await import("./useContentCache");
    expect(vi.mocked(clearAllCachedContent)).toHaveBeenCalledWith(["c1"]);
  });

  it("returns stage 'reload' with data when reloadActiveChapter returns false without onError", async () => {
    const { editorRef, projectEditor } = buildHandles();
    projectEditor.reloadActiveChapter = vi.fn(async () => false);

    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor }),
    );
    const res = await result.current.run<{ affected: string[] }>(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: true,
      data: { affected: ["c9"] },
    }));

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.stage).toBe("reload");
      if (res.stage === "reload") {
        expect(res.data).toEqual({ affected: ["c9"] });
      }
    }
  });
});
```

**Step 2: Run; verify failure**

**Step 3: Implement reload-stage handling**

Replace the reload block in `run`:

```ts
if (directive.reloadActiveChapter) {
  let reloadMessage: string | undefined;
  const ok = await projectEditorRef.current.reloadActiveChapter((msg) => {
    reloadMessage = msg;
  });
  if (!ok) {
    return {
      ok: false,
      stage: "reload",
      data: directive.data,
      error: reloadMessage,
    };
  }
}
```

**Step 4: Run; verify pass**

**Step 5: Commit**

```
git add packages/client/src/hooks/useEditorMutation.ts packages/client/src/hooks/useEditorMutation.test.tsx
git commit -m "feat(client): useEditorMutation surfaces reload-stage failures"
```

---

## Task 8: Busy guard

**Files:**
- Modify: `packages/client/src/hooks/useEditorMutation.ts`
- Modify: `packages/client/src/hooks/useEditorMutation.test.tsx`

**Step 1: Add failing test**

```tsx
describe("useEditorMutation — busy guard", () => {
  it("rejects overlapping run with stage 'busy' and no side effects", async () => {
    const { editorRef, projectEditor } = buildHandles();
    const { clearAllCachedContent } = await import("./useContentCache");

    let resolveMutate: () => void = () => {};
    const blockingMutate = () =>
      new Promise<{ clearCacheFor: string[]; reloadActiveChapter: boolean; data: void }>(
        (resolve) => {
          resolveMutate = () =>
            resolve({ clearCacheFor: [], reloadActiveChapter: false, data: undefined });
        },
      );

    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor }),
    );

    const firstPromise = result.current.run(blockingMutate);
    // Yield to allow the first run to enter the in-flight region
    await Promise.resolve();
    await Promise.resolve();

    const secondResult = await result.current.run(async () => ({
      clearCacheFor: ["x"],
      reloadActiveChapter: true,
      data: undefined,
    }));

    expect(secondResult).toEqual({ ok: false, stage: "busy" });
    // Second call must have zero side effects
    expect(vi.mocked(clearAllCachedContent)).not.toHaveBeenCalledWith(["x"]);
    // editor handle methods called for second run? Should not have additional calls.
    expect(editorRef.current!.setEditable).toHaveBeenCalledTimes(1); // only the first run's (false)

    resolveMutate();
    await firstPromise;
  });
});
```

**Step 2: Run; verify failure**

**Step 3: Add the in-flight guard**

At the top of `run`, add:

```ts
const inFlightRef = /* declared at hook level: const inFlightRef = useRef(false); */;
// ...
if (inFlightRef.current) {
  return { ok: false, stage: "busy" };
}
inFlightRef.current = true;
try {
  // existing body
} finally {
  inFlightRef.current = false;
}
```

Full structure:

```ts
const inFlightRef = useRef(false);

const run = useCallback(async <T,>(
  mutate: () => Promise<MutationDirective<T>>,
): Promise<MutationResult<T>> => {
  if (inFlightRef.current) {
    return { ok: false, stage: "busy" };
  }
  inFlightRef.current = true;
  const editor = args.editorRef.current;
  editor?.setEditable(false);
  try {
    // ... existing body (flush/cancel/markClean/mutate/cache/reload)
  } finally {
    editor?.setEditable(true);
    inFlightRef.current = false;
  }
}, [args.editorRef]);
```

**Step 4: Run; verify pass**

**Step 5: Commit**

```
git add packages/client/src/hooks/useEditorMutation.ts packages/client/src/hooks/useEditorMutation.test.tsx
git commit -m "feat(client): useEditorMutation busy-guard rejects overlapping run"
```

---

## Task 9: Null editor ref safety

**Files:**
- Modify: `packages/client/src/hooks/useEditorMutation.test.tsx`

**Step 1: Add failing test**

```tsx
describe("useEditorMutation — null editor ref", () => {
  it("runs mutate, cache-clear, and reload when editorRef.current is null", async () => {
    const { projectEditor } = buildHandles();
    const editorRef: MutableRefObject<EditorHandle | null> = { current: null };
    const { clearAllCachedContent } = await import("./useContentCache");
    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor }),
    );

    const res = await result.current.run(async () => ({
      clearCacheFor: ["c1"],
      reloadActiveChapter: true,
      data: undefined,
    }));

    expect(res).toEqual({ ok: true, data: undefined });
    expect(vi.mocked(clearAllCachedContent)).toHaveBeenCalledWith(["c1"]);
    expect(projectEditor.reloadActiveChapter).toHaveBeenCalled();
  });
});
```

**Step 2: Run; verify pass** (the `editor?.` guards from Task 2 already cover this).

**Step 3: Commit**

```
git add packages/client/src/hooks/useEditorMutation.test.tsx
git commit -m "test(client): cover useEditorMutation null editor-ref safety"
```

---

## Task 10: Latest-ref pattern for `projectEditor`

**Files:**
- Modify: `packages/client/src/hooks/useEditorMutation.test.tsx`

**Step 1: Add failing test**

```tsx
describe("useEditorMutation — latest-ref pattern", () => {
  it("calls the latest projectEditor methods even when parent re-renders with new identities", async () => {
    const { editorRef } = buildHandles();

    const firstCancel = vi.fn();
    const firstReload = vi.fn(async () => true);
    const secondCancel = vi.fn();
    const secondReload = vi.fn(async () => true);

    const { result, rerender } = renderHook(
      (props: { cancel: () => void; reload: () => Promise<boolean> }) =>
        useEditorMutation({
          editorRef,
          projectEditor: {
            cancelPendingSaves: props.cancel,
            reloadActiveChapter: props.reload,
          },
        }),
      { initialProps: { cancel: firstCancel, reload: firstReload } },
    );

    rerender({ cancel: secondCancel, reload: secondReload });

    await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: true,
      data: undefined,
    }));

    expect(firstCancel).not.toHaveBeenCalled();
    expect(firstReload).not.toHaveBeenCalled();
    expect(secondCancel).toHaveBeenCalled();
    expect(secondReload).toHaveBeenCalled();
  });
});
```

**Step 2: Run; verify pass** (the `projectEditorRef` + `useEffect` sync from Task 1's scaffold already covers this).

**Step 3: Commit**

```
git add packages/client/src/hooks/useEditorMutation.test.tsx
git commit -m "test(client): verify useEditorMutation latest-ref pattern"
```

---

## Task 11: Migrate `handleRestoreSnapshot`

**Files:**
- Modify: `packages/client/src/pages/EditorPage.tsx` (lines 177–244)

**Context:** `restoreSnapshot()` (from `useSnapshotState`) returns `{ ok, reason?, staleChapterSwitch? }` and does **not** throw. The mutate callback must inspect this and either throw a sentinel for failure, or return a directive with `reloadActiveChapter: false` for the `staleChapterSwitch` case. The user-intent re-check (`viewingSnapshotRef.current`) moves inside the mutate callback (after markClean is safe — no harm in a defensive clean).

**TDD discipline for refactors:** The RED phase is already written — `EditorPageFeatures.test.tsx` covers all the snapshot-restore behaviors today. The task is to make it continue to pass under the new hook. A migration that needs a test change is a behavior change and violates the "no user-visible behavior change" Deliverable.

### RED — existing tests define the behavior

Before touching code, run the existing tests and capture the baseline:

```
npm test -w packages/client -- EditorPageFeatures
```

Expected: all tests PASS against the current (pre-migration) `handleRestoreSnapshot`. Note which tests exercise the snapshot-restore path (search for `restore`/`snapshot` in the test names). These are the tests that must continue passing after the migration.

### GREEN — migrate the call site, keep the tests passing

**Step 1: Prepare the sentinel and install the hook**

In `EditorPage.tsx`, near the top where other hooks are called, add:

```ts
import { useEditorMutation } from "../hooks/useEditorMutation";

// inside the component:
const mutation = useEditorMutation({
  editorRef,
  projectEditor: {
    cancelPendingSaves,
    reloadActiveChapter,
  },
});
```

Add a module-local sentinel for aborted-intent errors (used by the mutate callback to distinguish "user changed their mind" from server errors):

```ts
class RestoreAbortedError extends Error {}
class RestoreFailedError extends Error {
  constructor(
    public readonly reason: "corrupt_snapshot" | "cross_project_image" | "not_found" | "other",
  ) {
    super(`restore failed: ${reason}`);
  }
}
```

**Step 2: Rewrite `handleRestoreSnapshot`**

Replace the existing body with:

```ts
const handleRestoreSnapshot = useCallback(async () => {
  if (!viewingSnapshot || !activeChapter) return;

  type RestoreData = { staleChapterSwitch: boolean };

  const result = await mutation.run<RestoreData>(async () => {
    if (!viewingSnapshotRef.current) throw new RestoreAbortedError();
    const restore = await restoreSnapshot(viewingSnapshot.id);
    if (!restore.ok) {
      throw new RestoreFailedError(
        (restore.reason as RestoreFailedError["reason"]) ?? "other",
      );
    }
    const stale = Boolean(restore.staleChapterSwitch);
    return {
      clearCacheFor: stale ? [] : [activeChapter.id],
      reloadActiveChapter: !stale,
      data: { staleChapterSwitch: stale },
    };
  });

  if (result.ok) {
    if (!result.data.staleChapterSwitch) {
      snapshotPanelRef.current?.refreshSnapshots();
    }
    return;
  }
  if (result.stage === "busy") return;
  if (result.stage === "flush") {
    setActionError(STRINGS.snapshots.restoreFailedSaveFirst);
    return;
  }
  if (result.stage === "reload") {
    setActionError(STRINGS.snapshots.restoreSucceededReloadFailed);
    snapshotPanelRef.current?.refreshSnapshots();
    return;
  }
  // stage === "mutate"
  if (result.error instanceof RestoreAbortedError) return;
  if (result.error instanceof RestoreFailedError) {
    if (result.error.reason === "corrupt_snapshot") {
      setActionError(STRINGS.snapshots.restoreFailedCorrupt);
    } else if (result.error.reason === "cross_project_image") {
      setActionError(STRINGS.snapshots.restoreFailedCrossProjectImage);
    } else if (result.error.reason === "not_found") {
      setActionError(STRINGS.snapshots.restoreFailedNotFound);
    } else {
      setActionError(STRINGS.snapshots.restoreFailed);
    }
    return;
  }
  setActionError(STRINGS.snapshots.restoreFailed);
}, [
  viewingSnapshot,
  activeChapter,
  restoreSnapshot,
  snapshotPanelRef,
  setActionError,
  mutation,
]);
```

Note: the `viewingSnapshotRef.current` check now lives inside the mutate callback (after the hook's flush/markClean). A defensive `markClean` when aborting is harmless — the editor was already cleaned at the last save and is `setEditable(false)`; no typing could have dirtied it.

**Step 3: Run the existing EditorPageFeatures suite**

```
npm test -w packages/client -- EditorPageFeatures
```
Expected: PASS. If any snapshot-restore test fails, adjust the migration until it passes with no test modifications.

**Step 4: Run the full client suite**

```
npm test -w packages/client
```
Expected: PASS.

### REFACTOR — look for cleanup opportunities

With the migration in place:

- Are there imports no longer used in `EditorPage.tsx`? (`clearCachedContent` may be dead if `handleRestoreSnapshot` was the only user in this file.) Remove them.
- Is `viewingSnapshotRef` still declared and synced in a `useEffect`? If the intent re-check moved inside the mutate callback, the ref is still needed — keep it. If not used elsewhere, flag for removal in Tasks 12/13 and revisit in Task 16.
- Did `cancelPendingSaves` become redundant at this call site? (It shouldn't — it's still read through `projectEditorRef` inside the hook, but verify.)
- No new extractions warranted — the task is a single refactor; resist the urge to add helpers.

**Step 5: Commit**

```
git add packages/client/src/pages/EditorPage.tsx
git commit -m "refactor(client): migrate handleRestoreSnapshot to useEditorMutation"
```

---

## Task 12: Migrate `executeReplace`

**Files:**
- Modify: `packages/client/src/pages/EditorPage.tsx` (lines 246–358)

**Context:** `api.search.replace` throws on HTTP error. The mutate callback inspects the response and computes the directive. The `replaceInFlightRef` module-level ref is deleted because the hook's busy guard replaces it.

### RED — existing replace-all tests define the behavior

```
npm test -w packages/client -- EditorPageFeatures FindReplacePanel
```

Expected: PASS against pre-migration `executeReplace`. Note the replace-all / replace-in-chapter test cases — these are the behavior contract.

### GREEN — migrate the call site

**Step 1: Rewrite `executeReplace`**

Replace the existing body with:

```ts
const executeReplace = useCallback(
  async (frozen: {
    scope: { type: "project" } | { type: "chapter"; chapter_id: string };
    query: string;
    replacement: string;
    options: { case_sensitive: boolean; whole_word: boolean; regex: boolean };
  }) => {
    if (!project || !slug) return;

    setActionInfo(null);

    type ReplaceData = Awaited<ReturnType<typeof api.search.replace>>;

    const result = await mutation.run<ReplaceData>(async () => {
      const resp = await api.search.replace(
        slug,
        frozen.query,
        frozen.replacement,
        frozen.options,
        frozen.scope,
      );
      const current = getActiveChapter();
      const reload =
        !!current && resp.affected_chapter_ids.includes(current.id);
      return {
        clearCacheFor: resp.affected_chapter_ids,
        reloadActiveChapter: reload,
        data: resp,
      };
    });

    if (result.ok) {
      const resp = result.data;
      await findReplace.search(slug);
      snapshotPanelRef.current?.refreshSnapshots();
      refreshSnapshotCount();
      setActionInfo(STRINGS.findReplace.replaceSuccess(resp.replaced_count));
      if (resp.skipped_chapter_ids && resp.skipped_chapter_ids.length > 0) {
        setActionError(
          STRINGS.findReplace.skippedAfterReplace(resp.skipped_chapter_ids.length),
        );
      }
      return;
    }

    if (result.stage === "busy") return;
    if (result.stage === "flush") {
      setActionError(STRINGS.findReplace.replaceFailedSaveFirst);
      return;
    }
    if (result.stage === "reload") {
      // result.data carries the ReplaceResponse so we can show the real
      // replaced_count alongside the "reload failed" banner. No closure.
      await findReplace.search(slug);
      snapshotPanelRef.current?.refreshSnapshots();
      refreshSnapshotCount();
      setActionInfo(STRINGS.findReplace.replaceSuccess(result.data.replaced_count));
      setActionError(STRINGS.findReplace.replaceSucceededReloadFailed);
      return;
    }
    // stage === "mutate"
    const msg = mapReplaceErrorToMessage(result.error);
    if (msg) setActionError(msg);
  },
  [
    project,
    slug,
    findReplace,
    snapshotPanelRef,
    refreshSnapshotCount,
    getActiveChapter,
    setActionError,
    setActionInfo,
    mutation,
  ],
);
```

**Nuance:** the `stage: "reload"` variant of `MutationResult<T>` carries `data: T` (it's a partial success — the server committed, we just can't re-fetch). The sketch above reads `result.data.replaced_count` on the reload branch without any closure smuggling. If you find yourself reaching for a `let capturedResp` inside this function, stop — the hook's types already hand you the data on both success and reload failure.

**Step 2: Delete `replaceInFlightRef`**

Grep the file for `replaceInFlightRef` and remove the declaration + both read/write sites. The hook's busy guard replaces it entirely.

**Step 3: Run EditorPageFeatures + FindReplacePanel tests**

```
npm test -w packages/client -- EditorPageFeatures FindReplacePanel
```
Expected: PASS.

**Step 4: Run full client suite**

Expected: PASS.

### REFACTOR — look for cleanup opportunities

- `replaceInFlightRef` declaration and all its read/write sites must be gone. Grep to confirm: `grep -n "replaceInFlightRef" packages/client/src/pages/EditorPage.tsx` should return zero hits.
- `mapReplaceErrorToMessage` import is still used for the `stage: "mutate"` branch — keep it.
- Verify this task's `useEditorMutation` call reuses the single `mutation` instance created in Task 11 — do not add a second `useEditorMutation()` invocation. The cross-caller busy-guard invariant depends on this.

**Step 5: Commit**

```
git add packages/client/src/pages/EditorPage.tsx
git commit -m "refactor(client): migrate executeReplace to useEditorMutation"
```

---

## Task 13: Migrate `handleReplaceOne`

**Files:**
- Modify: `packages/client/src/pages/EditorPage.tsx` (lines 413–520)

**Context:** Same shape as `executeReplace` with an additional wrinkle: on 404 / match-not-found, the caller re-runs the search to refresh stale results. No closure needed — `MutationResult<T>` carries `data` on both success and reload-failure variants.

### RED — existing replace-one tests define the behavior

```
npm test -w packages/client -- FindReplacePanel
```

Expected: PASS. Note the single-match replace test cases and the "match not found" recovery cases.

### GREEN — migrate the call site

**Step 1: Rewrite `handleReplaceOne`**

Follow the same pattern as Task 12:

1. Replace the manual `replaceInFlightRef` / `setEditable` / `flushSave` / `markClean` scaffolding with `mutation.run<ReplaceResponse>(...)`.
2. On `result.ok === true` or `result.stage === "reload"`, read `result.data.replaced_count` directly — no closure capture needed.
3. On `result.stage === "mutate"` with a 404 or match-not-found error, call `findReplace.search(slug)` to refresh before rendering the banner. Preserve today's routing exactly.

The three divergences from `executeReplace` to preserve (read them from the current `handleReplaceOne` implementation in `EditorPage.tsx` — do NOT infer):

- **Match-scope argument:** the API call uses a `match_index` scope, not the full-query scope.
- **404 / match-not-found re-search:** on mutate-stage 404, re-run `findReplace.search(slug)` before showing the banner. The match the user clicked is gone; the search results need a refresh so the UI doesn't show a "Replace" button for a match that no longer exists.
- **Success messaging:** singular "Replaced one match" copy (or whatever the STRINGS key is — read the current implementation), not the plural count-based success string.

Do not invent new UI behavior — match existing strings and routing verbatim. The migration is a refactor, not a redesign.

**Step 2: Run tests**

```
npm test -w packages/client -- EditorPageFeatures FindReplacePanel
npm test -w packages/client
```
Expected: PASS.

### REFACTOR — confirm full migration

With all three migrations complete:

- `grep -n "editorRef.current?.flushSave\|editorRef.current?.markClean\|editorRef.current?.setEditable" packages/client/src/pages/EditorPage.tsx` should only hit call sites that are intentionally out of scope (none today — verify).
- `grep -n "replaceInFlightRef" packages/client/src/` must return zero hits across the package.
- `grep -c "useEditorMutation(" packages/client/src/pages/EditorPage.tsx` must return `1` — a second invocation breaks the cross-caller busy-guard contract.

**Step 3: Commit**

```
git add packages/client/src/pages/EditorPage.tsx
git commit -m "refactor(client): migrate handleReplaceOne to useEditorMutation"
```

---

## Task 14: Unmount-clobber integration regression test

**Files:**
- Create: `packages/client/src/pages/EditorPage.unmount-clobber.test.tsx`

**Step 1: Write the test**

The test renders `EditorPage`, types dirty content, triggers restore, holds the restore fetch mid-flight, simulates an unmount (chapter switch key change), resolves the fetch, and asserts that no stale `PATCH /api/chapters/<A>` fires with pre-restore content.

Use the existing `EditorPageFeatures.test.tsx` as a reference for how this repo mocks `fetch` and renders `EditorPage`. Adapt that harness; do not copy more than you need.

Core assertion:

```tsx
it("does not PATCH pre-restore content when editor unmounts during restore", async () => {
  // ... harness setup based on EditorPageFeatures ...
  // Intercept fetch. Resolve the PATCH auto-saves normally, but hold the
  // POST /api/snapshots/<id>/restore mid-flight.
  // Dirty the editor, trigger restore, unmount while restore is pending.
  // Resolve the restore. Assert the fetch log contains no PATCH against
  // chapter A with pre-restore content AFTER the restore resolves.
  const stalePATCHes = fetchLog.filter(
    (req) =>
      req.method === "PATCH" &&
      req.url.includes(`/api/chapters/${chapterAId}`) &&
      includesPreRestoreContent(req.body),
  );
  expect(stalePATCHes).toHaveLength(0);
});
```

**Step 2: Run; verify pass**

```
npm test -w packages/client -- unmount-clobber
```
Expected: PASS. The hook's `markClean` call before the mutation is what prevents the bug.

**Step 3: Sanity check — the test would catch the regression**

Temporarily remove the `editor?.markClean();` line from `useEditorMutation.ts`. Run the unmount-clobber test. It must FAIL. Put the line back. Run; must PASS again.

If the test does not fail without `markClean`, it is not actually exercising the bug — rework the harness before claiming done.

**Step 4: Commit**

```
git add packages/client/src/pages/EditorPage.unmount-clobber.test.tsx
git commit -m "test(client): regression test for editor unmount-clobber during mutation"
```

---

## Task 15: CLAUDE.md update

**Files:**
- Modify: `CLAUDE.md` (§Save-pipeline invariants, after the numbered list around line 88)

**Step 1: Add the closing sentence**

Insert immediately after invariant 5 in §Save-pipeline invariants:

```markdown
For mutation-via-server flows (snapshot restore, project-wide replace, and future similar operations), route through `useEditorMutation` in `packages/client/src/hooks/useEditorMutation.ts` — it enforces invariants 1–4 by construction. Hand-composing these steps is reserved for flows outside its scope (e.g. snapshot view, which does not mutate content).
```

**Step 2: Commit**

```
git add CLAUDE.md
git commit -m "docs(claude): point mutation flows at useEditorMutation"
```

---

## Task 16: Structural invariant verification

Before the final `make all` pass, explicitly verify the structural invariants called out as risks in the design. These checks are fast (most are grep) and catch the class of mistakes that only show up in production.

### Check 1 — No direct `editorRef.current` pokes in tests

The design flagged this as a risk: tests that reach into the editor ref directly would break under the hook's indirection.

```
grep -rn "editorRef.current" packages/client/src/__tests__/
```

Expected: zero hits. If there are hits, inspect each — a test that asserts against `editorRef.current` is likely asserting implementation details that the hook now owns. Rework to assert user-visible behavior through `EditorHandle` spies instead.

### Check 2 — `useEditorMutation` called exactly once in `EditorPage`

The cross-caller busy-guard contract depends on all three migrated call sites sharing one hook instance.

```
grep -c "useEditorMutation(" packages/client/src/pages/EditorPage.tsx
```

Expected: `1`. If 2+, consolidate into a single call.

### Check 3 — `replaceInFlightRef` is gone

The hook's busy guard replaces the ad-hoc ref. If it survives, both guards fire and the semantics diverge.

```
grep -rn "replaceInFlightRef" packages/client/src/
```

Expected: zero hits.

### Check 4 — Invariant 4 (seq-ref bump) still works

The design asserts the hook adds no new seq-refs and relies on `reloadActiveChapter`'s existing bump. The existing `useProjectEditor.test.ts` suite covers this. Run it explicitly:

```
npm test -w packages/client -- useProjectEditor
```

Expected: PASS. No changes expected in this test file.

### Check 5 — `handleSave` untouched

The save pipeline is explicitly out of scope.

```
git diff main -- packages/client/src/hooks/useProjectEditor.ts
```

Expected: no changes in `handleSave` (lines ~92–210). The only `useProjectEditor.ts` diff allowed in this PR is the non-behavioral kind (e.g., a single `// ` comment change), if any. If there are material changes, stop and explain.

### Commit (only if changes were needed)

If checks 1–3 revealed stale references and you cleaned them up:

```
git add -u
git commit -m "refactor(client): remove stale editor-ref and replace-inflight references"
```

If every check passes cleanly, no commit — just proceed to the next task.

---

## Task 17: Full verification + coverage

**Step 1: Run the full CI pass**

```
make all
```
Expected: lint + format + typecheck + coverage + e2e all green.

**Step 2: Check coverage meets the floor**

Per `vitest.config.ts`: 95% statements / 85% branches / 90% functions / 95% lines. The hook and its tests should comfortably exceed these. If anything is below floor, add targeted tests for the uncovered branches — do not lower thresholds.

**Step 3: Run e2e tests**

```
make e2e
```
Expected: PASS. The snapshot-restore, replace-all, and replace-one Playwright scenarios must be unaffected.

**Step 4: Only commit if verification required fixes**

If lint/format/typecheck raised issues, fix them and:

```
git add -u
git commit -m "chore: lint/format/typecheck fixes for useEditorMutation migration"
```

If the full pass is green without changes, nothing to commit — you are done.

---

## Done checklist

- [ ] `useEditorMutation.ts` exists and covers happy path, all failure stages, busy guard, null-ref safety, and latest-ref pattern.
- [ ] `useEditorMutation.test.tsx` exercises the above with zero test-output warnings.
- [ ] `handleRestoreSnapshot`, `executeReplace`, and `handleReplaceOne` all route through `mutation.run(...)`.
- [ ] `useEditorMutation()` is called exactly once in `EditorPage.tsx`.
- [ ] `replaceInFlightRef` is gone from `EditorPage.tsx`.
- [ ] No test in `packages/client/src/__tests__/` pokes `editorRef.current` directly.
- [ ] `handleSave` in `useProjectEditor.ts` is untouched (no behavior change in the save pipeline).
- [ ] `EditorPage.unmount-clobber.test.tsx` passes AND fails without `markClean`.
- [ ] `EditorPageFeatures.test.tsx` passes unmodified.
- [ ] CLAUDE.md §Save-pipeline invariants references `useEditorMutation`.
- [ ] `make all` is green.
- [ ] No new dependencies, no server changes, no migrations, no UI changes.

## Out of scope (explicit reminders)

- Do not touch `handleSave` or the auto-save retry loop.
- Do not migrate `SnapshotPanel.onView` or `SnapshotPanel.onBeforeCreate`.
- Do not consolidate error-to-UI-string mapping (Phase 4b.3).
- Do not fold sequence-ref patterns into the hook (Phase 4b.2).
- Do not add lint rules (Phase 4b.4).
- Do not add new features or UI changes.
