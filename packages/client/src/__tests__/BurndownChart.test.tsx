import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BurndownChart } from "../components/BurndownChart";

const sampleData = {
  snapshots: [
    { date: "2026-03-31", total_word_count: 40000 },
    { date: "2026-04-01", total_word_count: 41200 },
  ],
  targetWordCount: 80000,
  targetDeadline: "2026-09-01",
  startDate: "2026-03-01",
};

describe("BurndownChart", () => {
  it("renders chart container with aria-label", () => {
    render(<BurndownChart {...sampleData} />);
    const elements = screen.getAllByLabelText(/burndown/i);
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  it("renders hidden data table for screen readers", () => {
    render(<BurndownChart {...sampleData} />);
    const tables = screen.getAllByRole("table", { name: /burndown/i });
    expect(tables.length).toBeGreaterThanOrEqual(1);
    const table = tables[0]!;
    expect(table.closest(".sr-only")).toBeTruthy();
  });

  it("does not render when target_word_count is null", () => {
    const { container } = render(<BurndownChart {...sampleData} targetWordCount={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("does not render when target_deadline is null", () => {
    const { container } = render(<BurndownChart {...sampleData} targetDeadline={null} />);
    expect(container.innerHTML).toBe("");
  });
});
