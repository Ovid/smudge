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
  capturedOuttake: null,
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

  it("shows the no-matches message when a filter matches zero of several rows", async () => {
    vi.mocked(api.outtakes.list).mockResolvedValue([
      makeOuttake({ id: "a", label: "Alpha" }),
      makeOuttake({ id: "b", label: "Beta" }),
    ]);
    const user = userEvent.setup();
    render(<OuttakesPanel {...defaultProps} />);
    await waitFor(() => expect(screen.getByDisplayValue("Alpha")).toBeInTheDocument());

    await user.type(screen.getByRole("textbox", { name: S.filterPlaceholder }), "zzznope");
    expect(screen.getByText(S.noMatches)).toBeInTheDocument();
    // The truly-empty state must not appear when rows exist but are filtered out.
    expect(screen.queryByText(S.empty)).not.toBeInTheDocument();
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

  it("prepends a captured outtake without a reload (I1)", async () => {
    vi.mocked(api.outtakes.list).mockResolvedValue([makeOuttake({ id: "a", label: "Alpha" })]);
    const { rerender } = render(<OuttakesPanel {...defaultProps} capturedOuttake={null} />);
    await waitFor(() => expect(screen.getByDisplayValue("Alpha")).toBeInTheDocument());

    // A toolbar capture hands the created row down; it appears immediately with
    // no second list() call, so a concurrent card mutation cannot drop it.
    const captured = makeOuttake({ id: "b", label: "Captured" });
    rerender(<OuttakesPanel {...defaultProps} capturedOuttake={captured} />);
    await waitFor(() => expect(screen.getByDisplayValue("Captured")).toBeInTheDocument());
    expect(screen.getByDisplayValue("Alpha")).toBeInTheDocument();
    expect(api.outtakes.list).toHaveBeenCalledTimes(1);
  });

  it("the captured row survives a card delete fired right after (I1)", async () => {
    vi.mocked(api.outtakes.list).mockResolvedValue([makeOuttake({ id: "a", label: "Alpha" })]);
    const user = userEvent.setup();
    const { rerender } = render(<OuttakesPanel {...defaultProps} capturedOuttake={null} />);
    await waitFor(() => expect(screen.getByDisplayValue("Alpha")).toBeInTheDocument());

    const captured = makeOuttake({ id: "b", label: "Captured" });
    rerender(<OuttakesPanel {...defaultProps} capturedOuttake={captured} />);
    await waitFor(() => expect(screen.getByDisplayValue("Captured")).toBeInTheDocument());

    // Deleting the other row (which seq.abort()s any in-flight reload) must not
    // drop the already-prepended capture. Captured is prepended at index 0, so
    // Alpha's delete is index 1.
    await user.click(screen.getAllByRole("button", { name: S.delete })[1]!);
    await user.click(screen.getByRole("button", { name: STRINGS.delete.confirmButton }));
    await waitFor(() => expect(screen.queryByDisplayValue("Alpha")).not.toBeInTheDocument());
    expect(screen.getByDisplayValue("Captured")).toBeInTheDocument();
  });

  it("does not duplicate a captured row a reload already surfaced (I1 dedup)", async () => {
    const captured = makeOuttake({ id: "b", label: "Captured" });
    // The mount load already contains the row (a prior reload surfaced it).
    vi.mocked(api.outtakes.list).mockResolvedValue([makeOuttake({ id: "a" }), captured]);
    const { rerender } = render(<OuttakesPanel {...defaultProps} capturedOuttake={null} />);
    await waitFor(() => expect(screen.getByDisplayValue("Captured")).toBeInTheDocument());

    rerender(<OuttakesPanel {...defaultProps} capturedOuttake={captured} />);
    await new Promise((r) => setTimeout(r, 0));
    // Prepend dedups by id — no duplicate React row for "b".
    expect(screen.getAllByDisplayValue("Captured")).toHaveLength(1);
  });

  it("does not re-declare the reference panel frame or pin its own width (I2)", async () => {
    // The owning <aside> supplies the border, background, overflow and the
    // user-resizable width (240-480px). Re-declaring them here pinned the
    // content at 320px: below that the panel refused to shrink (spurious
    // horizontal scrollbar, clipped by the aside), above it a dead gutter and
    // a duplicate border. jsdom does no layout, so the class list IS the
    // contract — the sibling tab (ImageGallery) is just "flex flex-col h-full".
    const { container } = render(<OuttakesPanel {...defaultProps} />);
    await waitFor(() => expect(api.outtakes.list).toHaveBeenCalled());

    const root = container.firstElementChild!;
    for (const owned of ["w-80", "min-w-80", "border-l", "bg-bg-sidebar"]) {
      expect(root.classList.contains(owned)).toBe(false);
    }
  });

  it("mounting with a capture already in hand keeps the server list (C1)", async () => {
    // The capture POST completes before the panel mounts (the toolbar button
    // lives outside the panel, and the panel unmounts when the drawer is closed
    // or another tab is selected). The mount load therefore ALREADY contains the
    // captured row — prepending it here would stale that load and leave the
    // panel showing only the capture, hiding every stored outtake.
    const captured = makeOuttake({ id: "cap", label: "Captured" });
    vi.mocked(api.outtakes.list).mockResolvedValue([
      captured,
      makeOuttake({ id: "a", label: "Alpha" }),
    ]);
    render(<OuttakesPanel {...defaultProps} capturedOuttake={captured} />);

    await waitFor(() => expect(screen.getByDisplayValue("Alpha")).toBeInTheDocument());
    expect(screen.getAllByDisplayValue("Captured")).toHaveLength(1);
  });

  it("does not leak a previous project's capture into a new project's list (C1)", async () => {
    // Same mount path, but the row belongs to project A while the panel mounts
    // for project B: the stale row must not appear at all.
    const projectARow = makeOuttake({ id: "cap", project_id: "proj-A", label: "From A" });
    vi.mocked(api.outtakes.list).mockResolvedValue([makeOuttake({ id: "b", label: "B row" })]);
    render(
      <OuttakesPanel {...defaultProps} projectId="proj-B" capturedOuttake={projectARow} />,
    );

    await waitFor(() => expect(screen.getByDisplayValue("B row")).toBeInTheDocument());
    expect(screen.queryByDisplayValue("From A")).not.toBeInTheDocument();
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

  it("updates in place using the SERVER-returned row, not the local draft", async () => {
    vi.mocked(api.outtakes.list).mockResolvedValue([
      makeOuttake({ id: "a", label: "Before", content: docFromLines("Original body") }),
    ]);
    // The server row carries content the client never typed. The card's
    // preview renders straight from outtake.content, so it only shows the
    // server text if handleUpdateLabel replaced the row (o.id === id ? row : o).
    vi.mocked(api.outtakes.updateLabel).mockResolvedValue(
      makeOuttake({ id: "a", label: "After", content: docFromLines("Server body") }),
    );
    const user = userEvent.setup();
    render(<OuttakesPanel {...defaultProps} />);
    const input = await screen.findByDisplayValue("Before");
    expect(screen.getByText("Original body")).toBeInTheDocument();

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
    await waitFor(() => expect(screen.getByText("Server body")).toBeInTheDocument());
    expect(screen.queryByText("Original body")).not.toBeInTheDocument();
  });

  it("save is disabled while a create is in flight, then re-enabled", async () => {
    vi.mocked(api.outtakes.list).mockResolvedValue([]);
    let resolveCreate!: (row: OuttakeRow) => void;
    vi.mocked(api.outtakes.create).mockReturnValue(
      new Promise<OuttakeRow>((res) => {
        resolveCreate = res;
      }),
    );
    const user = userEvent.setup();
    render(<OuttakesPanel {...defaultProps} />);
    await waitFor(() => expect(api.outtakes.list).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: S.newBlank }));
    await user.type(screen.getByRole("textbox", { name: S.newPlaceholder }), "New body");
    const save = screen.getByRole("button", { name: S.save });
    expect(save).toBeEnabled();

    await user.click(save);
    await waitFor(() => expect(save).toBeDisabled());
    expect(api.outtakes.create).toHaveBeenCalledTimes(1);

    resolveCreate(makeOuttake({ id: "new", label: null, content: docFromLines("New body") }));
    // After success the form closes; open it again and Save is enabled.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: S.save })).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: S.newBlank }));
    expect(screen.getByRole("button", { name: S.save })).toBeEnabled();
  });

  it("a delete does not abort an in-flight label update (independent ops)", async () => {
    vi.mocked(api.outtakes.list).mockResolvedValue([
      makeOuttake({ id: "a", label: "Renamed target", content: docFromLines("Body A") }),
      makeOuttake({ id: "b", label: "Doomed", content: docFromLines("Body B") }),
    ]);
    let resolveUpdate!: (row: OuttakeRow) => void;
    vi.mocked(api.outtakes.updateLabel).mockReturnValue(
      new Promise<OuttakeRow>((res) => {
        resolveUpdate = res;
      }),
    );
    const user = userEvent.setup();
    render(<OuttakesPanel {...defaultProps} />);
    const input = await screen.findByDisplayValue("Renamed target");

    // Start an in-flight label update on row "a".
    await user.clear(input);
    await user.type(input, "New A label");
    await user.tab();
    await waitFor(() => expect(api.outtakes.updateLabel).toHaveBeenCalled());

    // Delete a DIFFERENT row while the update is still pending. With a shared
    // op this delete's run() would abort the update's controller.
    await user.click(screen.getAllByRole("button", { name: S.delete })[1]!);
    await user.click(screen.getByRole("button", { name: STRINGS.delete.confirmButton }));
    await waitFor(() => expect(screen.queryByDisplayValue("Doomed")).not.toBeInTheDocument());

    // Resolve the update: its handler must NOT have been aborted, so the server
    // row (with new content) lands in state.
    resolveUpdate(
      makeOuttake({ id: "a", label: "New A label", content: docFromLines("Body A server") }),
    );
    await waitFor(() => expect(screen.getByText("Body A server")).toBeInTheDocument());
  });

  it("reverts the label and stays retryable after a failed rename (I3)", async () => {
    vi.mocked(api.outtakes.list).mockResolvedValue([makeOuttake({ id: "a", label: "Before" })]);
    vi.mocked(api.outtakes.updateLabel)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(makeOuttake({ id: "a", label: "After" }));
    const user = userEvent.setup();
    render(<OuttakesPanel {...defaultProps} />);
    const input = await screen.findByDisplayValue("Before");

    await user.clear(input);
    await user.type(input, "After");
    await user.tab();

    // Failure: the visible draft reverts to the last committed value (the
    // server still holds it) and the error banner shows.
    await waitFor(() =>
      expect(screen.getByText(STRINGS.error.updateOuttakeFailed)).toBeInTheDocument(),
    );
    expect(screen.getByDisplayValue("Before")).toBeInTheDocument();

    // Retryable: the ref was NOT advanced past the failure, so re-committing the
    // same value fires a second PATCH (which now succeeds).
    const retry = screen.getByDisplayValue("Before");
    await user.clear(retry);
    await user.type(retry, "After");
    await user.tab();
    await waitFor(() => expect(api.outtakes.updateLabel).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByDisplayValue("After")).toBeInTheDocument());
  });

  it("discards a stale reload that would resurrect a row deleted after it started (I2)", async () => {
    const a = makeOuttake({ id: "a", label: "Alpha" });
    let resolveReload!: (rows: OuttakeRow[]) => void;
    vi.mocked(api.outtakes.list)
      .mockResolvedValueOnce([a]) // mount load
      .mockReturnValueOnce(
        new Promise<OuttakeRow[]>((res) => {
          resolveReload = res;
        }),
      ); // projectId-change reload, deferred
    const user = userEvent.setup();
    const { rerender } = render(<OuttakesPanel {...defaultProps} projectId="proj-1" />);
    await screen.findByDisplayValue("Alpha");

    // A projectId change fires the (deferred) reload GET.
    rerender(<OuttakesPanel {...defaultProps} projectId="proj-2" />);
    await waitFor(() => expect(api.outtakes.list).toHaveBeenCalledTimes(2));

    // Delete "a" while that reload GET is still in flight.
    await user.click(screen.getByRole("button", { name: S.delete }));
    await user.click(screen.getByRole("button", { name: STRINGS.delete.confirmButton }));
    await waitFor(() => expect(screen.queryByDisplayValue("Alpha")).not.toBeInTheDocument());

    // The stale reload resolves still holding "a" — it must be discarded, not
    // overwrite the just-applied deletion.
    resolveReload([a]);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByDisplayValue("Alpha")).not.toBeInTheDocument();
  });

  it("does not duplicate a created row a concurrent reload already added (I2)", async () => {
    const created = makeOuttake({ id: "new", label: "New" });
    let resolveCreate!: (r: OuttakeRow) => void;
    vi.mocked(api.outtakes.create).mockReturnValue(
      new Promise<OuttakeRow>((res) => {
        resolveCreate = res;
      }),
    );
    vi.mocked(api.outtakes.list)
      .mockResolvedValueOnce([]) // mount
      .mockResolvedValueOnce([created]); // reload sees the server's copy first
    const user = userEvent.setup();
    const { rerender } = render(<OuttakesPanel {...defaultProps} projectId="proj-1" />);
    await waitFor(() => expect(api.outtakes.list).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: S.newBlank }));
    await user.type(screen.getByRole("textbox", { name: S.newPlaceholder }), "New body");
    await user.click(screen.getByRole("button", { name: S.save }));
    await waitFor(() => expect(api.outtakes.create).toHaveBeenCalled());

    // A projectId-change reload lands the server's copy before the POST resolves.
    rerender(<OuttakesPanel {...defaultProps} projectId="proj-2" />);
    await waitFor(() => expect(screen.getByDisplayValue("New")).toBeInTheDocument());

    // The create resolves; the prepend must dedup by id, not double-render.
    resolveCreate(created);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getAllByRole("textbox", { name: S.labelAriaLabel })).toHaveLength(1);
  });

  it("two deletes on different rows both land (I4 same-type sibling abort)", async () => {
    vi.mocked(api.outtakes.list).mockResolvedValue([
      makeOuttake({ id: "a", label: "Alpha" }),
      makeOuttake({ id: "b", label: "Beta" }),
    ]);
    let resolveA!: () => void;
    let resolveB!: () => void;
    vi.mocked(api.outtakes.delete).mockImplementation((id) =>
      id === "a"
        ? new Promise<undefined>((r) => {
            resolveA = () => r(undefined);
          })
        : new Promise<undefined>((r) => {
            resolveB = () => r(undefined);
          }),
    );
    const user = userEvent.setup();
    render(<OuttakesPanel {...defaultProps} />);
    await screen.findByDisplayValue("Alpha");

    // Start delete A (in flight), then delete B (in flight). With a single shared
    // per-type op, B's run() would abort A's controller and A would never leave.
    await user.click(screen.getAllByRole("button", { name: S.delete })[0]!);
    await user.click(screen.getByRole("button", { name: STRINGS.delete.confirmButton }));
    await waitFor(() => expect(api.outtakes.delete).toHaveBeenCalledWith("a", expect.anything()));
    await user.click(screen.getAllByRole("button", { name: S.delete })[1]!);
    await user.click(screen.getByRole("button", { name: STRINGS.delete.confirmButton }));
    await waitFor(() => expect(api.outtakes.delete).toHaveBeenCalledWith("b", expect.anything()));

    resolveA();
    resolveB();
    await waitFor(() => expect(screen.queryByDisplayValue("Alpha")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByDisplayValue("Beta")).not.toBeInTheDocument());
  });
});
