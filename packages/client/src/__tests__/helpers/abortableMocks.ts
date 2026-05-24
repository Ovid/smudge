import { ApiRequestError } from "../../api/client";

/**
 * Builds a promise that never resolves but rejects with the post-
 * classification shape consumers actually see when their fetch aborts:
 * `ApiRequestError(0, "ABORTED")`. Production fetches go through
 * `classifyFetchError` in `packages/client/src/api/client.ts`, which
 * wraps every `DOMException("AbortError")` into that ApiRequestError —
 * so consumer catch blocks key on `instanceof ApiRequestError` (via
 * `isApiError`/`isAborted`/`apiErrorMapper`) and a raw DOMException
 * rejection would route them through production-impossible arms.
 *
 * S4 (review 2026-05-01): prior tests used `new Promise(() => {})`
 * placeholders to model an in-flight request that "never returns" for
 * the duration of the test. That form leaves a pending promise hanging
 * across teardown — vitest doesn't warn, but it's untidy and the mock
 * doesn't mirror the real api-client shape, so any code path that
 * catches the ABORTED error specifically wouldn't be exercised by the
 * mock.
 *
 * Use this helper inside `vi.mocked(api.x.y).mockImplementation((..., signal) => ...)`
 * so the per-call signal is honored: unmount, controller.abort(), or
 * any in-test abort triggers a clean rejection.
 *
 * The signal parameter is optional because some api surfaces type it
 * as `AbortSignal | undefined`; if the signal is absent, the promise
 * stays pending (same as the old `() => {}` shape).
 *
 * S2 (review 2026-05-24): if the signal is already aborted at entry —
 * which happens when `useAbortableAsyncOperation.run()` is invoked
 * post-unmount and hands the consumer a pre-aborted signal — reject
 * synchronously rather than registering a listener that will never
 * fire. The listener uses `{ once: true }` so repeated calls against
 * the same signal don't leak handlers.
 */
export function pendingUntilAbort<T>(signal: AbortSignal | undefined): Promise<T> {
  return new Promise<T>((_resolve, reject) => {
    if (signal?.aborted) {
      reject(new ApiRequestError("[dev] Request aborted", 0, "ABORTED"));
      return;
    }
    signal?.addEventListener(
      "abort",
      () => {
        reject(new ApiRequestError("[dev] Request aborted", 0, "ABORTED"));
      },
      { once: true },
    );
  });
}
