import { describe, it, expect, vi } from "vitest";
import JSZip from "jszip";
import { renderHtml, renderMarkdown, renderPlainText } from "../export/export.renderers";
import { renderDocx } from "../export/docx.renderer";
import { renderEpub } from "../export/epub.renderer";
import { logger } from "../logger";

async function docxXml(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const doc = zip.file("word/document.xml");
  return doc ? await doc.async("string") : "";
}

vi.mock("../logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const sampleChapters = [
  {
    id: "ch-1",
    title: "The Beginning",
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "It was a dark and stormy night." }] },
      ],
    },
    sort_order: 0,
  },
  {
    id: "ch-2",
    title: "The Middle",
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "The plot thickened." }] }],
    },
    sort_order: 1,
  },
];

const projectInfo = { title: "My Novel", author_name: "Jane Doe", slug: "my-novel" };

describe("renderHtml", () => {
  it("produces a self-contained HTML document", () => {
    const html = renderHtml(projectInfo, sampleChapters, { includeToc: true });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>My Novel</title>");
    expect(html).toContain("Jane Doe");
    expect(html).toContain("<h2");
    expect(html).toContain("The Beginning");
    expect(html).toContain("It was a dark and stormy night.");
    expect(html).toContain("The Middle");
  });

  it("includes a table of contents when includeToc is true", () => {
    const html = renderHtml(projectInfo, sampleChapters, { includeToc: true });
    expect(html).toContain("Table of Contents");
    expect(html).toContain("#chapter-0");
    expect(html).toContain("#chapter-1");
  });

  it("omits table of contents when includeToc is false", () => {
    const html = renderHtml(projectInfo, sampleChapters, { includeToc: false });
    expect(html).not.toContain("Table of Contents");
  });

  it("omits author line when author_name is null", () => {
    const html = renderHtml({ ...projectInfo, author_name: null }, sampleChapters, {
      includeToc: false,
    });
    expect(html).not.toContain("Jane Doe");
    expect(html).not.toContain('class="author"');
  });

  it("handles chapters with null content", () => {
    const chapters = [{ id: "ch-1", title: "Empty", content: null, sort_order: 0 }];
    const html = renderHtml(projectInfo, chapters, { includeToc: false });
    expect(html).toContain("Empty");
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("handles chapters with malformed TipTap JSON gracefully", () => {
    const chapters = [
      {
        id: "ch-1",
        title: "Bad Content",
        content: { type: "invalid_node_that_doesnt_exist" } as Record<string, unknown>,
        sort_order: 0,
      },
    ];
    const html = renderHtml(projectInfo, chapters, { includeToc: false });
    expect(html).toContain("Bad Content");
    expect(html).toContain("<!DOCTYPE html>");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining("Failed to render"),
    );
  });

  it("handles chapter with empty-string title", () => {
    const chapters = [{ id: "ch-1", title: "", content: null, sort_order: 0 }];
    const html = renderHtml(projectInfo, chapters, { includeToc: false });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<h2>");
  });

  it("handles zero chapters (title-page-only)", () => {
    const html = renderHtml(projectInfo, [], { includeToc: true });
    expect(html).toContain("<title>My Novel</title>");
    expect(html).toContain("Jane Doe");
    expect(html).not.toContain("Table of Contents");
  });

  it("shifts heading levels H3→H1, H4→H2, H5→H3 in chapter content", () => {
    const chapters = [
      {
        id: "ch-1",
        title: "Heading Test",
        content: {
          type: "doc",
          content: [
            { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Main heading" }] },
            { type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "Sub heading" }] },
            { type: "heading", attrs: { level: 5 }, content: [{ type: "text", text: "Sub sub heading" }] },
          ],
        },
        sort_order: 0,
      },
    ];
    const html = renderHtml(projectInfo, chapters, { includeToc: false });
    expect(html).toContain("<h1>Main heading</h1>");
    expect(html).toContain("<h2>Sub heading</h2>");
    expect(html).toContain("<h3>Sub sub heading</h3>");
    expect(html).not.toContain("<h3>Main heading</h3>");
    expect(html).not.toContain("<h4>");
    expect(html).not.toContain("<h5>");
  });
});

