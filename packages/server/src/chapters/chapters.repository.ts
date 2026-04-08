import type { Knex } from "knex";
import type {
  ChapterRow,
  ChapterRawRow,
  ChapterMetadataRow,
  DeletedChapterRow,
  CreateChapterRow,
  UpdateChapterData,
} from "./chapters.types";

// --- Content parsing ---

function parseContent(row: Record<string, unknown>): ChapterRow {
  if (typeof row.content === "string") {
    try {
      return { ...row, content: JSON.parse(row.content) } as ChapterRow;
    } catch (err) {
      console.error(
        `[parseChapterContent] corrupt JSON in chapter ${row.id ?? "unknown"} (${err instanceof Error ? err.name : "UnknownError"})`,
      );
      return { ...row, content: null, content_corrupt: true } as ChapterRow;
    }
  }
  return { ...row, content: (row.content as Record<string, unknown>) ?? null } as ChapterRow;
}

// Exported for backward compat with existing parseChapterContent tests
export { parseContent as parseChapterContent };

// --- Backward-compat query helpers (used by existing tests) ---

export async function queryChapter(
  builder: import("knex").Knex.QueryBuilder,
): Promise<Record<string, unknown> | null> {
  const row = await builder.first();
  return row ? (parseContent(row) as unknown as Record<string, unknown>) : null;
}

export async function queryChapters(
  builder: import("knex").Knex.QueryBuilder,
): Promise<Record<string, unknown>[]> {
  const rows = await builder;
  return rows.map(
    (row: Record<string, unknown>) => parseContent(row) as unknown as Record<string, unknown>,
  );
}

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
    .select(
      "id",
      "title",
      "status",
      "word_count",
      "target_word_count",
      "updated_at",
      "sort_order",
    ) as Promise<ChapterMetadataRow[]>;
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

export async function listIdTitleStatusByProject(
  trx: Knex.Transaction | Knex,
  projectId: string,
): Promise<Array<{ id: string; title: string; status: string }>> {
  return trx("chapters")
    .where({ project_id: projectId })
    .whereNull("deleted_at")
    .select("id", "title", "status");
}

export async function getChapterNamesMapIncludingDeleted(
  trx: Knex.Transaction | Knex,
  projectId: string,
): Promise<Record<string, string>> {
  const rows = await trx("chapters").where({ project_id: projectId }).select("id", "title");
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.id] = row.title;
  }
  return map;
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
  await trx("chapters").where({ id }).update({ deleted_at: now });
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
): Promise<void> {
  await trx("chapters")
    .where({ id })
    .update({ deleted_at: null, sort_order: sortOrder, updated_at: now });
}
