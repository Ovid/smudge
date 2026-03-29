import type { Knex } from "knex";

export async function purgeOldTrash(db: Knex): Promise<{ chapters: number; projects: number }> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Delete chapters that expired on their own
  let chapters = await db("chapters")
    .where("deleted_at", "<", cutoff)
    .delete();

  // Find projects to purge
  const projectsToPurge = await db("projects")
    .where("deleted_at", "<", cutoff)
    .select("id");

  // Delete any remaining chapters belonging to purged projects (prevents orphans)
  if (projectsToPurge.length > 0) {
    const ids = projectsToPurge.map((p: { id: string }) => p.id);
    chapters += await db("chapters").whereIn("project_id", ids).delete();
  }

  const projects = await db("projects")
    .where("deleted_at", "<", cutoff)
    .delete();

  return { chapters, projects };
}
