# Phase 3b: Document Export — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Word (.docx) and EPUB export formats to the existing export pipeline.

**Architecture:** Extends the Phase 3a export pipeline with two new renderers. The docx renderer walks TipTap JSON directly to produce styled Word documents. The EPUB renderer converts TipTap JSON → HTML (reusing `chapterContentToHtml()`) then packages it via `epub-gen-memory`. A shared `shiftHeadingLevels()` helper remaps H3→H1, H4→H2, H5→H3 across all HTML-based formats (HTML, Markdown, EPUB). The `ExportResult.content` type widens from `string` to `string | Buffer` to accommodate binary formats.

**Tech Stack:** `docx` (Word generation), `epub-gen-memory` (EPUB packaging), existing TipTap HTML pipeline

**Design doc:** `docs/plans/2026-04-14-document-export-design.md`

**Task order rationale:** Renderers (Tasks 3-4) are developed before the schema change (Task 5) because adding new values to the `ExportFormat` Zod enum breaks TypeScript's exhaustiveness check on the service's switch statement. By building and testing renderers first, then updating the schema and wiring everything together in one task, we avoid a broken typecheck window.

---

## Task 1: Install dependencies and verify licenses

**Requirement:** Design §Integration — `docx` and `epub-gen-memory` as production dependencies

**Files:**
- Modify: `packages/server/package.json`
- Modify: `docs/dependency-licenses.md`

#### RED
- No test for this task — it's dependency installation and documentation.

#### GREEN

**Step 1: Install packages**

```bash
npm install docx epub-gen-memory -w packages/server
```

**Step 2: Verify licenses**

Check `node_modules/docx/package.json` and `node_modules/epub-gen-memory/package.json` for the `license` field. Both must be MIT (or another acceptable license per CLAUDE.md). If `epub-gen-memory` is NOT MIT, stop and discuss — fallbacks are `epub-gen` or manual EPUB assembly with a zip library.

**Step 3: Update dependency-licenses.md**

Add both packages to the `packages/server` table in `docs/dependency-licenses.md`:

```markdown
| docx | MIT | Programmatic Word (.docx) generation |
| epub-gen-memory | MIT | EPUB generation from HTML content |
```

Update the MIT count in the summary table (+2).

#### REFACTOR
- No refactoring needed.

**Step 4: Commit**

```bash
git add packages/server/package.json package-lock.json docs/dependency-licenses.md
git commit -m "chore: add docx and epub-gen-memory dependencies"
```

---

## Task 2: Add heading level shift helper

**Requirement:** Design §Heading Level Shift — all export formats shift H3→H1, H4→H2, H5→H3

All export formats should shift TipTap heading levels in the exported output. This task adds a `shiftHeadingLevels()` helper inside `chapterContentToHtml()` and retrofits it into the existing HTML and Markdown renderers. Also exports `chapterContentToHtml` and `escapeHtml` so the EPUB renderer (Task 4) can reuse them.

**Files:**
- Modify: `packages/server/src/export/export.renderers.ts`
- Modify: `packages/server/src/__tests__/export.renderers.test.ts`

#### RED
- Write tests that verify heading shift through `renderHtml` and `renderMarkdown`
- Expected failure: HTML currently outputs `<h3>` not `<h1>`

Add to the `renderHtml` describe block:

