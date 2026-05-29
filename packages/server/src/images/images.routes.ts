import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { asyncHandler } from "../asyncHandler";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  PayloadTooLargeError,
} from "../errors/appError";
import * as imagesService from "./images.service";
import { UUID_PATTERN } from "./images.paths";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB streaming rejection
});

const UUID_RE = new RegExp(`^${UUID_PATTERN}$`, "i");

function requireUuidParam(paramName: string) {
  // Sync middleware: a thrown error is caught by Express and routed to
  // the global error handler, which renders the AppError envelope.
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!UUID_RE.test(req.params[paramName] as string)) {
      throw new BadRequestError(`Invalid ${paramName} format.`);
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
          // Async multer callback — forward via next() rather than throw
          // (a throw here would not be caught by Express).
          return next(new PayloadTooLargeError("File too large. Maximum: 10MB."));
        }
        if (err) return next(err);
        next();
      });
    },
    asyncHandler(async (req, res) => {
      if (!req.file) {
        throw new BadRequestError("No file provided.");
      }

      const result = await imagesService.uploadImage(req.params.projectId as string, {
        buffer: req.file.buffer,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
      });

      if ("notFound" in result && result.notFound) {
        throw new NotFoundError("Project not found.");
      }

      if ("validationError" in result && result.validationError) {
        throw new BadRequestError(result.validationError);
      }

      res.status(201).json(result.image);
    }),
  );

  router.get(
    "/:projectId/images",
    asyncHandler(async (req, res) => {
      const images = await imagesService.listImages(req.params.projectId as string);
      if (images === null) {
        throw new NotFoundError("Project not found.");
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
        throw new NotFoundError("Image not found.");
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
        throw new NotFoundError("Image not found.");
      }

      res.json({ chapters: result.chapters });
    }),
  );

  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const result = await imagesService.updateImageMetadata(req.params.id as string, req.body);

      if ("notFound" in result && result.notFound) {
        throw new NotFoundError("Image not found.");
      }

      if ("validationError" in result && result.validationError) {
        throw new BadRequestError(result.validationError);
      }

      res.json(result.image);
    }),
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const result = await imagesService.deleteImage(req.params.id as string);

      if ("notFound" in result && result.notFound) {
        throw new NotFoundError("Image not found.");
      }

      if ("referenced" in result && result.referenced) {
        throw new ConflictError("Image is referenced by one or more chapters.", "IMAGE_IN_USE", {
          chapters: result.referenced,
        });
      }

      // F-16: uniform DELETE success contract — 204 No Content, no body.
      // The client owns the success toast string (strings.ts), not the server.
      res.status(204).send();
    }),
  );

  return router;
}
