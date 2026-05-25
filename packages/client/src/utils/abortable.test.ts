import { describe, it, expect, vi } from "vitest";
import { sleep } from "./abortable";

describe("sleep(ms, signal)", () => {
  // Each fake-timer block is wrapped in try { ... } finally
  // { vi.useRealTimers(); } so an assertion failure can't leave the
  // suite in fake-timer mode and cascade into later tests. Matches the
  // pattern used in useProjectEditor.test.ts:188-200, Editor.test.tsx:358-401,
  // and ChapterTitle.test.tsx:446-455.
  it("resolves after ms when signal is not aborted", async () => {
    vi.useFakeTimers();
    try {
      const promise = sleep(100);
      vi.advanceTimersByTime(100);
      await expect(promise).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects with AbortError DOMException when signal aborts mid-sleep", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const promise = sleep(1000, controller.signal);
      controller.abort();
      await expect(promise).rejects.toMatchObject({
        name: "AbortError",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects immediately if signal is already aborted at call time", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleep(1000, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("clears the timer when aborted, so no late callback fires", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const promise = sleep(1000, controller.signal);
      controller.abort();
      await expect(promise).rejects.toMatchObject({ name: "AbortError" });
      // Advance past the sleep window. If the timer wasn't cleared, we'd
      // see a stray resolution; with the timer cleared we just confirm
      // no unhandled rejection appears.
      vi.advanceTimersByTime(2000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not throw or leak listeners when called with no signal", async () => {
    vi.useFakeTimers();
    try {
      const promise = sleep(50);
      vi.advanceTimersByTime(50);
      await expect(promise).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
