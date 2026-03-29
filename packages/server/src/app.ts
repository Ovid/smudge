import express from "express";
import type { Knex } from "knex";
import { projectsRouter } from "./routes/projects";
import { chaptersRouter } from "./routes/chapters";

export function createApp(db: Knex): express.Express {
  const app = express();

  app.use(express.json());

  app.use("/api/projects", projectsRouter(db));
  app.use("/api/chapters", chaptersRouter(db));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Global error handler — consistent JSON envelope for unhandled errors
  app.use(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
