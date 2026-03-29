import express from "express";
import type { Knex } from "knex";

export function createApp(db: Knex): express.Express {
  const app = express();

  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Global error handler — consistent JSON envelope for unhandled errors
  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      console.error(err);
      res.status(500).json({
        error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
      });
    },
  );

  return app;
}
