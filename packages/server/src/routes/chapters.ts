import { Router } from "express";
import type { Knex } from "knex";
import { UpdateChapterSchema } from "@smudge/shared";

function parseChapterContent(chapter: Record<string, unknown>) {
  return {
    ...chapter,
    content: typeof chapter.content === "string" ? JSON.parse(chapter.content) : chapter.content ?? null,
  };
}

export function chaptersRouter(db: Knex): Router {
  const router = Router();

  router.get("/:id", async (req, res) => {
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
  });

  router.patch("/:id", async (req, res) => {
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
    }

    await db("chapters").where({ id: req.params.id }).update(updates);

    // Also update project's updated_at
    await db("projects")
      .where({ id: chapter.project_id })
      .update({ updated_at: new Date().toISOString() });

    const updated = await db("chapters")
      .where({ id: req.params.id })
      .first();

    res.json(parseChapterContent(updated));
  });

  return router;
}
