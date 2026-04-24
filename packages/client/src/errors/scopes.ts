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
  "project.create": { fallback: STRINGS.error.createFailed },
  "project.delete": { fallback: STRINGS.error.deleteFailed },
  "project.updateTitle": {
    fallback: STRINGS.error.updateTitleFailed,
    committed: STRINGS.error.updateTitleResponseUnreadable,
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
    byStatus: { 413: STRINGS.editor.saveFailedTooLarge },
    byCode: { VALIDATION_ERROR: STRINGS.editor.saveFailedInvalid },
  },
  "chapter.create": {
    fallback: STRINGS.error.createChapterFailed,
    committed: STRINGS.error.createChapterResponseUnreadable,
    byCode: { READ_AFTER_CREATE_FAILURE: STRINGS.error.createChapterReadAfterFailure },
  },
  "chapter.delete": { fallback: STRINGS.error.deleteChapterFailed },
  "chapter.rename": { fallback: STRINGS.error.renameChapterFailed },
  "chapter.reorder": {
    fallback: STRINGS.error.reorderFailed,
    committed: STRINGS.error.reorderResponseUnreadable,
  },
  "chapter.updateStatus": {
    fallback: STRINGS.error.statusChangeFailed,
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
  },
  "image.upload": { fallback: STRINGS.imageGallery.uploadFailedGeneric },
  "image.delete": {
    fallback: STRINGS.imageGallery.deleteFailedGeneric,
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
  "image.updateMetadata": { fallback: STRINGS.imageGallery.saveFailed },
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
  "snapshot.list": { fallback: STRINGS.snapshots.listFailedGeneric },
  "snapshot.create": { fallback: STRINGS.snapshots.createFailedGeneric },
  "snapshot.delete": { fallback: STRINGS.snapshots.deleteFailed },
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
    byCode: {
      PROJECT_PURGED: STRINGS.error.restoreChapterProjectPurged,
      CHAPTER_PURGED: STRINGS.error.restoreChapterAlreadyPurged,
      RESTORE_CONFLICT: STRINGS.error.restoreChapterSlugConflict,
    },
  },
  "settings.update": { fallback: STRINGS.error.settingsUpdateFailedGeneric },
  "dashboard.load": {
    fallback: STRINGS.error.loadDashboardFailed,
    network: STRINGS.error.loadDashboardFailedNetwork,
  },
  "project.velocity": {
    fallback: STRINGS.velocity.loadError,
    network: STRINGS.velocity.loadErrorNetwork,
  },
};
