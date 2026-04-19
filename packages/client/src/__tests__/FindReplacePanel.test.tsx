import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FindReplacePanel } from "../components/FindReplacePanel";
import { STRINGS } from "../strings";
import type { SearchResult } from "@smudge/shared";

const S = STRINGS.findReplace;

function makeResults(overrides: Partial<SearchResult> = {}): SearchResult {
  // Contexts here mirror what `extractContext` produces: a slice of the
  // block's flat text. The match offset is the match's position within
  // that flat text, which — for short contexts that start at the
  // beginning of the block — equals its index within `context`.
  const context1 = "the dark forest was quiet";
  const context2 = "into the dark night";
  const context3 = "a dark cloud loomed";
  return {
    total_count: 3,
    chapters: [
      {
        chapter_id: "ch-1",
        chapter_title: "Chapter 1: The Beginning",
        matches: [
          {
            index: 0,
            context: context1,
            blockIndex: 0,
            offset: context1.indexOf("dark"),
            length: 4,
          },
          {
            index: 1,
            context: context2,
            blockIndex: 1,
            offset: context2.indexOf("dark"),
            length: 4,
          },
        ],
      },
      {
        chapter_id: "ch-2",
        chapter_title: "Chapter 2: The Journey",
        matches: [
          {
            index: 0,
            context: context3,
            blockIndex: 0,
            offset: context3.indexOf("dark"),
            length: 4,
          },
        ],
      },
    ],
    ...overrides,
  };
}

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  results: null as SearchResult | null,
  loading: false,
  error: null as string | null,
  query: "",
  onQueryChange: vi.fn(),
  replacement: "",
  onReplacementChange: vi.fn(),
  options: { case_sensitive: false, whole_word: false, regex: false },
  onToggleOption: vi.fn(),
  onReplaceOne: vi.fn(),
  onReplaceAllInChapter: vi.fn(),
  onReplaceAllInManuscript: vi.fn(),
};

