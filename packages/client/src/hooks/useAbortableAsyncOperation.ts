import { useCallback, useEffect, useMemo, useRef } from "react";

export type AbortableAsyncOperation = {
  /**
   * Abort the prior controller (if any), allocate a fresh AbortController,
   * and call fn(signal). Returns the promise from fn and the per-call
   * AbortSignal — use that signal (NOT a hook-level state probe) for
   * "did THIS operation abort" gates after the await.
   */
  run<T>(fn: (signal: AbortSignal) => Promise<T>): { promise: Promise<T>; signal: AbortSignal };
  /**
   * Abort the currently-tracked controller, if any. Use for explicit
   * external cancellation (panel-close, project-id change) that is NOT
   * paired with starting a new operation. After abort(), the next run()
   * starts fresh.
   */
  abort(): void;
};

export function useAbortableAsyncOperation(): AbortableAsyncOperation {
  const ref = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    // React 18 StrictMode runs mount/cleanup/mount in development. Reset
    // mountedRef on each mount so the second mount revives the post-
    // cleanup false. Without it, every subsequent run() returns a pre-
    // aborted signal in dev. Mirrors useAbortableSequence's StrictMode
    // discipline.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      ref.current?.abort();
      ref.current = null;
    };
  }, []);

  const run = useCallback(<T>(fn: (signal: AbortSignal) => Promise<T>) => {
    ref.current?.abort();
    const controller = new AbortController();
    if (!mountedRef.current) {
      // Post-unmount call: pre-abort so the consumer's
      // `if (signal.aborted) return` short-circuits without firing the
      // request. Matches useAbortableSequence's mountedRef gate.
      controller.abort();
    }
    ref.current = controller;
    return { promise: fn(controller.signal), signal: controller.signal };
  }, []);

  const abort = useCallback(() => {
    ref.current?.abort();
    ref.current = null;
  }, []);

  return useMemo(() => ({ run, abort }), [run, abort]);
}
