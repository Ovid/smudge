# Phase 3b: Document Export — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Word (.docx) and EPUB export formats to the existing export pipeline.

**Architecture:** Extends the Phase 3a export pipeline with two new renderers. The docx renderer walks TipTap JSON directly to produce styled Word documents. The EPUB renderer converts TipTap JSON → HTML (reusing `chapterContentToHtml()`) then packages it via `epub-gen-memory`. A shared `shiftHeadingLevels()` helper remaps H3→H1, H4→H2, H5→H3 across all HTML-based formats (HTML, Markdown, EPUB). The `ExportResult.content` type widens from `string` to `string | Buffer` to accommodate binary formats.

**Tech Stack:** `docx` (Word generation), `epub-gen-memory` (EPUB packaging), existing TipTap HTML pipeline

**Design doc:** `docs/plans/2026-04-14-document-export-design.md`

---

## Task 1: Install dependencies and verify licenses

**Files:**
- Modify: `packages/server/package.json`
- Modify: `docs/dependency-licenses.md`

**Step 1: Install docx and epub-gen-memory**

```bash
npm install docx epub-gen-memory -w packages/server
```

**Step 2: Verify licenses**

Check `node_modules/docx/package.json` and `node_modules/epub-gen-memory/package.json` for the `license` field. Both must be MIT (or another acceptable license per CLAUDE.md). If `epub-gen-memory` is not MIT, stop and discuss alternatives.

**Step 3: Update dependency-licenses.md**

Add both packages to the `packages/server` table in `docs/dependency-licenses.md`:

```markdown
| docx | MIT | Programmatic Word (.docx) generation |
| epub-gen-memory | MIT | EPUB generation from HTML content |
```

Update the MIT count in the summary table (+2).

**Step 4: Commit**

```bash
git add packages/server/package.json package-lock.json docs/dependency-licenses.md
git commit -m "chore: add docx and epub-gen-memory dependencies"
```

---

## Task 2: Add heading level shift helper

All export formats should shift TipTap heading levels (H3→H1, H4→H2, H5→H3) in the exported output. This task adds a `shiftHeadingLevels()` helper and retrofits it into the existing HTML and Markdown renderers.

**Files:**
- Modify: `packages/server/src/export/export.renderers.ts`
- Modify: `packages/server/src/__tests__/export.renderers.test.ts`

**Step 1: Write failing tests for shiftHeadingLevels**

Add tests to `export.renderers.test.ts`. Test the helper indirectly through `renderHtml` — after this change, HTML export should output H1/H2/H3 instead of H3/H4/H5.

```typescript
// In the existing renderHtml describe block, add:
it("shifts heading levels from H3-H5 to H1-H3", () => {
  const chapters = [
    {
      id: "ch-1",
      title: "Headings",
      content: {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Main heading" }] },
          { type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "Sub heading" }] },
          { type: "heading", attrs: { level: 5 }, content: [{ type: "text", text: "Sub-sub heading" }] },
        ],
      },
      sort_order: 0,
    },
  ];
  const html = renderHtml(projectInfo, chapters, { includeToc: false });
  expect(html).toContain("<h1>Main heading</h1>");
  expect(html).toContain("<h2>Sub heading</h2>");
  expect(html).toContain("<h3>Sub-sub heading</h3>");
  expect(html).not.toContain("<h3>Main heading</h3>");
  expect(html).not.toContain("<h4>");
  expect(html).not.toContain("<h5>");
});
```

Also add a Markdown test:

```typescript
// In the existing renderMarkdown describe block, add:
it("shifts heading levels from H3-H5 to H1-H3 in chapter content", () => {
  const chapters = [
    {
      id: "ch-1",
      title: "Headings",
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
  // Turndown converts H1 to "# ...", H2 to "## ..."
  // Chapter heading is "## Headings", then content headings:
  expect(md).toContain("# Main heading");
  expect(md).toContain("## Sub heading");
  expect(md).not.toContain("### Main heading");
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -w packages/server -- --run export.renderers
```

