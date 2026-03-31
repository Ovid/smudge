import type { Knex } from "knex";

export async function getStatusLabel(db: Knex, status: string): Promise<string> {
  const row = await db("chapter_statuses").where({ status }).first("label");
  return row?.label ?? status;
}

export async function getStatusLabelMap(db: Knex): Promise<Record<string, string>> {
  const rows = await db("chapter_statuses").orderBy("sort_order", "asc").select("status", "label");
  return Object.fromEntries(
    rows.map((r: { status: string; label: string }) => [r.status, r.label]),
  );
}
