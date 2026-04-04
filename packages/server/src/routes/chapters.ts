import { Router } from "express";
import type { Knex } from "knex";
import { UpdateChapterSchema, countWords, generateSlug } from "@smudge/shared";
import { asyncHandler } from "../app";
import { queryChapter, sendCorruptContentError } from "./chapterQueries";
import { resolveUniqueSlug } from "./resolve-slug";
import { getStatusLabel } from "./status-labels";
import { insertSaveEvent, upsertDailySnapshot } from "./velocityHelpers";

export function chaptersRouter(db: Knex): Router {
  const router = Router();

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const chapter = await queryChapter(
        db("chapters").where({ id: req.params.id }).whereNull("deleted_at"),
      );

      if (!chapter) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Chapter not found." },
        });
        return;
      }

      if (sendCorruptContentError(chapter, res)) return;

      const status_label = await getStatusLabel(db, chapter.status as string);
      res.json({ ...chapter, status_label });
    }),
  );

  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const parsed = UpdateChapterSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0]?.message ?? "Invalid input",
          },
        });
        return;
      }

      const chapter = await db("chapters")
        .where({ id: req.params.id })
        .whereNull("deleted_at")
        .first();

      if (!chapter) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Chapter not found." },
        });
        return;
      }

      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (parsed.data.title !== undefined) {
        updates.title = parsed.data.title;
      }

      if (parsed.data.content !== undefined) {
        updates.content = JSON.stringify(parsed.data.content);
        updates.word_count = countWords(parsed.data.content as Record<string, unknown>);
      }

      if (parsed.data.target_word_count !== undefined) {
        updates.target_word_count = parsed.data.target_word_count;
      }

      if (parsed.data.status !== undefined) {
        // Intentional: Zod enum validates the status format, but this DB check
        // guards against drift between the enum and the chapter_statuses table
        // (e.g., a new status added to the enum without a corresponding migration).
        const validStatus = await db("chapter_statuses")
          .where({ status: parsed.data.status })
          .first();
        if (!validStatus) {
          res.status(400).json({
            error: {
              code: "VALIDATION_ERROR",
              message: `Invalid status: ${parsed.data.status}`,
            },
          });
          return;
        }
        updates.status = parsed.data.status;
      }

      await db.transaction(async (trx) => {
        await trx("chapters").where({ id: req.params.id }).update(updates);
        await trx("projects")
          .where({ id: chapter.project_id })
          .update({ updated_at: new Date().toISOString() });
      });

      // Fire velocity side-effects (best-effort, after the main save transaction succeeds)
      if (parsed.data.content !== undefined) {
        try {
          await insertSaveEvent(
            db,
            chapter.id as string,
            chapter.project_id,
            updates.word_count as number,
          );
          await upsertDailySnapshot(db, chapter.project_id);
        } catch {
          // Best-effort: don't let velocity tracking failures affect save response
        }
      }

      const updated = await queryChapter(
        db("chapters").where({ id: req.params.id }).whereNull("deleted_at"),
      );
      if (!updated) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Chapter not found." },
        });
        return;
      }
      // Only check corruption when content was part of the update.
      // Non-content updates (title, status) should succeed even if the
      // chapter has pre-existing corrupt content.
      if (parsed.data.content !== undefined && sendCorruptContentError(updated, res)) return;

      const updatedStatusLabel = await getStatusLabel(db, updated.status as string);

      res.json({ ...updated, status_label: updatedStatusLabel });
    }),
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const chapter = await db("chapters")
        .where({ id: req.params.id })
        .whereNull("deleted_at")
        .first();

      if (!chapter) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Chapter not found." },
        });
        return;
      }

      const now = new Date().toISOString();
      await db.transaction(async (trx) => {
        await trx("chapters").where({ id: req.params.id }).update({ deleted_at: now });
        await trx("projects").where({ id: chapter.project_id }).update({ updated_at: now });
      });

      // Update daily snapshot so deleted chapter's words are excluded
      await upsertDailySnapshot(db, chapter.project_id);

      res.json({ message: "Chapter moved to trash." });
    }),
  );

  router.post(
    "/:id/restore",
    asyncHandler(async (req, res) => {
      const chapter = await db("chapters")
        .where({ id: req.params.id })
        .whereNotNull("deleted_at")
        .first();

      if (!chapter) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Deleted chapter not found." },
        });
        return;
      }

      // Verify parent project still exists (may have been hard-purged)
      const parentProject = await db("projects").where({ id: chapter.project_id }).first();
      if (!parentProject) {
        res.status(404).json({
          error: {
            code: "PROJECT_PURGED",
            message: "The parent project has been permanently deleted.",
          },
        });
        return;
      }

      // Restore the chapter (and parent project if deleted) atomically
      try {
        await db.transaction(async (trx) => {
          await trx("chapters")
            .where({ id: req.params.id })
            .update({ deleted_at: null, updated_at: new Date().toISOString() });

          if (parentProject.deleted_at) {
            const freshSlug = await resolveUniqueSlug(
              trx,
              generateSlug(parentProject.title),
              parentProject.id,
            );
            const projectUpdate: Record<string, unknown> = {
              deleted_at: null,
              updated_at: new Date().toISOString(),
              slug: freshSlug,
            };
            await trx("projects").where({ id: chapter.project_id }).update(projectUpdate);
          }
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
          res.status(409).json({
            error: {
              code: "RESTORE_CONFLICT",
              message: "Could not restore — slug conflict. Please try again.",
            },
          });
          return;
        }
        throw err;
      }

      // Update daily snapshot so restored chapter's words are included
      await upsertDailySnapshot(db, chapter.project_id);

      const restored = await queryChapter(
        db("chapters").where({ id: req.params.id }).whereNull("deleted_at"),
      );
      if (!restored) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Chapter not found." },
        });
        return;
      }
      // Do NOT check content_corrupt here. Restoring a chapter from trash
      // should always succeed — the GET /chapters/:id endpoint will surface
      // corruption when the user actually opens the chapter.
      const updatedProject = await db("projects").where({ id: chapter.project_id }).first();
      const restoredStatusLabel = await getStatusLabel(db, restored.status as string);
      res.json({
        ...restored,
        status_label: restoredStatusLabel,
        project_slug: updatedProject?.slug,
      });
    }),
  );

  return router;
}
