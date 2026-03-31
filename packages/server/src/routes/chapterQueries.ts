import type { Knex } from "knex";
import { parseChapterContent } from "./parseChapterContent";

/**
 * Execute a Knex query builder and return a single parsed chapter (or null).
 * Automatically converts SQLite JSON-string content to an object.
 */
export async function queryChapter(
  builder: Knex.QueryBuilder,
): Promise<Record<string, unknown> | null> {
  const row = await builder.first();
  return row ? parseChapterContent(row) : null;
}

/**
 * Execute a Knex query builder and return an array of parsed chapters.
 * Automatically converts SQLite JSON-string content to objects.
 */
export async function queryChapters(
  builder: Knex.QueryBuilder,
): Promise<Record<string, unknown>[]> {
  const rows = await builder;
  return rows.map((row: Record<string, unknown>) => parseChapterContent(row));
}
