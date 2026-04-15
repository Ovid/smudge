import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import knex, { type Knex } from "knex";
import JSZip from "jszip";
import { createTestKnexConfig } from "../db/knexfile";
import { setDb, closeDb } from "../db/connection";
import { setProjectStore, resetProjectStore } from "../stores/project-store.injectable";
import { SqliteProjectStore } from "../stores";
import * as imagesRepo from "../images/images.repository";
import { resolveImage, resolveImagesInHtml } from "../export/image-resolver";
import { renderHtml, renderMarkdown, renderPlainText } from "../export/export.renderers";
import { renderDocx } from "../export/docx.renderer";
import { renderEpub } from "../export/epub.renderer";
import type { ExportProjectInfo, ExportChapter } from "../export/export.renderers";

vi.mock("../logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Small valid 1x1 PNG
const TEST_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

let testDb: Knex;
let tmpDataDir: string;
let projectId: string;
let imageId: string;
let imageIdWithCaption: string;

function makeChapterWithImage(imgId: string): Record<string, unknown> {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Before image" }] },
      {
        type: "image",
        attrs: { src: `/api/images/${imgId}`, alt: "Test alt" },
      },
      { type: "paragraph", content: [{ type: "text", text: "After image" }] },
    ],
  };
}

const projectInfo: ExportProjectInfo = {
  title: "Image Test Project",
  author_name: "Test Author",
};

