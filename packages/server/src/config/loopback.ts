/**
 * F-02 (architecture report 2026-08-22): the loopback boundary.
 *
 * Two questions with one answer — which interface the server binds, and which
 * `Host` values name this machine. They live together because they are the same
 * decision seen from the two ends of a connection, and because a future change
 * to one is almost always wrong without the matching change to the other.
 *
 * Deliberately reads NO environment variable. `docs/roadmap.md` Phase 7g.1 owns
 * `SMUDGE_BIND_ADDRESS` and currently plans `0.0.0.0` as its default; that
 * default is the state this finding exists to remove, so the unsafe value is
 * not reachable by configuration until 7g.1 revisits it deliberately. Node
 * treats both `undefined` and `""` as the unspecified address, so an env var
 * added carelessly here would silently restore the flaw — `SMUDGE_BIND_ADDRESS=`
 * (set but empty) binds every interface.
 *
 * When a Dockerfile lands, a container reached at its own IP or service name
 * sends that name in `Host`, so both halves need widening together. That is the
 * same 7g.1 conversation, and it is a decision to record, not a default to
 * inherit.
 */
export const DEFAULT_BIND_HOST = "127.0.0.1";

/** The interface the HTTP server binds. */
export function getBindHost(): string {
  return DEFAULT_BIND_HOST;
}

/**
 * Does this `Host` header name the local machine?
 *
 * Fails closed: an absent or unparseable header is not loopback. HTTP/1.1
 * requires `Host`, so its absence is not a shape any supported client produces.
 */
export function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.trim().toLowerCase();

  // An IPv6 literal is bracketed, so a colon inside the brackets is part of the
  // address rather than a port separator — split on ":" only outside them.
  const bare = host.startsWith("[")
    ? host.slice(0, host.indexOf("]") + 1)
    : (host.split(":")[0] ?? "");

  return bare === "localhost" || bare === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(bare);
}
