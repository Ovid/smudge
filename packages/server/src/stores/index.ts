// Barrel narrowed to the one symbol the test suite imports via `../stores`.
// Production code imports stores directly from their modules
// (project-store.injectable, project-store.types).
export { SqliteProjectStore } from "./sqlite-project-store";
