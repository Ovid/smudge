import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, fireEvent } from "@testing-library/react";
import type { Chapter, ProjectWithChapters } from "@smudge/shared";
import { useKeyboardShortcuts } from "../useKeyboardShortcuts";
import { STRINGS } from "../../strings";

// F-13. Ctrl+Shift+Arrow navigation used to fire its screen-reader
// announcement synchronously on a voided promise, so a blocked navigation
// still announced "Navigated to <chapter>". The editor-lock path deliberately
// shows no banner, so for a screen-reader user the false announcement was the
// ONLY signal — and it said the opposite of what happened. WCAG 2.1 AA is a
// first-class constraint in this project.
//
// Tested at the hook rather than through EditorPage because the refusal being
// asserted is `handleSelectChapterWithFlush` resolving false, and driving that
// through the component means reproducing a busy latch or a mid-flush save
// failure — machinery unrelated to the announcement decision itself.

function makeChapter(id: string, title: string, sortOrder: number): Chapter {
  return {
    id,
    project_id: "p-1",
    title,
    content: null,
    sort_order: sortOrder,
    word_count: 0,
    status: "rough_draft",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
  };
}

const CHAPTER_ONE = makeChapter("ch-1", "Chapter One", 0);
const CHAPTER_TWO = makeChapter("ch-2", "Chapter Two", 1);

const PROJECT = {
  id: "p-1",
  title: "Test Project",
  slug: "test-project",
  mode: "fiction",
  target_word_count: null,
  target_deadline: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  deleted_at: null,
  chapters: [CHAPTER_ONE, CHAPTER_TWO],
} as ProjectWithChapters;

function setup(navigationResult: boolean) {
  const setNavAnnouncement = vi.fn();
  const handleSelectChapterWithFlush = vi.fn().mockResolvedValue(navigationResult);

  renderHook(() =>
    useKeyboardShortcuts({
      shortcutHelpOpen: false,
      deleteTarget: null,
      projectSettingsOpen: false,
      exportDialogOpen: false,
      viewMode: "editor",
      activeChapter: CHAPTER_ONE,
      project: PROJECT,
      chapterWordCount: 0,
      setShortcutHelpOpen: vi.fn(),
      toggleSidebar: vi.fn(),
      handleCreateChapter: vi.fn(),
      handleSelectChapterWithFlush,
      setWordCountAnnouncement: vi.fn(),
      setNavAnnouncement,
      switchToView: vi.fn().mockResolvedValue(true),
      togglePanel: vi.fn(),
    }),
  );

  fireEvent.keyDown(document, { key: "ArrowDown", ctrlKey: true, shiftKey: true });

  return { setNavAnnouncement, handleSelectChapterWithFlush };
}

// S3 (review 2026-08-16). Making the announcement conditional (F-13) also made
// it LATE: it now waits on flushSave — which can sit in save-retry backoff for
// seconds — and then on a chapter GET. In that window a screen-reader user got
// nothing at all, so the keypress read as ignored. A pending announcement fires
// at keypress and is replaced by the outcome.
const PENDING = STRINGS.sidebar.navigatingToChapter("Chapter Two");
const ARRIVED = STRINGS.sidebar.navigatedToChapter("Chapter Two");
// I1 (review 2026-08-16). The refusal path used to clear the live region to "".
// A polite live region announces content ADDITIONS, so a clear is silent — the
// last thing a screen-reader user heard was PENDING, for a navigation that was
// refused and will never happen. The editor-lock path shows no banner by
// design, so that false pending string was the only signal it had.
const REFUSED = STRINGS.sidebar.navigationFailed("Chapter Two");

