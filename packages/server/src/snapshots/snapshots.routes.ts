import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../app";
import { CreateSnapshotSchema, SNAPSHOT_ERROR_CODES } from "@smudge/shared";
import * as SnapshotService from "./snapshots.service";

const UuidSchema = z.string().uuid();

function validateUuidParam(
  req: Request,
  res: Response,
  label?: "chapter" | "snapshot",
): string | null {
  const parsed = UuidSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: label ? `Invalid ${label} id.` : "Invalid id.",
      },
    });
    return null;
  }
  return parsed.data;
}

export function snapshotChapterRouter(): Router {
  const router = Router();

  // POST /api/chapters/:id/snapshots
  router.post(
    "/:id/snapshots",
    asyncHandler(async (req, res) => {
      const id = validateUuidParam(req, res, "chapter");
      if (!id) return;
      const parsed = CreateSnapshotSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0]?.message ?? "Invalid request body.",
          },
        });
        return;
      }
      const label = parsed.data.label;

      const result = await SnapshotService.createSnapshot(id, label);
      if (result === null) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Chapter not found." },
        });
        return;
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
      const id = validateUuidParam(req, res, "chapter");
      if (!id) return;
      const result = await SnapshotService.listSnapshots(id);
      if (result === null) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Chapter not found." },
        });
        return;
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
      const id = validateUuidParam(req, res, "snapshot");
      if (!id) return;
      const snapshot = await SnapshotService.getSnapshot(id);
      if (!snapshot) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Snapshot not found." },
        });
        return;
      }
      res.json(snapshot);
    }),
  );

  // DELETE /api/snapshots/:id
  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const id = validateUuidParam(req, res, "snapshot");
      if (!id) return;
      const deleted = await SnapshotService.deleteSnapshot(id);
      if (!deleted) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Snapshot not found." },
        });
        return;
      }
      res.status(204).send();
    }),
  );

  // POST /api/snapshots/:id/restore
  router.post(
    "/:id/restore",
    asyncHandler(async (req, res) => {
      const id = validateUuidParam(req, res, "snapshot");
      if (!id) return;
      const result = await SnapshotService.restoreSnapshot(id);
      if (result === null) {
        res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Snapshot or chapter not found.",
          },
        });
        return;
      }
      if (result === "corrupt_snapshot") {
        // CLAUDE.md restricts status codes to 200/201/400/404/500; treat
        // corrupt content as a 400 validation error. Client distinguishes
        // via code === "CORRUPT_SNAPSHOT".
        res.status(400).json({
          error: {
            code: SNAPSHOT_ERROR_CODES.CORRUPT_SNAPSHOT,
            message: "Snapshot content is corrupt and cannot be restored.",
          },
        });
        return;
      }
      if (result === "cross_project_image") {
        res.status(400).json({
          error: {
            code: SNAPSHOT_ERROR_CODES.CROSS_PROJECT_IMAGE_REF,
            message:
              "Snapshot references an image from a different project and cannot be restored.",
          },
        });
        return;
      }
      res.json(result.chapter);
    }),
  );

  return router;
}
