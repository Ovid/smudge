import { UNTITLED_CHAPTER, TRASH_RETENTION_DAYS, TRASH_RETENTION_MS } from "@smudge/shared";

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
    untitledDefault: UNTITLED_CHAPTER,
  },
  delete: {
    buttonLabel: "Delete",
    deleteChapterAriaLabel: (title: string) => `Delete chapter ${title}`,
    deleteProjectAriaLabel: (title: string) => `Delete project ${title}`,
    confirmTitle: (name: string) => `Move \u201c${name}\u201d to trash?`,
    confirmBody: `You can restore it within ${TRASH_RETENTION_DAYS} days.`,
    confirmButton: "Confirm",
    cancelButton: "Cancel",
  },
  error: {
    // I4 shared default for the ambiguous-commit UX: used as the
    // committed: entry of any mutation scope that does not declare a
    // more-specific banner. Surfaces when a 2xx response body fails to
    // parse — the server likely committed the mutation but the client
    // cannot confirm, so a retry would be unsafe.
    possiblyCommitted:
      "The request may have completed, but the server response was unreadable. Refresh the page to see the current state before trying again.",
    projectNotFound: "Project not found",
    backToProjects: "Back to Projects",
    loadFailed: "Failed to load projects",
    loadFailedNetwork: "Failed to load projects — check your connection and try again.",
    loadProjectFailed: "Failed to load project",
    loadProjectFailedNetwork: "Failed to load project — check your connection and try again.",
    createFailed: "Failed to create project",
    projectTitleExists: "A project with this title already exists. Choose a different title.",
    // I12 (review 2026-04-24): network: overrides for mutation scopes
    // so NETWORK errors surface a "check your connection" hint instead
    // of collapsing to the generic fallback.
    createFailedNetwork: "Failed to create project — check your connection and try again.",
    deleteFailedNetwork: "Failed to delete project — check your connection and try again.",
    updateTitleFailedNetwork:
      "Failed to update project title — check your connection and try again.",
    createChapterFailedNetwork: "Failed to create chapter — check your connection and try again.",
    deleteChapterFailedNetwork: "Failed to delete chapter — check your connection and try again.",
    renameChapterFailedNetwork: "Failed to rename chapter — check your connection and try again.",
    reorderFailedNetwork: "Failed to reorder chapters — check your connection and try again.",
    statusChangeFailedNetwork:
      "Failed to update chapter status — check your connection and try again.",
    restoreChapterFailedNetwork: "Failed to restore chapter — check your connection and try again.",
    settingsUpdateFailedNetwork: "Unable to save settings — check your connection and try again.",
    createChapterFailed: "Failed to create chapter",
    createChapterResponseUnreadable:
      "The chapter may have been created, but the server response was unreadable. Refresh to see the current chapter list.",
    createChapterReadAfterFailure:
      "The chapter was created but could not be retrieved. Refresh to see the current chapter list — do not click Add chapter again.",
    // I13 (review 2026-04-24): the project was soft-deleted between
    // gallery/sidebar render and the Add-Chapter click landing. The
    // generic "Failed to create chapter" invites retry, which would
    // 404 again. Tell the user the project is gone so they navigate
    // away.
    createChapterProjectGone:
      "This project has been deleted. Navigate to Home to see the current project list.",
    loadChapterFailed: "Failed to load chapter",
    loadChapterFailedNetwork: "Failed to load chapter — check your connection and try again.",
    deleteChapterFailed: "Failed to delete chapter",
    reorderFailed: "Failed to reorder chapters",
    reorderMismatch: "The chapter list is out of sync. Refresh and try again.",
    updateTitleFailed: "Failed to update project title",
    updateTitleResponseUnreadable:
      "The title change may have been saved, but the server response was unreadable. Refresh the page to see the current project title.",
    // I4 (review 2026-04-24): shown when the rename-committed recovery
    // GET 404s — the slug moved and the old slug is dead. The banner
    // locks the editor (auto-save is disabled while it's non-null)
    // because every subsequent PATCH/POST against projectSlugRef would
    // 404 until the user reloads.
    updateTitleProjectSlugLost:
      "This project was renamed and moved to a new URL. Refresh the page to continue editing.",
    renameChapterFailed: "Failed to rename chapter",
    deleteFailed: "Failed to delete project",
    loadTrashFailed: "Failed to load trash",
    loadTrashFailedNetwork: "Failed to load trash — check your connection and try again.",
    restoreChapterFailed: "Failed to restore chapter",
    restoreChapterProjectPurged: "Can't restore — the parent project was permanently deleted.",
    restoreChapterAlreadyPurged: "Can't restore — this chapter was permanently deleted.",
    restoreChapterSlugConflict:
      "Can't restore — another chapter is using this title. Rename the conflicting chapter and try again.",
    restoreChapterCommitted:
      "The chapter may have been restored but the server response was unreadable. Refresh to confirm.",
    loadDashboardFailed: "Failed to load dashboard",
    loadDashboardFailedNetwork: "Failed to load dashboard — check your connection and try again.",
    statusChangeFailed: "Failed to update chapter status",
    statusChangeResponseUnreadable:
      "The status change may have been saved, but the server response was unreadable. Refresh to see the current status.",
    reorderResponseUnreadable:
      "The chapter reorder may have been saved, but the server response was unreadable. Refresh to see the current order.",
    statusesFetchFailed: "Failed to load chapter statuses — status changes unavailable",
    statusesFetchFailedNetwork:
      "Failed to load chapter statuses — check your connection and try again.",
    settingsUpdateFailedGeneric: "Unable to save settings.",
    settingsLoadFailed: "Unable to load settings. Close and reopen the dialog to retry.",
    settingsLoadFailedNetwork:
      "Unable to load settings — check your connection. Close and reopen the dialog to retry.",
  },
  editor: {
    placeholder: "Start writing\u2026",
    saving: "Saving\u2026",
    saved: "Saved",
    unsaved: "Unsaved changes",
    saveFailed: "Unable to save \u2014 try again.",
    saveFailedNetwork: "Unable to save \u2014 check your connection.",
    saveFailedChapterGone: "This chapter no longer exists. Reload to continue.",
    saveFailedInvalid:
      "Unable to save \u2014 the chapter content is invalid. Undo recent changes or reload the page.",
    saveFailedTooLarge:
      "Unable to save \u2014 the chapter is too large. Split it into shorter chapters before continuing.",
    saveCommittedUnreadable:
      "Your save may have completed, but the server response was unreadable. Refresh the page before continuing \u2014 editing now could overwrite the saved content.",
    saveFailedCorrupt:
      "Unable to save \u2014 the chapter content on the server is corrupted. Reload the page before continuing.",
    cacheUnavailable: "Local backup unavailable",
    viewSwitchSaveFailed:
      "Unable to save pending changes. Try again once your connection recovers before switching views.",
    mutationBusy: "Another operation is in progress — please wait.",
    lockedRefusal: "The editor is locked — refresh the page before continuing.",
    refreshButton: "Refresh page",
  },
  shortcuts: {
    dialogTitle: "Keyboard Shortcuts",
    togglePreview: "Toggle preview",
    newChapter: "New chapter",
    toggleSidebar: "Toggle sidebar",
    showShortcuts: "Keyboard shortcuts",
    prevChapter: "Previous chapter",
    nextChapter: "Next chapter",
    announceWordCount: "Announce word count",
    keyTogglePreview: "Ctrl+Shift+P",
    keyNewChapter: "Ctrl+Shift+N",
    keyToggleSidebar: "Ctrl+Shift+\\",
    keyPrevChapter: "Ctrl+Shift+\u2191",
    keyNextChapter: "Ctrl+Shift+\u2193",
    keyAnnounceWordCount: "Ctrl+Shift+W",
    keyShowShortcuts: "Ctrl+/",
    save: "Save now",
    keySave: "Ctrl+S",
    toggleReferencePanel: "Toggle reference panel",
    keyToggleReferencePanel: "Ctrl+.",
    findReplace: "Find and replace",
    keyFindReplace: "Ctrl+H",
  },
  sidebar: {
    addChapter: "Add Chapter",
    trash: "Trash",
    trashEmpty: "No chapters in trash.",
    restore: "Restore",
    permanentDeleteDate: (deletedAt: string) => {
      const purgeDate = new Date(new Date(deletedAt).getTime() + TRASH_RETENTION_MS);
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
    dismissError: "Dismiss error",
    dismissInfo: "Dismiss info",
    viewModesNav: "View modes",
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
    columnOrder: "#",
    columnTitle: "Title",
    columnStatus: "Status",
    columnWordCount: "Word Count",
    columnLastEdited: "Last Edited",
    healthSectionLabel: "Manuscript health",
    statusSummaryLabel: "Status summary",
    statusDistributionLabel: "Chapter status distribution",
    sortAscending: " \u2191",
    sortDescending: " \u2193",
  },
  velocity: {
    progressLabel: "Writing progress",
    emptyState: "Start writing to see your progress.",
    loadError: "Unable to load progress data.",
    loadErrorNetwork: "Unable to load progress data — check your connection and try again.",
    dailyAverage: (count: number) => `Recent pace: ${count.toLocaleString()}/day`,
    requiredPace: (count: number) => `Needed pace: ${count.toLocaleString()}/day`,
    daysRemaining: (count: number) => `${count} ${count === 1 ? "day" : "days"} left`,
    deadlineReached: "Deadline reached",
    wordsOfTarget: (current: number, target: number) =>
      `${current.toLocaleString()} / ${target.toLocaleString()} words`,
    wordsTotal: (count: number) => `${count.toLocaleString()} words`,
    wordsToday: (count: number) => `${count.toLocaleString()} words today`,
    projectedDate: (date: string) => {
      const d = new Date(date + "T00:00:00Z");
      return `Projected: ${d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
    },
  },
  settings: {
    heading: "Settings",
    timezoneLabel: "Timezone",
    save: "Save",
    cancel: "Cancel",
    saveError: "Failed to save settings. Please try again.",
  },
  projectSettings: {
    heading: "Project Settings",
    openLabel: "Open project settings",
    wordCountTarget: "Word count target",
    deadline: "Deadline",
    clear: "Clear",
    close: "Close",
    wordCountPlaceholder: "e.g. 80000",
    authorName: "Author name",
    authorNamePlaceholder: "e.g. Jane Doe",
    saveError: "Failed to save. Please try again.",
    saveNetworkError: "Failed to save — check your connection and try again.",
    saveResponseUnreadable:
      "The setting may have been saved, but the server response was unreadable. Refresh to see the current values.",
    saveInvalid: "The value you entered is not valid.",
    saveNotFound: "This project is no longer available.",
  },
  export: {
    buttonLabel: "Export",
    dialogTitle: "Export Manuscript",
    formatLabel: "Format",
    formatHtml: "HTML",
    formatMarkdown: "Markdown",
    formatPlainText: "Plain Text",
    formatDocx: "Word (.docx)",
    formatEpub: "EPUB",
    includeTocLabel: "Include table of contents",
    chapterSelectionAll: "All chapters",
    chapterSelectionChoose: "Select specific chapters...",
    exportButton: "Export",
    exportingButton: "Exporting...",
    cancelButton: "Cancel",
    success: (title: string) => `Exported "${title}"`,
    errorFailed: "Export failed. Please try again.",
    // I2 (review 2026-04-25): a NETWORK classification yielded the
    // generic errorFailed copy because the export.run scope only
    // declared a fallback. Mirror sibling mutation/GET scopes:
    // network gets the actionable "check your connection" hint.
    errorFailedNetwork: "Export failed — check your connection and try again.",
    // I2 (review 2026-04-25): a 413 export-too-large was indistinguishable
    // from a server error. Surface the actionable "select fewer chapters"
    // hint so the user can recover without retrying the same too-large
    // request.
    errorTooLarge: "Export is too large. Try selecting fewer chapters and exporting again.",
    close: "Close export dialog",
    epubCoverImageLabel: "Cover image",
    epubCoverImageNone: "None",
    docxWebpWarning: "Some images use WebP format, which may not display in Word 2016 or earlier.",
  },
  referencePanel: {
    ariaLabel: "Reference panel",
    resizeHandle: "Resize reference panel",
    toggleTooltip: "Toggle reference panel (Ctrl+.)",
    imagesTab: "Images",
  },
  imageGallery: {
    uploadButton: "Upload image",
    noImages: "No images yet. Upload one to get started.",
    unusedBadge: "unused",
    noAltText: "No alt text",
    altTextLabel: "Alt text",
    captionLabel: "Caption",
    sourceLabel: "Source",
    licenseLabel: "License",
    saveButton: "Save",
    insertButton: "Insert at cursor",
    deleteButton: "Delete",
    backToGrid: "Back to gallery",
    deleteConfirm: "Delete this image?",
    deleteBlocked: (chapters: string[]) =>
      `This image is used in: ${chapters.join(", ")}. Remove it from those chapters first.`,
    deleteBlockedPrefix: "This image is used in:",
    deleteBlockedSuffix: "Remove it from those chapters first.",
    uploadSuccess: (filename: string) => `Image uploaded: ${filename}`,
    insertSuccess: (filename: string) => `Image inserted: ${filename}`,
    usedInChapters: "Used in",
    saving: "Saving...",
    saved: "Saved",
    fileTooLarge: "File too large. Maximum: 10MB.",
    deleteSuccess: (filename: string) => `Image deleted: ${filename}`,
    saveFailed: "Save failed. Your changes have not been saved.",
    saveFailedNetwork: "Save failed — check your connection and try again.",
    deleteBlockedLoading: "This image is in use. Loading details...",
    inTrash: "in trash",
    loadFailed: "Failed to load images.",
    loadFailedNetwork: "Failed to load images — check your connection and try again.",
    referencesLoadFailed: "Failed to load references for this image.",
    referencesLoadFailedNetwork:
      "Failed to load references for this image — check your connection and try again.",
    retryButton: "Retry",
    uploadFailedGeneric: "Upload failed. Check your connection and try again.",
    uploadInvalidFile:
      "We couldn't upload that file. Check that it's a supported image type (PNG, JPG, GIF, or WebP) and that the file isn't empty.",
    uploadProjectGone: "This project has been deleted. Uploads aren't available.",
    uploadCommittedRefresh:
      "The upload may have completed but the server response was unreadable. Check the image gallery — refresh if needed — before trying again.",
    deleteFailedGeneric: "Delete failed. Try again.",
    deleteFailedNetwork: "Delete failed — check your connection and try again.",
    deleteBlockedInUse: "This image is in use. Remove it from those chapters first.",
  },
  snapshots: {
    panelTitle: "Snapshots",
    toolbarLabel: (count: number | null) =>
      count != null && count > 0 ? `Snapshots (${count})` : "Snapshots",
    createButton: "Create Snapshot",
    labelPlaceholder: "Optional label (e.g., 'before major rewrite')",
    save: "Save",
    cancel: "Cancel",
    untitled: "Untitled snapshot",
    auto: "auto",
    view: "View",
    delete: "Delete",
    deleteConfirm: "Delete this snapshot? This cannot be undone.",
    deleteConfirmButton: "Delete",
    deleteCancel: "Cancel",
    restoreButton: "Restore",
    actionsUnavailableWhileLocked:
      "Unavailable — the editor is locked. Refresh the page before continuing.",
    restoreConfirm:
      "Replace current chapter content with this snapshot? A snapshot of your current content will be saved automatically.",
    restoreFailed: "Unable to restore snapshot. Try again.",
    restoreNetworkFailed: "Unable to restore snapshot — check your connection and try again.",
    restoreFailedCorrupt:
      "This snapshot is corrupt and can't be restored. It will remain in the list; create a new snapshot or restore a different one.",
    restoreFailedCrossProjectImage:
      "This snapshot references images that no longer belong to this project. It can't be restored safely.",
    restoreFailedNotFound:
      "This snapshot no longer exists. Refresh to see the latest snapshot list.",
    restoreFailedSaveFirst:
      "Unable to save pending changes. Try again once your connection recovers before restoring.",
    restoreSucceededReloadFailed:
      "Snapshot restored, but reloading the chapter failed. Refresh the page before editing — editing now would overwrite the restore.",
    restoreResponseUnreadable:
      "The restore may have completed, but the server response was unreadable. Refresh the page to see the current state — editing now could overwrite the restored content.",
    // I6 (review 2026-04-25): chapter-attributed copy for the case
    // where the user has navigated away from the chapter the restore
    // targeted. Without naming the originating chapter, the banner
    // looked like it referred to the chapter the user is now reading;
    // they would refresh against the wrong context and lose track of
    // which chapter has unverified state.
    restoreResponseUnreadableOnOtherChapter: (chapterTitle: string) =>
      `The restore of "${chapterTitle}" may have completed, but the server response was unreadable. Switch back to that chapter and refresh the page before editing it — editing now could overwrite the restored content.`,
    renderError: "Unable to render snapshot content",
    backToEditing: "Back to editing",
    viewingBanner: (label: string, date: string) => `Viewing snapshot: ${label} — ${date}`,
    viewingRegionLabel: "Snapshot viewing banner",
    emptyState: "No snapshots yet. Create one to save a checkpoint of your work.",
    count: (manual: number, auto: number) =>
      `${manual + auto} snapshots (${manual} manual, ${auto} auto)`,
    wordCount: (count: number) => `${count.toLocaleString()} words`,
    duplicateSkipped: "Content unchanged since last snapshot.",
    createFailed: "Unable to create snapshot. Save your unsaved changes and try again.",
    createFailedGeneric: "Unable to create snapshot. Try again.",
    createFailedNetwork: "Unable to create snapshot — check your connection and try again.",
    deleteFailed: "Unable to delete snapshot. Try again.",
    deleteFailedNetwork: "Unable to delete snapshot — check your connection and try again.",
    listFailed: "Unable to load snapshots. Try opening the panel again.",
    listFailedNetwork: "Unable to load snapshots — check your connection and try again.",
    viewFailed: "Unable to open snapshot. Try again.",
    viewFailedNotFound: "This snapshot no longer exists. Refresh to see the latest snapshot list.",
    viewFailedCorrupt: "This snapshot is corrupt and can't be displayed.",
    viewFailedNetwork: "Unable to open snapshot. Check your connection and try again.",
    viewFailedSaveFirst:
      "Unable to save pending changes. Try again once your connection recovers before viewing a snapshot.",
    // I6 / S6: viewSnapshot returns {ok:true, superseded:"chapter"} when
    // the user switched chapters mid-fetch. Before I6 the click produced
    // no feedback at all (the panel's !res.ok gate ignored ok:true), so
    // the user saw a dead View button. This copy fires ONLY for the
    // actual chapter-switch case — same-chapter rapid reclicks return
    // superseded:"sameChapterNewer" and the panel stays silent (S6).
    viewStaleChapterSwitch:
      "This snapshot belongs to a different chapter. Select that chapter to view it.",
    ariaLabel: "Chapter snapshots",
    relativeTime: {
      justNow: "just now",
      minutes: (n: number) => `${n}m ago`,
      hours: (n: number) => `${n}h ago`,
      days: (n: number) => `${n}d ago`,
    },
  },
  findReplace: {
    panelTitle: "Find and Replace",
    findLabel: "Find",
    replaceLabel: "Replace",
    closeLabel: "Close",
    searching: "Searching...",
    searchPlaceholder: "Search...",
    replacePlaceholder: "Replace with...",
    matchCase: "Match case",
    wholeWord: "Whole word",
    regex: "Regular expression",
    replaceFailed: "Replace failed. Try again.",
    replaceNetworkFailed: "Replace failed — check your connection and try again.",
    replaceFailedSaveFirst:
      "Unable to save pending changes. Try again once your connection recovers before replacing.",
    replaceSucceededReloadFailed:
      "Replace succeeded, but reloading the chapter failed. Refresh the page before editing — editing now would overwrite the replacement.",
    replaceResponseUnreadable:
      "The replace may have completed, but the server response was unreadable. Refresh the page to see the current state before retrying — retrying without refreshing could replace twice.",
    replaceScopeNotFound: "The chapter for this replace is no longer available.",
    replaceProjectNotFound: "This project is no longer available.",
    searchProjectNotFound: "This project is no longer available.",
    replaceSuccess: (count: number) => `Replaced ${count} occurrence${count === 1 ? "" : "s"}.`,
    noMatches: "No matches found",
    matchCount: (count: number, chapters: number) =>
      `Found ${count} occurrence${count === 1 ? "" : "s"} in ${chapters} chapter${chapters === 1 ? "" : "s"}`,
    replaceOne: "Replace",
    replaceAllInChapter: "Replace All in Chapter",
    replaceAllInManuscript: "Replace All in Manuscript",
    replaceAllInManuscriptDelete: "Delete All in Manuscript",
    replaceConfirmTitle: "Replace across manuscript?",
    replaceChapterConfirmTitle: "Replace in chapter?",
    replaceDeleteConfirmTitle: "Delete across manuscript?",
    replaceDeleteChapterConfirmTitle: "Delete in chapter?",
    replaceConfirm: (count: number, search: string, replace: string, chapters: number) =>
      `Replace ${count} occurrence${count === 1 ? "" : "s"} of '${search}' with '${replace}' across ${chapters} chapter${chapters === 1 ? "" : "s"}? Snapshots of all affected chapters will be created automatically.`,
    replaceChapterConfirm: (count: number, search: string, replace: string) =>
      `Replace ${count} occurrence${count === 1 ? "" : "s"} of '${search}' with '${replace}' in this chapter? A snapshot will be created automatically.`,
    replaceDeleteConfirm: (count: number, search: string, chapters: number) =>
      `Delete ${count} occurrence${count === 1 ? "" : "s"} of '${search}' across ${chapters} chapter${chapters === 1 ? "" : "s"}? The replacement is empty, so every match will be removed. Snapshots of all affected chapters will be created automatically.`,
    replaceDeleteChapterConfirm: (count: number, search: string) =>
      `Delete ${count} occurrence${count === 1 ? "" : "s"} of '${search}' in this chapter? The replacement is empty, so every match will be removed. A snapshot will be created automatically.`,
    replaceConfirmButton: "Replace All",
    replaceDeleteConfirmButton: "Delete All",
    replaceCancelButton: "Cancel",
    matchNotFound: "Match no longer found — try searching again.",
    invalidRegex: "Invalid regular expression",
    tooManyMatches: "Too many matches — refine your search and try again.",
    searchTimedOut: "Search timed out — refine your pattern and try again.",
    contentTooLarge:
      "Replacement would produce chapter content over the size limit; refine your replacement.",
    invalidReplaceRequest: "Replace request was rejected. Check your search and replace inputs.",
    invalidSearchRequest: "Search request was rejected. Check your search input.",
    searchFailed: "Search failed. Try again.",
    searchNetworkFailed: "Search failed — check your connection and try again.",
    skippedChapters: (count: number) =>
      `${count} chapter${count === 1 ? " was" : "s were"} skipped due to corrupt content.`,
    skippedAfterReplace: (count: number) =>
      `Replace completed, but ${count} chapter${count === 1 ? " was" : "s were"} skipped due to corrupt content.`,
    chapterMatches: (title: string, count: number) =>
      `${title} (${count} match${count === 1 ? "" : "es"})`,
    ariaLabel: "Find and replace",
    toggleTooltip: "Find and replace (Ctrl+H)",
  },
} as const;
