import { Router } from "express";
import type { Knex } from "knex";
import { v4 as uuid } from "uuid";
import { CreateProjectSchema, UpdateProjectSchema, ReorderChaptersSchema } from "@smudge/shared";
import { asyncHandler } from "../app";
import { parseChapterContent } from "./parseChapterContent";

export function projectsRouter(db: Knex): Router {
  const router = Router();

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const parsed = CreateProjectSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0]?.message ?? "Invalid input",
          },
        });
        return;
      }

      const { title, mode } = parsed.data;
      const projectId = uuid();
      const chapterId = uuid();
      const now = new Date().toISOString();

      await db.transaction(async (trx) => {
        await trx("projects").insert({
          id: projectId,
          title,
          mode,
          created_at: now,
          updated_at: now,
        });

        await trx("chapters").insert({
          id: chapterId,
          project_id: projectId,
          title: "Untitled Chapter",
          content: null,
          sort_order: 0,
          word_count: 0,
          created_at: now,
          updated_at: now,
        });
      });

      const project = await db("projects").where({ id: projectId }).first();
      res.status(201).json(project);
    }),
  );

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const result = await db("projects")
        .leftJoin("chapters", function () {
          this.on("projects.id", "=", "chapters.project_id").andOnNull("chapters.deleted_at");
        })
        .whereNull("projects.deleted_at")
        .groupBy("projects.id")
        .orderBy("projects.updated_at", "desc")
        .select(
          "projects.id",
          "projects.title",
          "projects.mode",
          "projects.updated_at",
          db.raw("COALESCE(SUM(chapters.word_count), 0) as total_word_count"),
        );

      res.json(result);
    }),
  );

  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const parsed = UpdateProjectSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0]?.message ?? "Invalid input",
          },
        });
        return;
      }

      const project = await db("projects")
        .where({ id: req.params.id })
        .whereNull("deleted_at")
        .first();

      if (!project) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Project not found." },
        });
        return;
      }

      await db("projects")
        .where({ id: req.params.id })
        .update({ title: parsed.data.title, updated_at: new Date().toISOString() });

      const updated = await db("projects").where({ id: req.params.id }).first();
      res.json(updated);
    }),
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const project = await db("projects")
        .where({ id: req.params.id })
        .whereNull("deleted_at")
        .first();

      if (!project) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Project not found." },
        });
        return;
      }

      const chapters = await db("chapters")
        .where({ project_id: req.params.id })
        .whereNull("deleted_at")
        .orderBy("sort_order", "asc")
        .select("*");

      const parsedChapters = chapters.map((ch: Record<string, unknown>) => parseChapterContent(ch));

      res.json({ ...project, chapters: parsedChapters });
    }),
  );

  router.post(
    "/:id/chapters",
    asyncHandler(async (req, res) => {
      const project = await db("projects")
        .where({ id: req.params.id })
        .whereNull("deleted_at")
        .first();

      if (!project) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Project not found." },
        });
        return;
      }

      const maxOrder = (await db("chapters")
        .where({ project_id: req.params.id })
        .whereNull("deleted_at")
        .max("sort_order as max")
        .first()) as { max: number | null };

      const chapterId = uuid();
      const now = new Date().toISOString();

      await db("chapters").insert({
        id: chapterId,
        project_id: req.params.id,
        title: "Untitled Chapter",
        content: null,
        sort_order: (maxOrder?.max ?? -1) + 1,
        word_count: 0,
        created_at: now,
        updated_at: now,
      });

      await db("projects").where({ id: req.params.id }).update({ updated_at: now });

      const chapter = await db("chapters").where({ id: chapterId }).first();
      res.status(201).json(parseChapterContent(chapter));
    }),
  );

  router.put(
    "/:id/chapters/order",
    asyncHandler(async (req, res) => {
      const project = await db("projects")
        .where({ id: req.params.id })
        .whereNull("deleted_at")
        .first();

      if (!project) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Project not found." },
        });
        return;
      }

      const parsed = ReorderChaptersSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0]?.message ?? "chapter_ids must be an array of UUIDs.",
          },
        });
        return;
      }
      const { chapter_ids } = parsed.data;

      const existing = await db("chapters")
        .where({ project_id: req.params.id })
        .whereNull("deleted_at")
        .select("id");
      const existingIds = existing.map((c: { id: string }) => c.id).sort();
      const providedIds = [...chapter_ids].sort();

      if (
        existingIds.length !== providedIds.length ||
        !existingIds.every((id: string, i: number) => id === providedIds[i])
      ) {
        res.status(400).json({
          error: {
            code: "REORDER_MISMATCH",
            message: "Provided chapter IDs do not match existing chapters.",
          },
        });
        return;
      }

      await db.transaction(async (trx) => {
        for (let i = 0; i < chapter_ids.length; i++) {
          await trx("chapters").where({ id: chapter_ids[i] }).update({ sort_order: i });
        }
        await trx("projects")
          .where({ id: req.params.id })
          .update({ updated_at: new Date().toISOString() });
      });

      res.json({ message: "Chapter order updated." });
    }),
  );

  router.get(
    "/:id/trash",
    asyncHandler(async (req, res) => {
      const project = await db("projects").where({ id: req.params.id }).first();

      if (!project) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Project not found." },
        });
        return;
      }

      const trashed = await db("chapters")
        .where({ project_id: req.params.id })
        .whereNotNull("deleted_at")
        .orderBy("deleted_at", "desc")
        .select("*");

      res.json(trashed.map((ch: Record<string, unknown>) => parseChapterContent(ch)));
    }),
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const project = await db("projects")
        .where({ id: req.params.id })
        .whereNull("deleted_at")
        .first();

      if (!project) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Project not found." },
        });
        return;
      }

      const now = new Date().toISOString();

      // Soft-delete all chapters belonging to this project
      await db("chapters")
        .where({ project_id: req.params.id })
        .whereNull("deleted_at")
        .update({ deleted_at: now });

      await db("projects").where({ id: req.params.id }).update({ deleted_at: now });

      res.json({ message: "Project moved to trash." });
    }),
  );

  return router;
}
