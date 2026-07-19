import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OuttakesPanel } from "../OuttakesPanel";
import { api } from "../../api/client";
import { STRINGS } from "../../strings";
import { expectConsole } from "../../__tests__/expectConsole";
import type { OuttakeRow } from "@smudge/shared";

vi.mock("../../api/client", () => {
  class ApiRequestError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  return {
    api: {
      outtakes: {
        list: vi.fn(),
        create: vi.fn(),
        updateLabel: vi.fn(),
        delete: vi.fn(),
      },
    },
    ApiRequestError,
  };
});

const S = STRINGS.outtakes;

function docFromLines(...lines: string[]): Record<string, unknown> {
  return {
    type: "doc",
    content: lines.map((line) => ({
      type: "paragraph",
      content: [{ type: "text", text: line }],
    })),
  };
}

function makeOuttake(overrides: Partial<OuttakeRow> = {}): OuttakeRow {
  return {
    id: "ot-1",
    project_id: "proj-1",
    label: "First outtake",
    content: docFromLines("Hello world"),
    created_at: "2026-07-01T12:00:00.000Z",
    updated_at: "2026-07-01T12:00:00.000Z",
    ...overrides,
  };
}

const defaultProps = {
  projectId: "proj-1",
  onInsert: vi.fn(),
  refreshNonce: 0,
};

