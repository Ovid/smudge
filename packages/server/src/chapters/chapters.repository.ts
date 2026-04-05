import type { Knex } from "knex";

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

export async function listIdTitleStatusByProject(
  trx: Knex.Transaction | Knex,
  projectId: string,
): Promise<Array<{ id: string; title: string; status: string }>> {
  return trx("chapters")
    .where({ project_id: projectId })
    .whereNull("deleted_at")
    .select("id", "title", "status");
}

export async function getChapterNamesMap(
  trx: Knex.Transaction | Knex,
  projectId: string,
): Promise<Record<string, string>> {
  const rows = await trx("chapters")
    .where({ project_id: projectId })
    .select("id", "title");
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.id] = row.title;
  }
  return map;
}
