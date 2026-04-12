import type { ProjectStore } from "./project-store.types";
import { SqliteProjectStore } from "./sqlite-project-store";
import { getDb } from "../db/connection";

let store: ProjectStore | null = null;

export function getProjectStore(): ProjectStore {
  if (!store) throw new Error("ProjectStore not initialized — call initProjectStore() first");
  return store;
}

/**
 * Replace the store singleton. Intended for test injection only —
 * production code should use initProjectStore(). Unlike initProjectStore,
 * this does not guard against overwriting an existing store; call
 * resetProjectStore() first if you need that safety.
 */
export function setProjectStore(s: ProjectStore): void {
  store = s;
}

export function resetProjectStore(): void {
  store = null;
}

export function initProjectStore(): void {
  if (store !== null) {
    throw new Error("ProjectStore already initialized — call resetProjectStore() first");
  }
  store = new SqliteProjectStore(getDb());
}