describe("renderMarkdown", () => {
  it("produces valid Markdown with title and chapters", () => {
    const md = renderMarkdown(projectInfo, sampleChapters, { includeToc: true });
    expect(md).toContain("# My Novel");
    expect(md).toContain("*By Jane Doe*");
    expect(md).toContain("## The Beginning");
    expect(md).toContain("It was a dark and stormy night.");
    expect(md).toContain("## The Middle");
  });

  it("includes TOC with index-based anchor links", () => {
    const md = renderMarkdown(projectInfo, sampleChapters, { includeToc: true });
    expect(md).toContain("## Table of Contents");
    expect(md).toContain("[The Beginning](#chapter-0)");
    expect(md).toContain("[The Middle](#chapter-1)");
  });

  it("omits TOC when includeToc is false", () => {
    const md = renderMarkdown(projectInfo, sampleChapters, { includeToc: false });
    expect(md).not.toContain("Table of Contents");
  });

  it("omits author line when author_name is null", () => {
    const md = renderMarkdown({ ...projectInfo, author_name: null }, sampleChapters, {
      includeToc: false,
    });
    expect(md).not.toContain("By");
  });

  it("handles zero chapters", () => {
    const md = renderMarkdown(projectInfo, [], { includeToc: true });
    expect(md).toContain("# My Novel");
    expect(md).not.toContain("Table of Contents");
  });

  it("uses index-based anchors for duplicate chapter titles", () => {
    const dupeChapters = [
      { id: "ch-1", title: "Interlude", content: null, sort_order: 0 },
      { id: "ch-2", title: "Interlude", content: null, sort_order: 1 },
      { id: "ch-3", title: "Interlude", content: null, sort_order: 2 },
    ];
    const md = renderMarkdown(projectInfo, dupeChapters, { includeToc: true });
    expect(md).toContain("[Interlude](#chapter-0)");
    expect(md).toContain("[Interlude](#chapter-1)");
    expect(md).toContain("[Interlude](#chapter-2)");
  });

  it("uses index-based anchors for non-Latin chapter titles", () => {
    const cjkChapters = [{ id: "ch-1", title: "\u7B2C\u4E00\u7AE0", content: null, sort_order: 0 }];
    const md = renderMarkdown(projectInfo, cjkChapters, { includeToc: true });
    expect(md).toContain("[第一章](#chapter-0)");
  });

  it("shifts heading levels H3→H1, H4→H2 in Markdown output", () => {
    const chapters = [
      {
        id: "ch-1",
        title: "Heading Test",
        content: {
          type: "doc",
          content: [
            { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Main heading" }] },
            { type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "Sub heading" }] },
          ],
        },
        sort_order: 0,
      },
    ];
    const md = renderMarkdown(projectInfo, chapters, { includeToc: false });
    expect(md).toContain("# Main heading");
    expect(md).toContain("## Sub heading");
    expect(md).not.toContain("### Main heading");
  });

  it("emits explicit anchor targets before chapter headings", () => {
    const md = renderMarkdown(projectInfo, sampleChapters, { includeToc: true });
    expect(md).toContain('<a id="chapter-0"></a>');
    expect(md).toContain('<a id="chapter-1"></a>');
  });

  it("escapes Markdown metacharacters in titles and author", () => {
    const mdProject = {
      title: "My *Bold* Novel",
      author_name: "Jane_Doe [editor]",
      slug: "my-bold-novel",
    };
    const mdChapters = [
      { id: "ch-1", title: "Chapter #1: The [Beginning]", content: null, sort_order: 0 },
    ];
    const md = renderMarkdown(mdProject, mdChapters, { includeToc: true });

    // Title metacharacters are escaped
    expect(md).toContain("# My \\*Bold\\* Novel");
    // Author metacharacters are escaped
    expect(md).toContain("*By Jane\\_Doe \\[editor\\]*");
    // Chapter heading metacharacters are escaped
    expect(md).toContain("## Chapter \\#1: The \\[Beginning\\]");
    // TOC link text is escaped with index-based anchor
    expect(md).toContain("[Chapter \\#1: The \\[Beginning\\]](#chapter-0)");
  });
});

