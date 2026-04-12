import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import express from "express";

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
      console.error(err);
      const status = err.status ?? err.statusCode ?? 500;
      const code = status < 500 ? "VALIDATION_ERROR" : "INTERNAL_ERROR";
      const message = status < 500 ? err.message : "An unexpected error occurred.";
      res.status(status).json({ error: { code, message } });
    },
  );

  return app;
}

describe("Global error handler", () => {
  it("returns 500 with INTERNAL_ERROR envelope for unhandled errors", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(createErrorTestApp()).get("/api/test-error");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
    });

    consoleSpy.mockRestore();
  });

  it("returns 400 with VALIDATION_ERROR for bad request errors", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(createErrorTestApp()).get("/api/test-error-status/400");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: "VALIDATION_ERROR", message: "Error 400" },
    });

    consoleSpy.mockRestore();
  });

  it("returns 404 with VALIDATION_ERROR (current behavior — all 4xx map to VALIDATION_ERROR)", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(createErrorTestApp()).get("/api/test-error-status/404");

    expect(res.status).toBe(404);
    // Safety-net: captures current behavior where all 4xx map to VALIDATION_ERROR.
    // F-12 fix will change 404 to a more appropriate code.
    expect(res.body.error.code).toBe("VALIDATION_ERROR");

    consoleSpy.mockRestore();
  });

  it("returns 409 with VALIDATION_ERROR (current behavior — all 4xx map to VALIDATION_ERROR)", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(createErrorTestApp()).get("/api/test-error-status/409");

    expect(res.status).toBe(409);
    // Safety-net: captures current behavior where all 4xx map to VALIDATION_ERROR.
    expect(res.body.error.code).toBe("VALIDATION_ERROR");

    consoleSpy.mockRestore();
  });

  it("logs the error to console", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await request(createErrorTestApp()).get("/api/test-error");

    expect(consoleSpy).toHaveBeenCalledWith(expect.any(Error));
    consoleSpy.mockRestore();
  });
});
