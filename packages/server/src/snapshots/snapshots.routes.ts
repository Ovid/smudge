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
        // ignored in favour of STRINGS.snapshots.duplicateSkipped.
        //
        // THE TWO SHAPES ARE DELIBERATE. This is the only endpoint in Smudge
        // whose success response is a union the client must branch on, so it
        // looks like the classic "caller forgets to check and reads undefined"
        // hazard. It is not, and the reason is worth stating because it is not
        // a property of the design — it is a property of who consumes it:
        //
        //   type CreateResult =
        //     | { status: "created"; snapshot: SnapshotRow }
        //     | { status: "duplicate" };
        //
        // `result.snapshot` without narrowing is a COMPILE error (TS2339 —
        // verified, not assumed). To touch `snapshot` at all you must first
        // write `if (result.status === "created")`, which forces the author to
        // say what the other case is. The superficially safer uniform shape
        // (`{ status: string; snapshot?: SnapshotRow }`) is weaker here: its
        // check can be silenced with `snapshot!` by someone who never decided
        // what "duplicate" means.
        //
        // WHERE THAT ENDS: the guarantee is the type, so it covers TypeScript
        // callers that see it. A non-TS consumer — raw-JSON e2e assertions,
        // curl, a future non-TS client — gets none of it, and for them the
        // discriminator is only a convention someone has to know. Today there
        // is exactly one caller (api/client.ts) and it is typed. If that stops
        // being true, this decision is worth revisiting; nothing else about it
        // changes.
        //
        // Three alternatives, all worse:
        //   - Always 201: claims a resource was created when none was. Every
        //     intermediary that reads status codes without bodies (proxy, log,
        //     monitor) would be told a snapshot exists that does not.
        //   - 409: makes a benign no-op an error the client must route through
        //     its failure path. Nothing went wrong — the content was already
        //     saved. Error handling for a non-error.
        //   - Always 200 + always a snapshot, returning the EXISTING row on the
        //     duplicate path. The genuinely arguable one, and it still loses:
        //     `createSnapshot` fetches only the latest snapshot's content HASH
        //     (snapshots.service.ts), not the row, so it costs an extra query —
        //     and the `status` branch survives anyway, because the client still
        //     has to choose between "created" and "unchanged" copy. It buys
        //     erasing a shape difference the compiler already enforces.
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
