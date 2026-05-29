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

// S2026-05-29 [S5]: normalize the DEV check explicitly inside each call.
// The original `import.meta.env?.DEV` optional-chain hides the "silent
// everywhere" failure mode in any context that doesn't populate
// `import.meta.env` (e.g. a future Electron preload, SSR, or Storybook
// MDX consumer): the chain resolves to `undefined`, which is falsy, so
// the helpers silently no-op everywhere. The explicit `typeof` + `===
// true` form keeps the same observable behaviour under Vite + Vitest
// (where the env is always populated) but makes the "env-undefined"
// branch visible and intentional rather than accidental. Computed
// per-call rather than at module load so vitest's `vi.stubEnv("DEV",
// false)` can still flip the gate at test time.
function isDev(): boolean {
  return typeof import.meta.env !== "undefined" && import.meta.env.DEV === true;
}

export function clientWarn(...args: unknown[]): void {
  if (isDev()) console.warn(...args);
}

export function clientError(...args: unknown[]): void {
  if (isDev()) console.error(...args);
}
