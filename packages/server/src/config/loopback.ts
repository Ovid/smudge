import { isIP } from "node:net";

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
const DEFAULT_BIND_HOST = "127.0.0.1";

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

  // Anchored, so nothing may hide after the address. An IPv6 literal is
  // bracketed and a colon inside those brackets is part of the address rather
  // than a port separator, which is why the two shapes are separate arms.
  //
  // I6 (code review 2026-08-22): the bracketed arm used to take
  // `slice(0, indexOf("]") + 1)` and DISCARD whatever followed, so `[::1]evil.com`
  // read as `[::1]` and was accepted. Requiring end-of-string or `:port` is
  // what closes that; the unbracketed sibling was already strict by
  // construction. Latent rather than live — the WHATWG URL parser rejects the
  // bypass spellings, so no browser can produce one — but this function is the
  // only control left the moment Phase 7g.1 widens the bind, and a non-browser
  // client can spell any Host it likes.
  const parsed = /^(\[[0-9a-f:.]+\]|[^:[\]]+)(?::\d+)?$/.exec(host);
  if (!parsed) return false;
  const bare = parsed[1] as string;

  // `isIP` range-checks the octets, which the previous `/^127(?:\.\d{1,3}){3}$/`
  // did not — it accepted `127.999.999.999`. Only the 127/8 block counts as
  // loopback, so the prefix test stays.
  //
  // A trailing root dot is a valid spelling of the same name and a browser
  // sends it verbatim for `http://localhost./`, where it used to 400.
  return (
    bare === "localhost" ||
    bare === "localhost." ||
    bare === "[::1]" ||
    (isIP(bare) === 4 && bare.startsWith("127."))
  );
}
