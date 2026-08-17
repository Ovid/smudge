import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { EditorPage } from "../pages/EditorPage";
import { api, ApiRequestError } from "../api/client";
import { STRINGS } from "../strings";

// Shared controls for the mocked editor. vi.hoisted makes them available to
// both the vi.mock factory (hoisted above imports) and the test body.
const { mockControls, insertContentSpy } = vi.hoisted(() => ({
  mockControls: {
    editable: true,
    selection: { from: 0, to: 0 } as { from: number; to: number },
    sliceJson: [] as unknown[],
  },
  insertContentSpy: vi.fn(),
}));

// A lightweight Editor stand-in so we can drive isEditable, the selection, and
// the sliced-content JSON directly — the real TipTap editor cannot have its
// selection set from a jsdom test. It reports itself ready via onEditorReady
// (so the toolbar renders) and populates editorRef with a minimal handle.
vi.mock("../components/Editor", async () => {
  const React = await import("react");
  function makeChainable(): Record<string, unknown> {
    const chainable: Record<string, unknown> = new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "run") return () => true;
          if (prop === "insertContent")
            return (arg: unknown) => {
              insertContentSpy(arg);
              return chainable;
            };
          return () => chainable;
        },
      },
    );
    return chainable;
  }
  function makeFakeEditor() {
    const chainable = makeChainable();
    return {
      get isEditable() {
        return mockControls.editable;
      },
      isActive: () => false,
      chain: () => chainable,
      setEditable: (v: boolean) => {
        mockControls.editable = v;
      },
      state: {
        // I2 (agentic-review 2026-08-04): the capture path may only reach the
        // selection through `selection.content()` (includeParents = true, always
        // block-level). `state.doc.slice(from, to)` is deliberately NOT exposed
        // here: it returns INLINE content for an intra-paragraph selection, which
        // persisted a doc ProseMirror rejects. Reverting to it fails every test
        // in this file rather than passing quietly — outtakeCaptureSlice.test.ts
        // holds the real-schema proof of why.
        get selection() {
          return {
            ...mockControls.selection,
            content: () => ({ content: { toJSON: () => mockControls.sliceJson } }),
          };
        },
      },
    };
  }
  function Editor(props: {
    editorRef?: { current: unknown };
    onEditorReady?: (e: unknown) => void;
  }) {
    const { editorRef, onEditorReady } = props;
    React.useEffect(() => {
      const fake = makeFakeEditor();
      if (editorRef) {
        editorRef.current = {
          editor: fake,
          insertImage: () => {},
          markClean: () => {},
          flushSave: () => Promise.resolve(true),
          setEditable: (v: boolean) => fake.setEditable(v),
        };
      }
      onEditorReady?.(fake);
      // The real Editor clears the handle on unmount (Editor.tsx:461). The
      // mock must too, or EditorPage keeps a live toolbarEditor for a view in
      // which no editor is mounted — and guards that key off it silently pass.
      return () => onEditorReady?.(null);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return React.createElement("div", { "data-testid": "mock-editor" }, "editor");
  }
  return { Editor };
});

vi.mock("../hooks/useContentCache", () => ({
  getCachedContent: vi.fn().mockReturnValue(null),
  setCachedContent: vi.fn().mockReturnValue(true),
  clearCachedContent: vi.fn(),
  clearAllCachedContent: vi.fn(),
}));

vi.mock("../api/client", () => ({
  ApiRequestError: class ApiRequestError extends Error {
    constructor(
      message: string,
      public readonly status: number,
      public readonly code?: string,
    ) {
      super(message);
      this.name = "ApiRequestError";
    }
  },
  api: {
    projects: {
      get: vi.fn(),
      velocity: vi.fn().mockResolvedValue({
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
        today: "2026-07-19",
      }),
      dashboard: vi.fn().mockResolvedValue({ chapters: [] }),
    },
    chapters: { get: vi.fn() },
    images: { list: vi.fn().mockResolvedValue([]) },
    chapterStatuses: { list: vi.fn().mockResolvedValue([]) },
    snapshots: { list: vi.fn().mockResolvedValue([]) },
    outtakes: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      delete: vi.fn(),
      updateLabel: vi.fn(),
    },
  },
}));

