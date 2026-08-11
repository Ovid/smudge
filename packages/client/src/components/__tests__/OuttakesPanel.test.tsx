import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OuttakesPanel } from "../OuttakesPanel";
import { api, ApiRequestError } from "../../api/client";
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
  // S1: EditorPage bumps this when a capture's response was unreadable. Held at
  // 0 here; the refetch it drives is exercised end-to-end through EditorPage in
  // OuttakesEditorEntryPoints.test.tsx, where the capture handler that bumps it
  // actually exists.
  externalRefreshKey: 0,
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

  it("does not claim the project has no outtakes while the list is loading (S6)", async () => {
    // There was no loading flag, and the projectId effect empties the list
    // before the new load starts — so the empty state rendered for the full
    // duration of every load. A writer with fifty outtakes was told there were
    // none and invited to stash a duplicate.
    let settle!: (rows: OuttakeRow[]) => void;
    vi.mocked(api.outtakes.list).mockReturnValue(
      new Promise((res) => {
        settle = res;
      }),
    );
    render(<OuttakesPanel {...defaultProps} />);
    await waitFor(() => expect(api.outtakes.list).toHaveBeenCalled());

    expect(screen.queryByText(S.empty)).not.toBeInTheDocument();

    settle([makeOuttake({ id: "a", label: "Fifty of these" })]);
    await waitFor(() => expect(screen.getByDisplayValue("Fifty of these")).toBeInTheDocument());
    expect(screen.queryByText(S.empty)).not.toBeInTheDocument();
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

  // I3 (agentic-review 2026-08-04): the worst of the three unmount-abort cases.
  // ReferencePanel renders `{activeTab?.panel ?? null}` and the panel renders
  // only while open, so "Save a blank note, then click Images (or Ctrl+.)"
  // unmounted this panel mid-POST: the request was aborted AND the `draft` state
  // died with the component. Unrecoverable text, from the one panel whose stated
  // job is not losing the writer's text. Un-aborted, the row lands and the next
  // mount's load surfaces it.
  it("unmounting the panel does not cancel an in-flight blank-note create (I3)", async () => {
    vi.mocked(api.outtakes.create).mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    const { unmount } = render(<OuttakesPanel {...defaultProps} />);
    await waitFor(() => expect(api.outtakes.list).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: S.newBlank }));
    await user.type(screen.getByRole("textbox", { name: S.newPlaceholder }), "Only copy");
    await user.click(screen.getByRole("button", { name: S.save }));
    await waitFor(() => expect(api.outtakes.create).toHaveBeenCalled());

    unmount();

    const signal = vi
      .mocked(api.outtakes.create)
      .mock.calls[0]!.find((a): a is AbortSignal => a instanceof AbortSignal);
    expect(signal?.aborted ?? false).toBe(false);
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
    render(<OuttakesPanel {...defaultProps} projectId="proj-B" capturedOuttake={projectARow} />);

    await waitFor(() => expect(screen.getByDisplayValue("B row")).toBeInTheDocument());
    expect(screen.queryByDisplayValue("From A")).not.toBeInTheDocument();
  });

  it("does not leak a capture that arrives AFTER a project switch (I1)", async () => {
    // The C1 test above covers the MOUNT path (capture already in hand when the
    // panel first renders, so surfacedCaptureIdRef seeds it away). This is the
    // prop-change path: the panel is already mounted for project B when project
    // A's capture POST finally resolves. surfacedCaptureIdRef was seeded null at
    // B's first render, so the id differs and the prepend effect fires. The row
    // belongs to A and must be dropped on its project_id, not on a ref seed.
    vi.mocked(api.outtakes.list).mockResolvedValue([makeOuttake({ id: "b", label: "B row" })]);
    const { rerender } = render(<OuttakesPanel {...defaultProps} projectId="proj-B" />);
    await waitFor(() => expect(screen.getByDisplayValue("B row")).toBeInTheDocument());

    const projectARow = makeOuttake({ id: "cap", project_id: "proj-A", label: "From A" });
    rerender(<OuttakesPanel {...defaultProps} projectId="proj-B" capturedOuttake={projectARow} />);

    await waitFor(() => expect(screen.getByDisplayValue("B row")).toBeInTheDocument());
    expect(screen.queryByDisplayValue("From A")).not.toBeInTheDocument();
  });

  it("drops a created row that came back for a different project (I1)", async () => {
    // Same guard, reached through the blank-note create rather than the toolbar
    // capture: handleCreate has no project re-check after its await either, so
    // applyServerRow is the one place that has to refuse the row.
    const user = userEvent.setup();
    vi.mocked(api.outtakes.list).mockResolvedValue([]);
    vi.mocked(api.outtakes.create).mockResolvedValue(
      makeOuttake({ id: "new", project_id: "proj-OTHER", label: "Wrong project" }),
    );
    render(<OuttakesPanel {...defaultProps} projectId="proj-1" />);
    await waitFor(() => expect(screen.getByText(S.empty)).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: S.newBlank }));
    await user.type(screen.getByLabelText(S.newPlaceholder), "stashed text");
    await user.click(screen.getByRole("button", { name: S.save }));

    await waitFor(() => expect(api.outtakes.create).toHaveBeenCalled());
    expect(screen.queryByDisplayValue("Wrong project")).not.toBeInTheDocument();
  });

  it("drops a created row when the project changed while the POST was in flight (I1)", async () => {
    // The test above holds projectId CONSTANT and stages a server-echoed wrong
    // project_id, so applyServerRow's closure is still current there — it cannot
    // see the real hazard. Here the row is correct for the project it was
    // created in (A) and the panel has since moved to B. handleCreate is a plain
    // function body, so its running invocation pins the click-time
    // applyServerRow — the one closed over A's projectId — and the guard then
    // compares A against A and lets the row into B's list. Its Insert pastes A's
    // private text into a B chapter; its Delete HARD-deletes a real project-A
    // outtake (no deleted_at — CLAUDE.md §Data Model).
    const user = userEvent.setup();
    let resolveCreate!: (r: OuttakeRow) => void;
    vi.mocked(api.outtakes.create).mockReturnValue(
      new Promise<OuttakeRow>((res) => {
        resolveCreate = res;
      }),
    );
    vi.mocked(api.outtakes.list).mockResolvedValue([]);
    const { rerender } = render(<OuttakesPanel {...defaultProps} projectId="proj-A" />);
    await waitFor(() => expect(screen.getByText(S.empty)).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: S.newBlank }));
    await user.type(screen.getByLabelText(S.newPlaceholder), "A's private text");
    await user.click(screen.getByRole("button", { name: S.save }));
    await waitFor(() => expect(api.outtakes.create).toHaveBeenCalled());

    rerender(<OuttakesPanel {...defaultProps} projectId="proj-B" />);
    resolveCreate(makeOuttake({ id: "cap", project_id: "proj-A", label: "From A" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByDisplayValue("From A")).not.toBeInTheDocument();
  });

  it("keeps the draft and the form open when the created row is refused (S2)", async () => {
    // The refusal above is the ordinary project-switch-mid-create path, not an
    // exotic one. Tearing the form down on a row that was never added closes the
    // form, shows no card and says nothing — the writer's text vanishes from the
    // one panel whose whole job is not losing it. The row DID commit (in A), so
    // the text is recoverable there; keeping it on screen is what lets the writer
    // notice and decide.
    const user = userEvent.setup();
    let resolveCreate!: (r: OuttakeRow) => void;
    vi.mocked(api.outtakes.create).mockReturnValue(
      new Promise<OuttakeRow>((res) => {
        resolveCreate = res;
      }),
    );
    vi.mocked(api.outtakes.list).mockResolvedValue([]);
    const { rerender } = render(<OuttakesPanel {...defaultProps} projectId="proj-A" />);
    await waitFor(() => expect(screen.getByText(S.empty)).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: S.newBlank }));
    await user.type(screen.getByLabelText(S.newPlaceholder), "A's private text");
    await user.click(screen.getByRole("button", { name: S.save }));
    await waitFor(() => expect(api.outtakes.create).toHaveBeenCalled());

    rerender(<OuttakesPanel {...defaultProps} projectId="proj-B" />);
    resolveCreate(makeOuttake({ id: "cap", project_id: "proj-A", label: "From A" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByLabelText(S.newPlaceholder)).toHaveValue("A's private text");
    expect(screen.getByText(S.createdElsewhere)).toBeInTheDocument();
  });

  it("does not paint project A's create failure onto project B (I3)", async () => {
    // The success arm guards the mid-POST project switch; the catch arm did not,
    // so A's failure banner landed on B AFTER the projectId clearing effect had
    // run — nothing removes it for the rest of the session. Worse, the draft is
    // deliberately retained, so the writer sees A's prose in B's panel under an
    // unattributed banner, and clicking Save files it under B.
    const user = userEvent.setup();
    let rejectCreate!: (err: unknown) => void;
    vi.mocked(api.outtakes.create).mockReturnValue(
      new Promise<OuttakeRow>((_res, rej) => {
        rejectCreate = rej;
      }),
    );
    vi.mocked(api.outtakes.list).mockResolvedValue([]);
    const { rerender } = render(<OuttakesPanel {...defaultProps} projectId="proj-A" />);
    await waitFor(() => expect(screen.getByText(S.empty)).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: S.newBlank }));
    await user.type(screen.getByLabelText(S.newPlaceholder), "A's private text");
    await user.click(screen.getByRole("button", { name: S.save }));
    await waitFor(() => expect(api.outtakes.create).toHaveBeenCalled());

    rerender(<OuttakesPanel {...defaultProps} projectId="proj-B" />);
    rejectCreate(new Error("boom"));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText(STRINGS.error.createOuttakeFailed)).not.toBeInTheDocument();
    expect(screen.getByText(S.createFailedElsewhere)).toBeInTheDocument();
    expect(screen.getByLabelText(S.newPlaceholder)).toHaveValue("A's private text");
  });

  // I5 (agentic-review 2026-08-05): the sibling of the create-drift guard above,
  // for the card's two writers. b082975d applied it to handleCreate's catch and
  // not to commitLabel / handleDelete, which report straight into the panel's
  // shared banners — and nothing clears them once the projectId effect has run.
  it("does not paint project A's rename failure onto project B (I5)", async () => {
    const user = userEvent.setup();
    let rejectRename!: (err: unknown) => void;
    vi.mocked(api.outtakes.list).mockResolvedValue([
      makeOuttake({ id: "a", project_id: "proj-A", label: "Before" }),
    ]);
    vi.mocked(api.outtakes.updateLabel).mockReturnValue(
      new Promise<OuttakeRow>((_res, rej) => {
        rejectRename = rej;
      }),
    );
    const { rerender } = render(<OuttakesPanel {...defaultProps} projectId="proj-A" />);
    const input = await screen.findByDisplayValue("Before");

    await user.clear(input);
    await user.type(input, "After");
    await user.tab();
    await waitFor(() => expect(api.outtakes.updateLabel).toHaveBeenCalled());

    vi.mocked(api.outtakes.list).mockResolvedValue([]);
    rerender(<OuttakesPanel {...defaultProps} projectId="proj-B" />);
    await waitFor(() => expect(screen.getByText(S.empty)).toBeInTheDocument());
    rejectRename(new Error("boom"));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText(STRINGS.error.updateOuttakeFailed)).not.toBeInTheDocument();
  });

  it("does not let project A's delete failure clear project B's ambiguity notice (I5)", async () => {
    const user = userEvent.setup();
    let rejectDelete!: (err: unknown) => void;
    vi.mocked(api.outtakes.list).mockResolvedValue([
      makeOuttake({ id: "a", project_id: "proj-A", label: "A row" }),
    ]);
    vi.mocked(api.outtakes.delete).mockReturnValue(
      new Promise<void>((_res, rej) => {
        rejectDelete = rej;
      }),
    );
    const { rerender } = render(<OuttakesPanel {...defaultProps} projectId="proj-A" />);
    await screen.findByDisplayValue("A row");

    await user.click(screen.getByRole("button", { name: S.delete }));
    await user.click(screen.getByRole("button", { name: STRINGS.delete.confirmButton }));
    await waitFor(() => expect(api.outtakes.delete).toHaveBeenCalled());

    vi.mocked(api.outtakes.list).mockResolvedValue([]);
    rerender(<OuttakesPanel {...defaultProps} projectId="proj-B" />);
    await waitFor(() => expect(screen.getByText(S.empty)).toBeInTheDocument());
    rejectDelete(new Error("boom"));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText(STRINGS.error.deleteOuttakeFailed)).not.toBeInTheDocument();
  });

  it("a project switch clears the previous project's rows and sticky notice (I3)", async () => {
    // The panel is not keyed on project, so a switch only changes the prop. If
    // the reload for B fails, A's rows stay rendered — and every one of them is
    // actionable: Delete on such a card hard-deletes a real project-A outtake
    // (outtakes have no deleted_at). Rows must go the moment the project does.
    //
    // S2 (agentic-review 2026-08-04): spies installed BEFORE the action —
    // expectConsole() calls vi.spyOn at call time, so the trailing form these
    // used left spy.mock.calls necessarily empty and passed unconditionally.
    const warn = expectConsole("warn");
    const error = expectConsole("error");
    vi.mocked(api.outtakes.list).mockResolvedValue([makeOuttake({ id: "a", label: "A row" })]);
    const { rerender } = render(<OuttakesPanel {...defaultProps} projectId="proj-A" />);
    await waitFor(() => expect(screen.getByDisplayValue("A row")).toBeInTheDocument());

    vi.mocked(api.outtakes.list).mockRejectedValue(new Error("boom"));
    rerender(<OuttakesPanel {...defaultProps} projectId="proj-B" />);

    await waitFor(() => {
      expect(screen.getByText(STRINGS.error.loadOuttakesFailed)).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue("A row")).not.toBeInTheDocument();
    warn.silent();
    error.silent();
  });

  it("surfaces the mapped message on a failed load without leaking a raw warning", async () => {
    const warn = expectConsole("warn");
    const error = expectConsole("error");
    vi.mocked(api.outtakes.list).mockRejectedValue(new Error("boom"));
    render(<OuttakesPanel {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText(STRINGS.error.loadOuttakesFailed)).toBeInTheDocument();
    });
    warn.silent();
    error.silent();
  });

  it("deletes an outtake and removes it from the list", async () => {
    vi.mocked(api.outtakes.list).mockResolvedValue([makeOuttake({ id: "a", label: "Doomed" })]);
    const user = userEvent.setup();
    render(<OuttakesPanel {...defaultProps} />);
    await waitFor(() => expect(screen.getByDisplayValue("Doomed")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: S.delete }));
    await user.click(screen.getByRole("button", { name: STRINGS.delete.confirmButton }));

    await waitFor(() => expect(api.outtakes.delete).toHaveBeenCalledWith("a"));
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
      expect(api.outtakes.updateLabel).toHaveBeenCalledWith("a", { label: "After" }),
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

  it("a settling create does not wipe a newer draft the writer started (I2)", async () => {
    // Cancel carries no disabled={creating} — only Save does — so the writer can
    // close the form and start a second note while the first POST is still out.
    // The tail of handleCreate must not clear text it never sent. This is the
    // same current === attempted discipline OuttakeCard.commitLabel already uses.
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
    await user.type(screen.getByRole("textbox", { name: S.newPlaceholder }), "scene A");
    await user.click(screen.getByRole("button", { name: S.save }));
    await waitFor(() => expect(api.outtakes.create).toHaveBeenCalledTimes(1));

    // Writer gives up waiting, cancels, and starts a different note.
    await user.click(screen.getByRole("button", { name: S.cancel }));
    await user.click(screen.getByRole("button", { name: S.newBlank }));
    await user.type(screen.getByRole("textbox", { name: S.newPlaceholder }), "scene B");

    resolveCreate(makeOuttake({ id: "new", label: "Saved A", content: docFromLines("scene A") }));
    await waitFor(() => expect(screen.getByDisplayValue("Saved A")).toBeInTheDocument());

    // "scene B" is still on screen, in an open form, unsent and unlost.
    expect(screen.getByRole("textbox", { name: S.newPlaceholder })).toHaveValue("scene B");
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

  // I3 (agentic-review 2026-08-05): the 404 arm called onError then onDeleted,
  // and handleDeleted ends with setError(null) — two writes to the same state in
  // one continuation, last one wins. db36f8a2's stated intent was "drop the card
  // AND say so"; the "say so" half never reached the DOM, so on a hard-delete
  // table with no trash the card just vanished with nothing explaining why.
  it("says why the card vanished when a rename 404s (I3)", async () => {
    vi.mocked(api.outtakes.list).mockResolvedValue([makeOuttake({ id: "a", label: "Before" })]);
    vi.mocked(api.outtakes.updateLabel).mockRejectedValue(
      new ApiRequestError("Outtake not found.", 404, "NOT_FOUND"),
    );
    const user = userEvent.setup();
    render(<OuttakesPanel {...defaultProps} />);
    const input = await screen.findByDisplayValue("Before");

    await user.clear(input);
    await user.type(input, "After");
    await user.tab();

    await waitFor(() => expect(screen.getByText(S.alreadyGone)).toBeInTheDocument());
    expect(screen.queryByDisplayValue("Before")).not.toBeInTheDocument();
  });

  it("discards a stale reload that would resurrect a row deleted after it started (I2)", async () => {
    const a = makeOuttake({ id: "a", label: "Alpha" });
    const b = makeOuttake({ id: "b", label: "Beta" });
    let resolveReload!: (rows: OuttakeRow[]) => void;
    vi.mocked(api.outtakes.list)
      .mockResolvedValueOnce([a, b]) // mount load
      .mockReturnValueOnce(
        new Promise<OuttakeRow[]>((res) => {
          resolveReload = res;
        }),
      ) // possibly-committed recovery reload, deferred
      .mockResolvedValue([b]); // the load the delete re-issues: server truth
    // A rename the server may or may not have committed is the in-project way
    // to put a reload in flight. (A projectId change also reloads, but it now
    // clears the list outright — I3 — so it cannot stage this race.)
    vi.mocked(api.outtakes.updateLabel).mockRejectedValue(
      new ApiRequestError("bad body", 200, "BAD_JSON"),
    );
    const user = userEvent.setup();
    render(<OuttakesPanel {...defaultProps} />);
    await screen.findByDisplayValue("Alpha");

    const betaInput = screen.getByDisplayValue("Beta");
    await user.clear(betaInput);
    await user.type(betaInput, "Beta renamed");
    await user.tab();
    await waitFor(() => expect(api.outtakes.list).toHaveBeenCalledTimes(2));

    // Delete "a" while that reload GET is still in flight.
    await user.click(screen.getAllByRole("button", { name: S.delete })[0]!);
    await user.click(screen.getByRole("button", { name: STRINGS.delete.confirmButton }));
    await waitFor(() => expect(screen.queryByDisplayValue("Alpha")).not.toBeInTheDocument());

    // The stale reload resolves still holding "a" — it must be discarded, not
    // overwrite the just-applied deletion.
    resolveReload([a, b]);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByDisplayValue("Alpha")).not.toBeInTheDocument();
  });

  it("does not duplicate a created row a concurrent reload already added (I2)", async () => {
    // S17 (agentic-review 2026-08-04): this used to stage the concurrent reload
    // by switching projectId, which after the I1 fix makes applyServerRow refuse
    // the row OUTRIGHT — `toHaveLength(1)` would then pass without the dedup
    // branch ever running. Stage the reload inside ONE project instead, via the
    // explicit reload a card delete triggers while the create is still out.
    const created = makeOuttake({ id: "new", label: "New" });
    let resolveCreate!: (r: OuttakeRow) => void;
    vi.mocked(api.outtakes.create).mockReturnValue(
      new Promise<OuttakeRow>((res) => {
        resolveCreate = res;
      }),
    );
    let resolveMountLoad!: (rows: OuttakeRow[]) => void;
    vi.mocked(api.outtakes.list)
      .mockReturnValueOnce(
        new Promise<OuttakeRow[]>((res) => {
          resolveMountLoad = res;
        }),
      )
      .mockResolvedValue([created]);
    const user = userEvent.setup();
    render(<OuttakesPanel {...defaultProps} projectId="proj-1" />);
    await waitFor(() => expect(api.outtakes.list).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: S.newBlank }));
    await user.type(screen.getByRole("textbox", { name: S.newPlaceholder }), "New body");
    await user.click(screen.getByRole("button", { name: S.save }));
    await waitFor(() => expect(api.outtakes.create).toHaveBeenCalled());

    // The mount GET lands the server's copy of the new row before the POST
    // resolves — same project throughout, so the row reaches the dedup branch
    // rather than being refused by the project guard.
    resolveMountLoad([created]);
    await waitFor(() => expect(screen.getByDisplayValue("New")).toBeInTheDocument());

    // The create resolves; the prepend must dedup by id, not double-render.
    resolveCreate(created);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getAllByRole("textbox", { name: S.labelAriaLabel })).toHaveLength(1);
  });

  it("re-issues a list load a mutation superseded mid-flight (I3)", async () => {
    // seq.abort() DISCARDS an outstanding load rather than reconciling it, so a
    // mutation landing before the load resolves used to throw the rows away
    // permanently — the panel has no other refetch trigger.
    const existing = makeOuttake({ id: "a", label: "Alpha" });
    const created = makeOuttake({ id: "new", label: "New" });
    let resolveMountLoad!: (rows: OuttakeRow[]) => void;
    vi.mocked(api.outtakes.list)
      .mockReturnValueOnce(
        new Promise<OuttakeRow[]>((res) => {
          resolveMountLoad = res;
        }),
      )
      .mockResolvedValue([created, existing]);
    vi.mocked(api.outtakes.create).mockResolvedValue(created);
    const user = userEvent.setup();
    render(<OuttakesPanel {...defaultProps} />);
    await waitFor(() => expect(api.outtakes.list).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: S.newBlank }));
    await user.type(screen.getByRole("textbox", { name: S.newPlaceholder }), "New body");
    await user.click(screen.getByRole("button", { name: S.save }));
    await waitFor(() => expect(screen.getByDisplayValue("New")).toBeInTheDocument());

    // The superseded mount GET resolves and is (correctly) discarded; the
    // re-issued load is what puts the server's rows back on screen.
    resolveMountLoad([existing]);
    await waitFor(() => expect(screen.getByDisplayValue("Alpha")).toBeInTheDocument());
    expect(screen.getByDisplayValue("New")).toBeInTheDocument();
  });

  it("does not refetch when no load was outstanding", async () => {
    // The re-issue above is a race repair, not a post-mutation reload — the
    // optimistic prepend is still what surfaces the row in the common case.
    vi.mocked(api.outtakes.list).mockResolvedValue([]);
    vi.mocked(api.outtakes.create).mockResolvedValue(makeOuttake({ id: "new", label: "New" }));
    const user = userEvent.setup();
    render(<OuttakesPanel {...defaultProps} />);
    await waitFor(() => expect(api.outtakes.list).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: S.newBlank }));
    await user.type(screen.getByRole("textbox", { name: S.newPlaceholder }), "New body");
    await user.click(screen.getByRole("button", { name: S.save }));
    await waitFor(() => expect(screen.getByDisplayValue("New")).toBeInTheDocument());
    expect(api.outtakes.list).toHaveBeenCalledTimes(1);
  });

  it("recovers from a 2xx BAD_JSON create by refetching, keeping the draft (S3)", async () => {
    const created = makeOuttake({ id: "new", label: "New" });
    vi.mocked(api.outtakes.list).mockResolvedValueOnce([]).mockResolvedValue([created]);
    vi.mocked(api.outtakes.create).mockRejectedValue(
      new ApiRequestError("bad body", 200, "BAD_JSON"),
    );
    const user = userEvent.setup();
    render(<OuttakesPanel {...defaultProps} />);
    await waitFor(() => expect(api.outtakes.list).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: S.newBlank }));
    await user.type(screen.getByRole("textbox", { name: S.newPlaceholder }), "New body");
    await user.click(screen.getByRole("button", { name: S.save }));

    // The authoritative list is refetched so the row (which did land) appears...
    await waitFor(() => expect(screen.getByDisplayValue("New")).toBeInTheDocument());
    // ...and the notice survives that refetch's own setError(null), so the user
    // is told the outcome was ambiguous rather than silently repaired.
    expect(screen.getByText(STRINGS.error.possiblyCommitted)).toBeInTheDocument();
    // The draft is the writer's TEXT, not a label — never discard it on an
    // outcome the server may never have received.
    expect(screen.getByRole("textbox", { name: S.newPlaceholder })).toHaveValue("New body");
  });

  it("does not revert a rename the server may have committed (S3)", async () => {
    vi.mocked(api.outtakes.list)
      .mockResolvedValueOnce([makeOuttake({ id: "a", label: "Before" })])
      .mockResolvedValue([makeOuttake({ id: "a", label: "After" })]);
    vi.mocked(api.outtakes.updateLabel).mockRejectedValue(
      new ApiRequestError("bad body", 200, "BAD_JSON"),
    );
    const user = userEvent.setup();
    render(<OuttakesPanel {...defaultProps} />);
    const input = await screen.findByDisplayValue("Before");

    await user.clear(input);
    await user.type(input, "After");
    await user.tab();

    // The authoritative list is refetched...
    await waitFor(() => expect(api.outtakes.list).toHaveBeenCalledTimes(2));
    // ...the field keeps the attempted value (the one the server most likely
    // holds) instead of asserting the old label as truth...
    expect(screen.getByDisplayValue("After")).toBeInTheDocument();
    // ...and the ambiguity is surfaced rather than repaired silently.
    expect(screen.getByText(STRINGS.error.possiblyCommitted)).toBeInTheDocument();
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
    await waitFor(() => expect(api.outtakes.delete).toHaveBeenCalledWith("a"));
    await user.click(screen.getAllByRole("button", { name: S.delete })[1]!);
    await user.click(screen.getByRole("button", { name: STRINGS.delete.confirmButton }));
    await waitFor(() => expect(api.outtakes.delete).toHaveBeenCalledWith("b"));

    resolveA();
    resolveB();
    await waitFor(() => expect(screen.queryByDisplayValue("Alpha")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByDisplayValue("Beta")).not.toBeInTheDocument());
  });
});
