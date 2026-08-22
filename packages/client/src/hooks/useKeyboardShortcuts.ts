import { useEffect, useRef } from "react";
import type { Chapter, ProjectWithChapters } from "@smudge/shared";
import { STRINGS } from "../strings";
import { NAV_ANNOUNCEMENT_DURATION_MS } from "../constants";
export type ViewMode = "editor" | "preview" | "dashboard";

interface KeyboardShortcutDeps {
  // Dialog states (for blocking shortcuts)
  shortcutHelpOpen: boolean;
  deleteTarget: Chapter | null;
  projectSettingsOpen: boolean;
  exportDialogOpen: boolean;
  // True while the Replace-All confirmation dialog is up. Without this,
  // Ctrl+H would toggle the find-replace panel behind the dialog and
  // Ctrl+Shift+N would create a chapter, both of which operate against
  // state the user can't see.
  replaceConfirmOpen?: boolean;
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
  // Resolves true only if `activeChapter` actually became `id`. False covers
  // both halves: switchToView refused (busy latch / editor lock / failed
  // flush-save), or the switch was permitted but the chapter never loaded —
  // GET rejected, request aborted, or superseded by a newer selection (I1).
  // Either way the user is still on the old chapter, so callers must not
  // report success (F-13).
  handleSelectChapterWithFlush: (id: string) => Promise<boolean>;
  setWordCountAnnouncement: React.Dispatch<React.SetStateAction<string>>;
  setNavAnnouncement: React.Dispatch<React.SetStateAction<string>>;
  switchToView: (mode: ViewMode) => Promise<boolean>;
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
  const replaceConfirmOpenRef = useRef(deps.replaceConfirmOpen ?? false);
  replaceConfirmOpenRef.current = deps.replaceConfirmOpen ?? false;
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
    // The nav announcement now resolves after an await (F-13), so it can land
    // after unmount. Nothing else in this effect is async.
    let unmounted = false;
    // S2 (review 2026-08-16): which Ctrl+Shift+Arrow press owns the live region.
    // Presses overlap by construction (key autorepeat), and press N+1 aborts
    // press N's in-flight GET synchronously, so press N resolves false FIRST —
    // while press N+1 is still loading. Without this, that stale refusal speaks
    // over a navigation that is genuinely in flight. Bump before, check after,
    // matching CLAUDE.md §Save-pipeline invariant 4.
    let navEpoch = 0;

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
          exportDialogOpenRef.current ||
          replaceConfirmOpenRef.current
        )
          return;
        flushSaveRef.current?.();
        return;
      }

      // Don't process shortcuts when a dialog is open (focus trap). The
      // Replace-All confirmation is explicitly listed — otherwise Ctrl+H
      // could toggle the find-replace panel behind the dialog and Ctrl+Shift+N
      // could create a chapter the user can't see.
      if (
        shortcutHelpOpenRef.current ||
        deleteTargetRef.current ||
        projectSettingsOpenRef.current ||
        exportDialogOpenRef.current ||
        replaceConfirmOpenRef.current
      )
        return;

      // Toggle find-and-replace panel (Ctrl/Cmd+H).
      // Placed after the modal-open guard so the panel can't be toggled
      // underneath a confirmation dialog. Skip when the user is typing
      // in an unrelated input or textarea — muscle-memory Ctrl+H while
      // editing some other field shouldn't open/close the panel. Ctrl+H
      // while focused on the panel's own find/replace inputs is NOT
      // guarded: the panel just focused its search input on open, and
      // the user's clear intent for "Ctrl+H again" is to toggle closed.
      if (ctrl && e.code === "KeyH") {
        const active = document.activeElement as HTMLElement | null;
        const tag = active?.tagName;
        const id = active?.id;
        const isFindReplaceInput = id === "find-replace-search" || id === "find-replace-replace";
        if ((tag === "INPUT" || tag === "TEXTAREA") && !isFindReplaceInput) return;
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
        // F-13: announce only once the navigation has actually happened.
        // handleSelectChapterWithFlush resolves false when switchToView
        // refused — the busy latch, the editor lock, or a failed flush-save —
        // and (I1) when the switch was permitted but the chapter GET failed,
        // aborted, or was superseded. The editor-lock path shows no banner by
        // design, so announcing unconditionally told a screen-reader user the
        // one thing they had to go on, and told them the opposite of the truth.
        // S3: the outcome announcement below waits on flushSave — seconds, if
        // a save is in retry backoff — and then on a chapter GET. Announce the
        // keypress now so the user knows it registered; the outcome replaces
        // this string, whichever way it goes (I1).
        if (navAnnouncementTimer !== null) clearTimeout(navAnnouncementTimer);
        deps.setNavAnnouncement(STRINGS.sidebar.navigatingToChapter(nextChapter.title));
        const myEpoch = ++navEpoch;
        const settle = (navigated: boolean) => {
          if (unmounted || myEpoch !== navEpoch) return;
          // I1: both outcomes SPEAK. The refusal arm used to clear to "", but a
          // polite live region announces content additions — emptying it says
          // nothing, so the pending string above stayed the last thing spoken
          // for a navigation that was refused.
          //
          // S7 (agentic review 2026-08-22): this used to add "the editor-lock
          // path shows no banner by design, making this the only correction it
          // can offer." That is no longer true — switchToView now answers a
          // lock refusal with STRINGS.editor.lockedRefusal in a polite
          // role="status" banner, so on the lock path a screen reader hears
          // two announcements. Kept deliberately: they carry different facts.
          // The banner says WHY nothing happened ("the editor is locked"); this
          // says WHAT was refused, naming the chapter. Neither substitutes for
          // the other, and both are polite rather than assertive. Revisit only
          // if the pair proves chatty in real use.
          deps.setNavAnnouncement(
            navigated
              ? STRINGS.sidebar.navigatedToChapter(nextChapter.title)
              : STRINGS.sidebar.navigationFailed(nextChapter.title),
          );
          if (navAnnouncementTimer !== null) clearTimeout(navAnnouncementTimer);
          navAnnouncementTimer = setTimeout(
            () => deps.setNavAnnouncement(""),
            NAV_ANNOUNCEMENT_DURATION_MS,
          );
        };
        void handleSelectChapterWithFlushRef
          .current(nextChapter.id)
          .then(settle)
          .catch(() => {
            // Navigation failed outright — same as a refusal.
            settle(false);
          });
        return;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      unmounted = true;
      document.removeEventListener("keydown", handleKeyDown);
      if (navAnnouncementTimer !== null) clearTimeout(navAnnouncementTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
