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
    // Delete snapshots for chapters that expired on their own, then delete those chapters
    const expiredChapterIds = await trx("chapters").where("deleted_at", "<", cutoff).select("id");
    if (expiredChapterIds.length > 0) {
      await trx("chapter_snapshots")
        .whereIn(
          "chapter_id",
          expiredChapterIds.map((c: { id: string }) => c.id),
        )
        .delete();
    }
    let chapters = await trx("chapters").where("deleted_at", "<", cutoff).delete();

    // Find projects eligible for purge
    const projectsToPurge = await trx("projects").where("deleted_at", "<", cutoff).select("id");

    // Only purge projects that have no remaining non-deleted chapters (defense-in-depth)
    const projectsWithLiveChapters = trx("chapters").whereNull("deleted_at").select("project_id");
    const candidateIds = projectsToPurge.map((p: { id: string }) => p.id);

    // Compute the actual set of project IDs that will be purged
    const actuallyPurged =
      candidateIds.length > 0
        ? (
            await trx("projects")
              .whereIn("id", candidateIds)
              .where("deleted_at", "<", cutoff)
              .whereNotIn("id", projectsWithLiveChapters)
              .select("id")
          ).map((p: { id: string }) => p.id)
        : [];

    let images = 0;

    // Delete snapshots, image records, and remaining chapters only for actually-purged projects
    if (actuallyPurged.length > 0) {
      const projectChapterIds = await trx("chapters")
        .whereIn("project_id", actuallyPurged)
        .whereNotNull("deleted_at")
        .select("id");
      if (projectChapterIds.length > 0) {
        await trx("chapter_snapshots")
          .whereIn(
            "chapter_id",
            projectChapterIds.map((c: { id: string }) => c.id),
          )
          .delete();
      }
      images = await trx("images").whereIn("project_id", actuallyPurged).delete();
      chapters += await trx("chapters")
        .whereIn("project_id", actuallyPurged)
        .whereNotNull("deleted_at")
        .delete();
    }

    const projects =
      actuallyPurged.length > 0 ? await trx("projects").whereIn("id", actuallyPurged).delete() : 0;

    return {
      chapters,
      projects,
      images,
      purgedProjectIds: actuallyPurged,
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
