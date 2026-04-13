import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import express from "express";
import { logger } from "../logger";

/**
 * Creates an Express app with the exact same error handler as app.ts,
 * plus a test route that triggers errors with specific status codes.
 *
 * We replicate the handler here rather than importing from app.ts because
 * the handler is inline.  When the handler in app.ts is changed, update
 * this copy to match.
 */
function createErrorTestApp() {
  const app = express();
  app.use(express.json());

  // Route that triggers an error with a configurable status
  app.get("/api/test-error-status/:status", (req, _res, next) => {
    const status = parseInt(req.params.status, 10);
    const err: Error & { status?: number } = new Error(`Error ${status}`);
    err.status = status;
    next(err);
  });

  // Route that triggers a plain error (no status)
  app.get("/api/test-error", (_req, _res, next) => {
    next(new Error("Something went wrong"));
  });

  // Exact copy of the error handler from app.ts
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
              : "VALIDATION_ERROR";
      const message = status >= 500 ? "An unexpected error occurred." : err.message;
      res.status(status).json({ error: { code, message } });
    },
  );

  return app;
}

describe("Global error handler", () => {
  it("returns 500 with INTERNAL_ERROR envelope for unhandled errors", async () => {
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

    const res = await request(createErrorTestApp()).get("/api/test-error");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
    });

    logSpy.mockRestore();
  });

  it("returns 400 with VALIDATION_ERROR for bad request errors", async () => {
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

    const res = await request(createErrorTestApp()).get("/api/test-error-status/400");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: "VALIDATION_ERROR", message: "Error 400" },
    });

    logSpy.mockRestore();
  });

  it("returns 404 with NOT_FOUND error code", async () => {
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

    const res = await request(createErrorTestApp()).get("/api/test-error-status/404");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");

    logSpy.mockRestore();
  });

  it("returns 409 with CONFLICT error code", async () => {
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

    const res = await request(createErrorTestApp()).get("/api/test-error-status/409");

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");

    logSpy.mockRestore();
  });

  it("logs the error via structured logger", async () => {
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

    await request(createErrorTestApp()).get("/api/test-error");

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: 500 }),
      "Unhandled request error",
    );
    logSpy.mockRestore();
  });
});
