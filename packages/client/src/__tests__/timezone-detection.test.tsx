import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../api/client";

vi.mock("../api/client");

describe("timezone auto-detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.settings.get).mockResolvedValue({});
    vi.mocked(api.settings.update).mockResolvedValue({ message: "ok" });
  });

  it("detects browser timezone and sends to server when not set", async () => {
    const { detectAndSetTimezone } = await import("../hooks/useTimezoneDetection");
    await detectAndSetTimezone();

    expect(api.settings.update).toHaveBeenCalledWith(
      [{ key: "timezone", value: expect.any(String) }],
      undefined,
    );
  });

  it("threads the AbortSignal through to both GET and PATCH (I5 2026-04-24)", async () => {
    const { detectAndSetTimezone } = await import("../hooks/useTimezoneDetection");
    const controller = new AbortController();
    await detectAndSetTimezone(controller.signal);

    expect(api.settings.get).toHaveBeenCalledWith(controller.signal);
    expect(api.settings.update).toHaveBeenCalledWith(
      [{ key: "timezone", value: expect.any(String) }],
      controller.signal,
    );
  });

  it("short-circuits the PATCH when the signal is already aborted (I5 2026-04-24)", async () => {
    const { detectAndSetTimezone } = await import("../hooks/useTimezoneDetection");
    const controller = new AbortController();
    controller.abort();
    await detectAndSetTimezone(controller.signal);

    // Detection aborts between GET and PATCH, so update is not issued.
    expect(api.settings.update).not.toHaveBeenCalled();
  });

  it("silently catches errors without throwing", async () => {
    vi.mocked(api.settings.get).mockRejectedValue(new Error("network error"));
    const { detectAndSetTimezone } = await import("../hooks/useTimezoneDetection");
    await expect(detectAndSetTimezone()).resolves.toBeUndefined();
  });

  it("does not overwrite existing timezone setting", async () => {
    vi.mocked(api.settings.get).mockResolvedValue({ timezone: "Europe/London" });

    const { detectAndSetTimezone } = await import("../hooks/useTimezoneDetection");
    await detectAndSetTimezone();

    expect(api.settings.update).not.toHaveBeenCalled();
  });
});
