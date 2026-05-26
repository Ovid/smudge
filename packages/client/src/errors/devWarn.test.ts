import { describe, it, expect, vi, afterEach } from "vitest";
import { devWarn } from "./devWarn";

describe("devWarn", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns silent when the signal is already aborted", () => {
    vi.stubEnv("DEV", true);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctrl = new AbortController();
    ctrl.abort();
    devWarn("test-context", ctrl.signal, new Error("boom"));
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("calls console.warn with 'context: error' format when DEV is true and signal is not aborted", () => {
    vi.stubEnv("DEV", true);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctrl = new AbortController();
    const err = new Error("boom");
    devWarn("test-context", ctrl.signal, err);
    expect(warnSpy).toHaveBeenCalledWith("test-context:", err);
    warnSpy.mockRestore();
  });

  it("stays silent when DEV is false", () => {
    vi.stubEnv("DEV", false);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctrl = new AbortController();
    devWarn("test-context", ctrl.signal, new Error("boom"));
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
