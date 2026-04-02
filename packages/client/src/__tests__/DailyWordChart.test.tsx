import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DailyWordChart } from "../components/DailyWordChart";

const sampleData = [
  { date: "2026-03-31", net_words: 1200 },
  { date: "2026-04-01", net_words: -300 },
];

describe("DailyWordChart", () => {
  it("renders chart container with aria-label", () => {
    render(<DailyWordChart data={sampleData} dailyAverage={450} />);
    const elements = screen.getAllByLabelText(/daily word count/i);
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  it("renders hidden data table for screen readers", () => {
    render(<DailyWordChart data={sampleData} dailyAverage={450} />);
    const tables = screen.getAllByRole("table", { name: /daily word count/i });
    expect(tables.length).toBeGreaterThanOrEqual(1);
    const table = tables[0];
    expect(table.closest(".sr-only")).toBeTruthy();
  });

  it("returns null when data is empty", () => {
    const { container } = render(<DailyWordChart data={[]} dailyAverage={0} />);
    expect(container.innerHTML).toBe("");
  });
});
