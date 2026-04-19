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
  | { ok: false; stage: MutationStage; error?: unknown };

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
    const res = await result.current.run(async () => ({
      clearCacheFor: ["c1"],
      reloadActiveChapter: true,
      data: undefined,
    }));

    expect(res).toEqual({
      ok: false,
      stage: "reload",
      error: "reload-failed-msg",
    });
    expect(editorRef.current!.setEditable).toHaveBeenLastCalledWith(true);
    // cache-clear still happened — server committed the mutation
    const { clearAllCachedContent } = await import("./useContentCache");
    expect(vi.mocked(clearAllCachedContent)).toHaveBeenCalledWith(["c1"]);
  });

  it("returns stage 'reload' when reloadActiveChapter returns false without onError", async () => {
    const { editorRef, projectEditor } = buildHandles();
    projectEditor.reloadActiveChapter = vi.fn(async () => false);

    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor }),
    );
    const res = await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: true,
      data: undefined,
    }));

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.stage).toBe("reload");
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
    return { ok: false, stage: "reload", error: reloadMessage };
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
      await findReplace.search(slug);
      snapshotPanelRef.current?.refreshSnapshots();
      refreshSnapshotCount();
      setActionInfo(STRINGS.findReplace.replaceSuccess(/* count unknown */ 0));
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

**Important nuance:** the reload-stage branch above loses the `replaced_count` because the data is only available on `ok: true`. Today's code shows success + reload-failed in the same run. To preserve this, thread the response through by capturing it in an outer `let` scoped to the `executeReplace` call, or widen `MutationResult` to always carry `data` on non-busy failures. **For this plan, use the closure approach** (single `let` inside `executeReplace`):

```ts
let capturedResp: ReplaceData | null = null;
const result = await mutation.run<ReplaceData>(async () => {
  const resp = await api.search.replace(...);
  capturedResp = resp;
  // ... directive ...
});
// then in the reload branch:
if (result.stage === "reload" && capturedResp) {
  setActionInfo(STRINGS.findReplace.replaceSuccess(capturedResp.replaced_count));
  setActionError(STRINGS.findReplace.replaceSucceededReloadFailed);
  // ... the rest
}
```

This is the one place a closure is legitimate — the response is also needed on the reload-failure path, which the discriminated result doesn't carry.

**Step 2: Delete `replaceInFlightRef`**

Grep the file for `replaceInFlightRef` and remove the declaration + both read/write sites. The hook's busy guard replaces it entirely.

**Step 3: Run EditorPageFeatures + FindReplacePanel tests**

```
npm test -w packages/client -- EditorPageFeatures FindReplacePanel
```
Expected: PASS.

**Step 4: Run full client suite**

Expected: PASS.

**Step 5: Commit**

```
git add packages/client/src/pages/EditorPage.tsx
git commit -m "refactor(client): migrate executeReplace to useEditorMutation"
```

---

## Task 13: Migrate `handleReplaceOne`

**Files:**
- Modify: `packages/client/src/pages/EditorPage.tsx` (lines 413–520)

**Context:** Same shape as `executeReplace` with an additional wrinkle: on 404 / match-not-found, the caller re-runs the search to refresh stale results. Same closure-for-response pattern applies.

**Step 1: Rewrite `handleReplaceOne`**

Follow the same pattern as Task 12:

1. Capture the response via a local `let` for the reload-failure path.
2. Replace the manual `replaceInFlightRef` / `setEditable` / `flushSave` / `markClean` scaffolding with `mutation.run<...>(...)`.
3. On `result.stage === "mutate"` with a 404 or match-not-found error code, call `findReplace.search(slug)` to refresh before rendering the banner (preserve today's behavior exactly — grep for `handleReplaceOne` in the existing file for the exact branches).

Do not invent new UI behavior — match existing strings and routing verbatim. The migration is a refactor, not a redesign.

**Step 2: Run tests**

```
npm test -w packages/client -- EditorPageFeatures FindReplacePanel
npm test -w packages/client
```
Expected: PASS.

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

## Task 16: Full verification + coverage

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
- [ ] `replaceInFlightRef` is gone from `EditorPage.tsx`.
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
