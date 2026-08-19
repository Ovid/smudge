import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { EditorPage } from "../pages/EditorPage";
import { api } from "../api/client";

// Safety net for F-32 (architecture report 2026-08-11). EditorPage's image
// announcement clears on an inline `3000` that duplicates ImageGallery's
// module-private ANNOUNCEMENT_DURATION for the same concept; F-32 gives the two
// one owner. This site had NO coverage of any kind for the dwell time, so the
// refactor could have changed how long a screen reader has to speak an image
// insert with nothing going red.
//
// Driven through a mock Editor because onImageAnnouncement is invoked by the
// real Editor's image insert/upload flow, which needs a live TipTap instance to
// reach. What is under test is EditorPage's timer, not how the message is
// produced, so the mock hands the callback straight to the test.

const { mockControls } = vi.hoisted(() => ({
  mockControls: { announce: null as null | ((message: string) => void) },
}));

vi.mock("../components/Editor", async () => {
  const React = await import("react");
  function Editor(props: {
    editorRef?: { current: unknown };
    onEditorReady?: (e: unknown) => void;
    onImageAnnouncement?: (message: string) => void;
  }) {
    const { editorRef, onEditorReady, onImageAnnouncement } = props;
    React.useEffect(() => {
      const fake = { isEditable: true, isActive: () => false, setEditable: () => {} };
      if (editorRef) {
        editorRef.current = {
          editor: fake,
          insertImage: () => {},
          markClean: () => {},
          setEditable: () => {},
          flushSave: () => Promise.resolve(true),
        };
      }
      onEditorReady?.(fake);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // Kept fresh rather than captured once: EditorPage passes an inline closure,
    // so a stale first-render copy would call into a dead render's setState.
    mockControls.announce = onImageAnnouncement ?? null;
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
          today: "2026-08-19",
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

const MESSAGE = "Image inserted: hero.png";
const DWELL_MS = 3000;

describe("EditorPage image announcement dwell time (F-32 safety net)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockControls.announce = null;
    vi.mocked(api.projects.get).mockResolvedValue(mockProject);
    vi.mocked(api.chapters.get).mockResolvedValue(mockChapter);
  });

  afterEach(() => {
    // S4 (agentic review 2026-08-19): cleanup() BEFORE useRealTimers(), so the
    // unmount runs against the clock the timer was armed on. Reversed, the fake
    // clock is already gone when EditorPage's unmount effect calls clearTimeout,
    // and the handle it clears means nothing.
    //
    // Ordering alone does not DETECT a missing unmount cleanup — measured, not
    // assumed: with the two dwell tests only, deleting EditorPage's cleanup
    // (EditorPage.tsx:576-582) left this file green in either order, because
    // nothing observed anything after the unmount. The third test below is what
    // supplies the observation; this ordering is what lets it see a live clock.
    cleanup();
    vi.useRealTimers();
  });

  async function renderAndAnnounce() {
    const { unmount } = render(
      <MemoryRouter initialEntries={["/projects/test-project"]}>
        <Routes>
          <Route path="/projects/:slug" element={<EditorPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("mock-editor")).toBeInTheDocument();
    });
    // Fake AFTER mount: the page's own load timers are irrelevant here, and
    // faking earlier would stall waitFor above on its polling interval.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    act(() => {
      mockControls.announce?.(MESSAGE);
    });
    expect(screen.getByText(MESSAGE)).toBeInTheDocument();
    return { unmount };
  }

  it("still shows the announcement one tick before the dwell time expires", async () => {
    await renderAndAnnounce();
    act(() => {
      vi.advanceTimersByTime(DWELL_MS - 1);
    });
    expect(screen.getByText(MESSAGE)).toBeInTheDocument();
  });

  it("clears the announcement exactly on the dwell time", async () => {
    await renderAndAnnounce();
    act(() => {
      vi.advanceTimersByTime(DWELL_MS);
    });
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });

  // S4 (agentic review 2026-08-19). The two tests above pin the dwell time
  // while the page is MOUNTED; neither could fail if EditorPage's unmount
  // cleanup were deleted, because a stale pending timer harms nothing they
  // look at. This one observes the timer itself: armed by the announcement,
  // and gone once the page unmounts.
  //
  // vi.getTimerCount() rather than a spy on clearTimeout, so the assertion is
  // about the outcome (no timer is still pending) instead of the mechanism.
  // The count is exactly 1 because this path arms no other setTimeout — the
  // auto-save debounce lives in the mocked Editor, and the page's load timers
  // have settled before the fake clock is installed.
  it("clears the pending announcement timer when the page unmounts", async () => {
    const { unmount } = await renderAndAnnounce();
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
