# Phase 4a: Reference Panel & Images — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a collapsible, resizable reference panel to the right of the editor with an image gallery tab — enabling writers to upload, manage, and insert images into their manuscripts.

**Architecture:** New `images` server module (routes → service → repository) following the existing chapter/project pattern. Images stored on disk at `{DATA_DIR}/images/{project_id}/{uuid}.{ext}` with metadata in a new `images` table. Client gets a `ReferencePanel` component with tab infrastructure and an `ImageGallery` tab. Reference counting maintained at chapter save time. The export pipeline is extended to resolve image URLs to file bytes.

**Tech Stack:** Express + multer (upload), better-sqlite3/Knex (metadata), @tiptap/extension-image (editor), React (panel UI), existing Vitest + Supertest + Playwright test infrastructure.

**Design document:** `docs/plans/2026-04-15-reference-panel-images-design.md`

---

## Task 1: Database Migration — `images` Table

**Files:**
- Create: `packages/server/src/db/migrations/012_create_images.js`

**Step 1: Write the migration**

```javascript
export async function up(knex) {
  await knex.schema.createTable("images", (table) => {
    table.text("id").primary();
    table.text("project_id").notNullable().references("id").inTable("projects");
    table.text("filename").notNullable();
    table.text("alt_text").notNullable().defaultTo("");
    table.text("caption").notNullable().defaultTo("");
    table.text("source").notNullable().defaultTo("");
    table.text("license").notNullable().defaultTo("");
    table.text("mime_type").notNullable();
    table.integer("size_bytes").notNullable();
    table.integer("reference_count").notNullable().defaultTo(0);
    table.text("created_at").notNullable();
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists("images");
}
```

**Step 2: Verify migration runs**

Run: `cd packages/server && npx knex migrate:latest --knexfile src/db/knexfile.ts`

Alternatively, verify via tests in the next task (the test helper runs migrations automatically on in-memory DB).

**Step 3: Update test helper to truncate `images` table**

Modify: `packages/server/src/__tests__/test-helpers.ts`

Add `await testDb("images").del();` in `beforeEach`, **before** the `chapters` deletion (images have FK to projects, so delete images before projects):

```typescript
beforeEach(async () => {
  await testDb("images").del();
  await testDb("daily_snapshots").del();
  await testDb("settings").del();
  await testDb("chapters").del();
  await testDb("projects").del();
});
```

**Step 4: Commit**

```
feat(images): add images table migration and update test helper
```

---

## Task 2: Image Types, Repository, and Zod Schema

**Files:**
- Create: `packages/server/src/images/images.types.ts`
- Create: `packages/server/src/images/images.repository.ts`
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/index.ts`

**Step 1: Write image types**

Create `packages/server/src/images/images.types.ts`:

```typescript
export interface ImageRow {
  id: string;
  project_id: string;
  filename: string;
  alt_text: string;
  caption: string;
  source: string;
  license: string;
  mime_type: string;
  size_bytes: number;
  reference_count: number;
  created_at: string;
}

export interface CreateImageRow {
  id: string;
  project_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export interface UpdateImageData {
  alt_text?: string;
  caption?: string;
  source?: string;
  license?: string;
}

export interface ImageWithUsage extends ImageRow {
  used_in_chapters: Array<{ id: string; title: string }>;
}
```

**Step 2: Write Zod schemas in shared package**

Add to `packages/shared/src/schemas.ts`:

```typescript
export const UpdateImageSchema = z
  .object({
    alt_text: z.string().max(1000, "Alt text is too long"),
    caption: z.string().max(2000, "Caption is too long"),
    source: z.string().max(1000, "Source is too long"),
    license: z.string().max(500, "License is too long"),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });
```

Also add `epub_cover_image_id` to the `ExportSchema`:

```typescript
export const ExportSchema = z.object({
  format: ExportFormat,
  include_toc: z.boolean().default(true),
  chapter_ids: z.array(z.string().uuid()).min(1).max(1000).optional(),
  epub_cover_image_id: z.string().uuid().optional(),
});
```

Export `UpdateImageSchema` from `packages/shared/src/index.ts`.

**Step 3: Write the repository**

Create `packages/server/src/images/images.repository.ts`:

```typescript
import type { Knex } from "knex";
import type { ImageRow, CreateImageRow, UpdateImageData } from "./images.types";

export async function insert(
  db: Knex | Knex.Transaction,
  data: CreateImageRow,
): Promise<ImageRow> {
  await db("images").insert(data);
  return db("images").where("id", data.id).first();
}

export async function findById(
  db: Knex | Knex.Transaction,
  id: string,
): Promise<ImageRow | null> {
  const row = await db("images").where("id", id).first();
  return row ?? null;
}

export async function listByProject(
  db: Knex | Knex.Transaction,
  projectId: string,
): Promise<ImageRow[]> {
  return db("images")
    .where("project_id", projectId)
    .orderBy("created_at", "desc");
}

export async function update(
  db: Knex | Knex.Transaction,
  id: string,
  data: UpdateImageData,
): Promise<number> {
  return db("images").where("id", id).update(data);
}

export async function remove(
  db: Knex | Knex.Transaction,
  id: string,
): Promise<number> {
  return db("images").where("id", id).delete();
}

export async function removeByProject(
  db: Knex | Knex.Transaction,
  projectId: string,
): Promise<number> {
  return db("images").where("project_id", projectId).delete();
}

export async function incrementReferenceCount(
  db: Knex | Knex.Transaction,
  id: string,
  delta: number,
): Promise<void> {
  await db("images")
    .where("id", id)
    .update({
      reference_count: db.raw("MAX(0, reference_count + ?)", [delta]),
    });
}
```

**Step 4: Run tests to verify compilation**

Run: `npm test -w packages/server -- --run` (should pass — no tests for images yet, but verifies no import errors)

**Step 5: Commit**

```
feat(images): add image types, repository, and Zod schema
```

---

## Task 3: Image Service — Core CRUD

**Files:**
- Create: `packages/server/src/images/images.service.ts`
- Create: `packages/server/src/__tests__/images.service.test.ts`

**Step 1: Write failing tests for the image service**

Create `packages/server/src/__tests__/images.service.test.ts`. Tests should cover:

- `listImages(projectId)` — returns images for a project, empty array if none
- `getImage(id)` — returns image or null
- `updateImageMetadata(id, body)` — updates fields, returns updated row or null, returns validation error on invalid input
- `deleteImage(id)` — deletes when reference_count is 0, returns `{ referenced: chapters[] }` when reference_count > 0 (live check)
- `findImageReferences(imageId, projectId)` — scans chapter content JSON for image URL, returns chapter list

Use the `setupTestDb()` helper and supertest pattern. Since the service needs filesystem operations for upload/delete, the service functions that touch the filesystem should accept a `dataDir` parameter (or use a config module).

For testing, use a temp directory (via `import { mkdtemp } from "node:fs/promises"` and `import { tmpdir } from "node:os"`).

**Step 2: Run tests to verify they fail**

Run: `npm test -w packages/server -- --run -t "images"`
Expected: FAIL — service module doesn't exist yet

**Step 3: Write the image service**

Create `packages/server/src/images/images.service.ts`:

Key functions:

```typescript
import path from "node:path";
import fs from "node:fs/promises";
import { v4 as uuidv4 } from "uuid";
import { UpdateImageSchema } from "@smudge/shared";
import { getProjectStore } from "../stores/project-store.injectable";
import { logger } from "../logger";
import * as imagesRepo from "./images.repository";
import type { ImageRow, ImageWithUsage } from "./images.types";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function getDataDir(): string {
  return process.env.DATA_DIR ?? path.join(__dirname, "../../data");
}

function imageFilePath(dataDir: string, projectId: string, imageId: string, ext: string): string {
  return path.join(dataDir, "images", projectId, `${imageId}.${ext}`);
}

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
  };
  return map[mime] ?? "bin";
}

