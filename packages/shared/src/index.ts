// @smudge/shared — types, schemas, and utilities shared between server and client
export { CreateProjectSchema, UpdateChapterSchema, ProjectMode } from "./schemas";
export type {
  Project,
  Chapter,
  ProjectMode as ProjectModeType,
  CreateProjectInput,
  ProjectListItem,
  ProjectWithChapters,
  ApiError,
} from "./types";
