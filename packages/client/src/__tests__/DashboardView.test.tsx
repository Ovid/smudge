import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DashboardView } from "../components/DashboardView";
import { api } from "../api/client";
import type { ChapterStatusRow } from "@smudge/shared";

vi.mock("../api/client", () => ({
  api: {
    projects: {
      dashboard: vi.fn(),
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
  });

  it("renders health bar with word count and chapter count", async () => {
    vi.mocked(api.projects.dashboard).mockResolvedValue(dashboardData);

    render(<DashboardView slug="test-project" statuses={statuses} onNavigateToChapter={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("1,700 words")).toBeInTheDocument();
    });

    expect(screen.getByText("2 chapters")).toBeInTheDocument();
    expect(screen.getByText(/Most recent:/)).toBeInTheDocument();
    expect(screen.getByText(/Least recent:/)).toBeInTheDocument();
  });

  it("renders chapter table with titles and statuses", async () => {
    vi.mocked(api.projects.dashboard).mockResolvedValue(dashboardData);

    render(<DashboardView slug="test-project" statuses={statuses} onNavigateToChapter={vi.fn()} />);

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
    render(<DashboardView slug="test-project" statuses={statuses} onNavigateToChapter={onNav} />);

    await waitFor(() => {
      expect(screen.getByText("Chapter One")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Chapter One"));
    expect(onNav).toHaveBeenCalledWith("ch-1");
  });

  it("renders status summary text", async () => {
    vi.mocked(api.projects.dashboard).mockResolvedValue(dashboardData);

    render(<DashboardView slug="test-project" statuses={statuses} onNavigateToChapter={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Outline: 1/)).toBeInTheDocument();
    });

    expect(screen.getByText(/Rough Draft: 1/)).toBeInTheDocument();
  });

  it("renders empty state", async () => {
    vi.mocked(api.projects.dashboard).mockResolvedValue(emptyDashboardData);

    render(<DashboardView slug="test-project" statuses={statuses} onNavigateToChapter={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("No chapters yet")).toBeInTheDocument();
    });

    expect(screen.getByText("0 words")).toBeInTheDocument();
    expect(screen.getByText("0 chapters")).toBeInTheDocument();
  });

  it("sorts chapters by title when clicking Title header", async () => {
    vi.mocked(api.projects.dashboard).mockResolvedValue(dashboardData);

    render(<DashboardView slug="test-project" statuses={statuses} onNavigateToChapter={vi.fn()} />);

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

    render(<DashboardView slug="test-project" statuses={statuses} onNavigateToChapter={vi.fn()} />);

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

    render(<DashboardView slug="test-project" statuses={statuses} onNavigateToChapter={vi.fn()} />);

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
