import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsDialog } from "../components/SettingsDialog";
import { api } from "../api/client";

vi.mock("../api/client");

describe("SettingsDialog", () => {
  const onClose = vi.fn();

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.mocked(api.settings.get).mockResolvedValue({ timezone: "UTC" });
    vi.mocked(api.settings.update).mockResolvedValue({ message: "ok" });
  });

  it("renders timezone dropdown with current value", async () => {
    render(<SettingsDialog open={true} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByLabelText(/timezone/i)).toBeInTheDocument();
    });
  });

  it("saves timezone on submit", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog open={true} onClose={onClose} />);
    await waitFor(() => screen.getByLabelText(/timezone/i));

    const select = screen.getByLabelText(/timezone/i);
    await user.selectOptions(select, "America/New_York");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(api.settings.update).toHaveBeenCalledWith([
      { key: "timezone", value: "America/New_York" },
    ]);
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when cancel is clicked", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog open={true} onClose={onClose} />);
    await waitFor(() => screen.getByLabelText(/timezone/i));
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
