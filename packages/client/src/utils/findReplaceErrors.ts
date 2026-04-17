import { ApiRequestError } from "../api/client";
import { STRINGS } from "../strings";

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
    if (err.code === "MATCH_CAP_EXCEEDED") return STRINGS.findReplace.tooManyMatches;
    if (err.code === "REGEX_TIMEOUT") return STRINGS.findReplace.searchTimedOut;
    if (err.code === "CONTENT_TOO_LARGE") return STRINGS.findReplace.contentTooLarge;
    if (err.code === "INVALID_REGEX") return STRINGS.findReplace.invalidRegex;
    // Unhandled 400 codes (e.g. VALIDATION_ERROR) — don't leak raw English
    // server copy into the UI (CLAUDE.md: all strings via strings.ts).
    return STRINGS.findReplace.invalidReplaceRequest;
  }
  if (err.status === 404 && err.code === "SCOPE_NOT_FOUND") {
    return STRINGS.findReplace.replaceScopeNotFound;
  }
  return STRINGS.findReplace.replaceFailed;
}