export async function uploadImage(
  projectId: string,
  file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
): Promise<
  | { image: ImageRow }
  | { validationError: string }
  | { notFound: true }
> {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return { validationError: `Unsupported file type: ${file.mimetype}. Accepted: JPEG, PNG, GIF, WebP.` };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { validationError: `File too large: ${file.size} bytes. Maximum: 10MB.` };
  }

  const store = getProjectStore();
  const project = await store.findProjectById(projectId);
  if (!project) return { notFound: true };

  const dataDir = getDataDir();
  const id = uuidv4();
  const ext = mimeToExt(file.mimetype);
  const filePath = imageFilePath(dataDir, projectId, id, ext);

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, file.buffer);

  const now = new Date().toISOString();
  const db = (store as any).db; // Access underlying Knex instance
  // Note: The implementer should add a `getDb()` method or pass db through the store.
  // For now, use the store's transaction wrapper to get a db reference.

  const image = await imagesRepo.insert(db, {
    id,
    project_id: projectId,
    filename: file.originalname,
    mime_type: file.mimetype,
    size_bytes: file.size,
    created_at: now,
  });

  return { image };
}
```

**Important implementation note:** The service needs direct Knex access for the images repository (images are not part of the ProjectStore interface). Two clean approaches:

1. **Add image methods to ProjectStore** — follows existing pattern but bloats the interface
2. **Create a separate DB accessor for images** — the images module imports `getDb()` from `db/connection` directly

Approach 2 is cleaner since images are a separate domain. Check `packages/server/src/db/connection.ts` — it likely exports a `getDb()` function. Use that directly in the images repository/service rather than going through ProjectStore.

**Step 4: Run tests to verify they pass**

Run: `npm test -w packages/server -- --run -t "images"`
Expected: PASS

**Step 5: Commit**

```
feat(images): add image service with upload, metadata, and deletion
```

---

## Task 4: Image Reference Counting in Chapter Save Pipeline

**Files:**
- Create: `packages/server/src/images/images.references.ts`
- Create: `packages/server/src/__tests__/images.references.test.ts`
- Modify: `packages/server/src/chapters/chapters.service.ts`

**Step 1: Write failing tests for reference extraction and diffing**

Create `packages/server/src/__tests__/images.references.test.ts`:

Test `extractImageIds(content)`:
- Returns empty array for null content
- Returns empty array for content with no images
- Extracts UUID from `/api/images/{uuid}` in TipTap image nodes
- Handles multiple images
- Ignores non-image URLs

Test `diffImageReferences(oldIds, newIds)`:
- Returns `{ added: [], removed: [] }` for identical sets
- Returns correct added/removed for changes
- Handles first save (old is empty)

**Step 2: Run tests to verify they fail**

Run: `npm test -w packages/server -- --run -t "reference"`
Expected: FAIL

**Step 3: Implement reference extraction**

Create `packages/server/src/images/images.references.ts`:

```typescript
const IMAGE_URL_PATTERN = /\/api\/images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

/**
 * Walk TipTap JSON content and extract all image UUIDs from
 * nodes with type "image" and src matching /api/images/{uuid}.
 */
export function extractImageIds(content: Record<string, unknown> | null): string[] {
  if (!content) return [];
  const ids = new Set<string>();

  function walk(node: Record<string, unknown>) {
    if (node.type === "image" && typeof node.attrs === "object" && node.attrs !== null) {
      const attrs = node.attrs as Record<string, unknown>;
      if (typeof attrs.src === "string") {
        const match = /\/api\/images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(attrs.src);
        if (match) ids.add(match[1].toLowerCase());
      }
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) {
        if (typeof child === "object" && child !== null) {
          walk(child as Record<string, unknown>);
        }
      }
    }
  }

  walk(content);
  return [...ids];
}

