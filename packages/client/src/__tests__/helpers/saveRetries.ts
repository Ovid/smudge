import { vi } from "vitest";

/**
 * Advance fake timers through the editor's full save-retry exponential
 * backoff (2s + 4s + 8s = 14s of sleeps). Mirrors `BACKOFF_MS` in
 * `packages/client/src/hooks/useProjectEditor.ts:284` — keep in sync if
 * the production schedule changes.
 *
 * Caller must already be inside `vi.useFakeTimers()`, and (in render
 * contexts) inside an outer `act()` so React flushes the resulting
 * state updates.
 */
export async function flushSaveRetries(): Promise<void> {
  await vi.advanceTimersByTimeAsync(2_000);
  await vi.advanceTimersByTimeAsync(4_000);
  await vi.advanceTimersByTimeAsync(8_000);
}
