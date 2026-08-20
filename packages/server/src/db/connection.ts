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
  const previous = db !== instance ? db : undefined;
  // Install first, tear down after: a rejecting destroy() must not leave the
  // global pointing at the handle it just tried to dispose of (review S1/S2).
  db = instance;
  if (previous) {
    await previous.destroy();
  }
  // Raw SQL: PRAGMAs are SQLite-specific session settings with no Knex equivalent
  await db.raw("PRAGMA foreign_keys = ON");
}

/**
 * Initialize the process-wide Knex handle. Callable exactly once — call
 * closeDb() before initializing again.
 *
 * F-21: this used to destroy the prior handle and install a new one silently,
 * while its counterpart initProjectStore() threw on a second call. The
 * asymmetry was the hazard: SqliteProjectStore captures the handle in its
 * constructor, so a second initDb() with no intervening resetProjectStore()
 * left getProjectStore() returning a store over a destroyed connection, with
 * nothing failing at the seam — just opaque driver errors on every later
 * query. Refusing here makes that state unreachable without an explicit
 * teardown. setDb() remains the seam that deliberately replaces (tests).
 */
export async function initDb(config?: Knex.Config): Promise<Knex> {
  if (db) {
    throw new Error("Database already initialized — call closeDb() first");
  }
  // Build into a local and publish only on success. Publishing first would
  // leave a half-built handle in the global if a PRAGMA or the migration
  // rejects — getDb() checks truthiness only, so it would hand back a
  // connection whose migrations never ran, and the retry would be refused
  // with "already initialized", which is false for exactly that state.
  const instance = knex(config ?? createKnexConfig());
  try {
    // Raw SQL: PRAGMAs are SQLite-specific session settings with no Knex equivalent
    await instance.raw("PRAGMA journal_mode = WAL");
    await instance.raw("PRAGMA foreign_keys = ON");
    await instance.raw(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    await instance.migrate.latest();
  } catch (err) {
    await instance.destroy().catch(() => {});
    throw err;
  }
  db = instance;
  return db;
}

export async function closeDb(): Promise<void> {
  const instance = db;
  // Clear before the await: a rejecting destroy() still reports its failure,
  // but must not strand the global. Since F-21 made initDb refuse a re-init,
  // a stuck global is unrecoverable — the next initDb() would answer "call
  // closeDb() first", the exact call that just failed.
  db = undefined;
  if (instance) {
    await instance.destroy();
  }
}
