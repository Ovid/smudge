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
};

function isApiRequestError(err: unknown): err is ApiRequestError {
  return err instanceof ApiRequestError;
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
  const byCodeMatch = err.code ? scope.byCode?.[err.code] : undefined;
  if (byCodeMatch !== undefined) {
    return {
      message: byCodeMatch,
      possiblyCommitted: false,
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
