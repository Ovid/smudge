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
  mockControls: { flushSave: null as null | (() => Promise<boolean>) },
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
      expect(screen.getByTestId("mock-editor")).toBeInTheDocument();
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

    expect(await screen.findByText(STRINGS.editor.saveFailed)).toBeInTheDocument();
    warn.calledWith("Ctrl+S: flushSave threw", expect.any(Error));
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
