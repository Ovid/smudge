import { Router } from "express";
import { asyncHandler } from "../app";
import { CreateSnapshotSchema } from "@smudge/shared";
import * as SnapshotService from "./snapshots.service";

export function snapshotChapterRouter(): Router {
  const router = Router();

  // POST /api/chapters/:id/snapshots
  router.post(
    "/:id/snapshots",
    asyncHandler(async (req, res) => {
      const parsed = CreateSnapshotSchema.safeParse(req.body);
      const label = parsed.success ? parsed.data.label : undefined;

      const result = await SnapshotService.createSnapshot(req.params.id, label);
      if (result === null) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Chapter not found." },
        });
        return;
      }
      if (result === "duplicate") {
        res.status(200).json({
          message: "Snapshot skipped — content unchanged since last snapshot.",
        });
        return;
      }
      res.status(201).json(result);
    }),
  );

  // GET /api/chapters/:id/snapshots
  router.get(
    "/:id/snapshots",
    asyncHandler(async (req, res) => {
      const result = await SnapshotService.listSnapshots(req.params.id);
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
      const snapshot = await SnapshotService.getSnapshot(req.params.id);
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
      const deleted = await SnapshotService.deleteSnapshot(req.params.id);
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
      const result = await SnapshotService.restoreSnapshot(req.params.id);
      if (!result) {
        res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Snapshot or chapter not found.",
          },
        });
        return;
      }
      res.json(result.chapter);
    }),
  );

  return router;
}
