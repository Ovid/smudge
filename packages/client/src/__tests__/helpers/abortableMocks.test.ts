import { describe, it, expect } from "vitest";
import { pendingUntilAbort } from "./abortableMocks";

describe("pendingUntilAbort", () => {
  it("rejects with DOMException('AbortError') when the signal aborts", async () => {
    const controller = new AbortController();
    const promise = pendingUntilAbort<number>(controller.signal);
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(DOMException);
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("stays pending when the signal is undefined", async () => {
    const promise = pendingUntilAbort<number>(undefined);
    // Race against a microtask-resolved sentinel; if the helper resolved
    // or rejected by now, settled !== "pending".
    const sentinel = Symbol("pending");
    const settled = await Promise.race([
      promise.then(
        () => "resolved" as const,
        () => "rejected" as const,
      ),
      Promise.resolve(sentinel),
    ]);
    expect(settled).toBe(sentinel);
  });

  it("does not resolve before abort, even after the signal is provided", async () => {
    const controller = new AbortController();
    const promise = pendingUntilAbort<number>(controller.signal);
    const sentinel = Symbol("pending");
    const settled = await Promise.race([
      promise.then(
        () => "resolved" as const,
        () => "rejected" as const,
      ),
      Promise.resolve(sentinel),
    ]);
    expect(settled).toBe(sentinel);
  });
});
