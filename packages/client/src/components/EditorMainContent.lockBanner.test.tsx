import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { createRef, type ComponentProps } from "react";
import type { Chapter, ProjectWithChapters } from "@smudge/shared";
import { EditorMainContent } from "./EditorMainContent";
import { STRINGS } from "../strings";
import type { ViewMode } from "../hooks/useKeyboardShortcuts";

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
// S8 (review 2026-08-23): this stub RECORDS the props it was handed. The
// mount-time `editable` prop is one of the two routes machine intent reaches
// TipTap (CLAUDE.md §"Machine intent reaches TipTap by two routes"), and the
// other route -- the imperative setEditable handle -- cannot cover a mount that
// happens while the machine already intends editable:false, because the
// reconcile effect has no dep change to re-run on. Deleting
// `editable={editorEditable}` from EditorMainContent left every test in this
// file and editorEntryPointSurface.test.ts green; only one distant integration
// case in EditorPageFeatures.test.tsx failed. The guarantee belongs next to the
// component that owns the pass-through.
const editorProps: { last: Record<string, unknown> | null } = { last: null };
vi.mock("./Editor", () => ({
  Editor: (props: Record<string, unknown>) => {
    editorProps.last = props;
    return <div data-testid="editor-view" />;
  },
}));
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
afterEach(() => {
  editorProps.last = null;
});

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

// S16 (review 2026-08-23): typed, not `any`. As an `any` this fixture was a
// second, unchecked copy of a ~60-key prop list that
// editorEntryPointSurface.test.ts pins as a forcing pause — spreading it into
// the component suppressed every prop check, so it could silently stop
// selecting the branches it claims to test (a renamed selector prop would just
// become an ignored extra key). Typing it means the compiler fails instead.
function baseProps(): ComponentProps<typeof EditorMainContent> {
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

// S7 (review 2026-08-23): every ViewMode must appear in the table above.
// VIEW_BRANCHES is a hand-maintained literal, so a NEW view mode could be added
// to the component's ternary and silently go untested here. This is a
// compile-time link, not a runtime one: adding a fourth ViewMode without a row
// makes `viewModeCoverage` fail to typecheck. It cannot force a row for a
// non-ViewMode branch (trash, no-chapters), which are selected by other props.
const viewModeCoverage: Record<ViewMode, true> = {
  editor: true,
  preview: true,
  dashboard: true,
};
const TABLE_VIEW_MODES = new Set<string>(
  VIEW_BRANCHES.map(([, overrides]) => ("viewMode" in overrides ? overrides.viewMode : "editor")),
);

describe("EditorMainContent — lock banner renders above every view branch (8ff156ec)", () => {
  it("has a table row for every ViewMode (S7)", () => {
    for (const mode of Object.keys(viewModeCoverage)) {
      expect(TABLE_VIEW_MODES.has(mode), `VIEW_BRANCHES has no row for viewMode "${mode}"`).toBe(
        true,
      );
    }
  });

  it.each(VIEW_BRANCHES)(
    "shows the lock banner and its Refresh escape on the %s branch",
    (_label, overrides, marker) => {
      const { container } = render(<EditorMainContent {...baseProps()} {...overrides} />);

      // We are on the branch we think we are on.
      const viewEl = marker
        ? screen.getByTestId(marker)
        : screen.getByText(STRINGS.project.emptyChapters);
      expect(viewEl).toBeInTheDocument();

      const banner = screen.getByText(LOCK_MESSAGE);
      expect(banner).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: STRINGS.editor.refreshButton }),
      ).toBeInTheDocument();

      // S7: PLACEMENT, not just presence — which is the whole point of this
      // file. getByText finds the banner anywhere in the tree, so moving it
      // inside one arm of the ternary (the regression this file exists to
      // catch) left all ten cases green. Two assertions pin it: the banner
      // precedes the view content in document order, and it is not a
      // descendant of it.
      expect(banner.compareDocumentPosition(viewEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(viewEl.contains(banner)).toBe(false);
      expect(container).toContainElement(banner);
    },
  );

  it.each(VIEW_BRANCHES)("shows no lock banner when unlocked on the %s branch", (_l, overrides) => {
    render(<EditorMainContent {...baseProps()} {...overrides} editorLockedMessage={null} />);
    expect(screen.queryByText(LOCK_MESSAGE)).toBeNull();
    expect(screen.queryByRole("button", { name: STRINGS.editor.refreshButton })).toBeNull();
  });
});

// S8 (review 2026-08-23). Two gaps this file's fixture left open.
//
// First, nothing here asserted that the machine's `editable` intent actually
// reaches the Editor. Deleting `editable={editorEditable}` from
// EditorMainContent.tsx left all ten tests above green — and left
// editorEntryPointSurface.test.ts green too, because that file snapshots prop
// NAMES, not their use. Only one integration case in EditorPageFeatures.test.tsx
// caught it. CLAUDE.md calls this pass-through load-bearing and says not to
// simplify it away; the tripwire now sits beside it.
//
// Second, every render above pairs a live lock with `editorEditable: true` — a
// combination the reducer cannot produce, since COMMITTED_UNRELOADED returns
// `{ editable: false, lock }` in one transition. So the fixture was testing the
// banner against a state that never occurs. The locked case below uses the
// pairing the machine actually emits.
describe("EditorMainContent — mount-time editability reaches the Editor (F-36, S8)", () => {
  it("passes editable=false through when the machine intends read-only", () => {
    render(<EditorMainContent {...baseProps()} editorEditable={false} />);
    expect(screen.getByTestId("editor-view")).toBeInTheDocument();
    expect(editorProps.last?.editable).toBe(false);
  });

  it("passes editable=true through when the machine intends writable", () => {
    render(<EditorMainContent {...baseProps()} editorEditable={true} editorLockedMessage={null} />);
    expect(editorProps.last?.editable).toBe(true);
  });

  // The pairing the reducer actually emits for a committed-but-unreloaded
  // mutation: banner up AND editor read-only, together, in one transition. A
  // mount in this state is the F-36 case — it happens when a mutation is
  // started from a surface with no editor mounted (snapshot view), so the
  // reconcile effect has no dep change to fire on and the prop is the only
  // thing carrying the intent in.
  it("renders the lock banner and a read-only editor together", () => {
    render(<EditorMainContent {...baseProps()} editorEditable={false} />);
    expect(screen.getByText(LOCK_MESSAGE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: STRINGS.editor.refreshButton })).toBeInTheDocument();
    expect(editorProps.last?.editable).toBe(false);
  });
});
