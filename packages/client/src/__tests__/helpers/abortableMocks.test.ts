import { describe, it, expect } from "vitest";
import { pendingUntilAbort } from "./abortableMocks";
import { ApiRequestError } from "../../api/client";

describe("pendingUntilAbort", () => {
  it("rejects with ApiRequestError(0, 'ABORTED') when the signal aborts", async () => {
    // S1 (review 2026-05-24): the rejection shape must mirror what
    // production consumers see — classifyFetchError in api/client.ts
    // wraps every DOMException("AbortError") from fetch into an
    // ApiRequestError(0, "ABORTED"). isApiError/isAborted predicates
    // (and the apiErrorMapper) key on instanceof ApiRequestError, so a
    // raw DOMException rejection here routes consumers through
    // production-impossible branches.
    const controller = new AbortController();
    const promise = pendingUntilAbort<number>(controller.signal);
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(ApiRequestError);
    await expect(promise).rejects.toMatchObject({ status: 0, code: "ABORTED" });
  });

  it("rejects synchronously when the signal is already aborted at entry", async () => {
    // S2 (review 2026-05-24): addEventListener("abort", ...) only fires
    // on the abort transition; a signal that is already aborted at
    // attach time would never trigger the listener and the promise would
    // hang. useAbortableAsyncOperation.run() deliberately hands the
    // consumer a pre-aborted signal when invoked post-unmount, so a
    // future post-unmount run() through this helper must reject —
    // otherwise vitest teardown hangs. Check signal.aborted up front.
    const controller = new AbortController();
    controller.abort();
    const promise = pendingUntilAbort<number>(controller.signal);
    await expect(promise).rejects.toBeInstanceOf(ApiRequestError);
    await expect(promise).rejects.toMatchObject({ status: 0, code: "ABORTED" });
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

  it("stays pending while the signal is still un-aborted", async () => {
    // S4 (review 2026-05-24): prior name promised an abort-path
    // assertion the body never made. Renamed for accuracy — the body
    // only verifies pending-while-not-aborted; the abort-then-reject
    // path is covered by the first two tests above.
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
