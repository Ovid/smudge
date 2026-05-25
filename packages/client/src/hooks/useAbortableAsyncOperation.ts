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
   *
   * S10 (review 2026-05-25): the "currently-tracked controller" is the
   * one from the most recent run() call — which may have happened
   * after the caller saw the value they intended to cancel. Callers
   * who hold a reference to a specific operation should NOT use this
   * to cancel that specific operation; they should either (a) sequence
   * abort() against a known-most-recent run() (the typical case for
   * panel-close: there is at most one operation in flight at a time)
   * or (b) capture the per-call signal from run() and use AbortSignal
   * APIs directly. Calling abort() at an arbitrary later time aborts
   * whatever ran most recently — possibly a different operation than
   * the caller had in mind.
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
