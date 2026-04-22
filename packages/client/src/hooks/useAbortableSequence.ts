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

  const makeToken = (epoch: number): SequenceToken => ({
    isStale: () => counterRef.current !== epoch,
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
    return () => {
      counterRef.current += 1;
    };
  }, []);

  return useMemo(() => ({ start, capture, abort }), [start, capture, abort]);
}
