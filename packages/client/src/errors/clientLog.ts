/**
 * DEV-gated client logging (F-9).
 *
 * Bare `console.warn` / `console.error` in client code log raw error objects to
 * the production browser console on every failure. These helpers gate on
 * `import.meta.env.DEV`, so they are no-ops in a production build and surface
 * for debugging in dev. They forward their arguments verbatim, so they are a
 * drop-in for the bare console calls they replace (same message, same level).
 *
 * For logging that must additionally be suppressed when an `AbortSignal` has
 * fired (superseded/unmounted async work), use {@link devWarn} instead.
 *
 * Enforced by the `no-console` ESLint rule scoped to `packages/client/src`
 * (this module and `devWarn.ts` are the only allowed `console` call sites).
 */
export function clientWarn(...args: unknown[]): void {
  if (import.meta.env?.DEV) console.warn(...args);
}

export function clientError(...args: unknown[]): void {
  if (import.meta.env?.DEV) console.error(...args);
}
