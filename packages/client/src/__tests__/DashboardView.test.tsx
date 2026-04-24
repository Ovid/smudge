import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DashboardView } from "../components/DashboardView";
import { api } from "../api/client";
import type { ChapterStatusRow } from "@smudge/shared";

vi.mock("../api/client", () => ({
  // Needed by errors/apiErrorMapper — `err instanceof ApiRequestError`
  // checks reach through this mock. Without the class export, the unified
  // mapper throws during tests that trigger the catch path.
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
      dashboard: vi.fn(),
      velocity: vi.fn().mockResolvedValue({
        words_today: 250,
        daily_average_7d: 400,
        daily_average_30d: 350,
        current_total: 12000,
        target_word_count: 80000,
        remaining_words: 68000,
        target_deadline: "2026-12-31",
        days_until_deadline: 265,
        required_pace: 257,
        projected_completion_date: "2027-02-15",
        today: "2026-04-12",
      }),
    },
  },
}));

afterEach(() => {
  cleanup();
});

const statuses: ChapterStatusRow[] = [
  { status: "outline", sort_order: 0, label: "Outline" },
  { status: "rough_draft", sort_order: 1, label: "Rough Draft" },
  { status: "revised", sort_order: 2, label: "Revised" },
  { status: "edited", sort_order: 3, label: "Edited" },
  { status: "final", sort_order: 4, label: "Final" },
];

const dashboardData = {
  chapters: [
    {
      id: "ch-1",
      title: "Chapter One",
      status: "outline",
      status_label: "Outline",
      word_count: 500,
      updated_at: "2026-03-28T10:00:00Z",
      sort_order: 0,
    },
    {
      id: "ch-2",
      title: "Chapter Two",
      status: "rough_draft",
      status_label: "Rough Draft",
      word_count: 1200,
      updated_at: "2026-03-29T10:00:00Z",
      sort_order: 1,
    },
  ],
  status_summary: {
    outline: 1,
    rough_draft: 1,
    revised: 0,
    edited: 0,
    final: 0,
  },
  totals: {
    word_count: 1700,
    chapter_count: 2,
    most_recent_edit: "2026-03-29T10:00:00Z",
    least_recent_edit: "2026-03-28T10:00:00Z",
  },
};

const emptyDashboardData = {
  chapters: [],
  status_summary: {
    outline: 0,
    rough_draft: 0,
    revised: 0,
    edited: 0,
    final: 0,
  },
  totals: {
    word_count: 0,
    chapter_count: 0,
    most_recent_edit: null,
    least_recent_edit: null,
  },
};

