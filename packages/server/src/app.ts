import express from "express";
import helmet from "helmet";
import { logger } from "./logger";
import { getDb } from "./db/connection";
import { projectsRouter } from "./projects/projects.routes";
import { chaptersRouter } from "./chapters/chapters.routes";
import { chapterStatusesRouter } from "./chapter-statuses/chapter-statuses.routes";
import { settingsRouter } from "./settings/settings.routes";
import { exportRouter } from "./export/export.routes";
import { imagesRouter, imagesDirectRouter } from "./images/images.routes";
import { snapshotChapterRouter, snapshotDirectRouter } from "./snapshots/snapshots.routes";
import { projectOuttakesRouter, outtakeDirectRouter } from "./outtakes/outtakes.routes";
import { searchRouter } from "./search/search.routes";
import {
  AppError,
  BadRequestError,
  ERROR_STATUS_ALLOWLIST,
  NotFoundError,
} from "./errors/appError";
import { requestContext } from "./requestContext";
import { isLoopbackHost } from "./config/loopback";
import { MAX_CHAPTER_CONTENT_BYTES } from "./constants";

export function createApp(): express.Express {
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  // F-10: assign a correlation id before any body parsing, so even a
  // malformed-JSON 400 is traceable in the logs.
  app.use(requestContext);

  // F-02: DNS-rebinding defence. The attacker's page is same-origin with the
  // target from the browser's point of view, so a GET carries no Origin header
  // at all — only `Host` names the attacker's domain, because Host always comes
  // from the URL. Validating Host is therefore the load-bearing check and an
  // Origin allowlist would inspect a header the attack does not send.
  //
  // Runs after requestContext so a rejection is traceable, and before body
  // parsing so a rebound request is refused without being read. 400 rather than
  // 403 because the error-status allowlist is 400/404/409/413/500 — a new
  // condition takes an existing status plus a discriminating code
  // (CLAUDE.md §API Design).
  //
  // I7 (code review 2026-08-22): "traceable" was false until the warn below
  // existed. This is a 400 AppError, and the handler above logs AppErrors only
  // at status >= 500 — 4xx are expected outcomes, deliberately quiet — while
  // requestContext's access log is `debug`, suppressed at the default `info`
  // level. So the ordering bought a req_id on a response and no log line to
  // match it against, and the rejected Host, the single most diagnostic field,
  // was never recorded anywhere. The Host is attacker-controlled, hence the
  // truncation: an unbounded value turns the one line this check exists to
  // write into a log-flooding lever.
  //
  // `make dev` and `make e2e` are unaffected: Vite proxies /api with
  // `changeOrigin: true`, so the server sees the proxy target's host.
  app.use((req, _res, next) => {
    if (!isLoopbackHost(req.headers.host)) {
      req.log.warn({ host: String(req.headers.host).slice(0, 128) }, "Rejected non-loopback Host");
      throw new BadRequestError("Request Host is not recognized.", "INVALID_HOST");
    }
    next();
  });

  app.use(express.json({ limit: MAX_CHAPTER_CONTENT_BYTES }));

  app.use("/api/projects", projectsRouter());
  app.use("/api/chapters", chaptersRouter());
  app.use("/api/chapter-statuses", chapterStatusesRouter());
  app.use("/api/settings", settingsRouter());
  app.use("/api/projects", exportRouter());
  app.use("/api/projects", imagesRouter());
  app.use("/api/images", imagesDirectRouter());
  app.use("/api/chapters", snapshotChapterRouter());
  app.use("/api/snapshots", snapshotDirectRouter());
  app.use("/api/projects", projectOuttakesRouter());
  app.use("/api/outtakes", outtakeDirectRouter());
  app.use("/api/projects", searchRouter());

  app.get("/api/health", async (_req, res) => {
    // Liveness probe: confirm the SQLite handle is actually usable, not
    // just that the process is up (F-14). A locked file, full disk, or
    // corrupt WAL makes this throw, so a (Docker-target) orchestrator sees
    // the instance as unhealthy. 503 is permitted here as a documented
    // carve-out to the status allowlist (CLAUDE.md §API Design).
    try {
      await getDb().raw("SELECT 1");
      res.json({ status: "ok" });
    } catch (err) {
      logger.error({ err }, "Health check DB probe failed");
      res.status(503).json({ status: "error" });
    }
  });

  // F-06: unmatched /api/* must answer the documented error envelope. Without
  // this, Express's finalhandler served its default HTML 404, which lands in
  // apiFetch's !res.ok branch where res.json() throws SyntaxError — so the
  // discriminating `error.code` the whole client scope registry keys on arrived
  // `undefined`. UNKNOWN_ENDPOINT distinguishes "no such endpoint" (always a
  // caller bug) from NOT_FOUND's "no such row"; no scope maps either by code, so
  // the user-facing copy is identical and this costs the reader nothing.
  //
  // MUST stay synchronous. Express 4 does not await handlers, so an `async`
  // arrow here rejects unhandled and Node 22 terminates the process — every
  // mistyped URL would crash the server. Use asyncHandler if this ever awaits.
  //
  // Scoped to /api deliberately: when static/SPA serving lands, its catch-all
  // mounts AFTER this one, or unmatched /api/* starts answering index.html
  // with a 200.
  app.use("/api", () => {
    throw new NotFoundError("Unknown API endpoint.", "UNKNOWN_ENDPOINT");
  });

  app.use(globalErrorHandler);

  return app;
}

