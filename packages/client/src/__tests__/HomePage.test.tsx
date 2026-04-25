import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomePage } from "../pages/HomePage";
import { MemoryRouter } from "react-router-dom";
import { api, ApiRequestError } from "../api/client";

vi.mock("../api/client", () => ({
  ApiRequestError: class ApiRequestError extends Error {
    constructor(
      message: string,
      public readonly status: number,
      public readonly code?: string,
    ) {
      super(message);
      this.name = "ApiRequestError";
    }
  },
  api: {
    projects: {
      list: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

// jsdom doesn't implement HTMLDialogElement.showModal/close
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderHomePage() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

describe("HomePage", () => {
  it("shows empty state when no projects exist", async () => {
    vi.mocked(api.projects.list).mockResolvedValue([]);
    renderHomePage();

    await waitFor(() => {
      expect(screen.getByText("No projects yet. Create one to start writing.")).toBeInTheDocument();
    });
  });

  it("renders project list", async () => {
    vi.mocked(api.projects.list).mockResolvedValue([
      {
        id: "p1",
        slug: "novel-one",
        title: "Novel One",
        mode: "fiction",
        total_word_count: 1234,
        updated_at: "",
      },
      {
        id: "p2",
        slug: "memoir",
        title: "Memoir",
        mode: "nonfiction",
        total_word_count: 5678,
        updated_at: "",
      },
    ]);
    renderHomePage();

    await waitFor(() => {
      expect(screen.getByText("Novel One")).toBeInTheDocument();
    });
    expect(screen.getByText("Memoir")).toBeInTheDocument();
    expect(screen.getAllByText("Fiction").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Non-fiction").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("1,234 words")).toBeInTheDocument();
    expect(screen.getByText("5,678 words")).toBeInTheDocument();
  });

  it("navigates to project on click", async () => {
    vi.mocked(api.projects.list).mockResolvedValue([
      {
        id: "p1",
        slug: "novel-one",
        title: "Novel One",
        mode: "fiction",
        total_word_count: 0,
        updated_at: "",
      },
    ]);
    renderHomePage();

    await waitFor(() => {
      expect(screen.getByText("Novel One")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Novel One"));
    expect(mockNavigate).toHaveBeenCalledWith("/projects/novel-one");
  });

  it("opens dialog and creates project", async () => {
    vi.mocked(api.projects.list).mockResolvedValue([]);
    vi.mocked(api.projects.create).mockResolvedValue({
      id: "new-proj",
      slug: "my-book",
      title: "My Book",
      mode: "fiction",
      target_word_count: null,
      target_deadline: null,
      author_name: null,
      created_at: "",
      updated_at: "",
      deleted_at: null,
    });
    renderHomePage();

    await waitFor(() => {
      expect(screen.getByText("No projects yet. Create one to start writing.")).toBeInTheDocument();
    });

    // Click "New Project" button to open dialog
    await userEvent.click(screen.getByRole("button", { name: "New Project" }));
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();

    // Fill and submit form
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "My Book");
    const form = input.closest("form") as HTMLFormElement;
    const submitButton = form.querySelector("button[type='submit']") as HTMLButtonElement;
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(api.projects.create).toHaveBeenCalledWith({ title: "My Book", mode: "fiction" });
    });
    expect(mockNavigate).toHaveBeenCalledWith("/projects/my-book");
  });

  it("displays the app name in the header", async () => {
    vi.mocked(api.projects.list).mockResolvedValue([]);
    renderHomePage();

    expect(screen.getByRole("heading", { name: "Smudge", level: 1 })).toBeInTheDocument();
  });

  it("has accessible main landmark", async () => {
    vi.mocked(api.projects.list).mockResolvedValue([]);
    renderHomePage();

    expect(screen.getByRole("main")).toHaveAttribute("aria-label", "Main content");
  });

  it("shows a delete button for each project", async () => {
    vi.mocked(api.projects.list).mockResolvedValue([
      {
        id: "p1",
        slug: "novel-one",
        title: "Novel One",
        mode: "fiction",
        total_word_count: 0,
        updated_at: "",
      },
    ]);
    renderHomePage();

    await waitFor(() => {
      expect(screen.getByText("Novel One")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("shows confirmation dialog before deleting", async () => {
    vi.mocked(api.projects.list).mockResolvedValue([
      {
        id: "p1",
        slug: "novel-one",
        title: "Novel One",
        mode: "fiction",
        total_word_count: 0,
        updated_at: "",
      },
    ]);
    renderHomePage();

    await waitFor(() => {
      expect(screen.getByText("Novel One")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /delete/i }));

    // Confirmation dialog should appear
    expect(screen.getByText(/move.*novel one.*to trash/i)).toBeInTheDocument();
    expect(screen.getByText(/restore.*within 30 days/i)).toBeInTheDocument();
  });

  it("deletes project on confirmation and removes from list", async () => {
    vi.mocked(api.projects.list).mockResolvedValue([
      {
        id: "p1",
        slug: "novel-one",
        title: "Novel One",
        mode: "fiction",
        total_word_count: 0,
        updated_at: "",
      },
    ]);
    vi.mocked(api.projects.delete).mockResolvedValue({ message: "ok" });
    renderHomePage();

    await waitFor(() => {
      expect(screen.getByText("Novel One")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /delete/i }));
    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() => {
      expect(api.projects.delete).toHaveBeenCalledWith("novel-one");
    });
  });

  it("shows error banner when loadProjects fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.projects.list).mockRejectedValue(new Error("Network error"));
    renderHomePage();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText("Failed to load projects")).toBeInTheDocument();
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load projects:"),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("shows fallback error when loadProjects fails with non-Error", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.projects.list).mockRejectedValue("something weird");
    renderHomePage();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText("Failed to load projects")).toBeInTheDocument();
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load projects:"),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it("shows error banner when handleCreate fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.projects.list).mockResolvedValue([]);
    vi.mocked(api.projects.create).mockRejectedValue(new Error("Create failed"));
    renderHomePage();

    await waitFor(() => {
      expect(screen.getByText("No projects yet. Create one to start writing.")).toBeInTheDocument();
    });

    // Open dialog and create
    await userEvent.click(screen.getByRole("button", { name: "New Project" }));
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "My Book");
    const form = input.closest("form") as HTMLFormElement;
    const submitButton = form.querySelector("button[type='submit']") as HTMLButtonElement;
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText("Failed to create project")).toBeInTheDocument();
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to create project:"),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("on 2xx BAD_JSON create, refreshes list and closes dialog to prevent duplicate (I5 2026-04-25)", async () => {
    // I5 (review 2026-04-25): handleCreate destructured only { message }
    // from mapApiError. The project.create scope declares
    // committed: STRINGS.error.possiblyCommitted, so 2xx BAD_JSON returns
    // possiblyCommitted: true. project.create is non-idempotent: the
    // dialog stayed open with the user's input, the row never appeared
    // in the list, and a retry click would create a duplicate project.
    // Mirror siblings: refresh the list (so the just-created row is
    // visible) and close the dialog (so the live "Create" button can't
    // re-fire) before showing the committed banner. The slug isn't
    // available in the unreadable response, so navigation can't be
    // performed automatically — refresh-and-close is the safe default.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.projects.list)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "p1",
          slug: "my-book",
          title: "My Book",
          mode: "fiction",
          total_word_count: 0,
          updated_at: "",
        },
      ]);
    vi.mocked(api.projects.create).mockRejectedValue(
      new ApiRequestError("Malformed response body", 200, "BAD_JSON"),
    );
    renderHomePage();
    await waitFor(() => {
      expect(screen.getByText("No projects yet. Create one to start writing.")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "New Project" }));
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "My Book");
    const form = input.closest("form") as HTMLFormElement;
    const submitButton = form.querySelector("button[type='submit']") as HTMLButtonElement;
    await userEvent.click(submitButton);

    // List re-fetched so the just-created row appears in state without
    // another POST.
    await waitFor(() => expect(api.projects.list).toHaveBeenCalledTimes(2));
    // Newly-created row appears in the list.
    await waitFor(() => expect(screen.getByText("My Book")).toBeInTheDocument());
    // Dialog closed → no live "Create" button to re-fire (the form input
    // is no longer in the document).
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    // Committed banner instructs the user to refresh.
    expect(screen.getByRole("alert")).toHaveTextContent(/may have completed/i);
    warnSpy.mockRestore();
  });

  it("aborts the create-recovery list refetch on unmount (I13 2026-04-25)", async () => {
    // I13 (review 2026-04-25): the possiblyCommitted recovery branch in
    // handleCreate did a fire-and-forget api.projects.list().then(setProjects)
    // with no AbortController/unmount guard. If the user navigates away
    // before the refetch resolves, setProjects fires on an unmounted
    // component — the same shape the loadProjects-effect abort pattern
    // was introduced to silence. Verify the recovery list receives a
    // signal that is aborted on unmount.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const listSignals: (AbortSignal | undefined)[] = [];
    vi.mocked(api.projects.list).mockImplementation((signal?: AbortSignal) => {
      listSignals.push(signal);
      // Initial load resolves immediately so the page can render.
      if (listSignals.length === 1) return Promise.resolve([]);
      // Recovery refetch never resolves — we only need to inspect the signal.
      return new Promise<never>(() => {});
    });
    vi.mocked(api.projects.create).mockRejectedValue(
      new ApiRequestError("Malformed response body", 200, "BAD_JSON"),
    );

    const { unmount } = renderHomePage();
    await waitFor(
      () => {
        expect(
          screen.getByText("No projects yet. Create one to start writing."),
        ).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    await userEvent.click(screen.getByRole("button", { name: "New Project" }));
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "My Book");
    const form = input.closest("form") as HTMLFormElement;
    const submitButton = form.querySelector("button[type='submit']") as HTMLButtonElement;
    await userEvent.click(submitButton);

    // Recovery list refetch fires after the BAD_JSON catch.
    await waitFor(() => expect(listSignals).toHaveLength(2), { timeout: 3000 });
    // Recovery call receives an AbortSignal (the abort plumbing).
    expect(listSignals[1]).toBeInstanceOf(AbortSignal);
    expect(listSignals[1]?.aborted).toBe(false);

    unmount();

    // Unmount cleanup must abort the recovery signal so the .then
    // handler bails before calling setProjects on a torn-down tree.
    expect(listSignals[1]?.aborted).toBe(true);
    warnSpy.mockRestore();
  });

  // I1 (review 2026-04-24): handleDelete ignored possiblyCommitted. On
  // 2xx BAD_JSON the server deleted the project but the row stayed in
  // the local list — the user saw a phantom project, a retry 404d, and
  // the committed copy that warns about refreshing was never shown.
  // Mirror siblings: on possiblyCommitted, optimistically drop the row
  // from state and surface the committed copy via setError.
  it("on 2xx BAD_JSON delete, drops row and surfaces committed copy (I1)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.projects.list).mockResolvedValue([
      {
        id: "p1",
        slug: "novel-one",
        title: "Novel One",
        mode: "fiction",
        total_word_count: 0,
        updated_at: "",
      },
    ]);
    vi.mocked(api.projects.delete).mockRejectedValue(
      new ApiRequestError("Malformed response body", 200, "BAD_JSON"),
    );
    renderHomePage();

    await waitFor(() => {
      expect(screen.getByText("Novel One")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /delete/i }));
    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));

    // Row is optimistically dropped — the server likely deleted it.
    await waitFor(() => {
      expect(screen.queryByText("Novel One")).not.toBeInTheDocument();
    });
    // Committed copy in the alert banner tells the user to refresh.
    expect(screen.getByRole("alert")).toHaveTextContent(/may have completed/i);
    warnSpy.mockRestore();
  });

  it("shows error banner when handleDelete fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.projects.list).mockResolvedValue([
      {
        id: "p1",
        slug: "novel-one",
        title: "Novel One",
        mode: "fiction",
        total_word_count: 0,
        updated_at: "",
      },
    ]);
    vi.mocked(api.projects.delete).mockRejectedValue(new Error("Delete failed"));
    renderHomePage();

    await waitFor(() => {
      expect(screen.getByText("Novel One")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /delete/i }));
    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText("Failed to delete project")).toBeInTheDocument();
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to delete project:"),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("cancels delete and keeps project in list", async () => {
    vi.mocked(api.projects.list).mockResolvedValue([
      {
        id: "p1",
        slug: "novel-one",
        title: "Novel One",
        mode: "fiction",
        total_word_count: 0,
        updated_at: "",
      },
    ]);
    renderHomePage();

    await waitFor(() => {
      expect(screen.getByText("Novel One")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /delete/i }));
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.getByText("Novel One")).toBeInTheDocument();
    expect(api.projects.delete).not.toHaveBeenCalled();
  });

  it("does not console.warn when loadProjects rejects after unmount", async () => {
    // Copilot review 2026-04-24: the previous bare `cancelled` flag
    // with warn ABOVE the check produced console noise on navigation/
    // unmount races. Verify the abort path keeps test output clean
    // (zero-warnings-in-test-output rule).
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let rejectFn: (err: Error) => void = () => {};
    vi.mocked(api.projects.list).mockReturnValue(
      new Promise<never>((_, reject) => {
        rejectFn = reject;
      }),
    );

    const { unmount } = renderHomePage();
    // Unmount BEFORE the rejection lands.
    unmount();
    // Now reject and let microtasks drain.
    rejectFn(new Error("Network error"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
