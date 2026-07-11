import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import knex from "knex";
import { createApp, globalErrorHandler } from "../app";
import { requestContext } from "../requestContext";
import { logger } from "../logger";
import { setDb, closeDb } from "../db/connection";
import { createTestKnexConfig } from "../db/knexfile";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// /api/health now runs a real SQLite liveness probe (F-14), so these
// middleware tests need an initialized DB for the endpoint to return 200
// quietly — matching production, where initDb() always runs before the
// app serves requests.
beforeAll(async () => {
  await setDb(knex(createTestKnexConfig()));
});
afterAll(async () => {
  await closeDb();
});

describe("requestContext middleware (F-10 request correlation)", () => {
  it("sets an X-Request-Id response header (generated UUID) when none is provided", async () => {
    const res = await request(createApp()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers["x-request-id"]).toMatch(UUID_RE);
  });

  it("echoes a valid incoming X-Request-Id (correlation propagation)", async () => {
    const res = await request(createApp())
      .get("/api/health")
      .set("X-Request-Id", "trace-abc_123.4");
    expect(res.headers["x-request-id"]).toBe("trace-abc_123.4");
  });

  it("ignores an invalid incoming X-Request-Id and generates a fresh UUID", async () => {
    const res = await request(createApp())
      .get("/api/health")
      .set("X-Request-Id", "has spaces and <bad> chars");
    expect(res.headers["x-request-id"]).not.toBe("has spaces and <bad> chars");
    expect(res.headers["x-request-id"]).toMatch(UUID_RE);
  });

  it("logs at debug level when an inbound X-Request-Id is rejected (S1: observability)", async () => {
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => logger);
    await request(createApp()).get("/api/health").set("X-Request-Id", "has spaces and <bad> chars");
    expect(debugSpy).toHaveBeenCalledWith(
      expect.objectContaining({ raw: "has spaces and <bad> chars" }),
      "discarded inbound x-request-id",
    );
    debugSpy.mockRestore();
  });

  it("does NOT log a rejection when no inbound X-Request-Id is provided (S1)", async () => {
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => logger);
    await request(createApp()).get("/api/health");
    expect(debugSpy).not.toHaveBeenCalledWith(expect.anything(), "discarded inbound x-request-id");
    debugSpy.mockRestore();
  });

  it("does NOT log a rejection when the inbound X-Request-Id is accepted (S1)", async () => {
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => logger);
    await request(createApp()).get("/api/health").set("X-Request-Id", "trace-abc_123.4");
    expect(debugSpy).not.toHaveBeenCalledWith(expect.anything(), "discarded inbound x-request-id");
    debugSpy.mockRestore();
  });

  it("correlates the unhandled-error log via req.log (bound req_id/method/path) (S3)", async () => {
    // S3: globalErrorHandler now logs through req.log (a pino child bound to
    // {req_id, method, path}) rather than re-binding those fields on every
    // error call. Capture the child created by requestContext via a
    // logger.child spy and assert the bindings + error call separately.
    const childError = vi.fn();
    const fakeChild = {
      error: childError,
      debug: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    } as unknown as ReturnType<typeof logger.child>;
    const childSpy = vi.spyOn(logger, "child").mockImplementation(() => fakeChild);

    const app = express();
    app.use(requestContext);
    app.get("/api/boom", (_req, _res, next) => next(new Error("kaboom")));
    app.use(globalErrorHandler);

    const res = await request(app).get("/api/boom").set("X-Request-Id", "corr-1");

    expect(res.status).toBe(500);
    expect(childSpy).toHaveBeenCalledWith({
      req_id: "corr-1",
      method: "GET",
      path: "/api/boom",
    });
    expect(childError).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({ message: "kaboom" }),
        status: 500,
      }),
      "Unhandled request error",
    );
    childSpy.mockRestore();
  });

  it("falls back to the top-level logger when req.log was never set (pre-middleware error) (S3)", async () => {
    // Errors thrown from middleware that ran BEFORE requestContext (e.g.
    // helmet) reach globalErrorHandler without req.log set. The fallback
    // logs via the top-level logger with explicit method/path so the
    // error is still traceable.
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);

    const app = express();
    // Note: requestContext is NOT mounted, simulating the pre-middleware path.
    app.get("/api/boom", (_req, _res, next) => next(new Error("kaboom")));
    app.use(globalErrorHandler);

    const res = await request(app).get("/api/boom");

    expect(res.status).toBe(500);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 500,
        method: "GET",
        path: "/api/boom",
        err: expect.objectContaining({ message: "kaboom" }),
      }),
      "Unhandled request error",
    );
    logSpy.mockRestore();
  });
});
