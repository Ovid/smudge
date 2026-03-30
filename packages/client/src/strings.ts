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
    deleteChapterAriaLabel: (title: string) => `Delete ${title}`,
    confirmTitle: (name: string) => `Move \u201c${name}\u201d to trash?`,
    confirmBody: "You can restore it within 30 days.",
    confirmButton: "Confirm",
    cancelButton: "Cancel",
  },
  error: {
    projectNotFound: "Project not found",
    backToProjects: "Back to Projects",
    loadFailed: "Failed to load projects",
    loadProjectFailed: "Failed to load project",
    createFailed: "Failed to create project",
    createChapterFailed: "Failed to create chapter",
    loadChapterFailed: "Failed to load chapter",
    deleteChapterFailed: "Failed to delete chapter",
    reorderFailed: "Failed to reorder chapters",
    updateTitleFailed: "Failed to update project title",
    renameChapterFailed: "Failed to rename chapter",
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
    prevChapter: "Previous chapter",
    nextChapter: "Next chapter",
  },
  sidebar: {
    addChapter: "Add Chapter",
    trash: "Trash",
    trashEmpty: "No chapters in trash.",
    restore: "Restore",
    permanentDeleteDate: (deletedAt: string) => {
      const purgeDate = new Date(new Date(deletedAt).getTime() + 30 * 24 * 60 * 60 * 1000);
      return `Permanently deleted ${purgeDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
    },
    backToEditor: "Back to editor",
    dragHandle: "Drag to reorder",
    chapterPosition: (title: string, position: number, total: number) =>
      `Chapter \u201c${title}\u201d moved to position ${position} of ${total}`,
    statusLabel: (label: string) => `Chapter status: ${label}`,
    statusChanged: (label: string) => `Chapter status changed to ${label}`,
    resizeHandle: "Resize sidebar",
    navigatedToChapter: (title: string) => `Navigated to ${title}`,
  },
  preview: {
    backToEditor: "Back to Editor",
    tableOfContents: "Table of Contents",
    renderError: "Unable to render content",
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
    editor: "Editor",
    dashboard: "Dashboard",
    loading: "Loading...",
    totalSuffix: "total",
  },
  dashboard: {
    heading: "Manuscript Dashboard",
    totalWordCount: (count: number) => `${count.toLocaleString()} words`,
    totalChapters: (count: number) => `${count} ${count === 1 ? "chapter" : "chapters"}`,
    mostRecentEdit: (dateStr: string, title: string) => {
      const date = new Date(dateStr);
      return `Most recent: ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} (${title})`;
    },
    leastRecentEdit: (dateStr: string, title: string) => {
      const date = new Date(dateStr);
      return `Least recent: ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} (${title})`;
    },
    emptyState: "No chapters yet",
    columnTitle: "Title",
    columnStatus: "Status",
    columnWordCount: "Word Count",
    columnLastEdited: "Last Edited",
    healthSectionLabel: "Manuscript health",
    statusSummaryLabel: "Status summary",
    statusDistributionLabel: "Chapter status distribution",
  },
} as const;