export function diffImageReferences(
  oldIds: string[],
  newIds: string[],
): { added: string[]; removed: string[] } {
  const oldSet = new Set(oldIds);
  const newSet = new Set(newIds);
  const added = newIds.filter((id) => !oldSet.has(id));
  const removed = oldIds.filter((id) => !newSet.has(id));
  return { added: [...new Set(added)], removed: [...new Set(removed)] };
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -w packages/server -- --run -t "reference"`
Expected: PASS

**Step 5: Hook into chapter save pipeline**

Modify `packages/server/src/chapters/chapters.service.ts` — in the `updateChapter` function, after the content update succeeds, add a best-effort reference count update:

```typescript
// After the transaction block (line ~88), alongside the velocity side-effect:
if (parsed.data.content !== undefined) {
  // Best-effort reference count update
  try {
    const { extractImageIds, diffImageReferences } = await import("../images/images.references");
    const oldContent = chapter.content ? JSON.parse(chapter.content) : null;
    const oldIds = extractImageIds(oldContent);
    const newIds = extractImageIds(parsed.data.content as Record<string, unknown>);
    const { added, removed } = diffImageReferences(oldIds, newIds);

    const db = (await import("../db/connection")).getDb();
    const repo = await import("../images/images.repository");
    for (const id of added) {
      await repo.incrementReferenceCount(db, id, 1);
    }
    for (const id of removed) {
      await repo.incrementReferenceCount(db, id, -1);
    }
  } catch (err: unknown) {
    logger.error(
      { err, chapter_id: id },
      "Image reference count update failed (best-effort)",
    );
  }
}
```

**Note:** Use static imports at the top of the file rather than dynamic imports — the above shows the logic, but the implementer should use normal `import` statements at the top.

**Step 6: Write integration test for reference counting through chapter save**

Add to `packages/server/src/__tests__/images.service.test.ts` (or a dedicated test file):
- Upload an image, save a chapter with content referencing it, verify `reference_count` is 1
- Save the chapter again without the image, verify `reference_count` is 0
- Save with two references to the same image, verify `reference_count` is 1 (deduplicated)

**Step 7: Run all tests**

Run: `npm test -w packages/server -- --run`
Expected: PASS

**Step 8: Commit**

```
feat(images): add reference counting on chapter save
```

---

## Task 5: Image Routes — Upload, List, Serve, Update, Delete

**Files:**
- Create: `packages/server/src/images/images.routes.ts`
- Create: `packages/server/src/__tests__/images.routes.test.ts`
- Modify: `packages/server/src/app.ts`

**Step 1: Install multer**

Run: `npm install multer -w packages/server && npm install @types/multer -w packages/server --save-dev`

Check the multer license: MIT — acceptable.

**Step 2: Write failing integration tests**

Create `packages/server/src/__tests__/images.routes.test.ts`:

Tests via supertest:
- `POST /api/projects/:projectId/images` — upload a valid image → 201 + image record
- `POST /api/projects/:projectId/images` — invalid MIME type → 400
- `POST /api/projects/:projectId/images` — oversized file → 413 (multer rejects mid-stream)
- `POST /api/projects/:projectId/images` — non-existent project → 404
- `GET /api/projects/:projectId/images` — lists images for project
- `GET /api/images/:id` — serves the image file with correct Content-Type
- `GET /api/images/:id` — non-existent → 404
- `PATCH /api/images/:id` — updates metadata → 200
- `PATCH /api/images/:id` — empty body → 400
- `PATCH /api/images/:id` — non-existent → 404
- `DELETE /api/images/:id` — unreferenced image → 200
- `DELETE /api/images/:id` — referenced image → 409 with chapter list
- `DELETE /api/images/:id` — non-existent → 404

For upload tests, use supertest's `.attach()` method with a small test image buffer:

```typescript
const testImageBuffer = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
); // 1x1 transparent PNG
```

**Step 3: Run tests to verify they fail**

Run: `npm test -w packages/server -- --run -t "images.routes"`
Expected: FAIL

**Step 4: Write the routes**

Create `packages/server/src/images/images.routes.ts`:

```typescript
import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "../app";
import * as imagesService from "./images.service";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB — streaming rejection
});

export function imagesRouter(): Router {
  const router = Router();

  // POST /api/projects/:projectId/images — upload
  router.post(
    "/:projectId/images",
    upload.single("file"),
    asyncHandler(async (req, res) => {
      if (!req.file) {
        res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "No file uploaded." } });
        return;
      }
      const result = await imagesService.uploadImage(req.params.projectId, req.file);
      if ("validationError" in result) {
        res.status(400).json({ error: { code: "VALIDATION_ERROR", message: result.validationError } });
        return;
      }
      if ("notFound" in result) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found." } });
        return;
      }
      res.status(201).json(result.image);
    }),
  );

  // GET /api/projects/:projectId/images — list
  router.get(
    "/:projectId/images",
    asyncHandler(async (req, res) => {
      const images = await imagesService.listImages(req.params.projectId);
      res.json(images);
    }),
  );

  return router;
}