Expected: FAIL — HTML currently outputs `<h3>` not `<h1>`.

**Step 3: Implement shiftHeadingLevels helper**

In `export.renderers.ts`, add the helper in the Helpers section:

```typescript
/**
 * Shift heading levels in HTML output: h3→h1, h4→h2, h5→h3.
 * In the editor, H1–H2 are reserved for page structure. In exports,
 * each chapter is its own top-level context.
 */
function shiftHeadingLevels(html: string): string {
  // Process in reverse order (h5→h3 first) to avoid double-shifting
  return html
    .replace(/<(\/?)h5(\s|>)/gi, "<$1h3$2")
    .replace(/<(\/?)h4(\s|>)/gi, "<$1h2$2")
    .replace(/<(\/?)h3(\s|>)/gi, "<$1h1$2");
}
```

Apply it in `chapterContentToHtml()` — change the return to:

```typescript
function chapterContentToHtml(content: Record<string, unknown> | null): string {
  if (!content) return "";
  try {
    const html = generateHTML(content, serverEditorExtensions);
    return shiftHeadingLevels(html);
  } catch (err) {
    logger.warn({ err }, "Failed to render chapter content to HTML during export");
    return "";
  }
}
```

This automatically applies to HTML, Markdown (via Turndown), and EPUB (which will also use `chapterContentToHtml`).

**Step 4: Run tests to verify they pass**

```bash
npm test -w packages/server -- --run export.renderers
```

Expected: PASS

**Step 5: Run full test suite to check for regressions**

```bash
npm test -w packages/server
```

Some existing tests may need updating if they assert `<h3>` in HTML output — these should now expect `<h1>`. Fix any failures.

**Step 6: Commit**

```bash
git add packages/server/src/export/export.renderers.ts packages/server/src/__tests__/export.renderers.test.ts
git commit -m "feat(export): shift heading levels H3-H5 to H1-H3 in all exports"
```

---

## Task 3: Update shared schema for new formats

**Files:**
- Modify: `packages/shared/src/schemas.ts`

**Step 1: Write failing test**

The shared package may not have its own test for the schema. Instead, we'll verify via the service integration tests later. For now, add the formats to the schema.

Actually — verify: does the existing integration test for "invalid format" assert that `"pdf"` is rejected? If so, that test will fail once we change the enum, which is fine — it proves the schema changed. Check `export.service.test.ts` line 230-237: yes, it tests `format: "pdf"` and expects 400. After adding the new formats, `"pdf"` is still invalid, so that test stays valid.

**Step 2: Update ExportFormat enum**

In `packages/shared/src/schemas.ts`:

```typescript
export const ExportFormat = z.enum(["html", "markdown", "plaintext", "docx", "epub"]);
```

**Step 3: Update EXPORT_FILE_EXTENSIONS**

```typescript
export const EXPORT_FILE_EXTENSIONS: Record<ExportFormatType, string> = {
  html: "html",
  markdown: "md",
  plaintext: "txt",
  docx: "docx",
  epub: "epub",
};
```

**Step 4: Update EXPORT_CONTENT_TYPES**

```typescript
export const EXPORT_CONTENT_TYPES: Record<ExportFormatType, string> = {
  html: "text/html; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  plaintext: "text/plain; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  epub: "application/epub+zip",
};
```

**Step 5: Verify typecheck passes**

```bash
npx tsc --noEmit -p packages/shared/tsconfig.json
```

This will fail if the switch statement in `export.service.ts` doesn't handle the new enum values yet. That's expected — we'll fix it in Task 5. For now, just verify the shared package itself compiles.

**Step 6: Commit**

```bash
git add packages/shared/src/schemas.ts
git commit -m "feat(shared): add docx and epub to ExportFormat enum"
```

---

## Task 4: Implement Word (.docx) renderer

