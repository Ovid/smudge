import type { MappedError } from "./apiErrorMapper";
import type { ApiErrorScope } from "./scopes";
import type { ScopeExtras } from "./scopeExtras";

/** Returned from a handler to halt subsequent callbacks. Mirrors the
 * pre-helper early-return pattern at sites where `possiblyCommitted`
 * recovery should suppress the extras/message branches (e.g.
 * ImageGallery.handleDelete's announce()). */
export const STOP = Symbol("applyMappedError.STOP");

// `void | typeof STOP` lets call sites pass either a void-returning
// setter (`setError`) or an arrow that explicitly returns STOP. The
// `no-invalid-void-type` rule flags `void` in unions, but the alternative
// (`typeof STOP | undefined`) would forbid void-returning setters at the
// call site — see Pattern P1 vs Pattern P2 in
// docs/plans/2026-05-26-consumer-recovery-completeness-plan.md.
export interface ApplyMappedErrorHandlers<S extends ApiErrorScope> {
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  onMessage?: (message: string) => void | typeof STOP;
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  onCommitted?: () => void | typeof STOP;
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  onTransient?: () => void | typeof STOP;
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
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
