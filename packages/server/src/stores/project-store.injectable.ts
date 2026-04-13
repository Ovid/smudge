import type { Knex } from "knex";
import type { ProjectStore } from "./project-store.types";
import { SqliteProjectStore } from "./sqlite-project-store";

let store: ProjectStore | null = null;

export function getProjectStore(): ProjectStore {
  if (!store) throw new Error("ProjectStore not initialized — call initProjectStore() first");
  return store;
}

/**
 * @internal Test-only: inject a pre-configured store.
 * Production code should use initProjectStore().
 * Does not guard against overwriting — call resetProjectStore() first
 * if you need that safety.
 */
export function setProjectStore(s: ProjectStore): void {
  store = s;
}

/**
 * @internal Test-only: clear the store singleton.
 * Production code uses this only during graceful shutdown.
 */
export function resetProjectStore(): void {
  store = null;
}

export function initProjectStore(db: Knex): void {
  if (store !== null) {
    throw new Error("ProjectStore already initialized — call resetProjectStore() first");
  }
  store = new SqliteProjectStore(db);
}