**Files:**
- Create: `packages/server/src/export/docx.renderer.ts`
- Modify: `packages/server/src/__tests__/export.renderers.test.ts`

The docx renderer is in its own file because it's substantially larger than the text-based renderers and has different dependencies.

**Step 1: Write failing tests for renderDocx**

Add a new describe block in `export.renderers.test.ts`. Import `renderDocx` from `../export/docx.renderer`. Since `docx` produces binary output (Buffer), we need to parse the output to verify structure. The `docx` library's `Packer.toBuffer()` returns a zip (docx is a zip of XML files). We can use the `Document` type to inspect the tree before packing, or we can pack to buffer and just verify it's a valid zip with expected content.

The pragmatic approach: test the renderer produces a Buffer of non-zero size, and test the JSON tree structure before packing by exposing internal helper functions or by parsing the XML from the zip.

Simplest approach: test via the public `renderDocx()` function which returns a `Promise<Buffer>`. Verify:
- Returns a Buffer
- Buffer is non-empty
- Buffer starts with the ZIP magic bytes (`PK`, i.e., `0x50 0x4B`)
- Test with/without TOC, with/without author name, with zero chapters

```typescript
import { renderDocx } from "../export/docx.renderer";

describe("renderDocx", () => {
  it("produces a valid docx buffer", async () => {
    const buf = await renderDocx(projectInfo, sampleChapters, { includeToc: true });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
    // DOCX is a ZIP file — verify magic bytes
    expect(buf[0]).toBe(0x50); // 'P'
    expect(buf[1]).toBe(0x4b); // 'K'
  });

  it("includes author name when set", async () => {
    const buf = await renderDocx(projectInfo, sampleChapters, { includeToc: false });
    // Convert to string to search XML content (docx is a zip of XML)
    const text = buf.toString("utf-8");
    expect(text).toContain("Jane Doe");
  });

  it("omits author name when null", async () => {
    const buf = await renderDocx(
      { ...projectInfo, author_name: null },
      sampleChapters,
      { includeToc: false },
    );
    const text = buf.toString("utf-8");
    expect(text).not.toContain("Jane Doe");
  });

  it("handles zero chapters (title-page-only)", async () => {
    const buf = await renderDocx(projectInfo, [], { includeToc: false });
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
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -w packages/server -- --run export.renderers
```

Expected: FAIL — `docx.renderer.ts` doesn't exist yet.

**Step 3: Implement renderDocx**

Create `packages/server/src/export/docx.renderer.ts`:

