import TurndownService from "turndown";
import { renderEditorHtml } from "@smudge/shared/editor-extensions";
import { resolveImagesInHtml, type ImageSource } from "./image-resolver";
import { escapeHtml } from "./html-escape";
import { logger } from "../logger";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ExportProjectInfo {
  id: string;
  title: string;
  author_name: string | null;
}

export interface ExportChapter {
  id: string;
  title: string;
  content: Record<string, unknown> | null;
  sort_order: number;
}

export interface RenderOptions {
  includeToc: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// F-15: mirror the client sanitizer's fail-closed image-src allowlist on the
// server export path. The client renders TipTap JSON through a hardened
// DOMPurify whose URI hook drops any src that isn't a relative
// /api/images/<uuid> (packages/client/src/sanitizer.ts) — documented
// defense-in-depth against a hostile stored/backup payload. The server export
// rendered the same untrusted JSON via generateHTML with no equivalent pass,
// so a hostile image node (external tracking pixel, javascript:/data: src)
// survived into the downloaded file. This regex mirrors the client's
// ALLOWED_URI_REGEXP shape; the export drops the whole <img> (the client drops
// the attr, leaving a broken img — both fail closed). No server-side DOM is
// needed: editorExtensions emits only <img src alt> as URI-bearing output (no
// Link), so a targeted img-tag pass over the bounded, machine-generated HTML is
// sufficient. Runs BEFORE resolveImagesInHtml so a valid /api/images/<uuid> src
// still resolves to its embedded data URI.
const ALLOWED_IMAGE_SRC =
  /^\/api\/images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:[?#].*)?$/i;

function stripDisallowedImages(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /\ssrc\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? "";
    return ALLOWED_IMAGE_SRC.test(src) ? tag : "";
  });
}

// S1: defense-in-depth second layer for note confidentiality, mirroring the
// client's DOMPurify `span` exclusion (packages/client/src/sanitizer.ts) on the
// server export path. renderEditorHtml() strips note marks upstream, so a note
// span reaching here means that strip regressed — this unwraps it so a bug in
// our own strip cannot ship the writer's private commentary into a beta-reader
// file. In Smudge's rendered HTML, <span> is emitted ONLY by the note mark, so
// dropping every span tag (open + close) discards the `data-note` payload and
// `note-highlight` class while keeping the annotated manuscript text — the same
// net effect as the client dropping the tag but keeping its children.
export function stripNoteSpans(html: string): string {
  return html.replace(/<\/?span\b[^>]*>/gi, "");
}

export function chapterContentToHtml(content: Record<string, unknown> | null): string {
  if (!content) return "";
  try {
    return stripNoteSpans(stripDisallowedImages(renderEditorHtml(content)));
  } catch (err) {
    logger.warn({ err }, "Failed to render chapter content to HTML during export");
    return "";
  }
}

function stripHtmlTags(html: string): string {
  // Replace block-level closing tags with newlines
  let text = html.replace(/<\/(p|div|br|h[1-6]|li|blockquote|pre)>/gi, "\n");
  // Replace <br> and <br/> with newlines
  text = text.replace(/<br\s*\/?>/gi, "\n");
  // Strip remaining tags
  text = text.replace(/<[^>]*>/g, "");
  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => {
      const cp = Number(n);
      return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      const cp = parseInt(h, 16);
      return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    });
  // Collapse multiple blank lines into two newlines max
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

