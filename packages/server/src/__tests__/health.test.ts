import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { setupTestDb } from "./test-helpers";
import { logger } from "../logger";

const ctx = setupTestDb();

describe("GET /api/health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(ctx.app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("returns 503 with status error when the SQLite handle is unusable (F-14)", async () => {
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);
    const rawSpy = vi
      .spyOn(ctx.db, "raw")
      .mockRejectedValueOnce(new Error("database is locked") as never);

    const res = await request(ctx.app).get("/api/health");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "error" });

    rawSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("includes security headers from helmet", async () => {
    const res = await request(ctx.app).get("/api/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBeDefined();
  });

  it("includes Content-Security-Policy header", async () => {
    const res = await request(ctx.app).get("/api/health");
    const csp = res.headers["content-security-policy"];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

// Safety net (F-02, architecture report 2026-08-22): a grep for Host / Origin
// handling across packages/server/src returns zero production hits today, so
// every request is accepted whatever those headers say. These pin the request
// shapes that must KEEP working once a rebinding defence lands: the Vite dev
// client calling cross-origin under `make dev`, a loopback Host, and the
// header-less request every existing Supertest case already sends.
describe("request-origin shapes that must keep working", () => {
  it("accepts a request carrying the Vite dev client's Origin", async () => {
    const res = await request(ctx.app)
      .get("/api/health")
      .set("Origin", "http://localhost:5173");
    expect(res.status).toBe(200);
  });

  it("accepts a request carrying a loopback Host", async () => {
    const res = await request(ctx.app).get("/api/health").set("Host", "127.0.0.1:3456");
    expect(res.status).toBe(200);
  });

  it("accepts a request carrying neither Host override nor Origin", async () => {
    const res = await request(ctx.app).get("/api/health");
    expect(res.status).toBe(200);
  });
});

describe("Global error handler via malformed JSON", () => {
  it("returns 400 for malformed JSON body", async () => {
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const res = await request(ctx.app)
      .post("/api/projects")
      .set("Content-Type", "application/json")
      .send("{ invalid json }");

    // Express json() middleware produces a SyntaxError which hits the error handler
    expect(res.status).toBeGreaterThanOrEqual(400);
    logSpy.mockRestore();
  });
});