```typescript
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageBreak,
  TableOfContents,
  LevelFormat,
} from "docx";
import type { ExportProjectInfo, ExportChapter, RenderOptions } from "./export.renderers";
import { logger } from "../logger";

// Map TipTap heading levels to Word heading levels
const HEADING_MAP: Record<number, typeof HeadingLevel[keyof typeof HeadingLevel]> = {
  3: HeadingLevel.HEADING_1,
  4: HeadingLevel.HEADING_2,
  5: HeadingLevel.HEADING_3,
};

interface TipTapNode {
  type: string;
  content?: TipTapNode[];
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

function hasMark(node: TipTapNode, markType: string): boolean {
  return node.marks?.some((m) => m.type === markType) ?? false;
}

function nodeToTextRuns(node: TipTapNode): TextRun[] {
  if (node.type === "text" && node.text) {
    return [
      new TextRun({
        text: node.text,
        bold: hasMark(node, "bold"),
        italics: hasMark(node, "italic"),
        strike: hasMark(node, "strike"),
        font: hasMark(node, "code") ? { name: "Courier New" } : undefined,
      }),
    ];
  }

  if (node.type === "hardBreak") {
    return [new TextRun({ break: 1 })];
  }

  // Recurse into child nodes
  if (node.content) {
    return node.content.flatMap((child) => nodeToTextRuns(child));
  }

  return [];
}

function tipTapToParagraphs(content: Record<string, unknown> | null): Paragraph[] {
  if (!content) return [];

  const doc = content as { type: string; content?: TipTapNode[] };
  if (doc.type !== "doc" || !doc.content) return [];

  const paragraphs: Paragraph[] = [];

  for (const node of doc.content) {
    try {
      switch (node.type) {
        case "paragraph": {
          const runs = node.content ? node.content.flatMap(nodeToTextRuns) : [];
          paragraphs.push(new Paragraph({ children: runs }));
          break;
        }

        case "heading": {
          const level = (node.attrs?.level as number) ?? 3;
          const headingLevel = HEADING_MAP[level] ?? HeadingLevel.HEADING_1;
          const runs = node.content ? node.content.flatMap(nodeToTextRuns) : [];
          paragraphs.push(new Paragraph({ heading: headingLevel, children: runs }));
          break;
        }

        case "blockquote": {
          // Render blockquote children as indented italic paragraphs
          if (node.content) {
            for (const child of node.content) {
              const runs = child.content
                ? child.content.flatMap(nodeToTextRuns).map(
                    (run) =>
                      new TextRun({
                        ...run,
                        italics: true,
                      }),
                  )
                : [];
              paragraphs.push(
                new Paragraph({
                  children: runs,
                  indent: { left: 720 }, // 0.5 inch in twips
                }),
              );
            }
          }
          break;
        }

        case "bulletList": {
          if (node.content) {
            for (const listItem of node.content) {
              if (listItem.type === "listItem" && listItem.content) {
                for (const child of listItem.content) {
                  const runs = child.content ? child.content.flatMap(nodeToTextRuns) : [];
                  paragraphs.push(
                    new Paragraph({
                      children: runs,
                      bullet: { level: 0 },
                    }),
                  );
                }
              }
            }
          }
          break;
        }

        case "orderedList": {
          if (node.content) {
            for (const [idx, listItem] of node.content.entries()) {
              if (listItem.type === "listItem" && listItem.content) {
                for (const child of listItem.content) {
                  const runs = child.content ? child.content.flatMap(nodeToTextRuns) : [];
                  paragraphs.push(
                    new Paragraph({
                      children: runs,
                      numbering: { reference: "ordered-list", level: 0 },
                    }),
                  );
                }
              }
            }
          }
          break;
        }

        case "codeBlock": {
          const codeText = node.content?.map((c) => c.text ?? "").join("") ?? "";
          for (const line of codeText.split("\n")) {
            paragraphs.push(
              new Paragraph({
                children: [new TextRun({ text: line, font: { name: "Courier New" }, size: 20 })],
                shading: { fill: "F0F0F0" },
              }),
            );
          }
          break;
        }

        case "horizontalRule": {
          paragraphs.push(
            new Paragraph({
              children: [new TextRun({ text: "* * *" })],
              alignment: AlignmentType.CENTER,
              spacing: { before: 400, after: 400 },
            }),
          );
          break;
        }

        default:
          // Unknown node type — skip silently
          break;
      }
    } catch (err) {
      logger.warn({ err, nodeType: node.type }, "Failed to convert TipTap node to docx");
    }
  }

  return paragraphs;
}

export async function renderDocx(
  project: ExportProjectInfo,
  chapters: ExportChapter[],
  options: RenderOptions,
): Promise<Buffer> {
  const sections: Paragraph[] = [];

  // Title page
  sections.push(
    new Paragraph({
      children: [new TextRun({ text: project.title, bold: true, size: 56 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
  );

  if (project.author_name) {
    sections.push(
      new Paragraph({
        children: [new TextRun({ text: project.author_name, italics: true, size: 28 })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      }),
    );
  }

  // Page break after title
  sections.push(new Paragraph({ children: [new PageBreak()] }));

  // Table of contents (Word-native TOC field)
  if (options.includeToc && chapters.length > 0) {
    sections.push(
      new Paragraph({
        children: [new TextRun({ text: "Table of Contents", bold: true, size: 32 })],
        spacing: { after: 300 },
      }),
    );
    // This inserts a Word TOC field that auto-populates on open
    const toc = new TableOfContents("TOC", {
      hyperlink: true,
      headingStyleRange: "1-3",
    });
    // TableOfContents is added as a child of the document, not a paragraph
    // We'll handle this in the document construction below
    sections.push(new Paragraph({ children: [new PageBreak()] }));
  }

  // Chapters
  for (const [i, chapter] of chapters.entries()) {
    // Page break before each chapter (except if right after TOC page break)
    if (i > 0 || (options.includeToc && chapters.length > 0)) {
      // Only add page break if not already added one
      if (i > 0) {
        sections.push(new Paragraph({ children: [new PageBreak()] }));
      }
    }

    // Chapter title as Heading 1
    sections.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: chapter.title })],
        spacing: { after: 300 },
      }),
    );

    // Chapter content
    const contentParagraphs = tipTapToParagraphs(chapter.content);
    sections.push(...contentParagraphs);
  }

  const docChildren: (Paragraph | TableOfContents)[] = [];

  // Build the final children list with TOC in the right place
  if (options.includeToc && chapters.length > 0) {
    // Title page elements (before TOC)
    // First element is title, second is author (maybe), then page break
    let tocInsertIndex = 0;
    for (const p of sections) {
      docChildren.push(p);
      tocInsertIndex++;
      // After the first page break, insert the TOC
      if (tocInsertIndex === (project.author_name ? 3 : 2)) {
        // Insert TOC heading (already in sections), then the TOC field
        docChildren.push(
          new TableOfContents("Table of Contents", {
            hyperlink: true,
            headingStyleRange: "1-3",
          }),
        );
      }
    }
  } else {
    docChildren.push(...sections);
  }

  const doc = new Document({
    features: { updateFields: true },
    numbering: {
      config: [
        {
          reference: "ordered-list",
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.LEFT,
            },
          ],
        },
      ],
    },
    sections: [
      {
        children: docChildren,
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
```