function escapeMarkdown(text: string): string {
  return text.replace(/\n/g, " ").replace(/([\\`*_{}[\]()#+\-.!|])/g, "\\$1");
}

// ---------------------------------------------------------------------------
// HTML Renderer
// ---------------------------------------------------------------------------

const HTML_STYLES = `
    body {
      font-family: Georgia, 'Times New Roman', serif;
      max-width: 680px;
      margin: 2em auto;
      padding: 0 1em;
      background: #F7F3ED;
      color: #1C1917;
      line-height: 1.7;
    }
    h1 { text-align: center; margin-bottom: 0.2em; }
    .author { text-align: center; font-style: italic; margin-bottom: 2em; color: #6B4720; }
    nav { margin-bottom: 2em; }
    nav h2 { font-size: 1.2em; }
    nav ol { padding-left: 1.5em; }
    nav a { color: #6B4720; text-decoration: none; }
    nav a:hover { text-decoration: underline; }
    section { margin-bottom: 2em; }
    .divider { text-align: center; margin: 2em 0; letter-spacing: 0.5em; color: #6B4720; }
`;

export async function renderHtml(
  project: ExportProjectInfo,
  chapters: ExportChapter[],
  options: RenderOptions,
  imageSource: ImageSource,
): Promise<string> {
  const titleEsc = escapeHtml(project.title);

  const authorHtml = project.author_name
    ? `    <p class="author">${escapeHtml(project.author_name)}</p>\n`
    : "";

  // TOC: only when requested AND there are chapters
  let tocHtml = "";
  if (options.includeToc && chapters.length > 0) {
    const tocItems = chapters
      .map((ch, i) => `      <li><a href="#chapter-${i}">${escapeHtml(ch.title)}</a></li>`)
      .join("\n");
    tocHtml = `    <nav>\n      <h2>Table of Contents</h2>\n      <ol>\n${tocItems}\n      </ol>\n    </nav>\n`;
  }

  const chapterSections = chapters
    .map((ch, i) => {
      const body = chapterContentToHtml(ch.content);
      const divider = i < chapters.length - 1 ? `\n    <div class="divider">* * *</div>` : "";
      return `    <section id="chapter-${i}">\n      <h2>${escapeHtml(ch.title)}</h2>\n      ${body}${divider}\n    </section>`;
    })
    .join("\n");

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${titleEsc}</title>
  <style>${HTML_STYLES}
  </style>
</head>
<body>
    <h1>${titleEsc}</h1>
${authorHtml}${tocHtml}${chapterSections}
</body>
</html>`;

  // Resolve images — replace /api/images/ URLs with embedded base64 data URIs
  const resolved = await resolveImagesInHtml(html, imageSource);
  html = resolved.html;

  return html;
}

// ---------------------------------------------------------------------------
// Markdown Renderer
// ---------------------------------------------------------------------------

export async function renderMarkdown(
  project: ExportProjectInfo,
  chapters: ExportChapter[],
  options: RenderOptions,
  imageSource: ImageSource,
): Promise<string> {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });

  const parts: string[] = [];

  // Title
  parts.push(`# ${escapeMarkdown(project.title)}`);

  // Author
  if (project.author_name) {
    parts.push(`*By ${escapeMarkdown(project.author_name)}*`);
  }

  // TOC: only when requested AND there are chapters
  // Uses index-based anchors (<a id="chapter-N">) for deterministic links
  // regardless of which Markdown renderer the user opens the file with.
  if (options.includeToc && chapters.length > 0) {
    parts.push("## Table of Contents\n");
    const tocLines = chapters.map((ch, i) => {
      return `- [${escapeMarkdown(ch.title)}](#chapter-${i})`;
    });
    parts.push(tocLines.join("\n"));
    parts.push("---");
  }

  // Chapters
  for (const [i, ch] of chapters.entries()) {
    if (i > 0) {
      parts.push("---");
    }

    parts.push(`<a id="chapter-${i}"></a>\n\n## ${escapeMarkdown(ch.title)}`);

    let html = chapterContentToHtml(ch.content);
    if (html) {
      // Resolve images in HTML before converting to markdown
      const resolved = await resolveImagesInHtml(html, imageSource);
      html = resolved.html;

      // For images with figcaption, add caption as italic text after the image in markdown
      // The turndown conversion will handle the <figure>/<figcaption> naturally,
      // but let's ensure captions appear as italic text below images
      const md = turndown.turndown(html);
      parts.push(md);
    }
  }

  return parts.join("\n\n") + "\n";
}

// ---------------------------------------------------------------------------
// Plain Text Renderer
// ---------------------------------------------------------------------------

export async function renderPlainText(
  project: ExportProjectInfo,
  chapters: ExportChapter[],
  options: RenderOptions,
  imageSource: ImageSource,
): Promise<string> {
  const parts: string[] = [];

  // Title (uppercase)
  parts.push(project.title.toUpperCase());

  // Author
  if (project.author_name) {
    parts.push(`by ${project.author_name}`);
  }

  // TOC: only when requested AND there are chapters
  if (options.includeToc && chapters.length > 0) {
    const tocLines = chapters.map((ch) => `  ${ch.title}`);
    parts.push(`Contents\n\n${tocLines.join("\n")}`);
  }

  // Chapters separated by 3 blank lines (= 4 newlines between content)
  const chapterTexts: string[] = [];
  for (const ch of chapters) {
    let html = chapterContentToHtml(ch.content);
    if (html) {
      // Resolve images to get metadata (alt text, filename) for text markers.
      // The resolved map provides filename fallback when alt text is empty.
      const { html: resolvedHtml, images } = await resolveImagesInHtml(html, imageSource);
      html = resolvedHtml;

      // Strip <figcaption> and <figure> tags before converting images to text markers.
      // resolveImagesInHtml adds these for captioned images, but plain text should
      // not include captions — they would appear as inline body text.
      html = html.replace(/<figcaption>[\s\S]*?<\/figcaption>/gi, "");
      html = html.replace(/<\/?figure>/gi, "");

      // Replace resolved <img> tags (with data-image-id) using metadata.
      // Priority: HTML alt attribute > DB alt_text > filename > image ID
      for (const [id, img] of images) {
        html = html.replace(new RegExp(`<img[^>]*data-image-id="${id}"[^>]*>`, "gi"), (match) => {
          const altMatch = /alt="([^"]*)"/.exec(match);
          const label = (altMatch?.[1] || img.altText || img.filename || img.id).trim() || img.id;
          return `[Image: ${label}]`;
        });
      }

      // Catch any remaining unresolved <img> tags with alt text
      html = html.replace(/<img[^>]*alt="([^"]+)"[^>]*>/gi, "[Image: $1]");
      // Final fallback for <img> tags with empty or no alt
      html = html.replace(/<img[^>]*>/gi, "[Image]");
    }
    const body = html ? stripHtmlTags(html) : "";
    const header = ch.title;
    chapterTexts.push(body ? `${header}\n\n${body}` : header);
  }

  if (chapterTexts.length > 0) {
    parts.push(chapterTexts.join("\n\n\n\n"));
  }

  return parts.join("\n\n") + "\n";
}
