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
  },
  chapter: {
    untitledDefault: "Untitled Chapter",
  },
  editor: {
    placeholder: "Start writing\u2026",
    saving: "Saving\u2026",
    saved: "Saved",
    unsaved: "Unsaved changes",
    saveFailed: "Unable to save \u2014 check connection",
  },
  a11y: {
    mainContent: "Main content",
    chaptersSidebar: "Chapters",
    formattingToolbar: "Formatting",
  },
} as const;
