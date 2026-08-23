import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { createRef } from "react";
import type { Chapter, ProjectWithChapters } from "@smudge/shared";
import { EditorMainContent } from "./EditorMainContent";
import { STRINGS } from "../strings";

// Backlog 8ff156ec, residual. The persistent read-only lock banner carries
// the Refresh button, which is one of only two documented ways a writer
// gets out of a locked editor (the other is leaving the project). Two e2e
// tests cover both exits — but both run from the EDITOR branch.
//
// The banner's coverage of the other four views is INCIDENTAL: it renders
// above a five-way ternary (trash / no-chapters / preview / dashboard /
// editor) rather than by any rule that says it must. An early return added
// above that column, or the banner moved inside one arm, would strand a
// locked writer on whichever view they happened to be on, and no existing
// test would notice.
//
// This pins the placement, not the behaviour the e2e tests already cover.

// Heavy children are irrelevant to placement and would pull in API calls,
// TipTap, and chart rendering. Stub them to their identity.
vi.mock("./Sidebar", () => ({ Sidebar: () => <aside data-testid="sidebar" /> }));
vi.mock("./TrashView", () => ({ TrashView: () => <div data-testid="trash-view" /> }));
vi.mock("./PreviewMode", () => ({ PreviewMode: () => <div data-testid="preview-view" /> }));
vi.mock("./DashboardView", () => ({ DashboardView: () => <div data-testid="dashboard-view" /> }));
vi.mock("./Editor", () => ({ Editor: () => <div data-testid="editor-view" /> }));
vi.mock("./EditorFooter", () => ({ EditorFooter: () => <div data-testid="footer" /> }));
vi.mock("./ReferencePanel", () => ({ ReferencePanel: () => null }));
vi.mock("./SnapshotPanel", () => ({ SnapshotPanel: () => null }));
vi.mock("./FindReplacePanel", () => ({ FindReplacePanel: () => null }));
vi.mock("./SnapshotBanner", () => ({ SnapshotBanner: () => null }));
vi.mock("./ImageGallery", () => ({ ImageGallery: () => null }));
vi.mock("./OuttakesPanel", () => ({ OuttakesPanel: () => null }));

// RTL's auto-cleanup does NOT run in this project: it registers an afterEach
// only when afterEach is a global, and packages/client/vitest.config.ts does
// not set globals: true. Without this, each render stacks in the same document
// and the queries below match across tests. (Same note as
// hooks/__tests__/useKeyboardShortcuts.test.tsx.)
afterEach(cleanup);

const CHAPTER: Chapter = {
  id: "ch-1",
  project_id: "proj-1",
  title: "Chapter One",
  content: { type: "doc", content: [] },
  sort_order: 1,
  word_count: 0,
  status: "draft",
  created_at: "2026-08-23T00:00:00.000Z",
  updated_at: "2026-08-23T00:00:00.000Z",
  deleted_at: null,
} as unknown as Chapter;

function makeProject(chapters: Chapter[]): ProjectWithChapters {
  return {
    id: "proj-1",
    slug: "proj-1",
    title: "A Project",
    mode: "fiction",
    target_word_count: null,
    target_deadline: null,
    created_at: "2026-08-23T00:00:00.000Z",
    updated_at: "2026-08-23T00:00:00.000Z",
    deleted_at: null,
    author_name: null,
    chapters,
  } as ProjectWithChapters;
}

const LOCK_MESSAGE = "The editor is locked. Refresh to continue.";

/* eslint-disable @typescript-eslint/no-explicit-any -- placement fixture: the
   ~60 collaborator props are irrelevant to where the banner renders, and
   spelling each one out would obscure the four that select the view branch. */