const mockProject = {
  id: "proj-1",
  slug: "test-project",
  title: "Test Project",
  mode: "fiction" as const,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
  target_word_count: null,
  target_deadline: null,
  author_name: null,
  chapters: [
    {
      id: "ch-1",
      project_id: "proj-1",
      title: "Chapter One",
      content: { type: "doc", content: [{ type: "paragraph" }] },
      sort_order: 0,
      word_count: 10,
      status: "outline" as const,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      deleted_at: null,
    },
  ],
};
const mockChapter = mockProject.chapters[0]!;

function outtake(overrides: Partial<import("@smudge/shared").OuttakeRow> = {}) {
  return {
    id: "ot-1",
    project_id: "proj-1",
    label: "Cut bit",
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "cut text" }] }],
    },
    created_at: "2026-07-19T00:00:00Z",
    updated_at: "2026-07-19T00:00:00Z",
    ...overrides,
  } as import("@smudge/shared").OuttakeRow;
}

function renderEditorPage() {
  return render(
    <MemoryRouter initialEntries={["/projects/test-project"]}>
      <Routes>
        <Route path="/projects/:slug" element={<EditorPage />} />
        {/* eslint-disable-next-line no-restricted-syntax -- test fixture (not user-facing) */}
        <Route path="/" element={<div>Home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

// Same page, plus an in-route button that navigates to a DIFFERENT project
// slug without unmounting EditorPage — the A→B switch the drift guard exists
// for. Sits inside the :slug route deliberately: that is what makes the
// navigation a param change rather than a remount.
function renderEditorPageWithNav() {
  function NavToB() {
    const navigate = useNavigate();
    return (
      // eslint-disable-next-line no-restricted-syntax -- test fixture (not user-facing)
      <button type="button" data-testid="nav-to-b" onClick={() => navigate("/projects/project-b")}>
        go
      </button>
    );
  }
  return render(
    <MemoryRouter initialEntries={["/projects/test-project"]}>
      <Routes>
        <Route
          path="/projects/:slug"
          element={
            <>
              <EditorPage />
              <NavToB />
            </>
          }
        />
        {/* eslint-disable-next-line no-restricted-syntax -- test fixture (not user-facing) */}
        <Route path="/" element={<div>Home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

// Opens the reference panel and selects the Outtakes tab.
async function openOuttakesTab(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.getByTestId("mock-editor")).toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: STRINGS.referencePanel.toggleTooltip }));
  await user.click(await screen.findByRole("tab", { name: STRINGS.outtakes.tab }));
}

beforeEach(() => {
  // PreviewMode builds an IntersectionObserver for its TOC scroll tracking;
  // jsdom has none, and the resulting throw unmounts the whole tree. Same stub
  // as EditorPageFeatures.test.tsx.
  global.IntersectionObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));
  vi.clearAllMocks();
  // Reference-panel open/active-tab state is localStorage-backed; clear it so a
  // prior test that opened the Outtakes tab does not make the next test's
  // "click toggle to open" instead toggle an already-open panel shut.
  localStorage.clear();
  mockControls.editable = true;
  mockControls.selection = { from: 0, to: 0 };
  mockControls.sliceJson = [];
  insertContentSpy.mockReset();
  vi.mocked(api.projects.get).mockResolvedValue(mockProject);
  vi.mocked(api.chapters.get).mockResolvedValue(mockChapter);
  vi.mocked(api.outtakes.list).mockResolvedValue([]);
});

afterEach(() => cleanup());