```typescript
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

Add to the `renderMarkdown` describe block:

```typescript
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
  expect(md).toContain("# Main heading");
  expect(md).toContain("## Sub heading");
  expect(md).not.toContain("### Main heading");
});
```

Run: `npm test -w packages/server -- --run export.renderers`
Expected: FAIL

#### GREEN

Add the `shiftHeadingLevels` helper in the Helpers section of `export.renderers.ts`:

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

Apply it in `chapterContentToHtml()`:

```typescript
export function chapterContentToHtml(content: Record<string, unknown> | null): string {
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

Also export `escapeHtml` so the EPUB renderer can reuse it (Task 4):

```typescript
export function escapeHtml(text: string): string {
```

Run: `npm test -w packages/server -- --run export.renderers`
Expected: PASS

#### REFACTOR

Run the full server test suite (`npm test -w packages/server`) and fix any regressions. Existing tests that assert `<h3>` in HTML output should now expect `<h1>`.

Look for:
- Existing tests that break due to heading shift
- Any duplication introduced by the export

**Commit:**

```bash
git add packages/server/src/export/export.renderers.ts packages/server/src/__tests__/export.renderers.test.ts
git commit -m "feat(export): shift heading levels H3-H5 to H1-H3 in all exports"
```

---

## Task 3: Implement Word (.docx) renderer

**Requirement:** Design §Word (.docx) — full TipTap-to-Word style mapping, Word-native TOC, serif body font

The docx renderer is in its own file because it's substantially larger than the text-based renderers and has different dependencies.

**Files:**
- Create: `packages/server/src/export/docx.renderer.ts`
- Modify: `packages/server/src/__tests__/export.renderers.test.ts`

#### RED
- Write tests for `renderDocx()` which returns a `Promise<Buffer>`
- Expected failure: `docx.renderer.ts` doesn't exist yet
- If any test passes unexpectedly: the import succeeded without the file, which means there's a naming collision

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

  it("handles CJK characters in title and content", async () => {
    const cjkProject = { ...projectInfo, title: "我的小说", author_name: "作者" };
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
    const text = buf.toString("utf-8");
    expect(text).toContain("第一章");
  });

  it("uses serif body font", async () => {
    const buf = await renderDocx(projectInfo, sampleChapters, { includeToc: false });
    const text = buf.toString("utf-8");
    // Document XML should reference a serif font (Cambria or Times New Roman)
    expect(text).toMatch(/Cambria|Times New Roman/);
  });
});
```

Run: `npm test -w packages/server -- --run export.renderers`
Expected: FAIL

#### GREEN

Create `packages/server/src/export/docx.renderer.ts`.

**Key architectural decisions:**
- Walk TipTap JSON directly (no HTML intermediate)
- Map heading levels: TipTap H3→Word Heading 1, H4→Heading 2, H5→Heading 3
- Use Word-native TOC via `TableOfContents` with `headingStyleRange: "1-3"` and `hyperlink: true`
- Create `Document` with `features: { updateFields: true }` so Word populates the TOC on first open
- Set document-level default font to a serif (Cambria or Times New Roman) via `styles.default.document.run.font`
- Return a `Buffer` via `Packer.toBuffer()`
- Graceful error handling per TipTap node (try/catch, log warning, skip)

**Document assembly — build children list sequentially, not via index splicing:**

```typescript
const children: (Paragraph | TableOfContents)[] = [];

// 1. Title page
children.push(titleParagraph);
if (project.author_name) children.push(authorParagraph);
children.push(pageBreakParagraph);

// 2. TOC (if requested and chapters exist)
if (options.includeToc && chapters.length > 0) {
  children.push(new TableOfContents("Table of Contents", {
    hyperlink: true,
    headingStyleRange: "1-3",
  }));
  children.push(pageBreakParagraph);
}

