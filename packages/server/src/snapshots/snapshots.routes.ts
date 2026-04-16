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
      const id = req.params.id as string;
      const parsed = CreateSnapshotSchema.safeParse(req.body);
      const label = parsed.success ? parsed.data.label : undefined;

      const result = await SnapshotService.createSnapshot(id, label);
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
      const id = req.params.id as string;
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
      const id = req.params.id as string;
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
      const id = req.params.id as string;
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
      const id = req.params.id as string;
      const result = await SnapshotService.restoreSnapshot(id);
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
