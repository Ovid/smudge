import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtemp, rm, unlink, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { setupTestDb } from "./test-helpers";
import * as imagesService from "../images/images.service";
import { logger } from "../logger";
import { getImagePath, mimeToExt } from "../images/images.paths";
import { setProjectStore, getProjectStore } from "../stores/project-store.injectable";
import { SqliteProjectStore } from "../stores";
import * as ImagesRepo from "../images/images.repository";

const TEST_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const t = setupTestDb();

// S4 (review 2026-08-16): one test plants a trigger that deletes an image row
// on UPDATE, to drive a read-after-write miss. `setupTestDb` builds ONE
// `:memory:` DB per file in `beforeAll` and never resets schema between tests,
// so a trigger that outlives its test silently rewrites every later
// `UPDATE images` — six deleteImage() tests break, pointing at the wrong place.
// A `finally` in the planting test is not enough: a timeout or an unhandled
// rejection skips it. Dropping unconditionally here is the only placement that
// survives an abandoned test body.
afterEach(async () => {
  await t.db.raw("DROP TRIGGER IF EXISTS images_vanish_after_update;");
  // Same rationale as above for the F-12 read-after-INSERT trigger.
  await t.db.raw("DROP TRIGGER IF EXISTS images_shift_id_after_insert;");
});

let tempDir: string;
let originalDataDir: string | undefined;

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "smudge-images-test-"));
  originalDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;
});

afterAll(async () => {
  if (originalDataDir !== undefined) {
    process.env.DATA_DIR = originalDataDir;
  } else {
    delete process.env.DATA_DIR;
  }
  await rm(tempDir, { recursive: true, force: true });
});

async function createTestProject(): Promise<string> {
  const res = await request(t.app)
    .post("/api/projects")
    .send({ title: "Test Project", mode: "fiction" });
  return res.body.id;
}

