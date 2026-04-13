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

  it("returns 400 with VALIDATION_ERROR and generic message (does not leak err.message)", async () => {
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

    const res = await request(createErrorTestApp()).get("/api/test-error-status/400");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    // Must not echo the raw err.message ("Error 400") to the client
    expect(res.body.error.message).not.toBe("Error 400");
    expect(res.body.error.message).toBe("Bad request.");

    logSpy.mockRestore();
  });

  it("returns 404 with NOT_FOUND and generic message", async () => {
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

    const res = await request(createErrorTestApp()).get("/api/test-error-status/404");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.body.error.message).toBe("Not found.");

    logSpy.mockRestore();
  });

  it("returns 409 with CONFLICT and generic message", async () => {
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

    const res = await request(createErrorTestApp()).get("/api/test-error-status/409");

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");
    expect(res.body.error.message).toBe("Conflict.");

    logSpy.mockRestore();
  });

  it("returns 413 with PAYLOAD_TOO_LARGE and generic message", async () => {
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

    const res = await request(createErrorTestApp()).get("/api/test-error-status/413");

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(res.body.error.message).toBe("Request body too large.");

    logSpy.mockRestore();
  });

  it("sanitizes SyntaxError messages from body-parser to avoid leaking internals", async () => {
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

    const app = createErrorTestApp();
    // express.json() throws a SyntaxError with status 400 for malformed JSON
    app.post("/api/test-body", (_req, res) => res.json({ ok: true }));

    const res = await request(app)
      .post("/api/test-body")
      .set("Content-Type", "application/json")
      .send("not valid json{{{");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    // Must NOT contain parser internals like "Unexpected token"
    expect(res.body.error.message).not.toContain("Unexpected token");
    expect(res.body.error.message).toBe("Invalid JSON in request body.");

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