beforeAll(async () => {
  testDb = knex(createTestKnexConfig());
  await testDb.migrate.latest();
  await setDb(testDb);
  setProjectStore(new SqliteProjectStore(testDb));

  // Create temp data dir for image files
  tmpDataDir = await mkdtemp(path.join(tmpdir(), "smudge-export-img-test-"));
  process.env.DATA_DIR = tmpDataDir;

  // Create a project
  projectId = uuidv4();
  await testDb("projects").insert({
    id: projectId,
    title: "Image Test Project",
    slug: "image-test-project",
    mode: "fiction",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  // Create image record and file (no caption)
  imageId = uuidv4();
  await imagesRepo.insert(testDb, {
    id: imageId,
    project_id: projectId,
    filename: "test.png",
    mime_type: "image/png",
    size_bytes: TEST_PNG.length,
    created_at: new Date().toISOString(),
  });
  const imgDir = path.join(tmpDataDir, "images", projectId);
  await mkdir(imgDir, { recursive: true });
  await writeFile(path.join(imgDir, `${imageId}.png`), TEST_PNG);

  // Create image record with caption
  imageIdWithCaption = uuidv4();
  await imagesRepo.insert(testDb, {
    id: imageIdWithCaption,
    project_id: projectId,
    filename: "captioned.png",
    mime_type: "image/png",
    size_bytes: TEST_PNG.length,
    created_at: new Date().toISOString(),
  });
  await imagesRepo.update(testDb, imageIdWithCaption, {
    alt_text: "Captioned alt",
    caption: "A lovely caption",
  });
  await writeFile(path.join(imgDir, `${imageIdWithCaption}.png`), TEST_PNG);
});

afterAll(async () => {
  delete process.env.DATA_DIR;
  resetProjectStore();
  await closeDb();
  await rm(tmpDataDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// image-resolver unit tests
// ---------------------------------------------------------------------------

describe("resolveImage", () => {
  it("resolves an image by ID from DB and disk", async () => {
    const result = await resolveImage(imageId);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(imageId);
    expect(result!.mimeType).toBe("image/png");
    expect(result!.data).toBeInstanceOf(Buffer);
    expect(result!.data.length).toBe(TEST_PNG.length);
  });

  it("returns null for non-existent image ID", async () => {
    const result = await resolveImage(uuidv4());
    expect(result).toBeNull();
  });

  it("returns null when file is missing on disk", async () => {
    const missingId = uuidv4();
    await imagesRepo.insert(testDb, {
      id: missingId,
      project_id: projectId,
      filename: "missing.png",
      mime_type: "image/png",
      size_bytes: 100,
      created_at: new Date().toISOString(),
    });
    const result = await resolveImage(missingId);
    expect(result).toBeNull();
  });
});

describe("resolveImagesInHtml", () => {
  it("replaces image src URLs with base64 data URIs", async () => {
    const html = `<p>Before</p><img src="/api/images/${imageId}" alt="Test"><p>After</p>`;
    const result = await resolveImagesInHtml(html);

    expect(result.html).not.toContain(`/api/images/${imageId}`);
    expect(result.html).toContain("data:image/png;base64,");
    expect(result.images.size).toBe(1);
    expect(result.images.has(imageId)).toBe(true);
  });

  it("adds figure/figcaption for images with captions", async () => {
    const html = `<img src="/api/images/${imageIdWithCaption}" alt="Captioned alt">`;
    const result = await resolveImagesInHtml(html);

    expect(result.html).toContain("<figure>");
    expect(result.html).toContain("<figcaption>A lovely caption</figcaption>");
    expect(result.html).toContain("</figure>");
  });

  it("leaves HTML unchanged when no image URLs are present", async () => {
    const html = "<p>No images here</p>";
    const result = await resolveImagesInHtml(html);
    expect(result.html).toBe(html);
    expect(result.images.size).toBe(0);
  });

  it("handles multiple different images", async () => {
    const html = `<img src="/api/images/${imageId}" alt="A"><img src="/api/images/${imageIdWithCaption}" alt="B">`;
    const result = await resolveImagesInHtml(html);
    expect(result.images.size).toBe(2);
    expect(result.html).not.toContain("/api/images/");
  });
});

// ---------------------------------------------------------------------------
// Renderer integration tests with images
// ---------------------------------------------------------------------------

describe("renderHtml with images", () => {
  it("embeds images as base64 data URIs", async () => {
    const chapters: ExportChapter[] = [
      {
        id: "ch-1",
        title: "Chapter with Image",
        content: makeChapterWithImage(imageId),
        sort_order: 0,
      },
    ];
    const html = await renderHtml(projectInfo, chapters, { includeToc: false });
    expect(html).toContain("data:image/png;base64,");
    expect(html).not.toContain(`/api/images/${imageId}`);
    expect(html).toContain("Before image");
    expect(html).toContain("After image");
  });

  it("includes figcaption for images with captions", async () => {
    const chapters: ExportChapter[] = [
      {
        id: "ch-1",
        title: "Chapter with Captioned Image",
        content: makeChapterWithImage(imageIdWithCaption),
        sort_order: 0,
      },
    ];
    const html = await renderHtml(projectInfo, chapters, { includeToc: false });
    expect(html).toContain("<figcaption>A lovely caption</figcaption>");
  });
});

describe("renderMarkdown with images", () => {
  it("embeds images as base64 in markdown", async () => {
    const chapters: ExportChapter[] = [
      {
        id: "ch-1",
        title: "Chapter with Image",
        content: makeChapterWithImage(imageId),
        sort_order: 0,
      },
    ];
    const md = await renderMarkdown(projectInfo, chapters, { includeToc: false });
    expect(md).toContain("data:image/png;base64,");
    expect(md).not.toContain(`/api/images/${imageId}`);
  });

  it("includes caption text for captioned images", async () => {
    const chapters: ExportChapter[] = [
      {
        id: "ch-1",
        title: "Chapter with Captioned Image",
        content: makeChapterWithImage(imageIdWithCaption),
        sort_order: 0,
      },
    ];
    const md = await renderMarkdown(projectInfo, chapters, { includeToc: false });
    expect(md).toContain("A lovely caption");
  });
});

describe("renderPlainText with images", () => {
  it("replaces images with [Image: alt text] markers", async () => {
    const chapters: ExportChapter[] = [
      {
        id: "ch-1",
        title: "Chapter with Image",
        content: makeChapterWithImage(imageId),
        sort_order: 0,
      },
    ];
    const text = await renderPlainText(projectInfo, chapters, { includeToc: false });
    expect(text).toContain("[Image: Test alt]");
    expect(text).toContain("Before image");
    expect(text).toContain("After image");
  });
});

describe("renderDocx with images", () => {
  it("produces a valid DOCX zip containing image data", async () => {
    const chapters: ExportChapter[] = [
      {
        id: "ch-1",
        title: "Chapter with Image",
        content: makeChapterWithImage(imageId),
        sort_order: 0,
      },
    ];
    const buf = await renderDocx(projectInfo, chapters, { includeToc: false });
    expect(buf).toBeInstanceOf(Buffer);
    // DOCX is a zip file — starts with "PK"
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);

    // Verify it contains image media
    const zip = await JSZip.loadAsync(buf);
    const mediaFiles = Object.keys(zip.files).filter((f) => f.startsWith("word/media/"));
    expect(mediaFiles.length).toBeGreaterThan(0);
  });
});

describe("renderEpub with images", () => {
  it("produces a valid EPUB zip", async () => {
    const chapters: ExportChapter[] = [
      {
        id: "ch-1",
        title: "Chapter with Image",
        content: makeChapterWithImage(imageId),
        sort_order: 0,
      },
    ];
    const buf = await renderEpub(projectInfo, chapters, { includeToc: false });
    expect(buf).toBeInstanceOf(Buffer);
    // EPUB is a zip file
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it("includes figcaption for images with captions in EPUB", async () => {
    const chapters: ExportChapter[] = [
      {
        id: "ch-1",
        title: "Chapter with Captioned Image",
        content: makeChapterWithImage(imageIdWithCaption),
        sort_order: 0,
      },
    ];
    const buf = await renderEpub(projectInfo, chapters, { includeToc: false });
    const zip = await JSZip.loadAsync(buf);

    // Find the chapter XHTML file and check it contains the figcaption
    const xhtmlFiles = Object.keys(zip.files).filter(
      (f) => f.endsWith(".xhtml") || f.endsWith(".html"),
    );
    let foundCaption = false;
    for (const file of xhtmlFiles) {
      const content = await zip.files[file]!.async("text");
      if (content.includes("A lovely caption")) {
        foundCaption = true;
        expect(content).toContain("<figure>");
        expect(content).toContain("<figcaption>");
        break;
      }
    }
    expect(foundCaption).toBe(true);
  });

  it("accepts a cover image ID and produces a valid EPUB", async () => {
    const chapters: ExportChapter[] = [
      {
        id: "ch-1",
        title: "Chapter",
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
        },
        sort_order: 0,
      },
    ];
    const buf = await renderEpub(projectInfo, chapters, {
      includeToc: false,
      coverImageId: imageId,
    });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });
});