// 3. Chapters
for (const [i, chapter] of chapters.entries()) {
  if (i > 0) children.push(pageBreakParagraph);
  children.push(chapterHeadingParagraph);
  children.push(...contentParagraphs);
}
```

**TipTap to Word mapping:**

| TipTap Node | Word Style |
|---|---|
| `heading` level 3 | `HeadingLevel.HEADING_1` |
| `heading` level 4 | `HeadingLevel.HEADING_2` |
| `heading` level 5 | `HeadingLevel.HEADING_3` |
| `paragraph` | Normal (default) |
| `blockquote` | Indented italic paragraphs (`indent: { left: 720 }`) |
| `bulletList` | `bullet: { level: 0 }` |
| `orderedList` | `numbering: { reference: "ordered-list", level: 0 }` |
| `codeBlock` | Monospace font (`Courier New`), light background shading |
| `horizontalRule` | Centered `* * *` text |

**Inline marks:** `bold`, `italic`, `strike` → direct `TextRun` properties. `code` → `font: { name: "Courier New" }`.

**Blockquote note:** Do NOT spread a `TextRun` instance — `TextRun` is a class, not a plain object. Instead, extract the text and marks from the child nodes and create new `TextRun` instances with `italics: true` added.

Run: `npm test -w packages/server -- --run export.renderers`
Expected: PASS

#### REFACTOR

Look for:
- Any duplicated helper logic between docx renderer and existing renderers
- Hard-coded font sizes that should be constants
- Naming consistency with existing renderer pattern

**Commit:**

```bash
git add packages/server/src/export/docx.renderer.ts packages/server/src/__tests__/export.renderers.test.ts
git commit -m "feat(export): add Word (.docx) renderer"
```

---

## Task 4: Implement EPUB renderer

**Requirement:** Design §EPUB — HTML content via `chapterContentToHtml()`, embedded stylesheet, metadata, empty chapter handling

**Files:**
- Create: `packages/server/src/export/epub.renderer.ts`
- Modify: `packages/server/src/__tests__/export.renderers.test.ts`

#### RED
- Write tests for `renderEpub()` which returns a `Promise<Buffer>`
- Expected failure: `epub.renderer.ts` doesn't exist yet

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

  it("shifts heading levels from H3-H5 to H1-H3", async () => {
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
    const buf = await renderEpub(projectInfo, chapters, { includeToc: false });
    const text = buf.toString("utf-8");
    expect(text).toContain("<h1>Main heading</h1>");
    expect(text).toContain("<h2>Sub heading</h2>");
    expect(text).toContain("<h3>Sub-sub heading</h3>");
    expect(text).not.toContain("<h4>");
    expect(text).not.toContain("<h5>");
  });

  it("handles CJK characters", async () => {
    const cjkProject = { ...projectInfo, title: "我的小说", author_name: "作者" };
    const cjkChapters = [
      {
        id: "ch-1",
        title: "第一章",
        content: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "这是内容。" }] },
          ],
        },
        sort_order: 0,
      },
    ];
    const buf = await renderEpub(cjkProject, cjkChapters, { includeToc: false });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
    const text = buf.toString("utf-8");
    expect(text).toContain("第一章");
  });
});
```

Run: `npm test -w packages/server -- --run export.renderers`
Expected: FAIL

#### GREEN

Create `packages/server/src/export/epub.renderer.ts`.

**Key decisions:**
- Import `chapterContentToHtml` and `escapeHtml` from `./export.renderers` — do NOT duplicate them
- Content conversion: TipTap JSON → HTML via `chapterContentToHtml()` (heading shift already applied in Task 2)
- Embed a minimal CSS stylesheet (serif font, comfortable line-height, heading sizes, blockquote/code styling)
- Metadata: title from project, author from `author_name` (empty string if null), language hard-coded to `"en"`
- Empty chapter handling: if `chapterContentToHtml()` returns `""`, inject `<p>&nbsp;</p>` as placeholder
- Zero chapters: create a title-page-only EPUB with one section containing the title and author

