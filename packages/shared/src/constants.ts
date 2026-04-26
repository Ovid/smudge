export const UNTITLED_CHAPTER = "Untitled Chapter";
export const TRASH_RETENTION_DAYS = 30;
export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Default port the Express server binds to when SMUDGE_PORT is not set.
 * Imported by packages/server/src/index.ts. Mirrored — NOT imported —
 * by packages/client/vite.config.ts as a literal `"3456"` because vite
 * loads its config under bare Node ESM, which cannot resolve
 * @smudge/shared's extensionless re-export chain (see vite.config.ts
 * for the ERR_MODULE_NOT_FOUND verification). Documented in CLAUDE.md
 * and docker-compose; if you change this, update vite.config.ts and
 * those references too.
 */
export const DEFAULT_SERVER_PORT = 3456;

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
  SCOPE_NOT_FOUND: "SCOPE_NOT_FOUND",
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