describe("images.service", () => {
  describe("uploadImage()", () => {
    it("keeps the file when the row committed but could not be read back (F-12)", async () => {
      // uploadImage inserts OUTSIDE any transaction, so a failed read-back
      // means the row auto-committed. The cleanup used to unlink the file
      // unconditionally, on a comment asserting "the DB insert failed" — which
      // is exactly wrong for this one error. That turned a recoverable glitch
      // into a committed image row pointing at a file that no longer exists.
      const projectId = await createTestProject();
      // Make the confirming SELECT miss WITHOUT removing the row.
      await t.db.raw(`CREATE TRIGGER images_shift_id_after_insert AFTER INSERT ON images
        BEGIN UPDATE images SET id = id || '-x' WHERE id = NEW.id; END`);

      await expect(
        imagesService.uploadImage(projectId, {
          buffer: TEST_PNG,
          originalname: "committed.png",
          mimetype: "image/png",
          size: TEST_PNG.length,
        } as Parameters<typeof imagesService.uploadImage>[1]),
      ).rejects.toMatchObject({ code: "READ_AFTER_INSERT_FAILURE" });

      // The row really is there...
      const rows = await t.db("images").where({ project_id: projectId });
      expect(rows).toHaveLength(1);
      // ...so its bytes must still be there too.
      const dir = path.dirname(getImagePath(projectId, "x", "png"));
      await expect(readdir(dir)).resolves.toHaveLength(1);
    });

    it("keeps the file when the confirming read THROWS rather than missing (I3)", async () => {
      // The guard above discriminates on error identity, but the fact that
      // decides whether the file may be unlinked is "did the INSERT land" —
      // and outside a transaction it always has by the time the re-read runs.
      // A re-read that throws (SQLITE_BUSY, an I/O error, or most plausibly
      // `Knex: Timeout acquiring a connection` — the pool is max:1 and the
      // connection is released between the two statements) is the same
      // committed row, and unlinking there is the identical corruption.
      const projectId = await createTestProject();
      const boom = new Error("Knex: Timeout acquiring a connection. The pool is probably full.");
      // Real SQLite for everything except the one confirming SELECT: the
      // INSERT genuinely commits, exactly as it does in production.
      const failingReadBack = new Proxy(t.db, {
        apply(target, thisArg, args: unknown[]) {
          const qb = Reflect.apply(target as never, thisArg, args) as unknown;
          if (args[0] !== "images") return qb;
          return {
            insert: (data: unknown) => t.db("images").insert(data as never),
            where: () => ({ first: () => Promise.reject(boom) }),
          };
        },
      }) as unknown as typeof t.db;

      setProjectStore(new SqliteProjectStore(failingReadBack));
      try {
        await expect(
          imagesService.uploadImage(projectId, {
            buffer: TEST_PNG,
            originalname: "throwing.png",
            mimetype: "image/png",
            size: TEST_PNG.length,
          } as Parameters<typeof imagesService.uploadImage>[1]),
        ).rejects.toMatchObject({ code: "READ_AFTER_INSERT_FAILURE" });
      } finally {
        setProjectStore(new SqliteProjectStore(t.db));
      }

      // The row committed...
      const rows = await t.db("images").where({ project_id: projectId });
      expect(rows).toHaveLength(1);
      // ...so its bytes must still be on disk.
      const dir = path.dirname(getImagePath(projectId, "x", "png"));
      await expect(readdir(dir)).resolves.toHaveLength(1);
      // The original failure is preserved for the operator.
      await expect(
        ImagesRepo.insert(failingReadBack, {
          id: "probe",
          project_id: projectId,
          filename: "probe.png",
          mime_type: "image/png",
          size_bytes: 1,
          created_at: new Date().toISOString(),
        }),
      ).rejects.toMatchObject({ cause: boom });
    });

    it("uploads a valid image and returns the record", async () => {
      const projectId = await createTestProject();
      const result = await imagesService.uploadImage(projectId, {
        buffer: TEST_PNG,
        originalname: "test.png",
        mimetype: "image/png",
        size: TEST_PNG.length,
      });

      expect(result).toHaveProperty("image");
      expect(result).not.toHaveProperty("validationError");
      expect(result).not.toHaveProperty("notFound");

      const image = (result as { image: imagesService.UploadResult["image"] }).image!;
      expect(image.project_id).toBe(projectId);
      expect(image.filename).toBe("test.png");
      expect(image.mime_type).toBe("image/png");
      expect(image.size_bytes).toBe(TEST_PNG.length);
      expect(image.reference_count).toBe(0);
      expect(image.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it("returns validationError for invalid MIME type", async () => {
      const projectId = await createTestProject();
      const result = await imagesService.uploadImage(projectId, {
        buffer: Buffer.from("not an image"),
        originalname: "test.txt",
        mimetype: "text/plain",
        size: 12,
      });

      expect(result).toHaveProperty("validationError");
      expect((result as { validationError: string }).validationError).toContain("MIME");
    });

    it("returns validationError for oversized file", async () => {
      const projectId = await createTestProject();
      const result = await imagesService.uploadImage(projectId, {
        buffer: TEST_PNG,
        originalname: "big.png",
        mimetype: "image/png",
        size: 11 * 1024 * 1024, // 11 MB
      });

      expect(result).toHaveProperty("validationError");
      expect((result as { validationError: string }).validationError).toContain("10");
    });

    it("strips path components from uploaded filename", async () => {
      const projectId = await createTestProject();
      const result = await imagesService.uploadImage(projectId, {
        buffer: TEST_PNG,
        originalname: "../../../etc/passwd.png",
        mimetype: "image/png",
        size: TEST_PNG.length,
      });

      const image = (result as { image: { filename: string } }).image;
      expect(image.filename).toBe("passwd.png");
    });

    it("returns validationError for zero-byte file", async () => {
      const projectId = await createTestProject();
      const result = await imagesService.uploadImage(projectId, {
        buffer: Buffer.alloc(0),
        originalname: "empty.png",
        mimetype: "image/png",
        size: 0,
      });

      expect(result).toHaveProperty("validationError");
      expect((result as { validationError: string }).validationError).toBe("File is empty");
    });

    it("returns validationError when content does not match the declared MIME type", async () => {
      // Declared image/png but the buffer lacks the PNG magic bytes — a
      // mismatched/spoofed upload must be rejected by the magic-byte check.
      const projectId = await createTestProject();
      const result = await imagesService.uploadImage(projectId, {
        buffer: Buffer.from("this is plain text, not a PNG"),
        originalname: "fake.png",
        mimetype: "image/png",
        size: 29,
      });

      expect(result).toHaveProperty("validationError");
      expect((result as { validationError: string }).validationError).toContain(
        "does not match declared type",
      );
    });

    it("returns notFound for non-existent project", async () => {
      const result = await imagesService.uploadImage("00000000-0000-0000-0000-000000000000", {
        buffer: TEST_PNG,
        originalname: "test.png",
        mimetype: "image/png",
        size: TEST_PNG.length,
      });

      expect(result).toHaveProperty("notFound", true);
    });
  });

  describe("listImages()", () => {
    it("returns empty array when no images exist", async () => {
      const projectId = await createTestProject();
      const images = await imagesService.listImages(projectId);
      expect(images).toEqual([]);
    });

    it("returns images for a project", async () => {
      const projectId = await createTestProject();
      await imagesService.uploadImage(projectId, {
        buffer: TEST_PNG,
        originalname: "a.png",
        mimetype: "image/png",
        size: TEST_PNG.length,
      });
      await imagesService.uploadImage(projectId, {
        buffer: TEST_PNG,
        originalname: "b.png",
        mimetype: "image/png",
        size: TEST_PNG.length,
      });

      const images = await imagesService.listImages(projectId);
      expect(images).toHaveLength(2);
    });

    // Safety net for F-29. Both cases above use a live project, so
    // `if (!project) return null` had no service-level coverage. The route
    // test covers a NONEXISTENT project; a soft-deleted one is the case
    // findProjectById's `deleted_at IS NULL` filter exists for, and it is
    // the check F-29 moves inside a transaction with the image read.
    it("returns null when the project is soft-deleted", async () => {
      const projectId = await createTestProject();
      await imagesService.uploadImage(projectId, {
        buffer: TEST_PNG,
        originalname: "a.png",
        mimetype: "image/png",
        size: TEST_PNG.length,
      });

      await t
        .db("projects")
        .where({ id: projectId })
        .update({ deleted_at: new Date().toISOString() });

      expect(await imagesService.listImages(projectId)).toBeNull();
    });

    // F-29 membership. The safety net above passes with or without the
    // transaction — it only pins the ANSWER. This pins the fix: one
    // transaction is opened, and both reads run on the transaction-scoped
    // store, never the captured outer one. The outer-store assertions are the
    // load-bearing half: Knex's better-sqlite3 pool is max:1, so a non-scoped
    // call from inside a transaction starves on the sole connection until
    // timeout rather than failing fast.
    it("runs the liveness check and the image read in one transaction", async () => {
      const projectId = await createTestProject();
      const store = getProjectStore();
      const spies = [
        vi.spyOn(store, "transaction"),
        vi.spyOn(store, "findProjectById"),
        vi.spyOn(store, "listImagesByProject"),
      ];
      try {
        expect(await imagesService.listImages(projectId)).toEqual([]);
        expect(spies[0]).toHaveBeenCalledTimes(1);
        expect(spies[1]).not.toHaveBeenCalled();
        expect(spies[2]).not.toHaveBeenCalled();
      } finally {
        spies.forEach((s) => s.mockRestore());
      }
    });
  });

  describe("serveImage()", () => {
    it("returns buffer and mime type for existing image", async () => {
      const projectId = await createTestProject();
      const uploadResult = await imagesService.uploadImage(projectId, {
        buffer: TEST_PNG,
        originalname: "test.png",
        mimetype: "image/png",
        size: TEST_PNG.length,
      });
      const imageId = (uploadResult as { image: { id: string } }).image.id;

      const result = await imagesService.serveImage(imageId);
      expect(result).not.toBeNull();
      expect(result!.mimeType).toBe("image/png");
      expect(Buffer.isBuffer(result!.data)).toBe(true);
      expect(result!.data.length).toBe(TEST_PNG.length);
    });

    it("returns null for non-existent image", async () => {
      const result = await imagesService.serveImage("00000000-0000-0000-0000-000000000000");
      expect(result).toBeNull();
    });

    it("returns null when image file is missing from disk", async () => {
      const logSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
      const projectId = await createTestProject();
      const uploadResult = await imagesService.uploadImage(projectId, {
        buffer: TEST_PNG,
        originalname: "test.png",
        mimetype: "image/png",
        size: TEST_PNG.length,
      });
      const imageId = (uploadResult as { image: { id: string } }).image.id;

      // Delete the file from disk manually
      const ext = mimeToExt("image/png");
      const filePath = getImagePath(projectId, imageId, ext!);
      await unlink(filePath);

      const result = await imagesService.serveImage(imageId);
      expect(result).toBeNull();
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ imageId: imageId }),
        "Failed to read image file from disk",
      );
      logSpy.mockRestore();
    });
  });

  describe("updateImageMetadata()", () => {
    it("updates metadata fields", async () => {
      const projectId = await createTestProject();
      const uploadResult = await imagesService.uploadImage(projectId, {
        buffer: TEST_PNG,
        originalname: "test.png",
        mimetype: "image/png",
        size: TEST_PNG.length,
      });
      const imageId = (uploadResult as { image: { id: string } }).image.id;

      const result = await imagesService.updateImageMetadata(imageId, {
        alt_text: "A test image",
        caption: "Test caption",
      });

      expect(result).toHaveProperty("image");
      const updated = (result as { image: { alt_text: string; caption: string } }).image;
      expect(updated.alt_text).toBe("A test image");
      expect(updated.caption).toBe("Test caption");
    });

    it("returns validationError for empty body", async () => {
      const projectId = await createTestProject();
      const uploadResult = await imagesService.uploadImage(projectId, {
        buffer: TEST_PNG,
        originalname: "test.png",
        mimetype: "image/png",
        size: TEST_PNG.length,
      });
      const imageId = (uploadResult as { image: { id: string } }).image.id;

      const result = await imagesService.updateImageMetadata(imageId, {});
      expect(result).toHaveProperty("validationError");
    });

    it("returns notFound for non-existent image", async () => {
      const result = await imagesService.updateImageMetadata(
        "00000000-0000-0000-0000-000000000000",
        { alt_text: "test" },
      );
      expect(result).toHaveProperty("notFound", true);
    });

    it("returns notFound when the row disappears between the update and the re-read", async () => {
      const projectId = await createTestProject();
      const uploadResult = await imagesService.uploadImage(projectId, {
        buffer: TEST_PNG,
        originalname: "test.png",
        mimetype: "image/png",
        size: TEST_PNG.length,
      });
      const imageId = (uploadResult as { image: { id: string } }).image.id;

      // Drive the re-read-returns-nothing arm from the DB rather than by
      // spying on a store method: the service's read-after-write may run on
      // the outer store or on a transaction's txStore, and a trigger fires
      // for both. Keeps this test shape-independent.
      await t.db.raw(
        `CREATE TRIGGER images_vanish_after_update AFTER UPDATE ON images
         BEGIN DELETE FROM images WHERE id = NEW.id; END;`,
      );
      const result = await imagesService.updateImageMetadata(imageId, {
        alt_text: "A test image",
      });
      // S2 (review 2026-08-16): NOT `notFound`. The existence check already
      // passed and the UPDATE already ran inside this transaction, so "not
      // found" would tell the client the image never existed when the write
      // in fact landed. Mirrors chapters.service.updateChapter's
      // "read_failure" → 500 UPDATE_READ_FAILURE, which the client's
      // committed-UX machinery understands.
      expect(result).toHaveProperty("readFailure", true);
    });
  });

  describe("deleteImage()", () => {
    it("deletes unreferenced image and removes file", async () => {
      const projectId = await createTestProject();
      const uploadResult = await imagesService.uploadImage(projectId, {
        buffer: TEST_PNG,
        originalname: "test.png",
        mimetype: "image/png",
        size: TEST_PNG.length,
      });
      const imageId = (uploadResult as { image: { id: string } }).image.id;

      const result = await imagesService.deleteImage(imageId);
      expect(result).toEqual({ deleted: true });

      // Verify image is gone from DB
      const image = await t.db("images").where({ id: imageId }).first();
      expect(image).toBeUndefined();

      // Verify file is gone from disk
      const serveResult = await imagesService.serveImage(imageId);
      expect(serveResult).toBeNull();
    });

    it("returns notFound for non-existent image", async () => {
      const result = await imagesService.deleteImage("00000000-0000-0000-0000-000000000000");
      expect(result).toHaveProperty("notFound", true);
    });

    it("handles file already missing from disk during delete (unlink fails gracefully)", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const projectId = await createTestProject();
      const uploadResult = await imagesService.uploadImage(projectId, {
        buffer: TEST_PNG,
        originalname: "test.png",
        mimetype: "image/png",
        size: TEST_PNG.length,
      });
      const imageId = (uploadResult as { image: { id: string } }).image.id;

      // Delete the file from disk first
      const ext = mimeToExt("image/png");
      const filePath = getImagePath(projectId, imageId, ext!);
      await unlink(filePath);

      // Now deleteImage — the unlink inside should fail but not throw
      const result = await imagesService.deleteImage(imageId);
      expect(result).toEqual({ deleted: true });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ imageId: imageId }),
        "Failed to delete image file from disk",
      );
      warnSpy.mockRestore();
    });

    it("warns when image has unknown MIME type and cannot determine extension for cleanup", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const projectId = await createTestProject();
      const uploadResult = await imagesService.uploadImage(projectId, {
        buffer: TEST_PNG,
        originalname: "test.png",
        mimetype: "image/png",
        size: TEST_PNG.length,
      });
      const imageId = (uploadResult as { image: { id: string } }).image.id;

      // Corrupt the mime_type in the DB to something mimeToExt won't recognize
      await t.db("images").where({ id: imageId }).update({ mime_type: "image/tiff" });

      const result = await imagesService.deleteImage(imageId);
      expect(result).toEqual({ deleted: true });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ imageId: imageId, mimeType: "image/tiff" }),
        "Could not determine extension for deleted image; file left on disk",
      );
      warnSpy.mockRestore();
    });

    it("returns referenced when image is used in a chapter", async () => {
      const projectId = await createTestProject();
      const uploadResult = await imagesService.uploadImage(projectId, {
        buffer: TEST_PNG,
        originalname: "test.png",
        mimetype: "image/png",
        size: TEST_PNG.length,
      });
      const imageId = (uploadResult as { image: { id: string } }).image.id;

      // Get the auto-created chapter via the project slug
      const projectRes = await request(t.app).get("/api/projects");
      const project = projectRes.body[0];
      const projectDetail = await request(t.app).get(`/api/projects/${project.slug}`);
      const chapterId = projectDetail.body.chapters[0].id;

      // Save chapter with content referencing the image
      await request(t.app)
        .patch(`/api/chapters/${chapterId}`)
        .send({
          content: {
            type: "doc",
            content: [{ type: "image", attrs: { src: `/api/images/${imageId}` } }],
          },
        });

      const result = await imagesService.deleteImage(imageId);
      expect(result).toHaveProperty("referenced");
      const referenced = (result as { referenced: Array<{ id: string; title: string }> })
        .referenced;
      expect(referenced).toHaveLength(1);
      expect(referenced[0]!.id).toBe(chapterId);

      // Verify image still exists
      const image = await t.db("images").where({ id: imageId }).first();
      expect(image).toBeDefined();
    });

    // OOSI2 (agentic-review 2026-08-05): deleteImage decides between 409-blocked
    // and 204-deleted by parsing every chapter. A chapter whose content does not
    // parse was skipped by an empty catch — no log, no counter — so the scan
    // could not tell "nothing references this image" from "one chapter was never
    // read". The image row AND its bytes then went permanently, while the
    // corrupt chapter is itself repairable (chapters.repository flags it
    // content_corrupt and there is a designed CORRUPT_CONTENT route) — so the
    // repair yields a chapter with a permanently broken image. This is the one
    // place in the image lifecycle where a read failure produces an
    // irreversible write.
    //
    // OOSS1 (agentic review 2026-08-17): the last two rows are the same class
    // one level in. `isTipTapNode` accepts any non-array object, so a document
    // whose `content` is an OBJECT rather than a list passed the gate — and the
    // walker then declined to descend (it requires an array), returning [] and
    // answering "no-reference" for a chapter that is displaying the image. The
    // nested variant is the one that matters: the walker's array test is inside
    // the recursion, so the blindness applies at every depth. It was also
    // API-writable until ff8f7903 (2026-08-04) tightened the depth walker, and
    // remains reachable through a backup restore, which swaps the database file
    // in without validation.
    it.each([
      ["unparseable JSON", "not json {"],
      ["JSON that is not an object", "42"],
      [
        "a document whose content container is an object, not a list",
        '{"type":"doc","content":{"type":"image","attrs":{"src":"/api/images/IMAGE_ID"}}}',
      ],
      [
        "a document with an object content container one level down",
        '{"type":"doc","content":[{"type":"paragraph","content":{"type":"image","attrs":{"src":"/api/images/IMAGE_ID"}}}]}',
      ],
    ])("blocks the delete when a chapter's content is %s (OOSI2)", async (_label, stored) => {
      const projectId = await createTestProject();
      const uploadResult = await imagesService.uploadImage(projectId, {
        buffer: TEST_PNG,
        originalname: "test.png",
        mimetype: "image/png",
        size: TEST_PNG.length,
      });
      const imageId = (uploadResult as { image: { id: string } }).image.id;

      const projectRes = await request(t.app).get("/api/projects");
      const projectDetail = await request(t.app).get(`/api/projects/${projectRes.body[0].slug}`);
      const chapterId = projectDetail.body.chapters[0].id;
      // Bypass the API so the row really is unreadable.
      await t
        .db("chapters")
        .where({ id: chapterId })
        .update({ content: stored.replace(/IMAGE_ID/g, imageId) });

      const result = await imagesService.deleteImage(imageId);

      expect(result).toHaveProperty("referenced");
      const referenced = (result as { referenced: Array<{ id: string }> }).referenced;
      expect(referenced.map((c) => c.id)).toEqual([chapterId]);
      expect(await t.db("images").where({ id: imageId }).first()).toBeDefined();
    });

    it("includes trashed flag for soft-deleted chapters in referenced response", async () => {
      const projectId = await createTestProject();
      const uploadResult = await imagesService.uploadImage(projectId, {
        buffer: TEST_PNG,
        originalname: "test.png",
        mimetype: "image/png",
        size: TEST_PNG.length,
      });
      const imageId = (uploadResult as { image: { id: string } }).image.id;

      // Get the auto-created chapter
      const projectRes = await request(t.app).get("/api/projects");
      const project = projectRes.body[0];
      const projectDetail = await request(t.app).get(`/api/projects/${project.slug}`);
      const chapterId = projectDetail.body.chapters[0].id;

      // Save chapter with content referencing the image
      await request(t.app)
        .patch(`/api/chapters/${chapterId}`)
        .send({
          content: {
            type: "doc",
            content: [{ type: "image", attrs: { src: `/api/images/${imageId}` } }],
          },
        });

      // Soft-delete the chapter
      await request(t.app).delete(`/api/chapters/${chapterId}`);

      const result = await imagesService.deleteImage(imageId);
      expect(result).toHaveProperty("referenced");
      const referenced = (
        result as { referenced: Array<{ id: string; title: string; trashed: boolean }> }
      ).referenced;
      expect(referenced).toHaveLength(1);
      expect(referenced[0]!.trashed).toBe(true);
    });

    it("does not set reference_count to 0 when blocked by soft-deleted chapters only", async () => {
      const projectId = await createTestProject();
      const uploadResult = await imagesService.uploadImage(projectId, {
        buffer: TEST_PNG,
        originalname: "test.png",
        mimetype: "image/png",
        size: TEST_PNG.length,
      });
      const imageId = (uploadResult as { image: { id: string } }).image.id;

      // Get the auto-created chapter
      const projectRes = await request(t.app).get("/api/projects");
      const project = projectRes.body[0];
      const projectDetail = await request(t.app).get(`/api/projects/${project.slug}`);
      const chapterId = projectDetail.body.chapters[0].id;

      // Save chapter with content referencing the image (increments ref count to 1)
      await request(t.app)
        .patch(`/api/chapters/${chapterId}`)
        .send({
          content: {
            type: "doc",
            content: [{ type: "image", attrs: { src: `/api/images/${imageId}` } }],
          },
        });

      // Soft-delete the chapter (decrements ref count to 0)
      await request(t.app).delete(`/api/chapters/${chapterId}`);

      // Attempt to delete the image — blocked by trashed chapter
      const result = await imagesService.deleteImage(imageId);
      expect(result).toHaveProperty("referenced");

      // ref_count should be corrected to 0 (only active chapters count)
      const image = await t.db("images").where({ id: imageId }).first();
      expect(image).toBeDefined();
      expect(image!.reference_count).toBe(0);
    });
  });

  describe("getImageReferences()", () => {
    it("returns empty chapters array for existing image", async () => {
      const projectId = await createTestProject();
      const uploadResult = await imagesService.uploadImage(projectId, {
        buffer: TEST_PNG,
        originalname: "test.png",
        mimetype: "image/png",
        size: TEST_PNG.length,
      });
      const imageId = (uploadResult as { image: { id: string } }).image.id;

      const result = await imagesService.getImageReferences(imageId);
      expect(result).toEqual({ chapters: [] });
    });

    it("returns notFound for non-existent image", async () => {
      const result = await imagesService.getImageReferences("00000000-0000-0000-0000-000000000000");
      expect(result).toHaveProperty("notFound", true);
    });
  });
});
