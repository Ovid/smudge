import { vi } from "vitest";
import { SAVE_BACKOFF_MS } from "../../hooks/useProjectEditor";

/**
 * Advance fake timers through the editor's full save-retry exponential
 * backoff. Iterates `SAVE_BACKOFF_MS` from the hook so the test-side
 * timeline cannot drift from production if the schedule changes.
 *
 * Caller must already be inside `vi.useFakeTimers()`, and (in render
 * contexts) inside an outer `act()` so React flushes the resulting
 * state updates.
 */
export async function flushSaveRetries(): Promise<void> {
  for (const ms of SAVE_BACKOFF_MS) {
    await vi.advanceTimersByTimeAsync(ms);
  }
}
