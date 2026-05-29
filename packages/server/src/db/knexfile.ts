import type { Knex } from "knex";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDbPath } from "../config/paths";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createKnexConfig(dbPath?: string): Knex.Config {
  return {
    client: "better-sqlite3",
    connection: {
      filename: dbPath ?? getDbPath(),
    },
    useNullAsDefault: true,
    migrations: {
      directory: path.join(__dirname, "migrations"),
      loadExtensions: [".js"],
    },
  };
}

export function createTestKnexConfig(): Knex.Config {
  return {
    client: "better-sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true,
    migrations: {
      directory: path.join(__dirname, "migrations"),
      loadExtensions: [".js"],
    },
  };
}
