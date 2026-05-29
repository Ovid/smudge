import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import express from "express";
import { createApp, globalErrorHandler } from "../app";
import { requestContext } from "../requestContext";
import { logger } from "../logger";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    await request(createApp())
      .get("/api/health")
      .set("X-Request-Id", "has spaces and <bad> chars");
    expect(debugSpy).toHaveBeenCalledWith(
      expect.objectContaining({ raw: "has spaces and <bad> chars" }),
      "discarded inbound x-request-id",
    );
    debugSpy.mockRestore();
  });

  it("does NOT log a rejection when no inbound X-Request-Id is provided (S1)", async () => {
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => logger);
    await request(createApp()).get("/api/health");
    expect(debugSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      "discarded inbound x-request-id",
    );
    debugSpy.mockRestore();
  });

  it("does NOT log a rejection when the inbound X-Request-Id is accepted (S1)", async () => {
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => logger);
    await request(createApp()).get("/api/health").set("X-Request-Id", "trace-abc_123.4");
    expect(debugSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      "discarded inbound x-request-id",
    );
    debugSpy.mockRestore();
  });

  it("correlates the unhandled-error log with req_id, method, and path", async () => {
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);

    const app = express();
    app.use(requestContext);
    app.get("/api/boom", (_req, _res, next) => next(new Error("kaboom")));
    app.use(globalErrorHandler);

    const res = await request(app).get("/api/boom").set("X-Request-Id", "corr-1");

    expect(res.status).toBe(500);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 500,
        req_id: "corr-1",
        method: "GET",
        path: "/api/boom",
      }),
      "Unhandled request error",
    );
    logSpy.mockRestore();
  });
});
