import { useEffect, useRef } from "react";
import type { Chapter, ProjectWithChapters } from "@smudge/shared";
import { STRINGS } from "../strings";
export type ViewMode = "editor" | "preview" | "dashboard";

interface KeyboardShortcutDeps {
  // Dialog states (for blocking shortcuts)
  shortcutHelpOpen: boolean;
  deleteTarget: Chapter | null;
  projectSettingsOpen: boolean;
  exportDialogOpen: boolean;
  // Current state
  viewMode: ViewMode;
  activeChapter: Chapter | null;
  project: ProjectWithChapters | null;
  chapterWordCount: number;
  // Actions
  flushSave?: () => void;
  setShortcutHelpOpen: React.Dispatch<React.SetStateAction<boolean>>;
  toggleSidebar: () => void;
  handleCreateChapter: () => void;
  handleSelectChapterWithFlush: (id: string) => Promise<void>;
  setWordCountAnnouncement: React.Dispatch<React.SetStateAction<string>>;
  setNavAnnouncement: React.Dispatch<React.SetStateAction<string>>;
  switchToView: (mode: ViewMode) => Promise<void>;
  togglePanel: () => void;
  toggleFindReplace?: () => void;
}

export function useKeyboardShortcuts(deps: KeyboardShortcutDeps) {
  // Use refs so the keydown handler always reads current state without
  // needing to be re-registered on every state change. This eliminates a
  // stale-closure race where the handler fires between a render and the
  // effect that would re-register it with updated values.
  const shortcutHelpOpenRef = useRef(deps.shortcutHelpOpen);
  shortcutHelpOpenRef.current = deps.shortcutHelpOpen;
  const deleteTargetRef = useRef(deps.deleteTarget);
  deleteTargetRef.current = deps.deleteTarget;
  const viewModeRef = useRef(deps.viewMode);
  viewModeRef.current = deps.viewMode;
  const activeChapterRef = useRef(deps.activeChapter);
  activeChapterRef.current = deps.activeChapter;
  const projectRef = useRef(deps.project);
  projectRef.current = deps.project;
  const chapterWordCountRef = useRef(deps.chapterWordCount);
  chapterWordCountRef.current = deps.chapterWordCount;
  const projectSettingsOpenRef = useRef(deps.projectSettingsOpen);
  projectSettingsOpenRef.current = deps.projectSettingsOpen;
  const exportDialogOpenRef = useRef(deps.exportDialogOpen);
  exportDialogOpenRef.current = deps.exportDialogOpen;
  const flushSaveRef = useRef(deps.flushSave);
  flushSaveRef.current = deps.flushSave;
  const handleCreateChapterRef = useRef(deps.handleCreateChapter);
  handleCreateChapterRef.current = deps.handleCreateChapter;
  const toggleSidebarRef = useRef(deps.toggleSidebar);
  toggleSidebarRef.current = deps.toggleSidebar;
  const handleSelectChapterWithFlushRef = useRef(deps.handleSelectChapterWithFlush);
  handleSelectChapterWithFlushRef.current = deps.handleSelectChapterWithFlush;
  const switchToViewRef = useRef(deps.switchToView);
  switchToViewRef.current = deps.switchToView;
  const togglePanelRef = useRef(deps.togglePanel);
  togglePanelRef.current = deps.togglePanel;
  const toggleFindReplaceRef = useRef(deps.toggleFindReplace);
  toggleFindReplaceRef.current = deps.toggleFindReplace;

  useEffect(() => {
    let navAnnouncementTimer: ReturnType<typeof setTimeout> | null = null;

    function handleKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.code === "Slash") {
        const tag = (document.activeElement as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        deps.setShortcutHelpOpen((prev) => !prev);
        return;
      }

      if (shortcutHelpOpenRef.current && e.key === "Escape") {
        e.preventDefault();
        deps.setShortcutHelpOpen(false);
        return;
      }

      // Always intercept Ctrl/Cmd+S so the browser "Save Page" dialog never
      // opens, even when a modal is up. But don't fire the flush while a
      // modal is blocking the editor — that would produce a silent
      // background save the user cannot observe.
      if (ctrl && e.code === "KeyS") {
        e.preventDefault();
        if (
          shortcutHelpOpenRef.current ||
          deleteTargetRef.current ||
          projectSettingsOpenRef.current ||
          exportDialogOpenRef.current
        )
          return;
        flushSaveRef.current?.();
        return;
      }

      // Don't process shortcuts when a dialog is open (focus trap)
      if (
        shortcutHelpOpenRef.current ||
        deleteTargetRef.current ||
        projectSettingsOpenRef.current ||
        exportDialogOpenRef.current
      )
        return;

      // Toggle find-and-replace panel (Ctrl/Cmd+H).
      // Placed after the modal-open guard so the panel can't be toggled
      // underneath a confirmation dialog.
      if (ctrl && e.code === "KeyH") {
        e.preventDefault();
        toggleFindReplaceRef.current?.();
        return;
      }

      if (ctrl && e.shiftKey && e.code === "KeyN") {
        e.preventDefault();
        handleCreateChapterRef.current();
        return;
      }

      if (ctrl && e.shiftKey && e.code === "Backslash") {
        e.preventDefault();
        toggleSidebarRef.current();
        return;
      }

      if (ctrl && e.shiftKey && e.code === "KeyW") {
        e.preventDefault();
        // Clear first so re-pressing announces again even if the count hasn't changed
        deps.setWordCountAnnouncement("");
        requestAnimationFrame(() => {
          deps.setWordCountAnnouncement(STRINGS.project.wordCount(chapterWordCountRef.current));
        });
        return;
      }

      if (ctrl && e.shiftKey && e.code === "KeyP") {
        e.preventDefault();
        const target = viewModeRef.current === "preview" ? "editor" : "preview";
        switchToViewRef.current(target).catch(() => {});
        return;
      }

      if (ctrl && e.code === "Period") {
        e.preventDefault();
        togglePanelRef.current();
        return;
      }

      if (ctrl && e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        const currentProject = projectRef.current;
        const currentChapter = activeChapterRef.current;
        if (viewModeRef.current !== "editor" || !currentChapter || !currentProject) return;
        e.preventDefault();
        const chapters = currentProject.chapters;
        const currentIndex = chapters.findIndex((c) => c.id === currentChapter.id);
        if (currentIndex === -1) return;
        const nextIndex = e.key === "ArrowUp" ? currentIndex - 1 : currentIndex + 1;
        if (nextIndex < 0 || nextIndex >= chapters.length) return;
        const nextChapter = chapters[nextIndex];
        if (!nextChapter) return;
        void handleSelectChapterWithFlushRef.current(nextChapter.id).catch(() => {});
        deps.setNavAnnouncement(STRINGS.sidebar.navigatedToChapter(nextChapter.title));
        if (navAnnouncementTimer !== null) clearTimeout(navAnnouncementTimer);
        navAnnouncementTimer = setTimeout(() => deps.setNavAnnouncement(""), 1000);
        return;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (navAnnouncementTimer !== null) clearTimeout(navAnnouncementTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
