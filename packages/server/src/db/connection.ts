import knex, { type Knex } from "knex";
import { createKnexConfig } from "./knexfile";

let db: Knex | undefined;

export function getDb(): Knex {
  if (!db) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return db;
}

export function setDb(instance: Knex): void {
  db = instance;
}

export async function initDb(config?: Knex.Config): Promise<Knex> {
  db = knex(config ?? createKnexConfig());
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
