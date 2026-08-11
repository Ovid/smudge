import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import express from "express";
import { logger } from "../logger";
import { globalErrorHandler } from "../app";

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

  // Route that triggers a SyntaxError with a configurable status
  app.get("/api/test-syntax-error/:status", (req, _res, next) => {
    const status = parseInt(req.params.status, 10);
    const err: SyntaxError & { status?: number } = new SyntaxError("fake");
    err.status = status;
    next(err);
  });

  app.use(globalErrorHandler);

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

  it("does not return 'Invalid JSON' for a SyntaxError with non-400 status", async () => {
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

    const res = await request(createErrorTestApp()).get("/api/test-syntax-error/404");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    // Should say "Not found." not "Invalid JSON in request body."
    expect(res.body.error.message).toBe("Not found.");

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

// ---------------------------------------------------------------------------
// I4 (dedup review 2026-07-26): the status allowlist is ENFORCED, not restated
// ---------------------------------------------------------------------------

describe("status allowlist is enforced by the handler", () => {
  // CLAUDE.md §API Design fixes the server's error-status set at
  // 400/404/409/413/500 (503 is a documented /api/health carve-out that never
  // reaches this handler). The AppError subclasses honour it, but the
  // non-AppError fallback path read `err.status` straight through to
  // `res.status(...)` with no clamp — so ANY library error carrying its own
  // status escaped the taxonomy. body-parser's UnsupportedMediaTypeError (415)
  // did exactly that on every body-accepting endpoint, mislabelled
  // VALIDATION_ERROR and mapped by no client scope.
  it.each([
    [415, 400, "VALIDATION_ERROR"],
    [405, 400, "VALIDATION_ERROR"],
    [418, 400, "VALIDATION_ERROR"],
    [429, 400, "VALIDATION_ERROR"],
    [501, 500, "INTERNAL_ERROR"],
    [502, 500, "INTERNAL_ERROR"],
    [503, 500, "INTERNAL_ERROR"],
  ])("clamps an off-allowlist %i to %i", async (raw, expected, code) => {
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const res = await request(createErrorTestApp()).get(`/api/test-error-status/${raw}`);
    expect(res.status).toBe(expected);
    expect(res.body.error.code).toBe(code);
    logSpy.mockRestore();
  });

  it.each([400, 404, 409, 413, 500])("passes an allowlisted %i through unchanged", async (raw) => {
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const res = await request(createErrorTestApp()).get(`/api/test-error-status/${raw}`);
    expect(res.status).toBe(raw);
    logSpy.mockRestore();
  });
});
