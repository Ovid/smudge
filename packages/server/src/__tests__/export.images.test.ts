import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID as uuidv4 } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import knex, { type Knex } from "knex";
import JSZip from "jszip";
import { createTestKnexConfig } from "../db/knexfile";
import { setDb, closeDb } from "../db/connection";
import {
  setProjectStore,
  resetProjectStore,
  getProjectStore,
} from "../stores/project-store.injectable";
import { SqliteProjectStore } from "../stores";
import * as imagesRepo from "../images/images.repository";
import {
  resolveImage,
  resolveImagesInHtml,
  resolveImagesForEpub,
  projectScopedImageSource,
  type ImageSource,
} from "../export/image-resolver";
import { renderHtml, renderMarkdown, renderPlainText } from "../export/export.renderers";
import { renderDocx } from "../export/docx.renderer";
import { renderEpub } from "../export/epub.renderer";
import { logger } from "../logger";
import type { ExportProjectInfo, ExportChapter } from "../export/export.renderers";

vi.mock("../logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Image source injected into the renderers (F-12), scoped to the project under
// export exactly as export.service does (I1). Delegates to the live store set
// up in beforeAll — looked up lazily so it resolves after setProjectStore.
const imageSrc: ImageSource = {
  findImageById: (id) => projectScopedImageSource(getProjectStore(), projectId).findImageById(id),
};

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
// A second project with its own image, used to prove an image reference is
// honoured only when it belongs to the project being exported (I1).
let otherProjectId: string;
let otherProjectImageId: string;

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
  id: "proj-img-test",
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

  // A second project owning its own image, on disk and in the DB.
  otherProjectId = uuidv4();
  await testDb("projects").insert({
    id: otherProjectId,
    title: "Other Project",
    slug: "other-project",
    mode: "fiction",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  otherProjectImageId = uuidv4();
  await imagesRepo.insert(testDb, {
    id: otherProjectImageId,
    project_id: otherProjectId,
    filename: "other.png",
    mime_type: "image/png",
    size_bytes: TEST_PNG.length,
    created_at: new Date().toISOString(),
  });
  const otherImgDir = path.join(tmpDataDir, "images", otherProjectId);
  await mkdir(otherImgDir, { recursive: true });
  await writeFile(path.join(otherImgDir, `${otherProjectImageId}.png`), TEST_PNG);
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
    const result = await resolveImage(imageId, imageSrc);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(imageId);
    expect(result!.mimeType).toBe("image/png");
    expect(result!.data).toBeInstanceOf(Buffer);
    expect(result!.data.length).toBe(TEST_PNG.length);
  });

  it("returns null for non-existent image ID", async () => {
    const result = await resolveImage(uuidv4(), imageSrc);
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
    const result = await resolveImage(missingId, imageSrc);
    expect(result).toBeNull();
    // The row is in the DB but the bytes are gone: an operator-actionable
    // anomaly (restore the file) that the export otherwise reports as success.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.anything(),
        image_id: missingId,
        project_id: projectId,
      }),
      expect.stringContaining("missing on disk"),
    );
  });
});