describe("renderPlainText", () => {
  it("produces plain text with title and chapters", () => {
    const text = renderPlainText(projectInfo, sampleChapters, { includeToc: false });
    expect(text).toContain("MY NOVEL");
    expect(text).toContain("by Jane Doe");
    expect(text).toContain("The Beginning");
    expect(text).toContain("It was a dark and stormy night.");
    expect(text).toContain("The Middle");
  });

  it("separates chapters with three blank lines", () => {
    const text = renderPlainText(projectInfo, sampleChapters, { includeToc: false });
    expect(text).toContain("\n\n\n\n");
  });

  it("omits author line when author_name is null", () => {
    const text = renderPlainText({ ...projectInfo, author_name: null }, sampleChapters, {
      includeToc: false,
    });
    expect(text).not.toContain("by ");
  });

  it("handles chapters with null content", () => {
    const chapters = [{ id: "ch-1", title: "Empty", content: null, sort_order: 0 }];
    const text = renderPlainText(projectInfo, chapters, { includeToc: false });
    expect(text).toContain("Empty");
  });

  it("handles zero chapters", () => {
    const text = renderPlainText(projectInfo, [], { includeToc: false });
    expect(text).toContain("MY NOVEL");
    expect(text).toContain("by Jane Doe");
  });

  it("includes TOC when includeToc is true", () => {
    const text = renderPlainText(projectInfo, sampleChapters, { includeToc: true });
    expect(text).toContain("Contents");
    expect(text).toContain("The Beginning");
    expect(text).toContain("The Middle");
  });

  it("decodes HTML entities including numeric forms in content", () => {
    const chapters = [
      {
        id: "ch-1",
        title: "Entity Test",
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "She said \u2014 hello \u2026 world" }],
            },
          ],
        },
        sort_order: 0,
      },
    ];
    const text = renderPlainText(projectInfo, chapters, { includeToc: false });
    // Em-dash and ellipsis should appear as UTF-8 characters, not as entity strings
    expect(text).toContain("\u2014");
    expect(text).toContain("\u2026");
    expect(text).not.toContain("&mdash;");
    expect(text).not.toContain("&hellip;");
  });
});

