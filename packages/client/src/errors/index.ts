export {
  mapApiError,
  mapApiErrorMessage,
  ALL_SCOPES,
  isApiError,
  isAborted,
  isNotFound,
  isClientError,
} from "./apiErrorMapper";
export type { MappedError, ScopeEntry } from "./apiErrorMapper";
export type { ApiErrorScope } from "./scopes";
// I16 (review 2026-04-24): re-export ApiRequestError so the barrel is
// the single place hooks/components can import error-surface types.
// useSnapshotState was reaching into ../api/client because the barrel
// omitted this class, weakening the "only errors/ or api/client may
// instantiate ApiRequestError" invariant that a future ESLint rule
// will enforce.
export { ApiRequestError } from "../api/client";
