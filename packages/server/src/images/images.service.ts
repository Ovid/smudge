import path from "node:path";
import { randomUUID as uuidv4 } from "node:crypto";
import { UpdateImageSchema } from "@smudge/shared";
import { getProjectStore } from "../stores/project-store.injectable";
import { MAX_IMAGE_UPLOAD_BYTES, MAX_IMAGE_UPLOAD_LABEL } from "@smudge/shared";
import { scanImageReferences, scanChapterContentForImage } from "./images.references";
import { ALLOWED_MIMES, mimeToExt, getImagePath, validateMagicBytes } from "./images.paths";
import { writeImageFile, readImageFile, deleteImageFile } from "./images.fs";
import type { ImageRow, UpdateImageData } from "./images.types";
import { logger } from "../logger";
import { AppError } from "../errors/appError";
import { READ_AFTER_INSERT_FAILURE } from "../errors/readAfterInsert";

export interface FileInput {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export type UploadResult =
  | { image: ImageRow; validationError?: undefined; notFound?: undefined }
  | { validationError: string; image?: undefined; notFound?: undefined }
  | { notFound: true; image?: undefined; validationError?: undefined };

// S2 (review 2026-08-16): `readFailure` is a distinct arm from `notFound` on
// purpose. `notFound` means the row was never there; `readFailure` means the
// UPDATE committed and the read-after-write came back empty. Collapsing them
// tells the client "this image does not exist" about a write that landed.
// Mirrors chapters.service.updateChapter's "read_failure".
type UpdateResult =
  | { image: ImageRow; validationError?: undefined; notFound?: undefined; readFailure?: undefined }
  | { validationError: string; image?: undefined; notFound?: undefined; readFailure?: undefined }
  | { notFound: true; image?: undefined; validationError?: undefined; readFailure?: undefined }
  | { readFailure: true; image?: undefined; validationError?: undefined; notFound?: undefined };

type DeleteResult =
  | { deleted: true; notFound?: undefined; referenced?: undefined }
  | { notFound: true; deleted?: undefined; referenced?: undefined }
  | {
      referenced: Array<{ id: string; title: string; trashed: boolean }>;
      deleted?: undefined;
      notFound?: undefined;
    };

type ReferencesResult =
  | { chapters: Array<{ id: string; title: string }>; notFound?: undefined }
  | { notFound: true; chapters?: undefined };

export async function uploadImage(projectId: string, file: FileInput): Promise<UploadResult> {
  if (file.size === 0) {
    return { validationError: "File is empty" };
  }

  if (!ALLOWED_MIMES.has(file.mimetype)) {
    return {
      validationError: `Unsupported MIME type: ${file.mimetype}. Allowed: jpeg, png, gif, webp`,
    };
  }

  if (!validateMagicBytes(file.buffer, file.mimetype)) {
    return {
      validationError: `File content does not match declared type ${file.mimetype}`,
    };
  }

  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    return {
      validationError: `File too large (${file.size} bytes). Maximum size is ${MAX_IMAGE_UPLOAD_LABEL}`,
    };
  }

  const store = getProjectStore();
  const project = await store.findProjectById(projectId);
  if (!project) {
    return { notFound: true };
  }

  const id = uuidv4();
  // ALLOWED_MIMES check above guarantees this returns a non-null extension
  const ext = mimeToExt(file.mimetype);
  if (!ext) {
    return { validationError: `Unsupported file extension for MIME type: ${file.mimetype}` };
  }
  const filePath = getImagePath(projectId, id, ext);

  await writeImageFile(filePath, file.buffer);

