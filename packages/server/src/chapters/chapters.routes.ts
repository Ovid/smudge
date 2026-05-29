import { Router } from "express";
import { asyncHandler } from "../asyncHandler";
import * as ChapterService from "./chapters.service";
import { BadRequestError, ConflictError, InternalError, NotFoundError } from "../errors/appError";

export function chaptersRouter(): Router {
  const router = Router();

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const id = req.params.id as string;
      const result = await ChapterService.getChapter(id);
      if (result === null) {
        throw new NotFoundError("Chapter not found.");
      }
      if (result === "corrupt") {
        throw new InternalError(
          "Chapter content is corrupted and cannot be loaded.",
          "CORRUPT_CONTENT",
        );
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
        throw new NotFoundError("Chapter not found.");
      }
      if (result === "read_after_update_failure") {
        throw new InternalError(
          "Chapter was updated but could not be re-read.",
          "UPDATE_READ_FAILURE",
        );
      }
      if ("validationError" in result) {
        throw new BadRequestError(result.validationError);
      }
      if ("corrupt" in result) {
        throw new InternalError(
          "Chapter content is corrupted and cannot be loaded.",
          "CORRUPT_CONTENT",
        );
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
        throw new NotFoundError("Chapter not found.");
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
        throw new NotFoundError("Deleted chapter not found.");
      }
      if (result === "parent_purged") {
        throw new NotFoundError(
          "The parent project has been permanently deleted.",
          "PROJECT_PURGED",
        );
      }
      if (result === "chapter_purged") {
        throw new NotFoundError("This chapter has been permanently deleted.", "CHAPTER_PURGED");
      }
      if (result === "conflict") {
        throw new ConflictError(
          "Could not restore — slug conflict. Please try again.",
          "RESTORE_CONFLICT",
        );
      }
      if (result === "read_failure") {
        throw new InternalError(
          "Chapter was restored but could not be re-read.",
          "RESTORE_READ_FAILURE",
        );
      }
      res.json(result);
    }),
  );

  return router;
}
