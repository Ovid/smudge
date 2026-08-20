import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, act, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { EditorPage } from "../pages/EditorPage";
import { api } from "../api/client";
import { STRINGS } from "../strings";
import { expectConsole } from "./expectConsole";

// Ctrl+S routes through EditorPage's own flushSave callback, which wraps
// `editorRef.current.flushSave()` in a try/catch. That catch is reachable in
// production: Editor.flushSave calls `editor.getJSON()` and invokes onSave
// SYNCHRONOUSLY, outside the `.catch` that guards the returned promise (see
// Editor.tsx — the `.catch` covers the onSave rejection only). A TipTap throw
// during a mid-remount therefore escapes flushSave as a synchronous throw.
//
// It matters because useKeyboardShortcuts invokes the callback as
// `flushSaveRef.current?.()` without awaiting: an unswallowed throw escapes the
// keydown handler entirely and the writer gets no save-failed feedback at all —
// the one signal that tells them their words are not on the server.
//
// The real TipTap instance cannot be driven to throw from getJSON() in jsdom,
// so this file mounts EditorPage against a minimal Editor stand-in whose
// flushSave is controllable. Kept separate from the other Editor-mocking
// suites (EditorInsertGuards, OuttakesEditorEntryPoints) because each of those
// mocks is shaped around its own subject's needs — selection slicing, chainable
// commands — none of which this path touches.

const { mockControls } = vi.hoisted(() => ({
  mockControls: {
    flushSave: null as null | (() => Promise<boolean>),
    // True once the mount effect below has published the editor handle into
    // `editorRef`. Load-bearing, not diagnostic: `renderLoadedEditor` gates on
    // it. See the comment there (F-37).
    handlePublished: false,
  },
}));

