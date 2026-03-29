import { Router } from "express";
import type { Knex } from "knex";
import { UpdateChapterSchema, countWords } from "@smudge/shared";
import { asyncHandler } from "../app";
import { parseChapterContent } from "./parseChapterContent";

export function chaptersRouter(db: Knex): Router {
  const router = Router();

  router.get(
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

      res.json(parseChapterContent(chapter));
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

      await db.transaction(async (trx) => {
        await trx("chapters").where({ id: req.params.id }).update(updates);
        await trx("projects")
          .where({ id: chapter.project_id })
          .update({ updated_at: new Date().toISOString() });
      });

      const updated = await db("chapters").where({ id: req.params.id }).first();

      res.json(parseChapterContent(updated));
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
      await db("chapters").where({ id: req.params.id }).update({ deleted_at: now });

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

      // Restore the chapter and parent project atomically
      await db.transaction(async (trx) => {
        await trx("chapters").where({ id: req.params.id }).update({ deleted_at: null });
        await trx("projects")
          .where({ id: chapter.project_id })
          .whereNotNull("deleted_at")
          .update({ deleted_at: null });
      });

      const restored = await db("chapters").where({ id: req.params.id }).first();
      res.json(parseChapterContent(restored));
    }),
  );

  return router;
}