describe("E1: Outtakes reference-panel tab", () => {
  it("renders both the Images and Outtakes tabs and shows the panel when selected", async () => {
    const user = userEvent.setup();
    renderEditorPage();
    await openOuttakesTab(user);

    expect(screen.getByRole("tab", { name: STRINGS.referencePanel.imagesTab })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: STRINGS.outtakes.tab })).toBeInTheDocument();
    // The empty-state copy is unique to the OuttakesPanel.
    expect(await screen.findByText(STRINGS.outtakes.empty)).toBeInTheDocument();
  });

  // I6 (agentic-review 2026-08-05): ReferencePanel renders only the active tab
  // and EditorMainContent renders the panel only while open, so an unsaved
  // blank-note draft used to die on an ordinary Ctrl+. or a single arrow key
  // in the tablist — no confirm, no warning, and no server copy, since the POST
  // never fired. This branch is what put them in conflict: it added the second
  // tab and the arrow-key handler that switches on keydown.
  it("keeps an unsaved blank-note draft across a tab switch (I6)", async () => {
    const user = userEvent.setup();
    renderEditorPage();
    await openOuttakesTab(user);
    await screen.findByText(STRINGS.outtakes.empty);

    await user.click(screen.getByRole("button", { name: STRINGS.outtakes.newBlank }));
    await user.type(
      screen.getByLabelText(STRINGS.outtakes.newPlaceholder),
      "four hundred words of it",
    );

    await user.click(screen.getByRole("tab", { name: STRINGS.referencePanel.imagesTab }));
    expect(screen.queryByLabelText(STRINGS.outtakes.newPlaceholder)).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: STRINGS.outtakes.tab }));
    expect(await screen.findByLabelText(STRINGS.outtakes.newPlaceholder)).toHaveValue(
      "four hundred words of it",
    );
  });
});

