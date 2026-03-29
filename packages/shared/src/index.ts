// @smudge/shared — types, schemas, and utilities shared between server and client
export {
  CreateProjectSchema,
  UpdateProjectSchema,
  UpdateChapterSchema,
  ReorderChaptersSchema,
  ProjectMode,
} from "./schemas";
export { countWords } from "./wordcount";
export { generateSlug } from "./slugify";
export type {
  Project,
  Chapter,
  ProjectMode as ProjectModeType,
  CreateProjectInput,
  ProjectListItem,
  ProjectWithChapters,
  ApiError,
} from "./types";
