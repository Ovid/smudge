import { Router } from "express";
import { asyncHandler } from "../app";
import * as ChapterService from "./chapters.service";

export function chaptersRouter(): Router {
  const router = Router();

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const result = await ChapterService.getChapter(req.params.id);
      if (result === null) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Chapter not found." },
        });
        return;
      }
      if (result === "corrupt") {
        res.status(500).json({
          error: {
            code: "CORRUPT_CONTENT",
            message: "Chapter content is corrupted and cannot be loaded.",
          },
        });
        return;
      }
      res.json(result);
    }),
  );

  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const result = await ChapterService.updateChapter(req.params.id, req.body);
      if (result === null) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Chapter not found." },
        });
        return;
      }
      if ("validationError" in result) {
        res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: result.validationError },
        });
        return;
      }
      if ("corrupt" in result) {
        res.status(500).json({
          error: {
            code: "CORRUPT_CONTENT",
            message: "Chapter content is corrupted and cannot be loaded.",
          },
        });
        return;
      }
      res.json(result.chapter);
    }),
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const deleted = await ChapterService.deleteChapter(req.params.id);
      if (!deleted) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Chapter not found." },
        });
        return;
      }
      res.json({ message: "Chapter moved to trash." });
    }),
  );

  router.post(
    "/:id/restore",
    asyncHandler(async (req, res) => {
      const result = await ChapterService.restoreChapter(req.params.id);
      if (result === null) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Deleted chapter not found." },
        });
        return;
      }
      if (result === "purged") {
        res.status(404).json({
          error: {
            code: "PROJECT_PURGED",
            message: "The parent project has been permanently deleted.",
          },
        });
        return;
      }
      if (result === "conflict") {
        res.status(409).json({
          error: {
            code: "RESTORE_CONFLICT",
            message: "Could not restore — slug conflict. Please try again.",
          },
        });
        return;
      }
      res.json(result);
    }),
  );

  return router;
}
