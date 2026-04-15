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

const projectInfo = { title: "My Novel", author_name: "Jane Doe" };

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

  it("preserves heading levels H3/H4/H5 in chapter content (subordinate to H2 chapter titles)", () => {
    const chapters = [
      {
        id: "ch-1",
        title: "Heading Test",
        content: {
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 3 },
              content: [{ type: "text", text: "Main heading" }],
            },
            {
              type: "heading",
              attrs: { level: 4 },
              content: [{ type: "text", text: "Sub heading" }],
            },
            {
              type: "heading",
              attrs: { level: 5 },
              content: [{ type: "text", text: "Sub sub heading" }],
            },
          ],
        },
        sort_order: 0,
      },
    ];
    const html = renderHtml(projectInfo, chapters, { includeToc: false });
    // Body headings stay at H3/H4/H5 — correct hierarchy under H1 (title) and H2 (chapter)
    expect(html).toContain("<h3>Main heading</h3>");
    expect(html).toContain("<h4>Sub heading</h4>");
    expect(html).toContain("<h5>Sub sub heading</h5>");
    expect(html).not.toContain("<h1>Main heading</h1>");
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

  it("preserves heading levels H3/H4 in Markdown output (subordinate to ## chapter titles)", () => {
    const chapters = [
      {
        id: "ch-1",
        title: "Heading Test",
        content: {
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 3 },
              content: [{ type: "text", text: "Main heading" }],
            },
            {
              type: "heading",
              attrs: { level: 4 },
              content: [{ type: "text", text: "Sub heading" }],
            },
          ],
        },
        sort_order: 0,
      },
    ];
    const md = renderMarkdown(projectInfo, chapters, { includeToc: false });
    // Body headings stay at ###/#### — correct hierarchy under # (title) and ## (chapter)
    expect(md).toContain("### Main heading");
    expect(md).toContain("#### Sub heading");
    // Body headings should NOT be at top level (# or ##)
    expect(md).not.toMatch(/^# Main heading$/m);
    expect(md).not.toMatch(/^## Main heading$/m);
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
    const buf = await renderDocx({ ...projectInfo, author_name: null }, sampleChapters, {
      includeToc: false,
    });
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
    const cjkProject = { title: "我的小说", author_name: null };
    const cjkChapters = [
      {
        id: "ch-1",
        title: "第一章",
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "这是第一章的内容。" }] }],
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

  it("maps H3→Heading2, H4→Heading3, H5→Heading4 (subordinate to chapter Heading1)", async () => {
    const chapters = [
      {
        id: "ch-1",
        title: "Heading Test",
        content: {
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 3 },
              content: [{ type: "text", text: "Level Three" }],
            },
            {
              type: "heading",
              attrs: { level: 4 },
              content: [{ type: "text", text: "Level Four" }],
            },
            {
              type: "heading",
              attrs: { level: 5 },
              content: [{ type: "text", text: "Level Five" }],
            },
          ],
        },
        sort_order: 0,
      },
    ];
    const buf = await renderDocx(projectInfo, chapters, { includeToc: false });
    const xml = await docxXml(buf);
    expect(xml).toContain("Level Three");
    expect(xml).toContain("Level Four");
    expect(xml).toContain("Level Five");
    // Chapter title is Heading1; body headings are Heading2/3/4
    expect(xml).toMatch(/Heading1/); // chapter title
    expect(xml).toMatch(/Heading2/); // H3
    expect(xml).toMatch(/Heading3/); // H4
    expect(xml).toMatch(/Heading4/); // H5
  });

  it("renders blockquote as indented italic paragraphs", async () => {
    const chapters = [
      {
        id: "ch-1",
        title: "Quote Test",
        content: {
          type: "doc",
          content: [
            {
              type: "blockquote",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "A wise quote." }],
                },
              ],
            },
          ],
        },
        sort_order: 0,
      },
    ];
    const buf = await renderDocx(projectInfo, chapters, { includeToc: false });
    const xml = await docxXml(buf);
    expect(xml).toContain("A wise quote.");
    // Indentation: left indent of 720 twips → w:left="720"
    expect(xml).toContain('w:left="720"');
    // Italic run property
    expect(xml).toMatch(/<w:i\s*\/?>|<w:i w:val="true"/);
  });

  it("renders blockquote with nested heading without losing content", async () => {
    const chapters = [
      {
        id: "ch-1",
        title: "Nested Quote",
        content: {
          type: "doc",
          content: [
            {
              type: "blockquote",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Quote text." }],
                },
                {
                  type: "heading",
                  attrs: { level: 3 },
                  content: [{ type: "text", text: "Heading inside quote" }],
                },
              ],
            },
          ],
        },
        sort_order: 0,
      },
    ];
    const buf = await renderDocx(projectInfo, chapters, { includeToc: false });
    const xml = await docxXml(buf);
    expect(xml).toContain("Quote text.");
    expect(xml).toContain("Heading inside quote");
  });

  it("renders bullet list items", async () => {
    const chapters = [
      {
        id: "ch-1",
        title: "Bullet Test",
        content: {
          type: "doc",
          content: [
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "First bullet" }],
                    },
                  ],
                },
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Second bullet" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        sort_order: 0,
      },
    ];
    const buf = await renderDocx(projectInfo, chapters, { includeToc: false });
    const xml = await docxXml(buf);
    expect(xml).toContain("First bullet");
    expect(xml).toContain("Second bullet");
    // Bullet list numbering reference
    expect(xml).toContain("w:numId");
  });

  it("renders ordered list items with numbering", async () => {
    const chapters = [
      {
        id: "ch-1",
        title: "Ordered Test",
        content: {
          type: "doc",
          content: [
            {
              type: "orderedList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Step one" }],
                    },
                  ],
                },
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Step two" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        sort_order: 0,
      },
    ];
    const buf = await renderDocx(projectInfo, chapters, { includeToc: false });
    const xml = await docxXml(buf);
    expect(xml).toContain("Step one");
    expect(xml).toContain("Step two");
    // Ordered list uses numbering with ilvl
    expect(xml).toContain("w:numId");
    expect(xml).toContain("w:ilvl");
  });

  it("resets ordered list numbering between separate lists", async () => {
    const chapters = [
      {
        id: "ch-1",
        title: "Two Lists",
        content: {
          type: "doc",
          content: [
            {
              type: "orderedList",
              content: [
                {
                  type: "listItem",
                  content: [
                    { type: "paragraph", content: [{ type: "text", text: "First A" }] },
                  ],
                },
              ],
            },
            { type: "paragraph", content: [{ type: "text", text: "Break" }] },
            {
              type: "orderedList",
              content: [
                {
                  type: "listItem",
                  content: [
                    { type: "paragraph", content: [{ type: "text", text: "Second A" }] },
                  ],
                },
              ],
            },
          ],
        },
        sort_order: 0,
      },
    ];
    const buf = await renderDocx(projectInfo, chapters, { includeToc: false });
    const xml = await docxXml(buf);
    // Each ordered list should reference a different numbering ID so they restart
    const numIdMatches = xml.match(/w:numId w:val="(\d+)"/g) ?? [];
    const numIds = numIdMatches.map((m) => m.match(/w:val="(\d+)"/)![1]);
    // Filter to only the two ordered-list numIds (bullet lists also have numIds)
    const uniqueIds = [...new Set(numIds)];
    // There should be at least 2 distinct numbering IDs (one per ordered list)
    expect(uniqueIds.length).toBeGreaterThanOrEqual(2);
  });

  it("renders code block with monospace font and shading", async () => {
    const chapters = [
      {
        id: "ch-1",
        title: "Code Test",
        content: {
          type: "doc",
          content: [
            {
              type: "codeBlock",
              content: [{ type: "text", text: "const x = 1;" }],
            },
          ],
        },
        sort_order: 0,
      },
    ];
    const buf = await renderDocx(projectInfo, chapters, { includeToc: false });
    const xml = await docxXml(buf);
    expect(xml).toContain("const x = 1;");
    // Courier New font
    expect(xml).toContain("Courier New");
    // Shading fill color F0F0F0
    expect(xml).toContain("F0F0F0");
  });

  it("renders horizontal rule as centered '* * *' text", async () => {
    const chapters = [
      {
        id: "ch-1",
        title: "HR Test",
        content: {
          type: "doc",
          content: [{ type: "horizontalRule" }],
        },
        sort_order: 0,
      },
    ];
    const buf = await renderDocx(projectInfo, chapters, { includeToc: false });
    const xml = await docxXml(buf);
    expect(xml).toContain("* * *");
    // Center alignment
    expect(xml).toContain('w:val="center"');
  });

  it("renders inline marks: bold, italic, strike, code", async () => {
    const chapters = [
      {
        id: "ch-1",
        title: "Marks Test",
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "bold text", marks: [{ type: "bold" }] },
                { type: "text", text: "italic text", marks: [{ type: "italic" }] },
                { type: "text", text: "struck text", marks: [{ type: "strike" }] },
                { type: "text", text: "code text", marks: [{ type: "code" }] },
              ],
            },
          ],
        },
        sort_order: 0,
      },
    ];
    const buf = await renderDocx(projectInfo, chapters, { includeToc: false });
    const xml = await docxXml(buf);
    expect(xml).toContain("bold text");
    expect(xml).toContain("italic text");
    expect(xml).toContain("struck text");
    expect(xml).toContain("code text");
    // Bold: <w:b/> or <w:b w:val="true"/>
    expect(xml).toMatch(/<w:b\s*\/?>|<w:b w:val="true"/);
    // Italic: <w:i/> or <w:i w:val="true"/>
    expect(xml).toMatch(/<w:i\s*\/?>|<w:i w:val="true"/);
    // Strikethrough: <w:strike/> or <w:strike w:val="true"/>
    expect(xml).toMatch(/<w:strike\s*\/?>|<w:strike w:val="true"/);
    // Code font
    expect(xml).toContain("Courier New");
  });

  it("renders hard break as line break within a paragraph", async () => {
    const chapters = [
      {
        id: "ch-1",
        title: "Break Test",
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Before break" },
                { type: "hardBreak" },
                { type: "text", text: "After break" },
              ],
            },
          ],
        },
        sort_order: 0,
      },
    ];
    const buf = await renderDocx(projectInfo, chapters, { includeToc: false });
    const xml = await docxXml(buf);
    expect(xml).toContain("Before break");
    expect(xml).toContain("After break");
    // Line break element in docx XML
    expect(xml).toContain("<w:br/>");
  });

  it("logs warning and skips unknown node types", async () => {
    vi.mocked(logger.warn).mockClear();
    const chapters = [
      {
        id: "ch-1",
        title: "Unknown Node",
        content: {
          type: "doc",
          content: [{ type: "customWidget", content: [] }],
        },
        sort_order: 0,
      },
    ];
    const warnSpy = vi.mocked(logger.warn);
    const buf = await renderDocx(projectInfo, chapters, { includeToc: false });
    expect(buf).toBeInstanceOf(Buffer);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ nodeType: "customWidget" }),
      expect.stringContaining("Unknown TipTap node type"),
    );
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
    const buf = await renderEpub({ ...projectInfo, author_name: null }, sampleChapters, {
      includeToc: false,
    });
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

  it("preserves heading levels H3/H4/H5 in EPUB content", async () => {
    const chapters = [
      {
        id: "ch-1",
        title: "Heading Test",
        content: {
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 3 },
              content: [{ type: "text", text: "Main heading" }],
            },
            {
              type: "heading",
              attrs: { level: 4 },
              content: [{ type: "text", text: "Sub heading" }],
            },
            {
              type: "heading",
              attrs: { level: 5 },
              content: [{ type: "text", text: "Sub sub heading" }],
            },
          ],
        },
        sort_order: 0,
      },
    ];
    const buf = await renderEpub(projectInfo, chapters, { includeToc: false });
    const text = await epubText(buf);
    // Body headings stay at H3/H4/H5 — no shift
    expect(text).toContain("<h3>");
    expect(text).toContain("<h4>");
    expect(text).toContain("<h5>");
  });

  it("handles CJK characters", async () => {
    const cjkProject = { title: "我的小说", author_name: null };
    const cjkChapters = [
      {
        id: "ch-1",
        title: "第一章",
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "这是第一章的内容。" }] }],
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

  it("includes inline TOC page with chapter links when includeToc is true", async () => {
    const buf = await renderEpub(projectInfo, sampleChapters, { includeToc: true });
    const text = await epubText(buf);
    expect(text).toContain("Table of Contents");
    expect(text).toContain("The Beginning");
    expect(text).toContain("The Middle");
  });

  it("produces empty TOC page when includeToc is false", async () => {
    const buf = await renderEpub(projectInfo, sampleChapters, { includeToc: false });
    const text = await epubText(buf);
    // TOC page still exists but with no title and no chapter links
    expect(text).not.toContain("Table of Contents");
  });
});
