import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, act, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
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
      chapters: { get: vi.fn(), update: vi.fn(), create: vi.fn() },
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

const OTHER_PROJECT = {
  ...mockProject,
  id: "proj-2",
  slug: "other-book",
  title: "Other Book",
  chapters: [],
};

/**
 * Same mount as `renderLoadedEditor`, plus an in-tree button that navigates to
 * a SECOND slug on the same `/projects/:slug` route. Router reuses the
 * EditorPage instance across that navigation, which is the whole premise of the
 * OOSS2 drift case — a keyed route would remount and the bug could not exist.
 */
async function renderNavigableEditor() {
  function GoOther() {
    const navigate = useNavigate();
    return (
      <button
        data-testid="go-other-project"
        onClick={() => navigate(`/projects/${OTHER_PROJECT.slug}`)}
      />
    );
  }
  render(
    <MemoryRouter initialEntries={["/projects/test-project"]}>
      <GoOther />
      <Routes>
        <Route path="/projects/:slug" element={<EditorPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(
    () => {
      expect(screen.getByTestId("mock-editor")).toBeInTheDocument();
      expect(mockControls.handlePublished).toBe(true);
    },
    { timeout: 3000 },
  );
}

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

// Review 2026-08-23 (I4). The re-entrancy latch added for I7 closed
// switch-vs-switch and nothing else. `switchToView` sets NEITHER
// `mutation.isBusy()` nor `actionBusyRef`, so `isActionBusy()` read false for
// the whole flush window — seconds, in the 2s/4s/8s save-backoff ladder. Every
// sibling entry point guarded by isActionBusy() ran freely in that window, and
// several of them (handleCreateChapter, handleDeleteChapter, the Ctrl+S flush)
// call cancelInFlightSave() at the top. That severs the very PATCH the view
// switch is awaiting: flushSave resolves false, the `if (!flushed)` arm tells
// the writer their changes could not be saved for a save their own click
// cancelled, and it re-enables the editor.
//
// The severe variant is Replace All in the still-open find-replace panel:
// mutation.run() cancels the pending saves and takes its own
// setEditable(false), and the view switch's `!flushed` arm then re-enables the
// editor INSIDE the mutation's committed window — the window CLAUDE.md
// save-pipeline invariant 2 exists to close.
//
// This suite is the right home because the fix is only observable while a
// flush is genuinely suspended, and this file's Editor stand-in is the one
// place `flushSave` can be held open.
describe("EditorPage view-switch busy window", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    mockControls.flushSave = null;
    mockControls.handlePublished = false;
    // Preview mode's TOC scroll tracking constructs one; jsdom has none.
    global.IntersectionObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    })) as unknown as typeof IntersectionObserver;
    vi.mocked(api.projects.get).mockResolvedValue(mockProject);
    vi.mocked(api.chapters.get).mockResolvedValue(mockChapter);
  });

  it("refuses a sibling entry point while a view switch is mid-flush", async () => {
    let releaseFlush: (v: boolean) => void = () => {};
    mockControls.flushSave = () =>
      new Promise<boolean>((resolve) => {
        releaseFlush = resolve;
      });

    await renderLoadedEditor();

    // Ctrl+Shift+P parks switchToView on the held flush.
    await act(async () => {
      fireEvent.keyDown(document, { key: "P", code: "KeyP", ctrlKey: true, shiftKey: true });
      await Promise.resolve();
    });

    // A sibling entry point fired in that window must be refused, not run.
    // Ctrl+Shift+N reaches handleCreateChapterGuarded, whose only gate is
    // isActionBusy(); the keyboard route works whichever view is on screen.
    await act(async () => {
      fireEvent.keyDown(document, { key: "N", code: "KeyN", ctrlKey: true, shiftKey: true });
      await Promise.resolve();
    });

    expect(api.chapters.create).not.toHaveBeenCalled();
    expect(screen.getByText(STRINGS.editor.mutationBusy)).toBeInTheDocument();

    releaseFlush(true);
    await act(async () => {
      await Promise.resolve();
    });
  });

  // Backlog `e9b82917` (agentic review 2026-08-23 round 2, OOSS2). Every write
  // AFTER `await flushSave()` is unconditional: `setActionError` on both
  // failure arms, `safeSetEditable(true)` on three, and
  // `setTrashOpen`/`setViewMode`/`setDashboardRefreshKey` on success. The route
  // is `/projects/:slug` with no React `key`, so an A-to-B navigation keeps
  // `EditorPage` MOUNTED and the old project's slow flush lands inside the page
  // now showing the new project.
  //
  // Nine sibling async handlers build `makeStaleProjectGuard` at entry for
  // exactly this; `switchToView` built none. The visible result is project A's
  // "your changes could not be saved" banner sitting over project B — a
  // data-loss warning attached to a book that never failed to save, at the one
  // moment an accurate message matters most.
  //
  // The navigation here is a real one: both slugs match the same `/projects/:slug`
  // route, so React Router reuses the EditorPage instance rather than
  // remounting it, and `useProjectEditor`'s render body advances
  // `projectSlugRef` synchronously. That is the pre-load window
  // `makeStaleProjectGuard` check 2 exists for.
  it("does not put a failed flush's banner on a project the user has moved to", async () => {
    let releaseFlush: (v: boolean) => void = () => {};
    mockControls.flushSave = () =>
      new Promise<boolean>((resolve) => {
        releaseFlush = resolve;
      });
    vi.mocked(api.projects.get).mockImplementation(async (slug: string) =>
      slug === OTHER_PROJECT.slug ? OTHER_PROJECT : mockProject,
    );

    await renderNavigableEditor();

    await act(async () => {
      fireEvent.keyDown(document, { key: "P", code: "KeyP", ctrlKey: true, shiftKey: true });
      await Promise.resolve();
    });

    // The writer opens a different book while the first one's flush retries.
    await act(async () => {
      fireEvent.click(screen.getByTestId("go-other-project"));
      await Promise.resolve();
    });

    // Now the OLD project's flush finally gives up.
    await act(async () => {
      releaseFlush(false);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText(STRINGS.editor.viewSwitchSaveFailed)).toBeNull();
  });

  it("releases the busy window once the flush settles", async () => {
    // The other half: the gate must not leak. A view switch that finished
    // leaves every entry point usable again.
    mockControls.flushSave = () => Promise.resolve(true);
    vi.mocked(api.chapters.create).mockResolvedValue({ ...mockChapter, id: "ch-2" });

    await renderLoadedEditor();

    await act(async () => {
      fireEvent.keyDown(document, { key: "P", code: "KeyP", ctrlKey: true, shiftKey: true });
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.keyDown(document, { key: "N", code: "KeyN", ctrlKey: true, shiftKey: true });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(api.chapters.create).toHaveBeenCalled();
    });
    expect(screen.queryByText(STRINGS.editor.mutationBusy)).toBeNull();
  });
});
