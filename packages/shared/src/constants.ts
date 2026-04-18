export const UNTITLED_CHAPTER = "Untitled Chapter";
export const TRASH_RETENTION_DAYS = 30;
export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Upper bounds on search-query and replacement strings accepted by
 * /api/projects/:slug/search and /replace. Shared so the client can
 * pre-flight validate and show an inline error rather than round-tripping
 * to the server for a generic VALIDATION_ERROR.
 */
export const MAX_QUERY_LENGTH = 1000;
export const MAX_REPLACE_LENGTH = 10_000;

/**
 * Error codes emitted by the server in the { error: { code, message } }
 * envelope for 400 responses from search/replace endpoints. Shared so the
 * client can discriminate on these without string-literal drift.
 */
export const SEARCH_ERROR_CODES = {
  INVALID_REGEX: "INVALID_REGEX",
  MATCH_CAP_EXCEEDED: "MATCH_CAP_EXCEEDED",
  REGEX_TIMEOUT: "REGEX_TIMEOUT",
  CONTENT_TOO_LARGE: "CONTENT_TOO_LARGE",
} as const;
export type SearchErrorCode = (typeof SEARCH_ERROR_CODES)[keyof typeof SEARCH_ERROR_CODES];

/**
 * Error codes emitted by the server for 400/404 responses from snapshot
 * endpoints (restoreSnapshot in particular). Shared so the client can
 * discriminate without string-literal drift.
 *
 * CROSS_PROJECT_IMAGE_REF distinguishes "snapshot refuses restore because
 * it references images from a different project" from generic content
 * corruption: the JSON is fine, it just points at resources we won't
 * silently adopt. Callers can surface a specific message so users don't
 * interpret it as data loss.
 */
export const SNAPSHOT_ERROR_CODES = {
  CORRUPT_SNAPSHOT: "CORRUPT_SNAPSHOT",
  CROSS_PROJECT_IMAGE_REF: "CROSS_PROJECT_IMAGE_REF",
} as const;
export type SnapshotErrorCode = (typeof SNAPSHOT_ERROR_CODES)[keyof typeof SNAPSHOT_ERROR_CODES];
