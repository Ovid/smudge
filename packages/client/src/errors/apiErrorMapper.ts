import { ApiRequestError } from "../api/client";
import { SCOPES, type ApiErrorScope } from "./scopes";

export type MappedError = {
  message: string | null;
  possiblyCommitted: boolean;
  transient: boolean;
  extras?: Record<string, unknown>;
};

export type ScopeEntry = {
  fallback: string;
  committed?: string;
  network?: string;
  byCode?: Partial<Record<string, string>>;
  byStatus?: Partial<Record<number, string>>;
  extrasFrom?: (err: ApiRequestError) => Record<string, unknown> | undefined;
  // S8 (review 2026-04-24): codes whose byCode hit also means "the
  // server committed the mutation but couldn't serialize the row" —
  // e.g. RESTORE_READ_FAILURE on trash.restoreChapter,
  // READ_AFTER_CREATE_FAILURE on chapter.create. Listing them here
  // lets the mapper surface possiblyCommitted=true for these codes
  // too, so call sites don't have to re-implement the inline ladder
  // `possiblyCommitted || err.code === "RESTORE_READ_FAILURE"`. Adding
  // a new committed-intent code in the future means updating the scope
  // alone rather than every call site.
  committedCodes?: string[];
};

function isApiRequestError(err: unknown): err is ApiRequestError {
  return err instanceof ApiRequestError;
}

// I10 helpers: the DoD forbids `err instanceof ApiRequestError` for
// control flow at call sites. These helpers centralize the common
// predicates here so components/hooks depend on the errors module
// rather than on ApiRequestError directly.

/** Type guard. Narrows `unknown` to ApiRequestError — use when call sites
 * need access to err.status / err.code / err.extras to route the error
 * (e.g. returning the raw error to a caller, reading extras). Prefer
 * `isAborted`/`isNotFound`/`isClientError` when those cover the predicate
 * on their own. */
export function isApiError(err: unknown): err is ApiRequestError {
  return isApiRequestError(err);
}

/** True when the error is the transport-layer ABORTED signal. Prefer
 * this over checking err.code === "ABORTED" at call sites; the mapper's
 * message===null convention is the other canonical way to spot an abort
 * and should continue to be used for catches that already call
 * mapApiError. Type guard so callers can read err.status/err.code if
 * needed after the check. */
export function isAborted(err: unknown): err is ApiRequestError {
  return isApiRequestError(err) && err.code === "ABORTED";
}

/** True when the error is an HTTP 404. Common short-circuit for GETs
 * whose target has been deleted and for delete calls that idempotently
 * succeed when the row is already gone. */
export function isNotFound(err: unknown): err is ApiRequestError {
  return isApiRequestError(err) && err.status === 404;
}

/** True when the error is a 4xx client error (not a transport wrap like
 * ABORTED/NETWORK). Use to skip retries that cannot succeed against a
 * malformed or rejected request. */
export function isClientError(err: unknown): err is ApiRequestError {
  return isApiRequestError(err) && err.status >= 400 && err.status < 500;
}

export function resolveError(err: unknown, scope: ScopeEntry): MappedError {
  if (!isApiRequestError(err)) {
    return { message: scope.fallback, possiblyCommitted: false, transient: false };
  }
  if (err.code === "ABORTED") {
    return { message: null, possiblyCommitted: false, transient: false };
  }
  if (err.code === "BAD_JSON" && err.status >= 200 && err.status < 300) {
    // S7 (2026-04-23 review): gate possiblyCommitted on scope.committed
    // being defined. A scope without committed copy is either (a) a GET
    // scope where "possibly committed" is semantically wrong — reads
    // don't commit server state — or (b) a mutation scope whose author
    // has not yet opted into the committed UX. Either way, setting
    // possiblyCommitted: true unconditionally is misleading; it should
    // track whether the scope explicitly participates in the committed
    // contract. Scopes that need the signal declare committed: copy.
    return {
      message: scope.committed ?? scope.fallback,
      possiblyCommitted: scope.committed !== undefined,
      transient: false,
    };
  }
  if (err.code === "NETWORK") {
    return {
      message: scope.network ?? scope.fallback,
      possiblyCommitted: false,
      transient: true,
    };
  }
  // S8 (2026-04-23 review, acknowledged): byCode precedes byStatus.
  // A hypothetical `{status: 413, code: "INVALID_REGEX"}` routes to
  // INVALID_REGEX, not `too large`. This is intentional — the error
  // envelope's `code` is the server's most-specific signal and should
  // outrank a generic status mapping. Latent today (the server contract
  // does not ship conflicting code/status pairs), but the ordering
  // choice is pinned here so a future status-first "fix" sees the
  // trade-off explicitly.
  //
  // C2 (review 2026-04-24): `err.code` is attacker-influenced (it
  // arrives in the server envelope). A naive `scope.byCode[err.code]`
  // indexes through the prototype chain, so a code matching an
  // Object.prototype method name (e.g. "toString", "hasOwnProperty")
  // resolves to the inherited function. The non-undefined check passes
  // and React renders the function source — violating CLAUDE.md's
  // "raw err.message must never reach the UI" invariant. Guard with an
  // own-property check and verify the value is a string.
  const byCodeMatch =
    err.code !== undefined && scope.byCode !== undefined && Object.hasOwn(scope.byCode, err.code)
      ? scope.byCode[err.code]
      : undefined;
  if (typeof byCodeMatch === "string") {
    return {
      message: byCodeMatch,
      // S8: commit intent encoded at scope level — byCode matches that
      // are listed in committedCodes surface possiblyCommitted=true so
      // consumers don't need to maintain an inline code allowlist.
      possiblyCommitted:
        err.code !== undefined && scope.committedCodes?.includes(err.code) === true,
      transient: false,
      extras: scope.extrasFrom?.(err),
    };
  }
  const byStatusMatch = scope.byStatus?.[err.status];
  if (byStatusMatch !== undefined) {
    return {
      message: byStatusMatch,
      possiblyCommitted: false,
      transient: false,
      extras: scope.extrasFrom?.(err),
    };
  }
  return {
    message: scope.fallback,
    possiblyCommitted: false,
    transient: false,
    extras: scope.extrasFrom?.(err),
  };
}

export function mapApiError(err: unknown, scope: ApiErrorScope): MappedError {
  return resolveError(err, SCOPES[scope]);
}

export const ALL_SCOPES = Object.keys(SCOPES) as ApiErrorScope[];
