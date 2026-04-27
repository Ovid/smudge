/**
 * Parse a port number from a raw env-var string, throwing on anything
 * that isn't a clean integer in [1, 65535].
 *
 * S1 (review 2026-04-26): Number.parseInt accepts a leading numeric
 * prefix and discards trailing garbage — `parseInt("3456abc", 10)` is
 * 3456. That defeats R3's fail-fast intent: a typo in .env (a stray
 * shell-comment append, a unit suffix, a "3456 ;" copied from
 * documentation) silently parses to its prefix and the dev server
 * binds to the wrong port. Reject anything that isn't a pure-digit
 * string up front so the error is loud and names the actual env var.
 *
 * S1 (review 2026-04-26 039ca1b): the regex also rejects leading
 * zeros (`"0080"`, `"0123"`). `parseInt("0080", 10)` returns 80
 * (decimal — not octal), so a stray octal-looking value would have
 * silently bound to a different port than the operator typed. Only
 * canonical decimal notation passes; "0" itself is rejected as out of
 * range below.
 *
 * Used by the server entrypoint (packages/server/src/index.ts) and —
 * duplicated inline because vite.config.ts is loaded by Vite's config
 * resolver under bare Node ESM, which cannot resolve the extensionless
 * re-exports inside `src/index.ts` (see
 * `packages/client/vite.config.ts:25-30` for the verbatim
 * `ERR_MODULE_NOT_FOUND` against `./schemas`) — the client's
 * vite.config.ts. The inline copy now uses the same `(raw, envName)`
 * signature as this function, so the bodies are byte-for-byte
 * comparable. Tests in this package are the canonical spec for both;
 * if you change the rejection rules, mirror the inline implementation
 * in vite.config.ts or the two will drift.
 */
export function parsePort(raw: string, envName: string): number {
  const trimmed = raw.trim();
  if (!/^(0|[1-9]\d*)$/.test(trimmed)) {
    throw new Error(
      `${envName} must be an integer between 1 and 65535. Received: ${JSON.stringify(raw)}`,
    );
  }
  // The regex above already restricts `trimmed` to a canonical-decimal
  // non-empty digit string (no leading zeros except the literal "0"),
  // so Number.parseInt cannot return NaN or a non-integer here. Only
  // the [1, 65535] range remains to enforce — and "0" falls through to
  // the range error below rather than passing.
  const port = Number.parseInt(trimmed, 10);
  if (port < 1 || port > 65535) {
    throw new Error(
      `${envName} must be an integer between 1 and 65535. Received: ${JSON.stringify(raw)}`,
    );
  }
  return port;
}
