import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { setupTestDb } from "./test-helpers";
import { vi } from "vitest";
import {
  extractImageIds,
  diffImageReferences,
  scanImageReferences,
  applyImageRefDiff,
} from "../images/images.references";
import { logger } from "../logger";
import * as imagesService from "../images/images.service";
import type { ImageRow } from "../images/images.types";

const TEST_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

// --- Unit tests (no DB needed) ---

describe("extractImageIds()", () => {
  it("returns empty array for null content", () => {
    expect(extractImageIds(null)).toEqual([]);
  });

  it("returns empty array for content with no images", () => {
    const content = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
    };
    expect(extractImageIds(content)).toEqual([]);
  });

  it("extracts UUID from /api/images/{uuid} in TipTap image nodes", () => {
    const content = {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: { src: "/api/images/a1b2c3d4-e5f6-7890-abcd-ef1234567890" },
        },
      ],
    };
    expect(extractImageIds(content)).toEqual(["a1b2c3d4-e5f6-7890-abcd-ef1234567890"]);
  });

  it("handles multiple images in nested content", () => {
    const content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "image",
              attrs: { src: "/api/images/11111111-1111-1111-1111-111111111111" },
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "image",
              attrs: { src: "/api/images/22222222-2222-2222-2222-222222222222" },
            },
          ],
        },
      ],
    };
    const ids = extractImageIds(content);
    expect(ids).toHaveLength(2);
    expect(ids).toContain("11111111-1111-1111-1111-111111111111");
    expect(ids).toContain("22222222-2222-2222-2222-222222222222");
  });

  it("deduplicates same image referenced twice", () => {
    const uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const content = {
      type: "doc",
      content: [
        { type: "image", attrs: { src: `/api/images/${uuid}` } },
        { type: "image", attrs: { src: `/api/images/${uuid}` } },
      ],
    };
    expect(extractImageIds(content)).toEqual([uuid]);
  });

  it("ignores non-image node types", () => {
    const content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { src: "/api/images/a1b2c3d4-e5f6-7890-abcd-ef1234567890" },
        },
      ],
    };
    expect(extractImageIds(content)).toEqual([]);
  });

  it("ignores image nodes with non-matching src URLs", () => {
    const content = {
      type: "doc",
      content: [
        { type: "image", attrs: { src: "https://example.com/photo.jpg" } },
        { type: "image", attrs: { src: "/uploads/photo.png" } },
      ],
    };
    expect(extractImageIds(content)).toEqual([]);
  });
});

describe("diffImageReferences()", () => {
  it("returns empty added/removed for identical sets", () => {
    const ids = ["11111111-1111-1111-1111-111111111111"];
    expect(diffImageReferences(ids, ids)).toEqual({ added: [], removed: [] });
  });

  it("returns correct added/removed for changes", () => {
    const oldIds = ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"];
    const newIds = ["22222222-2222-2222-2222-222222222222", "33333333-3333-3333-3333-333333333333"];
    const result = diffImageReferences(oldIds, newIds);
    expect(result.added).toEqual(["33333333-3333-3333-3333-333333333333"]);
    expect(result.removed).toEqual(["11111111-1111-1111-1111-111111111111"]);
  });

  it("handles first save (old is empty)", () => {
    const newIds = ["11111111-1111-1111-1111-111111111111"];
    const result = diffImageReferences([], newIds);
    expect(result.added).toEqual(["11111111-1111-1111-1111-111111111111"]);
    expect(result.removed).toEqual([]);
  });

  it("handles removing all images (new is empty)", () => {
    const oldIds = ["11111111-1111-1111-1111-111111111111"];
    const result = diffImageReferences(oldIds, []);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual(["11111111-1111-1111-1111-111111111111"]);
  });
});

// --- Integration tests (need DB) ---

const t = setupTestDb();

let tempDir: string;
let originalDataDir: string | undefined;

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "smudge-imgref-test-"));
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

async function createTestProject(): Promise<{ id: string; slug: string }> {
  const res = await request(t.app)
    .post("/api/projects")
    .send({ title: `Test Project ${Date.now()}`, mode: "fiction" });
  return { id: res.body.id, slug: res.body.slug };
}

async function createTestChapter(projectSlug: string, title = "Chapter 1"): Promise<string> {
  const res = await request(t.app).post(`/api/projects/${projectSlug}/chapters`).send();
  const chapterId = res.body.id;
  // Set title if non-default
  if (title !== "Chapter 1") {
    await request(t.app).patch(`/api/chapters/${chapterId}`).send({ title });
  }
  return chapterId;
}

async function uploadTestImage(projectId: string): Promise<string> {
  const result = await imagesService.uploadImage(projectId, {
    buffer: TEST_PNG,
    originalname: "test.png",
    mimetype: "image/png",
    size: TEST_PNG.length,
  });
  return (result as { image: { id: string } }).image.id;
}

function makeContentWithImage(imageId: string): Record<string, unknown> {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Some text" }],
      },
      {
        type: "image",
        attrs: { src: `/api/images/${imageId}` },
      },
    ],
  };
}

function makeContentWithTwoRefs(imageId: string): Record<string, unknown> {
  return {
    type: "doc",
    content: [
      { type: "image", attrs: { src: `/api/images/${imageId}` } },
      { type: "paragraph", content: [{ type: "text", text: "between" }] },
      { type: "image", attrs: { src: `/api/images/${imageId}` } },
    ],
  };
}

