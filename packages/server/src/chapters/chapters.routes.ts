import { Router } from "express";
import { asyncHandler } from "../app";
import * as ChapterService from "./chapters.service";

export function chaptersRouter(): Router {
  const router = Router();

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const id = req.params.id as string;
      const result = await ChapterService.getChapter(id);
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
      const id = req.params.id as string;
      const result = await ChapterService.updateChapter(id, req.body);
      if (result === null) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Chapter not found." },
        });
        return;
      }
      if (result === "read_after_update_failure") {
        res.status(500).json({
          error: {
            code: "UPDATE_READ_FAILURE",
            message: "Chapter was updated but could not be re-read.",
          },
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
      const id = req.params.id as string;
      const deleted = await ChapterService.deleteChapter(id);
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
      const id = req.params.id as string;
      const result = await ChapterService.restoreChapter(id);
      if (result === null) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Deleted chapter not found." },
        });
        return;
      }
      if (result === "parent_purged") {
        res.status(404).json({
          error: {
            code: "PROJECT_PURGED",
            message: "The parent project has been permanently deleted.",
          },
        });
        return;
      }
      if (result === "chapter_purged") {
        res.status(404).json({
          error: {
            code: "CHAPTER_PURGED",
            message: "This chapter has been permanently deleted.",
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
      if (result === "read_failure") {
        res.status(500).json({
          error: {
            code: "RESTORE_READ_FAILURE",
            message: "Chapter was restored but could not be re-read.",
          },
        });
        return;
      }
      res.json(result);
    }),
  );

  return router;
}
