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
      expect(api.projects.update).toHaveBeenCalledWith(
        "test",
        { target_word_count: null },
        expect.any(AbortSignal),
      );
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
      expect(api.projects.update).toHaveBeenCalledWith(
        "test",
        { target_deadline: "2026-12-31" },
        expect.any(AbortSignal),
      );
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
      expect(api.projects.update).toHaveBeenCalledWith(
        "test",
        { target_deadline: null },
        expect.any(AbortSignal),
      );
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

  // C2 (review 2026-04-24): saveTimezone unconditionally reverts the
  // select on error. On 2xx BAD_JSON the server has committed the new
  // timezone but the client couldn't read the response — reverting would
  // contradict committed state and the parent (dashboard, velocity,
  // ProgressStrip) would keep rendering stale timezone. Mirror saveField:
  // on possiblyCommitted, skip the revert, promote the optimistic value
  // to confirmed, surface the committed copy, and fire onUpdate so the
  // parent refreshes.
  it("on possiblyCommitted (2xx BAD_JSON), keeps optimistic timezone and fires onUpdate (C2)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(api.settings.get).mockResolvedValue({ timezone: "UTC" });
    vi.mocked(api.settings.update).mockRejectedValue(
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
    await waitFor(() => {
      expect(screen.getByLabelText(/timezone/i)).toHaveValue("UTC");
    });
    await user.selectOptions(screen.getByLabelText(/timezone/i), "Europe/London");

    await waitFor(() => {
      expect(api.settings.update).toHaveBeenCalled();
    });
    // Optimistic value must NOT revert — server likely committed.
    expect(screen.getByLabelText(/timezone/i)).toHaveValue("Europe/London");
    // Parent must refresh so consumers see the committed value.
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalled();
    });
    errSpy.mockRestore();
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

  // I4 (2026-04-24 review): the dialog unmounts mid-save (parent
  // navigates, or `key={project.slug}` remounts on rename) while a
  // timezone PATCH is in flight. Without an unmount-scoped abort, the
  // promise continued, the `.then`/`.catch` ran setTimezone /
  // setTimezoneSaveError on an unmounted component, and the test suite
  // logged React's setState-on-unmount warning — violating the
  // "zero warnings in test output" contract from CLAUDE.md.
  it("aborts in-flight timezone PATCH on unmount (I4)", async () => {
    const user = userEvent.setup();
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(api.settings.update).mockImplementation(
      (_settings: unknown, signal?: AbortSignal) => {
        capturedSignal = signal;
        return new Promise(() => {}); // never resolves — we care about abort only
      },
    );

    const { unmount } = render(
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
      expect(api.settings.update).toHaveBeenCalled();
    });
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    unmount();

    expect(capturedSignal?.aborted).toBe(true);
  });

  it("aborts in-flight field PATCH on dialog close→reopen (I10 2026-04-25)", async () => {
    // I10 (review 2026-04-25): fieldAbortRef and timezoneAbortRef were
    // only aborted on unmount. The dialog can close→reopen within the
    // same component lifetime; an in-flight PATCH from the prior
    // open-cycle would land after re-open and stomp confirmedFieldsRef
    // with a stale baseline. The next save's revert would restore the
    // wrong value. Abort on the open-true transition so the prior
    // cycle's PATCH cannot affect the fresh open-cycle's baseline.
    const user = userEvent.setup();
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(api.projects.update).mockImplementation((_slug, _data, signal) => {
      capturedSignal = signal;
      return new Promise(() => {}); // never resolves
    });

    const { rerender } = render(
      <ProjectSettingsDialog
        open={true}
        project={defaultProject as never}
        onClose={onClose}
        onUpdate={onUpdate}
      />,
    );

    // Type in a field and blur to fire a field PATCH.
    const wordCountInput = screen.getByLabelText(/word count target/i);
    await user.type(wordCountInput, "1000");
    fireEvent.blur(wordCountInput);

    await waitFor(() => expect(api.projects.update).toHaveBeenCalled());
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    // Close the dialog. Then reopen it.
    rerender(
      <ProjectSettingsDialog
        open={false}
        project={defaultProject as never}
        onClose={onClose}
        onUpdate={onUpdate}
      />,
    );
    rerender(
      <ProjectSettingsDialog
        open={true}
        project={defaultProject as never}
        onClose={onClose}
        onUpdate={onUpdate}
      />,
    );

    // The prior-cycle's PATCH must be aborted at the open-true
    // transition so its eventual response cannot land against this
    // fresh open-cycle's baseline.
    expect(capturedSignal?.aborted).toBe(true);
  });

  // I4: same bottle applies to the settings GET. The prior guard used
  // a `let cancelled = false` flag — it stopped the .then/.catch from
  // writing state, but the fetch kept running server-side. Wiring an
  // AbortController lets the browser drop the request on unmount and
  // removes the only remaining setState-on-unmount path for this dialog.
  it("aborts in-flight settings GET on unmount (I4)", async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(api.settings.get).mockImplementation((signal?: AbortSignal) => {
      capturedSignal = signal;
      return new Promise(() => {}); // never resolves
    });

    const { unmount } = render(
      <ProjectSettingsDialog
        open={true}
        project={defaultProject as never}
        onClose={onClose}
        onUpdate={onUpdate}
      />,
    );

    await waitFor(() => {
      expect(api.settings.get).toHaveBeenCalled();
    });
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    unmount();

    expect(capturedSignal?.aborted).toBe(true);
  });

  it("surfaces mapped error when settings fetch fails (I9)", async () => {
    // I9: previously silently fell back to UTC, hiding real fetch
    // failures. The user would change to their real timezone, save,
    // and overwrite the stored value. Now surface the mapped message
    // via the existing alert so the user can retry before saving.
    vi.mocked(api.settings.get).mockRejectedValue(
      new ApiRequestError("boom", 500, "INTERNAL_ERROR"),
    );
    render(
      <ProjectSettingsDialog
        open={true}
        project={defaultProject as never}
        onClose={onClose}
        onUpdate={onUpdate}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/unable to load settings/i);
    });
  });
});
