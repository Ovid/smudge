import type { ProjectStore } from "./project-store.types";
import { SqliteProjectStore } from "./sqlite-project-store";
import { getDb } from "../db/connection";

let store: ProjectStore | null = null;

export function getProjectStore(): ProjectStore {
  if (!store) throw new Error("ProjectStore not initialized — call initProjectStore() first");
  return store;
}

export function setProjectStore(s: ProjectStore): void {
  store = s;
}

export function initProjectStore(): void {
  store = new SqliteProjectStore(getDb());
}