export function globalErrorHandler(
  err: Error & { status?: number; statusCode?: number },
  req: express.Request,
  res: express.Response,
  _next: express.NextFunction,
): void {
  // AppErrors are intentional, already-classified domain failures. Render
  // their envelope directly and do NOT log them at error level — these
  // paths emitted via in-route res.json() before F-3 and logged nothing.
  if (err instanceof AppError) {
    // S1 (agentic review 2026-08-17): ...except the 500-class ones. "Already
    // classified" means the CLIENT knows what happened; a 5xx still means the
    // SERVER broke, and the operator has no other record of it. F-12 made this
    // load-bearing: converting the read-after-insert bare `Error`s into
    // InternalErrors moved them behind this early return, silently deleting
    // the only log of a "the row is committed and we cannot see it" event —
    // the class of anomaly log CLAUDE.md §F-2 rests on. 4xx AppErrors stay
    // quiet; they are expected outcomes, not faults.
    if (err.status >= 500) {
      const fields = { err, status: err.status, code: err.code };
      if (req.log) {
        req.log.error(fields, "Server-fault AppError");
      } else {
        logger.error({ ...fields, method: req.method, path: req.path }, "Server-fault AppError");
      }
    }
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...err.extras },
    });
    return;
  }

  // Anything reaching here is genuinely unhandled — log it with the request
  // correlation fields (F-10) so the 500 can be traced back to its request.
  // S3: prefer req.log (a pino child bound by requestContext to {req_id,
  // method, path}) so the correlation fields are not re-bound on every error
  // call. Fall back to the top-level logger with explicit fields for the
  // pre-middleware error case (e.g. an error thrown from helmet, mounted
  // BEFORE requestContext) where req.log was never assigned.
  //
  // I4: clamp to the allowlist. A non-AppError can carry any status it likes —
  // body-parser's UnsupportedMediaTypeError (415) reached here from
  // express.json() on every body-accepting endpoint, was rendered verbatim, and
  // was mislabelled VALIDATION_ERROR by the ladder's else arm while matching no
  // client error scope. An off-allowlist 4xx is still the client's fault, so it
  // becomes 400; anything else becomes 500. `rawStatus` is what gets LOGGED, so
  // the clamp never hides the original from the operator.
  const rawStatus = err.status ?? err.statusCode ?? 500;
  const status = ERROR_STATUS_ALLOWLIST.has(rawStatus)
    ? rawStatus
    : rawStatus >= 400 && rawStatus < 500
      ? 400
      : 500;
  if (req.log) {
    req.log.error({ err, status, rawStatus }, "Unhandled request error");
  } else {
    logger.error(
      { err, status, rawStatus, method: req.method, path: req.path },
      "Unhandled request error",
    );
  }
  const code =
    status >= 500
      ? "INTERNAL_ERROR"
      : status === 404
        ? "NOT_FOUND"
        : status === 409
          ? "CONFLICT"
          : status === 413
            ? "PAYLOAD_TOO_LARGE"
            : "VALIDATION_ERROR";
  const message =
    status >= 500
      ? "An unexpected error occurred."
      : status === 400 && err instanceof SyntaxError
        ? "Invalid JSON in request body."
        : status === 404
          ? "Not found."
          : status === 409
            ? "Conflict."
            : status === 413
              ? "Request body too large."
              : "Bad request.";
  res.status(status).json({ error: { code, message } });
}