export function imagesDirectRouter(): Router {
  const router = Router();

  // GET /api/images/:id — serve file
  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const result = await imagesService.serveImage(req.params.id);
      if (!result) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Image not found." } });
        return;
      }
      res.set("Content-Type", result.mimeType);
      res.set("Cache-Control", "public, max-age=31536000, immutable");
      res.send(result.data);
    }),
  );

  // PATCH /api/images/:id — update metadata
  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const result = await imagesService.updateImageMetadata(req.params.id, req.body);
      if ("validationError" in result) {
        res.status(400).json({ error: { code: "VALIDATION_ERROR", message: result.validationError } });
        return;
      }
      if ("notFound" in result) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Image not found." } });
        return;
      }
      res.json(result.image);
    }),
  );

  // DELETE /api/images/:id — delete (blocked if referenced)
  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const result = await imagesService.deleteImage(req.params.id);
      if ("notFound" in result) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Image not found." } });
        return;
      }
      if ("referenced" in result) {
        res.status(409).json({
          error: {
            code: "IMAGE_IN_USE",
            message: "Image is referenced in chapter content.",
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
```

**Step 5: Mount routes in app.ts**

Modify `packages/server/src/app.ts`:

```typescript
import { imagesRouter, imagesDirectRouter } from "./images/images.routes";

// In createApp(), add before the health check:
app.use("/api/projects", imagesRouter());
app.use("/api/images", imagesDirectRouter());
```

Also update the Helmet CSP to allow blob: URLs for images if needed (check if the current `imgSrc: ["'self'", "data:"]` is sufficient — it should be since images are served from the same origin).

**Step 6: Handle multer file size error**

Multer throws an error with `code: "LIMIT_FILE_SIZE"` when the streaming limit is exceeded. Add handling in `globalErrorHandler` or via a multer error middleware on the upload route:

```typescript
// In the upload route, wrap with multer error handling:
router.post(
  "/:projectId/images",
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err && err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({
          error: { code: "PAYLOAD_TOO_LARGE", message: "File too large. Maximum: 10MB." },
        });
        return;
      }
      if (err) return next(err);
      next();
    });
  },
  asyncHandler(async (req, res) => { /* ... */ }),
);
```

**Step 7: Run tests to verify they pass**

Run: `npm test -w packages/server -- --run`
Expected: PASS

**Step 8: Commit**

```
feat(images): add image API routes with multer upload
```

---

## Task 6: Image Purge on Project Deletion

**Files:**
- Modify: `packages/server/src/db/purge.ts`
- Modify: `packages/server/src/__tests__/purge.test.ts`

**Step 1: Write failing tests**

Add to `packages/server/src/__tests__/purge.test.ts`:
- When a project is purged, its `images` records are deleted from the database
- The image files on disk are deleted (use a temp directory)

**Step 2: Run tests to verify they fail**

Run: `npm test -w packages/server -- --run -t "purge"`
Expected: FAIL

**Step 3: Update purge logic**

Modify `packages/server/src/db/purge.ts`:

Before deleting chapters for a purged project, also delete image records. After the transaction, delete the image directories from disk:

```typescript
import fs from "node:fs/promises";
import path from "node:path";

export async function purgeOldTrash(db: Knex, dataDir?: string): Promise<{ chapters: number; projects: number; images: number }> {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_MS).toISOString();
  const resolvedDataDir = dataDir ?? process.env.DATA_DIR ?? path.join(__dirname, "../../data");

  let imageCount = 0;
  const purgedProjectIds: string[] = [];

  const result = await db.transaction(async (trx) => {
    // ... existing chapter deletion ...

    // Find projects to purge
    const projectsToPurge = await trx("projects").where("deleted_at", "<", cutoff).select("id");

    if (projectsToPurge.length > 0) {
      const ids = projectsToPurge.map((p: { id: string }) => p.id);
      purgedProjectIds.push(...ids);

      // Delete image records for purged projects
      imageCount = await trx("images").whereIn("project_id", ids).delete();

      // ... existing chapter deletion for purged projects ...
    }

    // ... existing project deletion ...

    return { chapters, projects };
  });

  // After transaction: clean up image directories from disk (best-effort)
  for (const projectId of purgedProjectIds) {
    const imageDir = path.join(resolvedDataDir, "images", projectId);
    try {
      await fs.rm(imageDir, { recursive: true, force: true });
    } catch (err) {
      logger.warn({ err, projectId }, "Failed to clean up image directory during purge");
    }
  }

  return { ...result, images: imageCount };
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -w packages/server -- --run -t "purge"`
Expected: PASS

**Step 5: Commit**

```
feat(images): cascade image deletion on project purge
```

---

## Task 7: TipTap Image Extension — Client & Server

**Files:**
- Modify: `packages/client/src/editorExtensions.ts`
- Modify: `packages/server/src/export/editorExtensions.ts`

**Step 1: Install the TipTap image extension**

Run: `npm install @tiptap/extension-image -w packages/client && npm install @tiptap/extension-image -w packages/server`

Check license: MIT — acceptable.

**Step 2: Add Image extension to client editor extensions**

Modify `packages/client/src/editorExtensions.ts`:

```typescript
import StarterKit from "@tiptap/starter-kit";
import Heading from "@tiptap/extension-heading";
import Image from "@tiptap/extension-image";

