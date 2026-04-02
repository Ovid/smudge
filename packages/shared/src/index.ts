// @smudge/shared — types, schemas, and utilities shared between server and client
export {
  CreateProjectSchema,
  UpdateProjectSchema,
  UpdateChapterSchema,
  UpdateSettingsSchema,
  ReorderChaptersSchema,
  ProjectMode,
  ChapterStatus,
  CompletionThreshold,
  calculateWordsToday,
} from "./schemas";
export { countWords } from "./wordcount";
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
} from "./types";
