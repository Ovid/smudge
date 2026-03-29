import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import express from "express";

describe("Global error handler", () => {
  function createAppWithErrorRoute() {
    const app = express();
    app.use(express.json());

    // Route that triggers an error via next()
    app.get("/api/test-error", (_req, _res, next) => {
      next(new Error("Something went wrong"));
    });

    // Error handler (same as in app.ts)
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

  it("returns 500 with INTERNAL_ERROR envelope for unhandled errors", async () => {
    const app = createAppWithErrorRoute();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(app).get("/api/test-error");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
    });

    consoleSpy.mockRestore();
  });

  it("logs the error to console", async () => {
    const app = createAppWithErrorRoute();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await request(app).get("/api/test-error");

    expect(consoleSpy).toHaveBeenCalledWith(expect.any(Error));
    consoleSpy.mockRestore();
  });
});
