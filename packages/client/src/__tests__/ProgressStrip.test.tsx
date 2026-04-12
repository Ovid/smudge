import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ProgressStrip } from "../components/ProgressStrip";
import type { VelocityResponse } from "@smudge/shared";

function makeVelocity(overrides: Partial<VelocityResponse> = {}): VelocityResponse {
  return {
    words_today: 0,
    daily_average_7d: null,
    daily_average_30d: null,
    current_total: 0,
    target_word_count: null,
    remaining_words: null,
    target_deadline: null,
    days_until_deadline: null,
    required_pace: null,
    projected_completion_date: null,
    today: "2026-04-12",
    ...overrides,
  };
}

describe("ProgressStrip", () => {
  afterEach(() => cleanup());

  it("shows empty state when no data", () => {
    render(<ProgressStrip data={null} loading={false} />);
    expect(screen.getByText(/start writing/i)).toBeInTheDocument();
  });

  it("shows loading state", () => {
    render(<ProgressStrip data={null} loading={true} />);
    expect(screen.queryByText(/start writing/i)).not.toBeInTheDocument();
  });

  it("shows word count when no target set", () => {
    render(<ProgressStrip data={makeVelocity({ current_total: 12500 })} loading={false} />);
    expect(screen.getByText(/12,500 words/)).toBeInTheDocument();
  });

  it("shows progress bar when target is set", () => {
    render(
      <ProgressStrip
        data={makeVelocity({
          current_total: 40000,
          target_word_count: 80000,
          remaining_words: 40000,
        })}
        loading={false}
      />,
    );
    const progressBar = screen.getByRole("progressbar");
    expect(progressBar).toHaveAttribute("aria-valuenow", "40000");
    expect(progressBar).toHaveAttribute("aria-valuemax", "80000");
    expect(screen.getByText(/40,000 \/ 80,000 words/)).toBeInTheDocument();
  });

  it("does not show progress bar when no target", () => {
    render(<ProgressStrip data={makeVelocity({ current_total: 5000 })} loading={false} />);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows days remaining when deadline is set", () => {
    render(
      <ProgressStrip
        data={makeVelocity({
          current_total: 40000,
          target_word_count: 80000,
          remaining_words: 40000,
          target_deadline: "2026-06-01",
          days_until_deadline: 50,
          required_pace: 800,
          daily_average_30d: 650,
        })}
        loading={false}
      />,
    );
    expect(screen.getByText(/50 days left/)).toBeInTheDocument();
    expect(screen.getByText(/Needed pace: 800\/day/)).toBeInTheDocument();
    expect(screen.getByText(/Recent pace: 650\/day/)).toBeInTheDocument();
  });

  it("shows daily average without deadline", () => {
    render(
      <ProgressStrip
        data={makeVelocity({
          current_total: 40000,
          target_word_count: 80000,
          remaining_words: 40000,
          daily_average_30d: 650,
        })}
        loading={false}
      />,
    );
    expect(screen.getByText(/Recent pace: 650\/day/)).toBeInTheDocument();
    expect(screen.queryByText(/days left/)).not.toBeInTheDocument();
  });

  it("has accessible progress bar with text label", () => {
    render(
      <ProgressStrip
        data={makeVelocity({
          current_total: 40000,
          target_word_count: 80000,
          remaining_words: 40000,
        })}
        loading={false}
      />,
    );
    const progressBar = screen.getByRole("progressbar");
    expect(progressBar).toHaveAttribute("aria-valuemin", "0");
    expect(progressBar).toHaveAttribute("aria-valuenow", "40000");
    expect(progressBar).toHaveAttribute("aria-valuemax", "80000");
  });

  it("clamps aria-valuenow when current_total exceeds target", () => {
    render(
      <ProgressStrip
        data={makeVelocity({
          current_total: 95000,
          target_word_count: 80000,
          remaining_words: 0,
        })}
        loading={false}
      />,
    );
    const progressBar = screen.getByRole("progressbar");
    // aria-valuenow must not exceed aria-valuemax per ARIA spec
    expect(progressBar).toHaveAttribute("aria-valuenow", "80000");
    expect(progressBar).toHaveAttribute("aria-valuemax", "80000");
  });

  it("respects prefers-reduced-motion on progress bar", () => {
    render(
      <ProgressStrip
        data={makeVelocity({
          current_total: 40000,
          target_word_count: 80000,
          remaining_words: 40000,
        })}
        loading={false}
      />,
    );
    const progressBar = screen.getByRole("progressbar");
    const fill = progressBar.firstElementChild as HTMLElement;
    expect(fill.className).toContain("motion-reduce:transition-none");
  });
});
