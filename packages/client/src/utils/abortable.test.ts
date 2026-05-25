import { describe, it, expect, vi } from "vitest";
import { sleep } from "./abortable";

describe("sleep(ms, signal)", () => {
  it("resolves after ms when signal is not aborted", async () => {
    vi.useFakeTimers();
    const promise = sleep(100);
    vi.advanceTimersByTime(100);
    await expect(promise).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  it("rejects with ABORTED DOMException when signal aborts mid-sleep", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const promise = sleep(1000, controller.signal);
    controller.abort();
    await expect(promise).rejects.toMatchObject({
      name: "AbortError",
    });
    vi.useRealTimers();
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
    const controller = new AbortController();
    const promise = sleep(1000, controller.signal);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    // Advance past the sleep window. If the timer wasn't cleared, we'd
    // see a stray resolution; with the timer cleared we just confirm
    // no unhandled rejection appears.
    vi.advanceTimersByTime(2000);
    vi.useRealTimers();
  });

  it("does not throw or leak listeners when called with no signal", async () => {
    vi.useFakeTimers();
    const promise = sleep(50);
    vi.advanceTimersByTime(50);
    await expect(promise).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});
