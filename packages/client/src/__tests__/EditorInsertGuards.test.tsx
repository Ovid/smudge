import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { EditorPage } from "../pages/EditorPage";
import { api, ApiRequestError } from "../api/client";
import { STRINGS } from "../strings";
import { expectConsole } from "./expectConsole";

// I2 (dedup review 2026-07-26): onInsertImage and handleInsertOuttake are the
// same operation — "insert content at the cursor of the mounted editor" — and
// they picked DIFFERENT guard axes. onInsertImage gated on isActionBusy()
// alone, which is false under the persistent editor lock raised by a terminal
// auto-save failure: that path (useProjectEditor.onRequestEditorLock →
// applyReloadFailedLock → COMMITTED_UNRELOADED) has no mutation in flight and
// no panel precondition. TipTap does not gate programmatic dispatch on
// `editable`, so the insert landed, onUpdate set dirtyRef and wrote the
// mutated document into the draft cache — where it outlives the very refresh
// the lock banner instructs the user to perform.
//
// The save-failure lock is the ONE lock state that coexists with an open image
// gallery: the restore / replace locks arrive through panels that close the
// reference panel on open (panel exclusivity), and handleToggleReferencePanel
// refuses to reopen it while locked. So this harness drives a save failure,
// which is why it exists separately from EditorPageFeatures' lock suite.

const { mockControls, insertImageSpy, insertContentSpy, editorHooks } = vi.hoisted(() => ({
  mockControls: { editable: true },
  insertImageSpy: vi.fn(),
  insertContentSpy: vi.fn(),
  // Lets a test drive the real save pipeline: EditorPage's handleSaveLockGated
  // → useProjectEditor.handleSave → api.chapters.update.
  editorHooks: { save: null as null | (() => Promise<boolean>) },
}));

// Minimal Editor stand-in. The real TipTap instance cannot be driven headlessly
// enough in jsdom to reach a terminal auto-save, and this test is about
// EditorPage's guards, not about TipTap.
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
  function Editor(props: {
    editorRef?: { current: unknown };
    onEditorReady?: (e: unknown) => void;
    onSave: (content: Record<string, unknown>, chapterId?: string) => Promise<boolean>;
  }) {
    const { editorRef, onEditorReady, onSave } = props;
    const onSaveRef = React.useRef(onSave);
    onSaveRef.current = onSave;
    React.useEffect(() => {
      const chainable = makeChainable();
      const fake = {
        get isEditable() {
          return mockControls.editable;
        },
        isActive: () => false,
        chain: () => chainable,
        setEditable: (v: boolean) => {
          mockControls.editable = v;
        },
        state: {
          selection: { from: 0, to: 0 },
          doc: { slice: () => ({ content: { toJSON: () => [] } }) },
        },
      };
      if (editorRef) {
        editorRef.current = {
          editor: fake,
          insertImage: (src: string, alt: string) => insertImageSpy(src, alt),
          markClean: () => {},
          flushSave: () => Promise.resolve(true),
          setEditable: (v: boolean) => fake.setEditable(v),
        };
      }
      editorHooks.save = () => onSaveRef.current({ type: "doc", content: [] }, "ch-1");
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

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
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
          today: "2026-07-26",
        }),
        dashboard: vi.fn().mockResolvedValue({ chapters: [] }),
      },
      chapters: { get: vi.fn(), update: vi.fn() },
      images: {
        list: vi.fn().mockResolvedValue([]),
        references: vi.fn().mockResolvedValue({ chapters: [] }),
        update: vi.fn(),
        delete: vi.fn(),
        upload: vi.fn(),
      },
      chapterStatuses: { list: vi.fn().mockResolvedValue([]) },
      snapshots: { list: vi.fn().mockResolvedValue([]) },
      outtakes: {
        list: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        delete: vi.fn(),
        updateLabel: vi.fn(),
      },
    },
  };
});

const mockChapter = {
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
};

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
  chapters: [mockChapter],
};

const mockImage = {
  id: "img-1",
  project_id: "proj-1",
  filename: "photo.png",
  alt_text: "A photo",
  caption: "",
  source: "",
  license: "",
  mime_type: "image/png",
  size_bytes: 1024,
  reference_count: 1,
  created_at: "2026-01-01T00:00:00Z",
};

function renderEditorPage() {
  return render(
    <MemoryRouter initialEntries={["/projects/test-project"]}>
      <Routes>
        <Route path="/projects/:slug" element={<EditorPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Open the reference panel and click through to an image's Insert button. */
async function openGalleryDetail(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.getByTestId("mock-editor")).toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: STRINGS.referencePanel.toggleTooltip }));
  await user.click(await screen.findByRole("button", { name: mockImage.filename }));
}

/**
 * Raise the persistent editor lock the way production does: a save that fails
 * with a terminal 404, which useProjectEditor reports via onRequestEditorLock.
 */
async function lockViaTerminalSaveFailure() {
  const warn = expectConsole("warn");
  vi.mocked(api.chapters.update).mockRejectedValue(
    new ApiRequestError("Chapter not found", 404, "NOT_FOUND"),
  );
  await act(async () => {
    await editorHooks.save!();
  });
  warn.calledWith(expect.stringContaining("Save failed terminally:"), expect.any(ApiRequestError));
  // COMMITTED_UNRELOADED landed: the reconcile effect has pushed editable:false
  // into the editor. This is the lock's own signal, independent of copy.
  await waitFor(() => expect(mockControls.editable).toBe(false));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockControls.editable = true;
  editorHooks.save = null;
  insertImageSpy.mockReset();
  insertContentSpy.mockReset();
  vi.mocked(api.projects.get).mockResolvedValue(mockProject);
  vi.mocked(api.chapters.get).mockResolvedValue(mockChapter);
  vi.mocked(api.images.list).mockResolvedValue([mockImage]);
  vi.mocked(api.images.references).mockResolvedValue({ chapters: [] });
});

afterEach(() => cleanup());

describe("insert-at-cursor entry points refuse while the editor is locked (I2)", () => {
  it("inserts an image normally when nothing is wrong (control)", async () => {
    const user = userEvent.setup();
    renderEditorPage();
    await openGalleryDetail(user);

    await user.click(
      await screen.findByRole("button", { name: STRINGS.imageGallery.insertButton }),
    );

    await waitFor(() => expect(insertImageSpy).toHaveBeenCalledTimes(1));
    expect(insertImageSpy).toHaveBeenCalledWith(`/api/images/${mockImage.id}`, mockImage.alt_text);
  });

  it("refuses to insert an image once a terminal save failure has locked the editor", async () => {
    const user = userEvent.setup();
    renderEditorPage();
    await openGalleryDetail(user);
    await lockViaTerminalSaveFailure();

    await user.click(
      await screen.findByRole("button", { name: STRINGS.imageGallery.insertButton }),
    );

    // The mutation must not reach the document: onUpdate would set dirtyRef and
    // write the mutated content into the draft cache, which survives the
    // refresh the lock banner tells the user to perform.
    expect(insertImageSpy).not.toHaveBeenCalled();
    expect(await screen.findByText(STRINGS.editor.lockedRefusal)).toBeInTheDocument();
  });
});
