import express from "express";
import helmet from "helmet";
import { logger } from "./logger";
import { projectsRouter } from "./projects/projects.routes";
import { chaptersRouter } from "./chapters/chapters.routes";
import { chapterStatusesRouter } from "./chapter-statuses/chapter-statuses.routes";
import { settingsRouter } from "./settings/settings.routes";
import { exportRouter } from "./export/export.routes";
import { imagesRouter, imagesDirectRouter } from "./images/images.routes";
import { snapshotChapterRouter, snapshotDirectRouter } from "./snapshots/snapshots.routes";
import { searchRouter } from "./search/search.routes";
import { AppError } from "./errors/appError";
import { requestContext } from "./requestContext";
import { MAX_CHAPTER_CONTENT_LIMIT_STRING } from "./constants";

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
  app.use(express.json({ limit: MAX_CHAPTER_CONTENT_LIMIT_STRING }));

  app.use("/api/projects", projectsRouter());
  app.use("/api/chapters", chaptersRouter());
  app.use("/api/chapter-statuses", chapterStatusesRouter());
  app.use("/api/settings", settingsRouter());
  app.use("/api/projects", exportRouter());
  app.use("/api/projects", imagesRouter());
  app.use("/api/images", imagesDirectRouter());
  app.use("/api/chapters", snapshotChapterRouter());
  app.use("/api/snapshots", snapshotDirectRouter());
  app.use("/api/projects", searchRouter());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
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
  const status = err.status ?? err.statusCode ?? 500;
  if (req.log) {
    req.log.error({ err, status }, "Unhandled request error");
  } else {
    logger.error(
      { err, status, method: req.method, path: req.path },
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
