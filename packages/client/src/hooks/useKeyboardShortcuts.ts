import { useEffect, useRef } from "react";
import type { Chapter, ProjectWithChapters } from "@smudge/shared";
import { STRINGS } from "../strings";
import type { EditorHandle } from "../components/Editor";

export type ViewMode = "editor" | "preview" | "dashboard";

interface KeyboardShortcutDeps {
  // Dialog states (for blocking shortcuts)
  shortcutHelpOpen: boolean;
  deleteTarget: Chapter | null;
  settingsOpen: boolean;
  projectSettingsOpen: boolean;
  // Current state
  viewMode: ViewMode;
  activeChapter: Chapter | null;
  project: ProjectWithChapters | null;
  chapterWordCount: number;
  // Refs
  editorRef: React.RefObject<EditorHandle | null>;
  // Actions
  setShortcutHelpOpen: React.Dispatch<React.SetStateAction<boolean>>;
  toggleSidebar: () => void;
  handleCreateChapter: () => void;
  handleSelectChapterWithFlush: (id: string) => Promise<void>;
  setWordCountAnnouncement: React.Dispatch<React.SetStateAction<string>>;
  setNavAnnouncement: React.Dispatch<React.SetStateAction<string>>;
  setTrashOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setViewMode: React.Dispatch<React.SetStateAction<ViewMode>>;
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
  const settingsOpenRef = useRef(deps.settingsOpen);
  settingsOpenRef.current = deps.settingsOpen;
  const projectSettingsOpenRef = useRef(deps.projectSettingsOpen);
  projectSettingsOpenRef.current = deps.projectSettingsOpen;
  const handleCreateChapterRef = useRef(deps.handleCreateChapter);
  handleCreateChapterRef.current = deps.handleCreateChapter;
  const toggleSidebarRef = useRef(deps.toggleSidebar);
  toggleSidebarRef.current = deps.toggleSidebar;
  const handleSelectChapterWithFlushRef = useRef(deps.handleSelectChapterWithFlush);
  handleSelectChapterWithFlushRef.current = deps.handleSelectChapterWithFlush;

  useEffect(() => {
    let navAnnouncementTimer: ReturnType<typeof setTimeout> | null = null;

    function handleKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key === "/") {
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

      // Don't process shortcuts when a dialog is open (focus trap)
      if (
        shortcutHelpOpenRef.current ||
        deleteTargetRef.current ||
        settingsOpenRef.current ||
        projectSettingsOpenRef.current
      )
        return;

      if (ctrl && e.shiftKey && e.key === "N") {
        e.preventDefault();
        handleCreateChapterRef.current();
        return;
      }

      if (ctrl && e.shiftKey && e.key === "\\") {
        e.preventDefault();
        toggleSidebarRef.current();
        return;
      }

      if (ctrl && e.shiftKey && e.key === "W") {
        e.preventDefault();
        // Clear first so re-pressing announces again even if the count hasn't changed
        deps.setWordCountAnnouncement("");
        requestAnimationFrame(() => {
          deps.setWordCountAnnouncement(STRINGS.project.wordCount(chapterWordCountRef.current));
        });
        return;
      }

      if (ctrl && e.shiftKey && e.key === "P") {
        e.preventDefault();
        (deps.editorRef.current?.flushSave() ?? Promise.resolve())
          .then(() => {
            deps.setTrashOpen(false);
            deps.setViewMode((prev) => (prev === "preview" ? "editor" : "preview"));
          })
          .catch(() => {});
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