function makeContentNoImages(): Record<string, unknown> {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "No images here" }],
      },
    ],
  };
}

describe("applyImageRefDiff()", () => {
  it("logs a warning and skips increment when the referenced image is gone", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const incrementCalls: Array<[string, number]> = [];
    const missingId = "00000000-0000-0000-0000-000000000000";
    const projectId = "11111111-1111-1111-1111-111111111111";

    await applyImageRefDiff(
      {
        findImageById: async () => null,
        incrementImageReferenceCount: async (id, delta) => {
          incrementCalls.push([id, delta]);
        },
      },
      null,
      JSON.stringify({
        type: "doc",
        content: [{ type: "image", attrs: { src: `/api/images/${missingId}` } }],
      }),
      projectId,
    );

    expect(incrementCalls).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      { image_id: missingId, project_id: projectId, found_in_project: null },
      "Referenced image missing or in different project; skipping reference-count update",
    );
    warnSpy.mockRestore();
  });

  it("skips increment and warns when the referenced image belongs to a different project", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const incrementCalls: Array<[string, number]> = [];
    const imageId = "22222222-2222-2222-2222-222222222222";
    const projectA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const projectB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

    await applyImageRefDiff(
      {
        findImageById: async () =>
          ({
            id: imageId,
            project_id: projectB,
            reference_count: 0,
          }) as unknown as ImageRow,
        incrementImageReferenceCount: async (id, delta) => {
          incrementCalls.push([id, delta]);
        },
      },
      null,
      JSON.stringify({
        type: "doc",
        content: [{ type: "image", attrs: { src: `/api/images/${imageId}` } }],
      }),
      projectA,
    );

    expect(incrementCalls).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      { image_id: imageId, project_id: projectA, found_in_project: projectB },
      "Referenced image missing or in different project; skipping reference-count update",
    );
    warnSpy.mockRestore();
  });
});

describe("scanImageReferences()", () => {
  it("returns empty array when image is not referenced", async () => {
    const { id: projectId, slug } = await createTestProject();
    const imageId = await uploadTestImage(projectId);
    const chapterId = await createTestChapter(slug);

    // Save chapter with content that does NOT reference the image
    await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ content: makeContentNoImages() });

    const result = await scanImageReferences(imageId, projectId);
    expect(result).toEqual([]);
  });

  it("returns chapter list when image is referenced", async () => {
    const { id: projectId, slug } = await createTestProject();
    const imageId = await uploadTestImage(projectId);
    const chapterId = await createTestChapter(slug, "My Chapter");

    await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ content: makeContentWithImage(imageId) });

    const result = await scanImageReferences(imageId, projectId);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(chapterId);
    expect(result[0]!.title).toBe("My Chapter");
  });
});

describe("deleteImage corrects drifted reference_count", () => {
  it("corrects under-count and blocks deletion when image is still referenced", async () => {
    const { id: projectId, slug } = await createTestProject();
    const imageId = await uploadTestImage(projectId);
    const chapterId = await createTestChapter(slug);

    await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ content: makeContentWithImage(imageId) });

    // Manually set reference_count to 0 (drift)
    await t.db("images").where("id", imageId).update({ reference_count: 0 });

    // deleteImage should live-check, correct the count, and block the delete
    const res = await request(t.app).delete(`/api/images/${imageId}`);
    expect(res.status).toBe(409);

    const image = await t.db("images").where("id", imageId).first();
    expect(image.reference_count).toBe(1);
  });

  it("corrects over-count and allows deletion when image is not referenced", async () => {
    const { id: projectId, slug } = await createTestProject();
    const imageId = await uploadTestImage(projectId);
    const chapterId = await createTestChapter(slug);

    await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ content: makeContentNoImages() });

    // Manually set reference_count to 5 (over-count)
    await t.db("images").where("id", imageId).update({ reference_count: 5 });

    // deleteImage should live-check, correct the count, and allow deletion
    const res = await request(t.app).delete(`/api/images/${imageId}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });
});

describe("reference counting through chapter save", () => {
  it("increments reference_count when image is added to chapter content", async () => {
    const { id: projectId, slug } = await createTestProject();
    const imageId = await uploadTestImage(projectId);
    const chapterId = await createTestChapter(slug);

    await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ content: makeContentWithImage(imageId) });

    const image = await t.db("images").where("id", imageId).first();
    expect(image.reference_count).toBe(1);
  });

  it("decrements reference_count when image is removed from chapter content", async () => {
    const { id: projectId, slug } = await createTestProject();
    const imageId = await uploadTestImage(projectId);
    const chapterId = await createTestChapter(slug);

    // First save: add the image
    await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ content: makeContentWithImage(imageId) });

    // Second save: remove the image
    await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ content: makeContentNoImages() });

    const image = await t.db("images").where("id", imageId).first();
    expect(image.reference_count).toBe(0);
  });

  it("counts deduplicated refs per chapter (two refs to same image = 1)", async () => {
    const { id: projectId, slug } = await createTestProject();
    const imageId = await uploadTestImage(projectId);
    const chapterId = await createTestChapter(slug);

    await request(t.app)
      .patch(`/api/chapters/${chapterId}`)
      .send({ content: makeContentWithTwoRefs(imageId) });

    const image = await t.db("images").where("id", imageId).first();
    expect(image.reference_count).toBe(1);
  });
});
