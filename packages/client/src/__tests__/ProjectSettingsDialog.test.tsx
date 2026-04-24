import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectSettingsDialog } from "../components/ProjectSettingsDialog";
import { api, ApiRequestError } from "../api/client";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    api: {
      projects: { update: vi.fn() },
      settings: { get: vi.fn(), update: vi.fn() },
    },
  };
});

const defaultProject = {
  id: "1",
  slug: "test",
  title: "Test",
  mode: "fiction" as const,
  target_word_count: null as number | null,
  target_deadline: null as string | null,
  author_name: null as string | null,
  created_at: "",
  updated_at: "",
};

describe("ProjectSettingsDialog", () => {
  const onClose = vi.fn();
  const onUpdate = vi.fn();

  beforeEach(() => {
    vi.mocked(api.projects.update).mockResolvedValue(defaultProject as never);
    vi.mocked(api.settings.get).mockResolvedValue({ timezone: "UTC" });
    vi.mocked(api.settings.update).mockResolvedValue({ message: "ok" });
    onClose.mockClear();
    onUpdate.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders word count target input", () => {
    render(
      <ProjectSettingsDialog
        open={true}
        project={defaultProject as never}
        onClose={onClose}
        onUpdate={onUpdate}
      />,
    );
    expect(screen.getByLabelText(/word count target/i)).toBeInTheDocument();
  });

  it("renders deadline input", () => {
    render(
      <ProjectSettingsDialog
        open={true}
        project={defaultProject as never}
        onClose={onClose}
        onUpdate={onUpdate}
      />,
    );
    expect(screen.getByLabelText(/deadline/i)).toBeInTheDocument();
  });

  it("saves changes on input blur", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSettingsDialog
        open={true}
        project={defaultProject as never}
        onClose={onClose}
        onUpdate={onUpdate}
      />,
    );
    const input = screen.getByLabelText(/word count target/i);
    await user.clear(input);
    await user.type(input, "80000");
    // Blur to a non-Clear element so the relatedTarget check doesn't skip save
    fireEvent.blur(input, { relatedTarget: screen.getByLabelText(/deadline/i) });

    await waitFor(() => {
      expect(api.projects.update).toHaveBeenCalled();
    });
  });

  it("clears word count target when Clear button is clicked", async () => {
    const user = userEvent.setup();
    const projectWithTarget = { ...defaultProject, target_word_count: 80000 };
    render(
      <ProjectSettingsDialog
        open={true}
        project={projectWithTarget as never}
        onClose={onClose}
        onUpdate={onUpdate}
      />,
    );

    // There are multiple Clear buttons (word count + deadline); get the first one
    const clearButtons = screen.getAllByRole("button", { name: /clear/i });
    expect(clearButtons[0]).toBeDefined();
    await user.click(clearButtons[0] as HTMLElement);

    await waitFor(() => {
      expect(api.projects.update).toHaveBeenCalledWith("test", { target_word_count: null });
    });
    expect(onUpdate).toHaveBeenCalled();
  });

  it("saves deadline when date input changes", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSettingsDialog
        open={true}
        project={defaultProject as never}
        onClose={onClose}
        onUpdate={onUpdate}
      />,
    );

    const deadlineInput = screen.getByLabelText(/deadline/i);
    await user.clear(deadlineInput);
    await user.type(deadlineInput, "2026-12-31");

    await waitFor(() => {
      expect(api.projects.update).toHaveBeenCalledWith("test", { target_deadline: "2026-12-31" });
    });
    expect(onUpdate).toHaveBeenCalled();
  });

  it("clears deadline when Clear button is clicked", async () => {
    const user = userEvent.setup();
    const projectWithDeadline = { ...defaultProject, target_deadline: "2026-12-31" };
    render(
      <ProjectSettingsDialog
        open={true}
        project={projectWithDeadline as never}
        onClose={onClose}
        onUpdate={onUpdate}
      />,
    );

    // Second Clear button is for deadline
    const clearButtons = screen.getAllByRole("button", { name: /clear/i });
    expect(clearButtons[1]).toBeDefined();
    await user.click(clearButtons[1] as HTMLElement);

    await waitFor(() => {
      expect(api.projects.update).toHaveBeenCalledWith("test", { target_deadline: null });
    });
    expect(onUpdate).toHaveBeenCalled();
  });

  it("rejects negative word count without saving", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSettingsDialog
        open={true}
        project={defaultProject as never}
        onClose={onClose}
        onUpdate={onUpdate}
      />,
    );
    const input = screen.getByLabelText(/word count target/i);
    await user.clear(input);
    await user.type(input, "-5");
    // Clear mock before the blur that should be rejected
    vi.mocked(api.projects.update).mockClear();
    vi.mocked(api.projects.update).mockResolvedValue(defaultProject as never);
    await user.tab();

    // Negative value should be rejected — no update call
    expect(api.projects.update).not.toHaveBeenCalled();
  });

  it("fires onUpdate on possiblyCommitted (2xx BAD_JSON) branch (I8)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(api.projects.update).mockRejectedValue(
      new ApiRequestError("Malformed response body", 200, "BAD_JSON"),
    );
    const user = userEvent.setup();
    render(
      <ProjectSettingsDialog
        open={true}
        project={defaultProject as never}
        onClose={onClose}
        onUpdate={onUpdate}
      />,
    );
    const input = screen.getByLabelText(/word count target/i);
    await user.clear(input);
    await user.type(input, "50000");
    fireEvent.blur(input, { relatedTarget: screen.getByLabelText(/deadline/i) });

    await waitFor(() => {
      expect(api.projects.update).toHaveBeenCalled();
    });
    // Parent refresh must fire so state consumed by ProgressStrip/dashboard
    // does not render pre-change values after the dialog closes.
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalled();
    });
    errSpy.mockRestore();
  });

  it("logs error when save fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(api.projects.update).mockRejectedValue(new Error("save failed"));
    const user = userEvent.setup();
    render(
      <ProjectSettingsDialog
        open={true}
        project={defaultProject as never}
        onClose={onClose}
        onUpdate={onUpdate}
      />,
    );
    const input = screen.getByLabelText(/word count target/i);
    await user.clear(input);
    await user.type(input, "50000");
    // Blur to a non-Clear element so the relatedTarget check doesn't skip save
    fireEvent.blur(input, { relatedTarget: screen.getByLabelText(/deadline/i) });

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith("Failed to save project setting:", expect.any(Error));
    });
    spy.mockRestore();
  });

  it("returns null when open is false", () => {
    const { container } = render(
      <ProjectSettingsDialog
        open={false}
        project={defaultProject as never}
        onClose={onClose}
        onUpdate={onUpdate}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("calls onClose when close button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSettingsDialog
        open={true}
        project={defaultProject as never}
        onClose={onClose}
        onUpdate={onUpdate}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("renders timezone dropdown with fetched value", async () => {
    vi.mocked(api.settings.get).mockResolvedValue({ timezone: "America/New_York" });
    render(
      <ProjectSettingsDialog
        open={true}
        project={defaultProject as never}
        onClose={onClose}
        onUpdate={onUpdate}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/timezone/i)).toHaveValue("America/New_York");
    });
  });

  it("calls api.settings.update when timezone changes", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSettingsDialog
        open={true}
        project={defaultProject as never}
        onClose={onClose}
        onUpdate={onUpdate}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/timezone/i)).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText(/timezone/i), "Europe/London");

    await waitFor(() => {
      expect(api.settings.update).toHaveBeenCalledWith(
        [{ key: "timezone", value: "Europe/London" }],
        expect.any(AbortSignal),
      );
    });
  });

  it("reverts timezone on save failure", async () => {
    vi.mocked(api.settings.get).mockResolvedValue({ timezone: "UTC" });
    vi.mocked(api.settings.update).mockRejectedValue(new Error("save failed"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    render(
      <ProjectSettingsDialog
        open={true}
        project={defaultProject as never}
        onClose={onClose}
        onUpdate={onUpdate}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/timezone/i)).toHaveValue("UTC");
    });

    await user.selectOptions(screen.getByLabelText(/timezone/i), "Europe/London");

    await waitFor(() => {
      expect(screen.getByLabelText(/timezone/i)).toHaveValue("UTC");
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    spy.mockRestore();
  });

  it("falls back to UTC when settings fetch fails", async () => {
    vi.mocked(api.settings.get).mockRejectedValue(new Error("fetch failed"));
    render(
      <ProjectSettingsDialog
        open={true}
        project={defaultProject as never}
        onClose={onClose}
        onUpdate={onUpdate}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/timezone/i)).toHaveValue("UTC");
    });
  });
});
