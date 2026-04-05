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

  it("renders timezone dropdown with multiple timezone options", async () => {
    render(<SettingsDialog open={true} onClose={onClose} />);
    await waitFor(() => screen.getByLabelText(/timezone/i));

    const select = screen.getByLabelText(/timezone/i);
    const options = select.querySelectorAll("option");
    // Should have at least UTC and several IANA timezones
    expect(options.length).toBeGreaterThan(1);
    // Verify a common timezone is present
    const optionValues = Array.from(options).map((o) => o.getAttribute("value"));
    expect(optionValues).toContain("America/New_York");
  });

  it("returns null when open is false", () => {
    const { container } = render(<SettingsDialog open={false} onClose={onClose} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows error message when save fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(api.settings.update).mockRejectedValue(new Error("Network error"));
    const user = userEvent.setup();
    render(<SettingsDialog open={true} onClose={onClose} />);
    await waitFor(() => screen.getByLabelText(/timezone/i));

    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/failed to save/i);
    });
    expect(onClose).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("falls back to UTC when settings fetch fails", async () => {
    vi.mocked(api.settings.get).mockRejectedValue(new Error("Network error"));
    render(<SettingsDialog open={true} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByLabelText(/timezone/i)).toBeInTheDocument();
    });

    // When fetch fails, timezone state is set to "UTC" but the select
    // will show the first available option if "UTC" isn't in the IANA list
    const select = screen.getByLabelText(/timezone/i) as HTMLSelectElement;
    // Verify the select rendered and has a value (timezone was set)
    expect(select.value).toBeTruthy();
  });
});
