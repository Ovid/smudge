import type { Knex } from "knex";

export async function purgeOldTrash(db: Knex): Promise<{ chapters: number; projects: number }> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const chapters = await db("chapters")
    .where("deleted_at", "<", cutoff)
    .delete();

  const projects = await db("projects")
    .where("deleted_at", "<", cutoff)
    .delete();

  return { chapters, projects };
}