Note: The exact `docx` API may need adjustments based on the installed version. The implementer should check `docx` docs and type signatures during implementation. The key architectural decisions are:
- Walk TipTap JSON directly (no HTML intermediate)
- Map heading levels (3→1, 4→2, 5→3)
- Use Word-native TOC with `updateFields: true`
- Return a Buffer
- Graceful error handling per node

**Step 4: Run tests to verify they pass**

```bash
npm test -w packages/server -- --run export.renderers
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/export/docx.renderer.ts packages/server/src/__tests__/export.renderers.test.ts
git commit -m "feat(export): add Word (.docx) renderer"
```

---

## Task 5: Implement EPUB renderer

**Files:**
- Create: `packages/server/src/export/epub.renderer.ts`
- Modify: `packages/server/src/__tests__/export.renderers.test.ts`

**Step 1: Write failing tests for renderEpub**

Add a new describe block in `export.renderers.test.ts`:

```typescript
import { renderEpub } from "../export/epub.renderer";

describe("renderEpub", () => {
  it("produces a valid EPUB buffer", async () => {
    const buf = await renderEpub(projectInfo, sampleChapters, { includeToc: true });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
    // EPUB is a ZIP file — verify magic bytes
    expect(buf[0]).toBe(0x50); // 'P'
    expect(buf[1]).toBe(0x4b); // 'K'
  });

  it("includes metadata in output", async () => {
    const buf = await renderEpub(projectInfo, sampleChapters, { includeToc: true });
    const text = buf.toString("utf-8");
    expect(text).toContain("My Novel");
    expect(text).toContain("Jane Doe");
  });

  it("omits author when null", async () => {
    const buf = await renderEpub(
      { ...projectInfo, author_name: null },
      sampleChapters,
      { includeToc: false },
    );
    const text = buf.toString("utf-8");
    expect(text).not.toContain("Jane Doe");
  });

  it("handles zero chapters (title-page-only)", async () => {
    const buf = await renderEpub(projectInfo, [], { includeToc: false });
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
        title: "Bad",
        content: { type: "invalid" } as Record<string, unknown>,
        sort_order: 0,
      },
    ];
    const buf = await renderEpub(projectInfo, chapters, { includeToc: false });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -w packages/server -- --run export.renderers
```

