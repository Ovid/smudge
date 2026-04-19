import { ApiRequestError } from "../api/client";
import { STRINGS } from "../strings";
import { SEARCH_ERROR_CODES } from "@smudge/shared";

/**
 * Returns the user-facing copy for a replace/search error, or null if the
 * caller should treat the error as a no-op (e.g. AbortController-cancelled).
 * Centralizes the discriminated-error mapping that previously lived in
 * useFindReplaceState, EditorPage.executeReplace, and EditorPage.handleReplaceOne.
 */
export function mapReplaceErrorToMessage(err: unknown): string | null {
  if (!(err instanceof ApiRequestError)) {
    return STRINGS.findReplace.replaceFailed;
  }
  if (err.code === "ABORTED") return null;
  if (err.status === 400) {
    if (err.code === SEARCH_ERROR_CODES.MATCH_CAP_EXCEEDED)
      return STRINGS.findReplace.tooManyMatches;
    if (err.code === SEARCH_ERROR_CODES.REGEX_TIMEOUT) return STRINGS.findReplace.searchTimedOut;
    if (err.code === SEARCH_ERROR_CODES.CONTENT_TOO_LARGE)
      return STRINGS.findReplace.contentTooLarge;
    if (err.code === SEARCH_ERROR_CODES.INVALID_REGEX) return STRINGS.findReplace.invalidRegex;
    // Unhandled 400 codes (e.g. VALIDATION_ERROR) — don't leak raw English
    // server copy into the UI (CLAUDE.md: all strings via strings.ts).
    return STRINGS.findReplace.invalidReplaceRequest;
  }
  if (err.status === 404) {
    // Two distinct 404 causes share the same client message for now
    // (SCOPE_NOT_FOUND: chapter gone; NOT_FOUND: project gone). Both mean
    // retrying won't help — surfacing the scope-specific copy keeps users
    // off the generic "try again" message that implies a transient fault.
    return STRINGS.findReplace.replaceScopeNotFound;
  }
  return STRINGS.findReplace.replaceFailed;
}

/**
 * Twin of `mapReplaceErrorToMessage` for the search (GET-like) path. The
 * 400-code ladder is shared with replace (same SEARCH_ERROR_CODES) but the
 * fallback copy and 404-handling differ: search has no scope/404 branch,
 * and the transient-failure message is `searchFailed`.
 *
 * Both mappers live here so that adding a new SearchErrorCode is a
 * one-file change; `useFindReplaceState` and `EditorPage` used to each
 * carry their own ladder and silently drifted.
 */
export function mapSearchErrorToMessage(err: unknown): string | null {
  if (!(err instanceof ApiRequestError)) {
    return STRINGS.findReplace.searchFailed;
  }
  if (err.code === "ABORTED") return null;
  if (err.status === 400) {
    if (err.code === SEARCH_ERROR_CODES.MATCH_CAP_EXCEEDED)
      return STRINGS.findReplace.tooManyMatches;
    if (err.code === SEARCH_ERROR_CODES.REGEX_TIMEOUT) return STRINGS.findReplace.searchTimedOut;
    if (err.code === SEARCH_ERROR_CODES.CONTENT_TOO_LARGE)
      return STRINGS.findReplace.contentTooLarge;
    if (err.code === SEARCH_ERROR_CODES.INVALID_REGEX) return STRINGS.findReplace.invalidRegex;
    return STRINGS.findReplace.invalidSearchRequest;
  }
  if (err.status === 404) {
    // Project (or scoped chapter) is gone — retrying will 404 forever.
    // Return terminal copy so the panel doesn't invite a retry loop.
    // Mirrors the replace-side handling via `replaceScopeNotFound`.
    return STRINGS.findReplace.searchScopeNotFound;
  }
  return STRINGS.findReplace.searchFailed;
}
