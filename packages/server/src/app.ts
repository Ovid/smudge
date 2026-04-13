import express from "express";
import type { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { logger } from "./logger";
import { projectsRouter } from "./projects/projects.routes";
import { chaptersRouter } from "./chapters/chapters.routes";
import { chapterStatusesRouter } from "./chapter-statuses/chapter-statuses.routes";
import { settingsRouter } from "./settings/settings.routes";

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

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
  app.use(express.json({ limit: "5mb" }));

  app.use("/api/projects", projectsRouter());
  app.use("/api/chapters", chaptersRouter());
  app.use("/api/chapter-statuses", chapterStatusesRouter());
  app.use("/api/settings", settingsRouter());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(
    (
      err: Error & { status?: number; statusCode?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      logger.error({ err, status: err.status ?? err.statusCode ?? 500 }, "Unhandled request error");
      const status = err.status ?? err.statusCode ?? 500;
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
          : err instanceof SyntaxError
            ? "Invalid JSON in request body."
            : status === 404
              ? "Not found."
              : status === 409
                ? "Conflict."
                : status === 413
                  ? "Request body too large."
                  : "Bad request.";
      res.status(status).json({ error: { code, message } });
    },
  );

  return app;
}
