import knex, { type Knex } from "knex";
import { createKnexConfig } from "./knexfile";

let db: Knex | undefined;

/**
 * @internal Used only by test helpers and init code.
 * Services should use getProjectStore() for all data access.
 */
export function getDb(): Knex {
  if (!db) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return db;
}

/**
 * @internal Test-only: inject a pre-configured Knex instance.
 * Production code should use initDb() instead.
 */
export async function setDb(instance: Knex): Promise<void> {
  if (db && db !== instance) {
    await db.destroy();
  }
  db = instance;
  // Raw SQL: PRAGMAs are SQLite-specific session settings with no Knex equivalent
  await db.raw("PRAGMA foreign_keys = ON");
}

export async function initDb(config?: Knex.Config): Promise<Knex> {
  if (db) {
    await db.destroy();
  }
  db = knex(config ?? createKnexConfig());
  // Raw SQL: PRAGMAs are SQLite-specific session settings with no Knex equivalent
  await db.raw("PRAGMA journal_mode = WAL");
  await db.raw("PRAGMA foreign_keys = ON");
  await db.migrate.latest();
  return db;
}

export async function closeDb(): Promise<void> {
  if (db) {
    await db.destroy();
    db = undefined;
  }
}