beforeEach(() => {
  vi.mocked(api.outtakes.list).mockResolvedValue([]);
  vi.mocked(api.outtakes.delete).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OuttakesPanel", () => {
  it("renders the outtake rows from the list", async () => {
    vi.mocked(api.outtakes.list).mockResolvedValue([
      makeOuttake({ id: "a", label: "Alpha" }),
      makeOuttake({ id: "b", label: "Beta" }),
    ]);
    render(<OuttakesPanel {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByDisplayValue("Alpha")).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("Beta")).toBeInTheDocument();
  });

  it("shows the empty state when there are no outtakes", async () => {
    vi.mocked(api.outtakes.list).mockResolvedValue([]);
    render(<OuttakesPanel {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText(S.empty)).toBeInTheDocument();
    });
  });

  it("filters the list case-insensitively", async () => {
    vi.mocked(api.outtakes.list).mockResolvedValue([
      makeOuttake({ id: "a", label: "Alpha" }),
      makeOuttake({ id: "b", label: "Beta" }),
    ]);
    const user = userEvent.setup();
    render(<OuttakesPanel {...defaultProps} />);
    await waitFor(() => expect(screen.getByDisplayValue("Alpha")).toBeInTheDocument());

    await user.type(screen.getByRole("textbox", { name: S.filterPlaceholder }), "beta");
    expect(screen.queryByDisplayValue("Alpha")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Beta")).toBeInTheDocument();
  });

  it("does not match a filter across a paragraph boundary", async () => {
    vi.mocked(api.outtakes.list).mockResolvedValue([
      makeOuttake({ id: "a", label: "Keep", content: docFromLines("Hello", "World") }),
    ]);
    const user = userEvent.setup();
    render(<OuttakesPanel {...defaultProps} />);
    await waitFor(() => expect(screen.getByDisplayValue("Keep")).toBeInTheDocument());

    // "oW" only appears if "Hello" and "World" are concatenated without a
    // separator. toPlainText newline-separates blocks, so the row must hide.
    await user.type(screen.getByRole("textbox", { name: S.filterPlaceholder }), "oW");
    expect(screen.queryByDisplayValue("Keep")).not.toBeInTheDocument();

    // Sanity: a within-block substring still matches.
    await user.clear(screen.getByRole("textbox", { name: S.filterPlaceholder }));
    await user.type(screen.getByRole("textbox", { name: S.filterPlaceholder }), "hello");
    expect(screen.getByDisplayValue("Keep")).toBeInTheDocument();
  });

  it("creates an outtake from the textarea, POSTing a valid doc, and prepends it", async () => {
    vi.mocked(api.outtakes.list).mockResolvedValue([makeOuttake({ id: "old", label: "Old" })]);
    const created = makeOuttake({ id: "new", label: null, content: docFromLines("Fresh text") });
    vi.mocked(api.outtakes.create).mockResolvedValue(created);
    const user = userEvent.setup();
    render(<OuttakesPanel {...defaultProps} />);
    await waitFor(() => expect(screen.getByDisplayValue("Old")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: S.newBlank }));
    await user.type(screen.getByRole("textbox", { name: S.newPlaceholder }), "Fresh text");
    await user.click(screen.getByRole("button", { name: S.save }));

    await waitFor(() => expect(api.outtakes.create).toHaveBeenCalled());
    const body = vi.mocked(api.outtakes.create).mock.calls[0]![1];
    const content = body.content as Record<string, unknown>;
    expect(content.type).toBe("doc");
    expect(JSON.stringify(content)).toContain("Fresh text");

    // Prepended: two card label inputs now (the new null-label row + Old).
    await waitFor(() => {
      expect(screen.getAllByRole("textbox", { name: S.labelAriaLabel })).toHaveLength(2);
    });
    const labelValues = screen
      .getAllByRole("textbox", { name: S.labelAriaLabel })
      .map((el) => (el as HTMLInputElement).value);
    expect(labelValues).toEqual(["", "Old"]); // new row prepended before Old
  });

  it("does not create an outtake from an empty textarea", async () => {
    const user = userEvent.setup();
    render(<OuttakesPanel {...defaultProps} />);
    await waitFor(() => expect(api.outtakes.list).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: S.newBlank }));
    await user.click(screen.getByRole("button", { name: S.save }));
    expect(api.outtakes.create).not.toHaveBeenCalled();
  });

  it("re-fetches when refreshNonce changes and shows the new row", async () => {
    vi.mocked(api.outtakes.list).mockResolvedValueOnce([makeOuttake({ id: "a", label: "Alpha" })]);
    const { rerender } = render(<OuttakesPanel {...defaultProps} refreshNonce={0} />);
    await waitFor(() => expect(screen.getByDisplayValue("Alpha")).toBeInTheDocument());

    vi.mocked(api.outtakes.list).mockResolvedValueOnce([
      makeOuttake({ id: "a", label: "Alpha" }),
      makeOuttake({ id: "b", label: "Captured" }),
    ]);
    rerender(<OuttakesPanel {...defaultProps} refreshNonce={1} />);
    await waitFor(() => expect(screen.getByDisplayValue("Captured")).toBeInTheDocument());
    expect(api.outtakes.list).toHaveBeenCalledTimes(2);
  });

  it("surfaces the mapped message on a failed load without leaking a raw warning", async () => {
    vi.mocked(api.outtakes.list).mockRejectedValue(new Error("boom"));
    render(<OuttakesPanel {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText(STRINGS.error.loadOuttakesFailed)).toBeInTheDocument();
    });
    expectConsole("warn").silent();
    expectConsole("error").silent();
  });

  it("deletes an outtake and removes it from the list", async () => {
    vi.mocked(api.outtakes.list).mockResolvedValue([makeOuttake({ id: "a", label: "Doomed" })]);
    const user = userEvent.setup();
    render(<OuttakesPanel {...defaultProps} />);
    await waitFor(() => expect(screen.getByDisplayValue("Doomed")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: S.delete }));
    await user.click(screen.getByRole("button", { name: STRINGS.delete.confirmButton }));

    await waitFor(() => expect(api.outtakes.delete).toHaveBeenCalledWith("a", expect.anything()));
    await waitFor(() => expect(screen.queryByDisplayValue("Doomed")).not.toBeInTheDocument());
  });

  it("updates a label in place via the API", async () => {
    vi.mocked(api.outtakes.list).mockResolvedValue([makeOuttake({ id: "a", label: "Before" })]);
    vi.mocked(api.outtakes.updateLabel).mockResolvedValue(
      makeOuttake({ id: "a", label: "After" }),
    );
    const user = userEvent.setup();
    render(<OuttakesPanel {...defaultProps} />);
    const input = await screen.findByDisplayValue("Before");

    await user.clear(input);
    await user.type(input, "After");
    await user.tab();

    await waitFor(() =>
      expect(api.outtakes.updateLabel).toHaveBeenCalledWith(
        "a",
        { label: "After" },
        expect.anything(),
      ),
    );
  });
});
