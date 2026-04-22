import { useCallback, useEffect, useMemo, useRef } from "react";

export type SequenceToken = {
  isStale(): boolean;
};

export type AbortableSequence = {
  start(): SequenceToken;
  capture(): SequenceToken;
  abort(): void;
};

export function useAbortableSequence(): AbortableSequence {
  const counterRef = useRef(0);
  const mountedRef = useRef(true);

  // Token staleness combines two conditions:
  //   1. Epoch mismatch (a later start/abort bumped the counter), OR
  //   2. The owning component has unmounted.
  // Condition 2 is what lets start()/capture() called after unmount
  // return a stale token, closing the window where a post-unmount
  // setState would otherwise sneak through.
  const makeToken = (epoch: number): SequenceToken => ({
    isStale: () => !mountedRef.current || counterRef.current !== epoch,
  });

  const start = useCallback((): SequenceToken => {
    counterRef.current += 1;
    return makeToken(counterRef.current);
  }, []);

  const capture = useCallback((): SequenceToken => {
    return makeToken(counterRef.current);
  }, []);

  const abort = useCallback((): void => {
    counterRef.current += 1;
  }, []);

  useEffect(() => {
    // React 18 StrictMode runs mount/cleanup/mount in development. Without
    // this line, the first cleanup sets mountedRef.current = false and the
    // second mount doesn't revive it — every subsequent token reports
    // isStale() true, silently breaking every flow that gates on the hook
    // (auto-save, chapter select, snapshot view). Re-setting on each mount
    // closes the pair so production (single mount) and dev (double mount)
    // behave identically.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      counterRef.current += 1;
    };
  }, []);

  return useMemo(() => ({ start, capture, abort }), [start, capture, abort]);
}
