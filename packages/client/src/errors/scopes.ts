import type { ScopeEntry } from "./apiErrorMapper";
import type { ApiRequestError } from "../api/client";
import { STRINGS } from "../strings";
import { SEARCH_ERROR_CODES, SNAPSHOT_ERROR_CODES } from "@smudge/shared";

export type ApiErrorScope =
  | "project.load"
  | "project.create"
  | "project.delete"
  | "project.updateTitle"
  | "project.velocity"
  | "chapter.load"
  | "chapter.save"
  | "chapter.create"
  | "chapter.delete"
  | "chapter.rename"
  | "chapter.reorder"
  | "chapter.updateStatus"
  | "chapterStatus.fetch"
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
  | "settings.get"
  | "settings.update"
  | "dashboard.load";

export const SCOPES: Record<ApiErrorScope, ScopeEntry> = {
  "project.load": { fallback: STRINGS.error.loadProjectFailed },
  "project.create": { fallback: STRINGS.error.createFailed },
  "project.delete": { fallback: STRINGS.error.deleteFailed },
  "project.updateTitle": { fallback: STRINGS.error.updateTitleFailed },
  "project.velocity": { fallback: STRINGS.velocity.loadError },
  "chapter.load": { fallback: STRINGS.error.loadChapterFailed },
  "chapter.save": {
    fallback: STRINGS.editor.saveFailed,
    byStatus: { 413: STRINGS.editor.saveFailedTooLarge },
    byCode: { VALIDATION_ERROR: STRINGS.editor.saveFailedInvalid },
  },
  "chapter.create": { fallback: STRINGS.error.createChapterFailed },
  "chapter.delete": { fallback: STRINGS.error.deleteChapterFailed },
  "chapter.rename": { fallback: STRINGS.error.renameChapterFailed },
  "chapter.reorder": { fallback: STRINGS.error.reorderFailed },
  "chapter.updateStatus": { fallback: STRINGS.error.statusChangeFailed },
  "chapterStatus.fetch": { fallback: STRINGS.error.statusesFetchFailed },
  "image.upload": { fallback: STRINGS.imageGallery.uploadFailedGeneric },
  "image.delete": {
    fallback: STRINGS.imageGallery.deleteFailedGeneric,
    byCode: { IMAGE_IN_USE: STRINGS.imageGallery.deleteBlockedInUse },
    extrasFrom: (err: ApiRequestError) => {
      // TODO: commit 2 — drop `as unknown as` once ApiRequestError has a public `extras` field.
      const chapters = (err as unknown as { extras?: { chapters?: unknown } }).extras?.chapters;
      return Array.isArray(chapters) ? { chapters } : undefined;
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
  "trash.load": { fallback: STRINGS.error.loadTrashFailed },
  "trash.restoreChapter": { fallback: STRINGS.error.restoreChapterFailed },
  "settings.get": { fallback: STRINGS.error.settingsLoadFailedGeneric },
  "settings.update": { fallback: STRINGS.error.settingsUpdateFailedGeneric },
  "dashboard.load": { fallback: STRINGS.error.loadDashboardFailed },
};
