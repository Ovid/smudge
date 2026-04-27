// @smudge/shared — types, schemas, and utilities shared between server and client
export {
  CreateProjectSchema,
  UpdateProjectSchema,
  UpdateChapterSchema,
  UpdateSettingsSchema,
  ReorderChaptersSchema,
  ProjectMode,
  ChapterStatus,
  ExportSchema,
  ExportFormat,
  EXPORT_FILE_EXTENSIONS,
  EXPORT_CONTENT_TYPES,
  UpdateImageSchema,
  CreateSnapshotSchema,
  sanitizeSnapshotLabel,
  validateTipTapDepth,
  MAX_TIPTAP_DEPTH,
  TipTapDocSchema,
} from "./schemas";
export type { ExportFormatType } from "./schemas";
export { countWords } from "./wordcount";
export {
  searchInDoc,
  replaceInDoc,
  buildRegex,
  assertSafeRegexPattern,
  RegExpSafetyError,
  RegExpTimeoutError,
  MatchCapExceededError,
  ReplacementTooLargeError,
  MAX_MATCHES_PER_REQUEST,
  CONTEXT_RADIUS,
} from "./tiptap-text";
export type { SearchMatch, SearchOptions } from "./tiptap-text";
export { generateSlug } from "./slugify";
export { parsePort } from "./parsePort";
export { findFirstNonDirectoryAncestor } from "./findDirectoryConflict";
export {
  UNTITLED_CHAPTER,
  TRASH_RETENTION_DAYS,
  TRASH_RETENTION_MS,
  DEFAULT_SERVER_PORT,
  SEARCH_ERROR_CODES,
  SNAPSHOT_ERROR_CODES,
  MAX_QUERY_LENGTH,
  MAX_REPLACE_LENGTH,
} from "./constants";
export type { SearchErrorCode, SnapshotErrorCode } from "./constants";
export type {
  Project,
  Chapter,
  ProjectMode as ProjectModeType,
  CreateProjectInput,
  ProjectListItem,
  ProjectWithChapters,
  ChapterStatusRow,
  ApiError,
  ImageRow,
  VelocityResponse,
  SnapshotRow,
  SnapshotListItem,
  SearchResult,
  ReplaceResult,
} from "./types";
