import type { Knex } from "knex";
import type { SnapshotRow, SnapshotListItem, CreateSnapshotData } from "./snapshots.types";
import { canonicalContentHash } from "./content-hash";
import { InternalError } from "../errors/appError";
import { READ_AFTER_INSERT_FAILURE } from "../errors/readAfterInsert";

const TABLE = "chapter_snapshots";

function coerceRow<T extends { is_auto: boolean | number }>(row: T): T {
  return { ...row, is_auto: Boolean(row.is_auto) };
}

export async function insert(db: Knex, data: CreateSnapshotData): Promise<SnapshotRow> {
  await db(TABLE).insert(data);
  // Re-read the persisted row rather than echoing the input. Any future
  // server-side default (trigger, computed column, DEFAULT expression)
  // would otherwise silently diverge from the returned shape, and the
  // re-read confirms the write actually landed.
  const row = await db(TABLE).where({ id: data.id }).first();
  // F-12: discriminating code rather than a bare Error clamped to a generic
  // 500. Unlike the image path this runs INSIDE createSnapshot's transaction,
  // so the throw rolls the insert back — nothing is committed and a retry is
  // safe. `snapshot.create` deliberately does NOT list this in committedCodes.
  if (!row) {
    throw new InternalError(
      `Snapshot ${data.id} was written but could not be read back.`,
      READ_AFTER_INSERT_FAILURE,
    );
  }
  return coerceRow(row);
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
  // Secondary `rowid DESC` order breaks ties when two manual snapshots share
  // the same millisecond ISO timestamp — otherwise dedup would be
  // nondeterministic under rapid scripted creates or test harness bursts.
  // S8 (agentic-review 2026-08-04, extended from outtakes): rowid, not id —
  // ids are v4 UUIDs and carry no ordering, so the tie-break was deterministic
  // but arbitrary, and here it decides WHICH snapshot dedup compares against.
  const row = await db(TABLE)
    .where({ chapter_id: chapterId, is_auto: false })
    .orderBy([
      { column: "created_at", order: "desc" },
      { column: "rowid", order: "desc" },
    ])
    .select("content")
    .first();
  if (!row) return null;
  return canonicalContentHash(row.content);
}

export async function getLatestContentHashAnyKind(
  db: Knex,
  chapterId: string,
): Promise<string | null> {
  // Dedup against the latest snapshot of ANY kind (manual OR auto). This is
  // the lookup the auto-snapshot insert path (restore / find-and-replace)
  // needs: it must skip a pre-operation snapshot whose content is byte-
  // identical to the most recent history entry — including a prior *auto*
  // snapshot left by an earlier restore/replace, which the manual-only
  // `getLatestContentHash` deliberately cannot see. The manual path keeps
  // the `is_auto: false` filter so an auto-snapshot never blocks a user's
  // explicit manual marker. Same `created_at DESC, rowid DESC` tie-break as the
  // manual lookup so dedup stays deterministic under same-millisecond bursts
  // and resolves to the last row actually inserted (S8).
  const row = await db(TABLE)
    .where({ chapter_id: chapterId })
    .orderBy([
      { column: "created_at", order: "desc" },
      { column: "rowid", order: "desc" },
    ])
    .select("content")
    .first();
  if (!row) return null;
  return canonicalContentHash(row.content);
}
