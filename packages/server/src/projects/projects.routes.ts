import { Router } from "express";
import { asyncHandler } from "../app";
import * as ProjectService from "./projects.service";
import { velocityHandler } from "../velocity/velocity.routes";

export function projectsRouter(): Router {
  const router = Router();

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      try {
        const result = await ProjectService.createProject(req.body);
        if ("validationError" in result) {
          res.status(400).json({
            error: { code: "VALIDATION_ERROR", message: result.validationError },
          });
          return;
        }
        res.status(201).json(result.project);
      } catch (err) {
        if (err instanceof ProjectService.ProjectTitleExistsError) {
          res.status(400).json({
            error: {
              code: "PROJECT_TITLE_EXISTS",
              message: "A project with that title already exists",
            },
          });
          return;
        }
        throw err;
      }
    }),
  );

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const projects = await ProjectService.listProjects();
      res.json(projects);
    }),
  );

  router.patch(
    "/:slug",
    asyncHandler(async (req, res) => {
      try {
        const result = await ProjectService.updateProject(req.params.slug as string, req.body);
        if (!result) {
          res.status(404).json({
            error: { code: "NOT_FOUND", message: "Project not found." },
          });
          return;
        }
        if ("validationError" in result) {
          res.status(400).json({
            error: { code: "VALIDATION_ERROR", message: result.validationError },
          });
          return;
        }
        res.json(result.project);
      } catch (err) {
        if (err instanceof ProjectService.ProjectTitleExistsError) {
          res.status(400).json({
            error: {
              code: "PROJECT_TITLE_EXISTS",
              message: "A project with that title already exists",
            },
          });
          return;
        }
        throw err;
      }
    }),
  );

  router.get("/:slug/velocity", velocityHandler);

  router.get(
    "/:slug",
    asyncHandler(async (req, res) => {
      const result = await ProjectService.getProject(req.params.slug as string);
      if (!result) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Project not found." },
        });
        return;
      }
      res.json({ ...result.project, chapters: result.chapters });
    }),
  );

  router.post(
    "/:slug/chapters",
    asyncHandler(async (req, res) => {
      const result = await ProjectService.createChapter(req.params.slug as string);
      if (result === "project_not_found") {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Project not found." },
        });
        return;
      }
      if (!result) {
        res.status(500).json({
          error: { code: "INTERNAL_ERROR", message: "Failed to retrieve created chapter." },
        });
        return;
      }
      res.status(201).json(result);
    }),
  );

  router.put(
    "/:slug/chapters/order",
    asyncHandler(async (req, res) => {
      const result = await ProjectService.reorderChapters(req.params.slug as string, req.body);
      if (!result) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Project not found." },
        });
        return;
      }
      if ("validationError" in result) {
        res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: result.validationError },
        });
        return;
      }
      if ("mismatch" in result) {
        res.status(400).json({
          error: {
            code: "REORDER_MISMATCH",
            message: "Provided chapter IDs do not match existing chapters.",
          },
        });
        return;
      }
      res.json({ message: "Chapter order updated." });
    }),
  );

  router.get(
    "/:slug/dashboard",
    asyncHandler(async (req, res) => {
      const result = await ProjectService.getDashboard(req.params.slug as string);
      if (!result) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Project not found." },
        });
        return;
      }
      res.json(result);
    }),
  );

  router.get(
    "/:slug/trash",
    asyncHandler(async (req, res) => {
      const result = await ProjectService.getTrash(req.params.slug as string);
      if (result === null) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Project not found." },
        });
        return;
      }
      res.json(result);
    }),
  );

  router.delete(
    "/:slug",
    asyncHandler(async (req, res) => {
      const deleted = await ProjectService.deleteProject(req.params.slug as string);
      if (!deleted) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Project not found." },
        });
        return;
      }
      res.json({ message: "Project moved to trash." });
    }),
  );

  return router;
}
