import type { Knex } from "knex";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TRASH_RETENTION_MS } from "@smudge/shared";
import { logger } from "../logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function purgeOldTrash(
  db: Knex,
  dataDir?: string,
): Promise<{ chapters: number; projects: number; images: number }> {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_MS).toISOString();
  const resolvedDataDir = dataDir ?? process.env.DATA_DIR ?? path.join(__dirname, "../../data");

  const { chapters, projects, images, purgedProjectIds } = await db.transaction(async (trx) => {
    // Delete chapters that expired on their own
    let chapters = await trx("chapters").where("deleted_at", "<", cutoff).delete();

    // Find projects to purge
    const projectsToPurge = await trx("projects").where("deleted_at", "<", cutoff).select("id");

    let images = 0;

    // Delete image records and remaining chapters belonging to purged projects
    if (projectsToPurge.length > 0) {
      const ids = projectsToPurge.map((p: { id: string }) => p.id);
      images = await trx("images").whereIn("project_id", ids).delete();
      chapters += await trx("chapters")
        .whereIn("project_id", ids)
        .whereNotNull("deleted_at")
        .delete();
    }

    // Only purge projects that have no remaining non-deleted chapters (defense-in-depth)
    const projectsWithLiveChapters = trx("chapters").whereNull("deleted_at").select("project_id");
    const projects = await trx("projects")
      .where("deleted_at", "<", cutoff)
      .whereNotIn("id", projectsWithLiveChapters)
      .delete();

    return {
      chapters,
      projects,
      images,
      purgedProjectIds: projectsToPurge.map((p: { id: string }) => p.id),
    };
  });

  // Best-effort cleanup of image directories on disk
  for (const projectId of purgedProjectIds) {
    const imageDir = path.join(resolvedDataDir, "images", projectId);
    try {
      await fs.rm(imageDir, { recursive: true, force: true });
    } catch (err) {
      logger.warn({ err, projectId }, "Failed to clean up image directory during purge");
    }
  }

  return { chapters, projects, images };
}
