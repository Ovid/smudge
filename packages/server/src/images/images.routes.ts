import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { asyncHandler } from "../app";
import * as imagesService from "./images.service";
import { UUID_PATTERN } from "./images.paths";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB streaming rejection
});

const UUID_RE = new RegExp(`^${UUID_PATTERN}$`, "i");

function requireUuidParam(paramName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!UUID_RE.test(req.params[paramName] as string)) {
      res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: `Invalid ${paramName} format.` },
      });
      return;
    }
    next();
  };
}

/**
 * Mounted at /api/projects — project-scoped image endpoints.
 */
export function imagesRouter(): Router {
  const router = Router();

  router.use("/:projectId/images", requireUuidParam("projectId"));

  router.post(
    "/:projectId/images",
    (req, res, next) => {
      upload.single("file")(req, res, (err: unknown) => {
        if (err && (err as Error & { code?: string }).code === "LIMIT_FILE_SIZE") {
          res.status(413).json({
            error: { code: "PAYLOAD_TOO_LARGE", message: "File too large. Maximum: 10MB." },
          });
          return;
        }
        if (err) return next(err);
        next();
      });
    },
    asyncHandler(async (req, res) => {
      if (!req.file) {
        res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: "No file provided." },
        });
        return;
      }

      const result = await imagesService.uploadImage(req.params.projectId as string, {
        buffer: req.file.buffer,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
      });

      if ("notFound" in result && result.notFound) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Project not found." },
        });
        return;
      }

      if ("validationError" in result && result.validationError) {
        res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: result.validationError },
        });
        return;
      }

      res.status(201).json(result.image);
    }),
  );

  router.get(
    "/:projectId/images",
    asyncHandler(async (req, res) => {
      const images = await imagesService.listImages(req.params.projectId as string);
      if (images === null) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Project not found." },
        });
        return;
      }
      res.json(images);
    }),
  );

  return router;
}

/**
 * Mounted at /api/images — direct image endpoints.
 */
export function imagesDirectRouter(): Router {
  const router = Router();

  router.use("/:id", requireUuidParam("id"));

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const result = await imagesService.serveImage(req.params.id as string);
      if (!result) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Image not found." },
        });
        return;
      }

      res.set("Content-Type", result.mimeType);
      res.set("X-Content-Type-Options", "nosniff");
      res.set("Cache-Control", "public, max-age=31536000, immutable");
      res.send(result.data);
    }),
  );

  router.get(
    "/:id/references",
    asyncHandler(async (req, res) => {
      const result = await imagesService.getImageReferences(req.params.id as string);
      if ("notFound" in result && result.notFound) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Image not found." },
        });
        return;
      }

      res.json({ chapters: result.chapters });
    }),
  );

  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const result = await imagesService.updateImageMetadata(req.params.id as string, req.body);

      if ("notFound" in result && result.notFound) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Image not found." },
        });
        return;
      }

      if ("validationError" in result && result.validationError) {
        res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: result.validationError },
        });
        return;
      }

      res.json(result.image);
    }),
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const result = await imagesService.deleteImage(req.params.id as string);

      if ("notFound" in result && result.notFound) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Image not found." },
        });
        return;
      }

      if ("referenced" in result && result.referenced) {
        res.status(409).json({
          error: {
            code: "IMAGE_IN_USE",
            message: "Image is referenced by one or more chapters.",
            chapters: result.referenced,
          },
        });
        return;
      }

      res.json({ deleted: true });
    }),
  );

  return router;
}
