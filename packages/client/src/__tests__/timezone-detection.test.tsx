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

    expect(api.settings.update).toHaveBeenCalledWith([
      { key: "timezone", value: expect.any(String) },
    ]);
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
