import fs from "node:fs/promises";
import { EPub } from "epub-gen-memory";
import { chapterContentToHtml, escapeHtml } from "./export.renderers";
import * as imagesRepo from "../images/images.repository";
import { getDb } from "../db/connection";
import { mimeToExt, getImagePath } from "../images/images.paths";
import type { ExportProjectInfo, ExportChapter, RenderOptions } from "./export.renderers";

export interface EpubRenderOptions extends RenderOptions {
  coverImageId?: string;
}

/**
 * Replace /api/images/{uuid} URLs with file:// URLs pointing to the
 * actual image files on disk. epub-gen-memory supports file:// URLs natively.
 */
async function resolveImagesForEpub(html: string): Promise<string> {
  const pattern = /src="\/api\/images\/([0-9a-f-]{36})"/gi;
  const matches = [...html.matchAll(pattern)];
  if (matches.length === 0) return html;

  const db = getDb();

  let resolvedHtml = html;
  for (const match of matches) {
    const id = match[1];
    if (!id) continue;
    const row = await imagesRepo.findById(db, id);
    if (!row) continue;
    const ext = mimeToExt(row.mime_type);
    const filePath = getImagePath(row.project_id, row.id, ext);
    try {
      await fs.access(filePath);
      const fileUrl = `file://${filePath}`;
      resolvedHtml = resolvedHtml.replace(
        new RegExp(`src="/api/images/${id}"`, "gi"),
        `src="${fileUrl}"`,
      );
    } catch {
      // File doesn't exist — remove the img tag
      resolvedHtml = resolvedHtml.replace(
        new RegExp(`<img[^>]*src="/api/images/${id}"[^>]*>`, "gi"),
        "",
      );
    }
  }
  return resolvedHtml;
}

// ---------------------------------------------------------------------------
// Embedded stylesheet for EPUB content
// ---------------------------------------------------------------------------

const EPUB_CSS = `
body {
  font-family: Georgia, "Times New Roman", serif;
  line-height: 1.6;
  margin: 1em;
}
h1 { font-size: 1.8em; margin: 1em 0 0.5em; }
h2 { font-size: 1.4em; margin: 0.8em 0 0.4em; }
h3 { font-size: 1.2em; margin: 0.6em 0 0.3em; }
h4 { font-size: 1.1em; margin: 0.5em 0 0.25em; }
h5 { font-size: 1.0em; margin: 0.4em 0 0.2em; }
blockquote {
  margin: 1em 2em;
  font-style: italic;
}
pre, code {
  font-family: "Courier New", monospace;
  font-size: 0.9em;
}
pre {
  margin: 1em 0;
  padding: 0.5em;
  background: #f5f5f5;
}
`.trim();

// ---------------------------------------------------------------------------
// Public renderer
// ---------------------------------------------------------------------------

export async function renderEpub(
  project: ExportProjectInfo,
  chapters: ExportChapter[],
  options: EpubRenderOptions,
): Promise<Buffer> {
  const author = project.author_name ?? "";

  // Build chapter content array for epub-gen-memory
  const epubChapters: Array<{ title: string; content: string; excludeFromToc?: boolean }> = [];

  if (chapters.length === 0) {
    // Title-page-only EPUB: one section with title and author
    const titleHtml = `<h1>${escapeHtml(project.title)}</h1>${
      author ? `<p><em>${escapeHtml(author)}</em></p>` : ""
    }`;
    epubChapters.push({ title: project.title, content: titleHtml });
  } else {
    for (const chapter of chapters) {
      let html = chapterContentToHtml(chapter.content);
      if (html === "") {
        html = "<p>&nbsp;</p>";
      } else {
        // Resolve images — replace /api/images/ URLs with file:// URLs
        html = await resolveImagesForEpub(html);
      }
      epubChapters.push({
        title: chapter.title,
        content: html,
        // When TOC is disabled, exclude chapters from the inline TOC listing
        excludeFromToc: !options.includeToc,
      });
    }
  }

  // Resolve cover image if provided — use file:// URL for epub-gen-memory
  let coverFileUrl: string | undefined;
  if (options.coverImageId) {
    const db = getDb();
    const row = await imagesRepo.findById(db, options.coverImageId);
    if (row) {
      const ext = mimeToExt(row.mime_type);
      const filePath = getImagePath(row.project_id, row.id, ext);
      try {
        await fs.access(filePath);
        coverFileUrl = `file://${filePath}`;
      } catch {
        // Cover image file not found — proceed without cover
      }
    }
  }

  // epub-gen-memory always generates a TOC page — it cannot be fully
  // suppressed. When includeToc is false, we set tocTitle to an empty
  // string and mark all chapters as excludeFromToc, producing an
  // effectively empty TOC page.
  const epub = new EPub(
    {
      title: project.title,
      author: author || undefined,
      lang: "en",
      css: EPUB_CSS,
      tocTitle: options.includeToc ? "Table of Contents" : "",
      verbose: false,
      ...(coverFileUrl ? { cover: coverFileUrl } : {}),
    },
    epubChapters,
  );

  try {
    return await epub.genEpub();
  } catch (err) {
    throw new Error(
      `EPUB generation failed for "${project.title}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
