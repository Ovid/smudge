import express from "express";
import type { Request, Response, NextFunction } from "express";
import type { Knex } from "knex";
import helmet from "helmet";
import { projectsRouter } from "./routes/projects";
import { chaptersRouter } from "./routes/chapters";
import { chapterStatusesRouter } from "./routes/chapter-statuses";

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function createApp(db: Knex): express.Express {
  const app = express();

  app.use(helmet());
  app.use(express.json({ limit: "5mb" }));

  app.use("/api/projects", projectsRouter(db));
  app.use("/api/chapters", chaptersRouter(db));
  app.use("/api/chapter-statuses", chapterStatusesRouter(db));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Global error handler — consistent JSON envelope for unhandled errors
  app.use(
    (
      err: Error & { status?: number; statusCode?: number },
      _req: express.Request,
      res: express.Response,

      _next: express.NextFunction,
    ) => {
      console.error(err);
      const status = err.status ?? err.statusCode ?? 500;
      const code = status < 500 ? "VALIDATION_ERROR" : "INTERNAL_ERROR";
      const message = status < 500 ? err.message : "An unexpected error occurred.";
      res.status(status).json({ error: { code, message } });
    },
  );

  return app;
}