describe("resolveImagesInHtml", () => {
  it("replaces image src URLs with base64 data URIs", async () => {
    const html = `<p>Before</p><img src="/api/images/${imageId}" alt="Test"><p>After</p>`;
    const result = await resolveImagesInHtml(html, imageSrc);

    expect(result.html).not.toContain(`/api/images/${imageId}`);
    expect(result.html).toContain("data:image/png;base64,");
    expect(result.images.size).toBe(1);
    expect(result.images.has(imageId)).toBe(true);
  });

  it("adds figure/figcaption for images with captions", async () => {
    const html = `<img src="/api/images/${imageIdWithCaption}" alt="Captioned alt">`;
    const result = await resolveImagesInHtml(html, imageSrc);

    expect(result.html).toContain("<figure>");
    expect(result.html).toContain("<figcaption>A lovely caption</figcaption>");
    expect(result.html).toContain("</figure>");
  });

  it("treats $-sequences in a caption as literal text, not replacement tokens (OOSI1)", async () => {
    // The figcaption pass is a STRING replacement, so every `$` token in the
    // second argument is interpolated by the engine. escapeHtml neutralises
    // `& < > " '` but not `$` — and it manufactures the hazard, rewriting `&`
    // to `&amp;` so a `$&` survives escaping intact. `$\`` splices the ENTIRE
    // preceding rendered document (title, TOC, prior chapters, the <style>
    // block — resolveImagesInHtml runs over the whole document) into a
    // figcaption meant to hold escaped text, multiplicatively within one
    // .replace() and compounding across images. Ordinary prose reaches this:
    // "Sold for US$1,200" splices the <img> tag back into its own caption.
    const dollarId = uuidv4();
    await imagesRepo.insert(testDb, {
      id: dollarId,
      project_id: projectId,
      filename: "dollar.png",
      mime_type: "image/png",
      size_bytes: TEST_PNG.length,
      created_at: new Date().toISOString(),
    });
    await imagesRepo.update(testDb, dollarId, { caption: "Sold for US$1,200 -- $& $` $' $1" });
    await writeFile(path.join(tmpDataDir, "images", projectId, `${dollarId}.png`), TEST_PNG);

    const html = `<h1>Doc title</h1><img src="/api/images/${dollarId}" alt="A">`;
    const result = await resolveImagesInHtml(html, imageSrc);

    expect(result.html).toContain(
      "<figcaption>Sold for US$1,200 -- $&amp; $` $&#39; $1</figcaption>",
    );
    // The document did not splice itself into its own caption.
    expect(result.html.match(/Doc title/g)).toHaveLength(1);
  });

  it("captions a mixed-case duplicate reference to the same image (S6)", async () => {
    // The C1 one-pass rewrite emits data-image-id AS MATCHED while the caption
    // regex below is "g"-only (the replaced code used "gi" and emitted the
    // resolved lowercase id). A second reference in different case therefore
    // resolved its bytes but silently lost caption/source/license. No shipped
    // path mints mixed-case UUIDs today — this pins the invariant, not a bug
    // report.
    const upper = imageIdWithCaption.toUpperCase();
    const html = `<img src="/api/images/${imageIdWithCaption}" alt="A"><img src="/api/images/${upper}" alt="B">`;
    const result = await resolveImagesInHtml(html, imageSrc);

    expect(result.html.match(/<figcaption>A lovely caption<\/figcaption>/g)).toHaveLength(2);
  });

  // OOSS1 (agentic-review 2026-08-04): the S6 normalization reached the map keys
  // and the emitted data-image-id but not `resolve(id)`, which runs
  // `where({ id })` under SQLite's BINARY collation. An UPPERCASE-only
  // reference resolved to null, fell through the rewrite, and was deleted by the
  // unresolved-image catch-all — the image vanishing from HTML/Markdown/
  // plaintext/EPUB export with no warning, while IMAGE_SRC_REGEX and
  // ALLOWED_IMAGE_SRC (both i-flagged) had just accepted it. The duplicate-
  // reference test above passes either way: its lowercase twin populates the map.
  it("resolves an image referenced only in uppercase (OOSS1)", async () => {
    const html = `<img src="/api/images/${imageIdWithCaption.toUpperCase()}" alt="A">`;
    const result = await resolveImagesInHtml(html, imageSrc);

    expect(result.images.has(imageIdWithCaption)).toBe(true);
    expect(result.html).toContain("<figcaption>A lovely caption</figcaption>");
    expect(result.html).not.toContain("/api/images/");
  });

  it("leaves HTML unchanged when no image URLs are present", async () => {
    const html = "<p>No images here</p>";
    const result = await resolveImagesInHtml(html, imageSrc);
    expect(result.html).toBe(html);
    expect(result.images.size).toBe(0);
  });

  it("handles multiple different images", async () => {
    const html = `<img src="/api/images/${imageId}" alt="A"><img src="/api/images/${imageIdWithCaption}" alt="B">`;
    const result = await resolveImagesInHtml(html, imageSrc);
    expect(result.images.size).toBe(2);
    expect(result.html).not.toContain("/api/images/");
  });

  // C1 (dedup review 2026-07-26): the export allowlist ALLOWED_IMAGE_SRC accepts
  // a `?query` / `#fragment` suffix, and the scanner that runs immediately after
  // it used to reject one — so the allowlist kept the <img>, the scanner found no
  // id, and the unresolved-image catch-all deleted the tag outright. The image was
  // visible in the editor and in the preview, and `deleteImage` refused to remove
  // it as IMAGE_IN_USE, but it vanished from every HTML-route export with no
  // warning. Nothing in the app emits a suffix today; nothing stops one either
  // (TipTap preserves `src` verbatim and the paste path does not sanitize it), and
  // a cache-buster would make it universal.
  it.each([
    ["a query suffix", "?v=2"],
    ["a fragment suffix", "#frag"],
  ])(
    "resolves an image whose src carries %s rather than deleting the tag",
    async (_label, suffix) => {
      const html = `<p>Before</p><img src="/api/images/${imageId}${suffix}" alt="Test"><p>After</p>`;
      const result = await resolveImagesInHtml(html, imageSrc);

      expect(result.images.has(imageId)).toBe(true);
      expect(result.html).toContain("data:image/png;base64,");
      expect(result.html).not.toContain("/api/images/");
      expect(result.html).toContain("<p>Before</p>");
    },
  );
});