Expected: FAIL — `epub.renderer.ts` doesn't exist yet.

**Step 3: Implement renderEpub**

Create `packages/server/src/export/epub.renderer.ts`. The `epub-gen-memory` library API takes a config object with title, author, content (array of chapters with title and HTML data), and optional CSS.

```typescript
import EPub from "epub-gen-memory";
import { chapterContentToHtml } from "./export.renderers";
import type { ExportProjectInfo, ExportChapter, RenderOptions } from "./export.renderers";

const EPUB_CSS = `
body {
  font-family: Georgia, "Times New Roman", serif;
  line-height: 1.6;
  margin: 1em;
}
h1 { font-size: 1.8em; margin: 1em 0 0.5em; }
h2 { font-size: 1.4em; margin: 0.8em 0 0.4em; }
h3 { font-size: 1.2em; margin: 0.6em 0 0.3em; }
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
`;

export async function renderEpub(
  project: ExportProjectInfo,
  chapters: ExportChapter[],
  options: RenderOptions,
): Promise<Buffer> {
  const epubChapters = chapters.map((ch) => {
    let html = chapterContentToHtml(ch.content);
    // If content is empty, use a non-breaking space so epub-gen-memory
    // doesn't choke on an empty chapter
    if (!html) {
      html = "<p>&nbsp;</p>";
    }
    return {
      title: ch.title,
      data: html,
    };
  });

  // If zero chapters, create a title-page-only EPUB
  if (epubChapters.length === 0) {
    const titleHtml = project.author_name
      ? `<h1>${escapeHtml(project.title)}</h1><p><em>${escapeHtml(project.author_name)}</em></p>`
      : `<h1>${escapeHtml(project.title)}</h1>`;
    epubChapters.push({ title: project.title, data: titleHtml });
  }

  const epubConfig = {
    title: project.title,
    author: project.author_name ?? "",
    lang: "en",
    css: EPUB_CSS,
    content: epubChapters,
    // tocTitle will be used if includeToc is true
    ...(options.includeToc ? { tocTitle: "Table of Contents" } : { tocTitle: false as const }),
  };

  const buffer = await new EPub(epubConfig).genEpub();
  return Buffer.from(buffer);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
```

**Important:** The `chapterContentToHtml` function must be exported from `export.renderers.ts` so the EPUB renderer can use it. Add `export` to its declaration:

In `export.renderers.ts`, change:
```typescript
function chapterContentToHtml(content: Record<string, unknown> | null): string {
```
to:
```typescript
export function chapterContentToHtml(content: Record<string, unknown> | null): string {
```

**Note:** The exact `epub-gen-memory` API may differ from what's shown. The implementer should check the installed version's types and README. Key points:
- Constructor takes config with `title`, `author`, `content` array, `css`
- `genEpub()` returns a Promise<Buffer>
- Each content entry has `title` and `data` (HTML string)

**Step 4: Run tests to verify they pass**

```bash
npm test -w packages/server -- --run export.renderers
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/export/epub.renderer.ts packages/server/src/export/export.renderers.ts packages/server/src/__tests__/export.renderers.test.ts
git commit -m "feat(export): add EPUB renderer"
```

---

## Task 6: Wire new renderers into export service

**Files:**
- Modify: `packages/server/src/export/export.service.ts`
- Modify: `packages/server/src/__tests__/export.service.test.ts`

**Step 1: Write failing integration tests**

