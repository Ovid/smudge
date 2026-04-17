import type { Knex } from "knex";
import type { SnapshotRow, SnapshotListItem, CreateSnapshotData } from "./snapshots.types";
import { canonicalContentHash } from "./content-hash";

const TABLE = "chapter_snapshots";

function coerceRow<T extends { is_auto: boolean | number }>(row: T): T {
  return { ...row, is_auto: Boolean(row.is_auto) };
}

export async function insert(db: Knex, data: CreateSnapshotData): Promise<SnapshotRow> {
  await db(TABLE).insert(data);
  // Route the returned shape through coerceRow for symmetry with findById
  // and listByChapter — otherwise a future change that reads the DB
  // default (e.g. integer is_auto) would silently diverge from the insert
  // return type.
  return coerceRow(data as SnapshotRow);
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
  // Dedup only against prior MANUAL snapshots. Otherwise a manual
  // snapshot taken right after an auto-snapshot (e.g. from restore or
  // find-and-replace) would silently return "duplicate" even though
  // the user's explicit intent was to create a new manual marker.
  const row = await db(TABLE)
    .where({ chapter_id: chapterId, is_auto: false })
    .orderBy("created_at", "desc")
    .select("content")
    .first();
  if (!row) return null;
  return canonicalContentHash(row.content);
}
