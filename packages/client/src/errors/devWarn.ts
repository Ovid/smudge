export function devWarn(context: string, signal: AbortSignal, err: unknown): void {
  if (signal.aborted) return;
  if (import.meta.env?.DEV) console.warn(`${context}:`, err);
}
