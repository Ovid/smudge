import { Router } from "express";
import { asyncHandler } from "../asyncHandler";
import { CreateOuttakeSchema, UpdateOuttakeSchema, OUTTAKE_ERROR_CODES } from "@smudge/shared";
import { NotFoundError } from "../errors/appError";
import { validateUuidParam } from "../validateUuidParam";
import { badRequestFromSchema } from "../badRequestFromSchema";
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
        throw badRequestFromSchema(parsed.error.issues, OUTTAKE_ERROR_CODES.LABEL_TOO_LONG);
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
  //
  // S3 (agentic-review 2026-08-04): full rows, no projection, no limit, no
  // per-project cap — unlike `snapshots.repository.listByChapter`, which
  // projects `content` away. Deliberate and recorded (design §5, "Single-user
  // assumption"): the panel filters, previews, word-counts and inserts from the
  // loaded list with no second fetch, so eliding content would cost a round
  // trip per card. The failure mode to watch is not payload size but that this
  // drawer carries every row's ONLY delete button — an unloadable list is an
  // undeletable one. Revisit if a real project's drawer stops loading.
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
        throw badRequestFromSchema(parsed.error.issues, OUTTAKE_ERROR_CODES.LABEL_TOO_LONG);
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