describe("FindReplacePanel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("rendering", () => {
    it("renders search and replace inputs with labels", () => {
      render(<FindReplacePanel {...defaultProps} />);

      expect(screen.getByLabelText("Find")).toBeInTheDocument();
      expect(screen.getByLabelText("Replace")).toBeInTheDocument();
      expect(screen.getByPlaceholderText(S.searchPlaceholder)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(S.replacePlaceholder)).toBeInTheDocument();
    });

    it("renders as aside with correct aria label", () => {
      render(<FindReplacePanel {...defaultProps} />);
      expect(screen.getByRole("complementary", { name: S.ariaLabel })).toBeInTheDocument();
    });

    it("does not render when isOpen is false", () => {
      render(<FindReplacePanel {...defaultProps} isOpen={false} />);
      expect(screen.queryByRole("complementary", { name: S.ariaLabel })).not.toBeInTheDocument();
    });

    it("renders panel title and close button", () => {
      render(<FindReplacePanel {...defaultProps} />);
      expect(screen.getByText(S.panelTitle)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    });
  });

  describe("option toggles", () => {
    it("shows aria-pressed state and toggles on click", async () => {
      const user = userEvent.setup();
      const onToggleOption = vi.fn();
      render(
        <FindReplacePanel
          {...defaultProps}
          options={{ case_sensitive: true, whole_word: false, regex: false }}
          onToggleOption={onToggleOption}
        />,
      );

      const caseBtn = screen.getByRole("button", { name: S.matchCase });
      const wordBtn = screen.getByRole("button", { name: S.wholeWord });
      const regexBtn = screen.getByRole("button", { name: S.regex });

      expect(caseBtn).toHaveAttribute("aria-pressed", "true");
      expect(wordBtn).toHaveAttribute("aria-pressed", "false");
      expect(regexBtn).toHaveAttribute("aria-pressed", "false");

      await user.click(wordBtn);
      expect(onToggleOption).toHaveBeenCalledWith("whole_word");

      await user.click(regexBtn);
      expect(onToggleOption).toHaveBeenCalledWith("regex");

      await user.click(caseBtn);
      expect(onToggleOption).toHaveBeenCalledWith("case_sensitive");
    });
  });

  describe("results display", () => {
    it("displays results grouped by chapter with match counts", () => {
      const results = makeResults();
      render(<FindReplacePanel {...defaultProps} query="dark" results={results} />);

      expect(screen.getByText(S.chapterMatches("Chapter 1: The Beginning", 2))).toBeInTheDocument();
      expect(screen.getByText(S.chapterMatches("Chapter 2: The Journey", 1))).toBeInTheDocument();
    });

    it("shows match count summary", () => {
      const results = makeResults();
      render(<FindReplacePanel {...defaultProps} query="dark" results={results} />);

      expect(screen.getByText(S.matchCount(3, 2))).toBeInTheDocument();
    });

    it("highlights match text in context", () => {
      const results = makeResults();
      render(<FindReplacePanel {...defaultProps} query="dark" results={results} />);

      const marks = document.querySelectorAll("mark");
      expect(marks.length).toBeGreaterThan(0);
      expect(marks[0]!.textContent).toBe("dark");
    });

    it("shows 'No matches found' when results have 0 total_count", () => {
      const results: SearchResult = { total_count: 0, chapters: [] };
      render(<FindReplacePanel {...defaultProps} query="missing" results={results} />);

      expect(screen.getByText(S.noMatches)).toBeInTheDocument();
    });

    it("shows error message for invalid regex", () => {
      render(<FindReplacePanel {...defaultProps} query="[invalid" error={S.invalidRegex} />);

      expect(screen.getByText(S.invalidRegex)).toBeInTheDocument();
    });
  });

  describe("replace actions", () => {
    it("'Replace' button calls onReplaceOne with correct args", async () => {
      const user = userEvent.setup();
      const onReplaceOne = vi.fn();
      const results = makeResults();

      render(
        <FindReplacePanel
          {...defaultProps}
          query="dark"
          replacement="light"
          results={results}
          onReplaceOne={onReplaceOne}
        />,
      );

      const replaceButtons = screen.getAllByRole("button", { name: S.replaceOne });
      // Click the first Replace button (ch-1, match index 0)
      await user.click(replaceButtons[0]!);
      expect(onReplaceOne).toHaveBeenCalledWith("ch-1", 0);

      // Click the second Replace button (ch-1, match index 1)
      await user.click(replaceButtons[1]!);
      expect(onReplaceOne).toHaveBeenCalledWith("ch-1", 1);

      // Click the third Replace button (ch-2, match index 0)
      await user.click(replaceButtons[2]!);
      expect(onReplaceOne).toHaveBeenCalledWith("ch-2", 0);
    });

    it("per-match 'Replace' button stays enabled with empty replacement (delete mode)", async () => {
      const user = userEvent.setup();
      const onReplaceOne = vi.fn();
      const results = makeResults();
      render(
        <FindReplacePanel
          {...defaultProps}
          query="dark"
          replacement=""
          results={results}
          onReplaceOne={onReplaceOne}
        />,
      );
      // Empty replacement is a valid "delete this match" — clicking must
      // still fire the callback so the user can delete individual matches.
      const replaceButtons = screen.getAllByRole("button", { name: S.replaceOne });
      for (const btn of replaceButtons) {
        expect(btn).not.toBeDisabled();
      }
      await user.click(replaceButtons[0]!);
      expect(onReplaceOne).toHaveBeenCalledWith("ch-1", 0);
    });

    it("'Replace All in Chapter' button calls onReplaceAllInChapter", async () => {
      const user = userEvent.setup();
      const onReplaceAllInChapter = vi.fn();
      const results = makeResults();

      render(
        <FindReplacePanel
          {...defaultProps}
          query="dark"
          replacement="light"
          results={results}
          onReplaceAllInChapter={onReplaceAllInChapter}
        />,
      );

      const chapterReplaceButtons = screen.getAllByRole("button", {
        name: S.replaceAllInChapter,
      });
      await user.click(chapterReplaceButtons[0]!);
      expect(onReplaceAllInChapter).toHaveBeenCalledWith("ch-1");

      await user.click(chapterReplaceButtons[1]!);
      expect(onReplaceAllInChapter).toHaveBeenCalledWith("ch-2");
    });

    it("'Replace All in Chapter' stays enabled with empty replacement (delete mode)", async () => {
      const user = userEvent.setup();
      const onReplaceAllInChapter = vi.fn();
      const results = makeResults();
      render(
        <FindReplacePanel
          {...defaultProps}
          query="dark"
          replacement=""
          results={results}
          onReplaceAllInChapter={onReplaceAllInChapter}
        />,
      );
      // Empty replacement is a valid "delete all in chapter" — the downstream
      // confirmation dialog uses explicit delete copy before committing.
      const chapterButtons = screen.getAllByRole("button", { name: S.replaceAllInChapter });
      for (const btn of chapterButtons) {
        expect(btn).not.toBeDisabled();
      }
      await user.click(chapterButtons[0]!);
      expect(onReplaceAllInChapter).toHaveBeenCalledWith("ch-1");
    });

    it("'Replace All in Manuscript' button calls onReplaceAllInManuscript", async () => {
      const user = userEvent.setup();
      const onReplaceAllInManuscript = vi.fn();
      const results = makeResults();

      render(
        <FindReplacePanel
          {...defaultProps}
          query="dark"
          replacement="light"
          results={results}
          onReplaceAllInManuscript={onReplaceAllInManuscript}
        />,
      );

      const manuscriptButton = screen.getByRole("button", {
        name: S.replaceAllInManuscript,
      });
      expect(manuscriptButton).not.toBeDisabled();
      await user.click(manuscriptButton);
      expect(onReplaceAllInManuscript).toHaveBeenCalled();
    });

    it("'Replace All in Manuscript' switches to delete-mode label and stays enabled with empty replacement", async () => {
      const user = userEvent.setup();
      const onReplaceAllInManuscript = vi.fn();
      const results = makeResults();
      render(
        <FindReplacePanel
          {...defaultProps}
          query="dark"
          replacement=""
          results={results}
          onReplaceAllInManuscript={onReplaceAllInManuscript}
        />,
      );
      // The button copy flips to "Delete All in Manuscript" so the user
      // sees the destructive intent on the button itself. The downstream
      // confirmation dialog uses delete copy as well.
      const deleteButton = screen.getByRole("button", {
        name: S.replaceAllInManuscriptDelete,
      });
      expect(deleteButton).not.toBeDisabled();
      await user.click(deleteButton);
      expect(onReplaceAllInManuscript).toHaveBeenCalled();
    });
  });

  describe("keyboard interaction", () => {
    it("Escape key calls onClose", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<FindReplacePanel {...defaultProps} onClose={onClose} />);

      await user.keyboard("{Escape}");
      expect(onClose).toHaveBeenCalled();
    });

    it("close button calls onClose", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<FindReplacePanel {...defaultProps} onClose={onClose} />);

      await user.click(screen.getByRole("button", { name: "Close" }));
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe("focus management", () => {
    it("focuses search input on open", async () => {
      vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
        cb(0);
        return 0;
      });

      const { rerender } = render(<FindReplacePanel {...defaultProps} isOpen={false} />);
      rerender(<FindReplacePanel {...defaultProps} isOpen={true} />);

      expect(screen.getByPlaceholderText(S.searchPlaceholder)).toHaveFocus();
    });

    it("returns focus to triggerRef when the user closes via Escape", async () => {
      vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
        cb(0);
        return 0;
      });

      const triggerButton = document.createElement("button");
      document.body.appendChild(triggerButton);
      const triggerRef = { current: triggerButton };
      const focusSpy = vi.spyOn(triggerButton, "focus");
      const onClose = vi.fn();
      const user = userEvent.setup();

      const { rerender } = render(
        <FindReplacePanel
          {...defaultProps}
          isOpen={true}
          onClose={onClose}
          triggerRef={triggerRef}
        />,
      );
      await user.keyboard("{Escape}");
      // Simulate the parent reacting to onClose() by dropping isOpen.
      rerender(
        <FindReplacePanel
          {...defaultProps}
          isOpen={false}
          onClose={onClose}
          triggerRef={triggerRef}
        />,
      );

      expect(focusSpy).toHaveBeenCalled();
      document.body.removeChild(triggerButton);
    });

    it("does NOT return focus on panel-exclusivity close (parent-driven isOpen drop)", () => {
      vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
        cb(0);
        return 0;
      });

      const triggerButton = document.createElement("button");
      document.body.appendChild(triggerButton);
      const triggerRef = { current: triggerButton };
      const focusSpy = vi.spyOn(triggerButton, "focus");

      const { rerender } = render(
        <FindReplacePanel {...defaultProps} isOpen={true} triggerRef={triggerRef} />,
      );
      // Parent closes us because another panel opened — no Escape, no
      // Close-button click. The soon-to-open sibling should own focus,
      // so we must NOT refocus the trigger here.
      rerender(<FindReplacePanel {...defaultProps} isOpen={false} triggerRef={triggerRef} />);

      expect(focusSpy).not.toHaveBeenCalled();
      document.body.removeChild(triggerButton);
    });
  });
});
