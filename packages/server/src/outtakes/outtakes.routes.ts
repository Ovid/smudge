import { Router } from "express";
import { asyncHandler } from "../asyncHandler";
import { CreateOuttakeSchema, UpdateOuttakeSchema } from "@smudge/shared";
import { BadRequestError, NotFoundError } from "../errors/appError";
import { validateUuidParam } from "../validateUuidParam";
import * as OuttakeService from "./outtakes.service";

export function projectOuttakesRouter(): Router {
  const router = Router();

  // POST /api/projects/:id/outtakes
  router.post(
    "/:id/outtakes",
    asyncHandler(async (req, res) => {
      const projectId = validateUuidParam(req, "project");
      const parsed = CreateOuttakeSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new BadRequestError(parsed.error.issues[0]?.message ?? "Invalid request body.");
      }
      const outtake = await OuttakeService.createOuttake(
        projectId,
        parsed.data.content,
        parsed.data.label ?? null,
      );
      if (outtake === null) {
        throw new NotFoundError("Project not found.");
      }
      res.status(201).json(outtake);
    }),
  );

  // GET /api/projects/:id/outtakes
  router.get(
    "/:id/outtakes",
    asyncHandler(async (req, res) => {
      const projectId = validateUuidParam(req, "project");
      const list = await OuttakeService.listOuttakes(projectId);
      if (list === null) {
        throw new NotFoundError("Project not found.");
      }
      res.json(list);
    }),
  );

  return router;
}

export function outtakeDirectRouter(): Router {
  const router = Router();

  // PATCH /api/outtakes/:id
  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const id = validateUuidParam(req, "outtake");
      const parsed = UpdateOuttakeSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new BadRequestError(parsed.error.issues[0]?.message ?? "Invalid request body.");
      }
      const outtake = await OuttakeService.updateOuttakeLabel(id, parsed.data.label);
      if (outtake === null) {
        throw new NotFoundError("Outtake not found.");
      }
      res.json(outtake);
    }),
  );

  // DELETE /api/outtakes/:id
  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const id = validateUuidParam(req, "outtake");
      const deleted = await OuttakeService.deleteOuttake(id);
      if (!deleted) {
        throw new NotFoundError("Outtake not found.");
      }
      res.status(204).send();
    }),
  );

  return router;
}