describe("DashboardView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply default velocity mock after clearAllMocks
    vi.mocked(api.projects.velocity).mockResolvedValue({
      words_today: 250,
      daily_average_7d: 400,
      daily_average_30d: 350,
      current_total: 12000,
      target_word_count: 80000,
      remaining_words: 68000,
      target_deadline: "2026-12-31",
      days_until_deadline: 265,
      required_pace: 257,
      projected_completion_date: "2027-02-15",
      today: "2026-04-12",
    });
  });

  it("renders ProgressStrip at top of layout", async () => {
    vi.mocked(api.projects.dashboard).mockResolvedValue(dashboardData);

    render(
      <DashboardView
        slug="test-project"
        statuses={statuses}
        onNavigateToChapter={vi.fn()}
        refreshKey={0}
      />,
    );

    // ProgressStrip renders with velocity data — look for its aria-label
    await waitFor(() => {
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
    });

    // Verify velocity API was called
    expect(api.projects.velocity).toHaveBeenCalledWith("test-project");
  });

  it("renders health bar with word count and chapter count", async () => {
    vi.mocked(api.projects.dashboard).mockResolvedValue(dashboardData);

    render(
      <DashboardView
        slug="test-project"
        statuses={statuses}
        onNavigateToChapter={vi.fn()}
        refreshKey={0}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("1,700 words")).toBeInTheDocument();
    });

    expect(screen.getByText("2 chapters")).toBeInTheDocument();
    expect(screen.getByText(/Most recent:/)).toBeInTheDocument();
    expect(screen.getByText(/Least recent:/)).toBeInTheDocument();
  });

  it("renders chapter table with titles and statuses", async () => {
    vi.mocked(api.projects.dashboard).mockResolvedValue(dashboardData);

    render(
      <DashboardView
        slug="test-project"
        statuses={statuses}
        onNavigateToChapter={vi.fn()}
        refreshKey={0}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Chapter One")).toBeInTheDocument();
    });

    expect(screen.getByText("Chapter Two")).toBeInTheDocument();
    expect(screen.getByText("Outline")).toBeInTheDocument();
    expect(screen.getByText("Rough Draft")).toBeInTheDocument();
  });

  it("navigates to chapter on title click", async () => {
    vi.mocked(api.projects.dashboard).mockResolvedValue(dashboardData);

    const onNav = vi.fn();
    render(
      <DashboardView
        slug="test-project"
        statuses={statuses}
        onNavigateToChapter={onNav}
        refreshKey={0}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Chapter One")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Chapter One"));
    expect(onNav).toHaveBeenCalledWith("ch-1");
  });

  it("renders status summary text", async () => {
    vi.mocked(api.projects.dashboard).mockResolvedValue(dashboardData);

    render(
      <DashboardView
        slug="test-project"
        statuses={statuses}
        onNavigateToChapter={vi.fn()}
        refreshKey={0}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Outline: 1/)).toBeInTheDocument();
    });

    expect(screen.getByText(/Rough Draft: 1/)).toBeInTheDocument();
  });

  it("renders empty state", async () => {
    vi.mocked(api.projects.dashboard).mockResolvedValue(emptyDashboardData);

    render(
      <DashboardView
        slug="test-project"
        statuses={statuses}
        onNavigateToChapter={vi.fn()}
        refreshKey={0}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("No chapters yet")).toBeInTheDocument();
    });

    expect(screen.getByText("0 words")).toBeInTheDocument();
    expect(screen.getByText("0 chapters")).toBeInTheDocument();
  });

  it("sorts chapters by title when clicking Title header", async () => {
    vi.mocked(api.projects.dashboard).mockResolvedValue(dashboardData);

    render(
      <DashboardView
        slug="test-project"
        statuses={statuses}
        onNavigateToChapter={vi.fn()}
        refreshKey={0}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Chapter One")).toBeInTheDocument();
    });

    // Default sort is by sort_order: Chapter One (0), Chapter Two (1)
    const rows = screen.getAllByRole("row");
    // rows[0] is header, rows[1] and rows[2] are data
    expect(rows[1]).toHaveTextContent("Chapter One");
    expect(rows[2]).toHaveTextContent("Chapter Two");

    // Click Title header to sort by title ascending
    await userEvent.click(screen.getByRole("button", { name: /Title/ }));

    const sortedRows = screen.getAllByRole("row");
    expect(sortedRows[1]).toHaveTextContent("Chapter One");
    expect(sortedRows[2]).toHaveTextContent("Chapter Two");
  });

  it("toggles sort direction on second click", async () => {
    vi.mocked(api.projects.dashboard).mockResolvedValue(dashboardData);

    render(
      <DashboardView
        slug="test-project"
        statuses={statuses}
        onNavigateToChapter={vi.fn()}
        refreshKey={0}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Chapter One")).toBeInTheDocument();
    });

    const titleButton = screen.getByRole("button", { name: /Title/ });

    // First click: ascending by title
    await userEvent.click(titleButton);
    // Second click: descending by title
    await userEvent.click(titleButton);

    const rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Chapter Two");
    expect(rows[2]).toHaveTextContent("Chapter One");
  });

  it("shows loading state before data arrives", async () => {
    // Never resolve the promise — component stays in loading state
    vi.mocked(api.projects.dashboard).mockReturnValue(new Promise(() => {}));

    render(
      <DashboardView
        slug="test-project"
        statuses={statuses}
        onNavigateToChapter={vi.fn()}
        refreshKey={0}
      />,
    );

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows error state when API call fails with Error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.projects.dashboard).mockRejectedValue(new Error("Network failure"));

    render(
      <DashboardView
        slug="test-project"
        statuses={statuses}
        onNavigateToChapter={vi.fn()}
        refreshKey={0}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Failed to load dashboard")).toBeInTheDocument();
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load dashboard:"),
      expect.any(Error),
    );
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("shows fallback error message when API rejects with non-Error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.projects.dashboard).mockRejectedValue("some string error");

    render(
      <DashboardView
        slug="test-project"
        statuses={statuses}
        onNavigateToChapter={vi.fn()}
        refreshKey={0}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Failed to load dashboard")).toBeInTheDocument();
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load dashboard:"),
      expect.anything(),
    );
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("sorts by word count", async () => {
    vi.mocked(api.projects.dashboard).mockResolvedValue(dashboardData);

    render(
      <DashboardView
        slug="test-project"
        statuses={statuses}
        onNavigateToChapter={vi.fn()}
        refreshKey={0}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Chapter One")).toBeInTheDocument();
    });

    // Click Word Count header to sort by word_count ascending
    await userEvent.click(screen.getByRole("button", { name: /Word Count/ }));

    const rows = screen.getAllByRole("row");
    // ch-1 has 500 words, ch-2 has 1200 — ascending means ch-1 first
    expect(rows[1]).toHaveTextContent("Chapter One");
    expect(rows[2]).toHaveTextContent("Chapter Two");

    // Click again for descending
    await userEvent.click(screen.getByRole("button", { name: /Word Count/ }));

    const rows2 = screen.getAllByRole("row");
    expect(rows2[1]).toHaveTextContent("Chapter Two");
    expect(rows2[2]).toHaveTextContent("Chapter One");
  });

  it("sorts by last edited date", async () => {
    vi.mocked(api.projects.dashboard).mockResolvedValue(dashboardData);

    render(
      <DashboardView
        slug="test-project"
        statuses={statuses}
        onNavigateToChapter={vi.fn()}
        refreshKey={0}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Chapter One")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /Last Edited/ }));

    const rows = screen.getAllByRole("row");
    // ch-1 updated 2026-03-28, ch-2 updated 2026-03-29 — ascending means ch-1 first
    expect(rows[1]).toHaveTextContent("Chapter One");
    expect(rows[2]).toHaveTextContent("Chapter Two");
  });

  it("shows loading when slug changes before new data arrives", async () => {
    vi.mocked(api.projects.dashboard).mockResolvedValue(dashboardData);

    const { rerender } = render(
      <DashboardView
        slug="test-project"
        statuses={statuses}
        onNavigateToChapter={vi.fn()}
        refreshKey={0}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Chapter One")).toBeInTheDocument();
    });

    // Change slug but make the new call hang
    vi.mocked(api.projects.dashboard).mockReturnValue(new Promise(() => {}));
    rerender(
      <DashboardView
        slug="different-project"
        statuses={statuses}
        onNavigateToChapter={vi.fn()}
        refreshKey={0}
      />,
    );

    // Data from old slug is stale, so loading should show
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows velocity error state when velocity fetch fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.projects.dashboard).mockResolvedValue(dashboardData);
    vi.mocked(api.projects.velocity).mockRejectedValue(new Error("Network failure"));

    render(
      <DashboardView
        slug="test-project"
        statuses={statuses}
        onNavigateToChapter={vi.fn()}
        refreshKey={0}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Chapter One")).toBeInTheDocument();
    });

    // Error state shows a distinct error message (not the empty-state copy)
    expect(screen.getByText(/unable to load/i)).toBeInTheDocument();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load velocity:"),
      expect.any(Error),
    );
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("stays silent when velocity fetch is aborted (no error banner)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.projects.dashboard).mockResolvedValue(dashboardData);
    const { ApiRequestError } = await import("../api/client");
    vi.mocked(api.projects.velocity).mockRejectedValue(
      new ApiRequestError("aborted", 0, "ABORTED"),
    );

    render(
      <DashboardView
        slug="test-project"
        statuses={statuses}
        onNavigateToChapter={vi.fn()}
        refreshKey={0}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Chapter One")).toBeInTheDocument();
    });

    // No error banner — ABORTED from mapApiError returns message: null
    expect(screen.queryByText(/unable to load/i)).not.toBeInTheDocument();
    warnSpy.mockRestore();
  });

  it("falls back to status_summary keys when statuses prop is empty", async () => {
    vi.mocked(api.projects.dashboard).mockResolvedValue(dashboardData);

    render(
      <DashboardView
        slug="test-project"
        statuses={[]}
        onNavigateToChapter={vi.fn()}
        refreshKey={0}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Chapter One")).toBeInTheDocument();
    });

    // With empty statuses, the component derives labels from status_summary keys
    // "outline" becomes "Outline", "rough_draft" becomes "Rough Draft"
    expect(screen.getByText(/Outline: 1/)).toBeInTheDocument();
    expect(screen.getByText(/Rough Draft: 1/)).toBeInTheDocument();
  });

  it("sorts by status using workflow order", async () => {
    // Create data with chapters in different statuses
    const statusSortData = {
      ...dashboardData,
      chapters: [
        {
          id: "ch-1",
          title: "Chapter One",
          status: "revised",
          status_label: "Revised",
          word_count: 500,
          updated_at: "2026-03-28T10:00:00Z",
          sort_order: 0,
        },
        {
          id: "ch-2",
          title: "Chapter Two",
          status: "outline",
          status_label: "Outline",
          word_count: 1200,
          updated_at: "2026-03-29T10:00:00Z",
          sort_order: 1,
        },
      ],
    };
    vi.mocked(api.projects.dashboard).mockResolvedValue(statusSortData);

    render(
      <DashboardView
        slug="test-project"
        statuses={statuses}
        onNavigateToChapter={vi.fn()}
        refreshKey={0}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Chapter One")).toBeInTheDocument();
    });

    // Click Status header to sort by status
    await userEvent.click(screen.getByRole("button", { name: /Status/ }));

    const rows = screen.getAllByRole("row");
    // outline (sort_order 0) should come before revised (sort_order 2)
    expect(rows[1]).toHaveTextContent("Chapter Two"); // outline
    expect(rows[2]).toHaveTextContent("Chapter One"); // revised
  });
});
