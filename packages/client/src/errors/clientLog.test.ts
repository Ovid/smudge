import { describe, it, vi, afterEach } from "vitest";
import { clientWarn, clientError } from "./clientLog";
import { expectConsole } from "../__tests__/expectConsole";

describe("clientLog (F-9 DEV-gated client logging)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("clientWarn forwards args verbatim to console.warn when DEV is true", () => {
    vi.stubEnv("DEV", true);
    const warn = expectConsole("warn");
    const err = new Error("boom");
    clientWarn("Failed to load:", err);
    warn.calledWith("Failed to load:", err);
  });

  it("clientError forwards args verbatim to console.error when DEV is true", () => {
    vi.stubEnv("DEV", true);
    const error = expectConsole("error");
    const err = new Error("boom");
    clientError("Save failed:", err);
    error.calledWith("Save failed:", err);
  });

  it("clientWarn stays silent in production (DEV false) — raw errors never reach the console", () => {
    vi.stubEnv("DEV", false);
    const warn = expectConsole("warn");
    clientWarn("Failed to load:", new Error("boom"));
    warn.silent();
  });

  it("clientError stays silent in production (DEV false)", () => {
    vi.stubEnv("DEV", false);
    const error = expectConsole("error");
    clientError("Save failed:", new Error("boom"));
    error.silent();
  });
});
