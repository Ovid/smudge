import type { Knex } from "knex";
import type { SnapshotRow, SnapshotListItem, CreateSnapshotData } from "./snapshots.types";
import { createHash } from "crypto";

const TABLE = "chapter_snapshots";

function coerceRow<T extends { is_auto: boolean | number }>(row: T): T {
  return { ...row, is_auto: Boolean(row.is_auto) };
}

export async function insert(db: Knex, data: CreateSnapshotData): Promise<SnapshotRow> {
  await db(TABLE).insert(data);
  return data as SnapshotRow;
}

export async function findById(db: Knex, id: string): Promise<SnapshotRow | null> {
  const row = await db(TABLE).where({ id }).first();
  return row ? coerceRow(row) : null;
}

export async function listByChapter(db: Knex, chapterId: string): Promise<SnapshotListItem[]> {
  const rows = await db(TABLE)
    .where({ chapter_id: chapterId })
    .select("id", "chapter_id", "label", "word_count", "is_auto", "created_at")
    .orderBy("created_at", "desc");
  return rows.map(coerceRow);
}

export async function remove(db: Knex, id: string): Promise<number> {
  return db(TABLE).where({ id }).del();
}

export async function getLatestContentHash(db: Knex, chapterId: string): Promise<string | null> {
  const row = await db(TABLE)
    .where({ chapter_id: chapterId })
    .orderBy("created_at", "desc")
    .select("content")
    .first();
  if (!row) return null;
  return createHash("sha256").update(row.content).digest("hex");
}

