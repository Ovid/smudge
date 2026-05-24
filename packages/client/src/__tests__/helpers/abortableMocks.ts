/**
 * Builds a promise that never resolves but rejects with the same
 * shape an aborted fetch produces (`DOMException("AbortError")`,
 * matching `packages/client/src/api/client.ts`'s `classifyFetchError`)
 * when the caller's signal aborts.
 *
 * S4 (review 2026-05-01): prior tests used `new Promise(() => {})`
 * placeholders to model an in-flight request that "never returns" for
 * the duration of the test. That form leaves a pending promise hanging
 * across teardown — vitest doesn't warn, but it's untidy and the mock
 * doesn't mirror the real api-client shape, so any code path that
 * catches AbortError specifically wouldn't be exercised by the mock.
 *
 * Use this helper inside `vi.mocked(api.x.y).mockImplementation((..., signal) => ...)`
 * so the per-call signal is honored: unmount, controller.abort(), or
 * any in-test abort triggers a clean rejection.
 *
 * The signal parameter is optional because some api surfaces type it
 * as `AbortSignal | undefined`; if the signal is absent, the promise
 * stays pending (same as the old `() => {}` shape).
 */
export function pendingUntilAbort<T>(signal: AbortSignal | undefined): Promise<T> {
  return new Promise<T>((_resolve, reject) => {
    signal?.addEventListener("abort", () => {
      reject(new DOMException("aborted", "AbortError"));
    });
  });
}
