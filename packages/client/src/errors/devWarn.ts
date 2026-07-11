import { clientWarn } from "./clientLog";

export function devWarn(context: string, signal: AbortSignal, err: unknown): void {
  if (signal.aborted) return;
  // F-10: route through clientWarn, which gates on the safe isDev() form
  // rather than the discouraged `import.meta.env?.DEV` silent-no-op idiom.
  clientWarn(`${context}:`, err);
}
