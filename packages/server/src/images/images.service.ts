import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { UpdateImageSchema } from "@smudge/shared";
import { getProjectStore } from "../stores/project-store.injectable";
import { liveCheckImageReferences, scanImageReferences } from "./images.references";
import { ALLOWED_MIMES, mimeToExt, getImagePath } from "./images.paths";
import type { ImageRow, UpdateImageData } from "./images.types";
import { logger } from "../logger";

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

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

type UpdateResult =
  | { image: ImageRow; validationError?: undefined; notFound?: undefined }
  | { validationError: string; image?: undefined; notFound?: undefined }
  | { notFound: true; image?: undefined; validationError?: undefined };

type DeleteResult =
  | { deleted: true; notFound?: undefined; referenced?: undefined }
  | { notFound: true; deleted?: undefined; referenced?: undefined }
  | { referenced: Array<{ id: string; title: string }>; deleted?: undefined; notFound?: undefined };

type ReferencesResult =
  | { chapters: Array<{ id: string; title: string }>; notFound?: undefined }
  | { notFound: true; chapters?: undefined };

export async function uploadImage(projectId: string, file: FileInput): Promise<UploadResult> {
  if (!ALLOWED_MIMES.has(file.mimetype)) {
    return {
      validationError: `Unsupported MIME type: ${file.mimetype}. Allowed: jpeg, png, gif, webp`,
    };
  }

  if (file.size > MAX_SIZE_BYTES) {
    return {
      validationError: `File too large (${file.size} bytes). Maximum size is 10 MB`,
    };
  }

  const store = getProjectStore();
  const project = await store.findProjectById(projectId);
  if (!project) {
    return { notFound: true };
  }

  const id = uuidv4();
  // ALLOWED_MIMES check above guarantees this returns a non-null extension
  const ext = mimeToExt(file.mimetype)!;
  const filePath = getImagePath(projectId, id, ext);

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, file.buffer);

  let row: ImageRow;
  try {
    row = await store.insertImage({
      id,
      project_id: projectId,
      filename: file.originalname,
      mime_type: file.mimetype,
      size_bytes: file.size,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    // Clean up the orphaned file — the DB insert failed so nothing references it
    await unlink(filePath).catch(() => {});
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

export async function getImage(id: string): Promise<ImageRow | null> {
  const store = getProjectStore();
  return store.findImageById(id);
}

export async function serveImage(id: string): Promise<{ data: Buffer; mimeType: string } | null> {
  const store = getProjectStore();
  const image = await store.findImageById(id);
  if (!image) return null;

  const ext = mimeToExt(image.mime_type);
  if (!ext) return null;

  const filePath = getImagePath(image.project_id, image.id, ext);
  try {
    const data = await readFile(filePath);
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
  const existing = await store.findImageById(id);
  if (!existing) {
    return { notFound: true };
  }

  await store.updateImage(id, parsed.data as UpdateImageData);
  const updated = await store.findImageById(id);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- we just verified existence above and updated in-place
  return { image: updated! };
}

export async function deleteImage(id: string): Promise<DeleteResult> {
  const store = getProjectStore();
  const image = await store.findImageById(id);
  if (!image) {
    return { notFound: true };
  }

  // Live check: scan chapters for actual references and correct drift
  const chapters = await liveCheckImageReferences(id, image.project_id);
  if (chapters.length > 0) {
    return { referenced: chapters };
  }

  const ext = mimeToExt(image.mime_type);
  if (ext) {
    const filePath = getImagePath(image.project_id, image.id, ext);
    try {
      await unlink(filePath);
    } catch (err) {
      logger.warn({ err, imageId: id }, "Failed to delete image file from disk");
    }
  }

  await store.removeImage(id);
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
