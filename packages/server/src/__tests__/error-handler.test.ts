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

  it("returns error status from err.status when present", async () => {
    const app = express();
    app.use(express.json());
    app.post("/api/test-body", (_req, res) => {
      res.json({ ok: true });
    });
    app.use(
      (
        err: Error & { status?: number },
        _req: express.Request,
        res: express.Response,

        _next: express.NextFunction,
      ) => {
        const status = err.status ?? 500;
        const code = status === 400 ? "VALIDATION_ERROR" : "INTERNAL_ERROR";
        const message = status === 400 ? err.message : "An unexpected error occurred.";
        res.status(status).json({ error: { code, message } });
      },
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Send malformed JSON — express.json() sets err.status = 400
    const res = await request(app)
      .post("/api/test-body")
      .set("Content-Type", "application/json")
      .send("not valid json{{{");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");

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
