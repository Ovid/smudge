import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAbortableAsyncOperation } from "./useAbortableAsyncOperation";

// `void s;` marks the signal as intentionally unused (silences
// noUnusedParameters without disabling it suite-wide). Extracting the two
// idioms keeps the per-test bodies focused on the behaviour under test
// rather than the test-double scaffolding.
const neverResolves = (s: AbortSignal) => new Promise<void>(() => void s);
const resolveImmediately = (s: AbortSignal) => {
  void s;
  return Promise.resolve();
};

describe("useAbortableAsyncOperation", () => {
  it("run() aborts the prior controller before creating a fresh one", () => {
    const { result } = renderHook(() => useAbortableAsyncOperation());
    const first = result.current.run(neverResolves);
    const second = result.current.run(neverResolves);
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
  });

  it("run() returns the same AbortSignal that fn() receives", () => {
    const { result } = renderHook(() => useAbortableAsyncOperation());
    let received: AbortSignal | null = null;
    const { signal } = result.current.run((s) => {
      received = s;
      return Promise.resolve();
    });
    expect(received).toBe(signal);
  });

  it("abort() aborts the currently-tracked controller", () => {
    const { result } = renderHook(() => useAbortableAsyncOperation());
    const { signal } = result.current.run(neverResolves);
    result.current.abort();
    expect(signal.aborted).toBe(true);
  });

  it("a run() after abort() returns a fresh non-aborted signal", () => {
    const { result } = renderHook(() => useAbortableAsyncOperation());
    result.current.run(neverResolves);
    result.current.abort();
    const next = result.current.run(resolveImmediately);
    expect(next.signal.aborted).toBe(false);
  });

  it("abort() on an empty hook (no in-flight controller) is a no-op and does not throw", () => {
    const { result } = renderHook(() => useAbortableAsyncOperation());
    expect(() => result.current.abort()).not.toThrow();
  });

  it("unmount aborts the in-flight controller", () => {
    const { result, unmount } = renderHook(() => useAbortableAsyncOperation());
    const { signal } = result.current.run(neverResolves);
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it("run() called after unmount returns a pre-aborted signal", () => {
    const { result, unmount } = renderHook(() => useAbortableAsyncOperation());
    unmount();
    const { signal } = result.current.run(resolveImmediately);
    expect(signal.aborted).toBe(true);
  });

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
    const { signal } = result.current.run(resolveImmediately);
    expect(signal.aborted).toBe(false);
  });

  it("run() during initial render returns a non-pre-aborted signal", () => {
    // Pins that useAbortableAsyncOperation.ts initializes mountedRef to
    // `useRef(true)`, not `useRef(false)`. If a future refactor flipped
    // the default to false, the mount effect would still flip it to true
    // *after* render completes — so every consumer that calls run() in
    // the render body (during the initial render, before effects commit)
    // would silently produce pre-aborted signals. Call run() during the
    // same render pass so the assertion captures the value *before* the
    // effect has had a chance to revive mountedRef. Mirrors
    // useAbortableSequence.test.ts:108-126.
    let renderPhaseAborted: boolean | null = null;
    renderHook(() => {
      const op = useAbortableAsyncOperation();
      if (renderPhaseAborted === null) {
        renderPhaseAborted = op.run(resolveImmediately).signal.aborted;
      }
      return op;
    });
    expect(renderPhaseAborted).toBe(false);
  });

  it("returns a stable AbortableAsyncOperation object across renders", () => {
    const { result, rerender } = renderHook(() => useAbortableAsyncOperation());
    const first = result.current;
    rerender();
    const second = result.current;
    expect(second).toBe(first);
    expect(second.run).toBe(first.run);
    expect(second.abort).toBe(first.abort);
  });

  it("two instances in the same component are independent", () => {
    const { result } = renderHook(() => ({
      a: useAbortableAsyncOperation(),
      b: useAbortableAsyncOperation(),
    }));
    const aRun = result.current.a.run(neverResolves);
    const bRun = result.current.b.run(neverResolves);
    act(() => {
      result.current.a.abort();
    });
    expect(aRun.signal.aborted).toBe(true);
    expect(bRun.signal.aborted).toBe(false);
  });

  // Pins design §Test strategy: the hook never logs. Without an explicit
  // assertion, a future refactor could introduce a warn/error path that
  // the suite-level zero-warnings rule would catch but not attribute to
  // this primitive specifically.
  it("emits no console output during any operation", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, unmount } = renderHook(() => useAbortableAsyncOperation());
    result.current.run(resolveImmediately);
    result.current.run(resolveImmediately);
    result.current.abort();
    unmount();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