  let row: ImageRow;
  try {
    row = await store.insertImage({
      id,
      project_id: projectId,
      filename: path.basename(file.originalname).replace(/\0/g, ""),
      mime_type: file.mimetype,
      size_bytes: file.size,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    // Clean up the orphaned file — but ONLY when nothing references it.
    //
    // F-12: this used to unlink unconditionally, on the stated assumption that
    // "the DB insert failed". That assumption is false for exactly one error:
    // READ_AFTER_INSERT_FAILURE means the INSERT *succeeded* (this path runs
    // outside any transaction, so it auto-committed) and only the confirming
    // re-read came back empty. Deleting the file there left a committed image
    // row pointing at nothing — turning a recoverable glitch into permanent
    // corruption of the row it was trying to clean up after.
    //
    // I3: this check is sound only because the repository raises that code for
    // EVERY way its confirming read can fail, not just the empty result — the
    // "did the INSERT land" fact lives there, next to the INSERT. Do not add a
    // second error identity here; extend the repository's catch instead.
    if (!(err instanceof AppError && err.code === READ_AFTER_INSERT_FAILURE)) {
      await deleteImageFile(filePath).catch(() => {});
    }
    throw err;
  }

  return { image: row };
}

export async function listImages(projectId: string): Promise<ImageRow[] | null> {
  const store = getProjectStore();
  const project = await store.findProjectById(projectId);
  if (!project) return null;
  return store.listImagesByProject(projectId);
}

export async function serveImage(id: string): Promise<{ data: Buffer; mimeType: string } | null> {
  const store = getProjectStore();
  const image = await store.findImageById(id);
  if (!image) return null;

  const ext = mimeToExt(image.mime_type);
  if (!ext) return null;

  const filePath = getImagePath(image.project_id, image.id, ext);
  try {
    const data = await readImageFile(filePath);
    return { data, mimeType: image.mime_type };
  } catch (err) {
    logger.error({ err, imageId: id }, "Failed to read image file from disk");
    return null;
  }
}

export async function updateImageMetadata(id: string, body: unknown): Promise<UpdateResult> {
  const parsed = UpdateImageSchema.safeParse(body);
  if (!parsed.success) {
    return {
      validationError: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }

  const store = getProjectStore();
  // Existence check + update + read-after-write in ONE transaction, matching
  // every structurally identical mutation in the codebase (outtakes.service
  // updateOuttakeLabel, chapters.service updateChapter, snapshots.service
  // restoreSnapshot). Split across three round trips, a concurrent writer
  // landing between the update and the re-read would ride back in this
  // response — the response body must reflect exactly what this request
  // wrote.
  return store.transaction(async (txStore) => {
    const existing = await txStore.findImageById(id);
    if (!existing) {
      return { notFound: true };
    }

    await txStore.updateImage(id, parsed.data as UpdateImageData);
    const updated = await txStore.findImageById(id);
    if (!updated) {
      // Unreachable in production — the existence check above passed and the
      // UPDATE ran in this same transaction. Defensive, and it must NOT reuse
      // `notFound`: the write committed, so the honest signal is the same
      // read-after-write failure chapters reports (F-12's taxonomy).
      return { readFailure: true };
    }
    return { image: updated };
  });
}

export async function deleteImage(id: string): Promise<DeleteResult> {
  const store = getProjectStore();
  const image = await store.findImageById(id);
  if (!image) {
    return { notFound: true };
  }

  // Live-check + removal in a single transaction to prevent a concurrent
  // chapter save from inserting a reference between the check and the delete.
  const result = await store.transaction(async (txStore) => {
    // Scan ALL chapters (including soft-deleted) for actual references.
    // Including soft-deleted chapters prevents deleting an image that a
    // trashed chapter still references — restoring that chapter would
    // produce a broken image if we allowed the delete.
    const chapters = await txStore.listAllChapterContentByProject(image.project_id);
    const referencingChapters: Array<{ id: string; title: string; trashed: boolean }> = [];
    let activeRefCount = 0;
    for (const ch of chapters) {
      // OOSI2 (agentic-review 2026-08-05): an UNREADABLE chapter blocks the
      // delete rather than counting as a non-reference. The old empty catch
      // meant the scan could not tell "no chapter references this image" from
      // "one chapter was never read", and this is the single place in the image
      // lifecycle where a read failure produces an irreversible write: the row
      // is removed and the bytes unlinked. The corrupt chapter is repairable, so
      // failing open here converts a recoverable chapter into a permanently
      // broken image.
      const scan = scanChapterContentForImage(ch.content, id);
      if (scan === "unreadable") {
        logger.warn(
          { chapter_id: ch.id, image_id: id, project_id: image.project_id },
          "Chapter content unreadable during image delete scan; blocking the delete",
        );
      }
      if (scan !== "no-reference") {
        referencingChapters.push({ id: ch.id, title: ch.title, trashed: !!ch.deleted_at });
        if (!ch.deleted_at) activeRefCount++;
      }
    }

    if (referencingChapters.length > 0) {
      // Correct reference_count to reflect only active (non-deleted) chapters,
      // since that is what the rest of the codebase maintains. Only update when
      // the delete is blocked — when it succeeds, the row is removed anyway.
      await txStore.setImageReferenceCount(id, activeRefCount);
      return { referenced: referencingChapters } as const;
    }

    // Remove the DB record inside the transaction
    await txStore.removeImage(id);
    return { deleted: true } as const;
  });

  if ("referenced" in result) {
    return result;
  }

  // File deletion happens after the transaction commits. If unlink fails,
  // we have an orphan file (harmless) rather than a ghost record.
  const ext = mimeToExt(image.mime_type);
  if (ext) {
    const filePath = getImagePath(image.project_id, image.id, ext);
    try {
      await deleteImageFile(filePath);
    } catch (err) {
      logger.warn({ err, imageId: id }, "Failed to delete image file from disk");
    }
  } else {
    logger.warn(
      { imageId: id, mimeType: image.mime_type },
      "Could not determine extension for deleted image; file left on disk",
    );
  }

  return { deleted: true };
}

export async function getImageReferences(id: string): Promise<ReferencesResult> {
  const store = getProjectStore();
  const image = await store.findImageById(id);
  if (!image) {
    return { notFound: true };
  }

  // Read-only scan — does not mutate reference_count on a GET path
  const chapters = await scanImageReferences(id, image.project_id);
  return { chapters };
}
