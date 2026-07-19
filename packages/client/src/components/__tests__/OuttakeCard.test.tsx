import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OuttakeCard } from "../OuttakeCard";
import { api } from "../../api/client";
import { STRINGS } from "../../strings";
import { expectConsole } from "../../__tests__/expectConsole";
import type { OuttakeRow } from "@smudge/shared";

vi.mock("../../api/client", () => ({
  api: {
    outtakes: {
      updateLabel: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

const S = STRINGS.outtakes;

function makeOuttake(overrides: Partial<OuttakeRow> = {}): OuttakeRow {
  return {
    id: "ot-1",
    project_id: "proj-1",
    label: "A cut scene",
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }],
    },
    created_at: "2026-07-01T12:00:00.000Z",
    updated_at: "2026-07-01T12:00:00.000Z",
    ...overrides,
  };
}

const defaultProps = {
  onInsert: vi.fn(),
  onDeleted: vi.fn(),
  onUpdated: vi.fn(),
  onError: vi.fn(),
};

beforeEach(() => {
  vi.mocked(api.outtakes.delete).mockResolvedValue(undefined);
  vi.mocked(api.outtakes.updateLabel).mockResolvedValue(makeOuttake());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OuttakeCard", () => {
  it("renders the label and word count", () => {
    render(<OuttakeCard outtake={makeOuttake()} {...defaultProps} />);
    expect(screen.getByDisplayValue("A cut scene")).toBeInTheDocument();
    expect(screen.getByText(S.wordCount(2))).toBeInTheDocument();
  });

  it("shows the untitled placeholder when the label is null", () => {
    render(<OuttakeCard outtake={makeOuttake({ label: null })} {...defaultProps} />);
    expect(screen.getByPlaceholderText(S.untitled)).toBeInTheDocument();
  });

  it("renders the plain-text preview", () => {
    render(<OuttakeCard outtake={makeOuttake()} {...defaultProps} />);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("calls onInsert with the outtake when Insert is clicked", async () => {
    const user = userEvent.setup();
    const onInsert = vi.fn();
    const outtake = makeOuttake();
    render(<OuttakeCard outtake={outtake} {...defaultProps} onInsert={onInsert} />);
    await user.click(screen.getByRole("button", { name: S.insert }));
    expect(onInsert).toHaveBeenCalledWith(outtake);
  });

  it("copies the plain text to the clipboard when Copy is clicked", async () => {
    const user = userEvent.setup();
    // userEvent.setup() installs its own clipboard stub, so override it after.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<OuttakeCard outtake={makeOuttake()} {...defaultProps} />);
    await user.click(screen.getByRole("button", { name: S.copy }));
    expect(writeText).toHaveBeenCalledWith("Hello world");
  });

  it("swallows a clipboard write failure without throwing or logging", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<OuttakeCard outtake={makeOuttake()} {...defaultProps} />);
    await user.click(screen.getByRole("button", { name: S.copy }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    // The catch is a deliberate silent swallow — no banner, no console noise.
    expectConsole("warn").silent();
    expectConsole("error").silent();
  });

  it("opens a confirm dialog and deletes via the API, then reconciles on confirm", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    render(<OuttakeCard outtake={makeOuttake()} {...defaultProps} onDeleted={onDeleted} />);
    await user.click(screen.getByRole("button", { name: S.delete }));
    // Dialog is shown
    expect(screen.getByText(S.confirmDeleteTitle)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: STRINGS.delete.confirmButton }));
    expect(api.outtakes.delete).toHaveBeenCalledWith("ot-1", expect.anything());
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("ot-1"));
  });

  it("does not delete when the confirm dialog is cancelled", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    render(<OuttakeCard outtake={makeOuttake()} {...defaultProps} onDeleted={onDeleted} />);
    await user.click(screen.getByRole("button", { name: S.delete }));
    await user.click(screen.getByRole("button", { name: STRINGS.delete.cancelButton }));
    expect(api.outtakes.delete).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.queryByText(S.confirmDeleteTitle)).not.toBeInTheDocument();
  });

  it("commits the label on blur", async () => {
    const user = userEvent.setup();
    render(<OuttakeCard outtake={makeOuttake()} {...defaultProps} />);
    const input = screen.getByDisplayValue("A cut scene");
    await user.clear(input);
    await user.type(input, "New label");
    await user.tab();
    expect(api.outtakes.updateLabel).toHaveBeenCalledWith(
      "ot-1",
      { label: "New label" },
      expect.anything(),
    );
  });

  it("commits the label on Enter", async () => {
    const user = userEvent.setup();
    render(<OuttakeCard outtake={makeOuttake()} {...defaultProps} />);
    const input = screen.getByDisplayValue("A cut scene");
    await user.clear(input);
    await user.type(input, "Renamed{Enter}");
    expect(api.outtakes.updateLabel).toHaveBeenCalledWith(
      "ot-1",
      { label: "Renamed" },
      expect.anything(),
    );
  });

  it("passes null when the label is cleared to empty", async () => {
    const user = userEvent.setup();
    render(<OuttakeCard outtake={makeOuttake()} {...defaultProps} />);
    const input = screen.getByDisplayValue("A cut scene");
    await user.clear(input);
    await user.tab();
    expect(api.outtakes.updateLabel).toHaveBeenCalledWith("ot-1", { label: null }, expect.anything());
  });

  it("does not rename when the label is unchanged", async () => {
    const user = userEvent.setup();
    render(<OuttakeCard outtake={makeOuttake()} {...defaultProps} />);
    const input = screen.getByDisplayValue("A cut scene");
    await user.click(input);
    await user.tab();
    expect(api.outtakes.updateLabel).not.toHaveBeenCalled();
  });

  it("expands a long preview when Show more is clicked", async () => {
    const user = userEvent.setup();
    const long = "word ".repeat(80).trim();
    const outtake = makeOuttake({
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: long }] }],
      },
    });
    render(<OuttakeCard outtake={outtake} {...defaultProps} />);
    const toggle = screen.getByRole("button", { name: S.showMore });
    expect(toggle).toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByRole("button", { name: S.showLess })).toBeInTheDocument();
  });
});
