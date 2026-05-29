// F-1 decomposition safety net.
//
// EditorPage.tsx is a 2373-line god object (flaw F-1 in the
// 2026-05-29 architecture report). It is about to be decomposed by
// extracting cohesive concern-clusters into hooks/sub-components. The
// existing EditorPageFeatures.test.tsx and KeyboardShortcuts.test.tsx
// already pin the heavily-used paths (find/replace, snapshots, sidebar,
// trash, delete, preview, dashboard, view toggles, title editing,
// status changes, shortcut-help dialog, Ctrl+S / Ctrl+H / Ctrl+Shift+N
// / Ctrl+Shift+Arrow shortcuts).
//
// This file fills the gaps those suites leave in the EditorPage-level
// *wiring* — the trivial-looking state plumbing most at risk of being
// dropped or mis-threaded during a god-object extraction:
//   1. The Export button → ExportDialog `open` plumbing.
//   2. The settings gear → ProjectSettingsDialog mount plumbing.
//   3. The Ctrl+Shift+W → word-count live-region announcement plumbing.
//   4. The reference-panel toggle → ReferencePanel/ImageGallery mount
//      plumbing (the existing suite only pins the toggle-while-LOCKED
//      no-op, never the open-and-render path or its ImageGallery props).
//   5. The logo button → navigate-home plumbing (header seam).
//   6. The nav-announcement live region presence + polite semantics
//      (announcement cluster; its sibling word-count region is the only
//      one pinned today).
// (4)–(6) were added 2026-05-29 ahead of the F-1 render decomposition
// (extracting header / main-content / dialog-cluster sub-components),
// where this wiring is the most likely to be silently dropped.
//
// These are characterization tests: they assert the CURRENT observable
// behavior and must stay green across the decomposition.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorPage } from "../pages/EditorPage";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { api } from "../api/client";
import { STRINGS } from "../strings";

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
        today: "2026-04-12",
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
    images: {
      // ImageGallery (mounted inside ReferencePanel) calls api.images.list
      // on mount; the references call only fires once an image is selected.
      list: vi.fn().mockResolvedValue([]),
    },
  },
}));

beforeEach(() => {
  global.IntersectionObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));
  // showModal/close are not implemented in the test DOM; the open
  // attribute stands in for native dialog visibility.
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  vi.clearAllMocks();
  vi.mocked(api.projects.get).mockResolvedValue(mockProject);
  vi.mocked(api.chapters.get).mockResolvedValue(mockChapter);
  vi.mocked(api.chapterStatuses.list).mockResolvedValue([]);
  vi.mocked(api.settings.get).mockResolvedValue({ timezone: "UTC" });
});

afterEach(() => cleanup());

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
      status: "outline",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      deleted_at: null,
    },
  ],
};

const mockChapter = mockProject.chapters[0]!;

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

async function waitForLoaded() {
  await waitFor(() => {
    expect(screen.getByRole("heading", { level: 2, name: "Chapter One" })).toBeInTheDocument();
  });
}

describe("EditorPage F-1 safety net: Export dialog wiring", () => {
  it("opens the export dialog when the Export button is clicked and closes it again", async () => {
    renderEditorPage();
    await waitForLoaded();

    // ExportDialog returns null while closed; the EditorPage drives its
    // mount via the Export button → exportDialogOpen state → `open` prop.
    expect(screen.queryByRole("heading", { name: STRINGS.export.dialogTitle })).toBeNull();

    await userEvent.click(screen.getByText(STRINGS.export.buttonLabel));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: STRINGS.export.dialogTitle })).toBeInTheDocument();
    });

    // Cancel closes it back down.
    await userEvent.click(screen.getByText(STRINGS.export.cancelButton));
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: STRINGS.export.dialogTitle })).toBeNull();
    });
  });
});

describe("EditorPage F-1 safety net: Project settings dialog wiring", () => {
  it("mounts the project settings dialog when the gear button is clicked and unmounts on close", async () => {
    renderEditorPage();
    await waitForLoaded();

    // ProjectSettingsDialog returns null while closed.
    expect(screen.queryByRole("heading", { name: STRINGS.projectSettings.heading })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: STRINGS.projectSettings.openLabel }));
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: STRINGS.projectSettings.heading }),
      ).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: STRINGS.projectSettings.close }));
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: STRINGS.projectSettings.heading })).toBeNull();
    });
  });
});

describe("EditorPage F-1 safety net: word-count announcement wiring", () => {
  it("populates the word-count live region on Ctrl+Shift+W", async () => {
    renderEditorPage();
    await waitForLoaded();

    const region = screen.getByTestId("word-count-announcement");
    expect(region.textContent).toBe("");

    fireEvent.keyDown(document, { key: "W", code: "KeyW", ctrlKey: true, shiftKey: true });

    // The handler clears then (via requestAnimationFrame) writes the
    // "<n> words" string for the active chapter into the live region.
    await waitFor(() => {
      expect(region.textContent).toMatch(/\d[\d,]* words/);
    });
  });
});

describe("EditorPage F-1 safety net: reference panel wiring", () => {
  it("opens the reference panel (mounting ImageGallery) on toggle and closes it again", async () => {
    renderEditorPage();
    await waitForLoaded();

    // ReferencePanel is gated behind `panelOpen && project`; closed → absent.
    expect(
      screen.queryByRole("complementary", { name: STRINGS.referencePanel.ariaLabel }),
    ).toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: STRINGS.referencePanel.toggleTooltip }),
    );
    await waitFor(() => {
      expect(
        screen.getByRole("complementary", { name: STRINGS.referencePanel.ariaLabel }),
      ).toBeInTheDocument();
    });
    // The ImageGallery inside it mounted and fetched this project's images —
    // proving the projectId prop is threaded correctly, not just the panel
    // visibility flag.
    expect(api.images.list).toHaveBeenCalledWith("proj-1", expect.anything());

    // Toggling again closes it back down.
    await userEvent.click(
      screen.getByRole("button", { name: STRINGS.referencePanel.toggleTooltip }),
    );
    await waitFor(() => {
      expect(
        screen.queryByRole("complementary", { name: STRINGS.referencePanel.ariaLabel }),
      ).toBeNull();
    });
  });
});

describe("EditorPage F-1 safety net: logo navigation wiring", () => {
  it("navigates home when the logo button is clicked", async () => {
    renderEditorPage();
    await waitForLoaded();

    // The logo renders STRINGS.app.name inside the navigate-home button.
    const logoButton = screen.getByText(STRINGS.app.name).closest("button");
    expect(logoButton).not.toBeNull();

    await userEvent.click(logoButton!);
    await waitFor(() => {
      expect(screen.getByText("Home")).toBeInTheDocument();
    });
  });
});

describe("EditorPage F-1 safety net: navigation live region wiring", () => {
  // Presence + semantics characterization (not behavioral): the
  // nav-announcement region's screen-reader contract — it exists, is a
  // polite live region, and starts empty — must survive the dialog/
  // announcement-cluster extraction. Its behavioral population path
  // (Alt+chapter-navigation) is covered by the keyboard-shortcut suite;
  // the EditorPage-level gap is that the region itself had no assertion.
  it("renders the nav-announcement region as an empty polite live region", async () => {
    renderEditorPage();
    await waitForLoaded();

    const region = screen.getByTestId("nav-announcement");
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region.textContent).toBe("");
  });
});
