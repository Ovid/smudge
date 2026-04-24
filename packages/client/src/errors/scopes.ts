import type { ScopeEntry } from "./apiErrorMapper";
import type { ApiRequestError } from "../api/client";
import { STRINGS } from "../strings";
import { SEARCH_ERROR_CODES, SNAPSHOT_ERROR_CODES } from "@smudge/shared";

export type ApiErrorScope =
  | "project.load"
  | "projectList.load"
  | "project.create"
  | "project.delete"
  | "project.updateTitle"
  | "project.updateFields"
  | "chapter.load"
  | "chapter.save"
  | "chapter.create"
  | "chapter.delete"
  | "chapter.rename"
  | "chapter.reorder"
  | "chapter.updateStatus"
  | "chapterStatus.fetch"
  | "image.list"
  | "image.references"
  | "image.upload"
  | "image.delete"
  | "image.updateMetadata"
  | "snapshot.restore"
  | "snapshot.view"
  | "snapshot.list"
  | "snapshot.create"
  | "snapshot.delete"
  | "findReplace.search"
  | "findReplace.replace"
  | "export.run"
  | "trash.load"
  | "trash.restoreChapter"
  | "settings.update"
  | "settings.get"
  | "dashboard.load"
  | "project.velocity";

export const SCOPES: Record<ApiErrorScope, ScopeEntry> = {
  "project.load": {
    fallback: STRINGS.error.loadProjectFailed,
    network: STRINGS.error.loadProjectFailedNetwork,
  },
  "projectList.load": {
    fallback: STRINGS.error.loadFailed,
    network: STRINGS.error.loadFailedNetwork,
  },
  "project.create": {
    fallback: STRINGS.error.createFailed,
    // I12 (review 2026-04-24): add the transient-retry copy so NETWORK
    // errors get the "check your connection" hint instead of the
    // generic fallback. Applies to all mutation scopes that declare
    // committed: — siblings below mirror this.
    network: STRINGS.error.createFailedNetwork,
    committed: STRINGS.error.possiblyCommitted,
    byCode: { PROJECT_TITLE_EXISTS: STRINGS.error.projectTitleExists },
  },
  "project.delete": {
    fallback: STRINGS.error.deleteFailed,
    network: STRINGS.error.deleteFailedNetwork,
    committed: STRINGS.error.possiblyCommitted,
  },
  "project.updateTitle": {
    fallback: STRINGS.error.updateTitleFailed,
    network: STRINGS.error.updateTitleFailedNetwork,
    committed: STRINGS.error.updateTitleResponseUnreadable,
    byCode: { PROJECT_TITLE_EXISTS: STRINGS.error.projectTitleExists },
    // S4 (review 2026-04-24): the rename endpoint and project.updateFields
    // hit the same PATCH /projects/:slug handler — mirror the 404 string
    // so a project-was-deleted race between rename and save gets the
    // same notFound copy here as sibling field saves.
    byStatus: { 404: STRINGS.projectSettings.saveNotFound },
  },
  "project.updateFields": {
    fallback: STRINGS.projectSettings.saveError,
    network: STRINGS.projectSettings.saveNetworkError,
    committed: STRINGS.projectSettings.saveResponseUnreadable,
    byCode: { VALIDATION_ERROR: STRINGS.projectSettings.saveInvalid },
    byStatus: { 404: STRINGS.projectSettings.saveNotFound },
  },
  "chapter.load": {
    fallback: STRINGS.error.loadChapterFailed,
    network: STRINGS.error.loadChapterFailedNetwork,
  },
  "chapter.save": {
    fallback: STRINGS.editor.saveFailed,
    // I5: chapter.save is the app's most load-bearing mutation, so the
    // committed UX gets a save-specific banner (not the generic
    // possiblyCommitted default) that explicitly warns against typing
    // before refresh — continued edits would overwrite the server-
    // committed content.
    committed: STRINGS.editor.saveCommittedUnreadable,
    byStatus: { 413: STRINGS.editor.saveFailedTooLarge },
    byCode: {
      VALIDATION_ERROR: STRINGS.editor.saveFailedInvalid,
      // UPDATE_READ_FAILURE is a 500 where the server updated the row
      // but could not re-read it: the save actually committed. Same
      // committed/lock UX as 2xx BAD_JSON.
      UPDATE_READ_FAILURE: STRINGS.editor.saveCommittedUnreadable,
      CORRUPT_CONTENT: STRINGS.editor.saveFailedCorrupt,
    },
    // S8: UPDATE_READ_FAILURE means the server persisted the row but
    // couldn't serialize the response. Surface possiblyCommitted so
    // callers route through the committed/lock path.
    committedCodes: ["UPDATE_READ_FAILURE"],
  },
  "chapter.create": {
    fallback: STRINGS.error.createChapterFailed,
    network: STRINGS.error.createChapterFailedNetwork,
    committed: STRINGS.error.createChapterResponseUnreadable,
    byCode: { READ_AFTER_CREATE_FAILURE: STRINGS.error.createChapterReadAfterFailure },
    // I13 (review 2026-04-24): project soft-deleted between sidebar
    // render and click. Sibling image.upload has the same 404 branch
    // (uploadProjectGone); chapter.create was missing it and surfaced
    // the generic "Failed to create chapter" that invites retry.
    byStatus: { 404: STRINGS.error.createChapterProjectGone },
    // S8 (review 2026-04-24): the server inserted the row but could
    // not re-read it — treat as committed so consumers surface the
    // committed UX and avoid duplicate-create retries.
    committedCodes: ["READ_AFTER_CREATE_FAILURE"],
  },
  "chapter.delete": {
    fallback: STRINGS.error.deleteChapterFailed,
    network: STRINGS.error.deleteChapterFailedNetwork,
    committed: STRINGS.error.possiblyCommitted,
  },
  "chapter.rename": {
    fallback: STRINGS.error.renameChapterFailed,
    network: STRINGS.error.renameChapterFailedNetwork,
    committed: STRINGS.error.possiblyCommitted,
  },
  "chapter.reorder": {
    fallback: STRINGS.error.reorderFailed,
    network: STRINGS.error.reorderFailedNetwork,
    committed: STRINGS.error.reorderResponseUnreadable,
  },
  "chapter.updateStatus": {
    fallback: STRINGS.error.statusChangeFailed,
    network: STRINGS.error.statusChangeFailedNetwork,
    committed: STRINGS.error.statusChangeResponseUnreadable,
  },
  "chapterStatus.fetch": {
    fallback: STRINGS.error.statusesFetchFailed,
    network: STRINGS.error.statusesFetchFailedNetwork,
  },
  "image.list": {
    fallback: STRINGS.imageGallery.loadFailed,
    network: STRINGS.imageGallery.loadFailedNetwork,
  },
  "image.references": {
    fallback: STRINGS.imageGallery.referencesLoadFailed,
    // S5 (review 2026-04-24): add the transient-retry copy so a NETWORK
    // error gets a "check your connection" message instead of the
    // generic fallback. Mirrors image.list and other GET scopes.
    network: STRINGS.imageGallery.referencesLoadFailedNetwork,
  },
  "image.upload": {
    fallback: STRINGS.imageGallery.uploadFailedGeneric,
    // I3 (2026-04-24 review): 2xx BAD_JSON means the server stored the
    // image but the client couldn't read the row. Generic possiblyCommitted
    // copy left consumers guessing — callers (ImageGallery, Editor paste
    // path) branch on possiblyCommitted to either refresh the gallery
    // (so duplicate uploads on retry don't sneak in) or direct the user
    // to it. The scope-level string tells them what to do.
    committed: STRINGS.imageGallery.uploadCommittedRefresh,
    byStatus: {
      413: STRINGS.imageGallery.fileTooLarge,
      // I1 (2026-04-24 review): project was deleted between gallery-open
      // and upload request landing. The generic fallback blamed the
      // network, which is misleading — the request deterministically
      // fails until a new project is selected.
      404: STRINGS.imageGallery.uploadProjectGone,
    },
    byCode: {
      PAYLOAD_TOO_LARGE: STRINGS.imageGallery.fileTooLarge,
      // I1 (2026-04-24 review): server 400 for missing file, unsupported
      // MIME, MIME/content mismatch, and empty file. Without a byCode
      // entry the user sees "Check your connection" — which has nothing
      // to do with why the server rejected their file.
      VALIDATION_ERROR: STRINGS.imageGallery.uploadInvalidFile,
    },
  },
  "image.delete": {
    fallback: STRINGS.imageGallery.deleteFailedGeneric,
    network: STRINGS.imageGallery.deleteFailedNetwork,
    committed: STRINGS.error.possiblyCommitted,
    byCode: { IMAGE_IN_USE: STRINGS.imageGallery.deleteBlockedInUse },
    // S5 (2026-04-23 review): validate per-element shape, not just that
    // `chapters` is an array. ImageGallery casts elements to
    // {title: string; trashed?: boolean} — a hostile or malformed
    // envelope with array-but-wrong-shape elements would otherwise slip
    // through this narrowing and propagate to the UI via cast.
    extrasFrom: (err: ApiRequestError) => {
      const chapters = (err.extras as { chapters?: unknown } | undefined)?.chapters;
      if (!Array.isArray(chapters)) return undefined;
      const valid = chapters.filter((c): c is { title: string; trashed?: boolean } => {
        if (!c || typeof c !== "object") return false;
        const obj = c as Record<string, unknown>;
        if (typeof obj.title !== "string") return false;
        if (obj.trashed !== undefined && typeof obj.trashed !== "boolean") return false;
        return true;
      });
      return valid.length === chapters.length ? { chapters: valid } : undefined;
    },
  },
  "image.updateMetadata": {
    fallback: STRINGS.imageGallery.saveFailed,
    network: STRINGS.imageGallery.saveFailedNetwork,
    committed: STRINGS.error.possiblyCommitted,
  },
  "snapshot.restore": {
    fallback: STRINGS.snapshots.restoreFailed,
    network: STRINGS.snapshots.restoreNetworkFailed,
    committed: STRINGS.snapshots.restoreResponseUnreadable,
    byCode: {
      [SNAPSHOT_ERROR_CODES.CORRUPT_SNAPSHOT]: STRINGS.snapshots.restoreFailedCorrupt,
      [SNAPSHOT_ERROR_CODES.CROSS_PROJECT_IMAGE_REF]:
        STRINGS.snapshots.restoreFailedCrossProjectImage,
    },
    byStatus: { 404: STRINGS.snapshots.restoreFailedNotFound },
  },
  "snapshot.view": {
    fallback: STRINGS.snapshots.viewFailed,
    network: STRINGS.snapshots.viewFailedNetwork,
    byCode: {
      [SNAPSHOT_ERROR_CODES.CORRUPT_SNAPSHOT]: STRINGS.snapshots.viewFailedCorrupt,
    },
    byStatus: { 404: STRINGS.snapshots.viewFailedNotFound },
  },
  "snapshot.list": {
    fallback: STRINGS.snapshots.listFailedGeneric,
    // S5: transient-retry copy on NETWORK — mirrors sibling GET scopes.
    network: STRINGS.snapshots.listFailedNetwork,
  },
  "snapshot.create": {
    fallback: STRINGS.snapshots.createFailedGeneric,
    network: STRINGS.snapshots.createFailedNetwork,
    committed: STRINGS.error.possiblyCommitted,
  },
  "snapshot.delete": {
    fallback: STRINGS.snapshots.deleteFailed,
    network: STRINGS.snapshots.deleteFailedNetwork,
    committed: STRINGS.error.possiblyCommitted,
  },
  "findReplace.search": {
    fallback: STRINGS.findReplace.searchFailed,
    network: STRINGS.findReplace.searchNetworkFailed,
    byCode: {
      [SEARCH_ERROR_CODES.MATCH_CAP_EXCEEDED]: STRINGS.findReplace.tooManyMatches,
      [SEARCH_ERROR_CODES.REGEX_TIMEOUT]: STRINGS.findReplace.searchTimedOut,
      [SEARCH_ERROR_CODES.CONTENT_TOO_LARGE]: STRINGS.findReplace.contentTooLarge,
      [SEARCH_ERROR_CODES.INVALID_REGEX]: STRINGS.findReplace.invalidRegex,
    },
    byStatus: {
      400: STRINGS.findReplace.invalidSearchRequest,
      413: STRINGS.findReplace.contentTooLarge,
      404: STRINGS.findReplace.searchProjectNotFound,
    },
  },
  "findReplace.replace": {
    fallback: STRINGS.findReplace.replaceFailed,
    network: STRINGS.findReplace.replaceNetworkFailed,
    committed: STRINGS.findReplace.replaceResponseUnreadable,
    byCode: {
      [SEARCH_ERROR_CODES.MATCH_CAP_EXCEEDED]: STRINGS.findReplace.tooManyMatches,
      [SEARCH_ERROR_CODES.REGEX_TIMEOUT]: STRINGS.findReplace.searchTimedOut,
      [SEARCH_ERROR_CODES.CONTENT_TOO_LARGE]: STRINGS.findReplace.contentTooLarge,
      [SEARCH_ERROR_CODES.INVALID_REGEX]: STRINGS.findReplace.invalidRegex,
      [SEARCH_ERROR_CODES.SCOPE_NOT_FOUND]: STRINGS.findReplace.replaceScopeNotFound,
    },
    byStatus: {
      400: STRINGS.findReplace.invalidReplaceRequest,
      413: STRINGS.findReplace.contentTooLarge,
      404: STRINGS.findReplace.replaceProjectNotFound,
    },
  },
  "export.run": { fallback: STRINGS.export.errorFailed },
  "trash.load": {
    fallback: STRINGS.error.loadTrashFailed,
    network: STRINGS.error.loadTrashFailedNetwork,
  },
  "trash.restoreChapter": {
    fallback: STRINGS.error.restoreChapterFailed,
    network: STRINGS.error.restoreChapterFailedNetwork,
    // I2 (2026-04-24 review): restore-committed UX. 2xx BAD_JSON and 500
    // RESTORE_READ_FAILURE both mean "the chapter was actually restored,
    // the client just can't see the hydrated row." Generic
    // possiblyCommitted copy left users thinking the restore had failed;
    // they retried and hit 409 RESTORE_CONFLICT (slug already present)
    // while the chapter silently came back on reload. A restore-specific
    // string tells them to refresh.
    committed: STRINGS.error.restoreChapterCommitted,
    byCode: {
      PROJECT_PURGED: STRINGS.error.restoreChapterProjectPurged,
      CHAPTER_PURGED: STRINGS.error.restoreChapterAlreadyPurged,
      RESTORE_CONFLICT: STRINGS.error.restoreChapterSlugConflict,
      // Same committed UX as 2xx BAD_JSON — the server did commit the
      // restore; it just couldn't re-read the row for the response body.
      RESTORE_READ_FAILURE: STRINGS.error.restoreChapterCommitted,
    },
    // S8: RESTORE_READ_FAILURE surfaces possiblyCommitted so
    // useTrashManager doesn't need the inline code check.
    committedCodes: ["RESTORE_READ_FAILURE"],
  },
  "settings.update": {
    fallback: STRINGS.error.settingsUpdateFailedGeneric,
    network: STRINGS.error.settingsUpdateFailedNetwork,
    committed: STRINGS.error.possiblyCommitted,
  },
  "settings.get": {
    fallback: STRINGS.error.settingsLoadFailed,
    network: STRINGS.error.settingsLoadFailedNetwork,
  },
  "dashboard.load": {
    fallback: STRINGS.error.loadDashboardFailed,
    network: STRINGS.error.loadDashboardFailedNetwork,
  },
  "project.velocity": {
    fallback: STRINGS.velocity.loadError,
    network: STRINGS.velocity.loadErrorNetwork,
  },
};
