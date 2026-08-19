import { Router } from "express";
import { asyncHandler } from "../asyncHandler";
import { CreateSnapshotSchema, SNAPSHOT_ERROR_CODES } from "@smudge/shared";
import { BadRequestError, ConflictError, NotFoundError } from "../errors/appError";
import { validateUuidParam } from "../validateUuidParam";
import { badRequestFromSchema } from "../badRequestFromSchema";
import * as SnapshotService from "./snapshots.service";

export function snapshotChapterRouter(): Router {
  const router = Router();

  // POST /api/chapters/:id/snapshots
  router.post(
    "/:id/snapshots",
    asyncHandler(async (req, res) => {
      const id = validateUuidParam(req, "chapter");
      const parsed = CreateSnapshotSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw badRequestFromSchema(parsed.error.issues, SNAPSHOT_ERROR_CODES.LABEL_TOO_LONG);
      }
      const label = parsed.data.label;

      const result = await SnapshotService.createSnapshot(id, label);
      if (result === null) {
        throw new NotFoundError("Chapter not found.");
      }
      if (result === "duplicate") {
        // F-34/F-26 note: 200-with-a-discriminator, and NO user-facing copy.
        // The steering file's rule for the sibling success contracts is "the
        // client owns the toast, the server ships no success copy"; this
        // endpoint used to ship an English `message` the client already
        // ignored in favour of STRINGS.snapshots.duplicateSkipped. The two
        // status codes stay: 201 says a row was created, 200 says nothing was,
        // and collapsing them would either claim a creation that did not
        // happen or turn a benign no-op into an error.
        res.status(200).json({ status: "duplicate" });
        return;
      }
      res.status(201).json({ status: "created", snapshot: result });
    }),
  );

  // GET /api/chapters/:id/snapshots
  router.get(
    "/:id/snapshots",
    asyncHandler(async (req, res) => {
      const id = validateUuidParam(req, "chapter");
      const result = await SnapshotService.listSnapshots(id);
      if (result === null) {
        throw new NotFoundError("Chapter not found.");
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
      const id = validateUuidParam(req, "snapshot");
      const snapshot = await SnapshotService.getSnapshot(id);
      if (!snapshot) {
        throw new NotFoundError("Snapshot not found.");
      }
      res.json(snapshot);
    }),
  );

  // DELETE /api/snapshots/:id
  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const id = validateUuidParam(req, "snapshot");
      const deleted = await SnapshotService.deleteSnapshot(id);
      if (!deleted) {
        throw new NotFoundError("Snapshot not found.");
      }
      res.status(204).send();
    }),
  );

  // POST /api/snapshots/:id/restore
  router.post(
    "/:id/restore",
    asyncHandler(async (req, res) => {
      const id = validateUuidParam(req, "snapshot");
      const result = await SnapshotService.restoreSnapshot(id);
      if (result === null) {
        throw new NotFoundError("Snapshot or chapter not found.");
      }
      if (result === "corrupt_snapshot") {
        // Malformed content is a 400 validation failure (the snapshot row
        // itself is invalid, independent of any other resource state).
        // Client distinguishes via code === "CORRUPT_SNAPSHOT".
        throw new BadRequestError(
          "Snapshot content is corrupt and cannot be restored.",
          SNAPSHOT_ERROR_CODES.CORRUPT_SNAPSHOT,
        );
      }
      if (result === "cross_project_image") {
        // 409 per CLAUDE.md: request is well-formed but violates a
        // constraint the client needs to resolve (move/re-upload the
        // image, or pick a different snapshot). Not a validation error.
        //
        // F-05: this arm no longer covers a MISSING image — that restores
        // with the dead node dropped (dropped_image_count below). The two
        // used to share this refusal, which made the message false for the
        // far more common case and left the snapshot permanently unrestorable.
        throw new ConflictError(
          "Snapshot references an image from a different project and cannot be restored.",
          SNAPSHOT_ERROR_CODES.CROSS_PROJECT_IMAGE_REF,
        );
      }
      // Spread rather than nest so the response stays assignable to Chapter —
      // an added optional field is backward-compatible where a re-shaped body
      // would not be. Omitted entirely on the ordinary path so the field's
      // presence means "content was altered", mirroring the outtakes
      // `content_corrupt` degraded-read flag (CLAUDE.md §Data Model).
      res.json(
        result.dropped_image_count > 0
          ? { ...result.chapter, dropped_image_count: result.dropped_image_count }
          : result.chapter,
      );
    }),
  );

  return router;
}
