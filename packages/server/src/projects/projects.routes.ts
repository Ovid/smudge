import { Router } from "express";
import { asyncHandler } from "../asyncHandler";
import * as ProjectService from "./projects.service";
import { velocityHandler } from "../velocity/velocity.routes";
import { BadRequestError, InternalError, NotFoundError } from "../errors/appError";

export function projectsRouter(): Router {
  const router = Router();

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      // ProjectTitleExistsError is an AppError; it propagates to the
      // global handler (400 PROJECT_TITLE_EXISTS) without a local catch.
      const result = await ProjectService.createProject(req.body);
      if ("validationError" in result) {
        throw new BadRequestError(result.validationError ?? "Invalid input");
      }
      res.status(201).json(result.project);
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
      const result = await ProjectService.updateProject(req.params.slug as string, req.body);
      if (!result) {
        throw new NotFoundError("Project not found.");
      }
      if ("validationError" in result) {
        throw new BadRequestError(result.validationError ?? "Invalid input");
      }
      res.json(result.project);
    }),
  );

  router.get("/:slug/velocity", velocityHandler);

  router.get(
    "/:slug",
    asyncHandler(async (req, res) => {
      const result = await ProjectService.getProject(req.params.slug as string);
      if (!result) {
        throw new NotFoundError("Project not found.");
      }
      res.json({ ...result.project, chapters: result.chapters });
    }),
  );

  router.post(
    "/:slug/chapters",
    asyncHandler(async (req, res) => {
      const result = await ProjectService.createChapter(req.params.slug as string);
      if (result === "project_not_found") {
        throw new NotFoundError("Project not found.");
      }
      if (result === "read_after_create_failure") {
        throw new InternalError(
          "Chapter was created but could not be retrieved. Do not retry.",
          "READ_AFTER_CREATE_FAILURE",
        );
      }
      res.status(201).json(result);
    }),
  );

  router.put(
    "/:slug/chapters/order",
    asyncHandler(async (req, res) => {
      const result = await ProjectService.reorderChapters(req.params.slug as string, req.body);
      if (!result) {
        throw new NotFoundError("Project not found.");
      }
      if ("validationError" in result) {
        throw new BadRequestError(result.validationError ?? "Invalid input");
      }
      if ("mismatch" in result) {
        throw new BadRequestError(
          "Provided chapter IDs do not match existing chapters.",
          "REORDER_MISMATCH",
        );
      }
      res.json({ message: "Chapter order updated." });
    }),
  );

  router.get(
    "/:slug/dashboard",
    asyncHandler(async (req, res) => {
      const result = await ProjectService.getDashboard(req.params.slug as string);
      if (!result) {
        throw new NotFoundError("Project not found.");
      }
      res.json(result);
    }),
  );

  router.get(
    "/:slug/trash",
    asyncHandler(async (req, res) => {
      const result = await ProjectService.getTrash(req.params.slug as string);
      if (result === null) {
        throw new NotFoundError("Project not found.");
      }
      res.json(result);
    }),
  );

  router.delete(
    "/:slug",
    asyncHandler(async (req, res) => {
      const deleted = await ProjectService.deleteProject(req.params.slug as string);
      if (!deleted) {
        throw new NotFoundError("Project not found.");
      }
      // F-16: uniform DELETE success contract — 204 No Content, no body.
      // The client owns the success toast string (strings.ts), not the server.
      res.status(204).send();
    }),
  );

  return router;
}