Add test cases for docx and epub in `export.service.test.ts`:

```typescript
describe("DOCX export", () => {
  it("exports as Word document", async () => {
    const { projectSlug } = await createProjectWithChapters(t.app);

    const res = await request(t.app)
      .post(`/api/projects/${projectSlug}/export`)
      .send({ format: "docx" })
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(res.headers["content-disposition"]).toContain(`filename="${projectSlug}.docx"`);
    expect(res.body).toBeInstanceOf(Buffer);
    expect(res.body.length).toBeGreaterThan(0);
  });
});

describe("EPUB export", () => {
  it("exports as EPUB", async () => {
    const { projectSlug } = await createProjectWithChapters(t.app);

    const res = await request(t.app)
      .post(`/api/projects/${projectSlug}/export`)
      .send({ format: "epub" })
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/epub+zip");
    expect(res.headers["content-disposition"]).toContain(`filename="${projectSlug}.epub"`);
    expect(res.body).toBeInstanceOf(Buffer);
    expect(res.body.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -w packages/server -- --run export.service
```

Expected: FAIL — the service doesn't handle `"docx"` or `"epub"` formats yet (though Zod validation now accepts them, the switch statement has no case for them).

**Step 3: Update export service**

Modify `packages/server/src/export/export.service.ts`:

1. Update the `ExportResult` interface:
```typescript
interface ExportResult {
  content: string | Buffer;
  contentType: string;
  filename: string;
}
```

2. Import new renderers:
```typescript
import { renderDocx } from "./docx.renderer";
import { renderEpub } from "./epub.renderer";
```

3. Change `let content: string;` to `let content: string | Buffer;`

4. Add cases to the switch:
```typescript
case "docx":
  content = await renderDocx(projectInfo, exportChapters, options);
  break;
case "epub":
  content = await renderEpub(projectInfo, exportChapters, options);
  break;
```

5. Since `renderDocx` and `renderEpub` are async, the switch statement now includes async calls. The function is already async, so this works.

**Step 4: Run tests to verify they pass**

```bash
npm test -w packages/server -- --run export.service
```

Expected: PASS

**Step 5: Run full server test suite**

```bash
npm test -w packages/server
```

Expected: PASS (including existing export tests)

**Step 6: Commit**

```bash
git add packages/server/src/export/export.service.ts packages/server/src/__tests__/export.service.test.ts
git commit -m "feat(export): wire docx and epub renderers into export service"
```

---

## Task 7: Update client — strings, API type, and ExportDialog

**Files:**
- Modify: `packages/client/src/strings.ts`
- Modify: `packages/client/src/api/client.ts`
- Modify: `packages/client/src/components/ExportDialog.tsx`

**Step 1: Update strings.ts**

Add format labels to the export section in `packages/client/src/strings.ts`:

After `formatPlainText: "Plain Text",` add:
```typescript
formatDocx: "Word (.docx)",
formatEpub: "EPUB",
```

**Step 2: Update API client type**

In `packages/client/src/api/client.ts`, update the format type in the export method (line 109):

```typescript
format: "html" | "markdown" | "plaintext" | "docx" | "epub";
```

**Step 3: Update ExportDialog.tsx**

Add two more radio buttons to the format fieldset, after the Plain Text radio. The format fieldset currently uses a `flex gap-4` layout with three radios on one line. With five options, this needs to wrap. Change the container from `flex gap-4` to `flex flex-wrap gap-x-4 gap-y-2`:

```tsx
<div className="flex flex-wrap gap-x-4 gap-y-2">
  {/* existing three radios */}
  <label className="flex items-center gap-1.5 text-sm text-text-secondary">
    <input
      type="radio"
      name="export-format"
      value="docx"
      checked={format === "docx"}
      onChange={() => setFormat("docx")}
    />
    {STRINGS.export.formatDocx}
  </label>
  <label className="flex items-center gap-1.5 text-sm text-text-secondary">
    <input
      type="radio"
      name="export-format"
      value="epub"
      checked={format === "epub"}
      onChange={() => setFormat("epub")}
    />
    {STRINGS.export.formatEpub}
  </label>
</div>
```

