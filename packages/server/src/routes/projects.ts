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
        const { total } = await db("chapters")
          .where({ project_id: p.id })
          .whereNull("deleted_at")
          .sum("word_count as total")
          .first() as { total: number };
        return { ...p, total_word_count: total ?? 0 };
      }),
    );

    res.json(result);
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

  return router;
}
