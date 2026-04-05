import type { Knex } from "knex";
import type { ChapterStatusRow } from "./chapter-statuses.types";

export async function list(
  trx: Knex.Transaction | Knex,
): Promise<ChapterStatusRow[]> {
  return trx("chapter_statuses")
    .orderBy("sort_order", "asc")
    .select("status", "sort_order", "label");
}

export async function findByStatus(
  trx: Knex.Transaction | Knex,
  status: string,
): Promise<ChapterStatusRow | undefined> {
  return trx("chapter_statuses").where({ status }).first();
}

export async function getStatusLabel(
  trx: Knex.Transaction | Knex,
  status: string,
): Promise<string> {
  const row = await trx("chapter_statuses").where({ status }).first("label");
  return row?.label ?? status;
}

export async function getStatusLabelMap(
  trx: Knex.Transaction | Knex,
): Promise<Record<string, string>> {
  const rows = await trx("chapter_statuses")
    .orderBy("sort_order", "asc")
    .select("status", "label");
  return Object.fromEntries(
    rows.map((r: { status: string; label: string }) => [r.status, r.label]),
  );
}
