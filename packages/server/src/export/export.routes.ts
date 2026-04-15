import { Router } from "express";
import { asyncHandler } from "../app";
import * as ExportService from "./export.service";

export function exportRouter(): Router {
  const router = Router();

  router.post(
    "/:slug/export",
    asyncHandler(async (req, res) => {
      const result = await ExportService.exportProject(req.params.slug as string, req.body);

      if ("validationError" in result) {
        res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: result.validationError },
        });
        return;
      }
      if ("notFound" in result) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Project not found." },
        });
        return;
      }
      if ("invalidChapterIds" in result) {
        res.status(400).json({
          error: {
            code: "EXPORT_INVALID_CHAPTERS",
            message: "One or more chapter IDs do not belong to this project.",
          },
        });
        return;
      }

      const { content, contentType, filename } = result.result;
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(content);
    }),
  );

  return router;
}
