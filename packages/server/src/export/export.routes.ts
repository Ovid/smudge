import { Router } from "express";
import { asyncHandler } from "../asyncHandler";
import { BadRequestError, NotFoundError } from "../errors/appError";
import * as ExportService from "./export.service";

export function exportRouter(): Router {
  const router = Router();

  router.post(
    "/:slug/export",
    asyncHandler(async (req, res) => {
      const result = await ExportService.exportProject(req.params.slug as string, req.body);

      if ("validationError" in result) {
        throw new BadRequestError(result.validationError);
      }
      if ("notFound" in result) {
        throw new NotFoundError("Project not found.");
      }
      if ("invalidChapterIds" in result) {
        throw new BadRequestError(
          "One or more chapter IDs do not belong to this project.",
          "EXPORT_INVALID_CHAPTERS",
        );
      }

      const { content, contentType, filename } = result.result;
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(content);
    }),
  );

  return router;
}
