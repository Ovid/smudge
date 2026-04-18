export const UNTITLED_CHAPTER = "Untitled Chapter";
export const TRASH_RETENTION_DAYS = 30;
export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

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
 */
export const SNAPSHOT_ERROR_CODES = {
  CORRUPT_SNAPSHOT: "CORRUPT_SNAPSHOT",
} as const;
export type SnapshotErrorCode = (typeof SNAPSHOT_ERROR_CODES)[keyof typeof SNAPSHOT_ERROR_CODES];