describe("F1: insert outtake at cursor", () => {
  it("inserts the block ARRAY (content.content), not the doc node", async () => {
    const user = userEvent.setup();
    const blocks = [{ type: "paragraph", content: [{ type: "text", text: "cut text" }] }];
    vi.mocked(api.outtakes.list).mockResolvedValue([
      outtake({ content: { type: "doc", content: blocks } }),
    ]);

    renderEditorPage();
    await openOuttakesTab(user);

    await user.click(await screen.findByRole("button", { name: STRINGS.outtakes.insert }));

    expect(insertContentSpy).toHaveBeenCalledTimes(1);
    expect(insertContentSpy).toHaveBeenCalledWith(blocks);
  });

  it("no-ops when the editor is not editable (content/save guard axis)", async () => {
    const user = userEvent.setup();
    vi.mocked(api.outtakes.list).mockResolvedValue([outtake()]);

    renderEditorPage();
    await openOuttakesTab(user);

    // toolbarEditor.isEditable mirrors the machine's editable/lock; false means
    // a mutation is in flight or the persistent lock is up.
    mockControls.editable = false;
    await user.click(await screen.findByRole("button", { name: STRINGS.outtakes.insert }));

    expect(insertContentSpy).not.toHaveBeenCalled();
    // I5: the click must not vanish silently — say why it was refused, as
    // onInsertImage already does for the same "intentionally ignored" case.
    expect(await screen.findByText(STRINGS.editor.mutationBusy)).toBeInTheDocument();
  });

  it("S3/S4: refuses with 'switch to the editor', not 'please wait', when no editor is mounted", async () => {
    // Preview / dashboard / trash view unmounts the Editor (onEditorReady(null))
    // while the reference panel keeps rendering — and keeps its Insert buttons
    // clickable. The old guard folded this into the busy arm and told the user
    // "Another operation is in progress — please wait": nothing was in
    // progress, and waiting never cleared it. Pre-I2 it was a silent no-op.
    const user = userEvent.setup();
    vi.mocked(api.outtakes.list).mockResolvedValue([outtake()]);
    renderEditorPage();
    await openOuttakesTab(user);
    await screen.findByRole("button", { name: STRINGS.outtakes.insert });

    // Leave the editor view; the panel (and its Insert button) stay on screen,
    // because the ReferencePanel is rendered outside the view-mode branch
    // (EditorMainContent) while the editor itself is not.
    await user.click(screen.getByRole("button", { name: STRINGS.nav.preview }));
    await waitFor(() => expect(screen.queryByTestId("mock-editor")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: STRINGS.outtakes.insert }));

    expect(insertContentSpy).not.toHaveBeenCalled();
    expect(await screen.findByText(STRINGS.editor.insertNeedsEditor)).toBeInTheDocument();
    expect(screen.queryByText(STRINGS.editor.mutationBusy)).not.toBeInTheDocument();
  });

  it("refuses to insert an outtake whose content fails the doc schema (S11)", async () => {
    // useSnapshotState gained exactly this gate on this branch; the outtake
    // insert path did not. Not an XSS vector — but over-depth content from a
    // hand-edited row or a restored backup gets written into a REAL chapter and
    // then fails that chapter's auto-save Zod validation permanently: the
    // terminal "Unable to save" lock, on text the writer just inserted.
    const user = userEvent.setup();
    let deep: Record<string, unknown> = { type: "text", text: "x" };
    for (let i = 0; i < 100; i++) deep = { type: "blockquote", content: [deep] };
    vi.mocked(api.outtakes.list).mockResolvedValue([
      outtake({ id: "ot-deep", content: { type: "doc", content: [deep] } }),
    ]);

    renderEditorPage();
    await openOuttakesTab(user);
    await user.click(await screen.findByRole("button", { name: STRINGS.outtakes.insert }));

    expect(insertContentSpy).not.toHaveBeenCalled();
    expect(await screen.findByText(STRINGS.outtakes.insertFailedCorrupt)).toBeInTheDocument();
  });

  it("says why a corrupt outtake can't be inserted rather than doing nothing (S1)", async () => {
    // The server's degraded read substitutes a VALID empty doc for unreadable
    // content, so the schema gate above passes and the emptiness short-circuit
    // returned bare. The comment defending that silence ("the visibly empty
    // card already says so") is false for this row: the card renders a
    // corruption alert, not an empty preview.
    const user = userEvent.setup();
    vi.mocked(api.outtakes.list).mockResolvedValue([
      outtake({ content: { type: "doc", content: [] }, content_corrupt: true }),
    ]);

    renderEditorPage();
    await openOuttakesTab(user);
    await user.click(await screen.findByRole("button", { name: STRINGS.outtakes.insert }));

    expect(insertContentSpy).not.toHaveBeenCalled();
    expect(await screen.findByText(STRINGS.outtakes.corruptNoText)).toBeInTheDocument();
  });

  it("no-ops when the outtake has no blocks (empty doc)", async () => {
    const user = userEvent.setup();
    vi.mocked(api.outtakes.list).mockResolvedValue([
      outtake({ content: { type: "doc", content: [] } }),
    ]);

    renderEditorPage();
    await openOuttakesTab(user);

    await user.click(await screen.findByRole("button", { name: STRINGS.outtakes.insert }));

    expect(insertContentSpy).not.toHaveBeenCalled();
  });
});

