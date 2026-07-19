import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { EditorPage } from "../pages/EditorPage";
import { api } from "../api/client";
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
        get selection() {
          return mockControls.selection;
        },
        doc: {
          slice: () => ({ content: { toJSON: () => mockControls.sliceJson } }),
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

// Opens the reference panel and selects the Outtakes tab.
async function openOuttakesTab(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.getByTestId("mock-editor")).toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: STRINGS.referencePanel.toggleTooltip }));
  await user.click(await screen.findByRole("tab", { name: STRINGS.outtakes.tab }));
}

beforeEach(() => {
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
});

describe("F1: insert outtake at cursor", () => {
  it("inserts the block ARRAY (content.content), not the doc node", async () => {
    const user = userEvent.setup();
    const blocks = [{ type: "paragraph", content: [{ type: "text", text: "cut text" }] }];
    vi.mocked(api.outtakes.list).mockResolvedValue([outtake({ content: { type: "doc", content: blocks } })]);

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
  });

  it("no-ops when the outtake has no blocks (empty doc)", async () => {
    const user = userEvent.setup();
    vi.mocked(api.outtakes.list).mockResolvedValue([outtake({ content: { type: "doc", content: [] } })]);

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

    const created = outtake({ id: "ot-new", label: "From Chapter One", content: { type: "doc", content: [paragraph] } });
    vi.mocked(api.outtakes.create).mockResolvedValue(created);
    // First list (panel mount) empty; after the nonce bump, the new row loads.
    vi.mocked(api.outtakes.list).mockResolvedValueOnce([]).mockResolvedValue([created]);

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

    // End-to-end: the nonce bump reloaded the panel and the new row appears.
    expect(await screen.findByText("grabbed")).toBeInTheDocument();
  });

  it("no-ops on an empty selection (from === to)", async () => {
    const user = userEvent.setup();
    mockControls.selection = { from: 3, to: 3 };

    renderEditorPage();
    await user.click(await screen.findByRole("button", { name: STRINGS.outtakes.newFromSelection }));

    expect(api.outtakes.create).not.toHaveBeenCalled();
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
    // Panel stays empty (nonce not bumped, no reload adds a row).
    expect(screen.getByText(STRINGS.outtakes.empty)).toBeInTheDocument();
  });

  it("surfaces the mapped error message when create fails", async () => {
    const user = userEvent.setup();
    mockControls.selection = { from: 1, to: 5 };
    mockControls.sliceJson = [{ type: "paragraph", content: [{ type: "text", text: "x" }] }];
    vi.mocked(api.outtakes.create).mockRejectedValue(new Error("boom"));

    renderEditorPage();
    await user.click(await screen.findByRole("button", { name: STRINGS.outtakes.newFromSelection }));

    expect(await screen.findByText(STRINGS.error.createOuttakeFailed)).toBeInTheDocument();
  });
});
