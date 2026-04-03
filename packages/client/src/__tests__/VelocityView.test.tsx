import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { VelocityView } from "../components/VelocityView";
import { api } from "../api/client";

vi.mock("../api/client", () => ({
  api: {
    projects: {
      velocity: vi.fn(),
    },
  },
}));

afterEach(() => {
  cleanup();
});

const mockVelocity = {
  daily_snapshots: [
    { date: "2026-03-31", total_word_count: 40000 },
    { date: "2026-04-01", total_word_count: 41200 },
  ],
  sessions: [
    {
      start: "2026-04-01T14:15:00Z",
      end: "2026-04-01T15:40:00Z",
      duration_minutes: 85,
      chapters_touched: ["ch1", "ch2"],
      net_words: 1200,
    },
  ],
  streak: { current: 12, best: 23 },
  projection: {
    target_word_count: 80000,
    target_deadline: "2026-09-01",
    projected_date: "2026-08-28",
    daily_average_30d: 1200,
  },
  completion: {
    threshold_status: "revised",
    total_chapters: 12,
    completed_chapters: 7,
  },
  today: "2026-04-01",
  current_total: 41200,
  chapter_names: { ch1: "Chapter 1", ch2: "Chapter 2" },
};

describe("VelocityView", () => {
  beforeEach(() => {
    vi.mocked(api.projects.velocity).mockResolvedValue(mockVelocity);
  });

  it("renders summary strip with key metrics", async () => {
    render(<VelocityView slug="test" />);
    await waitFor(() => {
      expect(screen.getByText(/words today/i)).toBeInTheDocument();
      expect(screen.getByText(/12 days/i)).toBeInTheDocument();
    });
  });

  it("renders recent sessions", async () => {
    render(<VelocityView slug="test" />);
    await waitFor(() => {
      expect(screen.getByText(/85 min/)).toBeInTheDocument();
      // "1,200" appears in both the daily avg metric and the session line
      expect(screen.getAllByText(/1,200/).length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows empty state when no data", async () => {
    vi.mocked(api.projects.velocity).mockResolvedValue({
      daily_snapshots: [],
      sessions: [],
      streak: { current: 0, best: 0 },
      projection: {
        target_word_count: null,
        target_deadline: null,
        projected_date: null,
        daily_average_30d: 0,
      },
      completion: { threshold_status: "final", total_chapters: 0, completed_chapters: 0 },
      today: "2026-04-01",
      current_total: 0,
      chapter_names: {},
    });
    render(<VelocityView slug="test" />);
    await waitFor(() => {
      expect(screen.getByText(/start writing/i)).toBeInTheDocument();
    });
  });

  it("renders completion stats", async () => {
    render(<VelocityView slug="test" />);
    await waitFor(() => {
      expect(screen.getByText(/7 of 12/)).toBeInTheDocument();
    });
  });

  it("adaptive: nothing set — shows daily words, streaks, sessions, no projection", async () => {
    vi.mocked(api.projects.velocity).mockResolvedValue({
      ...mockVelocity,
      projection: {
        target_word_count: null,
        target_deadline: null,
        projected_date: null,
        daily_average_30d: 1200,
      },
    });
    render(<VelocityView slug="test" />);
    await waitFor(() => {
      expect(screen.getByText(/words today/i)).toBeInTheDocument();
      expect(screen.getByText(/current streak/i)).toBeInTheDocument();
      expect(screen.queryByText(/projected/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/days remaining/i)).not.toBeInTheDocument();
    });
  });

  it("adaptive: word target only — shows progress + projected date, no countdown", async () => {
    vi.mocked(api.projects.velocity).mockResolvedValue({
      ...mockVelocity,
      projection: {
        target_word_count: 80000,
        target_deadline: null,
        projected_date: "2026-08-28",
        daily_average_30d: 1200,
      },
    });
    render(<VelocityView slug="test" />);
    await waitFor(() => {
      expect(screen.getByText(/80,000/)).toBeInTheDocument();
      expect(screen.getByText(/projected/i)).toBeInTheDocument();
      expect(screen.queryByText(/days remaining/i)).not.toBeInTheDocument();
    });
  });

  it("adaptive: deadline only — shows days remaining, no progress bar", async () => {
    vi.mocked(api.projects.velocity).mockResolvedValue({
      ...mockVelocity,
      projection: {
        target_word_count: null,
        target_deadline: "2026-09-01",
        projected_date: null,
        daily_average_30d: 1200,
      },
    });
    render(<VelocityView slug="test" />);
    await waitFor(() => {
      expect(screen.getByText(/days remaining/i)).toBeInTheDocument();
      expect(screen.queryByText(/projected/i)).not.toBeInTheDocument();
    });
  });

  it("shows error state when API rejects with an Error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(api.projects.velocity).mockRejectedValue(new Error("Network failure"));
    render(<VelocityView slug="test" />);
    await waitFor(() => {
      expect(screen.getByText("Network failure")).toBeInTheDocument();
    });
    spy.mockRestore();
  });

  it("shows error state when API rejects with a non-Error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(api.projects.velocity).mockRejectedValue("string error");
    render(<VelocityView slug="test" />);
    await waitFor(() => {
      expect(screen.getByText(/failed to load velocity data/i)).toBeInTheDocument();
    });
    spy.mockRestore();
  });

  it("shows loading state initially", () => {
    vi.mocked(api.projects.velocity).mockReturnValue(new Promise(() => {})); // never resolves
    render(<VelocityView slug="test" />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders chapter name in recent sessions", async () => {
    vi.mocked(api.projects.velocity).mockResolvedValue({
      ...mockVelocity,
      sessions: [
        {
          start: "2026-04-01T14:15:00Z",
          end: "2026-04-01T15:40:00Z",
          duration_minutes: 45,
          chapters_touched: ["ch1"],
          net_words: 500,
        },
      ],
    });
    render(<VelocityView slug="test" />);
    await waitFor(() => {
      expect(screen.getByText(/Chapter 1/)).toBeInTheDocument();
    });
  });

  it("shows noProjection dash when target set but no projected_date", async () => {
    vi.mocked(api.projects.velocity).mockResolvedValue({
      ...mockVelocity,
      projection: {
        target_word_count: 80000,
        target_deadline: null,
        projected_date: null,
        daily_average_30d: 0,
      },
    });
    render(<VelocityView slug="test" />);
    await waitFor(() => {
      expect(screen.getByText(/projected/i)).toBeInTheDocument();
      // Both noProjection and noAverage render "\u2014", so expect at least 2
      expect(screen.getAllByText("\u2014").length).toBeGreaterThanOrEqual(2);
    });
  });

  it("adaptive: both set — shows burndown chart", async () => {
    render(<VelocityView slug="test" />);
    await waitFor(() => {
      expect(screen.getAllByLabelText(/burndown/i).length).toBeGreaterThanOrEqual(1);
    });
  });
});
