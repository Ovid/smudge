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
    return {
      message: scope.committed ?? scope.fallback,
      possiblyCommitted: true,
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
