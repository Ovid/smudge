import { Router } from "express";
import type { Knex } from "knex";
import { v4 as uuid } from "uuid";
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  ReorderChaptersSchema,
  generateSlug,
} from "@smudge/shared";
import { asyncHandler } from "../app";
import { parseChapterContent } from "./parseChapterContent";
import { resolveUniqueSlug } from "./resolve-slug";

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

      // Check title uniqueness
      const existingTitle = await db("projects").where({ title }).whereNull("deleted_at").first();
      if (existingTitle) {
        res.status(400).json({
          error: {
            code: "PROJECT_TITLE_EXISTS",
            message: "A project with that title already exists",
          },
        });
        return;
      }

      const slug = await resolveUniqueSlug(db, generateSlug(title));
      const projectId = uuid();
      const chapterId = uuid();
      const now = new Date().toISOString();

      await db.transaction(async (trx) => {
        await trx("projects").insert({
          id: projectId,
          title,
          slug,
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
          "projects.slug",
          "projects.mode",
          "projects.updated_at",
          db.raw("COALESCE(SUM(chapters.word_count), 0) as total_word_count"),
        );

      // SQLite returns raw expressions as strings — coerce to number
      const projects = result.map((r: Record<string, unknown>) => ({
        ...r,
        total_word_count: Number(r.total_word_count),
      }));
      res.json(projects);
    }),
  );

  router.patch(
    "/:slug",
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
        .where({ slug: req.params.slug })
        .whereNull("deleted_at")
        .first();

      if (!project) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Project not found." },
        });
        return;
      }

      const { title } = parsed.data;

      const existingTitle = await db("projects")
        .where({ title })
        .whereNull("deleted_at")
        .whereNot({ id: project.id })
        .first();
      if (existingTitle) {
        res.status(400).json({
          error: {
            code: "PROJECT_TITLE_EXISTS",
            message: "A project with that title already exists",
          },
        });
        return;
      }

      const newSlug = await resolveUniqueSlug(db, generateSlug(title), project.id);

      await db("projects")
        .where({ id: project.id })
        .update({ title, slug: newSlug, updated_at: new Date().toISOString() });

      const updated = await db("projects").where({ id: project.id }).first();
      res.json(updated);
    }),
  );

  router.get(
    "/:slug",
    asyncHandler(async (req, res) => {
      const project = await db("projects")
        .where({ slug: req.params.slug })
        .whereNull("deleted_at")
        .first();

      if (!project) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Project not found." },
        });
        return;
      }

      const chapters = await db("chapters")
        .where({ project_id: project.id })
        .whereNull("deleted_at")
        .orderBy("sort_order", "asc")
        .select("*");

      const parsedChapters = chapters.map((ch: Record<string, unknown>) => parseChapterContent(ch));

      res.json({ ...project, chapters: parsedChapters });
    }),
  );

  router.post(
    "/:slug/chapters",
    asyncHandler(async (req, res) => {
      const project = await db("projects")
        .where({ slug: req.params.slug })
        .whereNull("deleted_at")
        .first();

      if (!project) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Project not found." },
        });
        return;
      }

      const maxOrder = (await db("chapters")
        .where({ project_id: project.id })
        .whereNull("deleted_at")
        .max("sort_order as max")
        .first()) as { max: number | null };

      const chapterId = uuid();
      const now = new Date().toISOString();

      await db("chapters").insert({
        id: chapterId,
        project_id: project.id,
        title: "Untitled Chapter",
        content: null,
        sort_order: (maxOrder?.max ?? -1) + 1,
        word_count: 0,
        created_at: now,
        updated_at: now,
      });

      await db("projects").where({ id: project.id }).update({ updated_at: now });

      const chapter = await db("chapters").where({ id: chapterId }).first();
      res.status(201).json(parseChapterContent(chapter));
    }),
  );

  router.put(
    "/:slug/chapters/order",
    asyncHandler(async (req, res) => {
      const project = await db("projects")
        .where({ slug: req.params.slug })
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
        .where({ project_id: project.id })
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
          .where({ id: project.id })
          .update({ updated_at: new Date().toISOString() });
      });

      res.json({ message: "Chapter order updated." });
    }),
  );

  router.get(
    "/:slug/trash",
    asyncHandler(async (req, res) => {
      const project = await db("projects").where({ slug: req.params.slug }).first();

      if (!project) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Project not found." },
        });
        return;
      }

      const trashed = await db("chapters")
        .where({ project_id: project.id })
        .whereNotNull("deleted_at")
        .orderBy("deleted_at", "desc")
        .select("*");

      res.json(trashed.map((ch: Record<string, unknown>) => parseChapterContent(ch)));
    }),
  );

  router.delete(
    "/:slug",
    asyncHandler(async (req, res) => {
      const project = await db("projects")
        .where({ slug: req.params.slug })
        .whereNull("deleted_at")
        .first();

      if (!project) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Project not found." },
        });
        return;
      }

      const now = new Date().toISOString();

      await db.transaction(async (trx) => {
        await trx("chapters")
          .where({ project_id: project.id })
          .whereNull("deleted_at")
          .update({ deleted_at: now });

        await trx("projects").where({ id: project.id }).update({ deleted_at: now });
      });

      res.json({ message: "Project moved to trash." });
    }),
  );

  return router;
}