describe("F2: send selection to outtakes (non-destructive)", () => {
  it("POSTs the stripped selection with a From-chapter label and refreshes the panel", async () => {
    const user = userEvent.setup();
    const paragraph = { type: "paragraph", content: [{ type: "text", text: "grabbed" }] };
    // Selection slice carries a paragraph AND an image; the image must be stripped.
    mockControls.selection = { from: 1, to: 8 };
    mockControls.sliceJson = [paragraph, { type: "image", attrs: { src: "/api/images/x" } }];

    const created = outtake({
      id: "ot-new",
      label: "From Chapter One",
      content: { type: "doc", content: [paragraph] },
    });
    vi.mocked(api.outtakes.create).mockResolvedValue(created);
    // Panel mounts empty; the created row is prepended (I1), not reloaded.
    vi.mocked(api.outtakes.list).mockResolvedValue([]);

    renderEditorPage();
    await openOuttakesTab(user);
    expect(await screen.findByText(STRINGS.outtakes.empty)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: STRINGS.outtakes.newFromSelection }));

    await waitFor(() => expect(api.outtakes.create).toHaveBeenCalledTimes(1));
    expect(api.outtakes.create).toHaveBeenCalledWith(
      "proj-1",
      {
        content: { type: "doc", content: [paragraph] },
        label: `${STRINGS.outtakes.fromChapterPrefix}Chapter One`,
      },
      expect.anything(),
    );

    // End-to-end: the created row is prepended to the panel and appears.
    expect(await screen.findByText("grabbed")).toBeInTheDocument();
  });

  it("truncates the auto-label so a near-max chapter title cannot exceed the 500-char cap", async () => {
    const user = userEvent.setup();
    // A chapter title at the 500-char cap: "From " + title would be 505 and the
    // schema rejects (does not truncate) above 500, so an untruncated label 400s.
    const longTitle = "x".repeat(500);
    const longChapter = { ...mockChapter, title: longTitle };
    vi.mocked(api.projects.get).mockResolvedValue({ ...mockProject, chapters: [longChapter] });
    vi.mocked(api.chapters.get).mockResolvedValue(longChapter);
    mockControls.selection = { from: 1, to: 8 };
    mockControls.sliceJson = [{ type: "paragraph", content: [{ type: "text", text: "grabbed" }] }];
    vi.mocked(api.outtakes.create).mockResolvedValue(outtake({ id: "ot-new" }));

    renderEditorPage();
    await openOuttakesTab(user);
    await user.click(screen.getByRole("button", { name: STRINGS.outtakes.newFromSelection }));

    await waitFor(() => expect(api.outtakes.create).toHaveBeenCalledTimes(1));
    const body = vi.mocked(api.outtakes.create).mock.calls[0]![1];
    expect(body.label).not.toBeNull();
    expect(body.label!.length).toBeLessThanOrEqual(500);
    expect(body.label!.startsWith(STRINGS.outtakes.fromChapterPrefix)).toBe(true);
  });

  it("announces a successful capture with the panel closed (S3)", async () => {
    // The toolbar button lives OUTSIDE the reference panel, so capturing with
    // the panel shut is the ordinary case — and there the prepended row (the
    // capture's only feedback) has no mounted consumer. All four refusal arms
    // announce; success must not be the silent one. No openOuttakesTab here:
    // the closed panel IS the scenario.
    const user = userEvent.setup();
    mockControls.selection = { from: 1, to: 8 };
    mockControls.sliceJson = [{ type: "paragraph", content: [{ type: "text", text: "grabbed" }] }];
    vi.mocked(api.outtakes.create).mockResolvedValue(outtake({ id: "ot-new" }));

    renderEditorPage();
    await user.click(
      await screen.findByRole("button", { name: STRINGS.outtakes.newFromSelection }),
    );

    await waitFor(() => expect(api.outtakes.create).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(STRINGS.outtakes.capturedHidden)).toBeInTheDocument();
  });

  it("drops the open-the-tab hint when the drawer is already showing", async () => {
    // The hint is instruction, not decoration: told to open a tab they are
    // looking at, the writer reads the announcement as a failure and hunts for
    // a panel that is already in front of them.
    const user = userEvent.setup();
    mockControls.selection = { from: 1, to: 8 };
    mockControls.sliceJson = [{ type: "paragraph", content: [{ type: "text", text: "grabbed" }] }];
    vi.mocked(api.outtakes.create).mockResolvedValue(outtake({ id: "ot-new" }));

    renderEditorPage();
    await openOuttakesTab(user);
    await user.click(screen.getByRole("button", { name: STRINGS.outtakes.newFromSelection }));

    await waitFor(() => expect(api.outtakes.create).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(STRINGS.outtakes.captured)).toBeInTheDocument();
    expect(screen.queryByText(STRINGS.outtakes.capturedHidden)).not.toBeInTheDocument();
  });

  it("no-ops on an empty selection (from === to)", async () => {
    const user = userEvent.setup();
    mockControls.selection = { from: 3, to: 3 };

    renderEditorPage();
    await user.click(
      await screen.findByRole("button", { name: STRINGS.outtakes.newFromSelection }),
    );

    expect(api.outtakes.create).not.toHaveBeenCalled();
    // I5: an enabled toolbar button that does nothing is the everyday case here
    // (a collapsed caret), so it has to say what is missing.
    expect(await screen.findByText(STRINGS.outtakes.selectionRequired)).toBeInTheDocument();
  });

  it("ignores a second capture click instead of aborting the first POST (I4)", async () => {
    const user = userEvent.setup();
    mockControls.selection = { from: 1, to: 8 };
    mockControls.sliceJson = [{ type: "paragraph", content: [{ type: "text", text: "grabbed" }] }];
    let resolveCreate!: (row: ReturnType<typeof outtake>) => void;
    vi.mocked(api.outtakes.create).mockReturnValue(
      new Promise((res) => {
        resolveCreate = res;
      }),
    );

    renderEditorPage();
    await openOuttakesTab(user);
    const button = screen.getByRole("button", { name: STRINGS.outtakes.newFromSelection });

    await user.click(button);
    await waitFor(() => expect(api.outtakes.create).toHaveBeenCalledTimes(1));
    // The button gives no busy feedback, so a second click during a slow
    // round-trip is the expected user reaction. Aborting the first POST would
    // silently orphan a row the server had already committed.
    await user.click(button);
    expect(api.outtakes.create).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(STRINGS.editor.mutationBusy)).toBeInTheDocument();

    // The latch releases on settle, so the row still surfaces.
    resolveCreate(outtake({ id: "ot-new" }));
    expect(await screen.findByText("cut text")).toBeInTheDocument();
  });

  it("no-ops when the selection is image-only (stripped doc has no blocks)", async () => {
    const user = userEvent.setup();
    // Non-empty selection (from !== to) but the slice is only image node(s),
    // which stripImageNodes reduces to an empty doc — no outtake should POST.
    mockControls.selection = { from: 1, to: 3 };
    mockControls.sliceJson = [{ type: "image", attrs: { src: "/api/images/x" } }];

    renderEditorPage();
    await openOuttakesTab(user);
    expect(await screen.findByText(STRINGS.outtakes.empty)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: STRINGS.outtakes.newFromSelection }));

    expect(api.outtakes.create).not.toHaveBeenCalled();
    // Panel stays empty (no capture, so nothing is prepended).
    expect(screen.getByText(STRINGS.outtakes.empty)).toBeInTheDocument();
    // I5: distinct copy — the user DID select something, so "select some text"
    // would read as a lie.
    expect(await screen.findByText(STRINGS.outtakes.selectionHasNoText)).toBeInTheDocument();
  });

  it("surfaces the mapped error message when create fails", async () => {
    const user = userEvent.setup();
    mockControls.selection = { from: 1, to: 5 };
    mockControls.sliceJson = [{ type: "paragraph", content: [{ type: "text", text: "x" }] }];
    vi.mocked(api.outtakes.create).mockRejectedValue(new Error("boom"));

    renderEditorPage();
    await user.click(
      await screen.findByRole("button", { name: STRINGS.outtakes.newFromSelection }),
    );

    expect(await screen.findByText(STRINGS.error.createOuttakeFailed)).toBeInTheDocument();
  });

  it("refetches the open panel when the capture response was unreadable (S1)", async () => {
    // A 2xx BAD_JSON means the server most likely committed the outtake but the
    // body could not be read, so there is no row to prepend. The three sibling
    // outtake write paths all route this through the panel's requestReload; this
    // one did not, leaving a committed row invisible in the OPEN panel until the
    // drawer is closed and reopened — and a re-capture mints a duplicate.
    const user = userEvent.setup();
    mockControls.selection = { from: 1, to: 5 };
    mockControls.sliceJson = [{ type: "paragraph", content: [{ type: "text", text: "x" }] }];
    vi.mocked(api.outtakes.create).mockRejectedValue(
      new ApiRequestError("bad body", 200, "BAD_JSON"),
    );
    const committed = outtake({ id: "ot-new", label: "Landed anyway" });
    vi.mocked(api.outtakes.list).mockResolvedValueOnce([]).mockResolvedValue([committed]);

    renderEditorPage();
    await openOuttakesTab(user);
    expect(await screen.findByText(STRINGS.outtakes.empty)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: STRINGS.outtakes.newFromSelection }));

    // The ambiguity is still announced...
    expect(await screen.findByText(STRINGS.error.possiblyCommitted)).toBeInTheDocument();
    // ...and the refetch surfaces the row that did land.
    expect(await screen.findByDisplayValue("Landed anyway")).toBeInTheDocument();
  });

  it("does not paint project A's capture failure over project B (I1)", async () => {
    // EditorPage is not keyed on slug, so an A→B navigation leaves it mounted
    // and captureOp un-aborted: only unmount or a newer capture abort it.
    // Nothing clears actionError on project change either, so without a drift
    // guard A's banner pins itself over B. This drives the guard's SECOND check
    // (the pre-load window): the URL slug has advanced while project B's GET is
    // still outstanding, so projectRef still holds A's id and an id-only
    // comparison would wave the banner through.
    const user = userEvent.setup();
    mockControls.selection = { from: 1, to: 5 };
    mockControls.sliceJson = [{ type: "paragraph", content: [{ type: "text", text: "x" }] }];
    let rejectCreate!: (err: unknown) => void;
    vi.mocked(api.outtakes.create).mockReturnValue(
      new Promise((_res, rej) => {
        rejectCreate = rej;
      }),
    );

    renderEditorPageWithNav();
    await user.click(
      await screen.findByRole("button", { name: STRINGS.outtakes.newFromSelection }),
    );
    await waitFor(() => expect(api.outtakes.create).toHaveBeenCalled());

    // Navigate to project B; its GET never settles, so we sit in the pre-load
    // window for the rest of the test.
    vi.mocked(api.projects.get).mockReturnValue(new Promise(() => {}));
    await user.click(screen.getByTestId("nav-to-b"));

    rejectCreate(new Error("boom"));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText(STRINGS.error.createOuttakeFailed)).not.toBeInTheDocument();
  });

  it("does not announce project A's capture into project B (I1, success arm)", async () => {
    // The sibling above drives the drift guard's CATCH arm. The SUCCESS arm
    // carries the same guard and was uncovered: A→B mid-POST, and project B
    // announces "captured" for a capture belonging to A.
    //
    // The assertion is the announcement, not the prepended row, and that is
    // deliberate: the panel independently refuses a row whose project_id is
    // not its own, so a row-based assertion passes even with this guard
    // deleted and would pin the panel's belt-and-braces check instead of this
    // one. setActionInfo has no such second line of defence.
    const user = userEvent.setup();
    mockControls.selection = { from: 1, to: 5 };
    mockControls.sliceJson = [{ type: "paragraph", content: [{ type: "text", text: "x" }] }];
    let resolveCreate!: (row: ReturnType<typeof outtake>) => void;
    vi.mocked(api.outtakes.create).mockReturnValue(
      new Promise((res) => {
        resolveCreate = res;
      }),
    );

    renderEditorPageWithNav();
    await user.click(
      await screen.findByRole("button", { name: STRINGS.outtakes.newFromSelection }),
    );
    await waitFor(() => expect(api.outtakes.create).toHaveBeenCalled());

    // Same pre-load window as the sibling: B's GET never settles, so projectRef
    // still holds A while the URL slug has already advanced.
    vi.mocked(api.projects.get).mockReturnValue(new Promise(() => {}));
    await user.click(screen.getByTestId("nav-to-b"));

    resolveCreate(outtake({ id: "ot-new" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText(STRINGS.outtakes.capturedHidden)).not.toBeInTheDocument();
    expect(screen.queryByText(STRINGS.outtakes.captured)).not.toBeInTheDocument();
  });
});