describe("resolveImagesForEpub", () => {
  it("rewrites resolvable images to file:// URLs", async () => {
    const html = `<p>x</p><img src="/api/images/${imageId}" alt="A"><p>y</p>`;
    const resolved = await resolveImagesForEpub(html, imageSrc);
    expect(resolved).toContain("file://");
    expect(resolved).not.toContain(`/api/images/${imageId}`);
  });

  it("drops images whose file is missing on disk", async () => {
    // Image row exists but no file was written — the fs.access check fails,
    // the resolver returns null, and the unresolved <img> tag is removed.
    const missingId = uuidv4();
    await imagesRepo.insert(testDb, {
      id: missingId,
      project_id: projectId,
      filename: "gone.png",
      mime_type: "image/png",
      size_bytes: 100,
      created_at: new Date().toISOString(),
    });
    const html = `<p>before</p><img src="/api/images/${missingId}" alt="Gone"><p>after</p>`;
    const resolved = await resolveImagesForEpub(html, imageSrc);
    expect(resolved).not.toContain(`/api/images/${missingId}`);
    expect(resolved).not.toContain("file://");
    expect(resolved).toContain("before");
    expect(resolved).toContain("after");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.anything(),
        image_id: missingId,
        project_id: projectId,
      }),
      expect.stringContaining("missing on disk"),
    );
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
    const html = await renderHtml(projectInfo, chapters, { includeToc: false }, imageSrc);
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
    const html = await renderHtml(projectInfo, chapters, { includeToc: false }, imageSrc);
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
    const md = await renderMarkdown(projectInfo, chapters, { includeToc: false }, imageSrc);
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
    const md = await renderMarkdown(projectInfo, chapters, { includeToc: false }, imageSrc);
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
    const text = await renderPlainText(projectInfo, chapters, { includeToc: false }, imageSrc);
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
    const buf = await renderDocx(projectInfo, chapters, { includeToc: false }, imageSrc);
    expect(buf).toBeInstanceOf(Buffer);
    // DOCX is a zip file — starts with "PK"
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);

    // Verify it contains image media
    const zip = await JSZip.loadAsync(buf);
    const mediaFiles = Object.keys(zip.files).filter((f) => f.startsWith("word/media/"));
    expect(mediaFiles.length).toBeGreaterThan(0);
  });

  // C1 (dedup review 2026-07-26): the DOCX walker extracted the UUID with an
  // UNANCHORED /api/images/(uuid) match, so a hostile src that merely *contains*
  // a valid image path resolved to the local bytes and embedded them — where
  // every HTML-route format drops the <img> via ALLOWED_IMAGE_SRC. DOCX cannot
  // reuse stripDisallowedImages (it never renders HTML), so it carries the
  // allowlist decision at its own walker, exactly as it carries stripNoteMarks.
  it.each([
    ["absolute host prefix", `https://evil.example/api/images/${"IMG"}`],
    ["query-string smuggling", `https://evil.example/?ref=/api/images/${"IMG"}/x`],
    ["javascript: scheme", `javascript:x/api/images/${"IMG"}`],
    ["extra path segment", `/api/images/${"IMG"}/../../etc/passwd`],
  ])("embeds no image bytes for a non-relative src (%s)", async (_label, template) => {
    const src = template.replace("IMG", imageId);
    const chapters: ExportChapter[] = [
      {
        id: "ch-1",
        title: "Hostile Image",
        content: { type: "doc", content: [{ type: "image", attrs: { src, alt: "x" } }] },
        sort_order: 0,
      },
    ];
    const buf = await renderDocx(projectInfo, chapters, { includeToc: false }, imageSrc);
    const zip = await JSZip.loadAsync(buf);
    const mediaFiles = Object.keys(zip.files).filter((f) => f.startsWith("word/media/"));
    expect(mediaFiles).toEqual([]);
  });

  // I1 (agentic-review 2026-08-05): OOSS1's canonicalization landed in
  // resolveImageSrcs, which DOCX is the documented exception to — it walks
  // TipTap JSON straight into Word paragraphs and never renders HTML. So the
  // uppercase reference that HTML/Markdown/plaintext/EPUB now resolve was still
  // hitting `where({ id })` under SQLite's BINARY collation here, and DOCX
  // became the ONLY format silently dropping the image and its caption — the
  // writer's natural cross-check (preview the HTML export) no longer catches it.
  it("resolves an image referenced only in uppercase (I1)", async () => {
    const chapters: ExportChapter[] = [
      {
        id: "ch-1",
        title: "Uppercase Image",
        content: makeChapterWithImage(imageIdWithCaption.toUpperCase()),
        sort_order: 0,
      },
    ];
    const buf = await renderDocx(projectInfo, chapters, { includeToc: false }, imageSrc);
    const zip = await JSZip.loadAsync(buf);
    expect(
      Object.keys(zip.files).filter((f) => f.startsWith("word/media/")).length,
    ).toBeGreaterThan(0);
    const docXml = await zip.file("word/document.xml")!.async("string");
    expect(docXml).toContain("A lovely caption");
  });

  it("renders a caption paragraph beneath a captioned image", async () => {
    const chapters: ExportChapter[] = [
      {
        id: "ch-1",
        title: "Chapter with Captioned Image",
        content: makeChapterWithImage(imageIdWithCaption),
        sort_order: 0,
      },
    ];
    const buf = await renderDocx(projectInfo, chapters, { includeToc: false }, imageSrc);
    const zip = await JSZip.loadAsync(buf);
    const docXml = await zip.file("word/document.xml")!.async("string");
    // The caption text is emitted as an italic paragraph below the image.
    expect(docXml).toContain("A lovely caption");
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
    const buf = await renderEpub(projectInfo, chapters, { includeToc: false }, imageSrc);
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
    const buf = await renderEpub(projectInfo, chapters, { includeToc: false }, imageSrc);
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
    const buf = await renderEpub(
      projectInfo,
      chapters,
      { includeToc: false, coverImageId: imageId },
      imageSrc,
    );
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it("embeds the cover when the cover image belongs to the project", async () => {
    // projectInfo.id is a synthetic string, so its cover never matches the
    // image's real project_id. Use a project info whose id is the real UUID
    // so `row.project_id === project.id` holds and the cover file resolves.
    const coverProject: ExportProjectInfo = {
      id: projectId,
      title: "Cover Project",
      author_name: null,
    };
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
    const buf = await renderEpub(
      coverProject,
      chapters,
      { includeToc: false, coverImageId: imageId },
      imageSrc,
    );
    const zip = await JSZip.loadAsync(buf);
    // epub-gen-memory writes the cover image into the package when a cover URL resolves.
    const hasCover = Object.keys(zip.files).some((f) => /cover/i.test(f));
    expect(hasCover).toBe(true);
  });

  it("produces a valid EPUB when the cover image file is missing", async () => {
    // Cover row exists for the project but its file was never written — the
    // fs.access guard fails and generation proceeds without a cover.
    const missingCoverId = uuidv4();
    await imagesRepo.insert(testDb, {
      id: missingCoverId,
      project_id: projectId,
      filename: "no-cover.png",
      mime_type: "image/png",
      size_bytes: 100,
      created_at: new Date().toISOString(),
    });
    const coverProject: ExportProjectInfo = {
      id: projectId,
      title: "Missing Cover Project",
      author_name: null,
    };
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
    const buf = await renderEpub(
      coverProject,
      chapters,
      { includeToc: false, coverImageId: missingCoverId },
      imageSrc,
    );
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.anything(),
        image_id: missingCoverId,
        project_id: projectId,
      }),
      expect.stringContaining("missing on disk"),
    );
  });
});

