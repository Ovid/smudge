import knex, { type Knex } from "knex";
import { createKnexConfig } from "./knexfile";

let db: Knex | undefined;

// Milliseconds a writer waits on a held write lock before SQLite returns
// SQLITE_BUSY (surfaced as HTTP 500). better-sqlite3 already applies a 5000ms
// busy timeout via its `timeout` constructor option default, but that is an
// implicit driver default a future upgrade could change silently. Pin it at
// the SQL layer so the guarantee is owned by our code and asserted by a test
// (OOSS1). WAL lets readers and a writer coexist, but two writers still
// serialize — this timeout keeps a brief lock contention from 500ing.
const BUSY_TIMEOUT_MS = 5000;

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
  await db.raw(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  await db.migrate.latest();
  return db;
}

export async function closeDb(): Promise<void> {
  if (db) {
    await db.destroy();
    db = undefined;
  }
}
