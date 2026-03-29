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
    emptyChapters: "No chapters yet. Add one to start writing.",
    wordCount: (count: number) => `${count.toLocaleString()} words`,
    lastEdited: (dateStr: string) => {
      const date = new Date(dateStr);
      return `Edited ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
    },
    lastDeleted: (dateStr: string) => {
      const date = new Date(dateStr);
      return `Deleted ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
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
  error: {
    projectNotFound: "Project not found",
    backToProjects: "Back to Projects",
    loadFailed: "Failed to load projects",
    createFailed: "Failed to create project",
    deleteFailed: "Failed to delete project",
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
  sidebar: {
    addChapter: "Add Chapter",
    trash: "Trash",
    trashEmpty: "No chapters in trash.",
    restore: "Restore",
    backToEditor: "Back to editor",
    dragHandle: "Drag to reorder",
    chapterPosition: (title: string, position: number, total: number) =>
      `Chapter \u201c${title}\u201d moved to position ${position} of ${total}`,
  },
  preview: {
    backToEditor: "Back to Editor",
    tableOfContents: "Table of Contents",
  },
  a11y: {
    mainContent: "Main content",
    chaptersSidebar: "Chapters",
    formattingToolbar: "Formatting",
    chapterTitleInput: "Chapter title",
    projectTitleInput: "Project title",
    editorContent: "Chapter content",
  },
  toolbar: {
    bold: "Bold",
    italic: "Italic",
    heading1: "H3",
    heading2: "H4",
    heading3: "H5",
    quote: "Quote",
    bulletList: "List",
    numberedList: "Numbered",
    horizontalRule: "HR",
  },
  home: {
    projectsHeading: "Projects",
  },
  nav: {
    backToProjects: "\u2190 Projects",
    preview: "Preview",
    loading: "Loading...",
    totalSuffix: "total",
  },
} as const;
