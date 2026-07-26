import type { Knex } from "knex";
import type {
  ChapterRow,
  ChapterRawRow,
  ChapterMetadataRow,
  DeletedChapterRow,
  CreateChapterRow,
  UpdateChapterData,
} from "./chapters.types";
import { logger } from "../logger";

// --- Content parsing ---

function parseContent(row: Record<string, unknown>): ChapterRow {
  if (typeof row.content === "string") {
    try {
      const parsed: unknown = JSON.parse(row.content);
      // I6 (dedup review 2026-07-26): "valid JSON, wrong shape" — "42", "[]",
      // "null", '"text"' — parses WITHOUT throwing, so guarding only the throw
      // returned e.g. `{ ...row, content: 42 }` with no content_corrupt flag.
      // isCorruptChapter was then false, the row was served as healthy, and the
      // designed CORRUPT_CONTENT route (chapters.routes.ts) could not fire for
      // it. Both sibling parsers already guard this — snapshots.service.ts
      // since a19e8aa, outtakes.repository.ts since 5d3d495 ("mirroring
      // snapshots.service.ts") — and chapters was the one that never got it.
      //
      // The three sites keep deliberately DIFFERENT degrade policies
      // (corrupt-flag here, empty-doc for outtakes, reject-restore for
      // snapshots), so the guard is shared by shape, not by extraction.
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new TypeError("Chapter content is not a JSON object");
      }
      return { ...row, content: parsed } as ChapterRow;
    } catch (err) {
      logger.error(
        {
          parseError: err instanceof Error ? err.name : "UnknownError",
          chapter_id: row.id ?? "unknown",
        },
        "Corrupt JSON in chapter content",
      );
      return { ...row, content: null, content_corrupt: true } as ChapterRow;
    }
  }
  return { ...row, content: (row.content as Record<string, unknown>) ?? null } as ChapterRow;
}

// Exported for tests that need to verify content parsing behavior
export { parseContent as parseChapterContent };

// --- Queries ---

export async function findById(
  trx: Knex.Transaction | Knex,
  id: string,
): Promise<ChapterRow | null> {
  const row = await trx("chapters").where({ id }).whereNull("deleted_at").first();
  return row ? parseContent(row) : null;
}

export async function findDeletedById(
  trx: Knex.Transaction | Knex,
  id: string,
): Promise<ChapterRawRow | null> {
  const row = await trx("chapters").where({ id }).whereNotNull("deleted_at").first();
  return (row as ChapterRawRow) ?? null;
}

export async function findByIdRaw(
  trx: Knex.Transaction | Knex,
  id: string,
): Promise<ChapterRawRow | null> {
  const row = await trx("chapters").where({ id }).whereNull("deleted_at").first();
  return (row as ChapterRawRow) ?? null;
}

export async function listByProject(
  trx: Knex.Transaction | Knex,
  projectId: string,
): Promise<ChapterRow[]> {
  const rows = await trx("chapters")
    .where({ project_id: projectId })
    .whereNull("deleted_at")
    .orderBy("sort_order", "asc")
    .select("*");
  return rows.map((row: Record<string, unknown>) => parseContent(row));
}

export async function listMetadataByProject(
  trx: Knex.Transaction | Knex,
  projectId: string,
): Promise<ChapterMetadataRow[]> {
  return trx("chapters")
    .where({ project_id: projectId })
    .whereNull("deleted_at")
    .orderBy("sort_order", "asc")
    .select("id", "title", "status", "word_count", "updated_at", "sort_order") as Promise<
    ChapterMetadataRow[]
  >;
}

export async function listDeletedByProject(
  trx: Knex.Transaction | Knex,
  projectId: string,
): Promise<DeletedChapterRow[]> {
  const rows = await trx("chapters")
    .where({ project_id: projectId })
    .whereNotNull("deleted_at")
    .orderBy("deleted_at", "desc")
    .select(
      "id",
      "project_id",
      "title",
      "status",
      "word_count",
      "sort_order",
      "deleted_at",
      "created_at",
      "updated_at",
    );
  return rows.map((ch: Record<string, unknown>) => ({ ...ch, content: null }) as DeletedChapterRow);
}

export async function listIdsByProject(
  trx: Knex.Transaction | Knex,
  projectId: string,
): Promise<string[]> {
  const rows = await trx("chapters")
    .where({ project_id: projectId })
    .whereNull("deleted_at")
    .select("id");
  return rows.map((r: { id: string }) => r.id);
}

export async function sumWordCountByProject(
  trx: Knex.Transaction | Knex,
  projectId: string,
): Promise<number> {
  const result = await trx("chapters")
    .where({ project_id: projectId })
    .whereNull("deleted_at")
    .sum("word_count as total");
  return Number(result[0]?.total) || 0;
}

// --- Mutations ---

export async function insert(trx: Knex.Transaction | Knex, data: CreateChapterRow): Promise<void> {
  await trx("chapters").insert(data);
}

export async function getMaxSortOrder(
  trx: Knex.Transaction | Knex,
  projectId: string,
): Promise<number> {
  const result = (await trx("chapters")
    .where({ project_id: projectId })
    .whereNull("deleted_at")
    .max("sort_order as max")
    .first()) as { max: number | null };
  return result?.max ?? -1;
}

export async function update(
  trx: Knex.Transaction | Knex,
  id: string,
  updates: UpdateChapterData,
): Promise<number> {
  return trx("chapters").where({ id }).whereNull("deleted_at").update(updates);
}

export async function updateSortOrders(
  trx: Knex.Transaction | Knex,
  orders: Array<{ id: string; sort_order: number }>,
): Promise<void> {
  for (const { id, sort_order } of orders) {
    await trx("chapters").where({ id }).whereNull("deleted_at").update({ sort_order });
  }
}

export async function softDelete(
  trx: Knex.Transaction | Knex,
  id: string,
  now: string,
): Promise<void> {
  await trx("chapters").where({ id }).whereNull("deleted_at").update({ deleted_at: now });
}

export async function softDeleteByProject(
  trx: Knex.Transaction | Knex,
  projectId: string,
  now: string,
): Promise<void> {
  await trx("chapters")
    .where({ project_id: projectId })
    .whereNull("deleted_at")
    .update({ deleted_at: now });
}

export async function restore(
  trx: Knex.Transaction | Knex,
  id: string,
  sortOrder: number,
  now: string,
): Promise<number> {
  return trx("chapters")
    .where({ id })
    .whereNotNull("deleted_at")
    .update({ deleted_at: null, sort_order: sortOrder, updated_at: now });
}

export async function listContentByProject(
  db: Knex | Knex.Transaction,
  projectId: string,
): Promise<Array<{ id: string; title: string; content: string | null; word_count: number }>> {
  return db("chapters")
    .where("project_id", projectId)
    .whereNull("deleted_at")
    .orderBy("sort_order", "asc")
    .select("id", "title", "content", "word_count");
}

export async function listAllContentByProject(
  db: Knex | Knex.Transaction,
  projectId: string,
): Promise<
  Array<{ id: string; title: string; content: string | null; deleted_at: string | null }>
> {
  return db("chapters")
    .where("project_id", projectId)
    .select("id", "title", "content", "deleted_at");
}
