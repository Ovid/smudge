export const UNTITLED_CHAPTER = "Untitled Chapter";
export const TRASH_RETENTION_DAYS = 30;
export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Default port the Express server binds to when SMUDGE_PORT is not set.
 * Imported by packages/server/src/index.ts. Mirrored — NOT imported —
 * by packages/client/vite.config.ts as a literal `"3456"` (named
 * DEFAULT_SERVER_PORT_VITE there) because vite loads its config under
 * bare Node ESM, which cannot resolve the extensionless re-exports
 * inside @smudge/shared's `src/index.ts` (see
 * `packages/client/vite.config.ts:25-30` for the verbatim
 * ERR_MODULE_NOT_FOUND against `./schemas`). The
 * parity between the two literals is enforced by
 * `__tests__/vite-config-default-port.test.ts`; if you change this
 * value, update vite.config.ts to match or that test will fail.
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
 * Maximum accepted size of a single uploaded image, in bytes.
 *
 * S1 (dedup review 2026-07-26): the NUMBER was a bare literal in three files
 * with no cross-reference — ImageGallery's pre-flight check, the multer
 * streaming limit in images.routes, and the post-read check in images.service.
 * All three CHECKS are correct and must stay (client pre-flight for a fast
 * error, multer to reject mid-stream, service as the trust boundary); only the
 * value was duplicated, so lowering the cap in one place would have left the
 * client accepting a file the server rejects. Follows the DEFAULT_SERVER_PORT
 * precedent above: one shared constant, imported at every site.
 */
export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * The same cap, as the figure shown to the user (e.g. "10 MB").
 *
 * S5 (agentic-review 2026-07-26): the S1 change above converted all three
 * CHECKS to the constant but left all three MESSAGES saying "10 MB" as a
 * literal — server service, server route, and the client string. Raising the
 * constant to 20 would have made every message tell the user the wrong limit
 * while the server happily accepted the file: the same divergence S1 set out
 * to make unrepresentable, one layer over. Derived, not written, so there is
 * nothing left to keep in sync.
 *
 * Whole megabytes only, which is what every caller wants and what the cap has
 * always been; a fractional cap would render as e.g. "10.5 MB".
 */
export const MAX_IMAGE_UPLOAD_LABEL = `${MAX_IMAGE_UPLOAD_BYTES / 1024 / 1024} MB`;

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
 * Error codes emitted by the outtake endpoints inside the 400 envelope.
 *
 * S8 (agentic-review 2026-08-04): the client's `outtake.update` scope mapped
 * EVERY 400 to label-length copy, on the premise that the cap is the only 400
 * the PATCH emits. It is not — `validateUuidParam` throws 400 before the schema
 * runs, and `UpdateOuttakeSchema.strict()` is a second producer. That matters
 * more here than in a read scope because the consumer REVERTS the visible label
 * field on a definite failure, so a non-cap 400 made the writer's typed label
 * vanish under copy naming a cause that was not the cause.
 */
export const OUTTAKE_ERROR_CODES = {
  LABEL_TOO_LONG: "OUTTAKE_LABEL_TOO_LONG",
} as const;
export type OuttakeErrorCode = (typeof OUTTAKE_ERROR_CODES)[keyof typeof OUTTAKE_ERROR_CODES];

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
  // F-34 (architecture report 2026-08-11): the create endpoint shares
  // LABEL_MAX_UNITS with the outtake path but emitted no code for breaching it,
  // so an over-cap label got "Unable to create snapshot. Try again." — copy
  // that invites a retry which reproduces the failure forever. Keyed by code
  // rather than status because .strict(), validateUuidParam and a non-string
  // label are three other producers of 400 on this endpoint; the outtake path
  // learned that the hard way (S8) and this is the same lesson, not a new one.
  LABEL_TOO_LONG: "SNAPSHOT_LABEL_TOO_LONG",
} as const;
export type SnapshotErrorCode = (typeof SNAPSHOT_ERROR_CODES)[keyof typeof SNAPSHOT_ERROR_CODES];
