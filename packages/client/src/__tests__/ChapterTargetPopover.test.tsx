import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChapterTargetPopover } from "../components/ChapterTargetPopover";
import { api } from "../api/client";

vi.mock("../api/client");

describe("ChapterTargetPopover", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  it("opens popover on word count click", async () => {
    const user = userEvent.setup();
    render(
      <ChapterTargetPopover
        chapterId="ch1"
        currentWordCount={2500}
        targetWordCount={null}
        onUpdate={vi.fn()}
      />
    );
    await user.click(screen.getByText("2,500"));
    expect(screen.getByLabelText(/word count target/i)).toBeInTheDocument();
  });

  it("saves target on input blur", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    vi.mocked(api.chapters.update).mockResolvedValue({} as never);

    render(
      <ChapterTargetPopover
        chapterId="ch1"
        currentWordCount={2500}
        targetWordCount={null}
        onUpdate={onUpdate}
      />
    );
    await user.click(screen.getByText("2,500"));
    const input = screen.getByLabelText(/word count target/i);
    await user.type(input, "5000");
    await user.tab();

    await waitFor(() => {
      expect(api.chapters.update).toHaveBeenCalledWith("ch1", { target_word_count: 5000 });
    });
  });

  it("clears target with clear button", async () => {
    const user = userEvent.setup();
    vi.mocked(api.chapters.update).mockResolvedValue({} as never);

    render(
      <ChapterTargetPopover
        chapterId="ch1"
        currentWordCount={2500}
        targetWordCount={5000}
        onUpdate={vi.fn()}
      />
    );
    await user.click(screen.getByText(/2,500/));
    await user.click(screen.getByRole("button", { name: /clear/i }));

    await waitFor(() => {
      expect(api.chapters.update).toHaveBeenCalledWith("ch1", { target_word_count: null });
    });
  });
});
