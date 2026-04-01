import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { setupTestDb } from "./test-helpers";

const ctx = setupTestDb();

describe("GET /api/health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(ctx.app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
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

describe("Global error handler via malformed JSON", () => {
  it("returns 400 for malformed JSON body", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await request(ctx.app)
      .post("/api/projects")
      .set("Content-Type", "application/json")
      .send("{ invalid json }");

    // Express json() middleware produces a SyntaxError which hits the error handler
    expect(res.status).toBeGreaterThanOrEqual(400);
    consoleSpy.mockRestore();
  });
});
