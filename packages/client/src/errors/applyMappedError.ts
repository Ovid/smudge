import type { MappedError } from "./apiErrorMapper";
import type { ApiErrorScope } from "./scopes";
import type { ScopeExtras } from "./scopeExtras";

/** Returned from a handler to halt subsequent callbacks. Mirrors the
 * pre-helper early-return pattern at sites where `possiblyCommitted`
 * recovery should suppress the extras/message branches (e.g.
 * ImageGallery.handleDelete's announce()). */
export const STOP = Symbol("applyMappedError.STOP");

export interface ApplyMappedErrorHandlers<S extends ApiErrorScope> {
  onMessage?: (message: string) => void | typeof STOP;
  onCommitted?: () => void | typeof STOP;
  onTransient?: () => void | typeof STOP;
  onExtras?: (extras: ScopeExtras<S>) => void | typeof STOP;
}

export function applyMappedError<S extends ApiErrorScope>(
  mapped: MappedError<S>,
  handlers: ApplyMappedErrorHandlers<S>,
): void {
  if (mapped.message === null) return;
  if (mapped.possiblyCommitted) {
    if (handlers.onCommitted?.() === STOP) return;
  }
  if (mapped.transient) {
    if (handlers.onTransient?.() === STOP) return;
  }
  if (mapped.extras !== undefined) {
    if (handlers.onExtras?.(mapped.extras as ScopeExtras<S>) === STOP) return;
  }
  handlers.onMessage?.(mapped.message);
}
