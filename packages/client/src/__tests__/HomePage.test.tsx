import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomePage } from "../pages/HomePage";
import { MemoryRouter } from "react-router-dom";
import { api } from "../api/client";

vi.mock("../api/client", () => ({
  ApiRequestError: class ApiRequestError extends Error {
    constructor(
      message: string,
      public readonly status: number,
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
      completion_threshold: "final" as const,
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
    vi.mocked(api.projects.list).mockRejectedValue(new Error("Network error"));
    renderHomePage();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText("Failed to load projects")).toBeInTheDocument();
    });
  });

  it("shows fallback error when loadProjects fails with non-Error", async () => {
    vi.mocked(api.projects.list).mockRejectedValue("something weird");
    renderHomePage();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText("Failed to load projects")).toBeInTheDocument();
    });
  });

  it("shows error banner when handleCreate fails", async () => {
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
  });

  it("shows error banner when handleDelete fails", async () => {
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
});
