import { describe, it, expect, vi, afterEach } from "vitest";
import { clientWarn, clientError } from "./clientLog";

describe("clientLog (F-9 DEV-gated client logging)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("clientWarn forwards args verbatim to console.warn when DEV is true", () => {
    vi.stubEnv("DEV", true);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = new Error("boom");
    clientWarn("Failed to load:", err);
    expect(warnSpy).toHaveBeenCalledWith("Failed to load:", err);
    warnSpy.mockRestore();
  });

  it("clientError forwards args verbatim to console.error when DEV is true", () => {
    vi.stubEnv("DEV", true);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("boom");
    clientError("Save failed:", err);
    expect(errorSpy).toHaveBeenCalledWith("Save failed:", err);
    errorSpy.mockRestore();
  });

  it("clientWarn stays silent in production (DEV false) — raw errors never reach the console", () => {
    vi.stubEnv("DEV", false);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    clientWarn("Failed to load:", new Error("boom"));
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("clientError stays silent in production (DEV false)", () => {
    vi.stubEnv("DEV", false);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    clientError("Save failed:", new Error("boom"));
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
