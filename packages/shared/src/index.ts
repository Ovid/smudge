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
  MAX_MATCHES_PER_REQUEST,
  CONTEXT_RADIUS,
} from "./tiptap-text";
export type { SearchMatch, SearchOptions } from "./tiptap-text";
export { generateSlug } from "./slugify";
export { UNTITLED_CHAPTER, TRASH_RETENTION_DAYS, TRASH_RETENTION_MS } from "./constants";
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
} from "./types";