// ---------------------------------------------------------------------------
// I1 (dedup review 2026-07-26): image references are project-scoped
// ---------------------------------------------------------------------------

describe("an image reference is honoured only within its own project (I1)", () => {
  // resolveImage did no ownership check at all, so a perfectly ORDINARY
  // relative src — a stale paste between two of the writer's own projects —
  // embedded the other project's bytes into this project's export, in all five
  // formats. applyImageRefDiff already knows the rule (it warns and skips the
  // refcount update for exactly this shape) and the EPUB cover path already
  // applies it; the export resolver was the one site that did not. Scoping is
  // applied once at the injected ImageSource, so no renderer can omit it.
  let foreignChapters: ExportChapter[];

  beforeAll(() => {
    foreignChapters = [
      {
        id: "ch-foreign",
        title: "Borrowed Image",
        content: makeChapterWithImage(otherProjectImageId),
        sort_order: 0,
      },
    ];
  });

  it("resolves nothing for an out-of-project id", async () => {
    expect(await resolveImage(otherProjectImageId, imageSrc)).toBeNull();
    // ...while the same store, unscoped, still finds the row — proving the
    // refusal comes from the scoping and not from a missing fixture.
    expect(await getProjectStore().findImageById(otherProjectImageId)).not.toBeNull();
  });

  it("embeds no data URI in an HTML export", async () => {
    const html = await renderHtml(projectInfo, foreignChapters, { includeToc: false }, imageSrc);
    expect(html).not.toContain("data:image/png;base64,");
    expect(html).not.toContain(otherProjectImageId);
  });

  it("embeds no data URI in a Markdown export", async () => {
    const md = await renderMarkdown(projectInfo, foreignChapters, { includeToc: false }, imageSrc);
    expect(md).not.toContain("data:image/png;base64,");
  });

  it("leaks no foreign image metadata into a plaintext export", async () => {
    // Plaintext never embeds bytes, so its leak is METADATA: renderPlainText
    // labels a resolved image with `alt attribute > DB alt_text > filename`.
    // With an empty alt the label fell back to the other project's DB filename,
    // so exporting project A disclosed a filename from project B.
    const chapters: ExportChapter[] = [
      {
        id: "ch-foreign-noalt",
        title: "Borrowed Image",
        content: {
          type: "doc",
          content: [
            { type: "image", attrs: { src: `/api/images/${otherProjectImageId}`, alt: "" } },
          ],
        },
        sort_order: 0,
      },
    ];
    const text = await renderPlainText(projectInfo, chapters, { includeToc: false }, imageSrc);
    expect(text).not.toContain("data:image/png;base64,");
    expect(text).not.toContain("other.png");
    expect(text).not.toContain(otherProjectImageId);
  });

  it("embeds no image media in a DOCX export", async () => {
    const buf = await renderDocx(projectInfo, foreignChapters, { includeToc: false }, imageSrc);
    const zip = await JSZip.loadAsync(buf);
    expect(Object.keys(zip.files).filter((f) => f.startsWith("word/media/"))).toEqual([]);
  });

  it("embeds no image media in an EPUB export", async () => {
    const buf = await renderEpub(projectInfo, foreignChapters, { includeToc: false }, imageSrc);
    const zip = await JSZip.loadAsync(buf);
    const media = Object.keys(zip.files).filter((f) => /\.(png|jpe?g|gif|webp)$/i.test(f));
    expect(media).toEqual([]);
  });

  it("still resolves an image that DOES belong to the exporting project", async () => {
    const html = await renderHtml(
      projectInfo,
      [{ id: "ch-1", title: "Own", content: makeChapterWithImage(imageId), sort_order: 0 }],
      { includeToc: false },
      imageSrc,
    );
    expect(html).toContain("data:image/png;base64,");
  });
});
