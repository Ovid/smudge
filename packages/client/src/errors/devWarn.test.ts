import { describe, it, vi, afterEach } from "vitest";
import { devWarn } from "./devWarn";
import { expectConsole } from "../__tests__/expectConsole";

describe("devWarn", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns silent when the signal is already aborted", () => {
    vi.stubEnv("DEV", true);
    const warn = expectConsole("warn");
    const ctrl = new AbortController();
    ctrl.abort();
    devWarn("test-context", ctrl.signal, new Error("boom"));
    warn.silent();
  });

  it("calls console.warn with 'context: error' format when DEV is true and signal is not aborted", () => {
    vi.stubEnv("DEV", true);
    const warn = expectConsole("warn");
    const ctrl = new AbortController();
    const err = new Error("boom");
    devWarn("test-context", ctrl.signal, err);
    warn.calledWith("test-context:", err);
  });

  it("stays silent when DEV is false", () => {
    vi.stubEnv("DEV", false);
    const warn = expectConsole("warn");
    const ctrl = new AbortController();
    devWarn("test-context", ctrl.signal, new Error("boom"));
    warn.silent();
  });
});
