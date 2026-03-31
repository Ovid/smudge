import type { Response } from "express";
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

/** True when parseChapterContent flagged the row as having corrupt JSON. */
export function isCorruptChapter(chapter: Record<string, unknown>): boolean {
  return chapter.content_corrupt === true;
}

/**
 * If the chapter is corrupt, send a 500 CORRUPT_CONTENT response and return true.
 * The caller should `return` immediately when this returns true.
 */
export function sendCorruptContentError(chapter: Record<string, unknown>, res: Response): boolean {
  if (!isCorruptChapter(chapter)) return false;
  res.status(500).json({
    error: {
      code: "CORRUPT_CONTENT",
      message: "Chapter content is corrupted and cannot be loaded.",
    },
  });
  return true;
}

/**
 * Remove the internal content_corrupt flag before sending a chapter over the wire.
 * Prevents leaking internal implementation details to clients.
 */
export function stripCorruptFlag(chapter: Record<string, unknown>): Record<string, unknown> {
  const { content_corrupt: _, ...rest } = chapter;
  return rest;
}
