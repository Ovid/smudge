import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OuttakeCard } from "../OuttakeCard";
import { api, ApiRequestError } from "../../api/client";
import { STRINGS } from "../../strings";
import { expectConsole } from "../../__tests__/expectConsole";
import { LABEL_MAX_UNITS, OUTTAKE_ERROR_CODES } from "@smudge/shared";
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
        updateLabel: vi.fn(),
        delete: vi.fn(),
      },
    },
    ApiRequestError,
  };
});

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
  onPossiblyCommitted: vi.fn(),
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

  it("clears a no-op whitespace-only label edit off the field (S5)", async () => {
    // "   " normalizes to null, which equals the committed value, so no PATCH
    // fires. The field must not keep rendering a value that was never sent and
    // is not on the server.
    const user = userEvent.setup();
    render(<OuttakeCard outtake={makeOuttake({ label: null })} {...defaultProps} />);
    const input = screen.getByRole("textbox", { name: S.labelAriaLabel });

    await user.type(input, "   ");
    await user.tab();

    expect(api.outtakes.updateLabel).not.toHaveBeenCalled();
    expect(input).toHaveValue("");
  });

  it("shows the untitled placeholder when the label is null", () => {
    render(<OuttakeCard outtake={makeOuttake({ label: null })} {...defaultProps} />);
    expect(screen.getByPlaceholderText(S.untitled)).toBeInTheDocument();
  });

  it("says a corrupt outtake is corrupt rather than showing it empty (S7)", () => {
    // The server degrades unparseable content to a placeholder empty doc so the
    // row still lists and stays deletable. On a table with no deleted_at, no
    // trash and no 30-day window, an empty-LOOKING card is an invitation to
    // destroy the only remaining copy.
    render(
      <OuttakeCard
        outtake={makeOuttake({ content: { type: "doc", content: [] }, content_corrupt: true })}
        {...defaultProps}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(S.corruptContent);
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
    // S4: confirm the copy landed — the signal the silent failure had nothing
    // to contrast with.
    expect(await screen.findByRole("status")).toHaveTextContent(S.copied);
  });

  it("surfaces a failed copy instead of looking like it worked (S4)", async () => {
    // The shipping configuration IS the failing one: off a secure context
    // navigator.clipboard is undefined and the property access throws, and
    // CLAUDE.md's deployment target is plain HTTP on port 3456. The writer then
    // pastes whatever was already on the clipboard into the manuscript.
    const user = userEvent.setup();
    const onError = vi.fn();
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    render(<OuttakeCard outtake={makeOuttake()} {...defaultProps} onError={onError} />);

    await user.click(screen.getByRole("button", { name: S.copy }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith(S.copyFailed));
    expect(screen.getByRole("status")).not.toHaveTextContent(S.copied);
  });

  it("stays retryable after a possibly-committed rename is reconciled (S5)", async () => {
    // A 2xx BAD_JSON rename leaves the field showing what the writer typed and
    // asks the panel to refetch. The refetch is authoritative, so the card's row
    // prop then carries the server's value.
    //
    // The last-committed value used to be a ref seeded once at mount, and cards
    // are keyed by id so the replacement row never remounted to re-seed it.
    // Putting the label back to its original therefore hit the "nothing to send"
    // short-circuit against a stale ref: no PATCH, no banner, no way to retry.
    const user = userEvent.setup();
    const onPossiblyCommitted = vi.fn();
    vi.mocked(api.outtakes.updateLabel).mockRejectedValue(
      new ApiRequestError("bad body", 200, "BAD_JSON"),
    );
    const { rerender } = render(
      <OuttakeCard
        outtake={makeOuttake({ label: "Original" })}
        {...defaultProps}
        onPossiblyCommitted={onPossiblyCommitted}
      />,
    );

    const input = screen.getByRole("textbox", { name: S.labelAriaLabel });
    await user.clear(input);
    await user.type(input, "Renamed");
    await user.tab();
    await waitFor(() => expect(onPossiblyCommitted).toHaveBeenCalled());

    // The panel's recovery refetch: the server did commit "Renamed".
    rerender(<OuttakeCard outtake={makeOuttake({ label: "Renamed" })} {...defaultProps} />);
    vi.mocked(api.outtakes.updateLabel).mockResolvedValue(makeOuttake({ label: "Original" }));

    // The writer changes their mind and puts the original back.
    const input2 = screen.getByRole("textbox", { name: S.labelAriaLabel });
    await user.clear(input2);
    await user.type(input2, "Original");
    await user.tab();

    await waitFor(() =>
      expect(api.outtakes.updateLabel).toHaveBeenLastCalledWith("ot-1", { label: "Original" }),
    );
  });

  it("labels the preview disclosure with its state and target (S13)", async () => {
    const user = userEvent.setup();
    const long = makeOuttake({
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "word ".repeat(60) }] }],
      },
    });
    render(<OuttakeCard outtake={long} {...defaultProps} />);

    const toggle = screen.getByRole("button", { name: S.showMore });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // The control must name what it expands, not just that it does.
    const previewId = toggle.getAttribute("aria-controls");
    expect(previewId).toBeTruthy();
    expect(document.getElementById(previewId!)).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.getByRole("button", { name: S.showLess })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("does not log when a clipboard write fails", async () => {
    // S2 (agentic-review 2026-08-04): the spies MUST be installed before the
    // action. expectConsole() calls vi.spyOn at call time, so installing after
    // the click left spy.mock.calls necessarily empty and .silent() passed
    // unconditionally — on the tests that encode the zero-warnings rule for this
    // surface. Same hoist as useProjectEditor.test.ts and EditorInsertGuards.
    const warn = expectConsole("warn");
    const error = expectConsole("error");
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<OuttakeCard outtake={makeOuttake()} {...defaultProps} />);
    await user.click(screen.getByRole("button", { name: S.copy }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    warn.silent();
    error.silent();
  });

  // I3 (agentic-review 2026-08-04): every outtake mutation used to be owned by
  // an op that aborts on unmount — and this card unmounts on an ORDINARY click.
  // ReferencePanel renders `{activeTab?.panel ?? null}` and the panel renders
  // only while open, so clicking the Images tab or pressing Ctrl+. unmounts the
  // whole list; typing in the filter box unmounts a single card mid-rename
  // (`visible` filters on the row's OLD label). A blur->PATCH started in the same
  // gesture (mousedown -> focusout -> mouseup -> click) was cancelled, and the
  // post-await `if (signal.aborted) return` returned SILENTLY: no banner, no
  // retry path, lastCommittedRef un-advanced. The write may already have
  // committed — the same reasoning this file's own S4 comment and EditorPage's
  // captureInFlightRef latch are built on.
  it.each([
    [
      "a rename",
      async (user: ReturnType<typeof userEvent.setup>) => {
        const input = screen.getByRole("textbox", { name: S.labelAriaLabel });
        await user.clear(input);
        await user.type(input, "Renamed");
        await user.tab();
        return vi.mocked(api.outtakes.updateLabel);
      },
    ],
    [
      "a delete",
      async (user: ReturnType<typeof userEvent.setup>) => {
        await user.click(screen.getByRole("button", { name: S.delete }));
        await user.click(screen.getByRole("button", { name: STRINGS.delete.confirmButton }));
        return vi.mocked(api.outtakes.delete);
      },
    ],
  ])("unmounting the card does not cancel %s already in flight (I3)", async (_label, act) => {
    const user = userEvent.setup();
    // Never settles: the request is still out when the card goes away.
    vi.mocked(api.outtakes.updateLabel).mockReturnValue(new Promise(() => {}));
    vi.mocked(api.outtakes.delete).mockReturnValue(new Promise(() => {}));
    const { unmount } = render(<OuttakeCard outtake={makeOuttake()} {...defaultProps} />);

    const mock = await act(user);
    await waitFor(() => expect(mock).toHaveBeenCalled());
    unmount();

    // Whatever signal the call carries (if any) must survive the unmount.
    const signal = mock.mock.calls[0]!.find((a) => a instanceof AbortSignal);
    expect(signal?.aborted ?? false).toBe(false);
  });

  it("opens a confirm dialog and deletes via the API, then reconciles on confirm", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    render(<OuttakeCard outtake={makeOuttake()} {...defaultProps} onDeleted={onDeleted} />);
    await user.click(screen.getByRole("button", { name: S.delete }));
    // Dialog is shown
    expect(screen.getByText(S.confirmDeleteTitle)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: STRINGS.delete.confirmButton }));
    expect(api.outtakes.delete).toHaveBeenCalledWith("ot-1");
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("ot-1"));
  });

  it("surfaces an error and does not reconcile when the delete fails", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    const onError = vi.fn();
    vi.mocked(api.outtakes.delete).mockRejectedValue(new Error("boom"));
    render(
      <OuttakeCard
        outtake={makeOuttake()}
        {...defaultProps}
        onDeleted={onDeleted}
        onError={onError}
      />,
    );
    await user.click(screen.getByRole("button", { name: S.delete }));
    await user.click(screen.getByRole("button", { name: STRINGS.delete.confirmButton }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(STRINGS.error.deleteOuttakeFailed));
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("refuses a second delete confirm, and says so (S4, S14)", async () => {
    // Without the latch a second confirm fires a second DELETE against a row the
    // first may already have removed, 404ing under a banner claiming the delete
    // failed. EditorPage latches the identical case with captureInFlightRef.
    //
    // S14 (agentic-review 2026-08-04): the latch used to refuse in SILENCE, and
    // this test asserted that silence as correct. onConfirm closes the dialog
    // but the card stays until onDeleted, so a second Delete -> Confirm is an
    // ordinary gesture on a destructive control that appeared to do nothing.
    // The captureInFlightRef twin this comment cites has always announced.
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    const onError = vi.fn();
    let resolveDelete!: () => void;
    vi.mocked(api.outtakes.delete).mockReturnValue(
      new Promise<undefined>((res) => {
        resolveDelete = () => res(undefined);
      }),
    );
    render(
      <OuttakeCard
        outtake={makeOuttake()}
        {...defaultProps}
        onDeleted={onDeleted}
        onError={onError}
      />,
    );

    await user.click(screen.getByRole("button", { name: S.delete }));
    await user.click(screen.getByRole("button", { name: STRINGS.delete.confirmButton }));
    await waitFor(() => expect(api.outtakes.delete).toHaveBeenCalledTimes(1));

    // Second pass through the dialog while the first DELETE is still out.
    await user.click(screen.getByRole("button", { name: S.delete }));
    await user.click(screen.getByRole("button", { name: STRINGS.delete.confirmButton }));
    expect(api.outtakes.delete).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(S.deleteInFlight);

    resolveDelete();
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("ot-1"));
    // The refusal notice is the ONLY thing on the banner — no failure copy.
    expect(onError).toHaveBeenCalledTimes(1);
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
    expect(api.outtakes.updateLabel).toHaveBeenCalledWith("ot-1", { label: "New label" });
  });

  it("commits the label on Enter", async () => {
    const user = userEvent.setup();
    render(<OuttakeCard outtake={makeOuttake()} {...defaultProps} />);
    const input = screen.getByDisplayValue("A cut scene");
    await user.clear(input);
    await user.type(input, "Renamed{Enter}");
    expect(api.outtakes.updateLabel).toHaveBeenCalledWith("ot-1", { label: "Renamed" });
  });

  it("passes null when the label is cleared to empty", async () => {
    const user = userEvent.setup();
    render(<OuttakeCard outtake={makeOuttake()} {...defaultProps} />);
    const input = screen.getByDisplayValue("A cut scene");
    await user.clear(input);
    await user.tab();
    expect(api.outtakes.updateLabel).toHaveBeenCalledWith("ot-1", { label: null });
  });

  it("does not rename when the label is unchanged", async () => {
    const user = userEvent.setup();
    render(<OuttakeCard outtake={makeOuttake()} {...defaultProps} />);
    const input = screen.getByDisplayValue("A cut scene");
    await user.click(input);
    await user.tab();
    expect(api.outtakes.updateLabel).not.toHaveBeenCalled();
  });

  it("re-seeds the input from the server-sanitized label on success (S3)", async () => {
    const user = userEvent.setup();
    // The server strips a zero-width space the client typed; the input must
    // show the server's sanitized value, not the un-sanitized client draft.
    vi.mocked(api.outtakes.updateLabel).mockResolvedValue(makeOuttake({ label: "Clean" }));
    render(<OuttakeCard outtake={makeOuttake()} {...defaultProps} />);
    const input = screen.getByDisplayValue("A cut scene");
    await user.clear(input);
    await user.type(input, "Clean​");
    await user.tab();
    await waitFor(() => expect(screen.getByDisplayValue("Clean")).toBeInTheDocument());
  });

  it("does not clobber keystrokes typed while a failed rename is in flight (S5)", async () => {
    const user = userEvent.setup();
    let rejectUpdate!: (err: unknown) => void;
    vi.mocked(api.outtakes.updateLabel).mockReturnValue(
      new Promise<OuttakeRow>((_res, rej) => {
        rejectUpdate = rej;
      }),
    );
    render(<OuttakeCard outtake={makeOuttake()} {...defaultProps} />);
    const input = screen.getByDisplayValue("A cut scene");
    await user.clear(input);
    await user.type(input, "First");
    await user.tab(); // commit fires, PATCH pending
    await waitFor(() => expect(api.outtakes.updateLabel).toHaveBeenCalled());

    // User refocuses and keeps typing while the request is still in flight.
    await user.click(input);
    await user.type(input, "-edited");
    expect(screen.getByDisplayValue("First-edited")).toBeInTheDocument();

    // The rename fails: the revert must NOT overwrite the newer keystrokes.
    rejectUpdate(new Error("boom"));
    await waitFor(() =>
      expect(defaultProps.onError).toHaveBeenCalledWith(STRINGS.error.updateOuttakeFailed),
    );
    expect(screen.getByDisplayValue("First-edited")).toBeInTheDocument();
  });

  // Two halves of the same failure (S5): nothing stopped an over-long label
  // being typed, and the resulting 400 mapped to generic copy WHILE commitLabel
  // reverted the field — so the writer's text vanished with no cause named and
  // an identical retry reproduced it.
  //
  // S8 (agentic-review 2026-08-04): the fix keyed on the STATUS, and this test
  // pinned that — a bare VALIDATION_ERROR 400 asserting label-cap copy. But the
  // cap is not the only 400 the PATCH emits (validateUuidParam throws one before
  // the schema runs, and .strict() is a second producer), so the copy named a
  // cause that was not the cause while still wiping the field. Only the
  // server's discriminating code may claim the cap.
  it.each([
    [OUTTAKE_ERROR_CODES.LABEL_TOO_LONG, STRINGS.error.updateOuttakeLabelRejected(LABEL_MAX_UNITS)],
    ["VALIDATION_ERROR", STRINGS.error.updateOuttakeFailed],
  ])("names the cause of a 400 with code %s", async (code, expected) => {
    const user = userEvent.setup();
    const onError = vi.fn();
    vi.mocked(api.outtakes.updateLabel).mockRejectedValue(new ApiRequestError("nope", 400, code));
    render(<OuttakeCard outtake={makeOuttake()} {...defaultProps} onError={onError} />);

    const input = screen.getByDisplayValue("A cut scene");
    expect(input).toHaveAttribute("maxLength", String(LABEL_MAX_UNITS));

    await user.clear(input);
    await user.type(input, "Renamed");
    await user.tab();

    await waitFor(() => expect(onError).toHaveBeenCalledWith(expected));
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
