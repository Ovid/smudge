// Server-side error taxonomy (F-3).
//
// Before this, every route inlined its own
// `res.status(404).json({ error: { code, message } })` envelope (the
// "Project not found." literal was duplicated 7× in projects.routes.ts
// alone) and the domain-failure → HTTP-status mapping lived scattered
// across the route files. `AppError` is the single owner of that
// mapping: a route signals a domain failure by throwing the appropriate
// subclass, and the global error handler (app.ts) renders the envelope.
//
// The status codes here stay inside the server allowlist (CLAUDE.md
// §API Design). New conditions reuse an existing status with a
// discriminating `code` string — never a new status.
//
// I4 (dedup review 2026-07-26): that allowlist used to be RESTATED here as
// prose ("200, 201, 400, 404, 409, 413, 500") and enforced nowhere. The
// restatement had already drifted — it omitted 204, the uniform DELETE
// contract, and the 503 /api/health carve-out — while the one site that
// actually writes a status (globalErrorHandler in app.ts) encoded neither.
// ERROR_STATUS_ALLOWLIST below is now the single machine-readable owner: the
// subclasses draw from it and the handler clamps to it.
//
// AppErrors are intentional, already-classified domain failures, so the
// global handler renders them WITHOUT error-level logging (matching the
// previous in-route `res.json()` behavior, which logged nothing). Only
// genuinely-unhandled errors — anything that is NOT an AppError — are
// logged at error level.

/**
 * Every HTTP status the server may render an ERROR envelope with.
 *
 * Deliberately the error subset of CLAUDE.md §API Design's full list: the
 * success codes (200/201/204) never come from this taxonomy, and the 503
 * /api/health carve-out is written directly by the probe and never reaches
 * globalErrorHandler. A status outside this set is a bug or a library error
 * leaking its own status — the handler clamps it rather than letting it out.
 */
export const ERROR_STATUS_ALLOWLIST: ReadonlySet<number> = new Set([400, 404, 409, 413, 500]);

/** Extra fields merged into the `error` object alongside `code`/`message`. */
export type AppErrorExtras = Record<string, unknown>;

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extras?: AppErrorExtras;

  constructor(status: number, code: string, message: string, extras?: AppErrorExtras) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.extras = extras;
  }
}

/** 404 — resource not found. `code` defaults to NOT_FOUND but can be a discriminator (e.g. PROJECT_PURGED). */
export class NotFoundError extends AppError {
  constructor(message: string, code = "NOT_FOUND", extras?: AppErrorExtras) {
    super(404, code, message, extras);
  }
}

/** 400 — well-formed request that fails validation or a precondition. `code` defaults to VALIDATION_ERROR. */
export class BadRequestError extends AppError {
  constructor(message: string, code = "VALIDATION_ERROR", extras?: AppErrorExtras) {
    super(400, code, message, extras);
  }
}

/** 409 — request conflicts with current state (e.g. image still referenced). `code` defaults to CONFLICT. */
export class ConflictError extends AppError {
  constructor(message: string, code = "CONFLICT", extras?: AppErrorExtras) {
    super(409, code, message, extras);
  }
}

/** 413 — request body exceeds a size guard. */
export class PayloadTooLargeError extends AppError {
  constructor(message: string, code = "PAYLOAD_TOO_LARGE", extras?: AppErrorExtras) {
    super(413, code, message, extras);
  }
}

/** 500 — a handled-but-anomalous server condition (e.g. read-after-write failure). */
export class InternalError extends AppError {
  constructor(message: string, code = "INTERNAL_ERROR", extras?: AppErrorExtras) {
    super(500, code, message, extras);
  }
}