export const editorExtensions = [
  StarterKit.configure({
    heading: false,
  }),
  Heading.configure({
    levels: [3, 4, 5],
  }),
  Image.configure({
    inline: false,
    allowBase64: false,
  }),
];
```

**Step 3: Add Image extension to server editor extensions**

Modify `packages/server/src/export/editorExtensions.ts` — identical addition of the Image extension.

**Step 4: Run existing tests to verify nothing breaks**

Run: `npm test -w packages/server -- --run && npm test -w packages/client -- --run`
Expected: PASS (existing tests should still pass — adding an extension doesn't break rendering of content that doesn't use it)

**Step 5: Commit**

```
feat(images): add TipTap Image extension to client and server
```

---

## Task 8: Client API Layer — Image Endpoints

**Files:**
- Modify: `packages/client/src/api/client.ts`

**Step 1: Add image API methods**

Add to the `api` object in `packages/client/src/api/client.ts`:

```typescript
images: {
  list(projectId: string): Promise<ImageRow[]> {
    return apiFetch(`/projects/${projectId}/images`);
  },

  async upload(projectId: string, file: File): Promise<ImageRow> {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${BASE}/projects/${projectId}/images`, {
      method: "POST",
      body: formData,
      // No Content-Type header — browser sets multipart boundary
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new ApiRequestError(
        body?.error?.message ?? `Upload failed (${res.status})`,
        res.status,
      );
    }
    return res.json();
  },

  async serve(id: string): Promise<string> {
    // Returns the URL to use as img src — just the API path
    return `/api/images/${id}`;
  },

  update(id: string, data: { alt_text?: string; caption?: string; source?: string; license?: string }): Promise<ImageRow> {
    return apiFetch(`/images/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  async delete(id: string): Promise<{ deleted: boolean } | { error: { code: string; message: string; chapters: Array<{ id: string; title: string }> } }> {
    const res = await fetch(`${BASE}/images/${id}`, { method: "DELETE" });
    const body = await res.json();
    if (res.status === 409) return body;
    if (!res.ok) {
      throw new ApiRequestError(body?.error?.message ?? `Delete failed (${res.status})`, res.status);
    }
    return body;
  },
},
```

You'll need to import the `ImageRow` type. Add it to the shared package exports if not already there, or define a client-side type that matches.

**Step 2: Run client tests**

Run: `npm test -w packages/client -- --run`
Expected: PASS

**Step 3: Commit**

```
feat(images): add image API client methods
```

---

## Task 9: Reference Panel Hook — `useReferencePanelState`

**Files:**
- Create: `packages/client/src/hooks/useReferencePanelState.ts`
- Create: `packages/client/src/__tests__/useReferencePanelState.test.ts`

**Step 1: Write failing tests**

Test the hook:
- Default state: closed, width 320px
- Toggle open/closed persists to localStorage
- Resize updates width and persists to localStorage
- Width is clamped between 240 and 480

**Step 2: Run tests to verify they fail**

Run: `npm test -w packages/client -- --run -t "useReferencePanelState"`
Expected: FAIL

**Step 3: Implement the hook**

Create `packages/client/src/hooks/useReferencePanelState.ts`:

```typescript
import { useState, useCallback } from "react";

const PANEL_DEFAULT_WIDTH = 320;
export const PANEL_MIN_WIDTH = 240;
export const PANEL_MAX_WIDTH = 480;
const PANEL_WIDTH_KEY = "smudge:ref-panel-width";
const PANEL_OPEN_KEY = "smudge:ref-panel-open";

function getSavedPanelWidth(): number {
  try {
    const stored = localStorage.getItem(PANEL_WIDTH_KEY);
    if (stored !== null) {
      const parsed = Number(stored);
      if (!Number.isNaN(parsed) && parsed >= PANEL_MIN_WIDTH && parsed <= PANEL_MAX_WIDTH) {
        return parsed;
      }
    }
  } catch {
    // localStorage unavailable
  }
  return PANEL_DEFAULT_WIDTH;
}

function getSavedPanelOpen(): boolean {
  try {
    const stored = localStorage.getItem(PANEL_OPEN_KEY);
    if (stored !== null) return stored === "true";
  } catch {
    // localStorage unavailable
  }
  return false;
}

export function useReferencePanelState() {
  const [panelWidth, setPanelWidth] = useState(getSavedPanelWidth);
  const [panelOpen, setPanelOpenState] = useState(getSavedPanelOpen);

  const handlePanelResize = useCallback((newWidth: number) => {
    const clamped = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, newWidth));
    setPanelWidth(clamped);
    try {
      localStorage.setItem(PANEL_WIDTH_KEY, String(clamped));
    } catch {
      // localStorage unavailable
    }
  }, []);

  const setPanelOpen = useCallback((open: boolean) => {
    setPanelOpenState(open);
    try {
      localStorage.setItem(PANEL_OPEN_KEY, String(open));
    } catch {
      // localStorage unavailable
    }
  }, []);

  const togglePanel = useCallback(() => {
    setPanelOpen(!panelOpen);
  }, [panelOpen, setPanelOpen]);

  return { panelWidth, panelOpen, setPanelOpen, handlePanelResize, togglePanel };
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -w packages/client -- --run -t "useReferencePanelState"`
Expected: PASS

**Step 5: Commit**

```
feat(images): add useReferencePanelState hook with localStorage persistence
```

---

## Task 10: Reference Panel Component

**Files:**
- Create: `packages/client/src/components/ReferencePanel.tsx`
- Modify: `packages/client/src/strings.ts`

**Step 1: Add strings**

Add to `packages/client/src/strings.ts` in the STRINGS object:

```typescript
referencePanel: {
  ariaLabel: "Reference panel",
  resizeHandle: "Resize reference panel",
  toggleTooltip: "Toggle reference panel (Ctrl+.)",
  imagesTab: "Images",
},
```

**Step 2: Build the panel component**

Create `packages/client/src/components/ReferencePanel.tsx`:

The component structure:
- `<aside>` with aria-label, same border/background pattern as Sidebar
- Tab bar at top (single "Images" tab for now, using `role="tablist"`)
- Content area with `role="tabpanel"`
- Left-edge resize handle mirroring the Sidebar's right-edge handle
- All state (width, open) managed by parent via props

```typescript
import { useRef, useEffect } from "react";
import { PANEL_MIN_WIDTH, PANEL_MAX_WIDTH } from "../hooks/useReferencePanelState";
import { STRINGS } from "../strings";

interface ReferencePanelProps {
  width: number;
  onResize: (newWidth: number) => void;
  children: React.ReactNode;
}

