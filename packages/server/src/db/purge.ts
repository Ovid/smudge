import type { Knex } from "knex";
import { TRASH_RETENTION_MS } from "@smudge/shared";

export async function purgeOldTrash(db: Knex): Promise<{ chapters: number; projects: number }> {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_MS).toISOString();

  return db.transaction(async (trx) => {
    // Delete chapters that expired on their own
    let chapters = await trx("chapters").where("deleted_at", "<", cutoff).delete();

    // Find projects to purge
    const projectsToPurge = await trx("projects").where("deleted_at", "<", cutoff).select("id");

    // Delete any remaining chapters belonging to purged projects (prevents orphans)
    if (projectsToPurge.length > 0) {
      const ids = projectsToPurge.map((p: { id: string }) => p.id);
      chapters += await trx("chapters").whereIn("project_id", ids).delete();
    }

    const projects = await trx("projects").where("deleted_at", "<", cutoff).delete();

    return { chapters, projects };
  });
}