describe("renderDocx", () => {
  it("produces a valid docx buffer", async () => {
    const buf = await renderDocx(projectInfo, sampleChapters, { includeToc: true });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
    // ZIP magic bytes
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it("includes author name when set", async () => {
    const buf = await renderDocx(projectInfo, sampleChapters, { includeToc: false });
    const xml = await docxXml(buf);
    expect(xml).toContain("Jane Doe");
  });

  it("omits author name when null", async () => {
    const buf = await renderDocx(
      { ...projectInfo, author_name: null },
      sampleChapters,
      { includeToc: false },
    );
    const xml = await docxXml(buf);
    expect(xml).not.toContain("Jane Doe");
  });

  it("handles zero chapters (title-page-only)", async () => {
    const buf = await renderDocx(projectInfo, [], { includeToc: true });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("handles chapters with null content", async () => {
    const chapters = [{ id: "ch-1", title: "Empty", content: null, sort_order: 0 }];
    const buf = await renderDocx(projectInfo, chapters, { includeToc: false });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("handles chapters with malformed TipTap JSON gracefully", async () => {
    const chapters = [
      {
        id: "ch-1",
        title: "Bad Content",
        content: { type: "invalid_node" } as Record<string, unknown>,
        sort_order: 0,
      },
    ];
    const buf = await renderDocx(projectInfo, chapters, { includeToc: false });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("handles CJK characters in title and content", async () => {
    const cjkProject = { title: "我的小说", author_name: null, slug: "cjk-novel" };
    const cjkChapters = [
      {
        id: "ch-1",
        title: "第一章",
        content: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "这是第一章的内容。" }] },
          ],
        },
        sort_order: 0,
      },
    ];
    const buf = await renderDocx(cjkProject, cjkChapters, { includeToc: false });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
    const xml = await docxXml(buf);
    expect(xml).toContain("第一章");
  });

  it("uses serif body font", async () => {
    const buf = await renderDocx(projectInfo, sampleChapters, { includeToc: false });
    const zip = await JSZip.loadAsync(buf);
    const stylesFile = zip.file("word/styles.xml");
    const styles = stylesFile ? await stylesFile.async("string") : "";
    expect(styles).toMatch(/Cambria|Times New Roman/);
  });
});

async function epubText(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const texts: string[] = [];
  for (const [path, file] of Object.entries(zip.files)) {
    if (path.endsWith(".xhtml") || path.endsWith(".opf") || path.endsWith(".ncx")) {
      texts.push(await file.async("string"));
    }
  }
  return texts.join("\n");
}

describe("renderEpub", () => {
  it("produces a valid EPUB buffer", async () => {
    const buf = await renderEpub(projectInfo, sampleChapters, { includeToc: true });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
    // ZIP magic bytes
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it("includes metadata in output", async () => {
    const buf = await renderEpub(projectInfo, sampleChapters, { includeToc: true });
    const text = await epubText(buf);
    expect(text).toContain("My Novel");
    expect(text).toContain("Jane Doe");
  });

  it("omits author when null", async () => {
    const buf = await renderEpub(
      { ...projectInfo, author_name: null },
      sampleChapters,
      { includeToc: false },
    );
    const text = await epubText(buf);
    expect(text).not.toContain("Jane Doe");
  });

  it("handles zero chapters (title-page-only)", async () => {
    const buf = await renderEpub(projectInfo, [], { includeToc: true });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("handles chapters with null content", async () => {
    const chapters = [{ id: "ch-1", title: "Empty", content: null, sort_order: 0 }];
    const buf = await renderEpub(projectInfo, chapters, { includeToc: false });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("handles chapters with malformed TipTap JSON gracefully", async () => {
    const chapters = [
      {
        id: "ch-1",
        title: "Bad Content",
        content: { type: "invalid" } as Record<string, unknown>,
        sort_order: 0,
      },
    ];
    const buf = await renderEpub(projectInfo, chapters, { includeToc: false });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("shifts heading levels from H3-H5 to H1-H3", async () => {
    const chapters = [
      {
        id: "ch-1",
        title: "Heading Test",
        content: {
          type: "doc",
          content: [
            { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Main heading" }] },
            { type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "Sub heading" }] },
            { type: "heading", attrs: { level: 5 }, content: [{ type: "text", text: "Sub sub heading" }] },
          ],
        },
        sort_order: 0,
      },
    ];
    const buf = await renderEpub(projectInfo, chapters, { includeToc: false });
    const text = await epubText(buf);
    expect(text).toContain("<h1>");
    expect(text).toContain("<h2>");
    expect(text).toContain("<h3>");
    expect(text).not.toContain("<h4>");
    expect(text).not.toContain("<h5>");
  });

  it("handles CJK characters", async () => {
    const cjkProject = { title: "我的小说", author_name: null, slug: "cjk-novel" };
    const cjkChapters = [
      {
        id: "ch-1",
        title: "第一章",
        content: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "这是第一章的内容。" }] },
          ],
        },
        sort_order: 0,
      },
    ];
    const buf = await renderEpub(cjkProject, cjkChapters, { includeToc: false });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
    const text = await epubText(buf);
    expect(text).toContain("第一章");
  });

  it("includes inline TOC page", async () => {
    // epub-gen-memory always generates an inline TOC page — there is no
    // option to suppress it. We verify it exists with the expected title.
    const buf = await renderEpub(projectInfo, sampleChapters, { includeToc: true });
    const text = await epubText(buf);
    expect(text).toContain("Table of Contents");
  });
});
