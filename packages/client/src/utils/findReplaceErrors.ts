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
  // BAD_JSON is only assigned by apiFetch() on a 2xx response whose body
  // failed to parse (see packages/client/src/api/client.ts) — non-2xx
  // parse failures fall through to undefined `code`, so this branch
  // cannot fire for them. A 2xx BAD_JSON means the server likely
  // committed the replace (and the auto-snapshot) but the body was
  // unreadable mid-stream. Falling through to the generic "replace
  // failed" copy would invite a retry that double-replaces; tell the
  // user to refresh and verify state before retrying. The status-range
  // check is defensive — if apiFetch ever broadens BAD_JSON, keep this
  // "possibly committed" copy scoped to the genuinely ambiguous 2xx case.
  if (err.code === "BAD_JSON" && err.status >= 200 && err.status < 300) {
    return STRINGS.findReplace.replaceResponseUnreadable;
  }
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
  if (err.status === 413) {
    // Body-size guard (CLAUDE.md: 413 signals content would exceed the
    // per-row limit). The request is doomed on retry, so route to the
    // "too large" copy rather than letting it fall through to
    // replaceFailed which invites a pointless retry.
    return STRINGS.findReplace.contentTooLarge;
  }
  if (err.status === 404) {
    // Two distinct 404 causes:
    //   SCOPE_NOT_FOUND — chapter is missing/soft-deleted inside the project
    //   NOT_FOUND       — the project itself is gone (slug resolution failed)
    // Both are terminal (retrying won't help), but conflating them under
    // "chapter unavailable" copy misleads the user when the project went
    // away — branch on the code so the panel tells the truth.
    if (err.code === SEARCH_ERROR_CODES.SCOPE_NOT_FOUND) {
      return STRINGS.findReplace.replaceScopeNotFound;
    }
    return STRINGS.findReplace.replaceProjectNotFound;
  }
  // apiFetch maps offline / DNS / CSP failures to status=0 with
  // code="NETWORK" (see api/client.ts classifyFetchError). Surfacing the
  // generic "Replace failed" copy for those conflates a transient-5xx
  // retry with a connectivity problem the user can fix; branch on the
  // NETWORK code so the UI invites the user to check the connection
  // rather than hammer retry (S4).
  if (err.status === 0 && err.code === "NETWORK") {
    return STRINGS.findReplace.replaceNetworkFailed;
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
  if (err.status === 413) {
    // Body-size guard trips on the request itself — not search-specific
    // but possible if the query/options payload exceeds the global cap.
    return STRINGS.findReplace.contentTooLarge;
  }
  if (err.status === 404) {
    // Project (or scoped chapter) is gone — retrying will 404 forever.
    // Return terminal copy so the panel doesn't invite a retry loop.
    // Mirrors the replace-side handling via `replaceScopeNotFound`.
    return STRINGS.findReplace.searchScopeNotFound;
  }
  // Mirror the replace-side NETWORK branch (S4) so offline/DNS/CSP
  // failures route to connection-specific copy instead of the generic
  // "Search failed" bucket that 5xx and unknowns share.
  if (err.status === 0 && err.code === "NETWORK") {
    return STRINGS.findReplace.searchNetworkFailed;
  }
  return STRINGS.findReplace.searchFailed;
}
