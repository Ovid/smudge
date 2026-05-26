// Abortable setTimeout. Resolves after `ms`, or rejects with an
// AbortError DOMException if `signal` aborts (either before the call or
// during the wait). Used by retry-with-backoff sites (chapterStatuses
// retry in EditorPage, save retry in useProjectEditor) so unmount/
// navigation can cancel the backoff window cleanly without a stray
// resolution firing on a torn-down hook.
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timerId = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timerId);
      reject(new DOMException("Aborted", "AbortError"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
