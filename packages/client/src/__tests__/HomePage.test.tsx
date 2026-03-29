import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomePage } from "../pages/HomePage";
import { MemoryRouter } from "react-router-dom";
import { api } from "../api/client";

vi.mock("../api/client", () => ({
  api: {
    projects: {
      list: vi.fn(),
      create: vi.fn(),
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
      { id: "p1", title: "Novel One", mode: "fiction", total_word_count: 1234, updated_at: "" },
      { id: "p2", title: "Memoir", mode: "nonfiction", total_word_count: 5678, updated_at: "" },
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
      { id: "p1", title: "Novel One", mode: "fiction", total_word_count: 0, updated_at: "" },
    ]);
    renderHomePage();

    await waitFor(() => {
      expect(screen.getByText("Novel One")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Novel One"));
    expect(mockNavigate).toHaveBeenCalledWith("/projects/p1");
  });

  it("opens dialog and creates project", async () => {
    vi.mocked(api.projects.list).mockResolvedValue([]);
    vi.mocked(api.projects.create).mockResolvedValue({
      id: "new-proj",
      title: "My Book",
      mode: "fiction",
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
    const form = input.closest("form")!;
    const submitButton = form.querySelector("button[type='submit']")!;
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(api.projects.create).toHaveBeenCalledWith({ title: "My Book", mode: "fiction" });
    });
    expect(mockNavigate).toHaveBeenCalledWith("/projects/new-proj");
  });

  it("displays the app name in the header", async () => {
    vi.mocked(api.projects.list).mockResolvedValue([]);
    renderHomePage();

    expect(screen.getByText("Smudge")).toBeInTheDocument();
  });

  it("has accessible main landmark", async () => {
    vi.mocked(api.projects.list).mockResolvedValue([]);
    renderHomePage();

    expect(screen.getByRole("main")).toHaveAttribute("aria-label", "Main content");
  });
});