describe("Ctrl+Shift+Arrow chapter navigation announcement (F-13)", () => {
  it("announces the keypress immediately, before the switch resolves", () => {
    const { setNavAnnouncement } = setup(true);
    // Synchronous — no await. The whole point is that it does not wait on
    // flushSave or the GET.
    expect(setNavAnnouncement).toHaveBeenCalledWith(PENDING);
  });

  it("announces the destination once the navigation actually succeeded", async () => {
    const { setNavAnnouncement, handleSelectChapterWithFlush } = setup(true);

    await waitFor(() => {
      expect(setNavAnnouncement).toHaveBeenCalledWith(ARRIVED);
    });
    expect(handleSelectChapterWithFlush).toHaveBeenCalledWith("ch-2");
  });

  it("announces the refusal, and never claims arrival, on refusal", async () => {
    const { setNavAnnouncement, handleSelectChapterWithFlush } = setup(false);

    await waitFor(() => {
      expect(handleSelectChapterWithFlush).toHaveBeenCalledWith("ch-2");
    });
    // Let any queued microtask/announcement land before asserting absence.
    await Promise.resolve();
    await Promise.resolve();

    expect(setNavAnnouncement).toHaveBeenCalledWith(PENDING);
    // I1: a spoken correction, not a silent clear.
    expect(setNavAnnouncement).toHaveBeenCalledWith(REFUSED);
    expect(setNavAnnouncement).not.toHaveBeenCalledWith(ARRIVED);
  });

  it("announces the refusal, and never claims arrival, when the navigation throws", async () => {
    const setNavAnnouncement = vi.fn();
    const handleSelectChapterWithFlush = vi.fn().mockRejectedValue(new Error("boom"));

    renderHook(() =>
      useKeyboardShortcuts({
        shortcutHelpOpen: false,
        deleteTarget: null,
        projectSettingsOpen: false,
        exportDialogOpen: false,
        viewMode: "editor",
        activeChapter: CHAPTER_ONE,
        project: PROJECT,
        chapterWordCount: 0,
        setShortcutHelpOpen: vi.fn(),
        toggleSidebar: vi.fn(),
        handleCreateChapter: vi.fn(),
        handleSelectChapterWithFlush,
        setWordCountAnnouncement: vi.fn(),
        setNavAnnouncement,
        switchToView: vi.fn().mockResolvedValue(true),
        togglePanel: vi.fn(),
      }),
    );

    fireEvent.keyDown(document, { key: "ArrowDown", ctrlKey: true, shiftKey: true });

    await waitFor(() => {
      expect(handleSelectChapterWithFlush).toHaveBeenCalledWith("ch-2");
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(setNavAnnouncement).toHaveBeenCalledWith(PENDING);
    expect(setNavAnnouncement).toHaveBeenCalledWith(REFUSED);
    expect(setNavAnnouncement).not.toHaveBeenCalledWith(ARRIVED);
  });

  // S2 (review 2026-08-16). Each keypress creates its own `settle` closure, and
  // nothing tied it to "is this still the latest keypress". Press 2's
  // `selectChapterOp.run()` aborts press 1's in-flight GET SYNCHRONOUSLY
  // (useAbortableAsyncOperation.ts), so press 1 rejects with an abort, returns
  // false, and its `settle(false)` lands while press 2 is still loading. That
  // was survivable only while the refusal arm wrote "" (which a polite region
  // never speaks); now that it speaks a real string, a superseded press would
  // announce "Could not navigate to Chapter Two" over a navigation that is
  // genuinely in flight. Same discipline as CLAUDE.md §Save-pipeline invariant
  // 4: bump before, check after.
  it("ignores a superseded keypress's outcome, announcing only the latest", async () => {
    const setNavAnnouncement = vi.fn();
    const deferreds: { resolve: (v: boolean) => void }[] = [];
    const handleSelectChapterWithFlush = vi.fn(
      () => new Promise<boolean>((resolve) => deferreds.push({ resolve })),
    );

    renderHook(() =>
      useKeyboardShortcuts({
        shortcutHelpOpen: false,
        deleteTarget: null,
        projectSettingsOpen: false,
        exportDialogOpen: false,
        viewMode: "editor",
        activeChapter: CHAPTER_ONE,
        project: PROJECT,
        chapterWordCount: 0,
        setShortcutHelpOpen: vi.fn(),
        toggleSidebar: vi.fn(),
        handleCreateChapter: vi.fn(),
        handleSelectChapterWithFlush,
        setWordCountAnnouncement: vi.fn(),
        setNavAnnouncement,
        switchToView: vi.fn().mockResolvedValue(true),
        togglePanel: vi.fn(),
      }),
    );

    // Two presses in flight at once — key autorepeat produces this by
    // construction, and S3 made the outcome late enough to widen the window.
    fireEvent.keyDown(document, { key: "ArrowDown", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(document, { key: "ArrowDown", ctrlKey: true, shiftKey: true });
    expect(deferreds).toHaveLength(2);

    // Press 1 loses its race and reports a refusal (the abort path).
    deferreds[0]!.resolve(false);
    await Promise.resolve();
    await Promise.resolve();

    // The stale outcome must be silent — press 2 is still loading, and the user
    // is owed the pending string until press 2 itself settles.
    expect(setNavAnnouncement).not.toHaveBeenCalledWith(REFUSED);

    // Press 2, the current one, still gets to announce.
    deferreds[1]!.resolve(true);
    await waitFor(() => {
      expect(setNavAnnouncement).toHaveBeenCalledWith(ARRIVED);
    });
  });
});