export function ReferencePanel({ width, onResize, children }: ReferencePanelProps) {
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => resizeCleanupRef.current?.();
  }, []);

  return (
    <aside
      aria-label={STRINGS.referencePanel.ariaLabel}
      className="border-l border-border/60 bg-bg-sidebar flex flex-col h-full overflow-hidden relative"
      style={{ width: `${width}px`, minWidth: `${width}px` }}
    >
      {/* Resize handle — left edge */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={STRINGS.referencePanel.resizeHandle}
        aria-valuenow={width}
        aria-valuemin={PANEL_MIN_WIDTH}
        aria-valuemax={PANEL_MAX_WIDTH}
        tabIndex={0}
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/20 focus:bg-accent/20 focus:outline-none transition-colors duration-200"
        onMouseDown={(e) => {
          e.preventDefault();
          const startX = e.clientX;
          const startWidth = width;
          function onMouseMove(ev: MouseEvent) {
            // Panel grows to the LEFT, so subtract delta
            const newWidth = Math.min(
              PANEL_MAX_WIDTH,
              Math.max(PANEL_MIN_WIDTH, startWidth - (ev.clientX - startX)),
            );
            onResize(newWidth);
          }
          function onMouseUp() {
            cleanupResize();
          }
          function cleanupResize() {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
            resizeCleanupRef.current = null;
          }
          document.addEventListener("mousemove", onMouseMove);
          document.addEventListener("mouseup", onMouseUp);
          resizeCleanupRef.current = cleanupResize;
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            onResize(Math.min(PANEL_MAX_WIDTH, width + 10));
          }
          if (e.key === "ArrowRight") {
            e.preventDefault();
            onResize(Math.max(PANEL_MIN_WIDTH, width - 10));
          }
        }}
      />

      {/* Tab bar */}
      <div role="tablist" className="border-b border-border/40 px-4 py-2 flex gap-2">
        <button
          role="tab"
          aria-selected={true}
          className="text-sm font-medium text-text-primary px-2 py-1 border-b-2 border-accent"
        >
          {STRINGS.referencePanel.imagesTab}
        </button>
      </div>

      {/* Tab content */}
      <div role="tabpanel" className="flex-1 overflow-y-auto">
        {children}
      </div>
    </aside>
  );
}
```

**Note on resize direction:** The sidebar resize handle grows to the RIGHT (positive delta increases width). The reference panel resize handle grows to the LEFT (negative delta increases width — the formula subtracts the delta). Arrow keys are also inverted: ArrowLeft makes the panel wider, ArrowRight makes it narrower.

**Step 3: Commit**

```
feat(images): add ReferencePanel component with tab infrastructure
```

---

## Task 11: Image Gallery Component

**Files:**
- Create: `packages/client/src/components/ImageGallery.tsx`
- Modify: `packages/client/src/strings.ts`

**Step 1: Add strings**

Add to the STRINGS object:

```typescript
imageGallery: {
  uploadButton: "Upload image",
  noImages: "No images yet. Upload one to get started.",
  unusedBadge: "unused",
  noAltText: "No alt text",
  altTextLabel: "Alt text",
  captionLabel: "Caption",
  sourceLabel: "Source",
  licenseLabel: "License",
  saveButton: "Save",
  insertButton: "Insert at cursor",
  deleteButton: "Delete",
  backToGrid: "Back to gallery",
  deleteConfirm: "Delete this image?",
  deleteBlocked: (chapters: string[]) =>
    `This image is used in: ${chapters.join(", ")}. Remove it from those chapters first.`,
  uploadSuccess: (filename: string) => `Image uploaded: ${filename}`,
  uploadFailed: (reason: string) => `Upload failed: ${reason}`,
  insertSuccess: (filename: string) => `Image inserted: ${filename}`,
  usedInChapters: "Used in",
  saving: "Saving...",
  saved: "Saved",
},
```

**Step 2: Build the gallery component**

Create `packages/client/src/components/ImageGallery.tsx`:

This is the largest UI component. It has three modes:
1. **Grid view** — thumbnail grid with upload button
2. **Detail view** — single image with metadata form

Props:
```typescript
interface ImageGalleryProps {
  projectId: string;
  onInsertImage: (imageUrl: string, altText: string) => void;
}
```

Key implementation details:
- Fetch images via `api.images.list(projectId)` on mount and after upload
- Upload via hidden `<input type="file" accept="image/jpeg,image/png,image/gif,image/webp">`
- Thumbnails as a CSS grid: `grid grid-cols-2 gap-2 p-4`
- Each thumbnail: `<button>` wrapping `<img>` with `object-fit: cover`, `aspect-ratio: 1`
- Detail view: form with controlled inputs, save on button click
- Delete: show confirmation, handle 409 by showing chapter list
- `aria-live="polite"` region for upload/insert announcements
- "Unused" badge when `reference_count === 0`
- "Used in" section with chapter links when `reference_count > 0` (fetch from delete attempt's 409 response, or add a dedicated endpoint)

**Step 3: Commit**

```
feat(images): add ImageGallery component with upload, metadata, and delete
```

---

## Task 12: Wire Panel Into EditorPage

**Files:**
- Modify: `packages/client/src/pages/EditorPage.tsx`
- Modify: `packages/client/src/strings.ts`

**Step 1: Add panel toggle button string**

Already added in Task 10 (`toggleTooltip`).

**Step 2: Integrate into EditorPage**

Modify `packages/client/src/pages/EditorPage.tsx`:

1. Import `useReferencePanelState`, `ReferencePanel`, `ImageGallery`
2. Add the hook call alongside `useSidebarState`:
   ```typescript
   const { panelWidth, panelOpen, handlePanelResize, togglePanel } = useReferencePanelState();
   ```
3. Add Ctrl+. keyboard shortcut via the existing `useKeyboardShortcuts` pattern
4. Add a toggle button in the header toolbar (near the export button):
   ```tsx
   <button
     type="button"
     onClick={togglePanel}
     aria-expanded={panelOpen}
     aria-controls="reference-panel"
     title={STRINGS.referencePanel.toggleTooltip}
     className="p-2 rounded hover:bg-bg-hover text-text-secondary"
   >
     {/* Panel icon — use a simple SVG or text icon */}
   </button>
   ```
5. Add the panel in the main content area flex layout, **after** the editor content div:
   ```tsx
   <div className="flex flex-1 overflow-hidden">
     {sidebarOpen && <Sidebar ... />}
     <div className="flex-1 flex flex-col overflow-hidden">
       {/* ... existing editor content ... */}
     </div>
     {panelOpen && (
       <ReferencePanel
         id="reference-panel"
         width={panelWidth}
         onResize={handlePanelResize}
       >
         <ImageGallery
           projectId={project.id}
           onInsertImage={(url, alt) => {
             editorRef.current?.insertImage(url, alt);
           }}
         />
       </ReferencePanel>
     )}
   </div>
   ```
6. Add `insertImage` method to the editor ref/handle interface

**Step 3: Add `insertImage` to Editor component**

Modify `packages/client/src/components/Editor.tsx`:

Add to the editor handle (or via `useImperativeHandle`):
```typescript
insertImage(src: string, alt: string) {
  if (editor) {
    editor.chain().focus().setImage({ src, alt }).run();
  }
}
```

**Step 4: Add Ctrl+. to ShortcutHelpDialog**

Modify the shortcut help dialog to include the new shortcut.

**Step 5: Run all client tests**

Run: `npm test -w packages/client -- --run`
Expected: PASS

**Step 6: Commit**

```
feat(images): wire reference panel and image gallery into editor page
```

---

## Task 13: Paste/Drop Image Into Editor

**Files:**
- Modify: `packages/client/src/components/Editor.tsx`

**Step 1: Add paste/drop handler to TipTap editor**

In the Editor component's `useEditor` configuration, add event handlers for paste and drop:

```typescript
import { Plugin, PluginKey } from "@tiptap/pm/state";

