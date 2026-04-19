/**
 * Integration regression test for the editor unmount-clobber bug.
 *
 * Bug shape:
 * When a mutate-via-server operation (snapshot restore, project-wide
 * replace) is in flight and the <Editor /> unmounts (e.g. a chapter switch
 * key change), the Editor's unmount cleanup fires a fire-and-forget PATCH
 * `/api/chapters/<A>` with the PRE-mutation content. If that PATCH lands
 * AFTER the server's mutation commits, the mutation is silently clobbered.
 *
 * Fix: `useEditorMutation` calls `editor?.markClean()` before running the
 * mutation callback. markClean sets the Editor's `dirtyRef` to false so the
 * unmount cleanup's `if (dirtyRef.current && ...)` gate short-circuits.
 *
 * We exercise the regression through the find/replace-all path (not
 * snapshot restore): entering snapshot-view mode already unmounts the
 * Editor *before* Restore is clicked, so the critical window — Editor
 * still mounted at the moment mutate starts — lives in the replace-all
 * flow. Both flows route through the same `useEditorMutation` instance,
 * so a regression in either shows up here.
 *
 * The real <Editor /> also disables editing during the mutate
 * (`setEditable(false)`) and saves via `flushSave` before the mutate. In
 * practice those two guards make the stale-PATCH path hard to reach
 * naturally — but that is exactly why markClean is load-bearing: it is
 * the last line of defense against any future regression that weakens
 * setEditable/flushSave. To prove the fix deterministically, this test
 * replaces the <Editor /> component with a test double that:
 *   - exposes the same EditorHandle shape the real component does,
 *   - lets the test simulate typing (dirty=true) explicitly,
 *   - does NOT clear dirty on flushSave (so flushSave is no longer
 *     sufficient — only markClean can close the window),
 *   - calls `onSave` in an unmount useEffect cleanup when dirty=true, to
 *     mirror the real Editor's unmount-clobber shape.
 *
 * Assertion: during a replace-all triggered via the find-replace panel,
 * no stale PATCH (onSave call) fires AFTER the replace resolves. With
 * markClean in place, the hook clears the test double's dirty flag
 * before the replace begins; the unmount cleanup sees dirty=false and
 * no PATCH is issued. Without markClean, the test double's unmount
 * cleanup PATCHes pre-replace content and the test fails.
 *
 * Sanity check: commenting out `editor?.markClean()` in
 * `packages/client/src/hooks/useEditorMutation.ts` must cause this test
 * to fail with the stale-PATCH assertion message below.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  act,
  within,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { EditorHandle } from "../components/Editor";
// These imports are deliberately above the vi.mock() calls below; vitest
// hoists vi.mock() to the top of the module so the mocks are in place
// before EditorPage and the api client resolve.
import { EditorPage } from "./EditorPage";
import { api } from "../api/client";

// ---- Editor test double -----------------------------------------------
//
// The real <Editor /> component wraps TipTap + ProseMirror, whose
// editable-state + mutation-observer behavior is environment-dependent and
// makes it impractical to reproduce the race the markClean fix closes in
// jsdom. The test double below preserves the Editor's *external contract*
// (EditorHandle, onSave on unmount when dirty, onContentChange hook) while
// shedding the guards (setEditable, flushSave clears dirty) that would
// mask the regression — so the markClean step in useEditorMutation becomes
// the deciding factor for whether a stale PATCH fires.

// Module-level registry so the test can reach in and simulate typing on
// the currently-mounted instance by chapter id. Declared before vi.mock
// so the factory's lazy require can read it via closure — vi.mock hoists
// its factory above imports, and the factory body is evaluated lazily
// when the mocked module is first imported, so this declaration is live
// by then.
type HandleRegistryEntry = {
  editable: boolean;
  dirty: boolean;
  lastContent: Record<string, unknown>;
  chapterId?: string;
  markCleanCalls: number;
  setEditableCalls: boolean[];
  flushSaveCalls: number;
};

const handleRegistry = new Map<string, HandleRegistryEntry>();

// Simulate typing by flipping dirty to true on the test double for a
// given chapter. Mirrors what TipTap's onUpdate does in the real Editor.
function simulateTyping(chapterId: string, content: Record<string, unknown>) {
  const entry = handleRegistry.get(chapterId);
  if (!entry) throw new Error(`no Editor mounted for chapter ${chapterId}`);
  entry.dirty = true;
  entry.lastContent = content;
}

// Mock the Editor module with a test double. vi.mock is hoisted above
// imports; the factory itself is evaluated when the mocked module is
// first imported by EditorPage.
vi.mock("../components/Editor", async () => {
  // Dynamic imports are fine inside vi.mock factories.
  const react = await import("react");

  interface TestEditorProps {
    content: Record<string, unknown> | null;
    chapterId?: string;
    onSave: (
      content: Record<string, unknown>,
      chapterId?: string,
    ) => Promise<boolean>;
    onContentChange?: (content: Record<string, unknown>) => void;
    editorRef?: React.MutableRefObject<EditorHandle | null>;
    onEditorReady?: (editor: unknown) => void;
    projectId: string;
    onImageAnnouncement?: (message: string) => void;
  }

  function TestEditor({
    content,
    chapterId,
    onSave,
    editorRef,
    onEditorReady,
  }: TestEditorProps) {
    const entryRef = react.useRef<HandleRegistryEntry | null>(null);
    const mountIdRef = react.useRef(chapterId);
    // Keep onSave latest so unmount cleanup uses the current identity
    // (the real Editor uses an onSaveRef for the same reason).
    const onSaveRef = react.useRef(onSave);
    onSaveRef.current = onSave;

    // Lazily create the entry and register it under the chapter id so
    // the test can simulate typing by chapter.
    if (!entryRef.current) {
      const entry: HandleRegistryEntry = {
        editable: true,
        dirty: false,
        lastContent: content ?? { type: "doc", content: [{ type: "paragraph" }] },
        chapterId,
        markCleanCalls: 0,
        setEditableCalls: [],
        flushSaveCalls: 0,
      };
      entryRef.current = entry;
      if (chapterId) handleRegistry.set(chapterId, entry);
    }

    // Expose the EditorHandle on editorRef. markClean flips dirty=false;
    // setEditable records the call but does NOT block typing (the test
    // drives dirty via simulateTyping); flushSave does NOT clear dirty —
    // so markClean is the only path that clears it here.
    react.useImperativeHandle(
      editorRef as unknown as React.Ref<EditorHandle>,
      (): EditorHandle => ({
        editor: null,
        insertImage: () => undefined,
        flushSave: async () => {
          const e = entryRef.current!;
          e.flushSaveCalls++;
          return true;
        },
        markClean: () => {
          const e = entryRef.current!;
          e.markCleanCalls++;
          e.dirty = false;
        },
        setEditable: (editable: boolean) => {
          const e = entryRef.current!;
          e.setEditableCalls.push(editable);
          e.editable = editable;
        },
      }),
      [],
    );

    // Mirror the real Editor's unmount cleanup: fire a fire-and-forget
    // PATCH iff dirty at unmount time. mountIdRef is captured at mount
    // so the cleanup targets the chapter this Editor instance was
    // created for. Also report an "editor ready" stub so EditorPage's
    // toolbar (which gates the Snapshots button on toolbarEditor != null)
    // can render.
    react.useEffect(() => {
      onEditorReady?.({} as unknown);
      return () => {
        const e = entryRef.current;
        if (!e) return;
        if (e.dirty) {
          onSaveRef.current(e.lastContent, mountIdRef.current).catch(() => {});
        }
        if (mountIdRef.current && handleRegistry.get(mountIdRef.current) === e) {
          handleRegistry.delete(mountIdRef.current);
        }
      };
    }, []);

    return react.createElement(
      "div",
      {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Editor content",
        "data-testid": "test-editor",
        "data-chapter-id": chapterId ?? "",
      },
      null,
    );
  }

  return { Editor: TestEditor };
});

// Mock EditorToolbar to dodge the real TipTap-editor surface area we
// don't need. The real toolbar calls editor.chain().focus().toggleBold()
// and editor.isActive(...); our test double's onEditorReady returns a
// stub that doesn't implement those. We only need the Snapshots toggle
// button for this test.
vi.mock("../components/EditorToolbar", async () => {
  const react = await import("react");
  return {
    EditorToolbar: ({
      onToggleSnapshots,
      snapshotsTriggerRef,
    }: {
      onToggleSnapshots?: () => void;
      snapshotsTriggerRef?: React.Ref<HTMLButtonElement>;
    }) =>
      react.createElement(
        "div",
        { role: "toolbar", "aria-label": "Test toolbar" },
        onToggleSnapshots
          ? react.createElement(
              "button",
              {
                ref: snapshotsTriggerRef,
                onClick: onToggleSnapshots,
                "aria-label": "Snapshots",
              },
              "Snapshots",
            )
          : null,
      ),
  };
});

// Mock the content cache so localStorage doesn't interfere.
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
      update: vi.fn(),
      reorderChapters: vi.fn(),
      trash: vi.fn(),
      dashboard: vi.fn(),
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
        today: "2026-04-19",
      }),
    },
    chapters: {
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      restore: vi.fn(),
    },
    chapterStatuses: {
      list: vi.fn().mockResolvedValue([]),
    },
    snapshots: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      restore: vi.fn(),
    },
    search: {
      find: vi.fn().mockResolvedValue({ total_count: 0, chapters: [] }),
      replace: vi.fn().mockResolvedValue({ replaced_count: 0, affected_chapter_ids: [] }),
    },
    settings: {
      get: vi.fn().mockResolvedValue({ timezone: "UTC" }),
      update: vi.fn().mockResolvedValue({ message: "ok" }),
    },
  },
}));

// React 19 checks IS_REACT_ACT_ENVIRONMENT before it suppresses the
// "not configured to support act(...)" warning. jsdom + vitest would
// usually have this set by @testing-library/react's auto-wrap, but the
// late wave of fire-and-forget onSave calls our Editor test double
// issues in its unmount useEffect cleanup happens on a microtask that
// is not wrapped by the harness — without this flag those trigger
// noisy stderr output that violates CLAUDE.md's zero-warnings rule.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

beforeEach(() => {
  global.IntersectionObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  handleRegistry.clear();
});

const PRE_RESTORE_CONTENT = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "original pre-restore content" }],
    },
  ],
};

const DIRTY_CONTENT = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "DIRTY_WHILE_RESTORING_SENTINEL" }],
    },
  ],
};

const DIRTY_MARKER = "DIRTY_WHILE_RESTORING_SENTINEL";
const CHAPTER_A_ID = "ch-A";
const CHAPTER_B_ID = "ch-B";

const mockChapterA = {
  id: CHAPTER_A_ID,
  project_id: "proj-1",
  title: "Chapter A",
  content: PRE_RESTORE_CONTENT,
  sort_order: 0,
  word_count: 3,
  status: "outline",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
};

const mockChapterB = {
  id: CHAPTER_B_ID,
  project_id: "proj-1",
  title: "Chapter B",
  content: { type: "doc", content: [{ type: "paragraph" }] },
  sort_order: 1,
  word_count: 0,
  status: "outline",
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
  chapters: [mockChapterA, mockChapterB],
};

function renderEditorPage() {
  return render(
    <MemoryRouter initialEntries={["/projects/test-project"]}>
      <Routes>
        <Route path="/projects/:slug" element={<EditorPage />} />
        <Route path="/" element={<div>Home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("EditorPage unmount-clobber regression", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;
  let originalConsoleError: typeof console.error | null = null;

  afterEach(() => {
    cleanup();
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
    originalConsoleError = null;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // React 19 emits a console.error "The current testing environment is
    // not configured to support act(...)" when the Editor test double's
    // unmount useEffect cleanup fires a fire-and-forget onSave call that
    // triggers state updates outside an act() wrap. That is the exact
    // shape of the bug we are exercising — the cleanup is supposed to
    // run and trigger state updates — so the warning is expected, not
    // indicative of a test defect. Per CLAUDE.md's zero-warnings rule,
    // filter it here and let everything else fall through so unrelated
    // warnings still surface.
    originalConsoleError = console.error;
    consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation((msg: unknown, ...rest: unknown[]) => {
        if (
          typeof msg === "string" &&
          msg.includes("The current testing environment is not configured to support act")
        ) {
          return;
        }
        originalConsoleError?.(msg, ...rest);
      });
  });

  it("does not PATCH pre-mutation content when the editor unmounts during a replace-all", async () => {
    type CallEntry =
      | {
          kind: "chapters.update";
          order: number;
          chapterId: string;
          content?: unknown;
        }
      | { kind: "search.replace.start"; order: number }
      | { kind: "search.replace.resolve"; order: number };

    const callLog: CallEntry[] = [];
    let nextOrder = 0;

    vi.mocked(api.projects.get).mockResolvedValue(mockProject);
    vi.mocked(api.chapters.get).mockImplementation(async (id: string) => {
      if (id === CHAPTER_A_ID) return mockChapterA;
      if (id === CHAPTER_B_ID) return mockChapterB;
      throw new Error(`unexpected chapter id: ${id}`);
    });

    vi.mocked(api.chapters.update).mockImplementation(
      async (
        id: string,
        updates: { content?: Record<string, unknown> } & Record<string, unknown>,
      ) => {
        callLog.push({
          kind: "chapters.update",
          order: nextOrder++,
          chapterId: id,
          content: updates.content,
        });
        return {
          id,
          project_id: "proj-1",
          title: id === CHAPTER_A_ID ? "Chapter A" : "Chapter B",
          content:
            (updates.content as Record<string, unknown>) ??
            ({ type: "doc", content: [] } as Record<string, unknown>),
          sort_order: id === CHAPTER_A_ID ? 0 : 1,
          word_count: 1,
          status: "outline",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
          deleted_at: null,
        };
      },
    );

    // A search result that offers a Replace-All-in-Manuscript button
    // once the panel is opened and the query is typed.
    vi.mocked(api.search.find).mockResolvedValue({
      total_count: 1,
      chapters: [
        {
          chapter_id: CHAPTER_A_ID,
          chapter_title: "Chapter A",
          matches: [{ index: 0, context: "foo bar", blockIndex: 0, offset: 0, length: 3 }],
        },
      ],
    });

    // Replace-all is held mid-flight. The assertion window opens at
    // "start" and closes at "resolve"; any chapters.update observed
    // after "resolve" is the unmount-clobber regression signal.
    let resolveReplace:
      | ((v: { replaced_count: number; affected_chapter_ids: string[] }) => void)
      | null = null;
    const replacePromise = new Promise<{
      replaced_count: number;
      affected_chapter_ids: string[];
    }>((resolve) => {
      resolveReplace = (v) => resolve(v);
    });
    vi.mocked(api.search.replace).mockImplementation(async () => {
      callLog.push({ kind: "search.replace.start", order: nextOrder++ });
      const value = await replacePromise;
      callLog.push({ kind: "search.replace.resolve", order: nextOrder++ });
      return value;
    });

    renderEditorPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Chapter A" })).toBeInTheDocument();
    });

    // Wait for the Editor test double to register for chapter A.
    await waitFor(() => {
      expect(handleRegistry.get(CHAPTER_A_ID)).toBeDefined();
    });

    // ---- 1. Simulate dirty typing on the Editor test double. ----
    simulateTyping(CHAPTER_A_ID, DIRTY_CONTENT);

    // ---- 2. Open the Find/Replace panel (Ctrl+H) and fill query +
    // replacement so the results render and the "Replace All in
    // Manuscript" button appears. ----
    await act(async () => {
      fireEvent.keyDown(document, { key: "h", code: "KeyH", ctrlKey: true });
      await Promise.resolve();
    });
    const findInput = await screen.findByLabelText("Find");
    const replaceInput = screen.getByLabelText("Replace");
    fireEvent.change(findInput, { target: { value: "foo" } });
    fireEvent.change(replaceInput, { target: { value: "qux" } });

    const replaceAllBtn = await screen.findByRole(
      "button",
      { name: "Replace All in Manuscript" },
      { timeout: 3000 },
    );
    await userEvent.click(replaceAllBtn);
    const dialog = await screen.findByRole("alertdialog", {
      name: "Replace across manuscript?",
    });
    const confirmInsideDialog = within(dialog).getByRole("button", {
      name: "Replace All",
    });

    // ---- 3. Confirm → hook begins → mutate (api.search.replace) is
    // held. ----
    await act(async () => {
      await userEvent.click(confirmInsideDialog);
    });
    await waitFor(() => {
      expect(callLog.some((c) => c.kind === "search.replace.start")).toBe(true);
    });

    // Assert the Editor test double is still registered for chapter A
    // at this point — the critical invariant the markClean step protects.
    const chapterAEntry = handleRegistry.get(CHAPTER_A_ID);
    expect(chapterAEntry).toBeDefined();

    // ---- 4. While the replace is held, unmount the Editor by switching
    // to Chapter B. The Editor is keyed on activeChapter.id, so this
    // unmounts the chapter-A instance; its cleanup fires a stale PATCH
    // iff dirty=true. markClean is what clears dirty here. ----
    const chapterBLink = await screen.findByText("Chapter B");
    await act(async () => {
      await userEvent.click(chapterBLink);
    });

    // ---- 5. Resolve the replace and flush microtasks. ----
    await act(async () => {
      resolveReplace?.({ replaced_count: 1, affected_chapter_ids: [CHAPTER_A_ID] });
      for (let i = 0; i < 10; i++) await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    // ---- 6. Assertion: no PATCH against chapter A with pre-mutation
    // content (carrying DIRTY_MARKER) lands AFTER the replace started.
    //
    // Once api.search.replace has been invoked the server is working on
    // committing the replace. Any chapters.update that fires AFTER the
    // replace request started — whether before or after the client
    // observes its response — races with the server-side replace and
    // can clobber it. The hook's markClean step is what prevents the
    // Editor's unmount cleanup from producing such a PATCH during the
    // in-flight window. ----
    const replaceStartIndex = callLog.findIndex(
      (c) => c.kind === "search.replace.start",
    );
    const replaceResolveIndex = callLog.findIndex(
      (c) => c.kind === "search.replace.resolve",
    );
    expect(replaceStartIndex).toBeGreaterThanOrEqual(0);
    expect(replaceResolveIndex).toBeGreaterThan(replaceStartIndex);

    const stalePatches = callLog.slice(replaceStartIndex + 1).filter(
      (c): c is Extract<CallEntry, { kind: "chapters.update" }> =>
        c.kind === "chapters.update" &&
        c.chapterId === CHAPTER_A_ID &&
        JSON.stringify(c.content).includes(DIRTY_MARKER),
    );

    expect(
      stalePatches,
      "Expected NO stale PATCH against chapter A with pre-mutation content " +
        "after the replace request started. useEditorMutation must call " +
        "markClean() before the server mutate so the Editor's unmount cleanup " +
        "does not fire a PATCH that would clobber the just-committed server " +
        "state.\n\n" +
        "Observed stale PATCHes: " +
        JSON.stringify(stalePatches, null, 2) +
        "\n\nFull call log:\n" +
        JSON.stringify(callLog, null, 2),
    ).toEqual([]);

    // Confirm the only console.error messages we swallowed are the
    // expected React 19 "not configured to support act(...)" ones, so
    // we can't mask unrelated warnings by accident.
    const unexpectedConsoleErrors = consoleErrorSpy!.mock.calls.filter(
      (args) =>
        !(
          typeof args[0] === "string" &&
          (args[0] as string).includes(
            "The current testing environment is not configured to support act",
          )
        ),
    );
    expect(unexpectedConsoleErrors).toEqual([]);
  });
});
