export const STRINGS = {
  app: {
    name: "Smudge",
  },
  project: {
    createNew: "New Project",
    titlePlaceholder: "Project title",
    fiction: "Fiction",
    nonfiction: "Non-fiction",
    modeLabel: "Project type",
    createButton: "Create",
    cancelButton: "Cancel",
    emptyState: "No projects yet. Create one to start writing.",
    wordCount: (count: number) => `${count.toLocaleString()} words`,
    lastEdited: (dateStr: string) => {
      const date = new Date(dateStr);
      return `Edited ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
    },
  },
  chapter: {
    untitledDefault: "Untitled Chapter",
  },
  delete: {
    buttonLabel: "Delete",
    confirmTitle: (name: string) => `Move \u201c${name}\u201d to trash?`,
    confirmBody: "You can restore it within 30 days.",
    confirmButton: "Confirm",
    cancelButton: "Cancel",
  },
  editor: {
    placeholder: "Start writing\u2026",
    saving: "Saving\u2026",
    saved: "Saved",
    unsaved: "Unsaved changes",
    saveFailed: "Unable to save \u2014 check connection",
  },
  shortcuts: {
    dialogTitle: "Keyboard Shortcuts",
    togglePreview: "Toggle preview",
    newChapter: "New chapter",
    toggleSidebar: "Toggle sidebar",
    showShortcuts: "Keyboard shortcuts",
  },
  a11y: {
    mainContent: "Main content",
    chaptersSidebar: "Chapters",
    formattingToolbar: "Formatting",
  },
} as const;