// Inside the useEditor config, add a custom extension or plugin:
const imagePastePlugin = new Plugin({
  key: new PluginKey("imagePaste"),
  props: {
    handlePaste(view, event) {
      const items = event.clipboardData?.items;
      if (!items) return false;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          event.preventDefault();
          const file = item.getAsFile();
          if (file) {
            handleImageUpload(file, view);
          }
          return true;
        }
      }
      return false;
    },
    handleDrop(view, event) {
      const files = event.dataTransfer?.files;
      if (!files || files.length === 0) return false;
      for (const file of files) {
        if (file.type.startsWith("image/")) {
          event.preventDefault();
          handleImageUpload(file, view);
          return true;
        }
      }
      return false;
    },
  },
});
```

The `handleImageUpload` function:
1. Calls `api.images.upload(projectId, file)`
2. On success, inserts an image node at the drop/paste position: `editor.chain().setImage({ src: '/api/images/' + image.id, alt: image.alt_text }).run()`
3. On failure, shows a toast/announcement via the `aria-live` region

The Editor component needs the `projectId` prop to know where to upload.

**Step 2: Test manually in browser**

Start dev server: `make dev`
- Paste an image from clipboard into the editor → should upload and insert
- Drag a file onto the editor → should upload and insert
- Paste/drag a non-image → should be ignored

**Step 3: Commit**

```
feat(images): add paste and drop image upload to editor
```

---

## Task 14: Export Pipeline — Image Embedding

**Files:**
- Modify: `packages/server/src/export/export.service.ts`
- Modify: `packages/server/src/export/export.renderers.ts`
- Modify: `packages/server/src/export/docx.renderer.ts`
- Modify: `packages/server/src/export/epub.renderer.ts`
- Create: `packages/server/src/export/image-resolver.ts`
- Create: `packages/server/src/__tests__/export.images.test.ts`

**Step 1: Write failing tests**

Create `packages/server/src/__tests__/export.images.test.ts`:

- Export HTML with image in chapter content → image src is base64 data URI
- Export Markdown with image → `![alt](data:...)` or path reference
- Export plaintext with image → `[Image: alt text]`
- Export DOCX with image → verify buffer contains the image (check DOCX structure)
- Export EPUB with image → verify EPUB contains image in manifest
- Export EPUB with cover image → verify cover is set

**Step 2: Run tests to verify they fail**

Run: `npm test -w packages/server -- --run -t "export.images"`
Expected: FAIL

**Step 3: Create image resolver**

Create `packages/server/src/export/image-resolver.ts`:

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import * as imagesRepo from "../images/images.repository";
import { getDb } from "../db/connection";

export interface ResolvedImage {
  id: string;
  data: Buffer;
  mimeType: string;
  altText: string;
  caption: string;
  source: string;
  license: string;
}

function getDataDir(): string {
  return process.env.DATA_DIR ?? path.join(__dirname, "../../data");
}

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png",
    "image/gif": "gif", "image/webp": "webp",
  };
  return map[mime] ?? "bin";
}

export async function resolveImage(imageId: string): Promise<ResolvedImage | null> {
  const db = getDb();
  const row = await imagesRepo.findById(db, imageId);
  if (!row) return null;

  const dataDir = getDataDir();
  const ext = mimeToExt(row.mime_type);
  const filePath = path.join(dataDir, "images", row.project_id, `${row.id}.${ext}`);

  try {
    const data = await fs.readFile(filePath);
    return {
      id: row.id,
      data,
      mimeType: row.mime_type,
      altText: row.alt_text,
      caption: row.caption,
      source: row.source,
      license: row.license,
    };
  } catch {
    return null;
  }
}

/**
 * Extract image IDs from rendered HTML and replace src URLs with resolved data.
 * Used by HTML, DOCX, and EPUB renderers.
 */
export async function resolveImagesInHtml(html: string): Promise<{
  html: string;
  images: Map<string, ResolvedImage>;
}> {
  const images = new Map<string, ResolvedImage>();
  const pattern = /src="\/api\/images\/([0-9a-f-]{36})"/gi;
  const matches = [...html.matchAll(pattern)];

  for (const match of matches) {
    const id = match[1];
    if (!images.has(id)) {
      const resolved = await resolveImage(id);
      if (resolved) images.set(id, resolved);
    }
  }

  let resolvedHtml = html;
  for (const [id, img] of images) {
    const dataUri = `data:${img.mimeType};base64,${img.data.toString("base64")}`;
    resolvedHtml = resolvedHtml.replace(
      new RegExp(`src="/api/images/${id}"`, "gi"),
      `src="${dataUri}"`,
    );
  }

  return { html: resolvedHtml, images };
}
```

**Step 4: Update renderers**

- **HTML renderer** (`export.renderers.ts`): After generating HTML, call `resolveImagesInHtml()` to replace image URLs with base64. Also add `<figure>` wrapper with `<figcaption>` for images that have captions.
- **Markdown renderer**: After converting to markdown, resolve images similarly (replace URLs with data URIs or note format).
- **Plain text renderer**: Walk the TipTap JSON looking for image nodes, insert `[Image: {alt text}]` in place.
- **DOCX renderer** (`docx.renderer.ts`): Handle image nodes in the TipTap JSON walker — create `ImageRun` with the resolved image buffer.
- **EPUB renderer** (`epub.renderer.ts`): After generating chapter HTML, resolve images and include them in the EPUB manifest. Add cover image support.

