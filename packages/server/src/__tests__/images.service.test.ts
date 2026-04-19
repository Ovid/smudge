import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { setupTestDb } from "./test-helpers";
import * as imagesService from "../images/images.service";
import { logger } from "../logger";
import { getImagePath, mimeToExt } from "../images/images.paths";

const TEST_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const t = setupTestDb();

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
  });

  describe("getImage()", () => {
    it("returns image by id", async () => {
      const projectId = await createTestProject();
      const uploadResult = await imagesService.uploadImage(projectId, {
        buffer: TEST_PNG,
        originalname: "test.png",
        mimetype: "image/png",
        size: TEST_PNG.length,
      });
      const imageId = (uploadResult as { image: { id: string } }).image.id;

      const image = await imagesService.getImage(imageId);
      expect(image).not.toBeNull();
      expect(image!.id).toBe(imageId);
    });

    it("returns null for non-existent image", async () => {
      const image = await imagesService.getImage("00000000-0000-0000-0000-000000000000");
      expect(image).toBeNull();
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
      const image = await imagesService.getImage(imageId);
      expect(image).toBeNull();

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
      const image = await imagesService.getImage(imageId);
      expect(image).not.toBeNull();
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
      const image = await imagesService.getImage(imageId);
      expect(image).not.toBeNull();
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
