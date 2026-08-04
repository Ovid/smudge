import { Router } from "express";
import { asyncHandler } from "../asyncHandler";
import { CreateOuttakeSchema, UpdateOuttakeSchema, OUTTAKE_ERROR_CODES } from "@smudge/shared";
import type { ZodError } from "zod";
import { BadRequestError, NotFoundError } from "../errors/appError";
import { validateUuidParam } from "../validateUuidParam";
import * as OuttakeService from "./outtakes.service";

/**
 * Turn a schema failure into a 400 that names WHICH failure it was.
 *
 * S8 (agentic-review 2026-08-04): the label cap is not the only 400 these
 * endpoints emit — `validateUuidParam` throws one before the schema runs, and
 * `.strict()` is a second producer — but the client's `outtake.update` scope
 * mapped every 400 to label-length copy. Its consumer REVERTS the visible label
 * field on a definite failure, so a non-cap 400 made the writer's typed label
 * vanish under a cause that was not the cause. A discriminating `code` lets the
 * scope route by code instead of guessing from the status.
 *
 * Keyed on Zod's issue shape (`too_big` on the `label` path), not on the message
 * text, so rewording the schema message cannot silently unmap the code — and so
 * a non-string label (an `invalid_type` on the same path) does NOT get "too
 * long" copy.
 */
function badRequestFromSchema(error: ZodError): BadRequestError {
  const issue = error.issues[0];
  const labelTooLong = issue?.code === "too_big" && issue.path[0] === "label";
  return new BadRequestError(
    issue?.message ?? "Invalid request body.",
    labelTooLong ? OUTTAKE_ERROR_CODES.LABEL_TOO_LONG : undefined,
  );
}

export function projectOuttakesRouter(): Router {
  const router = Router();

  // POST /api/projects/:id/outtakes
  router.post(
    "/:id/outtakes",
    asyncHandler(async (req, res) => {
      const projectId = validateUuidParam(req, "project");
      const parsed = CreateOuttakeSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw badRequestFromSchema(parsed.error);
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
        throw badRequestFromSchema(parsed.error);
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
