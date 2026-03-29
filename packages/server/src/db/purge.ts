import type { Knex } from "knex";

export async function purgeOldTrash(db: Knex): Promise<{ chapters: number; projects: number }> {
  const chapters = await db("chapters")
    .where("deleted_at", "<", db.raw("datetime('now', '-30 days')"))
    .delete();

  const projects = await db("projects")
    .where("deleted_at", "<", db.raw("datetime('now', '-30 days')"))
    .delete();

  return { chapters, projects };
}