function baseProps(): any {
  return {
    sidebarOpen: true,
    sidebarWidth: 260,
    onSidebarResize: vi.fn(),
    project: makeProject([CHAPTER]),
    activeChapter: CHAPTER,
    showActiveEditor: true,
    viewMode: "editor",
    statuses: [],
    onSelectChapter: vi.fn(),
    onAddChapter: vi.fn(),
    onDeleteChapter: vi.fn(),
    onReorderChapters: vi.fn(),
    onRenameChapter: vi.fn(),
    onOpenTrash: vi.fn(),
    onStatusChange: vi.fn(),
    editorLockedMessage: LOCK_MESSAGE,
    actionError: null,
    onDismissActionError: vi.fn(),
    actionInfo: null,
    onDismissActionInfo: vi.fn(),
    trashOpen: false,
    trashedChapters: [],
    onRestore: vi.fn(),
    onCloseTrash: vi.fn(),
    dashboardRefreshKey: 0,
    viewingSnapshot: null,
    onRestoreSnapshot: vi.fn(),
    onExitSnapshotView: vi.fn(),
    editingTitle: false,
    titleDraft: "",
    setTitleDraft: vi.fn(),
    saveTitle: vi.fn(),
    cancelEditingTitle: vi.fn(),
    startEditingTitle: vi.fn(),
    titleError: null,
    titleInputRef: createRef<HTMLInputElement>(),
    chapterReloadKey: 0,
    editorRef: createRef(),
    onSave: vi.fn(),
    onContentChange: vi.fn(),
    onEditorReady: vi.fn(),
    editorEditable: true,
    onImageAnnouncement: vi.fn(),
    onImageUploadCommitted: vi.fn(),
    chapterWordCount: 0,
    saveStatus: "idle",
    saveErrorMessage: null,
    cacheWarning: false,
    panelOpen: false,
    panelWidth: 320,
    onPanelResize: vi.fn(),
    activeTabId: "notes",
    onSelectTab: vi.fn(),
    galleryExternalRefreshKey: 0,
    onInsertImage: vi.fn(),
    onInsertOuttake: vi.fn(),
    capturedOuttake: null,
    outtakesExternalRefreshKey: 0,
    snapshotPanelOpen: false,
    onCloseSnapshotPanel: vi.fn(),
    snapshotPanelRef: createRef(),
    onSnapshotView: vi.fn(),
    onSnapshotBeforeCreate: vi.fn(),
    onSnapshotsChange: vi.fn(),
    snapshotsTriggerRef: createRef<HTMLButtonElement>(),
    findReplace: { isOpen: false } as any,
    onReplaceOne: vi.fn(),
    onReplaceAllInChapter: vi.fn(),
    onReplaceAllInManuscript: vi.fn(),
    findReplaceTriggerRef: createRef<HTMLButtonElement>(),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// The four props below are the whole ternary: each row picks exactly one
// arm. `marker` is the stub that proves we landed on that arm and not
// another — without it a typo in the selector props would silently test
// the editor branch five times.
const VIEW_BRANCHES = [
  ["trash", { trashOpen: true }, "trash-view"],
  ["no chapters", { showActiveEditor: false, project: makeProject([]) }, null],
  ["preview", { viewMode: "preview" }, "preview-view"],
  ["dashboard", { viewMode: "dashboard" }, "dashboard-view"],
  ["active editor", {}, "editor-view"],
] as const;

describe("EditorMainContent — lock banner renders above every view branch (8ff156ec)", () => {
  it.each(VIEW_BRANCHES)(
    "shows the lock banner and its Refresh escape on the %s branch",
    (_label, overrides, marker) => {
      render(<EditorMainContent {...baseProps()} {...overrides} />);

      // We are on the branch we think we are on.
      if (marker) {
        expect(screen.getByTestId(marker)).toBeInTheDocument();
      } else {
        expect(screen.getByText(STRINGS.project.emptyChapters)).toBeInTheDocument();
      }

      expect(screen.getByText(LOCK_MESSAGE)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: STRINGS.editor.refreshButton }),
      ).toBeInTheDocument();
    },
  );

  it.each(VIEW_BRANCHES)("shows no lock banner when unlocked on the %s branch", (_l, overrides) => {
    render(<EditorMainContent {...baseProps()} {...overrides} editorLockedMessage={null} />);
    expect(screen.queryByText(LOCK_MESSAGE)).toBeNull();
    expect(screen.queryByRole("button", { name: STRINGS.editor.refreshButton })).toBeNull();
  });
});
