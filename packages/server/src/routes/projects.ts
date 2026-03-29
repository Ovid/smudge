import { Router } from "express";
import type { Knex } from "knex";
import { v4 as uuid } from "uuid";
import { CreateProjectSchema } from "@smudge/shared";

export function projectsRouter(db: Knex): Router {
  const router = Router();

  router.post("/", async (req, res) => {
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

    await db("projects").insert({
      id: projectId,
      title,
      mode,
      created_at: now,
      updated_at: now,
    });

    await db("chapters").insert({
      id: chapterId,
      project_id: projectId,
      title: "Untitled Chapter",
      content: null,
      sort_order: 0,
      word_count: 0,
      created_at: now,
      updated_at: now,
    });

    const project = await db("projects").where({ id: projectId }).first();
    res.status(201).json(project);
  });

  router.get("/", async (_req, res) => {
    const projects = await db("projects")
      .whereNull("deleted_at")
      .orderBy("updated_at", "desc")
      .select("id", "title", "mode", "updated_at");

    const result = await Promise.all(
      projects.map(async (p) => {
        const { total } = (await db("chapters")
          .where({ project_id: p.id })
          .whereNull("deleted_at")
          .sum("word_count as total")
          .first()) as { total: number };
        return { ...p, total_word_count: total ?? 0 };
      }),
    );

    res.json(result);
  });

  router.patch("/:id", async (req, res) => {
    const { title } = req.body as { title?: string };
    if (!title || !title.trim()) {
      res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "Title is required." },
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
      .update({ title: title.trim(), updated_at: new Date().toISOString() });

    const updated = await db("projects").where({ id: req.params.id }).first();
    res.json(updated);
  });

  router.get("/:id", async (req, res) => {
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

    res.json({ ...project, chapters });
  });

  router.post("/:id/chapters", async (req, res) => {
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
    res.status(201).json(chapter);
  });

  router.delete("/:id", async (req, res) => {
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
  });

  return router;
}