**Step 4: Verify typecheck passes**

```bash
npx tsc --noEmit
```

**Step 5: Run client tests**

```bash
npm test -w packages/client
```

Some tests may need updating if they assert the number of radio buttons or specific format options.

**Step 6: Commit**

```bash
git add packages/client/src/strings.ts packages/client/src/api/client.ts packages/client/src/components/ExportDialog.tsx
git commit -m "feat(export): add docx and epub options to export dialog"
```

---

## Task 8: Update e2e tests

**Files:**
- Modify: `e2e/export.spec.ts`

**Step 1: Add e2e tests for new formats**

Add tests in `e2e/export.spec.ts`:

```typescript
test("exports manuscript as Word (.docx) via dialog", async ({ page }) => {
  await page.goto(`/projects/${project.slug}`);
  const editor = page.getByRole("textbox");
  await expect(editor).toBeVisible();

  const exportButton = page.getByRole("button", { name: "Export", exact: true });
  await exportButton.click();
  await expect(page.getByText("Export Manuscript")).toBeVisible();

  // Select Word format
  const docxRadio = page.getByRole("radio", { name: "Word (.docx)" });
  await docxRadio.check();

  const downloadPromise = page.waitForEvent("download");
  const dialogExportButton = page.locator("dialog button", { hasText: "Export" }).last();
  await dialogExportButton.click();

  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain(".docx");
});

test("exports manuscript as EPUB via dialog", async ({ page }) => {
  await page.goto(`/projects/${project.slug}`);
  const editor = page.getByRole("textbox");
  await expect(editor).toBeVisible();

  const exportButton = page.getByRole("button", { name: "Export", exact: true });
  await exportButton.click();
  await expect(page.getByText("Export Manuscript")).toBeVisible();

  // Select EPUB format
  const epubRadio = page.getByRole("radio", { name: "EPUB" });
  await epubRadio.check();

  const downloadPromise = page.waitForEvent("download");
  const dialogExportButton = page.locator("dialog button", { hasText: "Export" }).last();
  await dialogExportButton.click();

  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain(".epub");
});

test("export dialog shows all five format options", async ({ page }) => {
  await page.goto(`/projects/${project.slug}`);
  const editor = page.getByRole("textbox");
  await expect(editor).toBeVisible();

  const exportButton = page.getByRole("button", { name: "Export", exact: true });
  await exportButton.click();
  await expect(page.getByText("Export Manuscript")).toBeVisible();

  // Verify all five format radios exist
  await expect(page.getByRole("radio", { name: "HTML" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Markdown" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Plain Text" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Word (.docx)" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "EPUB" })).toBeVisible();
});
```

**Step 2: Run e2e tests**

```bash
make e2e
```

Expected: PASS

**Step 3: Commit**

```bash
git add e2e/export.spec.ts
git commit -m "test(export): add e2e tests for docx and epub export"
```

---

## Task 9: Full validation pass

**Step 1: Run full CI suite**

```bash
make all
```

This runs lint + format + typecheck + coverage + e2e. Fix any issues.

**Step 2: Manual smoke test**

Start the dev server (`make dev`), create a project with a few chapters containing varied content (headings, bold, italic, lists, blockquotes), and export as:
- HTML — verify headings are H1/H2/H3 (not H3/H4/H5)
- Markdown — verify headings are #/##/### 
- Word (.docx) — open in Word/LibreOffice, verify structure, styles, TOC
- EPUB — open in an EPUB reader (Apple Books, Calibre), verify chapters, navigation, styling

**Step 3: Commit any fixes from validation**

```bash
git add -A
git commit -m "fix(export): address issues found during validation"
```
