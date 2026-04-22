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

  it("start() called after unmount returns a stale token", () => {
    // Pins CLAUDE.md §Save-Pipeline Invariants rule 4: "component unmount
    // auto-aborts." A post-unmount start() must NOT open a window in which
    // downstream setState calls fire on an unmounted component. React 18
    // silently swallows setState after unmount, but that is the wrong
    // layer to rely on — the hook contract is that any token obtained
    // after unmount reports isStale() true.
    const { result, unmount } = renderHook(() => useAbortableSequence());
    unmount();
    const token = result.current.start();
    expect(token.isStale()).toBe(true);
  });

  it("capture() called after unmount returns a stale token", () => {
    const { result, unmount } = renderHook(() => useAbortableSequence());
    unmount();
    const token = result.current.capture();
    expect(token.isStale()).toBe(true);
  });

  it("survives React StrictMode's mount→cleanup→mount double-effect", async () => {
    // React 18 StrictMode runs useEffect twice in development: mount,
    // cleanup, mount. A naive cleanup-only `mountedRef = false` would flip
    // the flag on the first cleanup and never revive it, silently breaking
    // every consumer (auto-save, chapter select, snapshot view) because
    // every token reports isStale() = true. Pin that re-mount restores
    // the mounted flag so StrictMode dev builds behave like prod.
    const React = await import("react");
    const { result } = renderHook(() => useAbortableSequence(), {
      wrapper: ({ children }) => React.createElement(React.StrictMode, null, children),
    });
    const token = result.current.start();
    // If the cleanup's `mountedRef = false` survived the re-mount, this
    // token would already be stale before any epoch change.
    expect(token.isStale()).toBe(false);
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
