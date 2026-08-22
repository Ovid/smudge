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
    const res = await request(ctx.app).get("/api/health").set("Origin", "http://localhost:5173");
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

// F-02 (architecture report 2026-08-22): DNS rebinding is the path that reaches
// a writer who never exposed anything — the attacker's page is same-origin with
// the target from the browser's point of view, so a GET carries NO Origin
// header at all and only `Host` names the attacker's domain. Validating Host is
// therefore the load-bearing defence; validating Origin would inspect a header
// the attack does not send.
describe("Host validation (F-02)", () => {
  // I7 (code review 2026-08-22): the rejection used to be completely silent,
  // and the warning is asserted here rather than merely suppressed because the
  // log line IS part of the contract this test describes. It is a 400
  // AppError, and globalErrorHandler logs AppErrors only at status >= 500 —
  // 4xx are expected outcomes, deliberately quiet — while requestContext's own
  // access log is `debug`, suppressed at the default `info` level. So
  // `app.ts`'s "Runs after requestContext so a rejection is traceable" was
  // false at default configuration: a rebinding attempt wrote NOTHING to the
  // server log, and the response carried an X-Request-Id matching no log line.
  // This branch's own F-34 fix converts a silent skip into an observable
  // warning on exactly that argument.
  it.each([
    ["a rebinding domain", "evil.com"],
    ["a rebinding domain with the server port", "evil.com:3456"],
    ["a LAN address", "192.168.1.50:3456"],
  ])("rejects %s with 400 INVALID_HOST and logs it", async (_label, host) => {
    const child = logger.child({});
    const warnSpy = vi.spyOn(child, "warn").mockImplementation(() => {});
    const childSpy = vi.spyOn(logger, "child").mockReturnValue(child);

    const res = await request(ctx.app).get("/api/health").set("Host", host);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_HOST");
    expect(warnSpy).toHaveBeenCalledWith({ host }, expect.stringContaining("Host"));

    childSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it.each([
    ["localhost", "localhost:3456"],
    ["IPv4 loopback", "127.0.0.1:3456"],
    ["IPv6 loopback", "[::1]:3456"],
    ["a bare loopback name with no port", "localhost"],
  ])("accepts %s", async (_label, host) => {
    const res = await request(ctx.app).get("/api/health").set("Host", host);
    expect(res.status).toBe(200);
  });

  // The Host is attacker-controlled, so it is truncated before it reaches the
  // log. An unbounded value is a log-flooding lever on the one field this
  // rejection exists to record.
  it("truncates an overlong Host before logging it", async () => {
    const child = logger.child({});
    const warnSpy = vi.spyOn(child, "warn").mockImplementation(() => {});
    const childSpy = vi.spyOn(logger, "child").mockReturnValue(child);

    await request(ctx.app)
      .get("/api/health")
      .set("Host", `${"a".repeat(500)}.evil.com`);

    const logged = (warnSpy.mock.calls[0]?.[0] as { host: string }).host;
    expect(logged).toHaveLength(128);

    childSpy.mockRestore();
    warnSpy.mockRestore();
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