**`epub-gen-memory` API shape** (verify against installed version's types):
- Constructor: `new EPub({ title, author, lang, css, content, tocTitle })`
- `content`: array of `{ title: string, data: string }` (HTML)
- `tocTitle`: string or `false` to disable
- `genEpub()`: returns `Promise<Buffer>`

Run: `npm test -w packages/server -- --run export.renderers`
Expected: PASS

#### REFACTOR

Look for:
- Verify no duplicated `escapeHtml` — should be imported from `export.renderers.ts`
- CSS string could be extracted to a constant file if it grows, but for now inline is fine

**Commit:**

```bash
git add packages/server/src/export/epub.renderer.ts packages/server/src/__tests__/export.renderers.test.ts
git commit -m "feat(export): add EPUB renderer"
```

---

## Task 5: Update shared schema and wire renderers into export service

**Requirement:** Design §Integration — add formats to Zod enum, widen ExportResult type, add switch cases

This task combines the schema change and service wiring so there's no window where TypeScript's exhaustiveness check fails.

**Files:**
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/server/src/export/export.service.ts`
- Modify: `packages/server/src/__tests__/export.service.test.ts`

#### RED
- Write integration tests for docx and epub export via the HTTP API
- Expected failure: Zod rejects `"docx"` and `"epub"` as invalid formats (400 response)

Add to `export.service.test.ts`:

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

  it("includes author_name in docx when set", async () => {
    const { projectSlug } = await createProjectWithChapters(t.app, {
      authorName: "Jane Austen",
    });

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
    const text = res.body.toString("utf-8");
    expect(text).toContain("Jane Austen");
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

  it("zero-chapter EPUB export succeeds", async () => {
    const { projectSlug, firstChapterId, secondChapterId } = await createProjectWithChapters(t.app);

    await request(t.app).delete(`/api/chapters/${firstChapterId}`);
    await request(t.app).delete(`/api/chapters/${secondChapterId}`);

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
  });
});
```

Run: `npm test -w packages/server -- --run export.service`
Expected: FAIL (400 — Zod rejects new format values)

#### GREEN

**Step 1: Update shared schema** (`packages/shared/src/schemas.ts`):

```typescript
export const ExportFormat = z.enum(["html", "markdown", "plaintext", "docx", "epub"]);
```

```typescript
export const EXPORT_FILE_EXTENSIONS: Record<ExportFormatType, string> = {
  html: "html",
  markdown: "md",
  plaintext: "txt",
  docx: "docx",
  epub: "epub",
};
```

```typescript
export const EXPORT_CONTENT_TYPES: Record<ExportFormatType, string> = {
  html: "text/html; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  plaintext: "text/plain; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  epub: "application/epub+zip",
};
```

**Step 2: Update export service** (`packages/server/src/export/export.service.ts`):

1. Update `ExportResult.content` type: `string` → `string | Buffer`
2. Update local variable: `let content: string` → `let content: string | Buffer`
3. Import new renderers:
   ```typescript
   import { renderDocx } from "./docx.renderer";
   import { renderEpub } from "./epub.renderer";
   ```
4. Add switch cases:
   ```typescript
   case "docx":
     content = await renderDocx(projectInfo, exportChapters, options);
     break;
   case "epub":
     content = await renderEpub(projectInfo, exportChapters, options);
     break;
   ```

Note: `res.send()` in the route handler already handles both strings and Buffers — `export.routes.ts` requires no changes.

Run: `npm test -w packages/server -- --run export.service`
Expected: PASS

#### REFACTOR

Run full server test suite: `npm test -w packages/server`

Look for:
- The existing test for "invalid format" uses `format: "pdf"` — this should still be rejected (400). Verify.
- Any type errors from the `string | Buffer` change propagating

**Commit:**

```bash
git add packages/shared/src/schemas.ts packages/server/src/export/export.service.ts packages/server/src/__tests__/export.service.test.ts
git commit -m "feat(export): wire docx and epub into schema and export service"
```

---

## Task 6: Update client — strings, API type, and ExportDialog

**Requirement:** Design §Integration — add format options to export dialog

**Files:**
- Modify: `packages/client/src/strings.ts`
- Modify: `packages/client/src/api/client.ts`
- Modify: `packages/client/src/components/ExportDialog.tsx`

#### RED
- Existing client tests should still pass, and any that assert the number of format radio buttons will need updating
- Run client tests first to establish baseline: `npm test -w packages/client`

#### GREEN

**Step 1: Update strings.ts**

After `formatPlainText: "Plain Text",` add:

```typescript
formatDocx: "Word (.docx)",
formatEpub: "EPUB",
```

**Step 2: Update API client type**

In `packages/client/src/api/client.ts`, update the format type in the export method:

```typescript
format: "html" | "markdown" | "plaintext" | "docx" | "epub";
```

**Step 3: Update ExportDialog.tsx**

Add two more radio buttons to the format fieldset. Change the container from `flex gap-4` to `flex flex-wrap gap-x-4 gap-y-2` to accommodate five options:

```tsx
<div className="flex flex-wrap gap-x-4 gap-y-2">
  {/* existing three radios unchanged */}
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

**Step 4: Verify**

```bash
npx tsc --noEmit
npm test -w packages/client
```

#### REFACTOR

Look for:
- Radio button JSX is repetitive (5 nearly identical blocks). Consider whether a data-driven approach is cleaner, but only if it improves readability — 5 explicit radios is acceptable.

**Commit:**

```bash
git add packages/client/src/strings.ts packages/client/src/api/client.ts packages/client/src/components/ExportDialog.tsx
git commit -m "feat(export): add docx and epub options to export dialog"
```

---

## Task 7: Update e2e tests

**Requirement:** Design §Testing — e2e tests for all five format options, download verification

**Files:**
- Modify: `e2e/export.spec.ts`

#### RED
- Write e2e tests that will fail until the UI and API are wired up (they should pass since Tasks 5-6 are done)
- If they fail: something in the wiring is broken

```typescript
test("exports manuscript as Word (.docx) via dialog", async ({ page }) => {
  await page.goto(`/projects/${project.slug}`);
  const editor = page.getByRole("textbox");
  await expect(editor).toBeVisible();

  const exportButton = page.getByRole("button", { name: "Export", exact: true });
  await exportButton.click();
  await expect(page.getByText("Export Manuscript")).toBeVisible();

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

  await expect(page.getByRole("radio", { name: "HTML" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Markdown" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Plain Text" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Word (.docx)" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "EPUB" })).toBeVisible();
});
```

#### GREEN

Run: `make e2e`
Expected: PASS (all wiring done in previous tasks)

#### REFACTOR

Look for:
- Shared setup patterns across export e2e tests that could be extracted
- Existing export tests that should be updated (e.g., accessibility test should still pass with new radios)

**Commit:**

```bash
git add e2e/export.spec.ts
git commit -m "test(export): add e2e tests for docx and epub export"
```

---

## Task 8: Full validation pass

**Requirement:** All design requirements covered, all tests green

#### RED

Run full CI suite:

```bash
make all
```

This runs lint + format + typecheck + coverage + e2e. Fix any issues found.

#### GREEN

Fix all failures. Common issues to watch for:
- Coverage thresholds (95% statements) — new renderer files need sufficient test coverage
- Lint errors in new files
- Formatting inconsistencies

#### REFACTOR

**Manual smoke test:** Start the dev server (`make dev`), create a project with chapters containing varied content (headings, bold, italic, lists, blockquotes, code blocks), and export as:

1. **HTML** — verify headings are H1/H2/H3 (not H3/H4/H5)
2. **Markdown** — verify headings are `#`/`##`/`###`
3. **Word (.docx)** — open in Word or LibreOffice Writer, verify:
   - Title page with project title and author
   - TOC field (Word may prompt to update fields)
   - Page breaks between chapters
   - Chapter headings are Heading 1 style
   - Serif body font
   - Bold, italic, lists, blockquotes render correctly
4. **EPUB** — open in an EPUB reader (Apple Books, Calibre), verify:
   - Navigation/TOC works
   - Chapters are separate sections
   - Styling is readable (serif font, comfortable spacing)
   - CJK characters render correctly if tested

**Commit any fixes:**

```bash
git add -A
git commit -m "fix(export): address issues found during validation"
```
