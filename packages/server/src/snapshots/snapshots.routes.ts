import { Router } from "express";
import { asyncHandler } from "../asyncHandler";
import { CreateSnapshotSchema, SNAPSHOT_ERROR_CODES } from "@smudge/shared";
import { BadRequestError, ConflictError, NotFoundError } from "../errors/appError";
import { validateUuidParam } from "../validateUuidParam";
import * as SnapshotService from "./snapshots.service";

/**
 * Turn a schema failure into a 400 that names WHICH failure it was.
 *
 * F-34 (architecture report 2026-08-11): mirrors `badRequestFromSchema` in
 * `outtakes.routes.ts`, deliberately including its keying discipline — on Zod's
 * issue shape (`too_big` on the `label` path) rather than on message text, so
 * rewording the schema message cannot silently unmap the code, and a non-string
 * label (an `invalid_type` on the same path) does NOT get "too long" copy.
 *
 * This IS a near-duplicate of the outtake version — the two differ only in the
 * constant they emit, and a shared helper taking that constant as a parameter
 * would collapse them. It is left duplicated because unifying them means
 * editing `outtakes.routes.ts`, a module F-34 does not touch: this change is a
 * fix, and that would make it a cross-module refactor as well. Recorded here
 * rather than defended, so the next person to add a third one extracts instead
 * of copying a second time.
 */
function badRequestFromSchema(
  // Structural, not `ZodError<T>`: the generic is invariant, so a shared helper
  // cannot take errors from two different schemas through one annotation.
  issues: ReadonlyArray<{ code: string; path: PropertyKey[]; message: string }>,
): BadRequestError {
  const issue = issues[0];
  const labelTooLong = issue?.code === "too_big" && issue.path[0] === "label";
  return new BadRequestError(
    issue?.message ?? "Invalid request body.",
    labelTooLong ? SNAPSHOT_ERROR_CODES.LABEL_TOO_LONG : undefined,
  );
}

export function snapshotChapterRouter(): Router {
  const router = Router();

  // POST /api/chapters/:id/snapshots
  router.post(
    "/:id/snapshots",
    asyncHandler(async (req, res) => {
      const id = validateUuidParam(req, "chapter");
      const parsed = CreateSnapshotSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw badRequestFromSchema(parsed.error.issues);
      }
      const label = parsed.data.label;

      const result = await SnapshotService.createSnapshot(id, label);
      if (result === null) {
        throw new NotFoundError("Chapter not found.");
      }
      if (result === "duplicate") {
        res.status(200).json({
          status: "duplicate",
          message: "Snapshot skipped — content unchanged since last snapshot.",
        });
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
