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
 * Used by both the server entrypoint (packages/server/src/index.ts)
 * and — duplicated inline because vite.config.ts is loaded by Vite's
 * config resolver under bare Node ESM, which cannot follow
 * @smudge/shared's `main: ./src/index.ts` chain — the client's
 * vite.config.ts. Tests in this package are the canonical reference;
 * if you change the rejection rules, mirror the inline implementation
 * in vite.config.ts or the two will drift.
 */
export function parsePort(raw: string, envName: string): number {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `${envName} must be an integer between 1 and 65535. Received: ${JSON.stringify(raw)}`,
    );
  }
  const port = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `${envName} must be an integer between 1 and 65535. Received: ${JSON.stringify(raw)}`,
    );
  }
  return port;
}