**Step 5: Update ExportSchema and export service for EPUB cover**

The `ExportSchema` already has `epub_cover_image_id` from Task 2. Pass it through the export service to the EPUB renderer:

```typescript
// In export.service.ts, when calling renderEpub:
case "epub":
  content = await renderEpub(projectInfo, exportChapters, {
    ...options,
    coverImageId: parsed.data.epub_cover_image_id,
  });
  break;
```

**Step 6: Run tests to verify they pass**

Run: `npm test -w packages/server -- --run`
Expected: PASS

**Step 7: Commit**

```
feat(images): add image embedding to all export formats
```

---

## Task 15: EPUB Cover Image in Export Dialog

**Files:**
- Modify: `packages/client/src/components/ExportDialog.tsx`
- Modify: `packages/client/src/strings.ts`

**Step 1: Add strings**

```typescript
export: {
  // ... existing strings ...
  epubCoverImageLabel: "Cover image",
  epubCoverImageNone: "None",
},
```

**Step 2: Add cover image dropdown**

Modify `ExportDialog.tsx`:

1. Add state: `const [epubCoverImageId, setEpubCoverImageId] = useState<string>("")`
2. Fetch project images when format is "epub": `useEffect` that calls `api.images.list(projectId)` when format changes to epub (needs `projectId` prop — currently the dialog has `projectSlug`, so either pass `projectId` as a new prop or fetch the project).

Actually, simpler approach: pass a `projectId` prop to ExportDialog. The parent (EditorPage) already has `project.id`.

3. Render a `<select>` dropdown after the TOC checkbox, only when `format === "epub"`:
   ```tsx
   {format === "epub" && images.length > 0 && (
     <label className="flex items-center gap-2 text-sm text-text-secondary mb-4">
       {STRINGS.export.epubCoverImageLabel}
       <select
         value={epubCoverImageId}
         onChange={(e) => setEpubCoverImageId(e.target.value)}
         className="rounded border border-border/60 bg-bg-primary px-2 py-1 text-sm"
       >
         <option value="">{STRINGS.export.epubCoverImageNone}</option>
         {images.map((img) => (
           <option key={img.id} value={img.id}>
             {img.filename}
           </option>
         ))}
       </select>
     </label>
   )}
   ```

4. Add `epub_cover_image_id` to the export config when set:
   ```typescript
   if (format === "epub" && epubCoverImageId) {
     config.epub_cover_image_id = epubCoverImageId;
   }
   ```

**Step 3: Run client tests**

Run: `npm test -w packages/client -- --run`
Expected: PASS

**Step 4: Commit**

```
feat(images): add EPUB cover image selection to export dialog
```

---

## Task 16: Dependency License Audit

**Files:**
- Modify: `docs/dependency-licenses.md`

**Step 1: Check licenses of new dependencies**

New dependencies added:
- `multer` — MIT
- `@types/multer` — MIT (devDependency)
- `@tiptap/extension-image` — MIT

**Step 2: Add entries to the license file**

Add rows for each new dependency in `docs/dependency-licenses.md`, following the existing format.

**Step 3: Commit**

```
docs: add multer and @tiptap/extension-image to dependency license audit
```

---

## Task 17: End-to-End Tests

**Files:**
- Create: `e2e/images.spec.ts`

**Step 1: Write e2e tests using Playwright**

Test scenarios:
1. **Upload via gallery** — Open reference panel, click upload, select image, verify it appears in grid
2. **Paste into editor** — Copy image to clipboard (or use Playwright's `page.evaluate` to simulate paste), verify image appears in editor and gallery
3. **Insert from gallery** — Upload image, click "Insert at cursor", verify image appears in editor
4. **Metadata editing** — Upload image, click thumbnail, fill in alt text/caption/source/license, save, verify fields persist
5. **Deletion blocked** — Upload image, insert into editor, try to delete from gallery, verify 409 message with chapter name
6. **Deletion allowed** — Upload image (don't insert), delete from gallery, verify it disappears
7. **Panel resize** — Open panel, drag resize handle, close and reopen, verify width persists
8. **Panel toggle** — Click toggle button, verify panel opens/closes; use Ctrl+. shortcut
9. **aXe accessibility** — Run aXe-core on the page with the panel open

**Step 2: Run e2e tests**

Run: `make e2e`
Expected: PASS

**Step 3: Commit**

```
test(e2e): add end-to-end tests for reference panel and image gallery
```

---

## Task 18: Coverage Check and Final Cleanup

**Step 1: Run full test suite with coverage**

Run: `make cover`

Check that coverage thresholds are met (95% statements, 85% branches, 90% functions, 95% lines). If not, identify uncovered code paths and add targeted tests.

**Step 2: Run full CI pass**

Run: `make all`

This runs lint + format + typecheck + coverage + e2e. Fix any issues.

**Step 3: Commit any final fixes**

```
chore: fix lint/coverage issues from Phase 4a implementation
```

---

## Task Summary

| # | Task | Scope |
|---|------|-------|
| 1 | Database migration | Server |
| 2 | Types, repository, Zod schema | Server + Shared |
| 3 | Image service (CRUD) | Server |
| 4 | Reference counting in chapter save | Server |
| 5 | Image routes (API endpoints) | Server |
| 6 | Image purge on project deletion | Server |
| 7 | TipTap Image extension | Client + Server |
| 8 | Client API layer | Client |
| 9 | useReferencePanelState hook | Client |
| 10 | ReferencePanel component | Client |
| 11 | ImageGallery component | Client |
| 12 | Wire panel into EditorPage | Client |
| 13 | Paste/drop image into editor | Client |
| 14 | Export pipeline — image embedding | Server |
| 15 | EPUB cover image in export dialog | Client |
| 16 | Dependency license audit | Docs |
| 17 | End-to-end tests | E2e |
| 18 | Coverage check and final cleanup | All |

Tasks 1–6 are server-only and can be built without touching the client. Tasks 7–13 are the client integration. Task 14 is server export updates. Tasks 15–18 are polish and verification.