vi.mock("../components/Editor", async () => {
  const React = await import("react");
  function Editor(props: {
    editorRef?: { current: unknown };
    onEditorReady?: (e: unknown) => void;
  }) {
    const { editorRef, onEditorReady } = props;
    React.useEffect(() => {
      const fake = {
        isEditable: true,
        isActive: () => false,
        setEditable: () => {},
      };
      if (editorRef) {
        editorRef.current = {
          editor: fake,
          insertImage: () => {},
          markClean: () => {},
          setEditable: () => {},
          // Delegated so a test can swap the behaviour after mount.
          flushSave: () => mockControls.flushSave?.() ?? Promise.resolve(true),
        };
      }
      // Published from a useEffect, exactly as the real Editor does
      // (Editor.tsx: `useEffect(... editorRef.current = {...}, [editor, editorRef])`).
      // That timing is the whole reason renderLoadedEditor waits on this flag.
      mockControls.handlePublished = true;
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
          today: "2026-08-17",
        }),
        dashboard: vi.fn().mockResolvedValue({ chapters: [] }),
      },
      chapters: { get: vi.fn(), update: vi.fn() },
      chapterStatuses: { list: vi.fn().mockResolvedValue([]) },
      snapshots: { list: vi.fn().mockResolvedValue([]) },
      images: {
        list: vi.fn().mockResolvedValue([]),
        references: vi.fn().mockResolvedValue({ chapters: [] }),
      },
      outtakes: { list: vi.fn().mockResolvedValue([]) },
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

async function renderLoadedEditor() {
  render(
    <MemoryRouter initialEntries={["/projects/test-project"]}>
      <Routes>
        <Route path="/projects/:slug" element={<EditorPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(
    () => {
      // The DOM node is NOT a sufficient gate, and waiting only on it is what
      // made this file flake ~10% of runs (F-37, root-caused 2026-08-20).
      //
      // Both this mock and the real `Editor` publish the imperative handle
      // from a passive `useEffect`, which React flushes in a LATER scheduler
      // turn than the commit that puts the node in the DOM. `waitFor` runs
      // with the act environment disabled (RTL's `asyncWrapper`) and notices
      // the node via a MutationObserver, so under CPU contention — where
      // React's scheduler yields on its 5ms deadline and takes several
      // MessageChannel turns to drain — it can return inside that window.
      //
      // Ctrl+S then evaluated `await editorRef.current?.flushSave()` against a
      // null ref: the optional chain yields `undefined`, `await undefined`
      // resolves, the mock's throw never happens, nothing is caught, and there
      // is no warning and no banner. Measured directly at a failure:
      // `handlerRan=true publishedAtPress=false publishedAtAssert=true`.
      //
      // So gate on the handle — the fact these tests actually depend on.
      expect(screen.getByTestId("mock-editor")).toBeInTheDocument();
      expect(mockControls.handlePublished).toBe(true);
    },
    { timeout: 3000 },
  );
}

async function pressCtrlS() {
  await act(async () => {
    fireEvent.keyDown(document, { key: "s", code: "KeyS", ctrlKey: true });
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("EditorPage Ctrl+S flush", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    mockControls.flushSave = null;
    mockControls.handlePublished = false;
    vi.mocked(api.projects.get).mockResolvedValue(mockProject);
    vi.mocked(api.chapters.get).mockResolvedValue(mockChapter);
  });

  it("surfaces the save-failed banner when the editor throws synchronously mid-flush", async () => {
    // The TipTap mid-remount case: getJSON() throws before any promise exists,
    // so the throw is synchronous. Without EditorPage's catch this escapes the
    // keydown handler and the writer sees nothing at all.
    const warn = expectConsole("warn");
    mockControls.flushSave = () => {
      throw new Error("Cannot read properties of null (reading 'doc')");
    };

    await renderLoadedEditor();
    await pressCtrlS();

    // F-37 (architecture report 2026-08-11): assert the WARNING first, before
    // the banner. Both assertions fail when this test flakes, but they fail
    // with different information. "Banner not found" is produced identically by
    // a guard returning early, by editorRef.current being null (the optional
    // chaining in EditorPage's handler swallows that silently — `await
    // undefined` resolves, nothing throws, no banner), and by the handler never
    // running at all. The warning distinguishes them: if it fired, the handler
    // ran and caught the throw and only the render is in question; if it did
    // not, the handler never reached its catch and the banner was never the
    // problem. Ordered this way so the next occurrence reports a cause instead
    // of another measurement.
    //
    // Safe to assert first because the path is synchronous end to end: the mock
    // throws while `editorRef.current?.flushSave()` is being evaluated, before
    // the `await` suspends, so the catch and this warn both run inside
    // pressCtrlS's act(). (Its async sibling below has a real microtask hop, so
    // that one keeps the original order.)
    warn.calledWith("Ctrl+S: flushSave threw", expect.any(Error));
    expect(await screen.findByText(STRINGS.editor.saveFailed)).toBeInTheDocument();
  });

  it("surfaces the same banner when the flush promise rejects", async () => {
    // The asynchronous sibling. Editor.flushSave swallows onSave rejections
    // today, but the catch must not depend on that: a rejection here would
    // otherwise surface as an unhandled rejection, since useKeyboardShortcuts
    // never awaits the callback.
    const warn = expectConsole("warn");
    mockControls.flushSave = () => Promise.reject(new Error("save blew up"));

    await renderLoadedEditor();
    await pressCtrlS();

    expect(await screen.findByText(STRINGS.editor.saveFailed)).toBeInTheDocument();
    warn.calledWith("Ctrl+S: flushSave threw", expect.any(Error));
  });

  it("shows no banner when the flush succeeds", async () => {
    // Contrast: the catch must not fire on the happy path, or every Ctrl+S
    // would cry wolf.
    mockControls.flushSave = () => Promise.resolve(true);

    await renderLoadedEditor();
    await pressCtrlS();

    expect(screen.queryByText(STRINGS.editor.saveFailed)).toBeNull();
  });
});
