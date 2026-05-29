import { Router, type Request } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler";
import { CreateSnapshotSchema, SNAPSHOT_ERROR_CODES } from "@smudge/shared";
import { BadRequestError, ConflictError, NotFoundError } from "../errors/appError";
import * as SnapshotService from "./snapshots.service";

const UuidSchema = z.string().uuid();

/** Returns the validated UUID param, or throws a 400 BadRequestError. */
function validateUuidParam(req: Request, label?: "chapter" | "snapshot"): string {
  const parsed = UuidSchema.safeParse(req.params.id);
  if (!parsed.success) {
    throw new BadRequestError(label ? `Invalid ${label} id.` : "Invalid id.");
  }
  return parsed.data;
}

export function snapshotChapterRouter(): Router {
  const router = Router();

  // POST /api/chapters/:id/snapshots
  router.post(
    "/:id/snapshots",
    asyncHandler(async (req, res) => {
      const id = validateUuidParam(req, "chapter");
      const parsed = CreateSnapshotSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new BadRequestError(parsed.error.issues[0]?.message ?? "Invalid request body.");
      }
      const label = parsed.data.label;

      const result = await SnapshotService.createSnapshot(id, label);
      if (result === null) {
        throw new NotFoundError("Chapter not found.");
      }
      if (result === "duplicate") {
        res.status(200).json({
          status: "duplicate",
          message: "Snapshot skipped — content unchanged since last snapshot.",
        });
        return;
      }
      res.status(201).json({ status: "created", snapshot: result });
    }),
  );

  // GET /api/chapters/:id/snapshots
  router.get(
    "/:id/snapshots",
    asyncHandler(async (req, res) => {
      const id = validateUuidParam(req, "chapter");
      const result = await SnapshotService.listSnapshots(id);
      if (result === null) {
        throw new NotFoundError("Chapter not found.");
      }
      res.json(result);
    }),
  );

  return router;
}

export function snapshotDirectRouter(): Router {
  const router = Router();

  // GET /api/snapshots/:id
  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const id = validateUuidParam(req, "snapshot");
      const snapshot = await SnapshotService.getSnapshot(id);
      if (!snapshot) {
        throw new NotFoundError("Snapshot not found.");
      }
      res.json(snapshot);
    }),
  );

  // DELETE /api/snapshots/:id
  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const id = validateUuidParam(req, "snapshot");
      const deleted = await SnapshotService.deleteSnapshot(id);
      if (!deleted) {
        throw new NotFoundError("Snapshot not found.");
      }
      res.status(204).send();
    }),
  );

  // POST /api/snapshots/:id/restore
  router.post(
    "/:id/restore",
    asyncHandler(async (req, res) => {
      const id = validateUuidParam(req, "snapshot");
      const result = await SnapshotService.restoreSnapshot(id);
      if (result === null) {
        throw new NotFoundError("Snapshot or chapter not found.");
      }
      if (result === "corrupt_snapshot") {
        // Malformed content is a 400 validation failure (the snapshot row
        // itself is invalid, independent of any other resource state).
        // Client distinguishes via code === "CORRUPT_SNAPSHOT".
        throw new BadRequestError(
          "Snapshot content is corrupt and cannot be restored.",
          SNAPSHOT_ERROR_CODES.CORRUPT_SNAPSHOT,
        );
      }
      if (result === "cross_project_image") {
        // 409 per CLAUDE.md: request is well-formed but violates a
        // constraint the client needs to resolve (move/re-upload the
        // image, or pick a different snapshot). Not a validation error.
        throw new ConflictError(
          "Snapshot references an image from a different project and cannot be restored.",
          SNAPSHOT_ERROR_CODES.CROSS_PROJECT_IMAGE_REF,
        );
      }
      res.json(result.chapter);
    }),
  );

  return router;
}
