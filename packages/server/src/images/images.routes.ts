import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { asyncHandler } from "../asyncHandler";
import {
  AppError,
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
  PayloadTooLargeError,
} from "../errors/appError";
import * as imagesService from "./images.service";
import { UUID_PATTERN } from "./images.paths";
import { MAX_IMAGE_UPLOAD_BYTES, MAX_IMAGE_UPLOAD_LABEL } from "@smudge/shared";

// F-38: cap every dimension of the multipart body, not just file size. The
// express.json body cap does not reach this endpoint — it is not JSON — so
// without these the parser accepts unlimited parts and fields and buffers every
// non-file part in memory. The client posts exactly one part (a file named
// "file", no other fields), so these describe what the endpoint actually
// accepts. Adding a form field later means raising `fields` deliberately, and
// the loud 413 that forces it is the point.
//
// `parts` is deliberately NOT set. A multipart body contains only files and
// fields, so `files` + `fields` already bound the part count; and busboy's
// `parts` counter is off by one against the obvious reading — verified by
// execution, `parts: 1` rejects a single file part with LIMIT_PART_COUNT.
// Setting it would be a redundant knob whose correct value is not the one a
// reader would guess.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_UPLOAD_BYTES, // streaming rejection at the shared cap
    files: 1,
    fields: 0,
  },
});

/**
 * Translate a multipart-parser failure into the error taxonomy.
 *
 * Every error that reaches multer's callback is the client's fault, so this
 * asks that question rather than matching a code prefix. Keying on `LIMIT_`
 * classified only the cap breaches and let two other client-error shapes fall
 * through to globalErrorHandler unstatused, where they were clamped to 500 and
 * written into the anomaly log as a server fault — the exact class the mapping
 * exists to close (I1, code review 2026-08-22). The two that escaped:
 *
 *  - `MISSING_FIELD_NAME`, the one code in multer's own taxonomy that does not
 *    begin `LIMIT_`. busboy emits a `file` event with an undefined fieldname
 *    for a part whose `Content-Disposition` carries `filename` but no `name`.
 *  - busboy's constructor rejections, which carry no `code` at all — a
 *    `Content-Type` with no `boundary`, an empty `boundary`, or a multipart
 *    subtype it does not support. multer hands those over as a bare `Error`.
 *
 * Size and count breaches are both 413 but take DIFFERENT codes. The client
 * chooses its 413 copy by `error.code` (CLAUDE.md §Save-pipeline invariant 5),
 * and "shrink the file" is wrong advice for a request whose byte count was
 * never the problem (S2, same review).
 */
function uploadRequestError(err: unknown): AppError {
  const code = (err as { code?: unknown } | null)?.code;

  if (code === "LIMIT_FILE_SIZE") {
    return new PayloadTooLargeError(`File too large. Maximum: ${MAX_IMAGE_UPLOAD_LABEL}.`);
  }
  // A wrong or repeated file field is a malformed request, not an oversized
  // one — it says nothing about how many bytes arrived.
  if (code === "LIMIT_UNEXPECTED_FILE") {
    return new BadRequestError("Unexpected file field in upload.");
  }
  if (typeof code === "string" && code.startsWith("LIMIT_")) {
    return new PayloadTooLargeError(
      "Upload has too many parts or fields.",
      "UPLOAD_TOO_MANY_PARTS",
    );
  }
  return new BadRequestError("Malformed file upload.", "MALFORMED_UPLOAD");
}

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
        // Async multer callback — forward via next() rather than throw
        // (a throw here would not be caught by Express).
        if (err) return next(uploadRequestError(err));
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

      // S2: the write committed but the read-after-write came back empty.
      // Distinct from 404 so the client's committed-UX path can fire — a 404
      // would say "this image does not exist" about a row that was updated.
      if ("readFailure" in result && result.readFailure) {
        throw new InternalError(
          "Image was updated but could not be re-read.",
          "UPDATE_READ_FAILURE",
        );
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
