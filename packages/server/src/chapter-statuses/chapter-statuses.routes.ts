import { Router } from "express";
import { asyncHandler } from "../app";
import * as ChapterStatusService from "./chapter-statuses.service";

export function chapterStatusesRouter(): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const statuses = await ChapterStatusService.listStatuses();
      res.json(statuses);
    }),
  );

  return router;
}
