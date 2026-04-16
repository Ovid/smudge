import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { validateMagicBytes, mimeToExt, getImagePath, getDataDir } from "../images/images.paths";

describe("images.paths", () => {
  describe("validateMagicBytes()", () => {
    it("returns false for a buffer shorter than 12 bytes", () => {
      expect(validateMagicBytes(Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg")).toBe(false);
    });

    it("validates JPEG magic bytes", () => {
      const buf = Buffer.alloc(16);
      buf[0] = 0xff;
      buf[1] = 0xd8;
      buf[2] = 0xff;
      expect(validateMagicBytes(buf, "image/jpeg")).toBe(true);
    });

    it("rejects wrong magic bytes for JPEG", () => {
      const buf = Buffer.alloc(16);
      expect(validateMagicBytes(buf, "image/jpeg")).toBe(false);
    });

    it("validates PNG magic bytes", () => {
      const buf = Buffer.alloc(16);
      buf[0] = 0x89;
      buf[1] = 0x50;
      buf[2] = 0x4e;
      buf[3] = 0x47;
      expect(validateMagicBytes(buf, "image/png")).toBe(true);
    });

    it("validates GIF magic bytes", () => {
      const buf = Buffer.alloc(16);
      buf[0] = 0x47;
      buf[1] = 0x49;
      buf[2] = 0x46;
      buf[3] = 0x38;
      expect(validateMagicBytes(buf, "image/gif")).toBe(true);
    });

    it("rejects wrong magic bytes for GIF", () => {
      const buf = Buffer.alloc(16);
      expect(validateMagicBytes(buf, "image/gif")).toBe(false);
    });

    it("validates WebP magic bytes (RIFF....WEBP)", () => {
      const buf = Buffer.alloc(16);
      // RIFF
      buf[0] = 0x52;
      buf[1] = 0x49;
      buf[2] = 0x46;
      buf[3] = 0x46;
      // WEBP at offset 8
      buf[8] = 0x57;
      buf[9] = 0x45;
      buf[10] = 0x42;
      buf[11] = 0x50;
      expect(validateMagicBytes(buf, "image/webp")).toBe(true);
    });

    it("rejects wrong magic bytes for WebP", () => {
      const buf = Buffer.alloc(16);
      expect(validateMagicBytes(buf, "image/webp")).toBe(false);
    });

    it("returns false for unknown MIME type", () => {
      const buf = Buffer.alloc(16);
      expect(validateMagicBytes(buf, "image/bmp")).toBe(false);
    });
  });

  describe("mimeToExt()", () => {
    it("returns jpg for image/jpeg", () => {
      expect(mimeToExt("image/jpeg")).toBe("jpg");
    });

    it("returns png for image/png", () => {
      expect(mimeToExt("image/png")).toBe("png");
    });

    it("returns gif for image/gif", () => {
      expect(mimeToExt("image/gif")).toBe("gif");
    });

    it("returns webp for image/webp", () => {
      expect(mimeToExt("image/webp")).toBe("webp");
    });

    it("returns null for unknown MIME type", () => {
      expect(mimeToExt("image/bmp")).toBeNull();
    });
  });

  describe("getImagePath()", () => {
    it("returns a path with the correct structure", () => {
      const p = getImagePath("proj-id", "img-id", "png");
      expect(p).toContain("images");
      expect(p).toContain("proj-id");
      expect(p).toContain("img-id.png");
    });
  });

  describe("getDataDir()", () => {
    let originalDataDir: string | undefined;

    beforeAll(() => {
      originalDataDir = process.env.DATA_DIR;
    });

    afterAll(() => {
      if (originalDataDir !== undefined) {
        process.env.DATA_DIR = originalDataDir;
      } else {
        delete process.env.DATA_DIR;
      }
    });

    it("returns DATA_DIR env when set", () => {
      process.env.DATA_DIR = "/custom/data";
      expect(getDataDir()).toBe("/custom/data");
    });

    it("returns default path when DATA_DIR is not set", () => {
      delete process.env.DATA_DIR;
      const dir = getDataDir();
      expect(dir).toContain("data");
    });
  });
});
