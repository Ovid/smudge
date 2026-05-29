import { describe, it, expect, vi, afterEach } from "vitest";

// The logger configures itself from env at module-eval time, so each test
// stubs the env, resets the module registry, and re-imports to re-run that
// one-shot configuration in isolation.
describe("logger configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("pino");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("defaults to the 'info' level when LOG_LEVEL is unset", async () => {
    vi.stubEnv("LOG_LEVEL", "");
    vi.resetModules();
    const { logger } = await import("../logger");
    expect(logger.level).toBe("info");
  });

  it("honours a valid LOG_LEVEL", async () => {
    vi.stubEnv("LOG_LEVEL", "debug");
    vi.resetModules();
    const { logger } = await import("../logger");
    expect(logger.level).toBe("debug");
  });

  it("warns and falls back to 'info' for an invalid LOG_LEVEL", async () => {
    vi.stubEnv("LOG_LEVEL", "verbose");
    vi.resetModules();
    // Spy must be installed before the import, since the warn fires during
    // module evaluation.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { logger } = await import("../logger");
    expect(logger.level).toBe("info");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid LOG_LEVEL "verbose"'));
  });

  it("wires the pino-pretty transport when NODE_ENV is development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOG_LEVEL", "");
    vi.resetModules();
    // Mock pino so we assert the config without spawning a pino-pretty worker
    // thread (which would leak a handle and risk noisy test output).
    const pinoFactory = vi.fn(() => ({ level: "info" }));
    vi.doMock("pino", () => ({ default: pinoFactory }));
    await import("../logger");
    expect(pinoFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "info",
        transport: expect.objectContaining({ target: "pino-pretty" }),
      }),
    );
  });
});
