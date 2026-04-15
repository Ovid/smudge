import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { v4 as uuidv4 } from "uuid";
import { UpdateImageSchema } from "@smudge/shared";
import { getDb } from "../db/connection";
import { getProjectStore } from "../stores/project-store.injectable";
import * as imagesRepo from "./images.repository";
import { liveCheckImageReferences } from "./images.references";
import type { ImageRow, UpdateImageData } from "./images.types";
import { logger } from "../logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

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

function getDataDir(): string {
  return process.env.DATA_DIR ?? path.join(__dirname, "../../data");
}

function getImagePath(projectId: string, imageId: string, ext: string): string {
  return path.join(getDataDir(), "images", projectId, `${imageId}.${ext}`);
}

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

  const project = await getProjectStore().findProjectById(projectId);
  if (!project) {
    return { notFound: true };
  }

  const id = uuidv4();
  // ALLOWED_MIMES check above guarantees this key exists
  const ext = MIME_TO_EXT[file.mimetype] ?? "bin";
  const filePath = getImagePath(projectId, id, ext);

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, file.buffer);

  const db = getDb();
  const row = await imagesRepo.insert(db, {
    id,
    project_id: projectId,
    filename: file.originalname,
    mime_type: file.mimetype,
    size_bytes: file.size,
    created_at: new Date().toISOString(),
  });

  return { image: row };
}

export async function listImages(projectId: string): Promise<ImageRow[]> {
  const db = getDb();
  return imagesRepo.listByProject(db, projectId);
}

export async function getImage(id: string): Promise<ImageRow | null> {
  const db = getDb();
  return imagesRepo.findById(db, id);
}

export async function serveImage(id: string): Promise<{ data: Buffer; mimeType: string } | null> {
  const db = getDb();
  const image = await imagesRepo.findById(db, id);
  if (!image) return null;

  const ext = MIME_TO_EXT[image.mime_type];
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

  const db = getDb();
  const existing = await imagesRepo.findById(db, id);
  if (!existing) {
    return { notFound: true };
  }

  await imagesRepo.update(db, id, parsed.data as UpdateImageData);
  const updated = await imagesRepo.findById(db, id);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- we just verified existence above and updated in-place
  return { image: updated! };
}

export async function deleteImage(id: string): Promise<DeleteResult> {
  const db = getDb();
  const image = await imagesRepo.findById(db, id);
  if (!image) {
    return { notFound: true };
  }

  // Live check: scan chapters for actual references and correct drift
  const chapters = await liveCheckImageReferences(id, image.project_id);
  if (chapters.length > 0) {
    return { referenced: chapters };
  }

  const ext = MIME_TO_EXT[image.mime_type];
  if (ext) {
    const filePath = getImagePath(image.project_id, image.id, ext);
    try {
      await unlink(filePath);
    } catch (err) {
      logger.warn({ err, imageId: id }, "Failed to delete image file from disk");
    }
  }

  await imagesRepo.remove(db, id);
  return { deleted: true };
}

export async function getImageReferences(id: string): Promise<ReferencesResult> {
  const db = getDb();
  const image = await imagesRepo.findById(db, id);
  if (!image) {
    return { notFound: true };
  }

  const chapters = await liveCheckImageReferences(id, image.project_id);
  return { chapters };
}
